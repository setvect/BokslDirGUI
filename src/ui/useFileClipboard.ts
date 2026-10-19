import { useEffect, useRef, useState } from 'react';
import { ACTION_BY_ID, fileShortcutPlatform, labelForAction, type ActionId, type AppAction } from '../actions/registry';
import type { DirectoryListing, PlatformInfo, FileEntry, OperationSummary, PanelId, Settings } from '../domain/types';
import { formatUserErrorMessage, type CommanderStatusText } from '../i18n-resources';
import { isTauriRuntime } from '../tauri/client';
import type { SafeMutationClient } from '../tauri/commanderClients';
import { createDirectoryListing } from './panelState';
import type { ExecuteAction } from './actionRequest';
import { isArchiveVirtualPath } from './archiveVirtual';
import type { FileClipboardSnapshot } from './commanderTypes';
import { joinPath } from './fileActionPlans';
import type { PanelStateById } from './panelState';

interface FileClipboardDependencies {
  settings: Settings; panelState: PanelStateById; statusText: CommanderStatusText;
  setStatusMessage(message: string | null): void; runtimeBackendAvailable: boolean;
  dispatch: ExecuteAction;
  mutationClient: SafeMutationClient;
  operationBusy: boolean;
  platformInfo?: PlatformInfo;
}
export function useFileClipboard(dependencies: FileClipboardDependencies) {
  const [fileClipboard, setFileClipboard] = useState<FileClipboardSnapshot | null>(null);
  const latest = useRef(dependencies);
  latest.current = dependencies;
  const local = useRef<FileClipboardSnapshot | null>(null);
  const [nativeCount, setNativeCount] = useState(0);
  const [nativeIntent, setNativeIntent] = useState<'copy' | 'move'>('copy');
  const alive = useRef(true);
  const sequence = useRef(0);
  const writeQueue = useRef(Promise.resolve());
  const writing = useRef(0);
  const polling = useRef(false);
  const pasteRequest = useRef(0);
  const native = isTauriRuntime() && dependencies.runtimeBackendAvailable && (dependencies.platformInfo?.features.nativeFileClipboard ?? fileShortcutPlatform() === 'mac')
    && Boolean(dependencies.mutationClient.readFileClipboard && dependencies.mutationClient.writeFileClipboard);
  const setLocal = (snapshot: FileClipboardSnapshot | null) => { local.current = snapshot; setFileClipboard(snapshot); };
  useEffect(() => {
    alive.current = true;
    if (!native) return () => { alive.current = false; };
    let pollRequest = 0;
    const refresh = async () => {
      if (polling.current || writing.current || document.visibilityState === 'hidden') return;
      polling.current = true;
      const revision = sequence.current, request = ++pollRequest;
      try {
        const result = await latest.current.mutationClient.readFileClipboard!({ resolve: false });
        if (!alive.current || writing.current || revision !== sequence.current || request !== pollRequest) return;
        if (!result.ok) { setNativeCount(0); return; }
        setNativeCount(result.data.paths.length);
        setNativeIntent(result.data.intent);
        if (local.current && local.current.nativeVersion !== result.data.changeCount) setLocal(null);
      } finally {
        polling.current = false;
      }
    };
    void refresh();
    const onFocus = () => { void refresh(); };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const timer = window.setInterval(onFocus, 1000);
    return () => { alive.current = false; sequence.current++; window.clearInterval(timer); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); };
  }, [native]);
  const captureClipboard = (action: AppAction, sources: FileEntry[], panelOverride: PanelId, panelListing: DirectoryListing) => {
    const actionId = action.id;

    if (sources.length === 0) {
      dependencies.setStatusMessage(dependencies.statusText.virtualOperationTargetUnavailable(labelForAction(action, dependencies.settings.language)));
      return;
    }
    if (actionId === 'file.clipboardCut' && (isArchiveVirtualPath(panelListing.path) || !dependencies.runtimeBackendAvailable)) {
      dependencies.setStatusMessage(dependencies.statusText.clipboardMoveUnavailable);
      return;
    }
    const intent = actionId === 'file.clipboardCut' ? 'move' : 'copy';
    const snapshot: FileClipboardSnapshot = { intent, panelId: panelOverride, listing: panelListing, entries: [...sources] };
    const captured = () => {
      setLocal(snapshot);
      latest.current.setStatusMessage(intent === 'move'
      ? dependencies.statusText.clipboardCut(sources.length)
      : dependencies.statusText.clipboardCopied(sources.length, fileShortcutPlatform() === 'mac' ? '⌘V' : 'Ctrl+V'));
    };
    if (!native) { captured(); return; }
    const revision = ++sequence.current;
    setLocal(snapshot);
    writing.current++;
    writeQueue.current = writeQueue.current.then(async () => {
      if (!alive.current || revision !== sequence.current) return;
      // 가상 압축 항목은 앱 내부에서만 보관하되 외부 클립보드 변경 여부는 추적.
      const result = isArchiveVirtualPath(panelListing.path)
        ? await latest.current.mutationClient.readFileClipboard!({ resolve: false })
        : await latest.current.mutationClient.writeFileClipboard!({ paths: sources.map(entry => entry.path), intent });
      if (!alive.current || revision !== sequence.current) return;
      if (!result.ok) { setLocal(null); latest.current.setStatusMessage(formatUserErrorMessage(latest.current.settings.language, result.error)); return; }
      snapshot.nativeVersion = typeof result.data === 'number' ? result.data : result.data.changeCount;
      setNativeCount(isArchiveVirtualPath(panelListing.path) ? 0 : sources.length);
      setNativeIntent(intent);
      captured();
    }).finally(() => { writing.current--; });
    return;

  };
  const pasteSnapshot = (actionId: ActionId, panelOverride: PanelId, fileClipboard: FileClipboardSnapshot | null, targetDir: string) => {
    if (!fileClipboard) {
      dependencies.setStatusMessage(dependencies.statusText.clipboardEmpty);
      return;
    }
    const move = actionId === 'file.clipboardMovePaste' || fileClipboard.intent === 'move';
    if (move && (isArchiveVirtualPath(fileClipboard.listing.path) || isArchiveVirtualPath(targetDir))) {
      dependencies.setStatusMessage(dependencies.statusText.clipboardMoveUnavailable);
      return;
    }
    if (fileClipboard.entries.some((entry) => entry.path === joinPath(targetDir, entry.name))) {
      dependencies.setStatusMessage(dependencies.statusText.clipboardSameDirectory);
      return;
    }
    const operationAction = ACTION_BY_ID.get(move ? 'file.move' : 'file.copy');
    if (operationAction) {
      latest.current.dispatch({
        actionId: operationAction.id,
        panelId: fileClipboard.panelId,
        sources: fileClipboard.entries,
        targetDir,
        sourceListing: fileClipboard.listing,
        clipboardMoveSnapshot: move ? fileClipboard : undefined,
      });
    }
    return;

  };
  const pasteClipboard = (actionId: ActionId, panelId: PanelId) => {
    const targetDir = dependencies.panelState[panelId].path;
    if (!native) { pasteSnapshot(actionId, panelId, local.current, targetDir); return; }
    const revision = sequence.current, request = ++pasteRequest.current;
    void writeQueue.current.then(async () => {
      const header = await latest.current.mutationClient.readFileClipboard!({ resolve: false });
      const internalArchive = header.ok && local.current?.nativeVersion === header.data.changeCount
        && isArchiveVirtualPath(local.current.listing.path);
      const result = internalArchive || !header.ok ? header : await latest.current.mutationClient.readFileClipboard!({ resolve: true });
      if (!alive.current || request !== pasteRequest.current || revision !== sequence.current || latest.current.operationBusy
        || latest.current.panelState[panelId].path !== targetDir) return;
      if (!result.ok) { latest.current.setStatusMessage(formatUserErrorMessage(latest.current.settings.language, result.error)); return; }
      if (header.ok && result.data.changeCount !== header.data.changeCount) {
        latest.current.setStatusMessage(formatUserErrorMessage(latest.current.settings.language, { messageKey: 'errors.fileClipboardChanged' }));
        return;
      }
      let snapshot = local.current?.nativeVersion === result.data.changeCount ? local.current : null;
      if (!snapshot && result.data.entries.length) snapshot = {
        nativeVersion: result.data.changeCount, intent: result.data.intent, panelId,
        listing: createDirectoryListing(panelId, '/', result.data.entries), entries: result.data.entries,
      };
      if (snapshot && !internalArchive) snapshot = { ...snapshot, entries: result.data.entries };
      pasteRequest.current++;
      setLocal(snapshot);
      setNativeCount(result.data.paths.length);
      setNativeIntent(result.data.intent);
      pasteSnapshot(actionId, panelId, snapshot, targetDir);
    });
  };
  const completeClipboardMove = (snapshot: FileClipboardSnapshot | undefined, summary: OperationSummary) => {
    const completed = summary.state === 'completed' && summary.failedFiles === 0 && (summary.skippedFiles ?? 0) === 0;
    if (snapshot && (completed || summary.completedFiles > 0)) {
      if (local.current === snapshot) { setLocal(null); setNativeCount(0); }
      if (snapshot.nativeVersion !== undefined) void dependencies.mutationClient.clearFileClipboard?.({ changeCount: snapshot.nativeVersion });
    }
  };
  return { fileClipboard, clipboardMode: fileClipboard?.intent ?? (nativeCount > 0 ? nativeIntent : null), clipboardCount: fileClipboard?.entries.length ?? nativeCount,
    clipboardCanMove: fileClipboard ? !isArchiveVirtualPath(fileClipboard.listing.path) : nativeCount > 0,
    captureClipboard, pasteClipboard, completeClipboardMove };
}

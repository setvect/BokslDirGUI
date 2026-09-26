import { useState } from 'react';
import { ACTION_BY_ID, fileShortcutPlatform, labelForAction, type ActionId, type AppAction } from '../actions/registry';
import type { DirectoryListing, FileEntry, OperationSummary, PanelId, Settings } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import type { ExecuteAction } from './actionRequest';
import { isArchiveVirtualPath } from './archiveVirtual';
import type { FileClipboardSnapshot } from './commanderTypes';
import { joinPath } from './fileActionPlans';
import type { PanelStateById } from './panelState';

interface FileClipboardDependencies {
  settings: Settings; panelState: PanelStateById; statusText: CommanderStatusText;
  setStatusMessage(message: string | null): void; runtimeBackendAvailable: boolean;
  dispatch: ExecuteAction;
}
export function useFileClipboard(dependencies: FileClipboardDependencies) {
  const [fileClipboard, setFileClipboard] = useState<FileClipboardSnapshot | null>(null);
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
    setFileClipboard({ intent, panelId: panelOverride, listing: panelListing, entries: [...sources] });
    dependencies.setStatusMessage(intent === 'move'
      ? dependencies.statusText.clipboardCut(sources.length)
      : dependencies.statusText.clipboardCopied(sources.length, fileShortcutPlatform() === 'mac' ? '⌘V' : 'Ctrl+V'));
    return;

  };
  const pasteClipboard = (actionId: ActionId, panelOverride: PanelId) => {

    if (!fileClipboard) {
      dependencies.setStatusMessage(dependencies.statusText.clipboardEmpty);
      return;
    }
    const targetDir = dependencies.panelState[panelOverride].path;
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
      dependencies.dispatch({
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
  const completeClipboardMove = (snapshot: FileClipboardSnapshot | undefined, summary: OperationSummary) => {
    const completed = summary.state === 'completed' && summary.failedFiles === 0 && (summary.skippedFiles ?? 0) === 0;
    if (snapshot && (completed || summary.completedFiles > 0)) setFileClipboard(current => current === snapshot ? null : current);
  };
  return { fileClipboard, captureClipboard, pasteClipboard, completeClipboardMove };
}

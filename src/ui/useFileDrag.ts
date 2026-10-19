import { isAppError } from '../tauri/client';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import nativeFileDragIcon from '../../src-tauri/icons/32x32.png?inline';
import {
  ACTION_BY_ID,
  labelForAction
} from '../actions/registry';
import type { FileEntry, PanelId, Settings } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import {
  formatUserErrorMessage
} from '../i18n-resources';
import { isOperationInFlight } from '../operations/operationLifecycle';
import { useOperationStore } from '../operations/operationStore';
import { isTauriRuntime } from '../tauri/client';
import { NativeFileDragClient, NativeFileDragMode, NativeFileDropClient, NativeFileDropEvent, SafeMutationClient, showNativeDropOverlay, TAURI_NATIVE_FILE_DRAG_CLIENT, TAURI_NATIVE_FILE_DROP_CLIENT } from '../tauri/commanderClients';
import type { ExecuteAction } from './actionRequest';
import {
  isArchiveVirtualPath
} from './archiveVirtual';
import { NativeFileDropRuntime } from './commanderTypes';
import { basenameFromPath } from './fileActionPlans';
import { FileDragSource, fileEntryFromExternalDropFile, fileEntryFromExternalDropPath, panelIdAtClientPosition, samePathSet, uniqueAbsolutePaths } from './fileDropTargets';
import { commanderKeyboardHasOwner } from './keyboardOwnership';
import { nativeDragPreview } from './nativeDragPreview';
import { panelIdLabel } from './panelPresentation';
import type { PanelStateById } from './panelState';
import { beginPointerFileDrag, traceFileDrag, type DragPoint } from './pointerFileDrag';
import { sourcesBelongToListing } from './selectionModel';

interface FileDragDependencies {
  readonly runtimeBackendAvailable: boolean;
  readonly nativeFileDropClient: NativeFileDropClient | undefined;
  readonly nativeFileDragClient: NativeFileDragClient | undefined;
  readonly panelStateRef: RefObject<PanelStateById>;
  readonly handleAction: ExecuteAction;
  readonly setActivePanel: Dispatch<SetStateAction<PanelId>>;
  readonly setStatusMessage: Dispatch<SetStateAction<string | null>>;
  readonly statusText: CommanderStatusText;
  readonly operationBusy: boolean;
  readonly shortcutSequenceRef: RefObject<readonly string[]>;
  readonly shortcutSequenceTimeoutRef: RefObject<number | null>;
  readonly settings: Settings;
  readonly mutationClient: SafeMutationClient;
  readonly panelState: PanelStateById;
  readonly refreshPanel: (panelId: PanelId, background?: boolean) => void;
}
export function useFileDrag(runtime: FileDragDependencies) {

  const nativeFileDropRuntimeRef = useRef<NativeFileDropRuntime | null>(null);

  const nativeFileDragSourceRef = useRef<FileDragSource | null>(null);

  const pointerDragCleanupRef = useRef<(() => void) | null>(null);

  const commitPanelDragRef = useRef<(source: FileDragSource, target: PanelId | null, mode: NativeFileDragMode) => void>(() => { });

  const [pointerDragPreview, setPointerDragPreview] = useState<{ entries: FileEntry[]; point: DragPoint; mode: NativeFileDragMode } | null>(null);

  const nativeDropOverlayRequestedRef = useRef(false);
  const nativeDropPendingRef = useRef(false);
  const nativeDropGenerationRef = useRef(0);

  const [dragOverPanel, setDragOverPanel] = useState<{ panelId: PanelId; intent: 'copy' | 'move' | 'import' | 'blocked' } | null>(null);

  const [nativeFileDragUnavailable, setNativeFileDragUnavailable] = useState(false);

  const nativeFileDropEnabled = runtime.runtimeBackendAvailable && Boolean(runtime.nativeFileDropClient || isTauriRuntime());

  const resolvedNativeFileDragClient = nativeFileDragUnavailable
    ? null
    : runtime.nativeFileDragClient ?? (isTauriRuntime() ? TAURI_NATIVE_FILE_DRAG_CLIENT : null);

  const dragEntries = (panelId: PanelId, entry: FileEntry): FileDragSource => {
    const panel = runtime.panelStateRef.current[panelId];
    const selected = new Set(panel.selectedPaths);
    return {
      panelId, sourcePath: panel.path, mode: 'copy', entries: selected.has(entry.path)
        ? panel.listing.entries.filter((candidate) => !candidate.isVirtual && selected.has(candidate.path))
        : [entry]
    };
  };

  const dragTargetBlocked = (source: FileDragSource, target: PanelId | null) => {
    if (!target || target === source.panelId) return true;
    const panels = runtime.panelStateRef.current;
    return isOperationInFlight(useOperationStore.getState()) || commanderKeyboardHasOwner()
      || panels[source.panelId].loading || panels[target].loading
      || panels[source.panelId].path !== source.sourcePath
      || panels[target].path === source.sourcePath || isArchiveVirtualPath(panels[target].path)
      || !sourcesBelongToListing(source.entries, panels[source.panelId].listing);
  };

  commitPanelDragRef.current = (source, target, mode) => {
    setPointerDragPreview(null);
    setDragOverPanel(null);
    const blocked = dragTargetBlocked(source, target);
    traceFileDrag('drop', { source: source.panelId, target, mode, blocked, count: source.entries.length });
    if (blocked || !target) return;
    const action = ACTION_BY_ID.get(mode === 'move' ? 'file.move' : 'file.copy')!;
    runtime.handleAction({ actionId: (action).id, panelId: source.panelId, sources: source.entries, targetDir: runtime.panelStateRef.current[target].path });
  };

  const startNativeEntryDrag = (session: FileDragSource, mode: NativeFileDragMode) => {
    setPointerDragPreview(null);
    setDragOverPanel(null);
    if (!resolvedNativeFileDragClient || isArchiveVirtualPath(session.sourcePath)) return;
    const { panelId, entries } = session;
    let preview = nativeFileDragIcon;
    if (isTauriRuntime()) {
      try {
        preview = nativeDragPreview(entries);
      } catch {
        // Keep file dragging available if canvas rendering fails on this WebView.
      }
    }
    session.mode = mode;
    nativeFileDragSourceRef.current = session;
    runtime.setActivePanel(panelId);
    runtime.setStatusMessage(runtime.statusText.externalDragStart(entries.length));

    void resolvedNativeFileDragClient.start(
      entries.map((candidate) => candidate.path),
      mode,
      preview,
      ({ result }) => {
        traceFileDrag('native-end', { source: panelId, result });
        window.setTimeout(() => {
          if (nativeFileDragSourceRef.current !== session) {
            return;
          }
          nativeFileDragSourceRef.current = null;
          nativeDropOverlayRequestedRef.current = false;
          setDragOverPanel(null);
          if (result === 'Dropped' && mode === 'move') {
            for (const panel of ['left', 'right'] as const) {
              if (runtime.panelStateRef.current[panel].path === session.sourcePath) {
                runtime.refreshPanel(panel, true);
              }
            }
          }
          runtime.setStatusMessage(result === 'Dropped'
            ? runtime.statusText.externalDragDone(entries.length)
            : runtime.statusText.externalDragCancelled);
        }, result === 'Dropped' ? 250 : 0);
      },
    ).catch((error: unknown) => {
      if (nativeFileDragSourceRef.current === session) {
        nativeFileDragSourceRef.current = null;
      }
      nativeDropOverlayRequestedRef.current = false;
      if (!isAppError(error)) setNativeFileDragUnavailable(true);
      setDragOverPanel(null);
      runtime.setStatusMessage(runtime.statusText.externalDragFailed(isAppError(error)
        ? formatUserErrorMessage(runtime.settings.language, error) : String(error)));
    });
  };

  const handleEntryPointerDown = (event: ReactPointerEvent<HTMLElement>, panelId: PanelId, entry: FileEntry) => {
    if (entry.isVirtual || event.button !== 0 || runtime.operationBusy || commanderKeyboardHasOwner()) return;
    pointerDragCleanupRef.current?.();
    const source = dragEntries(panelId, entry);
    let previousHover = '';
    pointerDragCleanupRef.current = beginPointerFileDrag(event, {
      start: () => {
        runtime.setActivePanel(panelId);
        runtime.shortcutSequenceRef.current = [];
        if (runtime.shortcutSequenceTimeoutRef.current) window.clearTimeout(runtime.shortcutSequenceTimeoutRef.current);
        traceFileDrag('start', { source: panelId, count: source.entries.length });
      },
      update: (point, mode) => {
        const target = panelIdAtClientPosition(point);
        const blocked = dragTargetBlocked(source, target);
        const hoverKey = `${target}:${mode}:${blocked}`;
        if (hoverKey !== previousHover) {
          traceFileDrag('hover', { source: panelId, target, mode, blocked, point, pixelRatio: window.devicePixelRatio });
          previousHover = hoverKey;
        }
        setPointerDragPreview({ entries: source.entries, point, mode });
        setDragOverPanel(target ? { panelId: target, intent: blocked ? 'blocked' : mode } : null);
      },
      drop: (point, mode) => {
        traceFileDrag('release', { source: panelId, point, mode });
        commitPanelDragRef.current(source, panelIdAtClientPosition(point), mode);
      },
      external: (mode) => startNativeEntryDrag(source, mode),
      cancel: () => {
        setPointerDragPreview(null);
        setDragOverPanel(null);
        traceFileDrag('cancel', { source: panelId });
      },
    });
  };

  useEffect(() => () => {
    pointerDragCleanupRef.current?.();
    nativeFileDragSourceRef.current = null;
  }, []);

  // HTML drop events belong only to files arriving from outside this WebView.
  const handlePanelDrop = (event: DragEvent<HTMLElement>, targetPanel: PanelId) => {
    event.preventDefault();
    setDragOverPanel(null);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0 || nativeFileDropEnabled) return;
    const externalEntries = files.map(fileEntryFromExternalDropFile)
      .filter((entry): entry is FileEntry => Boolean(entry));
    if (externalEntries.length !== files.length) {
      runtime.setStatusMessage(runtime.statusText.externalDropPathRequired);
      return;
    }
    const action = ACTION_BY_ID.get('file.copy')!;
    runtime.handleAction({ actionId: (action).id, panelId: targetPanel, sources: externalEntries, targetDir: runtime.panelStateRef.current[targetPanel].path });
    runtime.setStatusMessage(runtime.statusText.externalImport(externalEntries.length, panelIdLabel(targetPanel, runtime.settings.language)));
  };

  const handlePanelDragOver = (event: DragEvent<HTMLElement>, targetPanel: PanelId) => {
    if (!Array.from(event.dataTransfer.types ?? []).includes('Files')) return;
    event.preventDefault();
    if (!navigator.platform.startsWith('Win') && nativeFileDropEnabled && isTauriRuntime() && !nativeDropOverlayRequestedRef.current) {
      nativeDropOverlayRequestedRef.current = true;
      void showNativeDropOverlay().catch((error: unknown) => {
        nativeDropOverlayRequestedRef.current = false;
        runtime.setStatusMessage(runtime.statusText.externalDropUnavailable(String(error)));
      });
    }
    const blocked = runtime.operationBusy || isArchiveVirtualPath(runtime.panelStateRef.current[targetPanel].path);
    setDragOverPanel({ panelId: targetPanel, intent: blocked ? 'blocked' : 'import' });
  };

  const importNativeDroppedPaths = async (paths: string[], targetPanel: PanelId, targetDir: string, nativeSource: FileDragSource | null, generation: number) => {
    const normalizedPaths = uniqueAbsolutePaths(paths);
    if (normalizedPaths.length !== paths.length) {
      runtime.setStatusMessage(runtime.statusText.externalDropPathRequired);
      return;
    }

    const externalEntries: FileEntry[] = [];
    const resolvedPaths: string[] = [];
    if (runtime.mutationClient.getMetadata) {
      const metadataResults = await Promise.all(
        normalizedPaths.map((path) => runtime.mutationClient.getMetadata!({ path })),
      );
      if (generation !== nativeDropGenerationRef.current) return;
      for (const [index, result] of metadataResults.entries()) {
        if (!result.ok) {
          runtime.setStatusMessage(formatUserErrorMessage(runtime.settings.language, result.error));
          return;
        }
        resolvedPaths.push(result.data.absolutePath);
        const sourcePath = normalizedPaths[index];
        externalEntries.push({
          ...result.data,
          path: sourcePath,
          name: basenameFromPath(sourcePath),
        });
      }
    } else {
      externalEntries.push(...normalizedPaths.map(fileEntryFromExternalDropPath));
    }

    if (generation !== nativeDropGenerationRef.current
      || runtime.panelStateRef.current[targetPanel].path !== targetDir
      || isOperationInFlight(useOperationStore.getState()) || commanderKeyboardHasOwner()) return;
    if (nativeSource) {
      // Compare backend-resolved paths, never display-normalize paths for identity.
      // Windows CF_HDROP may return C:\... while our listing retains \\?\C:\....
      if (samePathSet(nativeSource.entries.map(entry => entry.path), resolvedPaths)) {
        if (dragTargetBlocked(nativeSource, targetPanel)) {
          runtime.setStatusMessage(runtime.statusText.externalDragCancelled);
          return;
        }
        commitPanelDragRef.current(nativeSource, targetPanel, nativeSource.mode);
      } else {
        runtime.setStatusMessage(runtime.statusText.externalDropPathRequired);
      }
      return;
    }

    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      return;
    }
    runtime.handleAction({ actionId: (action).id, panelId: targetPanel, sources: externalEntries, targetDir: targetDir });
    runtime.setActivePanel(targetPanel);
    runtime.setStatusMessage(runtime.statusText.externalImport(externalEntries.length, panelIdLabel(targetPanel, runtime.settings.language)));
  };

  const handleNativeFileDropEvent = (event: NativeFileDropEvent) => {
    if (event.type !== 'over') traceFileDrag('native-drop', { type: event.type, own: Boolean(nativeFileDragSourceRef.current) });
    if (event.type === 'leave') {
      nativeDropOverlayRequestedRef.current = false;
      setDragOverPanel((current) => current?.intent === 'import' || current?.intent === 'blocked' ? null : current);
      return;
    }

    if (event.type === 'drop') {
      nativeDropOverlayRequestedRef.current = false;
      if (nativeDropPendingRef.current) return;
    }

    const targetPanel = panelIdAtClientPosition(event.position);
    if (!targetPanel) {
      setDragOverPanel(null);
      return;
    }
    const targetState = runtime.panelState[targetPanel];
    const nativeDragSource = nativeFileDragSourceRef.current;
    const isOwnNativeDrag = Boolean(
      nativeDragSource
      && (event.type !== 'drop' || samePathSet(
        nativeDragSource.entries.map((entry) => entry.path),
        event.paths,
      )),
    );
    const blocked = runtime.operationBusy
      || isArchiveVirtualPath(targetState.path)
      || Boolean(isOwnNativeDrag && nativeDragSource?.panelId === targetPanel);

    if (event.type === 'enter' || event.type === 'over') {
      setDragOverPanel({
        panelId: targetPanel,
        intent: blocked ? 'blocked' : isOwnNativeDrag ? nativeDragSource!.mode : 'import',
      });
      return;
    }

    setDragOverPanel(null);
    const blockedAction = ACTION_BY_ID.get(
      isOwnNativeDrag && nativeDragSource?.mode === 'move' ? 'file.move' : 'file.copy',
    );
    if (blocked || event.paths.length === 0) {
      if (isOwnNativeDrag) nativeFileDragSourceRef.current = null;
      if (blockedAction) {
        runtime.setStatusMessage(runtime.statusText.unavailableInContext(labelForAction(blockedAction, runtime.settings.language)));
      }
      return;
    }
    if (isOwnNativeDrag && nativeDragSource) {
      nativeFileDragSourceRef.current = null;
      commitPanelDragRef.current(nativeDragSource, targetPanel, nativeDragSource.mode);
      return;
    }
    // Claim this drop before resolving metadata; completion and duplicate events
    // must not clear its source snapshot or enqueue a second file operation.
    nativeFileDragSourceRef.current = null;
    nativeDropPendingRef.current = true;
    const generation = ++nativeDropGenerationRef.current;
    void importNativeDroppedPaths(event.paths, targetPanel, targetState.path, nativeDragSource, generation)
      .catch((error: unknown) => {
        if (generation === nativeDropGenerationRef.current) {
          runtime.setStatusMessage(runtime.statusText.externalDropUnavailable(String(error)));
        }
      })
      .finally(() => {
        if (generation === nativeDropGenerationRef.current) nativeDropPendingRef.current = false;
      });
  };

  nativeFileDropRuntimeRef.current = {
    handle: handleNativeFileDropEvent,
    handleListenError: (error) => runtime.setStatusMessage(runtime.statusText.externalDropUnavailable(String(error))),
  };

  useEffect(() => {
    if (!runtime.runtimeBackendAvailable) {
      return undefined;
    }
    const client = runtime.nativeFileDropClient ?? (isTauriRuntime() ? TAURI_NATIVE_FILE_DROP_CLIENT : null);
    if (!client) {
      return undefined;
    }

    let disposed = false;
    let unlisten: (() => void) | null = null;
    void client.listen((event) => nativeFileDropRuntimeRef.current?.handle(event))
      .then((nextUnlisten) => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch((error: unknown) => {
        if (!disposed) {
          nativeFileDropRuntimeRef.current?.handleListenError(error);
        }
      });

    return () => {
      disposed = true;
      nativeDropGenerationRef.current += 1;
      nativeDropPendingRef.current = false;
      unlisten?.();
    };
  }, [runtime.nativeFileDropClient, runtime.runtimeBackendAvailable]);
  return { handleEntryPointerDown, dragOverPanel, handlePanelDragOver, setDragOverPanel, handlePanelDrop, pointerDragPreview };
}

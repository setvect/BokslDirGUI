import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ArchiveListing, FileEntry, PanelId, Settings, SortSpec } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import {
  formatUserErrorMessage
} from '../i18n-resources';
import { SafeMutationClient } from '../tauri/commanderClients';
import {
  archiveListingToDirectoryListing,
  archiveParentFocusPath,
  archiveParentPath,
  isArchiveVirtualPath,
  parseArchiveVirtualPath
} from './archiveVirtual';
import { ARCHIVE_LIST_LIMIT, ArchivePasswordRequest, CachedArchiveListing, ListPanelOptions } from './commanderTypes';
import { DirectoryComparison } from './directoryComparison';
import { commanderKeyboardHasOwner } from './keyboardOwnership';
import { type PanelDataSource, type PanelInitialLoadResult } from './panelDataSource';
import { panelIdLabel } from './panelPresentation';
import {
  DEFAULT_SORT,
  PANEL_IDS,
  clampFocusedIndex,
  createPanelStates,
  focusedEntryOf,
  markPanelError,
  markPanelLoading,
  parentNavigationEntryOf,
  parentPathOf,
  replacePanelListing,
  type PanelNavigationState,
  type PanelStateById
} from './panelState';
import { PanelUiPatch, SelectionMode, oppositePanelOf, reassignPanelState, selectedPathsInRange } from './selectionModel';
import { shortenPath } from './textLayout';

interface PanelNavigationDependencies {
  readonly dataSource: PanelDataSource;
  readonly initialFocusIndex: Partial<Record<PanelId, number>> | undefined;
  readonly initialSelectedPaths: Partial<Record<PanelId, string[]>> | undefined;
  readonly setDirectoryComparison: Dispatch<SetStateAction<DirectoryComparison | null>>;
  readonly setStatusMessage: Dispatch<SetStateAction<string | null>>;
  readonly statusText: CommanderStatusText;
  readonly settings: Settings;
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly mutationClient: SafeMutationClient;
  readonly runtimeBackendAvailable: boolean;
  readonly setArchivePasswordRequest: Dispatch<SetStateAction<ArchivePasswordRequest | null>>;
  readonly settingsRef: RefObject<Settings>;
  readonly saveSettingsPatch: (patch: Partial<Settings>, successMessage: string | null, options?: { silent?: boolean; }) => Promise<void>;
  readonly settingsLoaded: boolean;
}
export function usePanelNavigation(runtime: PanelNavigationDependencies) {

  const navigationRequestRef = useRef<Record<PanelId, number>>({ left: 0, right: 0 });

  const selectionAnchorRef = useRef<Record<PanelId, number | null>>({ left: null, right: null });

  const [activePanel, setActivePanel] = useState<PanelId>('right');

  const [panelState, setPanelState] = useState<PanelStateById>(() => createPanelStates(runtime.dataSource.initialListings, {
    left: {
      focusedIndex: runtime.initialFocusIndex?.left,
      selectedPaths: runtime.initialSelectedPaths?.left,
    },
    right: {
      focusedIndex: runtime.initialFocusIndex?.right,
      selectedPaths: runtime.initialSelectedPaths?.right,
    },
  }));

  const archivePasswordsRef = useRef(new Map<string, string>());

  const archiveListingsRef = useRef(new Map<string, CachedArchiveListing>());

  const archiveCacheGenerationRef = useRef(new Map<string, number>());

  const panelStateRef = useRef(panelState);

  panelStateRef.current = panelState;

  const initialPanelLoadStartedRef = useRef(false);

  const [panelTabs, setPanelTabs] = useState<Record<PanelId, PanelNavigationState[]>>(() => ({
    left: [panelState.left],
    right: [panelState.right],
  }));

  const [activeTab, setActiveTab] = useState<Record<PanelId, number>>({ left: 0, right: 0 });

  const updatePanel = (panelId: PanelId, next: PanelUiPatch) => {
    setPanelState((current) => {
      const panel = current[panelId];
      const focusedIndex = next.focusedIndex === undefined
        ? panel.focusedIndex
        : clampFocusedIndex(next.focusedIndex, panel.listing.entries.length);
      return {
        ...current,
        [panelId]: { ...panel, ...next, focusedIndex },
      };
    });
  };

  const recordFocusedRow = (panelId: PanelId, index: number) => updatePanel(panelId, { focusedIndex: index });

  const focusEntry = (panelId: PanelId, index: number, extendSelection = false) => {
    setActivePanel(panelId);
    setPanelState((current) => {
      const panel = current[panelId];
      const focusedIndex = clampFocusedIndex(index, panel.listing.entries.length);
      if (!extendSelection) {
        selectionAnchorRef.current[panelId] = focusedIndex;
        return {
          ...current,
          [panelId]: {
            ...panel,
            focusedIndex,
          },
        };
      }

      const anchor = selectionAnchorRef.current[panelId] ?? panel.focusedIndex;
      selectionAnchorRef.current[panelId] = anchor;
      return {
        ...current,
        [panelId]: {
          ...panel,
          focusedIndex,
          selectedPaths: selectedPathsInRange(panel.listing.entries, anchor, focusedIndex),
        },
      };
    });
  };

  const moveFocusedEntry = (delta: number, extendSelection = false) => {
    focusEntry(activePanel, panelState[activePanel].focusedIndex + delta, extendSelection);
  };

  const focusBoundaryEntry = (boundary: 'first' | 'last', extendSelection = false) => {
    const entryCount = panelState[activePanel].listing.entries.length;
    focusEntry(activePanel, boundary === 'first' ? 0 : entryCount - 1, extendSelection);
  };

  const switchActivePanel = () => {
    setActivePanel(oppositePanelOf(activePanel));
  };

  const beginPanelRequest = (panelId: PanelId) => {
    navigationRequestRef.current[panelId] += 1;
    return navigationRequestRef.current[panelId];
  };

  const isCurrentPanelRequest = (panelId: PanelId, requestId: number) =>
    navigationRequestRef.current[panelId] === requestId;

  const listPanel = async (panelId: PanelId, path: string, options: ListPanelOptions = {}) => {
    runtime.setDirectoryComparison(null);
    const requestId = beginPanelRequest(panelId);
    const requestPanel = panelStateRef.current[panelId];
    const sort = options.sort ?? requestPanel.sort;
    const filter = Object.hasOwn(options, 'filter') ? options.filter ?? null : requestPanel.filter;
    const showHidden = options.showHidden ?? requestPanel.showHidden;

    if (!options.background) setActivePanel(panelId);
    setPanelState((current) => ({
      ...current,
      [panelId]: {
        ...markPanelLoading(current[panelId]),
        sort,
        filter,
        showHidden,
      },
    }));

    const result = isArchiveVirtualPath(path)
      ? await listArchiveVirtualPanel(panelId, path, showHidden, sort, filter, options.forceArchiveReload)
      : await runtime.dataSource.listDir({ panelId, path, showHidden, sort, filter });
    if (!isCurrentPanelRequest(panelId, requestId)) {
      return;
    }
    if (!result.ok) {
      setPanelState((current) => ({
        ...current,
        [panelId]: markPanelError(current[panelId], result.error),
      }));
      runtime.setStatusMessage(runtime.statusText.listFailed(formatUserErrorMessage(runtime.settings.language, result.error)));
      if (!options.background && !commanderKeyboardHasOwner()) runtime.shellRef.current?.focus({ preventScroll: true });
      return;
    }

    setPanelState((current) => ({
      ...current,
      [panelId]: {
        ...replacePanelListing(current[panelId], { ...result.data, sort, filter }, {
          pushHistory: options.pushHistory,
          replaceBack: options.replaceBack,
          replaceForward: options.replaceForward,
          preserveSelection: options.preserveSelection,
          preserveFocusPath: options.preserveFocusPath,
          focusPath: options.focusPath,
          focusFallback: options.focusFallback,
        }),
        showHidden,
      },
    }));
    if (!options.background) runtime.setStatusMessage(options.statusAfterSuccess ?? null);
    if (options.persistSession !== false && !isArchiveVirtualPath(result.data.path)) {
      persistSessionPaths(panelId, result.data.path);
    }
    if (!options.background && !commanderKeyboardHasOwner()) runtime.shellRef.current?.focus({ preventScroll: true });
  };

  const gotoPanelPath = async (panelId: PanelId, path: string) => {
    if (isArchiveVirtualPath(path)) {
      await listPanel(panelId, path, { pushHistory: true, focusFallback: 'first-concrete' });
      return;
    }
    const requestId = beginPanelRequest(panelId);
    setActivePanel(panelId);
    setPanelState((current) => ({ ...current, [panelId]: markPanelLoading(current[panelId]) }));
    const result = await runtime.dataSource.gotoPath({ panelId, path });
    if (!isCurrentPanelRequest(panelId, requestId)) {
      return;
    }
    if (!result.ok) {
      setPanelState((current) => ({ ...current, [panelId]: markPanelError(current[panelId], result.error) }));
      runtime.setStatusMessage(runtime.statusText.gotoFailed(formatUserErrorMessage(runtime.settings.language, result.error)));
      return;
    }
    setPanelState((current) => ({
      ...current,
      [panelId]: {
        ...replacePanelListing(current[panelId], result.data, {
          pushHistory: true,
          focusFallback: 'first-concrete',
        }),
        showHidden: false,
      },
    }));
    runtime.setStatusMessage(runtime.statusText.gotoCompleted(result.data.path));
    runtime.shellRef.current?.focus({ preventScroll: true });
  };

  const listArchiveVirtualPanel = async (
    panelId: PanelId,
    virtualPath: string,
    showHidden: boolean,
    sort: SortSpec,
    filter: string | null,
    forceReload = false,
  ) => {
    const parsed = parseArchiveVirtualPath(virtualPath);
    if (!parsed || !runtime.mutationClient.archiveList || !runtime.runtimeBackendAvailable) {
      return {
        ok: false as const,
        error: {
          code: 'unsupported',
          messageKey: 'errors.archiveProviderUnavailable',
          path: parsed?.archivePath ?? virtualPath,
          details: { command: 'archive_list' },
          recoverable: true,
        },
      };
    }
    const archivePath = parsed.archivePath;
    const password = archivePasswordsRef.current.get(archivePath);
    if (forceReload) {
      archiveListingsRef.current.delete(archivePath);
      archiveCacheGenerationRef.current.set(archivePath, (archiveCacheGenerationRef.current.get(archivePath) ?? 0) + 1);
    }
    const generation = archiveCacheGenerationRef.current.get(archivePath) ?? 0;
    const metadata = runtime.mutationClient.getMetadata ? await runtime.mutationClient.getMetadata({ path: archivePath }) : null;
    const fileSignature = metadata?.ok ? `${metadata.data.sizeBytes}:${metadata.data.modifiedAt}` : null;
    const cached = archiveListingsRef.current.get(archivePath);
    let listing: ArchiveListing;
    if (!forceReload && cached && cached.password === password &&
      (!runtime.mutationClient.getMetadata || (fileSignature !== null && cached.fileSignature === fileSignature))) {
      listing = cached.listing;
    } else {
      const result = await runtime.mutationClient.archiveList({ archivePath, password, limit: ARCHIVE_LIST_LIMIT });
      if (!result.ok) {
        archiveListingsRef.current.delete(archivePath);
        if (result.error.code === 'password_required' || result.error.code === 'invalid_password') {
          archivePasswordsRef.current.delete(archivePath);
          runtime.setArchivePasswordRequest({ kind: 'open', panelId, virtualPath, archivePath });
        }
        return result;
      }
      listing = result.data;
      if (generation === (archiveCacheGenerationRef.current.get(archivePath) ?? 0)) {
        archiveListingsRef.current.delete(archivePath);
        archiveListingsRef.current.set(archivePath, { listing, password, fileSignature });
        if (archiveListingsRef.current.size > 2) {
          archiveListingsRef.current.delete(archiveListingsRef.current.keys().next().value!);
        }
      }
    }
    return {
      ok: true as const,
      data: archiveListingToDirectoryListing({
        panelId,
        virtualPath,
        archiveListing: listing,
        showHidden,
        sort,
        filter,
      }),
    };
  };

  const refreshPanel = (panelId: PanelId, background = false) => {
    const panel = panelStateRef.current[panelId];
    if (background && panel.loading) return;
    void listPanel(panelId, panel.path, {
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
      persistSession: false,
      background,
      forceArchiveReload: true,
    });
  };

  const refreshPanelAfterSourceInvalid = (panelId: PanelId, status: string) => {
    const panel = panelState[panelId];
    void listPanel(panelId, panel.path, {
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
      statusAfterSuccess: status,
      persistSession: false,
      forceArchiveReload: true,
    }).then(() => {
      runtime.shellRef.current?.focus({ preventScroll: true });
    });
  };

  const navigateUp = (panelId: PanelId) => {
    const panel = panelState[panelId];
    if (isArchiveVirtualPath(panel.path)) {
      const targetPath = archiveParentPath(panel.path);
      void listPanel(panelId, targetPath, {
        pushHistory: targetPath !== panel.path,
        focusPath: archiveParentFocusPath(panel.path),
      });
      return;
    }
    const parentEntry = parentNavigationEntryOf(panel);
    const targetPath = parentEntry?.path ?? parentPathOf(panel.path);
    void listPanel(panelId, targetPath, {
      pushHistory: targetPath !== panel.path,
      focusPath: panel.path,
    });
  };

  const navigateBack = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const targetPath = panel.historyBack.at(-1);
    if (!targetPath) {
      runtime.setStatusMessage(runtime.statusText.noBackHistory);
      return;
    }
    void listPanel(panelId, targetPath, {
      replaceBack: panel.historyBack.slice(0, -1),
      replaceForward: [panel.path, ...panel.historyForward],
    });
  };

  const navigateForward = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const targetPath = panel.historyForward[0];
    if (!targetPath) {
      runtime.setStatusMessage(runtime.statusText.noForwardHistory);
      return;
    }
    void listPanel(panelId, targetPath, {
      replaceBack: [...panel.historyBack, panel.path],
      replaceForward: panel.historyForward.slice(1),
    });
  };

  const applySort = (panelId: PanelId, sort: SortSpec) => {
    const panel = panelState[panelId];
    void listPanel(panelId, panel.path, {
      sort,
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
    });
  };

  const toggleFocusedSelection = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const focusedEntry = focusedEntryOf(panel);
    if (!focusedEntry) {
      return;
    }

    if (focusedEntry.isVirtual) {
      focusEntry(panelId, panel.focusedIndex + 1);
      runtime.setStatusMessage(runtime.statusText.virtualEntryNotSelectable);
      return;
    }

    setActivePanel(panelId);
    setPanelState((current) => {
      const selectedPaths = current[panelId].selectedPaths.includes(focusedEntry.path)
        ? current[panelId].selectedPaths.filter((path) => path !== focusedEntry.path)
        : [...current[panelId].selectedPaths, focusedEntry.path];
      const focusedIndex = clampFocusedIndex(current[panelId].focusedIndex + 1, current[panelId].listing.entries.length);
      selectionAnchorRef.current[panelId] = focusedIndex;

      return {
        ...current,
        [panelId]: {
          ...current[panelId],
          selectedPaths,
          focusedIndex,
        },
      };
    });
  };

  const selectAllEntries = (panelId: PanelId) => {
    updatePanel(panelId, {
      selectedPaths: panelState[panelId].listing.entries
        .filter((entry) => !entry.isVirtual)
        .map((entry) => entry.path),
    });
  };

  const clearSelection = (panelId: PanelId) => {
    updatePanel(panelId, { selectedPaths: [] });
  };

  const invertSelection = (panelId: PanelId) => {
    const concretePaths = panelState[panelId].listing.entries
      .filter((entry) => !entry.isVirtual)
      .map((entry) => entry.path);
    const currentSelection = new Set(panelState[panelId].selectedPaths);
    updatePanel(panelId, {
      selectedPaths: concretePaths.filter((path) => !currentSelection.has(path)),
    });
  };

  const persistSessionPaths = (nextPanelId: PanelId, nextPath: string) => {
    const nextSession: Settings['session'] = {
      ...runtime.settingsRef.current.session,
      leftPath: nextPanelId === 'left' ? nextPath : runtime.settingsRef.current.session.leftPath ?? panelStateRef.current.left.path,
      rightPath: nextPanelId === 'right' ? nextPath : runtime.settingsRef.current.session.rightPath ?? panelStateRef.current.right.path,
      activePanel: nextPanelId,
    };
    void runtime.saveSettingsPatch({ session: nextSession }, null, { silent: true });
  };

  const selectEntry = (panelId: PanelId, index: number, entry: FileEntry, mode: SelectionMode) => {
    setActivePanel(panelId);
    setPanelState((current) => {
      const panel = current[panelId];
      if (entry.isVirtual) {
        selectionAnchorRef.current[panelId] = index;
        return {
          ...current,
          [panelId]: {
            ...panel,
            focusedIndex: index,
          },
        };
      }

      const selected = panel.selectedPaths;
      const anchor = selectionAnchorRef.current[panelId] ?? panel.focusedIndex;
      const selectedPaths = mode === 'range'
        ? selectedPathsInRange(panel.listing.entries, anchor, index)
        : mode === 'additive'
          ? selected.includes(entry.path)
            ? selected.filter((path) => path !== entry.path)
            : [...selected, entry.path]
          : [entry.path];
      selectionAnchorRef.current[panelId] = mode === 'range' ? anchor : index;

      return {
        ...current,
        [panelId]: {
          ...panel,
          focusedIndex: index,
          selectedPaths,
        },
      };
    });
  };

  useEffect(() => {
    if (!runtime.dataSource.loadInitialOnMount || !runtime.settingsLoaded || initialPanelLoadStartedRef.current) {
      return undefined;
    }
    initialPanelLoadStartedRef.current = true;

    let cancelled = false;
    setPanelState((current) => ({
      left: markPanelLoading(current.left),
      right: markPanelLoading(current.right),
    }));

    const restoreLeft = runtime.settings.session.leftPath;
    const restoreRight = runtime.settings.session.rightPath;
    const initialRequest: Promise<PanelInitialLoadResult> = restoreLeft || restoreRight
      ? Promise.all(PANEL_IDS.map((panelId) => runtime.dataSource.listDir({
        panelId,
        path: (panelId === 'left' ? restoreLeft : restoreRight) ?? runtime.dataSource.initialListings[panelId].path,
        showHidden: false,
        sort: runtime.dataSource.initialListings[panelId].sort ?? DEFAULT_SORT,
        filter: null,
      }))).then(([left, right]) => ({ left, right }))
      : runtime.dataSource.loadInitialListings();

    const requestIds: Record<PanelId, number> = {
      left: beginPanelRequest('left'),
      right: beginPanelRequest('right'),
    };

    void initialRequest.then((results) => {
      if (cancelled) {
        return;
      }
      setPanelState((current) => {
        const next = { ...current };
        for (const panelId of PANEL_IDS) {
          if (!isCurrentPanelRequest(panelId, requestIds[panelId])) {
            continue;
          }
          const result = results[panelId];
          const panel = current[panelId];
          next[panelId] = result.ok
            ? {
              ...replacePanelListing(panel, result.data, {
                preserveSelection: true,
                preserveFocusPath: focusedEntryOf(panel)?.path,
              }),
              showHidden: panel.showHidden,
            }
            : markPanelError(panel, result.error);
        }
        return next;
      });
    });

    return () => {
      cancelled = true;
      initialPanelLoadStartedRef.current = false;
    };
  }, [runtime.dataSource, runtime.settingsLoaded]);

  const addTab = (panelId: PanelId) => {
    const panel = panelState[panelId];

    if (panelTabs[panelId].length >= 5) {
      runtime.setStatusMessage(runtime.settings.language === 'ko' ? '패널당 탭은 최대 5개입니다.' : 'Each panel supports up to 5 tabs.');
      return;
    }
    beginPanelRequest(panelId);
    const snapshot = { ...panel, loading: false };
    setPanelTabs((current) => ({
      ...current, [panelId]: [
        ...current[panelId].map((tab, index) => index === activeTab[panelId] ? snapshot : tab), snapshot,
      ]
    }));
    setActiveTab((current) => ({ ...current, [panelId]: panelTabs[panelId].length }));
    setPanelState((current) => ({ ...current, [panelId]: snapshot }));
    runtime.setStatusMessage(runtime.statusText.tabAdded(panelIdLabel(panelId, runtime.settings.language), shortenPath(panel.path)));
    return;

  };

  const closeTab = (panelId: PanelId) => {
    const panel = panelState[panelId];

    if (panelTabs[panelId].length <= 1) return;
    beginPanelRequest(panelId);
    const remaining = panelTabs[panelId].filter((_, index) => index !== activeTab[panelId]);
    const nextIndex = Math.min(activeTab[panelId], remaining.length - 1);
    const restored = reassignPanelState({ ...remaining[nextIndex], loading: false }, panelId);
    setPanelTabs((current) => ({ ...current, [panelId]: remaining }));
    setActiveTab((current) => ({ ...current, [panelId]: nextIndex }));
    setPanelState((current) => ({ ...current, [panelId]: restored }));
    selectionAnchorRef.current[panelId] = null;
    runtime.setDirectoryComparison(null);
    if (!isArchiveVirtualPath(restored.path)) persistSessionPaths(panelId, restored.path);
    runtime.setStatusMessage(runtime.statusText.tabClosed(panelIdLabel(panelId, runtime.settings.language)));
    return;

  };

  const swapPanelPaths = (panelId: PanelId) => {
    const panel = panelState[panelId];

    runtime.setDirectoryComparison(null);
    setPanelState((current) => ({
      left: reassignPanelState(current.right, 'left'),
      right: reassignPanelState(current.left, 'right'),
    }));
    beginPanelRequest('left');
    beginPanelRequest('right');
    setPanelTabs((current) => ({
      left: current.right.map((tab) => reassignPanelState(tab, 'left')),
      right: current.left.map((tab) => reassignPanelState(tab, 'right')),
    }));
    setActiveTab((current) => ({ left: current.right, right: current.left }));
    void runtime.saveSettingsPatch({
      session: {
        ...runtime.settings.session,
        leftPath: panelState.right.path,
        rightPath: panelState.left.path,
        activePanel,
      },
    }, null, { silent: true });
    runtime.setStatusMessage(runtime.settings.language === 'ko' ? '좌우 패널 경로를 맞바꿨습니다.' : 'Swapped panel paths.');
    return;

  };

  const activateTab = (panelId: PanelId, index: number) => {
    const saved = panelTabs[panelId][index];
    if (!saved || index === activeTab[panelId]) return;
    beginPanelRequest(panelId);
    const outgoing = { ...panelStateRef.current[panelId], loading: false };
    setPanelTabs((current) => ({
      ...current, [panelId]: current[panelId].map((tab, tabIndex) =>
        tabIndex === activeTab[panelId] ? outgoing : tab)
    }));
    setPanelState((current) => ({ ...current, [panelId]: reassignPanelState({ ...saved, loading: false }, panelId) }));
    setActiveTab((current) => ({ ...current, [panelId]: index }));
    setActivePanel(panelId);
    selectionAnchorRef.current[panelId] = null;
    runtime.setDirectoryComparison(null);
    if (!isArchiveVirtualPath(saved.path)) persistSessionPaths(panelId, saved.path);
    runtime.shellRef.current?.focus({ preventScroll: true });

  };

  const clearCompletedSelection = (panelId: PanelId, sourcePath: string) => {
    if (panelStateRef.current[panelId].path !== sourcePath) return;
    selectionAnchorRef.current[panelId] = null;
    setPanelState((current) => ({ ...current, [panelId]: { ...current[panelId], selectedPaths: [] } }));
  };
  return { activateTab, clearCompletedSelection, addTab, closeTab, swapPanelPaths, moveFocusedEntry, focusBoundaryEntry, setActivePanel, panelState, panelTabs, activeTab, panelStateRef, gotoPanelPath, navigateUp, listPanel, activePanel, switchActivePanel, navigateBack, navigateForward, refreshPanel, focusEntry, toggleFocusedSelection, selectAllEntries, clearSelection, invertSelection, applySort, refreshPanelAfterSourceInvalid, archivePasswordsRef, recordFocusedRow, selectEntry, archiveListingsRef };
}

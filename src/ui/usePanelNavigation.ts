import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import type { ArchiveListing, FileEntry, PanelId, SavedTab, Settings, SortSpec } from '../domain/types';
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
  createPanelStateFromListing,
  createDirectoryListing,
  focusedEntryOf,
  markPanelError,
  markPanelLoading,
  MAX_PANEL_TABS,
  parentNavigationEntryOf,
  parentPathOf,
  replacePanelListing,
  restorePanelAfterFailedNavigation,
  type PanelNavigationState,
  type PanelStateById
} from './panelState';
import { PanelUiPatch, SelectionMode, oppositePanelOf, reassignPanelState, selectedPathsInRange } from './selectionModel';
import { shortenPath } from './textLayout';
import { sessionFromPanels } from './sessionState';

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
  const [sessionReady, setSessionReady] = useState(() => !runtime.dataSource.loadInitialOnMount);
  const lastSavedSessionRef = useRef<string | null>(null);

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
      return undefined;
    }
    if (!result.ok) {
      setPanelState((current) => ({
        ...current,
        [panelId]: {
          ...restorePanelAfterFailedNavigation(current[panelId]),
          sort: requestPanel.sort,
          filter: requestPanel.filter,
          showHidden: requestPanel.showHidden,
        },
      }));
      runtime.setStatusMessage(runtime.statusText.listFailed(formatUserErrorMessage(runtime.settings.language, result.error)));
      if (!options.background && !commanderKeyboardHasOwner()) runtime.shellRef.current?.focus({ preventScroll: true });
      return result.error;
    }

    runtime.setDirectoryComparison(null);
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
    if (!options.background && !commanderKeyboardHasOwner()) runtime.shellRef.current?.focus({ preventScroll: true });
    return null;
  };

  const gotoPanelPath = async (panelId: PanelId, path: string) => {
    if (isArchiveVirtualPath(path)) {
      return listPanel(panelId, path, { pushHistory: true, focusFallback: 'first-concrete' });
    }
    const requestId = beginPanelRequest(panelId);
    setActivePanel(panelId);
    setPanelState((current) => ({ ...current, [panelId]: markPanelLoading(current[panelId]) }));
    const result = await runtime.dataSource.gotoPath({ panelId, path });
    if (!isCurrentPanelRequest(panelId, requestId)) {
      return undefined;
    }
    if (!result.ok) {
      setPanelState((current) => ({ ...current, [panelId]: restorePanelAfterFailedNavigation(current[panelId]) }));
      runtime.setStatusMessage(runtime.statusText.gotoFailed(formatUserErrorMessage(runtime.settings.language, result.error)));
      return result.error;
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
    if (!commanderKeyboardHasOwner()) runtime.shellRef.current?.focus({ preventScroll: true });
    return null;
  };

  const cancelPanelNavigation = (panelId: PanelId) => {
    beginPanelRequest(panelId);
    setPanelState((current) => ({ ...current, [panelId]: restorePanelAfterFailedNavigation(current[panelId]) }));
  };

  const listArchiveVirtualPanel = async (
    panelId: PanelId,
    virtualPath: string,
    showHidden: boolean,
    sort: SortSpec,
    filter: string | null,
    forceReload = false,
    requestPassword = true,
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
        if (requestPassword && (result.error.code === 'password_required' || result.error.code === 'invalid_password')) {
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

    const savedSession = runtime.settings.session;
    const requestIds: Record<PanelId, number> = {
      left: beginPanelRequest('left'), right: beginPanelRequest('right'),
    };
    const unavailable: string[] = [];
    let locations: ReturnType<PanelDataSource['listLocations']> | undefined;
    const restoreTab = async (panelId: PanelId, tab: SavedTab) => {
      const load = (path: string) => isArchiveVirtualPath(path)
        ? listArchiveVirtualPanel(panelId, path, tab.showHidden, tab.sort, tab.filter, false, false)
        : runtime.dataSource.listDir({ panelId, path, showHidden: tab.showHidden, sort: tab.sort, filter: tab.filter });
      let result = await load(tab.path);
      if (!result.ok) {
        unavailable.push(tab.path);
        // 암호를 저장하지 않으며 잠긴 압축 탭은 유지하여 사용자가 다시 열 수 있도록 표시.
        if (result.error.code !== 'password_required' && result.error.code !== 'invalid_password') {
          locations ??= runtime.dataSource.listLocations();
          const fallback = await locations;
          if (fallback.ok) result = await load(fallback.data.home);
        }
      }
      return createPanelStateFromListing(result.ok ? result.data : createDirectoryListing(panelId, tab.path), {
        ...tab, error: result.ok ? null : result.error,
      });
    };
    const restore = async () => {
      let restored: Record<PanelId, PanelNavigationState[]>;
      const indices = { left: 0, right: 0 };
      if (savedSession.tabs) {
        const savedTabs = savedSession.tabs;
        const [left, right] = await Promise.all(PANEL_IDS.map((panelId) =>
          Promise.all(savedTabs[panelId].items.map((tab) => restoreTab(panelId, tab)))));
        restored = { left, right };
        indices.left = savedTabs.left.activeIndex;
        indices.right = savedTabs.right.activeIndex;
      } else {
        const restoreLeft = savedSession.leftPath, restoreRight = savedSession.rightPath;
        const initialRequest: Promise<PanelInitialLoadResult> = restoreLeft || restoreRight
          ? Promise.all(PANEL_IDS.map((panelId) => runtime.dataSource.listDir({
            panelId, path: (panelId === 'left' ? restoreLeft : restoreRight) ?? runtime.dataSource.initialListings[panelId].path,
            showHidden: false, sort: runtime.dataSource.initialListings[panelId].sort ?? DEFAULT_SORT, filter: null,
          }))).then(([left, right]) => ({ left, right }))
          : runtime.dataSource.loadInitialListings();
        const results = await initialRequest;
        const panels = await Promise.all(PANEL_IDS.map(async (panelId) => {
          const result = results[panelId];
          if (!result.ok && (restoreLeft || restoreRight)) return restoreTab(panelId, {
            path: (panelId === 'left' ? restoreLeft : restoreRight) ?? runtime.dataSource.initialListings[panelId].path,
            sort: DEFAULT_SORT, filter: null, showHidden: false, historyBack: [], historyForward: [],
          });
          return result.ok ? replacePanelListing(panelStateRef.current[panelId], result.data, {
            preserveSelection: true, preserveFocusPath: focusedEntryOf(panelStateRef.current[panelId])?.path,
          }) : markPanelError(panelStateRef.current[panelId], result.error);
        }));
        restored = { left: [panels[0]], right: [panels[1]] };
      }
      if (cancelled) return;
      setPanelState((current) => ({
        left: isCurrentPanelRequest('left', requestIds.left) ? restored.left[indices.left] : current.left,
        right: isCurrentPanelRequest('right', requestIds.right) ? restored.right[indices.right] : current.right,
      }));
      setPanelTabs((current) => ({
        left: isCurrentPanelRequest('left', requestIds.left) ? restored.left : current.left,
        right: isCurrentPanelRequest('right', requestIds.right) ? restored.right : current.right,
      }));
      setActiveTab((current) => ({
        left: isCurrentPanelRequest('left', requestIds.left) ? indices.left : current.left,
        right: isCurrentPanelRequest('right', requestIds.right) ? indices.right : current.right,
      }));
      if (unavailable.length) runtime.setStatusMessage(runtime.statusText.sessionRestoreUnavailable(unavailable));
      setSessionReady(true);
    };
    void restore();

    return () => {
      cancelled = true;
      initialPanelLoadStartedRef.current = false;
    };
  }, [runtime.dataSource, runtime.settingsLoaded]);

  const sessionSnapshot = JSON.stringify(sessionFromPanels(panelState, panelTabs, activeTab, activePanel));
  useEffect(() => {
    if (!runtime.settingsLoaded || !sessionReady || panelState.left.loading || panelState.right.loading) return;
    if (lastSavedSessionRef.current === sessionSnapshot) return;
    const firstSnapshot = lastSavedSessionRef.current === null;
    lastSavedSessionRef.current = sessionSnapshot;
    if (!firstSnapshot) void runtime.saveSettingsPatch({ session: JSON.parse(sessionSnapshot) }, null, { silent: true });
  }, [sessionSnapshot, sessionReady, runtime.settingsLoaded, panelState.left.loading, panelState.right.loading]);

  const addTab = (panelId: PanelId) => {
    const panel = panelState[panelId];

    if (panelTabs[panelId].length >= MAX_PANEL_TABS) {
      runtime.setStatusMessage(runtime.statusText.tabLimit(MAX_PANEL_TABS));
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

  const closeTab = (panelId: PanelId, tabIndex = activeTab[panelId]) => {
    const tabs = panelTabs[panelId];
    if (tabs.length <= 1 || tabIndex < 0 || tabIndex >= tabs.length) return;

    const remaining = tabs.filter((_, index) => index !== tabIndex);
    if (tabIndex !== activeTab[panelId]) {
      setPanelTabs((current) => ({ ...current, [panelId]: remaining }));
      if (tabIndex < activeTab[panelId]) {
        setActiveTab((current) => ({ ...current, [panelId]: current[panelId] - 1 }));
      }
      runtime.setStatusMessage(runtime.statusText.tabClosed(panelIdLabel(panelId, runtime.settings.language)));
      return;
    }

    beginPanelRequest(panelId);
    const nextIndex = Math.min(tabIndex, remaining.length - 1);
    const restored = reassignPanelState({ ...remaining[nextIndex], loading: false }, panelId);
    setPanelTabs((current) => ({ ...current, [panelId]: remaining }));
    setActiveTab((current) => ({ ...current, [panelId]: nextIndex }));
    setPanelState((current) => ({ ...current, [panelId]: restored }));
    selectionAnchorRef.current[panelId] = null;
    runtime.setDirectoryComparison(null);
    runtime.setStatusMessage(runtime.statusText.tabClosed(panelIdLabel(panelId, runtime.settings.language)));
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
    runtime.setStatusMessage(runtime.statusText.panelsSwapped);
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
    runtime.shellRef.current?.focus({ preventScroll: true });

  };

  // 암호 입력 뒤 압축 목록 다시 읽기. 캐시된 목록은 암호 없이 읽은 결과라 폐기.
  const retryArchiveListing = (panelId: PanelId, archivePath: string, virtualPath: string, password: string) => {
    archivePasswordsRef.current.set(archivePath, password);
    archiveListingsRef.current.delete(archivePath);
    void listPanel(panelId, virtualPath, { preserveSelection: true });
  };
  const archivePasswordFor = (archivePath: string) => archivePasswordsRef.current.get(archivePath);

  const clearCompletedSelection = (panelId: PanelId, sourcePath: string) => {
    if (panelStateRef.current[panelId].path !== sourcePath) return;
    selectionAnchorRef.current[panelId] = null;
    setPanelState((current) => ({ ...current, [panelId]: { ...current[panelId], selectedPaths: [] } }));
  };
  return { activateTab, clearCompletedSelection, addTab, closeTab, swapPanelPaths, moveFocusedEntry, focusBoundaryEntry, setActivePanel, panelState, panelTabs, activeTab, panelStateRef, gotoPanelPath, cancelPanelNavigation, navigateUp, listPanel, activePanel, switchActivePanel, navigateBack, navigateForward, refreshPanel, focusEntry, toggleFocusedSelection, selectAllEntries, clearSelection, invertSelection, applySort, refreshPanelAfterSourceInvalid, archivePasswordFor, retryArchiveListing, recordFocusedRow, selectEntry };
}

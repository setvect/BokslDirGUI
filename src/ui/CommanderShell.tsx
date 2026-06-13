import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Popover from '@radix-ui/react-popover';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ACTIONS,
  ariaKeyShortcutsFromRegistry,
  actionsForMenu,
  hotkeyStripActionsFromRegistry,
  isActionAvailable,
  labelForAction,
  matchKeyboardShortcut,
  menuRootsFromRegistry,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
  type AppAction,
} from '../actions/registry';
import type { DirectoryListing, FileEntry, PanelId, SortSpec } from '../domain/types';
import { OperationDialogHost } from '../operations/OperationDialogHost';
import { dialogKindForAction, useOperationStore, type AtomicCommandExecutor, type LongRunningOperationExecutor } from '../operations/operationStore';
import { tauriClient } from '../tauri/client';
import { actionNeedsConcreteSources, createActionContext, filterEnabledActions } from './actionContext';
import { createTauriPanelDataSource, type PanelDataSource } from './panelDataSource';
import {
  clampFocusedIndex,
  createPanelStates,
  focusedEntryOf,
  markPanelError,
  markPanelLoading,
  panelCanGoBack,
  panelCanGoForward,
  PANEL_IDS,
  parentNavigationEntryOf,
  parentPathOf,
  replacePanelListing,
  selectedConcreteEntriesOf,
  type PanelNavigationState,
  type PanelStateById,
} from './panelState';
import { entryIcon, formatModified, formatSize, summarizeEntries } from './format';
import {
  commanderKeyboardIsSuspended,
  useCommanderKeyboardBoundaryProps,
} from './keyboardOwnership';

const KEYBOARD_PAGE_STEP = 12;
const FOCUSABLE_ROW_TAB_INDEX = -1;
const KEYBOARD_SEQUENCE_TIMEOUT_MS = 900;
const DEFAULT_DATA_SOURCE = createTauriPanelDataSource();

type PanelUiPatch = Partial<Pick<PanelNavigationState, 'focusedIndex' | 'selectedPaths'>>;

interface CommanderShellProps {
  dataSource?: PanelDataSource;
  mutationClient?: SafeMutationClient;
  operationClient?: LongRunningOperationClient;
  initialFocusIndex?: Partial<Record<PanelId, number>>;
  initialSelectedPaths?: Partial<Record<PanelId, string[]>>;
}

interface SafeMutationClient {
  createDir(input: { parent: string; name: string }): ReturnType<typeof tauriClient.createDir>;
  renameEntry(input: { path: string; newName: string }): ReturnType<typeof tauriClient.renameEntry>;
}

interface LongRunningOperationClient {
  startCopy(input: { sources: string[]; targetDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.startCopy>;
  startMove(input: { sources: string[]; targetDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.startMove>;
  startDelete(input: { targets: string[]; mode: 'trash' | 'permanent'; confirmToken?: string }): ReturnType<typeof tauriClient.startDelete>;
  cancelOperation(input: { operationId: string }): ReturnType<typeof tauriClient.cancelOperation>;
  resolveConflict(input: { operationId: string; decision: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.resolveConflict>;
}

interface KeyboardRuntime {
  context: ActionContext;
  operationDialogOpen: boolean;
  moveFocusedEntry(delta: number): void;
  focusBoundaryEntry(boundary: 'first' | 'last'): void;
  handleAction(action: AppAction): void;
}

interface ListPanelOptions {
  pushHistory?: boolean;
  replaceBack?: string[];
  replaceForward?: string[];
  preserveSelection?: boolean;
  preserveFocusPath?: string | null;
  focusPath?: string | null;
  sort?: SortSpec;
  filter?: string | null;
  showHidden?: boolean;
}

export function CommanderShell({
  dataSource = DEFAULT_DATA_SOURCE,
  mutationClient = tauriClient,
  operationClient = tauriClient,
  initialFocusIndex,
  initialSelectedPaths,
}: CommanderShellProps) {
  const openOperationDialog = useOperationStore((state) => state.openDialog);
  const operationDialogOpen = useOperationStore((state) => Boolean(state.dialog));
  const shellRef = useRef<HTMLElement>(null);
  const shortcutSequenceRef = useRef<readonly string[]>([]);
  const shortcutSequenceTimeoutRef = useRef<number | null>(null);
  const keyboardRuntimeRef = useRef<KeyboardRuntime | null>(null);
  const navigationRequestRef = useRef<Record<PanelId, number>>({ left: 0, right: 0 });
  const [activePanel, setActivePanel] = useState<PanelId>('right');
  const [panelState, setPanelState] = useState<PanelStateById>(() => createPanelStates(dataSource.initialListings, {
    left: {
      focusedIndex: initialFocusIndex?.left,
      selectedPaths: initialSelectedPaths?.left,
    },
    right: {
      focusedIndex: initialFocusIndex?.right,
      selectedPaths: initialSelectedPaths?.right,
    },
  }));
  const [overlayMessage, setOverlayMessage] = useState<string | null>(null);
  const [filterPromptPanel, setFilterPromptPanel] = useState<PanelId | null>(null);

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

  const focusEntry = (panelId: PanelId, index: number) => {
    const entryCount = panelState[panelId].listing.entries.length;
    const focusedIndex = clampFocusedIndex(index, entryCount);
    setActivePanel(panelId);
    updatePanel(panelId, { focusedIndex });
  };

  const moveFocusedEntry = (delta: number) => {
    focusEntry(activePanel, panelState[activePanel].focusedIndex + delta);
  };

  const focusBoundaryEntry = (boundary: 'first' | 'last') => {
    const entryCount = panelState[activePanel].listing.entries.length;
    focusEntry(activePanel, boundary === 'first' ? 0 : entryCount - 1);
  };

  const switchActivePanel = () => {
    const nextPanel = oppositePanelOf(activePanel);
    setActivePanel(nextPanel);
    setOverlayMessage(`활성 패널 전환: ${nextPanel.toUpperCase()}`);
  };

  const beginPanelRequest = (panelId: PanelId) => {
    navigationRequestRef.current[panelId] += 1;
    return navigationRequestRef.current[panelId];
  };

  const isCurrentPanelRequest = (panelId: PanelId, requestId: number) =>
    navigationRequestRef.current[panelId] === requestId;

  const listPanel = async (panelId: PanelId, path: string, options: ListPanelOptions = {}) => {
    const requestId = beginPanelRequest(panelId);
    const requestPanel = panelState[panelId];
    const sort = options.sort ?? requestPanel.sort;
    const filter = Object.hasOwn(options, 'filter') ? options.filter ?? null : requestPanel.filter;
    const showHidden = options.showHidden ?? requestPanel.showHidden;

    setActivePanel(panelId);
    setPanelState((current) => ({
      ...current,
      [panelId]: {
        ...markPanelLoading(current[panelId]),
        sort,
        filter,
        showHidden,
      },
    }));

    const result = await dataSource.listDir({ panelId, path, showHidden, sort, filter });
    if (!isCurrentPanelRequest(panelId, requestId)) {
      return;
    }
    if (!result.ok) {
      setPanelState((current) => ({
        ...current,
        [panelId]: markPanelError(current[panelId], result.error),
      }));
      setOverlayMessage(`목록 읽기 실패: ${result.error.messageKey}${result.error.path ? ` · ${result.error.path}` : ''}`);
      shellRef.current?.focus({ preventScroll: true });
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
        }),
        showHidden,
      },
    }));
    setOverlayMessage(null);
    shellRef.current?.focus({ preventScroll: true });
  };

  const gotoPanelPath = async (panelId: PanelId, path: string) => {
    const requestId = beginPanelRequest(panelId);
    setActivePanel(panelId);
    setPanelState((current) => ({ ...current, [panelId]: markPanelLoading(current[panelId]) }));
    const result = await dataSource.gotoPath({ panelId, path });
    if (!isCurrentPanelRequest(panelId, requestId)) {
      return;
    }
    if (!result.ok) {
      setPanelState((current) => ({ ...current, [panelId]: markPanelError(current[panelId], result.error) }));
      setOverlayMessage(`직접 이동 실패: ${result.error.messageKey}`);
      return;
    }
    setPanelState((current) => ({
      ...current,
      [panelId]: {
        ...replacePanelListing(current[panelId], result.data, { pushHistory: true }),
        showHidden: false,
      },
    }));
    setOverlayMessage(`Path · goto_path · ${result.data.path}`);
  };

  const refreshPanel = (panelId: PanelId) => {
    const panel = panelState[panelId];
    void listPanel(panelId, panel.path, {
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
    });
  };

  const navigateUp = (panelId: PanelId) => {
    const panel = panelState[panelId];
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
      setOverlayMessage('뒤로 이동할 history가 없습니다.');
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
      setOverlayMessage('앞으로 이동할 history가 없습니다.');
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
    if (!focusedEntry || focusedEntry.isVirtual) {
      setOverlayMessage('가상 항목은 선택 대상으로 표시하지 않습니다.');
      return;
    }

    setActivePanel(panelId);
    setPanelState((current) => {
      const selectedPaths = current[panelId].selectedPaths.includes(focusedEntry.path)
        ? current[panelId].selectedPaths.filter((path) => path !== focusedEntry.path)
        : [...current[panelId].selectedPaths, focusedEntry.path];

      return {
        ...current,
        [panelId]: {
          ...current[panelId],
          selectedPaths,
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

  const selectEntry = (panelId: PanelId, index: number, entry: FileEntry, additive: boolean) => {
    setActivePanel(panelId);
    setPanelState((current) => {
      const panel = current[panelId];
      if (entry.isVirtual) {
        return {
          ...current,
          [panelId]: {
            ...panel,
            focusedIndex: index,
          },
        };
      }

      const selected = panel.selectedPaths;
      const selectedPaths = additive
        ? selected.includes(entry.path)
          ? selected.filter((path) => path !== entry.path)
          : [...selected, entry.path]
        : [entry.path];

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

  const openEntry = (panelId: PanelId, entry: FileEntry) => {
    setActivePanel(panelId);
    if (entry.kind === 'directory') {
      void listPanel(panelId, entry.path, {
        pushHistory: true,
        preserveSelection: false,
      });
      return;
    }

    setOverlayMessage(`기본 앱 열기 예정: ${entry.name} · open_default 확인 대기`);
  };

  const handleAction = (action: AppAction, panelOverride = activePanel, sourceOverride?: FileEntry[]) => {
    const actionId = action.id as ActionId;
    if (actionId === 'panel.switchActive') {
      switchActivePanel();
      return;
    }

    const panel = panelState[panelOverride];
    const panelListing = panel.listing;
    const oppositePanel = oppositePanelOf(panelOverride);
    const focusedEntry = focusedEntryOf(panel);
    const selectedEntries = selectedConcreteEntriesOf(panel);
    const focusedConcreteSource = focusedEntry && !focusedEntry.isVirtual ? [focusedEntry] : [];
    const sources = (sourceOverride ?? (selectedEntries.length > 0 ? selectedEntries : focusedConcreteSource)).filter(
      (entry) => !entry.isVirtual,
    );

    const actionTargetEntry = sourceOverride?.[0] ?? focusedEntry;
    if (actionId === 'nav.enter' && actionTargetEntry) {
      openEntry(panelOverride, actionTargetEntry);
      return;
    }

    if (actionId === 'nav.up') {
      navigateUp(panelOverride);
      return;
    }

    if (actionId === 'nav.back') {
      navigateBack(panelOverride);
      return;
    }

    if (actionId === 'nav.forward') {
      navigateForward(panelOverride);
      return;
    }

    if (actionId === 'nav.refresh') {
      refreshPanel(panelOverride);
      return;
    }

    if (actionId === 'nav.gotoPath') {
      setOverlayMessage('Path · goto_path · 주소 입력 UI 연결 대기');
      return;
    }

    if (actionId === 'nav.locations') {
      setOverlayMessage('Locations · list_locations · 위치 팔레트 연결 대기');
      return;
    }

    if (actionId === 'selection.toggle') {
      toggleFocusedSelection(panelOverride);
      return;
    }

    if (actionId === 'selection.all') {
      selectAllEntries(panelOverride);
      setOverlayMessage(`${labelForAction(action)} · ${panelOverride.toUpperCase()}`);
      return;
    }

    if (actionId === 'selection.clear') {
      clearSelection(panelOverride);
      setOverlayMessage(`${labelForAction(action)} · ${panelOverride.toUpperCase()}`);
      return;
    }

    if (actionId === 'selection.invert') {
      invertSelection(panelOverride);
      setOverlayMessage(`${labelForAction(action)} · ${panelOverride.toUpperCase()}`);
      return;
    }

    if (actionId === 'view.sortName' || actionId === 'view.sortSize' || actionId === 'view.sortDate' || actionId === 'view.sortExt') {
      applySort(panelOverride, { ...panel.sort, field: sortFieldForAction(actionId), direction: 'asc' });
      return;
    }

    if (actionId === 'view.reverseSort') {
      applySort(panelOverride, {
        ...panel.sort,
        direction: panel.sort.direction === 'asc' ? 'desc' : 'asc',
      });
      return;
    }

    if (actionId === 'filter.start') {
      setFilterPromptPanel(panelOverride);
      setOverlayMessage(null);
      return;
    }

    if (actionId === 'filter.clear') {
      void listPanel(panelOverride, panel.path, {
        filter: null,
        preserveSelection: true,
        preserveFocusPath: focusedEntry?.path,
      });
      return;
    }

    if (actionId === 'view.toggleHidden') {
      void listPanel(panelOverride, panel.path, {
        showHidden: !panel.showHidden,
        preserveSelection: true,
        preserveFocusPath: focusedEntry?.path,
      });
      return;
    }

    if (dialogKindForAction(actionId)) {
      if (actionNeedsConcreteSources(actionId) && sources.length === 0) {
        setOverlayMessage(`${labelForAction(action)} · 가상 항목은 파일 작업 대상이 될 수 없습니다.`);
        return;
      }

      openOperationDialog({
        action,
        panelId: panelOverride,
        sources,
        targetDir: panelState[oppositePanel].path,
        workingDir: panelListing.path,
        atomicExecutor: atomicExecutorForAction(actionId, mutationClient),
        longRunningExecutor: longRunningExecutorForAction(actionId, operationClient),
        cancelExecutor: (operationId) => operationClient.cancelOperation({ operationId }),
        conflictResolver: (operationId, decision) => operationClient.resolveConflict({ operationId, decision }),
        onAtomicSuccess: (entry) => {
          void listPanel(panelOverride, panelListing.path, {
            preserveSelection: false,
            focusPath: entry.path,
          });
          setOverlayMessage(`${labelForAction(action)} 완료: ${entry.name}`);
        },
        onOperationSummary: (summary) => {
          if (summary.state === 'completed' || summary.state === 'completedWithErrors') {
            refreshPanel(panelOverride);
            refreshPanel(oppositePanel);
          }
          setOverlayMessage(`${labelForAction(action)} 완료 상태: ${summary.state}`);
        },
      });
      return;
    }

    setOverlayMessage(`${labelForAction(action)} · ${action.runPath}`);
  };

  const applyFilter = (panelId: PanelId, filterValue: string) => {
    const panel = panelState[panelId];
    const filter = filterValue.trim() || null;
    setFilterPromptPanel(null);
    void listPanel(panelId, panel.path, {
      filter,
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
    });
  };

  const cancelFilter = () => {
    setFilterPromptPanel(null);
    shellRef.current?.focus({ preventScroll: true });
  };

  const activeListing = panelState[activePanel].listing;
  const activeFocusedEntry = focusedEntryOf(panelState[activePanel]);
  const activeSelectedCount = selectedConcreteEntriesOf(panelState[activePanel]).length;
  const context = createActionContext({
    activePanel,
    focusedEntry: activeFocusedEntry,
    selectedCount: activeSelectedCount,
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy: panelState.left.loading || panelState.right.loading,
  });
  const activeRowDomId = rowDomId(activePanel, panelState[activePanel].focusedIndex);
  const ariaKeyShortcuts = ariaKeyShortcutsFromRegistry();
  keyboardRuntimeRef.current = {
    context,
    operationDialogOpen,
    moveFocusedEntry,
    focusBoundaryEntry,
    handleAction,
  };

  useEffect(() => {
    if (!dataSource.loadInitialOnMount) {
      return undefined;
    }

    let cancelled = false;
    setPanelState((current) => ({
      left: markPanelLoading(current.left),
      right: markPanelLoading(current.right),
    }));

    const requestIds: Record<PanelId, number> = {
      left: beginPanelRequest('left'),
      right: beginPanelRequest('right'),
    };

    void dataSource.loadInitialListings().then((results) => {
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
    };
  }, [dataSource]);

  useEffect(() => {
    shellRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    const clearShortcutSequence = () => {
      shortcutSequenceRef.current = [];
      if (shortcutSequenceTimeoutRef.current) {
        window.clearTimeout(shortcutSequenceTimeoutRef.current);
        shortcutSequenceTimeoutRef.current = null;
      }
    };

    const runShortcutAction = (shortcutAction: AppAction) => {
      const runtime = keyboardRuntimeRef.current;
      if (!runtime || runtime.operationDialogOpen || commanderKeyboardIsSuspended(document.activeElement)) {
        clearShortcutSequence();
        return;
      }

      if (!isActionAvailable(shortcutAction, runtime.context)) {
        setOverlayMessage(`${labelForAction(shortcutAction)} · 현재 컨텍스트에서는 사용할 수 없습니다.`);
        shellRef.current?.focus({ preventScroll: true });
        return;
      }

      runtime.handleAction(shortcutAction);
      shellRef.current?.focus({ preventScroll: true });
    };

    const holdShortcutSequence = (sequence: readonly string[], pendingAction: AppAction | null) => {
      shortcutSequenceRef.current = sequence;
      if (shortcutSequenceTimeoutRef.current) {
        window.clearTimeout(shortcutSequenceTimeoutRef.current);
      }
      shortcutSequenceTimeoutRef.current = window.setTimeout(() => {
        shortcutSequenceRef.current = [];
        shortcutSequenceTimeoutRef.current = null;
        if (pendingAction) {
          runShortcutAction(pendingAction);
        }
      }, KEYBOARD_SEQUENCE_TIMEOUT_MS);
    };

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const runtime = keyboardRuntimeRef.current;
      if (!runtime || event.defaultPrevented) {
        return;
      }

      if (runtime.operationDialogOpen || commanderKeyboardIsSuspended(event.target)) {
        clearShortcutSequence();
        return;
      }

      const handledByMovement = handleMovementKey(event, {
        moveFocusedEntry: runtime.moveFocusedEntry,
        focusBoundaryEntry: runtime.focusBoundaryEntry,
      });
      if (handledByMovement) {
        clearShortcutSequence();
        shellRef.current?.focus({ preventScroll: true });
        return;
      }

      const shortcutMatch = matchKeyboardShortcut(event, shortcutSequenceRef.current);
      if (shortcutMatch.status === 'none') {
        clearShortcutSequence();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (shortcutMatch.status === 'pending') {
        holdShortcutSequence(shortcutMatch.sequence, shortcutMatch.action);
        shellRef.current?.focus({ preventScroll: true });
        return;
      }

      clearShortcutSequence();
      runShortcutAction(shortcutMatch.action);
    };

    document.addEventListener('keydown', handleDocumentKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, { capture: true });
      clearShortcutSequence();
    };
  }, []);

  return (
    <main
      ref={shellRef}
      className="commander-shell"
      role="application"
      tabIndex={0}
      aria-label="BokslDirGUI file commander shell"
      aria-activedescendant={activeRowDomId}
      aria-keyshortcuts={`${ariaKeyShortcuts} ArrowUp ArrowDown PageUp PageDown Home End`}
    >
      <TopMenuBar context={context} onOpenAction={(action) => handleAction(action)} />
      <section className="panel-zone" aria-label="dual file panels">
        <FilePanel
          panel={panelState.left}
          active={activePanel === 'left'}
          onActivate={() => setActivePanel('left')}
          onStateChange={(next) => updatePanel('left', next)}
          onEntrySelect={(index, entry, additive) => selectEntry('left', index, entry, additive)}
          onEntryOpen={(entry) => openEntry('left', entry)}
          onOpenAction={(action, sources) => handleAction(action, 'left', sources)}
          onNavigateBack={() => navigateBack('left')}
          onNavigateForward={() => navigateForward('left')}
          onNavigateUp={() => navigateUp('left')}
          onRefresh={() => refreshPanel('left')}
          onGotoPath={() => void gotoPanelPath('left', panelState.left.path)}
        />
        <FilePanel
          panel={panelState.right}
          active={activePanel === 'right'}
          onActivate={() => setActivePanel('right')}
          onStateChange={(next) => updatePanel('right', next)}
          onEntrySelect={(index, entry, additive) => selectEntry('right', index, entry, additive)}
          onEntryOpen={(entry) => openEntry('right', entry)}
          onOpenAction={(action, sources) => handleAction(action, 'right', sources)}
          onNavigateBack={() => navigateBack('right')}
          onNavigateForward={() => navigateForward('right')}
          onNavigateUp={() => navigateUp('right')}
          onRefresh={() => refreshPanel('right')}
          onGotoPath={() => void gotoPanelPath('right', panelState.right.path)}
        />
      </section>
      <BottomStatusStrip listing={activeListing} activePanel={activePanel} selectedCount={context.selectedCount} />
      <HotkeyStrip />
      <OverlayHost message={overlayMessage} onDismiss={() => setOverlayMessage(null)} />
      {filterPromptPanel ? (
        <FilterPrompt
          panel={panelState[filterPromptPanel]}
          onApply={(filterValue) => applyFilter(filterPromptPanel, filterValue)}
          onCancel={cancelFilter}
        />
      ) : null}
      <OperationDialogHost />
    </main>
  );
}

interface TopMenuBarProps {
  context: Parameters<AppAction['isEnabled']>[0];
  onOpenAction(action: AppAction): void;
}

function TopMenuBar({ context, onOpenAction }: TopMenuBarProps) {
  return (
    <header className="top-menu" aria-label="application menu">
      <div className="brand" aria-label="application name">[복슬Dir]</div>
      <nav className="menu-list" aria-label="primary actions">
        {menuRootsFromRegistry().map((root) => {
          const actions = actionsForMenu(root);
          return (
            <Popover.Root key={root}>
              <Popover.Trigger className="menu-trigger">{root}</Popover.Trigger>
              <Popover.Portal>
                <MenuPopoverContent
                  root={root}
                  actions={actions}
                  context={context}
                  onOpenAction={onOpenAction}
                />
              </Popover.Portal>
            </Popover.Root>
          );
        })}
      </nav>
      <time className="clock" dateTime="2026-06-13T19:31:00+09:00">2026-06-13 19:31</time>
    </header>
  );
}

function MenuPopoverContent({ root, actions, context, onOpenAction }: {
  root: string;
  actions: readonly AppAction[];
  context: ActionContext;
  onOpenAction(action: AppAction): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('menu-popover');

  return (
    <Popover.Content className="menu-popover" sideOffset={4} align="start" {...keyboardBoundaryProps}>
      <div className="menu-popover-title">{root}</div>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          className="menu-item"
          disabled={!isActionAvailable(action, context)}
          onClick={() => onOpenAction(action)}
        >
          <span>{labelForAction(action)}</span>
          <kbd>{shortcutLabelForAction(action)}</kbd>
        </button>
      ))}
    </Popover.Content>
  );
}

interface FilePanelProps {
  panel: PanelNavigationState;
  active: boolean;
  onActivate(): void;
  onStateChange(next: PanelUiPatch): void;
  onEntrySelect(index: number, entry: FileEntry, additive: boolean): void;
  onEntryOpen(entry: FileEntry): void;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onRefresh(): void;
  onGotoPath(): void;
}

function FilePanel({
  panel,
  active,
  onActivate,
  onStateChange,
  onEntrySelect,
  onEntryOpen,
  onOpenAction,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onRefresh,
  onGotoPath,
}: FilePanelProps) {
  const { listing } = panel;
  const tableColumns = useMemo<ColumnDef<FileEntry>[]>(
    () => [
      {
        id: 'name',
        header: `Name ${panel.sort.field === 'name' ? sortMarker(panel.sort.direction) : ''}`,
        cell: ({ row }) => (
          <span className={`entry-name entry-kind-${row.original.kind}`}>
            <span className="entry-icon" aria-hidden="true">{entryIcon(row.original.kind)}</span>
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'size',
        header: `Size ${panel.sort.field === 'size' ? sortMarker(panel.sort.direction) : ''}`,
        cell: ({ row }) => formatSize(row.original),
      },
      {
        id: 'modified',
        header: `Modified ${panel.sort.field === 'modifiedAt' ? sortMarker(panel.sort.direction) : ''}`,
        cell: ({ row }) => formatModified(row.original.modifiedAt),
      },
    ],
    [panel.sort.direction, panel.sort.field],
  );

  const table = useReactTable({
    data: listing.entries,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
  });
  const rows = table.getRowModel().rows;
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 27,
    initialRect: { width: 640, height: 520 },
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const renderedRows = virtualRows.length > 0
    ? virtualRows
    : rows.slice(0, Math.min(rows.length, 24)).map((_, index) => ({
        index,
        start: index * 27,
      }));
  const summary = summarizeEntries(listing.entries);

  useEffect(() => {
    if (rows.length > 0) {
      virtualizer.scrollToIndex(panel.focusedIndex, { align: 'auto' });
    }
  }, [panel.focusedIndex, rows.length, virtualizer]);

  return (
    <section
      className={`file-panel ${active ? 'is-active' : ''}`}
      aria-label={`${listing.panelId} panel ${listing.path}`}
      aria-current={active ? 'true' : undefined}
      onMouseDown={onActivate}
    >
      <PanelHeader panel={panel} active={active} />
      <PathControls
        panel={panel}
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
        onNavigateUp={onNavigateUp}
        onRefresh={onRefresh}
        onGotoPath={onGotoPath}
      />
      <div className="file-table" role="table" aria-rowcount={listing.entries.length}>
        <div className="file-table-head" role="rowgroup">
          {table.getHeaderGroups().map((headerGroup) => (
            <div className="file-table-row file-table-heading" role="row" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <span key={header.id} role="columnheader" className={`file-cell file-cell-${header.id}`}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </span>
              ))}
            </div>
          ))}
        </div>
        <div ref={scrollRef} className="file-table-scroll" role="rowgroup">
          {panel.error || rows.length === 0 ? (
            <PanelMessageRow panel={panel} />
          ) : (
            <div className="file-table-virtual-space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
              {renderedRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                const entry = row.original;
                const focused = virtualRow.index === panel.focusedIndex;
                const selected = panel.selectedPaths.includes(entry.path);
                return (
                  <ContextMenu.Root key={row.id}>
                    <ContextMenu.Trigger asChild>
                      <div
                        id={rowDomId(listing.panelId, virtualRow.index)}
                        role="row"
                        tabIndex={FOCUSABLE_ROW_TAB_INDEX}
                        aria-rowindex={virtualRow.index + 1}
                        aria-selected={selected}
                        aria-current={focused ? 'true' : undefined}
                        className={`file-table-row file-row ${focused ? 'is-focused' : ''} ${selected ? 'is-selected' : ''}`}
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                        onClick={(event) => onEntrySelect(virtualRow.index, entry, event.metaKey || event.ctrlKey)}
                        onDoubleClick={() => onEntryOpen(entry)}
                        onFocus={() => onStateChange({ focusedIndex: virtualRow.index })}
                      >
                        {row.getVisibleCells().map((cell) => (
                          <span key={cell.id} role="cell" className={`file-cell file-cell-${cell.column.id}`}>
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </span>
                        ))}
                      </div>
                    </ContextMenu.Trigger>
                    <ContextMenu.Portal>
                      <EntryContextMenuContent
                        entry={entry}
                        listing={listing}
                        selectedCount={panel.selectedPaths.length}
                        onOpenAction={onOpenAction}
                      />
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                );
              })}
            </div>
          )}
        </div>
      </div>
      <footer className="panel-status">
        <span>{summary.files} files, {summary.dirs} dirs</span>
        <span>{panel.selectedPaths.length} selected</span>
        <span>{active ? 'ACTIVE' : 'TARGET'}</span>
      </footer>
    </section>
  );
}

function PanelMessageRow({ panel }: { panel: PanelNavigationState }) {
  let message = 'Empty directory';
  if (panel.loading) {
    message = 'Loading directory...';
  } else if (panel.error) {
    message = `Error: ${panel.error.messageKey}`;
  }
  return (
    <div className="file-table-message" role="row" aria-live="polite">
      <span role="cell">{message}</span>
    </div>
  );
}

function EntryContextMenuContent({ entry, listing, selectedCount, onOpenAction }: {
  entry: FileEntry;
  listing: DirectoryListing;
  selectedCount: number;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const context = createActionContext({
    activePanel: listing.panelId,
    focusedEntry: entry,
    selectedCount: entry.isVirtual ? 0 : Math.max(selectedCount, 1),
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy: false,
  });

  return (
    <ContextMenu.Content className="context-menu" {...keyboardBoundaryProps}>
      <ContextMenu.Label className="context-label">{entry.name}</ContextMenu.Label>
      {contextMenuActions(entry, context).map((action) => (
        <ContextMenu.Item
          key={action.id}
          className="context-item"
          onSelect={() => onOpenAction(action, [entry])}
        >
          <span>{labelForAction(action)}</span>
          <kbd>{shortcutLabelForAction(action)}</kbd>
        </ContextMenu.Item>
      ))}
    </ContextMenu.Content>
  );
}

function PanelHeader({ panel, active }: { panel: PanelNavigationState; active: boolean }) {
  return (
    <header className="panel-header">
      <span className="panel-path" title={panel.path}>· {shortenPath(panel.path)}</span>
      <span className={`panel-marker ${active ? 'active' : ''}`}>{active ? 'ACTIVE' : 'PASSIVE'}</span>
      {panel.loading ? <span className="panel-loading">LOADING</span> : null}
    </header>
  );
}

function PathControls({
  panel,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onRefresh,
  onGotoPath,
}: {
  panel: PanelNavigationState;
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onRefresh(): void;
  onGotoPath(): void;
}) {
  return (
    <div className="path-controls" aria-label={`${panel.listing.panelId} navigation controls`}>
      <button type="button" aria-label="Back" disabled={!panelCanGoBack(panel)} onClick={onNavigateBack}>◀</button>
      <button type="button" aria-label="Forward" disabled={!panelCanGoForward(panel)} onClick={onNavigateForward}>▶</button>
      <button type="button" aria-label="Up" onClick={onNavigateUp}>↑</button>
      <button type="button" aria-label="Refresh" onClick={onRefresh}>⟳</button>
      <span className="path-input" title={panel.path}>{panel.path}</span>
      <button type="button" aria-label="Go to path" onClick={onGotoPath}>⌘</button>
    </div>
  );
}

function BottomStatusStrip({ listing, activePanel, selectedCount }: { listing: DirectoryListing; activePanel: PanelId; selectedCount: number }) {
  const summary = summarizeEntries(listing.entries);
  return (
    <footer className="bottom-status" aria-label="active panel status">
      <span>{summary.files} files, {summary.dirs} dirs</span>
      <span>{selectedCount} selected</span>
      <span>{activePanel.toUpperCase()}</span>
      <span className="status-language">[KO]</span>
    </footer>
  );
}

function HotkeyStrip() {
  return (
    <footer className="hotkey-strip" aria-label="hotkey hints">
      {hotkeyStripActionsFromRegistry().map((action) => {
        const shortcut = shortcutLabelForAction(action);
        return (
          <span className="hotkey" key={action.id}>
            <kbd>{shortcut}</kbd>:<span>{action.hotkeyLabel}</span>
          </span>
        );
      })}
    </footer>
  );
}



function FilterPrompt({ panel, onApply, onCancel }: {
  panel: PanelNavigationState;
  onApply(filterValue: string): void;
  onCancel(): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('filter-prompt');
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(panel.filter ?? '');

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply(value);
  };

  return (
    <div className="filter-dialog" role="dialog" aria-label="filter entries" {...keyboardBoundaryProps}>
      <form className="filter-form" onSubmit={handleSubmit}>
        <label>
          <span>Filter · {panel.path}</span>
          <input
            ref={inputRef}
            aria-label="Filter pattern"
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        <div className="filter-actions">
          <button type="submit">Apply filter</button>
          {panel.filter ? <button type="button" onClick={() => onApply('')}>Clear filter</button> : null}
          <button type="button" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </div>
  );
}

function OverlayHost({ message, onDismiss }: { message: string | null; onDismiss(): void }) {
  return (
    <div className="overlay-host" aria-live="polite">
      {message ? (
        <div className="transient-overlay" role="dialog" aria-label="transient action preview">
          <strong>Action preview</strong>
          <span>{message}</span>
          <button type="button" onClick={onDismiss}>닫기</button>
        </div>
      ) : null}
    </div>
  );
}

export const contextMenuActions = (entry: FileEntry, context: ActionContext) => {
  const actions = entry.isVirtual
    ? ACTIONS.filter((action) => action.id === 'nav.enter')
    : ACTIONS.filter((action) => action.contextScopes?.some((scope) => scope !== 'blank'));
  return filterEnabledActions(actions, context, entry);
};

type SortActionId = 'view.sortName' | 'view.sortSize' | 'view.sortDate' | 'view.sortExt';

const sortFieldForAction = (actionId: SortActionId): SortSpec['field'] => {
  const mapping: Record<SortActionId, SortSpec['field']> = {
    'view.sortName': 'name',
    'view.sortSize': 'size',
    'view.sortDate': 'modifiedAt',
    'view.sortExt': 'extension',
  };
  return mapping[actionId];
};

const sortMarker = (direction: SortSpec['direction']) => (direction === 'asc' ? '▲' : '▼');

const shortenPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 4) {
    return normalized.startsWith('/') ? `/${parts.join('/')}` : parts.join('/');
  }
  return `/${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`;
};

const oppositePanelOf = (panelId: PanelId): PanelId => (panelId === 'left' ? 'right' : 'left');

const rowDomId = (panelId: PanelId, index: number) => `commander-row-${panelId}-${index}`;

const atomicExecutorForAction = (
  actionId: ActionId,
  mutationClient: SafeMutationClient,
): AtomicCommandExecutor | undefined => {
  if (actionId === 'file.mkdir') {
    return (dialog) =>
      mutationClient.createDir({ parent: dialog.targetDir ?? '', name: dialog.inputValue.trim() });
  }
  if (actionId === 'file.rename') {
    return (dialog) =>
      mutationClient.renameEntry({ path: dialog.sources[0]?.path ?? '', newName: dialog.inputValue.trim() });
  }
  return undefined;
};

const longRunningExecutorForAction = (
  actionId: ActionId,
  operationClient: LongRunningOperationClient,
): LongRunningOperationExecutor | undefined => {
  if (actionId === 'file.copy') {
    return (dialog) => operationClient.startCopy({
      sources: dialog.sources.map((source) => source.path),
      targetDir: dialog.targetDir ?? '',
      policy: dialog.defaultDecision,
    });
  }
  if (actionId === 'file.move') {
    return (dialog) => operationClient.startMove({
      sources: dialog.sources.map((source) => source.path),
      targetDir: dialog.targetDir ?? '',
      policy: dialog.defaultDecision,
    });
  }
  if (actionId === 'file.trash') {
    return (dialog) => operationClient.startDelete({
      targets: dialog.sources.map((source) => source.path),
      mode: 'trash',
    });
  }
  if (actionId === 'file.deletePermanent') {
    return (dialog) => operationClient.startDelete({
      targets: dialog.sources.map((source) => source.path),
      mode: 'permanent',
      confirmToken: dialog.inputValue.trim() === 'PERMANENT_DELETE' ? 'PERMANENT_DELETE' : undefined,
    });
  }
  return undefined;
};

interface MovementHandlers {
  moveFocusedEntry(delta: number): void;
  focusBoundaryEntry(boundary: 'first' | 'last'): void;
}

const handleMovementKey = (event: KeyboardEvent, handlers: MovementHandlers) => {
  const keyHandlers: Partial<Record<string, () => void>> = {
    ArrowUp: () => handlers.moveFocusedEntry(-1),
    ArrowDown: () => handlers.moveFocusedEntry(1),
    PageUp: () => handlers.moveFocusedEntry(-KEYBOARD_PAGE_STEP),
    PageDown: () => handlers.moveFocusedEntry(KEYBOARD_PAGE_STEP),
    Home: () => handlers.focusBoundaryEntry('first'),
    End: () => handlers.focusBoundaryEntry('last'),
  };
  const handler = keyHandlers[event.key];
  if (!handler) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  handler();
  return true;
};

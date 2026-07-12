import * as ContextMenu from '@radix-ui/react-context-menu';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type RefObject } from 'react';
import {
  ACTIONS,
  ACTION_BY_ID,
  ariaKeyShortcutsFromRegistry,
  actionsForMenu,
  hotkeyLabelForAction,
  hotkeyStripActionsFromRegistry,
  isActionAvailable,
  labelForAction,
  matchKeyboardShortcut,
  menuRootAcceleratorFromRegistry,
  menuPathSegmentsForAction,
  menuRootLabelFromRegistry,
  menuSegmentLabel,
  menuRootsFromRegistry,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
  type AppAction,
} from '../actions/registry';
import type { AppError, DirectoryListing, FileEntry, FilePreview, LocationList, OperationSummary, PanelId, Settings, SortSpec } from '../domain/types';
import { OperationDialogHost } from '../operations/OperationDialogHost';
import { operationSummaryStatusLabel } from '../operations/operationLabels';
import { dialogKindForAction, isOperationInFlight, useOperationStore, type AtomicCommandExecutor, type DialogKind, type LongRunningOperationExecutor, type OperationDialogDraft } from '../operations/operationStore';
import { tauriClient } from '../tauri/client';
import {
  COMMANDER_NAVIGATION_TEXT,
  COMMANDER_STATUS_TEXT,
  COMMANDER_UI_TEXT,
  FILE_ENTRY_TEXT,
  HOTKEY_STRIP_TEXT,
  METADATA_KIND_LABELS,
  PANEL_ID_LABELS,
  formatUserErrorMessage,
} from '../i18n-resources';
import { actionNeedsConcreteSources, createActionContext, filterEnabledActions, resolveActionTargets } from './actionContext';
import {
  archiveExitFocusPath,
  archiveListingToDirectoryListing,
  archiveParentFocusPath,
  archiveParentPath,
  archiveVirtualRootPath,
  isArchiveVirtualPath,
  parseArchiveVirtualPath,
} from './archiveVirtual';
import { createTauriPanelDataSource, type PanelDataSource, type PanelInitialLoadResult } from './panelDataSource';
import {
  clampFocusedIndex,
  createPanelStates,
  DEFAULT_SORT,
  focusedEntryOf,
  markPanelError,
  markPanelLoading,
  panelCanGoBack,
  panelCanGoForward,
  PANEL_IDS,
  parentNavigationEntryOf,
  parentPathOf,
  replacePanelListing,
  type FocusFallbackMode,
  type PanelNavigationState,
  type PanelStateById,
} from './panelState';
import { entryIcon, formatDate, formatOwnerGroup, formatSize, summarizeEntries } from './format';
import { commanderKeyboardIsSuspended, commanderKeyboardOwners, useCommanderKeyboardBoundaryProps } from './keyboardOwnership';
import {
  AboutDialog,
  ArchivePasswordPrompt,
  FilterPrompt,
  HelpSearchDialog,
  NavigationListDialog,
  PathPrompt,
  QuickPreviewDialog,
  ShortcutHelpDialog,
  type NavigationListItem,
  type NavigationListState,
} from './CommanderOverlays';

const KEYBOARD_PAGE_STEP = 12;
const FOCUSABLE_ROW_TAB_INDEX = -1;
const KEYBOARD_SEQUENCE_TIMEOUT_MS = 900;
const ARCHIVE_LIST_LIMIT = 50_000;
const DEFAULT_DATA_SOURCE = createTauriPanelDataSource();
const DEFAULT_SETTINGS: Settings = {
  schemaVersion: 1,
  theme: 'dark',
  language: 'ko',
  sizeFormat: 'binary',
  external: {
    editorId: null,
    shellCommand: {
      enabled: false,
    },
  },
  bookmarks: [],
  layout: {
    singlePanel: false,
    ratio: '50:50',
  },
  session: {
    leftPath: null,
    rightPath: null,
    activePanel: 'right',
  },
  view: {
    zoomStep: 0,
    density: 'compact',
    showIcons: true,
  },
};

const MIN_ZOOM_STEP = -3;
const MAX_ZOOM_STEP = 5;
const BASE_FONT_SIZE_PX = 16;
const BASE_ROW_HEIGHT_PX = 27;
const ZOOM_PRESETS_BY_STEP: Record<number, number> = {
  [-3]: 0.75,
  [-2]: 0.8,
  [-1]: 0.9,
  0: 1,
  1: 1.1,
  2: 1.25,
  3: 1.5,
  4: 1.75,
  5: 2,
};

type PanelUiPatch = Partial<Pick<PanelNavigationState, 'focusedIndex' | 'selectedPaths'>>;
type SelectionMode = 'replace' | 'additive' | 'range';
type ExternalDropFile = File & { path?: unknown };
type DirectoryComparisonState = 'same' | 'different' | 'left-only' | 'right-only';
interface DirectoryComparison {
  byPanel: Record<PanelId, Record<string, DirectoryComparisonState>>;
  same: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
}

interface CommanderShellProps {
  dataSource?: PanelDataSource;
  mutationClient?: SafeMutationClient;
  operationClient?: LongRunningOperationClient;
  appController?: AppController;
  runtimeBackendAvailable?: boolean;
  initialFocusIndex?: Partial<Record<PanelId, number>>;
  initialSelectedPaths?: Partial<Record<PanelId, string[]>>;
}

interface AppController {
  quit(): Promise<void>;
}

const DEFAULT_APP_CONTROLLER: AppController = {
  quit: () => getCurrentWindow().close(),
};

interface SafeMutationClient {
  createDir(input: { parent: string; name: string }): ReturnType<typeof tauriClient.createDir>;
  renameEntry(input: { path: string; newName: string }): ReturnType<typeof tauriClient.renameEntry>;
  getMetadata?(input: { path: string }): ReturnType<typeof tauriClient.getMetadata>;
  previewFile?(input: { path: string; maxBytes?: number }): ReturnType<typeof tauriClient.previewFile>;
  archiveList?(input: { archivePath: string; password?: string; limit?: number }): ReturnType<typeof tauriClient.archiveList>;
  openDefault?(input: { path: string }): ReturnType<typeof tauriClient.openDefault>;
  revealInManager?(input: { path: string }): ReturnType<typeof tauriClient.revealInManager>;
  openExternalEditor?(input: { path: string; editorId?: string }): ReturnType<typeof tauriClient.openExternalEditor>;
  prepareShellCommand?(input: { workingDir: string; command: string; args?: string[] }): ReturnType<typeof tauriClient.prepareShellCommand>;
  runShellCommand?(input: { workingDir: string; command: string; args?: string[]; confirmToken: string }): ReturnType<typeof tauriClient.runShellCommand>;
  loadSettings?(): ReturnType<typeof tauriClient.loadSettings>;
  saveSettings?(input: { patch: Partial<Settings> }): ReturnType<typeof tauriClient.saveSettings>;
}

interface LongRunningOperationClient {
  startCopy(input: { sources: string[]; targetDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.startCopy>;
  startMove(input: { sources: string[]; targetDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.startMove>;
  startDelete(input: { targets: string[]; mode: 'trash' | 'permanent'; confirmToken?: string }): ReturnType<typeof tauriClient.startDelete>;
  archiveCreate?(input: { sources: string[]; targetArchive: string; format: string; password?: string }): ReturnType<typeof tauriClient.archiveCreate>;
  archiveExtract?(input: { archivePath: string; targetDir: string; password?: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel'; entries?: string[]; stripPrefix?: string }): ReturnType<typeof tauriClient.archiveExtract>;
  archiveAdd?(input: { sources: string[]; archivePath: string; targetInnerDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.archiveAdd>;
  cancelOperation(input: { operationId: string }): ReturnType<typeof tauriClient.cancelOperation>;
  resolveConflict(input: { operationId: string; decision: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.resolveConflict>;
}

interface KeyboardRuntime {
  context: ActionContext;
  operationDialogOpen: boolean;
  moveFocusedEntry(delta: number, extendSelection?: boolean): void;
  focusBoundaryEntry(boundary: 'first' | 'last', extendSelection?: boolean): void;
  handleAction(action: AppAction): void;
  handleZoom(command: ZoomCommand): void;
}

type ZoomCommand = 'in' | 'out' | 'reset';

interface TopMenuState {
  rootIndex: number;
  itemIndex: number;
  submenuIndex: number | null;
  menuOpen: boolean;
}

interface MenuActionNode {
  kind: 'action';
  id: string;
  label: string;
  accelerator: string | null;
  action: AppAction;
  enabled: boolean;
  checkable: boolean;
  checked: boolean;
}

interface MenuSubmenuNode {
  kind: 'submenu';
  id: string;
  label: string;
  accelerator: string | null;
  children: MenuActionNode[];
}

type MenuNode = MenuActionNode | MenuSubmenuNode;

interface TopMenuKeyboardRuntime {
  context: ActionContext;
  settings: Settings;
  getState(): TopMenuState | null;
  open(rootIndex?: number, menuOpen?: boolean): void;
  close(): void;
  setState(next: TopMenuState): void;
  execute(action: AppAction): void;
}

interface ListPanelOptions {
  pushHistory?: boolean;
  replaceBack?: string[];
  replaceForward?: string[];
  preserveSelection?: boolean;
  preserveFocusPath?: string | null;
  focusPath?: string | null;
  focusFallback?: FocusFallbackMode;
  sort?: SortSpec;
  filter?: string | null;
  showHidden?: boolean;
  statusAfterSuccess?: string | null;
  persistSession?: boolean;
}

export function CommanderShell({
  dataSource = DEFAULT_DATA_SOURCE,
  mutationClient = tauriClient,
  operationClient = tauriClient,
  appController = DEFAULT_APP_CONTROLLER,
  runtimeBackendAvailable = true,
  initialFocusIndex,
  initialSelectedPaths,
}: CommanderShellProps) {
  const openOperationDialog = useOperationStore((state) => state.openDialog);
  const startLongRunningOperation = useOperationStore((state) => state.startLongRunningOperation);
  const operationDialogOpen = useOperationStore((state) => Boolean(state.dialog));
  const operationBusy = useOperationStore(isOperationInFlight);
  const shellRef = useRef<HTMLElement>(null);
  const shortcutSequenceRef = useRef<readonly string[]>([]);
  const shortcutSequenceTimeoutRef = useRef<number | null>(null);
  const keyboardRuntimeRef = useRef<KeyboardRuntime | null>(null);
  const topMenuKeyboardRuntimeRef = useRef<TopMenuKeyboardRuntime | null>(null);
  const topMenuStateRef = useRef<TopMenuState | null>(null);
  const navigationRequestRef = useRef<Record<PanelId, number>>({ left: 0, right: 0 });
  const locationsRequestRef = useRef(0);
  const previewRequestRef = useRef(0);
  const selectionAnchorRef = useRef<Record<PanelId, number | null>>({ left: null, right: null });
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
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filterPromptPanel, setFilterPromptPanel] = useState<PanelId | null>(null);
  const [pathPromptPanel, setPathPromptPanel] = useState<PanelId | null>(null);
  const [archivePasswordRequest, setArchivePasswordRequest] = useState<{ panelId: PanelId; virtualPath: string; archivePath: string } | null>(null);
  const archivePasswordsRef = useRef(new Map<string, string>());
  const [navigationList, setNavigationList] = useState<NavigationListState | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [settingsLoaded, setSettingsLoaded] = useState(() => !mutationClient.loadSettings);
  const initialPanelLoadStartedRef = useRef(false);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [helpSearchOpen, setHelpSearchOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [quickPreview, setQuickPreview] = useState<{ loading: boolean; preview: FilePreview | null } | null>(null);
  const [directoryComparison, setDirectoryComparison] = useState<DirectoryComparison | null>(null);
  const [topMenuState, setTopMenuStateValue] = useState<TopMenuState | null>(null);
  topMenuStateRef.current = topMenuState;
  const setTopMenuState = (next: TopMenuState | null) => {
    topMenuStateRef.current = next;
    setTopMenuStateValue(next);
  };
  const [panelTabs, setPanelTabs] = useState<Record<PanelId, string[]>>(() => ({
    left: [dataSource.initialListings.left.path],
    right: [dataSource.initialListings.right.path],
  }));
  const [dragSource, setDragSource] = useState<{ panelId: PanelId; entry: FileEntry } | null>(null);
  const viewMetrics = viewMetricsForSettings(settings.view);
  const statusText = COMMANDER_STATUS_TEXT[settings.language];
  const navigationText = COMMANDER_NAVIGATION_TEXT[settings.language];
  const shellStyle = {
    '--commander-scale': String(viewMetrics.scale),
    '--commander-font-size': `${viewMetrics.fontSizePx}px`,
    '--row-height': `${viewMetrics.rowHeightPx}px`,
    '--top-menu-height': `${viewMetrics.topMenuHeightPx}px`,
    '--panel-header-height': `${viewMetrics.panelHeaderHeightPx}px`,
    '--path-control-height': `${viewMetrics.pathControlHeightPx}px`,
    '--status-height': `${viewMetrics.statusHeightPx}px`,
    '--hotkey-strip-height': `${viewMetrics.hotkeyStripHeightPx}px`,
    '--cell-padding-x': `${viewMetrics.cellPaddingXPx}px`,
    '--control-gap': `${viewMetrics.controlGapPx}px`,
  } as CSSProperties;

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
    setDirectoryComparison(null);
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

    const result = isArchiveVirtualPath(path)
      ? await listArchiveVirtualPanel(panelId, path, showHidden, sort, filter)
      : await dataSource.listDir({ panelId, path, showHidden, sort, filter });
    if (!isCurrentPanelRequest(panelId, requestId)) {
      return;
    }
    if (!result.ok) {
      setPanelState((current) => ({
        ...current,
        [panelId]: markPanelError(current[panelId], result.error),
      }));
      setStatusMessage(statusText.listFailed(formatUserErrorMessage(settings.language, result.error)));
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
          focusFallback: options.focusFallback,
        }),
        showHidden,
      },
    }));
    setStatusMessage(options.statusAfterSuccess ?? null);
    if (options.persistSession !== false && !isArchiveVirtualPath(result.data.path)) {
      persistSessionPaths(panelId, result.data.path);
    }
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
      setStatusMessage(statusText.gotoFailed(formatUserErrorMessage(settings.language, result.error)));
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
    setStatusMessage(statusText.gotoCompleted(result.data.path));
    shellRef.current?.focus({ preventScroll: true });
  };

  const listArchiveVirtualPanel = async (
    panelId: PanelId,
    virtualPath: string,
    showHidden: boolean,
    sort: SortSpec,
    filter: string | null,
  ) => {
    const parsed = parseArchiveVirtualPath(virtualPath);
    if (!parsed || !mutationClient.archiveList || !runtimeBackendAvailable) {
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
    const password = archivePasswordsRef.current.get(parsed.archivePath);
    const result = await mutationClient.archiveList({
      archivePath: parsed.archivePath,
      password,
      limit: ARCHIVE_LIST_LIMIT,
    });
    if (!result.ok) {
      if (result.error.code === 'password_required' || result.error.code === 'invalid_password') {
        archivePasswordsRef.current.delete(parsed.archivePath);
        setArchivePasswordRequest({ panelId, virtualPath, archivePath: parsed.archivePath });
      }
      return result;
    }
    return {
      ok: true as const,
      data: archiveListingToDirectoryListing({
        panelId,
        virtualPath,
        archiveListing: result.data,
        showHidden,
        sort,
        filter,
      }),
    };
  };

  const refreshPanel = (panelId: PanelId) => {
    const panel = panelState[panelId];
    void listPanel(panelId, panel.path, {
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
      persistSession: false,
    });
  };

  const refreshPanelAfterSourceInvalid = (panelId: PanelId, status: string) => {
    const panel = panelState[panelId];
    void listPanel(panelId, panel.path, {
      preserveSelection: true,
      preserveFocusPath: focusedEntryOf(panel)?.path,
      statusAfterSuccess: status,
      persistSession: false,
    }).then(() => {
      shellRef.current?.focus({ preventScroll: true });
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
      setStatusMessage(statusText.noBackHistory);
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
      setStatusMessage(statusText.noForwardHistory);
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
      setStatusMessage(statusText.virtualEntryNotSelectable);
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

  const saveSettingsPatch = async (patch: Partial<Settings>, successMessage: string | null, options: { silent?: boolean } = {}) => {
    setSettings((current) => mergeSettings(current, patch));
    if (!options.silent && successMessage) {
      setStatusMessage(successMessage);
    }
    if (!runtimeBackendAvailable || !mutationClient.saveSettings) {
      return;
    }
    const result = await mutationClient.saveSettings({ patch });
    if (!result.ok) {
      setStatusMessage(statusText.settingsSaveFailed(formatUserErrorMessage(settings.language, result.error)));
      return;
    }
    setSettings(normalizeSettings(result.data));
  };

  const persistSessionPaths = (nextPanelId: PanelId, nextPath: string) => {
    const nextSession: Settings['session'] = {
      ...settings.session,
      leftPath: nextPanelId === 'left' ? nextPath : panelState.left.path,
      rightPath: nextPanelId === 'right' ? nextPath : panelState.right.path,
      activePanel: nextPanelId,
    };
    void saveSettingsPatch({ session: nextSession }, null, { silent: true });
  };

  const applyZoom = (command: ZoomCommand) => {
    const currentStep = settings.view.zoomStep;
    const nextStep = command === 'reset'
      ? 0
      : clampNumber(currentStep + (command === 'in' ? 1 : -1), MIN_ZOOM_STEP, MAX_ZOOM_STEP);
    if (nextStep === currentStep) {
      setStatusMessage(`Zoom · ${zoomPercentForStep(settings.view.zoomStep)}%`);
      return;
    }
    void saveSettingsPatch({
      view: { ...settings.view, zoomStep: nextStep },
    }, `Zoom · ${zoomPercentForStep(nextStep)}%`);
  };

  const addBookmark = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const bookmark = {
      id: `bookmark-${Date.now()}`,
      label: shortenPath(panel.path),
      path: panel.path,
    };
    const bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
    void saveSettingsPatch({
      bookmarks: [...bookmarks.filter((item) => item.path !== panel.path), bookmark],
    }, statusText.bookmarkAdded(bookmark.label));
  };

  const renameBookmarkForPanel = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
    const next = bookmarks.map((bookmark) =>
      bookmark.path === panel.path ? { ...bookmark, label: `${shortenPath(panel.path)} · renamed` } : bookmark,
    );
    void saveSettingsPatch({ bookmarks: next }, statusText.bookmarkRenamed(shortenPath(panel.path)));
  };

  const deleteBookmarkForPanel = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
    void saveSettingsPatch({
      bookmarks: bookmarks.filter((bookmark) => bookmark.path !== panel.path),
    }, statusText.bookmarkDeleted(shortenPath(panel.path)));
  };

  const openBookmarkList = (panelId: PanelId) => {
    const bookmarks = Array.isArray(settings.bookmarks) ? settings.bookmarks : [];
    setNavigationList({
      kind: 'bookmarks',
      panelId,
      title: navigationText.bookmarksTitle,
      items: bookmarks.map((bookmark) => ({
        id: bookmark.id,
        label: bookmark.label,
        path: bookmark.path,
        group: 'bookmark',
      })),
    });
    setStatusMessage(null);
  };

  const openHistoryList = (panelId: PanelId) => {
    const panel = panelState[panelId];
    const history = [...panel.historyBack, panel.path, ...panel.historyForward];
    setNavigationList({
      kind: 'history',
      panelId,
      title: navigationText.historyTitle(panelIdLabel(panelId, settings.language)),
      items: history.map((path, index) => ({
        id: `history-${index}-${path}`,
        label: index === panel.historyBack.length ? navigationText.currentPathLabel(shortenPath(path)) : shortenPath(path),
        path,
        group: index < panel.historyBack.length ? 'back' : index === panel.historyBack.length ? 'current' : 'forward',
      })),
    });
    setStatusMessage(null);
  };

  const openTabList = (panelId: PanelId) => {
    setNavigationList({
      kind: 'tabs',
      panelId,
      title: navigationText.tabsTitle(panelIdLabel(panelId, settings.language)),
      items: panelTabs[panelId].map((path, index) => ({
        id: `tab-${index}-${path}`,
        label: `${index + 1}. ${shortenPath(path)}`,
        path,
        group: path === panelState[panelId].path ? 'active tab' : 'tab',
      })),
    });
    setStatusMessage(null);
  };

  const openLocationsList = async (panelId: PanelId) => {
    const requestId = ++locationsRequestRef.current;
    setStatusMessage(statusText.locationsLoading);
    const result = await dataSource.listLocations();
    if (requestId !== locationsRequestRef.current) {
      return;
    }
    if (!result.ok) {
      setStatusMessage(statusText.locationsFailed(formatUserErrorMessage(settings.language, result.error)));
      return;
    }
    setNavigationList({
      kind: 'locations',
      panelId,
      title: navigationText.locationsTitle,
      items: navigationItemsFromLocations(result.data, settings),
    });
    setStatusMessage(null);
  };

  const chooseNavigationItem = (state: NavigationListState, item: NavigationListItem) => {
    setNavigationList(null);
    void gotoPanelPath(state.panelId, item.path);
  };

  const applyLayout = (patch: Partial<Settings['layout']>, message: string) => {
    void saveSettingsPatch({ layout: { ...settings.layout, ...patch } }, message);
  };

  const applyDirectSetting = (actionId: ActionId) => {
    const themeByAction: Partial<Record<ActionId, Settings['theme']>> = {
      'settings.themeDark': 'dark',
      'settings.themeLight': 'light',
      'settings.themeHighContrast': 'highContrast',
    };
    const languageByAction: Partial<Record<ActionId, Settings['language']>> = {
      'settings.languageEn': 'en',
      'settings.languageKo': 'ko',
    };
    const sizeByAction: Partial<Record<ActionId, Settings['sizeFormat']>> = {
      'settings.sizeAuto': 'binary',
      'settings.sizeBytes': 'decimal',
    };
    const editorByAction: Partial<Record<ActionId, string>> = {
      'settings.editorVi': 'vi',
      'settings.editorVim': 'vim',
      'settings.editorNano': 'nano',
      'settings.editorEmacs': 'emacs',
    };
    const theme = themeByAction[actionId];
    if (theme) {
      void saveSettingsPatch({ theme }, `Theme · ${theme}`);
      return true;
    }
    const language = languageByAction[actionId];
    if (language) {
      void saveSettingsPatch({ language }, `Language · ${language}`);
      return true;
    }
    const sizeFormat = sizeByAction[actionId];
    if (sizeFormat) {
      void saveSettingsPatch({ sizeFormat }, statusText.sizeFormat(sizeFormat === 'binary' ? 'auto' : 'bytes'));
      return true;
    }
    const editorId = editorByAction[actionId];
    if (editorId) {
      void saveSettingsPatch({ external: { ...settings.external, editorId } }, `Default editor · ${editorId}`);
      return true;
    }
    if (actionId === 'settings.toggleIcons') {
      const showIcons = !settings.view.showIcons;
      void saveSettingsPatch({ view: { ...settings.view, showIcons } }, statusText.icons(showIcons));
      return true;
    }
    return false;
  };

  const handlePanelDrop = (event: DragEvent<HTMLElement>, targetPanel: PanelId) => {
    event.preventDefault();
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length > 0 && !dragSource) {
      const externalEntries = files
        .map(fileEntryFromExternalDropFile)
        .filter((entry): entry is FileEntry => Boolean(entry));
      if (externalEntries.length !== files.length) {
        setDragSource(null);
        setStatusMessage(statusText.externalDropPathRequired);
        return;
      }
      const action = ACTIONS.find((candidate) => candidate.id === 'file.copy');
      if (action) {
        handleAction(action, targetPanel, externalEntries, panelState[targetPanel].path);
        setStatusMessage(statusText.externalImport(externalEntries.length, panelIdLabel(targetPanel, settings.language)));
      }
      setDragSource(null);
      return;
    }
    if (!dragSource || dragSource.panelId === targetPanel || dragSource.entry.isVirtual) {
      setDragSource(null);
      return;
    }
    const action = ACTIONS.find((candidate) => candidate.id === (event.shiftKey ? 'file.move' : 'file.copy'));
    if (action) {
      handleAction(action, dragSource.panelId, [dragSource.entry]);
      setStatusMessage(statusText.dragOperation(event.shiftKey ? 'move' : 'copy', dragSource.entry.name, panelIdLabel(targetPanel, settings.language)));
    }
    setDragSource(null);
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

  const openEntry = (panelId: PanelId, entry: FileEntry) => {
    setActivePanel(panelId);
    if (entry.isVirtual) {
      navigateUp(panelId);
      return;
    }
    if (entry.kind === 'directory') {
      const panel = panelState[panelId];
      void listPanel(panelId, entry.path, {
        pushHistory: entry.path !== panel.path,
        preserveSelection: false,
        focusPath: null,
        focusFallback: 'first-concrete',
      });
      return;
    }

    if (entry.kind === 'archive') {
      void openArchiveAsDirectory(panelId, entry);
      return;
    }

    if (isArchiveVirtualPath(entry.path)) {
      setStatusMessage(statusText.archiveEntry(entry.path));
      return;
    }

    void openDefaultEntry(entry);
  };

  const openDefaultEntry = async (entry: FileEntry) => {
    if (!mutationClient.openDefault || !runtimeBackendAvailable) {
      setStatusMessage(statusText.openDefaultUnavailable(entry.name));
      return;
    }
    setStatusMessage(statusText.openDefaultStart(entry.name));
    const result = await mutationClient.openDefault({ path: entry.path });
    if (!result.ok) {
      setStatusMessage(statusText.openDefaultFailed(formatUserErrorMessage(settings.language, result.error)));
      return;
    }
    setStatusMessage(statusText.openDefaultDone(entry.name));
  };

  const openArchiveAsDirectory = async (panelId: PanelId, entry: FileEntry) => {
    if (!mutationClient.archiveList || !runtimeBackendAvailable) {
      setStatusMessage(statusText.archiveOpenUnavailable(entry.name));
      return;
    }
    setStatusMessage(statusText.archiveOpenStart(entry.name));
    void listPanel(panelId, archiveVirtualRootPath(entry.path), {
      pushHistory: true,
      preserveSelection: false,
      focusFallback: 'first-concrete',
      statusAfterSuccess: null,
    });
  };

  const openTopMenu = (rootIndex = 0, menuOpen = true) => {
    const rootCount = menuRootsFromRegistry().length;
    if (rootCount === 0) {
      return;
    }
    const nextRootIndex = clampNumber(rootIndex, 0, rootCount - 1);
    setTopMenuState({ rootIndex: nextRootIndex, itemIndex: 0, submenuIndex: null, menuOpen });
    setStatusMessage(statusText.menu(menuRootLabelFromRegistry(menuRootsFromRegistry()[nextRootIndex], settings.language)));
  };

  const closeTopMenu = () => {
    setTopMenuState(null);
    shellRef.current?.focus({ preventScroll: true });
  };

  const handleAction = (
    action: AppAction,
    panelOverride = activePanel,
    sourceOverride?: FileEntry[],
    targetDirOverride?: string,
  ) => {
    const actionId = action.id as ActionId;
    if (actionId === 'menu.open') {
      if (topMenuState) {
        closeTopMenu();
      } else {
        openTopMenu(0, false);
      }
      return;
    }

    if (actionId === 'panel.switchActive') {
      switchActivePanel();
      return;
    }

    if (actionId === 'app.quit') {
      if (operationBusy) {
        setStatusMessage(statusText.quitBusy);
        return;
      }
      if (!runtimeBackendAvailable) {
        setStatusMessage(statusText.quitPreviewUnavailable);
        return;
      }
      void appController.quit()
        .then(() => setStatusMessage(statusText.quitRequested))
        .catch((error) => setStatusMessage(statusText.quitFailed(String(error))));
      return;
    }

    const panel = panelState[panelOverride];
    const panelListing = panel.listing;
    const oppositePanel = oppositePanelOf(panelOverride);
    const actionTargets = resolveActionTargets(panel);
    const focusedEntry = actionTargets.focusedEntry;
    const sources = sourceOverride?.filter((entry) => !entry.isVirtual)
      ?? actionTargets.effectiveSources;

    const actionTargetEntry = sourceOverride?.[0] ?? focusedEntry;

    if (actionId === 'panel.swapPaths') {
      setDirectoryComparison(null);
      setPanelState((current) => ({
        left: reassignPanelState(current.right, 'left'),
        right: reassignPanelState(current.left, 'right'),
      }));
      setPanelTabs((current) => ({ left: current.right, right: current.left }));
      void saveSettingsPatch({
        session: {
          ...settings.session,
          leftPath: panelState.right.path,
          rightPath: panelState.left.path,
          activePanel,
        },
      }, null, { silent: true });
      setStatusMessage(settings.language === 'ko' ? '좌우 패널 경로를 맞바꿨습니다.' : 'Swapped panel paths.');
      return;
    }

    if (actionId === 'panel.copyPathToOther') {
      if (isArchiveVirtualPath(panel.path)) {
        setStatusMessage(statusText.unavailableInContext(labelForAction(action, settings.language)));
        return;
      }
      void listPanel(oppositePanel, panel.path, { pushHistory: true }).then(() => setActivePanel(panelOverride));
      return;
    }

    if (actionId === 'panel.compareDirectories') {
      if (isArchiveVirtualPath(panelState.left.path) || isArchiveVirtualPath(panelState.right.path)) {
        setStatusMessage(statusText.unavailableInContext(labelForAction(action, settings.language)));
        return;
      }
      const comparison = compareDirectoryListings(panelState.left.listing, panelState.right.listing);
      setDirectoryComparison(comparison);
      setStatusMessage(settings.language === 'ko'
        ? `폴더 비교 · 동일 ${comparison.same} · 다름 ${comparison.different} · 왼쪽만 ${comparison.leftOnly} · 오른쪽만 ${comparison.rightOnly}`
        : `Directory compare · same ${comparison.same} · different ${comparison.different} · left only ${comparison.leftOnly} · right only ${comparison.rightOnly}`);
      return;
    }
    if (actionId === 'nav.enter' && actionTargetEntry) {
      openEntry(panelOverride, actionTargetEntry);
      return;
    }

    if (actionId === 'archive.list' && actionTargetEntry?.kind === 'archive') {
      openArchiveAsDirectory(panelOverride, actionTargetEntry);
      return;
    }

    if (actionId === 'file.quickView' && actionTargetEntry) {
      if (!mutationClient.previewFile || !runtimeBackendAvailable) {
        setStatusMessage(statusText.unavailableInContext(labelForAction(action, settings.language)));
        return;
      }
      const requestId = ++previewRequestRef.current;
      setQuickPreview({ loading: true, preview: null });
      setStatusMessage(null);
      void mutationClient.previewFile({ path: actionTargetEntry.path }).then((result) => {
        if (requestId !== previewRequestRef.current) {
          return;
        }
        if (!result.ok) {
          setQuickPreview(null);
          setStatusMessage(formatUserErrorMessage(settings.language, result.error));
          return;
        }
        setQuickPreview({ loading: false, preview: result.data });
      });
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
      setPathPromptPanel(panelOverride);
      setStatusMessage(null);
      return;
    }

    if (actionId === 'nav.locations') {
      void openLocationsList(panelOverride);
      return;
    }

    if (actionId === 'nav.top') {
      focusEntry(panelOverride, 0);
      return;
    }

    if (actionId === 'nav.bottom') {
      focusEntry(panelOverride, panel.listing.entries.length - 1);
      return;
    }

    if (actionId === 'selection.toggle') {
      toggleFocusedSelection(panelOverride);
      return;
    }

    if (actionId === 'selection.all') {
      selectAllEntries(panelOverride);
      setStatusMessage(`${labelForAction(action, settings.language)} · ${panelOverride.toUpperCase()}`);
      return;
    }

    if (actionId === 'selection.clear') {
      clearSelection(panelOverride);
      setStatusMessage(`${labelForAction(action, settings.language)} · ${panelOverride.toUpperCase()}`);
      return;
    }

    if (actionId === 'selection.invert') {
      invertSelection(panelOverride);
      setStatusMessage(`${labelForAction(action, settings.language)} · ${panelOverride.toUpperCase()}`);
      return;
    }

    if (actionId === 'view.sortName' || actionId === 'view.sortSize' || actionId === 'view.sortDate' || actionId === 'view.sortExt') {
      applySort(panelOverride, { ...panel.sort, field: sortFieldForAction(actionId), direction: 'asc' });
      return;
    }

    if (actionId === 'view.sortAsc' || actionId === 'view.sortDesc') {
      applySort(panelOverride, {
        ...panel.sort,
        direction: actionId === 'view.sortAsc' ? 'asc' : 'desc',
      });
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
      setStatusMessage(null);
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

    if (actionId === 'tab.new') {
      setPanelTabs((current) => ({
        ...current,
        [panelOverride]: [...current[panelOverride], panel.path],
      }));
      setStatusMessage(statusText.tabAdded(panelIdLabel(panelOverride, settings.language), shortenPath(panel.path)));
      return;
    }

    if (actionId === 'tab.close') {
      setPanelTabs((current) => ({
        ...current,
        [panelOverride]: current[panelOverride].length > 1
          ? current[panelOverride].slice(0, -1)
          : current[panelOverride],
      }));
      setStatusMessage(statusText.tabClosed(panelIdLabel(panelOverride, settings.language)));
      return;
    }

    if (actionId === 'tab.list') {
      openTabList(panelOverride);
      return;
    }

    if (actionId === 'history.list') {
      openHistoryList(panelOverride);
      return;
    }

    if (actionId === 'bookmark.add') {
      addBookmark(panelOverride);
      return;
    }

    if (actionId === 'bookmark.list') {
      openBookmarkList(panelOverride);
      return;
    }

    if (actionId === 'bookmark.rename') {
      renameBookmarkForPanel(panelOverride);
      return;
    }

    if (actionId === 'bookmark.delete') {
      deleteBookmarkForPanel(panelOverride);
      return;
    }

    if (actionId === 'layout.toggleSingleDual') {
      applyLayout({ singlePanel: !settings.layout.singlePanel }, `Layout · ${settings.layout.singlePanel ? 'dual' : 'single'} panel`);
      return;
    }

    if (actionId === 'layout.ratio50') {
      applyLayout({ ratio: '50:50' }, 'Layout ratio · 50:50');
      return;
    }

    if (actionId === 'layout.ratio70Left') {
      applyLayout({ ratio: '70:30' }, 'Layout ratio · 70:30');
      return;
    }

    if (actionId === 'layout.ratio70Right') {
      applyLayout({ ratio: '30:70' }, 'Layout ratio · 30:70');
      return;
    }

    if (applyDirectSetting(actionId)) {
      return;
    }

    if (actionId === 'help.shortcuts') {
      setHelpDialogOpen(true);
      setStatusMessage(null);
      return;
    }

    if (actionId === 'help.about') {
      setAboutDialogOpen(true);
      setStatusMessage(null);
      return;
    }

    if (actionId === 'help.search') {
      setHelpSearchOpen(true);
      setStatusMessage(null);
      return;
    }

    if (dialogKindForAction(actionId)) {
      if (actionNeedsConcreteSources(actionId) && sources.length === 0) {
        setStatusMessage(statusText.virtualOperationTargetUnavailable(labelForAction(action, settings.language)));
        return;
      }

      const isExternalCopyIntoPanel = actionId === 'file.copy' && sourceOverride !== undefined && targetDirOverride !== undefined;
      if (
        actionNeedsConcreteSources(actionId) &&
        sources.length > 0 &&
        sourceOverride !== undefined &&
        !isExternalCopyIntoPanel &&
        !sourcesBelongToListing(sources, panelListing)
      ) {
        refreshPanelAfterSourceInvalid(panelOverride, statusText.operationTargetChanged(labelForAction(action, settings.language)));
        return;
      }

      const operationTargetDir = actionId === 'archive.extractAuto' && sources[0]
        ? joinPath(panelState[oppositePanel].path, archiveAutoExtractFolderName(sources[0].name))
        : targetDirOverride ?? panelState[oppositePanel].path;
      const archiveCopyPlan = actionId === 'file.copy'
        ? archiveCopyPlanForSources(
            sources,
            panelListing.path,
            operationTargetDir,
            parseArchiveVirtualPath(panelListing.path)
              ? archivePasswordsRef.current.get(parseArchiveVirtualPath(panelListing.path)?.archivePath ?? '')
              : undefined,
          )
        : null;
      const archiveAddPlan = actionId === 'file.copy'
        ? archiveAddPlanForTarget(sources, operationTargetDir)
        : null;
      if (actionId === 'file.copy' && sources.some((source) => isArchiveVirtualPath(source.path)) && !archiveCopyPlan) {
        setStatusMessage(statusText.virtualOperationTargetUnavailable(labelForAction(action, settings.language)));
        return;
      }
      if (actionId === 'file.copy' && isArchiveVirtualPath(operationTargetDir) && !archiveAddPlan) {
        setStatusMessage(statusText.virtualOperationTargetUnavailable(labelForAction(action, settings.language)));
        return;
      }
      const operationRequest = {
        action,
        panelId: panelOverride,
        sources,
        targetDir: operationTargetDir,
        workingDir: panelListing.path,
        atomicExecutor: atomicExecutorForAction(actionId, mutationClient, settings),
        longRunningExecutor: archiveCopyPlan
          ? archiveCopyExecutorForPlan(archiveCopyPlan, operationClient)
          : archiveAddPlan
            ? archiveAddExecutorForPlan(archiveAddPlan, operationClient)
          : longRunningExecutorForAction(actionId, operationClient),
        cancelExecutor: (operationId: string) => operationClient.cancelOperation({ operationId }),
        conflictResolver: (operationId: string, decision: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel') => operationClient.resolveConflict({ operationId, decision }),
        onAtomicSuccess: (result: unknown) => {
          const entry = result as Partial<FileEntry>;
          if (typeof entry.path === 'string' && typeof entry.name === 'string') {
            void listPanel(panelOverride, panelListing.path, {
              preserveSelection: false,
              focusPath: entry.path,
            });
            setStatusMessage(statusText.operationDoneWithEntry(labelForAction(action, settings.language), entry.name));
            return;
          }
          setStatusMessage(statusText.operationDone(labelForAction(action, settings.language)));
        },
        onOperationSummary: (summary: OperationSummary, dialog: OperationDialogDraft) => {
          if (shouldClearSourceSelectionAfterOperation(summary, dialog.dialogKind)) {
            selectionAnchorRef.current[dialog.panelId] = null;
            setPanelState((current) => ({
              ...current,
              [dialog.panelId]: {
                ...current[dialog.panelId],
                selectedPaths: [],
              },
            }));
          }
          refreshPanel(dialog.panelId);
          refreshPanel(oppositePanelOf(dialog.panelId));
          setStatusMessage(`${labelForAction(action, settings.language)} ${operationSummaryStatusLabel(summary, settings.language)}`);
        },
        onOperationStartError: (error: AppError) => {
          if (actionNeedsConcreteSources(actionId) && error.code === 'not_found') {
            refreshPanelAfterSourceInvalid(panelOverride, statusText.operationTargetMissing(labelForAction(action, settings.language)));
            return 'dismiss' as const;
          }
          return 'keep' as const;
        },
      };

      if (actionId === 'file.copy') {
        void startLongRunningOperation(operationRequest);
        setStatusMessage(statusText.operationStarted(labelForAction(action, settings.language), sources.length, operationRequest.targetDir));
        return;
      }

      openOperationDialog(operationRequest);
      return;
    }

    setStatusMessage(statusText.actionReady(labelForAction(action, settings.language)));
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

  const applyGotoPath = (panelId: PanelId, pathValue: string) => {
    const path = pathValue.trim();
    setPathPromptPanel(null);
    setArchivePasswordRequest(null);
    if (!path) {
      shellRef.current?.focus({ preventScroll: true });
      return;
    }
    void gotoPanelPath(panelId, path);
  };

  const closeOverlay = () => {
    locationsRequestRef.current += 1;
    previewRequestRef.current += 1;
    setPathPromptPanel(null);
    setArchivePasswordRequest(null);
    setNavigationList(null);
    setHelpSearchOpen(false);
    setAboutDialogOpen(false);
    setQuickPreview(null);
    shellRef.current?.focus({ preventScroll: true });
  };

  const activeListing = panelState[activePanel].listing;
  const activePanelState = panelState[activePanel];
  const activeTargets = resolveActionTargets(activePanelState);
  const context = createActionContext({
    activePanel,
    focusedEntry: activeTargets.focusedEntry,
    selectedCount: activeTargets.selectedCount,
    hasConcreteFocus: activeTargets.hasConcreteFocus,
    effectiveTargetCount: activeTargets.effectiveTargetCount,
    hasOppositePanel: true,
    shellCommandEnabled: settings.external.shellCommand.enabled,
    operationBusy: operationBusy || panelState.left.loading || panelState.right.loading,
    backendAvailable: runtimeBackendAvailable,
    activePathIsArchive: isArchiveVirtualPath(activeListing.path),
  });
  const openFocusedRowContextMenu = () => {
    const row = document.getElementById(rowDomId(activePanel, panelState[activePanel].focusedIndex));
    if (!row) {
      return;
    }
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(48, Math.max(12, rect.width / 3)),
      clientY: rect.top + rect.height / 2,
    }));
  };

  const activeRowDomId = rowDomId(activePanel, panelState[activePanel].focusedIndex);
  const ariaKeyShortcuts = ariaKeyShortcutsFromRegistry();
  keyboardRuntimeRef.current = {
    context,
    operationDialogOpen,
    moveFocusedEntry,
    focusBoundaryEntry,
    handleAction,
    handleZoom: applyZoom,
  };
  topMenuKeyboardRuntimeRef.current = {
    context,
    settings,
    getState: () => topMenuStateRef.current,
    open: openTopMenu,
    close: closeTopMenu,
    setState: setTopMenuState,
    execute: (action) => {
      setTopMenuState(null);
      handleAction(action);
      shellRef.current?.focus({ preventScroll: true });
    },
  };

  useEffect(() => {
    if (!runtimeBackendAvailable || !mutationClient.loadSettings) {
      setSettingsLoaded(true);
      return;
    }
    void mutationClient.loadSettings().then((result) => {
      if (result.ok) {
        const loaded = normalizeSettings(result.data);
        setSettings(loaded);
        setActivePanel(loaded.session.activePanel);
        setPanelTabs((current) => ({
          left: current.left.length ? current.left : [loaded.session.leftPath ?? panelState.left.path],
          right: current.right.length ? current.right : [loaded.session.rightPath ?? panelState.right.path],
        }));
      } else {
        setStatusMessage(statusText.settingsLoadFailed(formatUserErrorMessage(settings.language, result.error)));
      }
      setSettingsLoaded(true);
    });
  }, [mutationClient, runtimeBackendAvailable]);

  useEffect(() => {
    const previousTheme = document.body.dataset.theme;
    document.body.dataset.theme = settings.theme;

    return () => {
      if (previousTheme) {
        document.body.dataset.theme = previousTheme;
      } else {
        delete document.body.dataset.theme;
      }
    };
  }, [settings.theme]);

  useEffect(() => {
    if (!dataSource.loadInitialOnMount || !settingsLoaded || initialPanelLoadStartedRef.current) {
      return undefined;
    }
    initialPanelLoadStartedRef.current = true;

    let cancelled = false;
    setPanelState((current) => ({
      left: markPanelLoading(current.left),
      right: markPanelLoading(current.right),
    }));

    const restoreLeft = settings.session.leftPath;
    const restoreRight = settings.session.rightPath;
    const initialRequest: Promise<PanelInitialLoadResult> = restoreLeft || restoreRight
      ? Promise.all(PANEL_IDS.map((panelId) => dataSource.listDir({
          panelId,
          path: (panelId === 'left' ? restoreLeft : restoreRight) ?? dataSource.initialListings[panelId].path,
          showHidden: false,
          sort: dataSource.initialListings[panelId].sort ?? DEFAULT_SORT,
          filter: null,
        }))).then(([left, right]) => ({ left, right }))
      : dataSource.loadInitialListings();

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
    };
  }, [dataSource, settingsLoaded, settings.session.leftPath, settings.session.rightPath]);


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
        setStatusMessage(statusText.unavailableInContext(labelForAction(shortcutAction, settings.language)));
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

      const topMenuRuntime = topMenuKeyboardRuntimeRef.current;
      const topMenuOpen = Boolean(topMenuRuntime?.getState());
      const activeKeyboardOwners = commanderKeyboardOwners();
      const onlyTopMenuOwnsKeyboard = activeKeyboardOwners.length === 0
        || activeKeyboardOwners.every((owner) => owner === 'menu-popover');

      const topMenuGlobalShortcutMatch = topMenuOpen && onlyTopMenuOwnsKeyboard && (event.ctrlKey || event.metaKey)
        ? matchKeyboardShortcut(event, [])
        : null;
      if (
        topMenuGlobalShortcutMatch?.status === 'matched'
        && topMenuGlobalShortcutMatch.action.id === 'app.quit'
      ) {
        event.preventDefault();
        event.stopPropagation();
        clearShortcutSequence();
        setTopMenuState(null);
        runtime.handleAction(topMenuGlobalShortcutMatch.action);
        shellRef.current?.focus({ preventScroll: true });
        return;
      }

      if (topMenuOpen && onlyTopMenuOwnsKeyboard && handleTopMenuKeyDown(event, topMenuRuntime)) {
        clearShortcutSequence();
        return;
      }

      if (runtime.operationDialogOpen || commanderKeyboardIsSuspended(event.target)) {
        // Do not call the generic top-menu close helper here: it restores focus
        // to the commander shell and steals keyboard ownership from prompts,
        // inputs, and modal operation controls. Only clear a genuinely open
        // menu state while leaving the current owner focused.
        if (topMenuOpen) {
          setTopMenuState(null);
        }
        clearShortcutSequence();
        return;
      }

      if (handleTopMenuKeyDown(event, topMenuRuntime)) {
        clearShortcutSequence();
        return;
      }

      if (handleZoomKey(event, runtime.handleZoom)) {
        clearShortcutSequence();
        shellRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        event.stopPropagation();
        clearShortcutSequence();
        openFocusedRowContextMenu();
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
      style={shellStyle}
      data-theme={settings.theme}
      data-language={settings.language}
      data-size-format={settings.sizeFormat}
      aria-label="BokslDirGUI file commander shell"
      aria-activedescendant={activeRowDomId}
      aria-keyshortcuts={`${ariaKeyShortcuts} ArrowUp ArrowDown PageUp PageDown Home End`}
    >
      <TopMenuBar
        language={settings.language}
        settings={settings}
        context={context}
        state={topMenuState}
        onOpenRoot={openTopMenu}
        onClose={closeTopMenu}
        onStateChange={setTopMenuState}
        onOpenAction={(action) => {
          setTopMenuState(null);
          handleAction(action);
        }}
      />
      {!runtimeBackendAvailable ? (
        <div className="runtime-warning" role="status">
          {statusText.previewMode}
        </div>
      ) : null}
      <section
        className={`panel-zone layout-${settings.layout.ratio.replace(':', '-')} ${settings.layout.singlePanel ? 'is-single-panel' : ''}`}
        aria-label="dual file panels"
      >
        <FilePanel
          panel={panelState.left}
          comparisonByPath={directoryComparison?.byPanel.left ?? null}
          active={activePanel === 'left'}
          hiddenByLayout={settings.layout.singlePanel && activePanel !== 'left'}
          tabCount={panelTabs.left.length}
          rowHeightPx={viewMetrics.rowHeightPx}
          scale={viewMetrics.scale}
          sizeFormat={settings.sizeFormat}
          language={settings.language}
          showIcons={settings.view.showIcons}
          operationBusy={operationBusy || panelState.left.loading || panelState.right.loading}
          backendAvailable={runtimeBackendAvailable}
          onActivate={() => setActivePanel('left')}
          onStateChange={(next) => updatePanel('left', next)}
          onEntrySelect={(index, entry, mode) => selectEntry('left', index, entry, mode)}
          onEntryOpen={(entry) => openEntry('left', entry)}
          onOpenAction={(action, sources) => handleAction(action, 'left', sources)}
          onNavigateBack={() => navigateBack('left')}
          onNavigateForward={() => navigateForward('left')}
          onNavigateUp={() => navigateUp('left')}
          onRefresh={() => refreshPanel('left')}
          onGotoPath={() => setPathPromptPanel('left')}
          onClearFilter={() => handleAction(ACTION_BY_ID.get('filter.clear')!, 'left')}
          onRestoreFocus={() => shellRef.current?.focus({ preventScroll: true })}
          onEntryDragStart={(entry) => setDragSource({ panelId: 'left', entry })}
          onPanelDrop={(event) => handlePanelDrop(event, 'left')}
        />
        <FilePanel
          panel={panelState.right}
          comparisonByPath={directoryComparison?.byPanel.right ?? null}
          active={activePanel === 'right'}
          hiddenByLayout={settings.layout.singlePanel && activePanel !== 'right'}
          tabCount={panelTabs.right.length}
          rowHeightPx={viewMetrics.rowHeightPx}
          scale={viewMetrics.scale}
          sizeFormat={settings.sizeFormat}
          language={settings.language}
          showIcons={settings.view.showIcons}
          operationBusy={operationBusy || panelState.left.loading || panelState.right.loading}
          backendAvailable={runtimeBackendAvailable}
          onActivate={() => setActivePanel('right')}
          onStateChange={(next) => updatePanel('right', next)}
          onEntrySelect={(index, entry, mode) => selectEntry('right', index, entry, mode)}
          onEntryOpen={(entry) => openEntry('right', entry)}
          onOpenAction={(action, sources) => handleAction(action, 'right', sources)}
          onNavigateBack={() => navigateBack('right')}
          onNavigateForward={() => navigateForward('right')}
          onNavigateUp={() => navigateUp('right')}
          onRefresh={() => refreshPanel('right')}
          onGotoPath={() => setPathPromptPanel('right')}
          onClearFilter={() => handleAction(ACTION_BY_ID.get('filter.clear')!, 'right')}
          onRestoreFocus={() => shellRef.current?.focus({ preventScroll: true })}
          onEntryDragStart={(entry) => setDragSource({ panelId: 'right', entry })}
          onPanelDrop={(event) => handlePanelDrop(event, 'right')}
        />
      </section>
      <BottomStatusStrip
        language={settings.language}
        listing={activeListing}
        activePanel={activePanel}
        selectedCount={context.selectedCount}
        selectedBytes={sumEntryBytes(activeTargets.selectedEntries)}
        message={statusMessage}
        filter={activePanelState.filter}
      />
      <HotkeyStrip scale={viewMetrics.scale} language={settings.language} />
      {filterPromptPanel ? (
        <FilterPrompt
          language={settings.language}
          panel={panelState[filterPromptPanel]}
          onApply={(filterValue) => applyFilter(filterPromptPanel, filterValue)}
          onCancel={cancelFilter}
        />
      ) : null}
      {pathPromptPanel ? (
        <PathPrompt
          language={settings.language}
          panel={panelState[pathPromptPanel]}
          onApply={(pathValue) => applyGotoPath(pathPromptPanel, pathValue)}
          onCancel={closeOverlay}
        />
      ) : null}
      {archivePasswordRequest ? (
        <ArchivePasswordPrompt
          language={settings.language}
          archivePath={archivePasswordRequest.archivePath}
          onApply={(password) => {
            archivePasswordsRef.current.set(archivePasswordRequest.archivePath, password);
            const request = archivePasswordRequest;
            setArchivePasswordRequest(null);
            void listPanel(request.panelId, request.virtualPath, { preserveSelection: true });
          }}
          onCancel={closeOverlay}
        />
      ) : null}
      {quickPreview ? (
        <QuickPreviewDialog
          language={settings.language}
          preview={quickPreview.preview}
          loading={quickPreview.loading}
          onClose={closeOverlay}
        />
      ) : null}
      {navigationList ? (
        <NavigationListDialog
          language={settings.language}
          state={navigationList}
          onChoose={(item) => chooseNavigationItem(navigationList, item)}
          onClose={closeOverlay}
        />
      ) : null}
      <OperationDialogHost language={settings.language} />
      {helpDialogOpen ? <ShortcutHelpDialog language={settings.language} onClose={() => setHelpDialogOpen(false)} /> : null}
      {helpSearchOpen ? <HelpSearchDialog language={settings.language} onClose={closeOverlay} /> : null}
      {aboutDialogOpen ? <AboutDialog language={settings.language} onClose={closeOverlay} /> : null}
    </main>
  );
}

interface TopMenuBarProps {
  language: Settings['language'];
  settings: Settings;
  context: Parameters<AppAction['isEnabled']>[0];
  state: TopMenuState | null;
  onOpenRoot(rootIndex?: number, menuOpen?: boolean): void;
  onClose(): void;
  onStateChange(next: TopMenuState): void;
  onOpenAction(action: AppAction): void;
}

const menuNodesForRoot = (root: string, context: ActionContext, settings: Settings): MenuNode[] => {
  const language = settings.language;
  const nodes: MenuNode[] = [];
  const submenuByLabel = new Map<string, MenuSubmenuNode>();

  for (const action of actionsForMenu(root)) {
    const segments = menuPathSegmentsForAction(action, language)?.slice(1) ?? [];
    const acceleratorSegments = action.menuPath?.slice(1) ?? [];
    if (segments.length > 1) {
      const submenuLabel = segments[0];
      let submenu = submenuByLabel.get(submenuLabel);
      if (!submenu) {
        submenu = {
          kind: 'submenu',
          id: `${root}/${submenuLabel}`,
          label: submenuLabel,
          accelerator: menuLabelAccelerator(acceleratorSegments[0] ?? submenuLabel),
          children: [],
        };
        submenuByLabel.set(submenuLabel, submenu);
        nodes.push(submenu);
      }
      submenu.children.push({
        kind: 'action',
        id: action.id,
        label: segments.at(-1) ?? labelForAction(action, language),
        accelerator: menuLabelAccelerator(acceleratorSegments.at(-1) ?? action.displayLabel),
        action,
        enabled: isActionAvailable(action, context),
        checkable: isCheckableMenuAction(action),
        checked: isCheckedMenuAction(action, settings),
      });
      continue;
    }

    nodes.push({
      kind: 'action',
      id: action.id,
      label: segments[0] ?? labelForAction(action, language),
      accelerator: menuLabelAccelerator(acceleratorSegments[0] ?? action.displayLabel),
      action,
      enabled: isActionAvailable(action, context),
      checkable: isCheckableMenuAction(action),
      checked: isCheckedMenuAction(action, settings),
    });
  }

  return nodes;
};

const CHECKABLE_MENU_ACTION_IDS = new Set<ActionId>([
  'settings.themeDark',
  'settings.themeLight',
  'settings.themeHighContrast',
  'settings.languageEn',
  'settings.languageKo',
  'settings.editorVi',
  'settings.editorVim',
  'settings.editorNano',
  'settings.editorEmacs',
  'settings.sizeAuto',
  'settings.sizeBytes',
  'settings.toggleIcons',
]);

const isCheckableMenuAction = (action: AppAction) =>
  CHECKABLE_MENU_ACTION_IDS.has(action.id as ActionId);

const isCheckedMenuAction = (action: AppAction, settings: Settings) => {
  const actionId = action.id as ActionId;
  return (
    (actionId === 'settings.themeDark' && settings.theme === 'dark') ||
    (actionId === 'settings.themeLight' && settings.theme === 'light') ||
    (actionId === 'settings.themeHighContrast' && settings.theme === 'highContrast') ||
    (actionId === 'settings.languageEn' && settings.language === 'en') ||
    (actionId === 'settings.languageKo' && settings.language === 'ko') ||
    (actionId === 'settings.editorVi' && settings.external.editorId === 'vi') ||
    (actionId === 'settings.editorVim' && settings.external.editorId === 'vim') ||
    (actionId === 'settings.editorNano' && settings.external.editorId === 'nano') ||
    (actionId === 'settings.editorEmacs' && settings.external.editorId === 'emacs') ||
    (actionId === 'settings.sizeAuto' && settings.sizeFormat === 'binary') ||
    (actionId === 'settings.sizeBytes' && settings.sizeFormat === 'decimal') ||
    (actionId === 'settings.toggleIcons' && settings.view.showIcons)
  );
};

const handleTopMenuKeyDown = (event: KeyboardEvent, runtime: TopMenuKeyboardRuntime | null) => {
  if (!runtime) {
    return false;
  }

  const roots = menuRootsFromRegistry();
  const openFromClosed = event.key === 'F9';
  const accelerator = menuAcceleratorFromKeyboardEvent(event);
  const acceleratedRootIndex = accelerator ? rootIndexForAccelerator(roots, accelerator) : -1;
  let state = runtime.getState();
  if (!state) {
    if (openFromClosed || (event.altKey && acceleratedRootIndex >= 0)) {
      event.preventDefault();
      event.stopPropagation();
      runtime.open(openFromClosed ? 0 : acceleratedRootIndex, !openFromClosed);
      return true;
    }
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const applyMenuState = (next: TopMenuState) => {
    state = next;
    runtime.setState(next);
  };

  if (event.key === 'Escape' || event.key === 'F9') {
    runtime.close();
    return true;
  }

  const moveRoot = (delta: number) => {
    const nextRootIndex = (state!.rootIndex + delta + roots.length) % roots.length;
    applyMenuState({ rootIndex: nextRootIndex, itemIndex: 0, submenuIndex: null, menuOpen: state!.menuOpen });
  };
  const nodes = menuNodesForRoot(roots[state.rootIndex], runtime.context, runtime.settings);
  const selectedNode = nodes[state.itemIndex];
  if (nodes.length === 0 && state.menuOpen) {
    return true;
  }

  if (accelerator) {
    if (acceleratedRootIndex >= 0) {
      applyMenuState({ rootIndex: acceleratedRootIndex, itemIndex: 0, submenuIndex: null, menuOpen: state.menuOpen });
      return true;
    }

    if (!state.menuOpen) {
      return true;
    }

    if (state.submenuIndex !== null && selectedNode?.kind === 'submenu') {
      const childIndex = selectedNode.children.findIndex((child) => child.accelerator === accelerator);
      const child = childIndex >= 0 ? selectedNode.children[childIndex] : null;
      if (child) {
        applyMenuState({ ...state, submenuIndex: childIndex });
        if (child.enabled) {
          runtime.execute(child.action);
        }
        return true;
      }
    }

    const nodeIndex = nodes.findIndex((node) => node.accelerator === accelerator);
    const node = nodeIndex >= 0 ? nodes[nodeIndex] : null;
    if (node) {
      if (node.kind === 'submenu') {
        applyMenuState({ ...state, itemIndex: nodeIndex, submenuIndex: 0 });
        return true;
      }
      applyMenuState({ ...state, itemIndex: nodeIndex, submenuIndex: null });
      if (node.enabled) {
        runtime.execute(node.action);
      }
      return true;
    }
  }

  if (event.key === 'ArrowRight') {
    if (!state.menuOpen) {
      moveRoot(1);
      return true;
    }
    if (selectedNode?.kind === 'submenu' && state.submenuIndex === null) {
      applyMenuState({ ...state, submenuIndex: 0 });
      return true;
    }
    moveRoot(1);
    return true;
  }

  if (event.key === 'ArrowLeft') {
    if (!state.menuOpen) {
      moveRoot(-1);
      return true;
    }
    if (state.submenuIndex !== null) {
      applyMenuState({ ...state, submenuIndex: null });
      return true;
    }
    moveRoot(-1);
    return true;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!state.menuOpen) {
      applyMenuState({ ...state, itemIndex: event.key === 'ArrowUp' ? Math.max(0, nodes.length - 1) : 0, submenuIndex: null, menuOpen: true });
      return true;
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    if (state.submenuIndex !== null && selectedNode?.kind === 'submenu') {
      const childCount = selectedNode.children.length;
      applyMenuState({
        ...state,
        submenuIndex: (state.submenuIndex + delta + childCount) % childCount,
      });
      return true;
    }
    applyMenuState({
      ...state,
      itemIndex: (state.itemIndex + delta + nodes.length) % nodes.length,
      submenuIndex: null,
    });
    return true;
  }

  if (event.key === 'Home') {
    applyMenuState(state.menuOpen ? { ...state, itemIndex: 0, submenuIndex: null } : { ...state, rootIndex: 0, itemIndex: 0, submenuIndex: null });
    return true;
  }

  if (event.key === 'End') {
    applyMenuState(state.menuOpen
      ? { ...state, itemIndex: Math.max(0, nodes.length - 1), submenuIndex: null }
      : { ...state, rootIndex: Math.max(0, roots.length - 1), itemIndex: 0, submenuIndex: null });
    return true;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    if (!state.menuOpen) {
      applyMenuState({ ...state, itemIndex: 0, submenuIndex: null, menuOpen: true });
      return true;
    }
    if (selectedNode?.kind === 'submenu') {
      if (state.submenuIndex === null) {
        applyMenuState({ ...state, submenuIndex: 0 });
        return true;
      }
      const child = selectedNode.children[state.submenuIndex];
      if (child?.enabled) {
        runtime.execute(child.action);
      }
      return true;
    }
    if (selectedNode?.kind === 'action' && selectedNode.enabled) {
      runtime.execute(selectedNode.action);
    }
    return true;
  }

  return true;
};

const menuAcceleratorFromKeyboardEvent = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey) {
    return null;
  }
  if (event.code.startsWith('Key')) {
    return event.code.slice(3).toUpperCase();
  }
  return Array.from(event.key).length === 1 ? menuLabelAccelerator(event.key) : null;
};

const rootIndexForAccelerator = (roots: readonly string[], accelerator: string) =>
  roots.findIndex((root) => menuRootAcceleratorFromRegistry(root) === accelerator);

const menuLabelAccelerator = (label: string) => {
  const first = Array.from(label.trim()).find((character) => /[A-Za-z0-9]/.test(character));
  return first ? first.toUpperCase() : null;
};

function TopMenuBar({ language, settings, context, state, onOpenRoot, onClose, onStateChange, onOpenAction }: TopMenuBarProps) {
  const now = useLocalClock();
  const roots = menuRootsFromRegistry();
  const activeRoot = state ? roots[state.rootIndex] : null;
  const activeNodes = activeRoot && state?.menuOpen ? menuNodesForRoot(activeRoot, context, settings) : [];

  return (
    <header className="top-menu" aria-label="application menu">
      <div className="brand" aria-label="application name">{COMMANDER_UI_TEXT[language].brand}</div>
      <nav className="menu-list" aria-label="primary actions">
        {roots.map((root, rootIndex) => {
          const isActiveRoot = state?.rootIndex === rootIndex;
          const isMenuOpen = Boolean(isActiveRoot && state?.menuOpen);
          return (
            <button
              key={root}
              type="button"
              className="menu-trigger"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              data-state={isActiveRoot ? (isMenuOpen ? 'open' : 'focused') : 'closed'}
              onClick={() => (isMenuOpen ? onClose() : onOpenRoot(rootIndex, true))}
              onMouseEnter={() => {
                if (state) {
                  onOpenRoot(rootIndex, state.menuOpen);
                }
              }}
            >
              {menuRootLabelFromRegistry(root, language)}
            </button>
          );
        })}
      </nav>
      <time className="clock" dateTime={now.toISOString()}>{formatLocalClock(now)}</time>
      {state?.menuOpen && activeRoot ? (
        <MenuPopoverContent
          language={language}
          root={activeRoot}
          rootIndex={state.rootIndex}
          nodes={activeNodes}
          state={state}
          onStateChange={onStateChange}
          onOpenAction={onOpenAction}
        />
      ) : null}
    </header>
  );
}

function MenuPopoverContent({ language, root, rootIndex, nodes, state, onStateChange, onOpenAction }: {
  language: Settings['language'];
  root: string;
  rootIndex: number;
  nodes: readonly MenuNode[];
  state: TopMenuState;
  onStateChange(next: TopMenuState): void;
  onOpenAction(action: AppAction): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('menu-popover');

  return (
    <div
      className="menu-popover"
      role="menu"
      aria-label={`${menuRootLabelFromRegistry(root, language)} menu`}
      style={{ '--menu-root-index': rootIndex } as CSSProperties}
      {...keyboardBoundaryProps}
    >
      {nodes.map((node, itemIndex) => {
        const focused = state.itemIndex === itemIndex;
        if (node.kind === 'submenu') {
          const submenuOpen = focused && state.submenuIndex !== null;
          return (
            <div key={node.id} className="menu-entry-with-submenu">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={submenuOpen}
                className={`menu-item ${focused ? 'is-focused' : ''}`}
                onMouseEnter={() => onStateChange({ ...state, itemIndex, submenuIndex: 0 })}
                onClick={() => onStateChange({ ...state, itemIndex, submenuIndex: submenuOpen ? null : 0 })}
              >
                <span>{node.label}</span>
                <kbd>›</kbd>
              </button>
              {submenuOpen ? (
                <div className="menu-submenu" role="menu" aria-label={`${node.label} submenu`}>
                  {node.children.map((child, submenuIndex) => (
                    <button
                      key={child.id}
                      type="button"
                      role="menuitem"
                      className={`menu-item ${child.checkable ? 'is-checkable' : ''} ${state.submenuIndex === submenuIndex ? 'is-focused' : ''}`}
                      disabled={!child.enabled}
                      onMouseEnter={() => onStateChange({ ...state, itemIndex, submenuIndex })}
                      onClick={() => {
                        if (child.enabled) {
                          onOpenAction(child.action);
                        }
                      }}
                      data-checked={child.checkable ? (child.checked ? 'true' : 'false') : undefined}
                      aria-checked={child.checkable ? child.checked : undefined}
                    >
                      {child.checkable ? <span className="menu-checkmark" aria-hidden="true">{child.checked ? '✓' : ''}</span> : null}
                      <span>{child.label}</span>
                      <kbd>{menuShortcutLabel(child.action)}</kbd>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <button
            key={node.id}
            type="button"
            role="menuitem"
            className={`menu-item ${focused ? 'is-focused' : ''}`}
            disabled={!node.enabled}
            onMouseEnter={() => onStateChange({ ...state, itemIndex, submenuIndex: null })}
            onClick={() => {
              if (node.enabled) {
                onOpenAction(node.action);
              }
            }}
            data-checked={node.checkable ? (node.checked ? 'true' : 'false') : undefined}
            aria-checked={node.checkable ? node.checked : undefined}
          >
            <span>{node.label}</span>
            {node.checkable ? (
              <kbd className="menu-checkmark-inline" aria-hidden="true">{node.checked ? '✓' : ''}</kbd>
            ) : (
              <kbd>{menuShortcutLabel(node.action)}</kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}

const menuShortcutLabel = (action: AppAction) => {
  if (!action.shortcutLabel && !action.keyboardBindings?.length) {
    return '';
  }
  return shortcutLabelForAction(action);
};

export interface PanelColumnLayout {
  showModified: boolean;
  showSize: boolean;
  showPermissions: boolean;
  showCreated: boolean;
  showOwner: boolean;
  dateFormat: 'short' | 'long';
  cssClass: string;
  gridTemplateColumns: string;
}

const BASE_COLUMN_CHAR_WIDTH_PX = 8;
const MIN_NAME_CONTENT_CHARS = 30;
const NAME_MIN_WIDTH_RATIO = 0.48;
const CELL_HORIZONTAL_PADDING_CHARS = 3;
const COLUMN_MIN_CHARS = {
  name: MIN_NAME_CONTENT_CHARS,
  modifiedShort: 12,
  modifiedLong: 17,
  size: 10,
  permissions: 11,
  created: 17,
  owner: 14,
};

interface PanelMetadataColumnWidths {
  modifiedShort: number;
  modifiedLong: number;
  size: number;
  permissions: number;
  created: number;
  owner: number;
}

const metadataColumnWidthsForEntries = (entries: readonly FileEntry[], sizeFormat: Settings['sizeFormat'] = 'binary'): PanelMetadataColumnWidths => {
  const maxWidth = (values: string[], base: number) =>
    Math.max(base, ...values.map((value) => textDisplayWidth(value)));

  return {
    modifiedShort: maxWidth(
      entries.map((entry) => formatDate(entry.modifiedAt, 'short') || '-'),
      COLUMN_MIN_CHARS.modifiedShort,
    ),
    modifiedLong: maxWidth(
      entries.map((entry) => formatDate(entry.modifiedAt, 'long') || '-'),
      COLUMN_MIN_CHARS.modifiedLong,
    ),
    size: maxWidth(entries.map((entry) => formatSize(entry, sizeFormat) || '-'), COLUMN_MIN_CHARS.size),
    permissions: maxWidth(entries.map((entry) => entry.permissions ?? '-'), COLUMN_MIN_CHARS.permissions),
    created: maxWidth(
      entries.map((entry) => formatDate(entry.createdAt, 'long') || '-'),
      COLUMN_MIN_CHARS.created,
    ),
    owner: maxWidth(entries.map((entry) => formatOwnerGroup(entry)), COLUMN_MIN_CHARS.owner),
  };
};

export const columnLayoutForPanelWidth = (
  widthPx: number,
  scale = 1,
  entriesOrWidths: readonly FileEntry[] | PanelMetadataColumnWidths = [],
): PanelColumnLayout => {
  const width = Math.floor(widthPx / (BASE_COLUMN_CHAR_WIDTH_PX * scale));
  const columnWidths = (Array.isArray(entriesOrWidths)
    ? metadataColumnWidthsForEntries(entriesOrWidths)
    : entriesOrWidths) as PanelMetadataColumnWidths;
  const fits = (...metadataWidths: number[]) =>
    width >= nameBudgetForWidth(width) + metadataBudget(metadataWidths);

  if (fits(columnWidths.size, columnWidths.modifiedLong, columnWidths.created, columnWidths.permissions, columnWidths.owner)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: true,
      showCreated: true,
      showOwner: true,
      dateFormat: 'long',
      cssClass: 'columns-owner',
      gridTemplateColumns: gridTemplateColumnsFor([
        columnWidths.size,
        columnWidths.modifiedLong,
        columnWidths.created,
        columnWidths.permissions,
        columnWidths.owner,
      ]),
    };
  }
  if (fits(columnWidths.size, columnWidths.modifiedLong, columnWidths.created, columnWidths.permissions)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: true,
      showCreated: true,
      showOwner: false,
      dateFormat: 'long',
      cssClass: 'columns-created',
      gridTemplateColumns: gridTemplateColumnsFor([
        columnWidths.size,
        columnWidths.modifiedLong,
        columnWidths.created,
        columnWidths.permissions,
      ]),
    };
  }
  if (fits(columnWidths.size, columnWidths.modifiedLong, columnWidths.permissions)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: true,
      showCreated: false,
      showOwner: false,
      dateFormat: 'long',
      cssClass: 'columns-permissions',
      gridTemplateColumns: gridTemplateColumnsFor([
        columnWidths.size,
        columnWidths.modifiedLong,
        columnWidths.permissions,
      ]),
    };
  }
  if (fits(columnWidths.size, columnWidths.modifiedShort)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: false,
      showCreated: false,
      showOwner: false,
      dateFormat: 'short',
      cssClass: 'columns-basic',
      gridTemplateColumns: gridTemplateColumnsFor([columnWidths.size, columnWidths.modifiedShort]),
    };
  }
  if (fits(columnWidths.modifiedShort)) {
    return {
      showModified: true,
      showSize: false,
      showPermissions: false,
      showCreated: false,
      showOwner: false,
      dateFormat: 'short',
      cssClass: 'columns-name-date',
      gridTemplateColumns: gridTemplateColumnsFor([columnWidths.modifiedShort]),
    };
  }
  return {
    showModified: false,
    showSize: false,
    showPermissions: false,
    showCreated: false,
    showOwner: false,
    dateFormat: 'short',
    cssClass: 'columns-name-only',
    gridTemplateColumns: gridTemplateColumnsFor([]),
  };
};

const nameBudgetForWidth = (widthChars: number) =>
  Math.max(COLUMN_MIN_CHARS.name, Math.ceil(widthChars * NAME_MIN_WIDTH_RATIO)) + CELL_HORIZONTAL_PADDING_CHARS;

const metadataBudget = (metadataWidths: number[]) =>
  metadataWidths.reduce((total, columnWidth) => total + columnWidth + CELL_HORIZONTAL_PADDING_CHARS, 0);

const gridTemplateColumnsFor = (metadataWidths: number[]) =>
  [
    'minmax(0, 1fr)',
    ...metadataWidths.map((columnWidth) => `calc(${columnWidth}ch + var(--cell-padding-x) * 2)`),
  ].join(' ');

const useElementWidth = <T extends HTMLElement>(ref: RefObject<T | null>, fallbackWidth: number) => {
  const [width, setWidth] = useState(fallbackWidth);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return undefined;
    }

    const updateWidth = () => {
      const measuredWidth = element.getBoundingClientRect().width;
      if (measuredWidth > 0) {
        setWidth(Math.round(measuredWidth));
      }
    };

    updateWidth();

    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(updateWidth);
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, [ref]);

  return width;
};

interface FilePanelProps {
  panel: PanelNavigationState;
  comparisonByPath: Record<string, DirectoryComparisonState> | null;
  active: boolean;
  hiddenByLayout: boolean;
  tabCount: number;
  rowHeightPx: number;
  scale: number;
  sizeFormat: Settings['sizeFormat'];
  language: Settings['language'];
  showIcons: boolean;
  operationBusy: boolean;
  backendAvailable: boolean;
  onActivate(): void;
  onStateChange(next: PanelUiPatch): void;
  onEntrySelect(index: number, entry: FileEntry, mode: SelectionMode): void;
  onEntryOpen(entry: FileEntry): void;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
  onEntryDragStart(entry: FileEntry): void;
  onPanelDrop(event: DragEvent<HTMLElement>): void;
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onRefresh(): void;
  onGotoPath(): void;
  onClearFilter(): void;
  onRestoreFocus(): void;
}

function FilePanel({
  panel,
  comparisonByPath,
  active,
  hiddenByLayout,
  tabCount,
  rowHeightPx,
  scale,
  sizeFormat,
  language,
  showIcons,
  operationBusy,
  backendAvailable,
  onActivate,
  onStateChange,
  onEntrySelect,
  onEntryOpen,
  onOpenAction,
  onEntryDragStart,
  onPanelDrop,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onRefresh,
  onGotoPath,
  onClearFilter,
  onRestoreFocus,
}: FilePanelProps) {
  const { listing } = panel;
  const panelRef = useRef<HTMLElement>(null);
  const panelWidth = useElementWidth(panelRef, 760);
  const metadataColumnWidths = useMemo(
    () => metadataColumnWidthsForEntries(listing.entries, sizeFormat),
    [listing.entries, sizeFormat],
  );
  const columnLayout = useMemo(
    () => columnLayoutForPanelWidth(panelWidth, scale, metadataColumnWidths),
    [panelWidth, scale, metadataColumnWidths],
  );
  const fileTableStyle = {
    '--file-grid-template': columnLayout.gridTemplateColumns,
  } as CSSProperties;
  const labels = COMMANDER_UI_TEXT[language];
  const tableColumns = useMemo<ColumnDef<FileEntry>[]>(() => {
    const columns: ColumnDef<FileEntry>[] = [
      {
        id: 'name',
        header: `${labels.name} ${panel.sort.field === 'name' ? sortMarker(panel.sort.direction) : ''}`,
        cell: ({ row }) => (
            <span className="entry-name">
              {showIcons ? <span className="entry-icon" aria-hidden="true">{entryIcon(row.original.kind)}</span> : null}
              <MiddleEllipsisEntryName name={row.original.name} filter={listing.filter} />
            </span>
          ),
      },
    ];

    if (columnLayout.showSize) {
      columns.push({
        id: 'size',
        header: `${labels.size} ${panel.sort.field === 'size' ? sortMarker(panel.sort.direction) : ''}`,
        cell: ({ row }) => formatSize(row.original, sizeFormat),
      });
    }

    if (columnLayout.showModified) {
      columns.push({
        id: 'modified',
        header: `${labels.modified} ${panel.sort.field === 'modifiedAt' ? sortMarker(panel.sort.direction) : ''}`,
        cell: ({ row }) => formatDate(row.original.modifiedAt, columnLayout.dateFormat),
      });
    }

    if (columnLayout.showCreated) {
      columns.push({
        id: 'created',
        header: labels.created,
        cell: ({ row }) => formatDate(row.original.createdAt, columnLayout.dateFormat),
      });
    }

    if (columnLayout.showPermissions) {
      columns.push({
        id: 'permissions',
        header: labels.permissions,
        cell: ({ row }) => row.original.permissions ?? '-',
      });
    }

    if (columnLayout.showOwner) {
      columns.push({
        id: 'owner',
        header: labels.owner,
        cell: ({ row }) => formatOwnerGroup(row.original),
      });
    }

    return columns;
  }, [columnLayout, labels, listing.filter, panel.sort.direction, panel.sort.field, showIcons, sizeFormat]);

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
    estimateSize: () => rowHeightPx,
    initialRect: { width: 640, height: 520 },
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const renderedRows = virtualRows.length > 0
    ? virtualRows
    : rows.slice(0, Math.min(rows.length, 24)).map((_, index) => ({
        index,
        start: index * rowHeightPx,
      }));
  const summary = summarizeEntries(listing.entries);

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeightPx, virtualizer]);

  useEffect(() => {
    if (rows.length > 0) {
      virtualizer.scrollToIndex(panel.focusedIndex, { align: 'auto' });
    }
  }, [panel.focusedIndex, rows.length, virtualizer]);

  return (
    <section
      ref={panelRef}
      className={`file-panel ${active ? 'is-active' : ''} ${hiddenByLayout ? 'is-hidden-by-layout' : ''}`}
      aria-label={`${listing.panelId} panel ${listing.path}`}
      aria-current={active ? 'true' : undefined}
      aria-hidden={hiddenByLayout ? 'true' : undefined}
      onMouseDown={onActivate}
      onDragOver={(event) => event.preventDefault()}
      onDrop={onPanelDrop}
    >
      <PanelHeader panel={panel} active={active} tabCount={tabCount} language={language} onClearFilter={onClearFilter} />
      <PathControls
        panel={panel}
        language={language}
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
        onNavigateUp={onNavigateUp}
        onRefresh={onRefresh}
        onGotoPath={onGotoPath}
        onRestoreFocus={onRestoreFocus}
      />
      <div className="file-table" role="table" aria-rowcount={listing.entries.length} style={fileTableStyle}>
        <div className="file-table-head" role="rowgroup">
          {table.getHeaderGroups().map((headerGroup) => (
            <div className={`file-table-row file-table-heading ${columnLayout.cssClass}`} role="row" key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <span key={header.id} role="columnheader" className={`file-cell file-cell-${header.id}`}>
                  {flexRender(header.column.columnDef.header, header.getContext())}
                </span>
              ))}
            </div>
          ))}
        </div>
        <ContextMenu.Root>
          <ContextMenu.Trigger asChild>
            <div ref={scrollRef} className="file-table-scroll" role="rowgroup">
              {panel.error || rows.length === 0 ? (
                <PanelMessageRow panel={panel} language={language} />
              ) : (
                <div className="file-table-virtual-space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
                  {renderedRows.map((virtualRow) => {
                const row = rows[virtualRow.index];
                const entry = row.original;
                const focused = virtualRow.index === panel.focusedIndex;
                const selected = panel.selectedPaths.includes(entry.path);
                const comparisonState = comparisonByPath?.[entry.path] ?? null;
                const comparisonLabel = comparisonState ? directoryComparisonLabel(comparisonState, language) : null;
                const tooltip = comparisonLabel
                  ? `${fileEntryTooltip(entry, language)}\n${comparisonLabel}`
                  : fileEntryTooltip(entry, language);
                const accessibleName = fileEntryAccessibleLabel(entry, language);
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
                        className={`file-table-row file-row ${columnLayout.cssClass} entry-row-kind-${entry.kind} ${focused ? 'is-focused' : ''} ${selected ? 'is-selected' : ''} ${comparisonState ? `is-compare-${comparisonState}` : ''}`}
                        data-compare-state={comparisonState ?? undefined}
                        style={{ transform: `translateY(${virtualRow.start}px)` }}
                        title={tooltip}
                        aria-label={accessibleName}
                        aria-description={tooltip}
                        draggable={!entry.isVirtual}
                        onDragStart={() => onEntryDragStart(entry)}
                        onClick={(event) => onEntrySelect(
                          virtualRow.index,
                          entry,
                          event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'additive' : 'replace',
                        )}
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
                        language={language}
                        entry={entry}
                        listing={listing}
                        selectedPaths={panel.selectedPaths}
                        operationBusy={operationBusy}
                        backendAvailable={backendAvailable}
                        onOpenAction={onOpenAction}
                      />
                    </ContextMenu.Portal>
                  </ContextMenu.Root>
                );
                  })}
                </div>
              )}
            </div>
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <BlankContextMenuContent
              language={language}
              listing={listing}
              operationBusy={operationBusy}
              backendAvailable={backendAvailable}
              onOpenAction={onOpenAction}
            />
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>
      <footer className="panel-status">
        <span>{summary.files} {labels.files}, {summary.dirs} {labels.dirs}</span>
        <span>{panel.selectedPaths.length} {labels.selected}</span>
        {isArchiveVirtualPath(listing.path) ? (
          <span className="panel-archive-readonly">{labels.archiveReadOnly}</span>
        ) : null}
        {listing.truncated ? (
          <span className="panel-archive-truncated" title={`${listing.entries.length}/${listing.totalEntries ?? listing.entries.length}`}>
            {labels.partialArchive}
          </span>
        ) : null}
        {panel.filter ? <span className="panel-filter-status">{labels.filter}: {panel.filter}</span> : null}
        <span>{active ? labels.active : labels.target}</span>
      </footer>
    </section>
  );
}

function PanelMessageRow({ panel, language }: { panel: PanelNavigationState; language: Settings['language'] }) {
  const labels = COMMANDER_UI_TEXT[language];
  let message: string = labels.emptyDirectory;
  if (panel.loading) {
    message = labels.loadingDirectory;
  } else if (panel.error) {
    message = `${labels.errorPrefix}: ${formatUserErrorMessage(language, panel.error)}`;
  }
  return (
    <div className="file-table-message" role="row" aria-live="polite">
      <span role="cell">{message}</span>
    </div>
  );
}


function BlankContextMenuContent({ language, listing, operationBusy, backendAvailable, onOpenAction }: {
  language: Settings['language'];
  listing: DirectoryListing;
  operationBusy: boolean;
  backendAvailable: boolean;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const context = createActionContext({
    activePanel: listing.panelId,
    focusedEntry: null,
    selectedCount: 0,
    hasConcreteFocus: false,
    effectiveTargetCount: 0,
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy,
    backendAvailable,
    activePathIsArchive: isArchiveVirtualPath(listing.path),
  });
  const actions = blankContextMenuActions(context, Boolean(listing.filter));

  return (
    <ContextMenu.Content className="context-menu" {...keyboardBoundaryProps}>
      <ContextMenu.Label className="context-label">{listing.path}</ContextMenu.Label>
      {actions.map((action) => (
        <ContextMenu.Item
          key={action.id}
          className="context-item"
          onSelect={() => onOpenAction(action, [])}
        >
          <span>{labelForAction(action, language)}</span>
          {action.shortcutLabel ? <kbd>{action.shortcutLabel}</kbd> : null}
        </ContextMenu.Item>
      ))}
    </ContextMenu.Content>
  );
}

function EntryContextMenuContent({ language, entry, listing, selectedPaths, operationBusy, backendAvailable, onOpenAction }: {
  language: Settings['language'];
  entry: FileEntry;
  listing: DirectoryListing;
  selectedPaths: readonly string[];
  operationBusy: boolean;
  backendAvailable: boolean;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const contextSources = contextMenuSources(entry, listing, selectedPaths);
  const context = createActionContext({
    activePanel: listing.panelId,
    focusedEntry: entry,
    selectedCount: contextSources.length,
    hasConcreteFocus: !entry.isVirtual,
    effectiveTargetCount: contextSources.length,
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy,
    backendAvailable,
    activePathIsArchive: isArchiveVirtualPath(listing.path),
  });

  return (
    <ContextMenu.Content className="context-menu" {...keyboardBoundaryProps}>
      <ContextMenu.Label className="context-label">{entry.name}</ContextMenu.Label>
      {contextMenuActions(entry, context).map((action) => (
        <ContextMenu.Item
          key={action.id}
          className="context-item"
          onSelect={() => onOpenAction(action, contextSources)}
        >
          <span>{labelForAction(action, language)}</span>
          <kbd>{shortcutLabelForAction(action)}</kbd>
        </ContextMenu.Item>
      ))}
    </ContextMenu.Content>
  );
}

const contextMenuSources = (entry: FileEntry, listing: DirectoryListing, selectedPaths: readonly string[]) => {
  if (entry.isVirtual) {
    return [];
  }
  const selectedSet = new Set(selectedPaths);
  if (!selectedSet.has(entry.path)) {
    return [entry];
  }
  const selectedEntries = listing.entries.filter((candidate) => selectedSet.has(candidate.path) && !candidate.isVirtual);
  return selectedEntries.length > 0 ? selectedEntries : [entry];
};


const shouldClearSourceSelectionAfterOperation = (
  summary: OperationSummary,
  dialogKind: DialogKind,
) => {
  const skippedFiles = summary.skippedFiles ?? 0;
  return summary.state === 'completed' && summary.failedFiles === 0 && skippedFiles === 0 && sourceSelectionConsumingDialogKinds.has(dialogKind);
};

const sourceSelectionConsumingDialogKinds = new Set<DialogKind>([
  'copy',
  'move',
  'trash',
  'deletePermanent',
  'archiveCreate',
  'archiveExtract',
]);

const sourcesBelongToListing = (sources: readonly FileEntry[], listing: DirectoryListing) => {
  const listingPaths = new Set(listing.entries.filter((entry) => !entry.isVirtual).map((entry) => entry.path));
  return sources.every((source) => listingPaths.has(source.path));
};

interface ArchiveCopyPlan {
  archivePath: string;
  entries: string[];
  stripPrefix: string;
  password?: string;
}

interface ArchiveAddPlan {
  archivePath: string;
  targetInnerDir: string;
}

const archiveCopyPlanForSources = (
  sources: readonly FileEntry[],
  workingDir: string,
  targetDir: string,
  password?: string,
): ArchiveCopyPlan | null => {
  if (sources.length === 0 || isArchiveVirtualPath(targetDir)) {
    return null;
  }
  const workingArchive = parseArchiveVirtualPath(workingDir);
  if (!workingArchive) {
    return null;
  }
  const parsedSources = sources.map((source) => parseArchiveVirtualPath(source.path));
  if (parsedSources.some((source) => !source || !source.innerPath || source.archivePath !== workingArchive.archivePath)) {
    return null;
  }
  return {
    archivePath: workingArchive.archivePath,
    entries: [...new Set(parsedSources.map((source) => source?.innerPath).filter(Boolean) as string[])],
    stripPrefix: workingArchive.innerPath,
    password,
  };
};

const archiveAddPlanForTarget = (
  sources: readonly FileEntry[],
  targetDir: string,
): ArchiveAddPlan | null => {
  const target = parseArchiveVirtualPath(targetDir);
  if (!target || sources.length === 0 || sources.some((source) => source.isVirtual || isArchiveVirtualPath(source.path))) {
    return null;
  }
  return {
    archivePath: target.archivePath,
    targetInnerDir: target.innerPath,
  };
};

function PanelHeader({
  panel,
  active,
  tabCount,
  language,
  onClearFilter,
}: {
  panel: PanelNavigationState;
  active: boolean;
  tabCount: number;
  language: Settings['language'];
  onClearFilter(): void;
}) {
  const labels = COMMANDER_UI_TEXT[language];
  return (
    <header className="panel-header">
      <span className="panel-path" title={panel.path}>· {shortenPath(panel.path)}</span>
      {panel.filter ? (
        <button type="button" className="filter-chip" aria-label={`${labels.filter} ${panel.filter} ${labels.target}`} onClick={onClearFilter}>
          {labels.filter.toUpperCase()} {panel.filter} ×
        </button>
      ) : null}
      <span className="panel-tabs">{labels.tabs} {tabCount}</span>
      <span className={`panel-marker ${active ? 'active' : ''}`}>{active ? labels.active : labels.passive}</span>
      {panel.loading ? <span className="panel-loading">{labels.loading}</span> : null}
    </header>
  );
}

function PathControls({
  panel,
  language,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onRefresh,
  onGotoPath,
  onRestoreFocus,
}: {
  panel: PanelNavigationState;
  language: Settings['language'];
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onRefresh(): void;
  onGotoPath(): void;
  onRestoreFocus(): void;
}) {
  const labels = COMMANDER_UI_TEXT[language];
  const runNavigation = (callback: () => void) => {
    callback();
    window.requestAnimationFrame(() => onRestoreFocus());
  };

  return (
    <div className="path-controls" aria-label={`${panelIdLabel(panel.listing.panelId, language)} ${labels.navigationControls}`}>
      <button type="button" aria-label={labels.back} disabled={!panelCanGoBack(panel)} onClick={() => runNavigation(onNavigateBack)}>◀</button>
      <button type="button" aria-label={labels.forward} disabled={!panelCanGoForward(panel)} onClick={() => runNavigation(onNavigateForward)}>▶</button>
      <button type="button" aria-label={labels.up} onClick={() => runNavigation(onNavigateUp)}>↑</button>
      <button type="button" aria-label={labels.refresh} onClick={() => runNavigation(onRefresh)}>⟳</button>
      <span className="path-input" title={panel.path}>{panel.path}</span>
      <button type="button" aria-label={labels.gotoPath} onClick={onGotoPath}>⌘</button>
    </div>
  );
}

const panelIdLabel = (panelId: PanelId, language: Settings['language']) => {
  return PANEL_ID_LABELS[language][panelId];
};

function BottomStatusStrip({
  language,
  listing,
  activePanel,
  selectedCount,
  selectedBytes,
  message,
  filter,
}: {
  language: Settings['language'];
  listing: DirectoryListing;
  activePanel: PanelId;
  selectedCount: number;
  selectedBytes: number;
  message: string | null;
  filter: string | null;
}) {
  const summary = summarizeEntries(listing.entries);
  const labels = COMMANDER_UI_TEXT[language];
  return (
    <footer className="bottom-status" aria-label={labels.activePanelStatus}>
      <span>{summary.files} {labels.files}, {summary.dirs} {labels.dirs}</span>
      <span>{selectedCount} {labels.selected}{selectedBytes ? ` · ${formatBytes(selectedBytes)}` : ''}</span>
      {filter ? <span className="status-filter">{labels.filter}: {filter}</span> : null}
      <span>{panelIdLabel(activePanel, language)}</span>
      {message ? <span className="status-message" aria-live="polite">{message}</span> : null}
    </footer>
  );
}

function HighlightedEntryName({ name, filter }: { name: string; filter: string | null }) {
  const segments = filterMatchSegments(name, filter);
  return (
    <>
      {segments.map((segment, index) => segment.matched ? (
        <mark className="filter-match" key={`${segment.text}-${index}`}>{segment.text}</mark>
      ) : (
        <span key={`${segment.text}-${index}`}>{segment.text}</span>
      ))}
    </>
  );
}

function MiddleEllipsisEntryName({ name, filter }: { name: string; filter: string | null }) {
  const { start, end } = splitMiddleEllipsisParts(name);
  if (!end) {
    return (
      <span className="middle-ellipsis" aria-label={name}>
        <span className="middle-ellipsis-start">
          <HighlightedEntryName name={start} filter={filter} />
        </span>
      </span>
    );
  }
  return (
    <span className="middle-ellipsis" aria-label={name}>
      <span className="middle-ellipsis-start">
        <HighlightedEntryName name={start} filter={filter} />
      </span>
      <span className="middle-ellipsis-mark" aria-hidden="true">…</span>
      <span className="middle-ellipsis-end">
        <HighlightedEntryName name={end} filter={filter} />
      </span>
      <span className="sr-only">{name}</span>
    </span>
  );
}

const HOTKEY_STRIP_HORIZONTAL_PADDING_PX = 24;
const HOTKEY_STRIP_ITEM_PADDING_PX = 22;
const HOTKEY_STRIP_CHAR_WIDTH_PX = 9;
const HOTKEY_STRIP_MIN_VISIBLE = 6;

export const hotkeyStripActionsForWidth = (
  widthPx: number,
  scale = 1,
  actions: readonly AppAction[] = hotkeyStripActionsFromRegistry(),
  language: Settings['language'] = 'en',
) => {
  const availableWidth = Math.max(0, widthPx - HOTKEY_STRIP_HORIZONTAL_PADDING_PX * scale);
  const estimateActionWidth = (action: AppAction) => {
    const shortcut = shortcutLabelForAction(action);
    const label = hotkeyLabelForAction(action, language);
    return Math.ceil((shortcut.length + label.length + 2) * HOTKEY_STRIP_CHAR_WIDTH_PX * scale)
      + HOTKEY_STRIP_ITEM_PADDING_PX * scale;
  };

  let usedWidth = 0;
  const visible: AppAction[] = [];
  for (const action of actions) {
    const itemWidth = estimateActionWidth(action);
    if (visible.length < HOTKEY_STRIP_MIN_VISIBLE || usedWidth + itemWidth <= availableWidth) {
      visible.push(action);
      usedWidth += itemWidth;
    }
  }
  return visible;
};

function HotkeyStrip({ scale, language }: { scale: number; language: Settings['language'] }) {
  const stripRef = useRef<HTMLElement>(null);
  const stripWidth = useElementWidth(stripRef, 960);
  const visibleActions = useMemo(
    () => hotkeyStripActionsForWidth(stripWidth, scale, undefined, language),
    [language, scale, stripWidth],
  );
  const hiddenCount = hotkeyStripActionsFromRegistry().length - visibleActions.length;
  return (
    <footer
      ref={stripRef}
      className="hotkey-strip"
      aria-label="hotkey hints"
      title={hiddenCount > 0 ? HOTKEY_STRIP_TEXT[language].hiddenShortcuts(hiddenCount) : HOTKEY_STRIP_TEXT[language].allVisible}
    >
      {visibleActions.map((action) => {
        const shortcut = shortcutLabelForAction(action);
        return (
          <span className="hotkey" key={action.id}>
            <kbd>{shortcut}</kbd>:<span>{hotkeyLabelForAction(action, language)}</span>
          </span>
        );
      })}
      {hiddenCount > 0 ? <span className="hotkey hotkey-more" aria-label={HOTKEY_STRIP_TEXT[language].hiddenShortcutLabel(hiddenCount)}>+{hiddenCount}</span> : null}
    </footer>
  );
}


const BLANK_CONTEXT_ACTION_IDS = new Set<ActionId>([
  'file.mkdir',
  'nav.refresh',
  'nav.gotoPath',
  'filter.start',
  'filter.clear',
  'view.sortName',
  'view.sortSize',
  'view.sortDate',
  'view.sortExt',
  'view.toggleHidden',
]);

export const blankContextMenuActions = (context: ActionContext, hasFilter: boolean) => filterEnabledActions(
  ACTIONS.filter((action) => BLANK_CONTEXT_ACTION_IDS.has(action.id as ActionId))
    .filter((action) => hasFilter || action.id !== 'filter.clear'),
  context,
);

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

export const splitMiddleEllipsisParts = (name: string): { start: string; end: string | null } => {
  const clusters = graphemeClusters(name);
  if (clusters.length <= 24) {
    return { start: name, end: null };
  }
  const extension = name.match(/(\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.[^.]{1,8})$/i)?.[1] ?? '';
  const preserveEndLength = clampNumber(Math.max(12, graphemeClusters(extension).length + 8), 12, 18);
  if (clusters.length <= preserveEndLength + 8) {
    return { start: name, end: null };
  }
  return {
    start: clusters.slice(0, -preserveEndLength).join(''),
    end: clusters.slice(-preserveEndLength).join(''),
  };
};

type GraphemeSegmenter = {
  segment(value: string): Iterable<{ segment: string }>;
};

type GraphemeSegmenterConstructor = new (
  locales?: string | string[],
  options?: { granularity: 'grapheme' },
) => GraphemeSegmenter;

const graphemeClusters = (value: string) => {
  const Segmenter = (Intl as typeof Intl & { Segmenter?: GraphemeSegmenterConstructor }).Segmenter;
  if (Segmenter) {
    return [...new Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((part) => part.segment);
  }
  return fallbackGraphemeClusters(value);
};

const fallbackGraphemeClusters = (value: string) => {
  const codePoints = Array.from(value);
  const clusters: string[] = [];

  for (const codePoint of codePoints) {
    const previous = clusters.at(-1);
    if (
      !previous
      || !(isCombiningMark(codePoint)
        || isVariationSelector(codePoint)
        || isEmojiModifier(codePoint)
        || codePoint === ZERO_WIDTH_JOINER
        || previous.endsWith(ZERO_WIDTH_JOINER))
    ) {
      clusters.push(codePoint);
      continue;
    }
    clusters[clusters.length - 1] = `${previous}${codePoint}`;
  }

  return clusters;
};

const textDisplayWidth = (value: string) =>
  graphemeClusters(value).reduce((width, cluster) => width + graphemeDisplayWidth(cluster), 0);

const graphemeDisplayWidth = (cluster: string) => {
  if (!cluster || [...cluster].every((codePoint) => isCombiningMark(codePoint) || isVariationSelector(codePoint))) {
    return 0;
  }
  return /[\p{Script=Hangul}\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Emoji_Presentation}\p{Extended_Pictographic}]/u.test(cluster)
    ? 2
    : 1;
};

const ZERO_WIDTH_JOINER = '\u200d';
const isCombiningMark = (value: string) => /^\p{Mark}$/u.test(value);
const isVariationSelector = (value: string) => /^[\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]$/u.test(value);
const isEmojiModifier = (value: string) => /^\p{Emoji_Modifier}$/u.test(value);

const shortenPath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 4) {
    return normalized.startsWith('/') ? `/${parts.join('/')}` : parts.join('/');
  }
  return `/${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`;
};

const oppositePanelOf = (panelId: PanelId): PanelId => (panelId === 'left' ? 'right' : 'left');

const reassignPanelState = (panel: PanelNavigationState, panelId: PanelId): PanelNavigationState => ({
  ...panel,
  listing: { ...panel.listing, panelId },
});

const compareDirectoryListings = (left: DirectoryListing, right: DirectoryListing): DirectoryComparison => {
  const leftEntries = new Map(left.entries.filter((entry) => !entry.isVirtual).map((entry) => [entry.name, entry]));
  const rightEntries = new Map(right.entries.filter((entry) => !entry.isVirtual).map((entry) => [entry.name, entry]));
  const byPanel: DirectoryComparison['byPanel'] = { left: {}, right: {} };
  let same = 0;
  let different = 0;
  let leftOnly = 0;
  let rightOnly = 0;

  for (const [name, leftEntry] of leftEntries) {
    const rightEntry = rightEntries.get(name);
    if (!rightEntry) {
      byPanel.left[leftEntry.path] = 'left-only';
      leftOnly += 1;
      continue;
    }
    const state: DirectoryComparisonState = entriesMatchForComparison(leftEntry, rightEntry) ? 'same' : 'different';
    byPanel.left[leftEntry.path] = state;
    byPanel.right[rightEntry.path] = state;
    if (state === 'same') same += 1;
    else different += 1;
  }

  for (const [name, rightEntry] of rightEntries) {
    if (!leftEntries.has(name)) {
      byPanel.right[rightEntry.path] = 'right-only';
      rightOnly += 1;
    }
  }

  return { byPanel, same, different, leftOnly, rightOnly };
};

const entriesMatchForComparison = (left: FileEntry, right: FileEntry) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'directory') return true;
  return left.sizeBytes === right.sizeBytes && left.modifiedAt === right.modifiedAt;
};

const directoryComparisonLabel = (state: DirectoryComparisonState, language: Settings['language']) => {
  const labels: Record<Settings['language'], Record<DirectoryComparisonState, string>> = {
    ko: { same: '폴더 비교: 동일', different: '폴더 비교: 내용 다름', 'left-only': '폴더 비교: 왼쪽에만 있음', 'right-only': '폴더 비교: 오른쪽에만 있음' },
    en: { same: 'Directory compare: same', different: 'Directory compare: different', 'left-only': 'Directory compare: left only', 'right-only': 'Directory compare: right only' },
  };
  return labels[language][state];
};

const rowDomId = (panelId: PanelId, index: number) => `commander-row-${panelId}-${index}`;

const selectedPathsInRange = (entries: readonly FileEntry[], anchorIndex: number, focusIndex: number) => {
  const start = Math.max(0, Math.min(anchorIndex, focusIndex));
  const end = Math.min(entries.length - 1, Math.max(anchorIndex, focusIndex));
  return entries
    .slice(start, end + 1)
    .filter((entry) => !entry.isVirtual)
    .map((entry) => entry.path);
};

const filterMatchSegments = (name: string, filter: string | null): Array<{ text: string; matched: boolean }> => {
  const pattern = filter?.trim();
  if (!pattern) {
    return [{ text: name, matched: false }];
  }
  const matchStart = name.toLowerCase().indexOf(pattern.toLowerCase());
  if (matchStart < 0) {
    return [{ text: name, matched: false }];
  }
  const matchEnd = matchStart + pattern.length;
  return [
    { text: name.slice(0, matchStart), matched: false },
    { text: name.slice(matchStart, matchEnd), matched: true },
    { text: name.slice(matchEnd), matched: false },
  ].filter((segment) => segment.text.length > 0);
};

const uniqueNavigationItems = (items: readonly NavigationListItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) {
      return false;
    }
    seen.add(item.path);
    return true;
  });
};

const navigationItemsFromLocations = (locations: LocationList, settings: Settings): NavigationListItem[] => {
  const navigationText = COMMANDER_NAVIGATION_TEXT[settings.language];
  return (
  // The palette dedupes by path because navigation target identity matters more
  // than source provenance here; labels from earlier, higher-signal groups win.
  uniqueNavigationItems([
    { id: 'home', label: navigationText.locationHome, path: locations.home, group: 'location' },
    ...locations.roots.map((path, index) => ({
      id: `root-${index}-${path}`,
      label: navigationText.locationRoot(shortenPath(path)),
      path,
      group: 'root',
    })),
    ...locations.recent.map((path, index) => ({
      id: `recent-${index}-${path}`,
      label: navigationText.locationRecent(shortenPath(path)),
      path,
      group: 'recent',
    })),
    ...locations.bookmarks.map((bookmark) => ({
      id: `location-bookmark-${bookmark.id}`,
      label: bookmark.label,
      path: bookmark.path,
      group: 'location bookmark',
    })),
    ...settings.bookmarks.map((bookmark) => ({
      id: `settings-bookmark-${bookmark.id}`,
      label: bookmark.label,
      path: bookmark.path,
      group: 'bookmark',
    })),
  ])
  );
};

const sumEntryBytes = (entries: readonly FileEntry[]) =>
  entries.reduce((total, entry) => total + (entry.kind === 'directory' ? 0 : entry.sizeBytes ?? 0), 0);

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
};

const useLocalClock = () => {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
};

const formatLocalClock = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const handleZoomKey = (
  event: KeyboardEvent,
  handleZoom: (command: ZoomCommand) => void,
) => {
  if (!(event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    event.stopPropagation();
    handleZoom('in');
    return true;
  }
  if (event.key === '-') {
    event.preventDefault();
    event.stopPropagation();
    handleZoom('out');
    return true;
  }
  if (event.key === '0') {
    event.preventDefault();
    event.stopPropagation();
    handleZoom('reset');
    return true;
  }
  return false;
};

const atomicExecutorForAction = (
  actionId: ActionId,
  mutationClient: SafeMutationClient,
  settings: Settings,
): AtomicCommandExecutor | undefined => {
  if (actionId === 'file.mkdir') {
    return (dialog) =>
      mutationClient.createDir({ parent: dialog.targetDir ?? '', name: dialog.inputValue.trim() });
  }
  if (actionId === 'file.rename') {
    return (dialog) =>
      mutationClient.renameEntry({ path: dialog.sources[0]?.path ?? '', newName: dialog.inputValue.trim() });
  }
  if (actionId === 'file.properties') {
    return (dialog) => mutationClient.getMetadata
      ? mutationClient.getMetadata({ path: dialog.sources[0]?.path ?? dialog.targetDir ?? '' })
      : unsupportedClientResult('get_metadata', dialog.targetDir);
  }
  if (actionId === 'external.openDefault') {
    return (dialog) => mutationClient.openDefault
      ? mutationClient.openDefault({ path: dialog.sources[0]?.path ?? '' })
      : unsupportedClientResult('open_default', dialog.targetDir);
  }
  if (actionId === 'external.reveal') {
    return (dialog) => mutationClient.revealInManager
      ? mutationClient.revealInManager({ path: dialog.sources[0]?.path ?? '' })
      : unsupportedClientResult('reveal_in_manager', dialog.targetDir);
  }
  if (actionId === 'external.openEditor') {
    return (dialog) => mutationClient.openExternalEditor
      ? mutationClient.openExternalEditor({
          path: dialog.sources[0]?.path ?? '',
          editorId: settings.external.editorId ?? undefined,
        })
      : unsupportedClientResult('open_external_editor', dialog.targetDir);
  }
  if (actionId === 'external.runShellCommand') {
    return async (dialog) => {
      const parsed = parseShellCommandInput(dialog.inputValue);
      if (!parsed) {
        return {
          ok: false,
          error: {
            code: 'invalid_command',
            messageKey: 'errors.invalidShellCommand',
            path: dialog.targetDir,
            details: null,
            recoverable: true,
          },
        };
      }
      if (dialog.shellPreview?.policy.enabled && dialog.shellPreview.confirmToken !== 'disabled') {
        return mutationClient.runShellCommand ? mutationClient.runShellCommand({
          workingDir: dialog.targetDir ?? '',
          command: parsed.command,
          args: parsed.args,
          confirmToken: dialog.shellPreview.confirmToken,
        }) : unsupportedClientResult('run_shell_command', dialog.targetDir);
      }
      return mutationClient.prepareShellCommand ? mutationClient.prepareShellCommand({
        workingDir: dialog.targetDir ?? '',
        command: parsed.command,
        args: parsed.args,
      }) : unsupportedClientResult('prepare_shell_command', dialog.targetDir);
    };
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
      confirmToken: dialog.requiredConfirmationPhrase && dialog.inputValue.trim() === dialog.requiredConfirmationPhrase
        ? 'PERMANENT_DELETE'
        : undefined,
    });
  }
  if (actionId === 'archive.create') {
    return (dialog) => {
      if (!operationClient.archiveCreate) {
        return unsupportedClientResult('archive_create', dialog.targetDir);
      }
      const targetArchive = joinPath(dialog.targetDir ?? '', dialog.inputValue.trim());
      const format = archiveFormatForPath(targetArchive);
      return operationClient.archiveCreate({
        sources: dialog.sources.map((source) => source.path),
        targetArchive,
        format,
        password: dialog.secretValue || undefined,
      });
    };
  }
  if (actionId === 'archive.extract' || actionId === 'archive.extractAuto') {
    return (dialog) => operationClient.archiveExtract ? operationClient.archiveExtract({
      archivePath: dialog.sources[0]?.path ?? '',
      targetDir: dialog.targetDir ?? '',
      password: dialog.secretValue || undefined,
      policy: dialog.defaultDecision,
    }) : unsupportedClientResult('archive_extract', dialog.targetDir);
  }
  return undefined;
};

const archiveCopyExecutorForPlan = (
  plan: ArchiveCopyPlan,
  operationClient: LongRunningOperationClient,
): LongRunningOperationExecutor => (dialog) => operationClient.archiveExtract ? operationClient.archiveExtract({
  archivePath: plan.archivePath,
  targetDir: dialog.targetDir ?? '',
  policy: dialog.defaultDecision,
  entries: plan.entries,
  stripPrefix: plan.stripPrefix,
  password: plan.password,
}) : unsupportedClientResult('archive_extract', dialog.targetDir);

const archiveAddExecutorForPlan = (
  plan: ArchiveAddPlan,
  operationClient: LongRunningOperationClient,
): LongRunningOperationExecutor => (dialog) => operationClient.archiveAdd ? operationClient.archiveAdd({
  sources: dialog.sources.map((source) => source.path),
  archivePath: plan.archivePath,
  targetInnerDir: plan.targetInnerDir,
  policy: dialog.defaultDecision,
}) : unsupportedClientResult('archive_add', dialog.targetDir);

const unsupportedClientResult = async (command: string, path: string | null) => ({
  ok: false as const,
  error: {
    code: 'unsupported',
    messageKey: 'errors.commandNotConnected',
    path,
    details: { command },
    recoverable: true,
  },
});

const archiveFormatForPath = (path: string) => {
  const lowered = path.toLowerCase();
  if (lowered.endsWith('.tar.gz') || lowered.endsWith('.tgz')) return 'tar.gz';
  if (lowered.endsWith('.tar.zst') || lowered.endsWith('.tzst')) return 'tar.zst';
  if (lowered.endsWith('.jar')) return 'jar';
  if (lowered.endsWith('.war')) return 'war';
  if (lowered.endsWith('.tar')) return 'tar';
  if (lowered.endsWith('.7z')) return '7z';
  return 'zip';
};

const parseShellCommandInput = (value: string): { command: string; args: string[] } | null => {
  const parts = value.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) =>
    part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part,
  ) ?? [];
  const [command, ...args] = parts;
  return command ? { command, args } : null;
};

const archiveAutoExtractFolderName = (archiveName: string) => {
  const trimmed = archiveName.trim();
  const stripped = trimmed.replace(/(\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.zip|\.7z|\.rar|\.tgz|\.tbz2|\.txz)$/i, '');
  return stripped && stripped !== trimmed ? stripped : `${trimmed || 'archive'}-extracted`;
};

const fileEntryFromExternalDropFile = (file: File): FileEntry | null => {
  const path = externalDropPath(file);
  if (!path) {
    return null;
  }
  const name = file.name || basenameFromPath(path);
  return {
    path,
    name,
    kind: 'file',
    sizeBytes: Number.isFinite(file.size) ? file.size : null,
    modifiedAt: file.lastModified > 0 ? new Date(file.lastModified).toISOString() : null,
    createdAt: null,
    permissions: null,
    owner: null,
    group: null,
    isHidden: name.startsWith('.'),
    isVirtual: false,
  };
};

const externalDropPath = (file: File): string | null => {
  const candidate = (file as ExternalDropFile).path;
  if (typeof candidate !== 'string') {
    return null;
  }
  const trimmed = candidate.trim();
  return pathLooksAbsolute(trimmed) ? trimmed : null;
};

const pathLooksAbsolute = (path: string) =>
  path.startsWith('/')
  || path.startsWith('\\\\')
  || /^[A-Za-z]:[\\/]/.test(path);

const basenameFromPath = (path: string) =>
  path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;

const fileEntryAccessibleLabel = (entry: FileEntry, language: Settings['language']) => {
  const text = FILE_ENTRY_TEXT[language];
  if (entry.isVirtual) {
    return `${entry.name}, ${text.parentDirectory}`;
  }
  return `${entry.name}, ${METADATA_KIND_LABELS[language][entry.kind] ?? entry.kind}, ${formatSize(entry) || text.noSize}`;
};

const fileEntryTooltip = (entry: FileEntry, language: Settings['language']) => {
  const text = FILE_ENTRY_TEXT[language];
  if (entry.isVirtual) {
    return `${entry.name}\n${text.moveToParentDirectory}\n${text.path}: ${entry.path}`;
  }
  return [
    `${text.name}: ${entry.name}`,
    `${text.path}: ${entry.path}`,
    `${text.kind}: ${METADATA_KIND_LABELS[language][entry.kind] ?? entry.kind}`,
    `${text.size}: ${formatSize(entry) || '-'}`,
    `${text.modified}: ${formatDate(entry.modifiedAt, 'long') || '-'}`,
    `${text.created}: ${formatDate(entry.createdAt, 'long') || '-'}`,
    `${text.permissions}: ${entry.permissions ?? '-'}`,
    `${text.owner}: ${formatOwnerGroup(entry)}`,
  ].join('\n');
};

const joinPath = (directory: string, name: string) => {
  const separator = directory.includes('\\') ? '\\' : '/';
  return directory.endsWith('/') || directory.endsWith('\\') ? `${directory}${name}` : `${directory}${separator}${name}`;
};

const mergeSettings = (current: Settings, patch: Partial<Settings>): Settings => ({
  ...current,
  ...patch,
  external: patch.external ? { ...current.external, ...patch.external } : current.external,
  layout: patch.layout ? { ...current.layout, ...patch.layout } : current.layout,
  session: patch.session ? { ...current.session, ...patch.session } : current.session,
  view: patch.view ? { ...current.view, ...patch.view } : current.view,
});

const normalizeSettings = (value: unknown): Settings => {
  const candidate = value && typeof value === 'object' ? value as Partial<Settings> : {};
  return {
    ...DEFAULT_SETTINGS,
    ...candidate,
    external: {
      ...DEFAULT_SETTINGS.external,
      ...(candidate.external ?? {}),
      shellCommand: {
        ...DEFAULT_SETTINGS.external.shellCommand,
        ...(candidate.external?.shellCommand ?? {}),
      },
    },
    bookmarks: Array.isArray(candidate.bookmarks) ? candidate.bookmarks : [],
    layout: {
      ...DEFAULT_SETTINGS.layout,
      ...(candidate.layout ?? {}),
    },
    session: {
      ...DEFAULT_SETTINGS.session,
      ...(candidate.session ?? {}),
      activePanel: candidate.session?.activePanel === 'left' ? 'left' : 'right',
      leftPath: typeof candidate.session?.leftPath === 'string' ? candidate.session.leftPath : null,
      rightPath: typeof candidate.session?.rightPath === 'string' ? candidate.session.rightPath : null,
    },
    view: {
      ...DEFAULT_SETTINGS.view,
      ...(candidate.view ?? {}),
      zoomStep: clampNumber(
        typeof candidate.view?.zoomStep === 'number' ? candidate.view.zoomStep : DEFAULT_SETTINGS.view.zoomStep,
        MIN_ZOOM_STEP,
        MAX_ZOOM_STEP,
      ),
      density: candidate.view?.density === 'comfortable' ? 'comfortable' : 'compact',
      showIcons: typeof candidate.view?.showIcons === 'boolean' ? candidate.view.showIcons : DEFAULT_SETTINGS.view.showIcons,
    },
  };
};

export const zoomScaleForStep = (step: number) =>
  ZOOM_PRESETS_BY_STEP[clampNumber(step, MIN_ZOOM_STEP, MAX_ZOOM_STEP)] ?? 1;

export const zoomPercentForStep = (step: number) => Math.round(zoomScaleForStep(step) * 100);

const viewMetricsForSettings = (view: Settings['view']) => {
  const densityMultiplier = view.density === 'comfortable' ? 1.08 : 1;
  const scale = Number((zoomScaleForStep(view.zoomStep) * densityMultiplier).toFixed(3));
  return {
    scale,
    fontSizePx: Math.round(BASE_FONT_SIZE_PX * scale),
    rowHeightPx: Math.round(BASE_ROW_HEIGHT_PX * scale),
    topMenuHeightPx: Math.round(31 * scale),
    panelHeaderHeightPx: Math.round(25 * scale),
    pathControlHeightPx: Math.round(30 * scale),
    statusHeightPx: Math.round(27 * scale),
    hotkeyStripHeightPx: Math.round(29 * scale),
    cellPaddingXPx: Math.round(10 * scale),
    controlGapPx: Math.max(3, Math.round(4 * scale)),
  };
};

const clampNumber = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface MovementHandlers {
  moveFocusedEntry(delta: number, extendSelection?: boolean): void;
  focusBoundaryEntry(boundary: 'first' | 'last', extendSelection?: boolean): void;
}

const handleMovementKey = (event: KeyboardEvent, handlers: MovementHandlers) => {
  const extendSelection = event.shiftKey;
  const keyHandlers: Partial<Record<string, () => void>> = {
    ArrowUp: () => handlers.moveFocusedEntry(-1, extendSelection),
    ArrowDown: () => handlers.moveFocusedEntry(1, extendSelection),
    PageUp: () => handlers.moveFocusedEntry(-KEYBOARD_PAGE_STEP, extendSelection),
    PageDown: () => handlers.moveFocusedEntry(KEYBOARD_PAGE_STEP, extendSelection),
    Home: () => handlers.focusBoundaryEntry('first', extendSelection),
    End: () => handlers.focusBoundaryEntry('last', extendSelection),
  };
  const physicalKey = physicalLetterKey(event) ?? event.key.toLowerCase();
  const vimLikeKey = event.ctrlKey || event.metaKey || event.altKey ? null : physicalKey;
  const handler = keyHandlers[event.key]
    ?? (vimLikeKey === 'j' ? () => handlers.moveFocusedEntry(1, false) : undefined)
    ?? (vimLikeKey === 'k' ? () => handlers.moveFocusedEntry(-1, false) : undefined)
    ?? ((event.ctrlKey || event.metaKey) && physicalKey === 'u'
      ? () => handlers.moveFocusedEntry(-KEYBOARD_PAGE_STEP, extendSelection)
      : undefined)
    ?? ((event.ctrlKey || event.metaKey) && physicalKey === 'd'
      ? () => handlers.moveFocusedEntry(KEYBOARD_PAGE_STEP, extendSelection)
      : undefined);
  if (!handler) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  handler();
  return true;
};

const physicalLetterKey = (event: KeyboardEvent) =>
  /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : null;

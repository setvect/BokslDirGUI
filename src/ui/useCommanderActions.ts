import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useRef, useState } from 'react';
import {
  ACTION_BY_ID,
  labelForAction,
  type ActionId
} from '../actions/registry';
import type { AppError, RenameItem, FileEntry, FilePreview, OperationSummary, PanelId, Settings, SortSpec } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import {
  formatUserErrorMessage
} from '../i18n-resources';
import { dialogKindForAction } from '../operations/dialogDraft';
import { operationSummaryStatusLabel } from '../operations/operationLabels';
import type { OpenDialogRequest } from '../operations/operationTypes';
import { type OperationDialogDraft } from '../operations/operationTypes';
import { AppController, LongRunningOperationClient, SafeMutationClient } from '../tauri/commanderClients';
import { actionNeedsConcreteSources, resolveActionTargets } from './actionContext';
import type { ActionRequest } from './actionRequest';
import {
  archiveVirtualRootPath,
  isArchiveVirtualPath,
  parseArchiveVirtualPath
} from './archiveVirtual';
import type { ListPanelOptions } from './commanderTypes';
import { ArchivePasswordRequest, PendingArchiveCopy } from './commanderTypes';
import { DirectoryComparison, compareDirectoryListings } from './directoryComparison';
import { archiveAddExecutorForPlan, archiveCopyExecutorForPlan, atomicExecutorForAction, longRunningExecutorForAction } from './fileActionExecutors';
import { archiveAddPlanForTarget, archiveAutoExtractFolderName, archiveCopyPlanForSources, joinPath, sortFieldForAction } from './fileActionPlans';
import { TopMenuState } from './menuModel';
import { panelIdLabel } from './panelPresentation';
import type { PanelStateById } from './panelState';
import {
  focusedEntryOf
} from './panelState';
import { oppositePanelOf, shouldClearSourceSelectionAfterOperation, sourcesBelongToListing } from './selectionModel';
import { useFileClipboard } from './useFileClipboard';
import { useTrashUndo } from './useTrashUndo';

interface CommanderActionsDependencies {
  readonly clearCompletedSelection: (panelId: PanelId, sourcePath: string) => void;
  readonly setActivePanel: Dispatch<SetStateAction<PanelId>>;
  readonly navigateUp: (panelId: PanelId) => void;
  readonly panelState: PanelStateById;
  readonly listPanel: (panelId: PanelId, path: string, options?: ListPanelOptions) => Promise<AppError | null | undefined>;
  readonly setStatusMessage: Dispatch<SetStateAction<string | null>>;
  readonly statusText: CommanderStatusText;
  readonly mutationClient: SafeMutationClient;
  readonly runtimeBackendAvailable: boolean;
  readonly settings: Settings;
  readonly activePanel: PanelId;
  readonly topMenuState: TopMenuState | null;
  readonly closeTopMenu: () => void;
  readonly openTopMenu: (rootIndex?: number, menuOpen?: boolean) => void;
  readonly switchActivePanel: () => void;
  readonly operationBusy: boolean;
  readonly appController: AppController;
  readonly swapPanelPaths: (panelId: PanelId) => void;
  readonly setDirectoryComparison: Dispatch<SetStateAction<DirectoryComparison | null>>;
  readonly navigateBack: (panelId: PanelId) => void;
  readonly navigateForward: (panelId: PanelId) => void;
  readonly refreshPanel: (panelId: PanelId, background?: boolean) => void;
  readonly setPathPromptPanel: Dispatch<SetStateAction<PanelId | null>>;
  readonly openLocationsList: (panelId: PanelId) => Promise<void>;
  readonly focusEntry: (panelId: PanelId, index: number, extendSelection?: boolean) => void;
  readonly toggleFocusedSelection: (panelId: PanelId) => void;
  readonly selectAllEntries: (panelId: PanelId) => void;
  readonly clearSelection: (panelId: PanelId) => void;
  readonly invertSelection: (panelId: PanelId) => void;
  readonly applySort: (panelId: PanelId, sort: SortSpec) => void;
  readonly setFilterPromptPanel: Dispatch<SetStateAction<PanelId | null>>;
  readonly addTab: (panelId: PanelId) => void;
  readonly closeTab: (panelId: PanelId) => void;
  readonly openTabList: (panelId: PanelId) => void;
  readonly openHistoryList: (panelId: PanelId) => void;
  readonly addBookmark: (panelId: PanelId) => void;
  readonly openBookmarkList: (panelId: PanelId) => void;
  readonly renameBookmarkForPanel: (panelId: PanelId) => void;
  readonly applyLayout: (patch: Partial<Settings["layout"]>, message: string) => void;
  readonly applyDirectSetting: (actionId: ActionId) => boolean;
  readonly setHelpDialogOpen: Dispatch<SetStateAction<boolean>>;
  readonly setAboutDialogOpen: Dispatch<SetStateAction<boolean>>;
  readonly setHelpSearchOpen: Dispatch<SetStateAction<boolean>>;
  readonly refreshPanelAfterSourceInvalid: (panelId: PanelId, status: string) => void;
  readonly archivePasswordsRef: RefObject<Map<string, string>>;
  readonly operationClient: LongRunningOperationClient;
  readonly panelStateRef: RefObject<PanelStateById>;
  readonly setArchivePasswordRequest: Dispatch<SetStateAction<ArchivePasswordRequest | null>>;
  readonly startLongRunningOperation: (request: OpenDialogRequest) => Promise<void>;
  readonly openOperationDialog: (request: OpenDialogRequest) => void;
}
export function useCommanderActions(dependencies: CommanderActionsDependencies) {
  const { trashUndoAvailable, openTrashUndo, refreshTrashUndo } = useTrashUndo({
    get mutationClient() { return dependencies.mutationClient; },
    get operationClient() { return dependencies.operationClient; },
    get runtimeBackendAvailable() { return dependencies.runtimeBackendAvailable; },
    get operationBusy() { return dependencies.operationBusy; },
    get language() { return dependencies.settings.language; },
    get openOperationDialog() { return dependencies.openOperationDialog; },
    get refreshPanel() { return dependencies.refreshPanel; },
    get setStatusMessage() { return dependencies.setStatusMessage; },
  });

  const [bulkRename, setBulkRename] = useState<{ panelId: PanelId; sources: FileEntry[]; workingDir: string } | null>(null);
  const confirmBulkRename = (items: RenameItem[]) => {
    const snapshot = bulkRename;
    if (!snapshot || dependencies.operationBusy || !dependencies.operationClient.startBulkRename) return;
    setBulkRename(null);
    void dependencies.startLongRunningOperation({
      action: ACTION_BY_ID.get('file.bulkRename')!, ...snapshot, targetDir: snapshot.workingDir,
      longRunningExecutor: () => dependencies.operationClient.startBulkRename!({ items }),
      cancelExecutor: operationId => dependencies.operationClient.cancelOperation({ operationId }),
      onOperationSummary: summary => {
        if (summary.completedFiles > 0) dependencies.clearCompletedSelection(snapshot.panelId, snapshot.workingDir);
        dependencies.refreshPanel('left', true); dependencies.refreshPanel('right', true);
        dependencies.setStatusMessage(operationSummaryStatusLabel(summary, dependencies.settings.language));
      },
    });
  };
  const previewRequestRef = useRef(0);
  const [openWithEntry, setOpenWithEntry] = useState<FileEntry | null>(null);

  const { fileClipboard, clipboardCount, clipboardCanMove, captureClipboard, pasteClipboard, completeClipboardMove } = useFileClipboard({
    get settings() { return dependencies.settings; },
    get panelState() { return dependencies.panelState; },
    get statusText() { return dependencies.statusText; },
    get setStatusMessage() { return dependencies.setStatusMessage; },
    get runtimeBackendAvailable() { return dependencies.runtimeBackendAvailable; },
    get dispatch() { return handleAction; },
    get mutationClient() { return dependencies.mutationClient; },
    get operationBusy() { return dependencies.operationBusy; },
  });

  const pendingArchiveCopyRef = useRef<PendingArchiveCopy | null>(null);

  const [quickPreview, setQuickPreview] = useState<{ loading: boolean; preview: FilePreview | null } | null>(null);

  const openEntry = (panelId: PanelId, entry: FileEntry) => {
    dependencies.setActivePanel(panelId);
    if (entry.isVirtual) {
      dependencies.navigateUp(panelId);
      return;
    }
    if (entry.kind === 'directory' || (entry.kind === 'symlink' && entry.symlinkTargetIsDirectory !== false)) {
      const panel = dependencies.panelState[panelId];
      void dependencies.listPanel(panelId, entry.path, {
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
      dependencies.setStatusMessage(dependencies.statusText.archiveEntry(entry.path));
      return;
    }

    void openDefaultEntry(entry);
  };

  const openDefaultEntry = async (entry: FileEntry) => {
    if (!dependencies.mutationClient.openDefault || !dependencies.runtimeBackendAvailable) {
      dependencies.setStatusMessage(dependencies.statusText.openDefaultUnavailable(entry.name));
      return;
    }
    dependencies.setStatusMessage(dependencies.statusText.openDefaultStart(entry.name));
    const result = await dependencies.mutationClient.openDefault({ path: entry.path });
    if (!result.ok) {
      dependencies.setStatusMessage(dependencies.statusText.openDefaultFailed(formatUserErrorMessage(dependencies.settings.language, result.error)));
      return;
    }
    dependencies.setStatusMessage(dependencies.statusText.openDefaultDone(entry.name));
  };

  const openArchiveAsDirectory = async (panelId: PanelId, entry: FileEntry) => {
    if (!dependencies.mutationClient.archiveList || !dependencies.runtimeBackendAvailable) {
      dependencies.setStatusMessage(dependencies.statusText.archiveOpenUnavailable(entry.name));
      return;
    }
    dependencies.setStatusMessage(dependencies.statusText.archiveOpenStart(entry.name));
    void dependencies.listPanel(panelId, archiveVirtualRootPath(entry.path), {
      pushHistory: true,
      preserveSelection: false,
      focusFallback: 'first-concrete',
      statusAfterSuccess: null,
    });
  };

  const handleAction = (request: ActionRequest): void => {
    const { actionId, panelId: panelOverride = dependencies.activePanel, sources: sourceOverride,
      targetDir: targetDirOverride, sourceListing: sourceListingOverride, clipboardMoveSnapshot } = request;
    const action = ACTION_BY_ID.get(actionId)!;
    if (actionId === 'menu.open') {
      if (dependencies.topMenuState) {
        dependencies.closeTopMenu();
      } else {
        dependencies.openTopMenu(0, false);
      }
      return;
    }

    if (actionId === 'panel.switchActive') {
      dependencies.switchActivePanel();
      return;
    }

    if (actionId === 'app.quit') {
      if (dependencies.operationBusy) {
        dependencies.setStatusMessage(dependencies.statusText.quitBusy);
        return;
      }
      if (!dependencies.runtimeBackendAvailable) {
        dependencies.setStatusMessage(dependencies.statusText.quitPreviewUnavailable);
        return;
      }
      void dependencies.appController.quit()
        .then(() => dependencies.setStatusMessage(dependencies.statusText.quitRequested))
        .catch((error) => dependencies.setStatusMessage(dependencies.statusText.quitFailed(String(error))));
      return;
    }

    const panel = dependencies.panelState[panelOverride];
    const panelListing = sourceListingOverride ?? panel.listing;
    const oppositePanel = oppositePanelOf(panelOverride);
    const actionTargets = resolveActionTargets(panel);
    const focusedEntry = actionTargets.focusedEntry;
    const sources = sourceOverride?.filter((entry) => !entry.isVirtual)
      ?? actionTargets.effectiveSources;

    const actionTargetEntry = sourceOverride?.[0] ?? focusedEntry;

    if (actionId === 'file.clipboardCopy' || actionId === 'file.clipboardCut') { captureClipboard(action, sources, panelOverride, panelListing); return; }

    if (actionId === 'file.clipboardPaste' || actionId === 'file.clipboardMovePaste') { pasteClipboard(actionId, panelOverride); return; }

    if (actionId === 'file.undoTrash') { openTrashUndo(panelOverride, panelListing.path); return; }

    if (actionId === 'file.bulkRename') {
      if (!sources.length || dependencies.operationBusy || !dependencies.runtimeBackendAvailable
        || isArchiveVirtualPath(panelListing.path) || sources.some(entry => isArchiveVirtualPath(entry.path))
        || !dependencies.mutationClient.previewBulkRename || !dependencies.operationClient.startBulkRename) return;
      setBulkRename({ sources: [...sources], panelId: panelOverride, workingDir: panelListing.path });
      return;
    }
    if (actionId === 'external.openWith') {
      const entry = sources[0];
      if (!dependencies.runtimeBackendAvailable || !dependencies.mutationClient.listOpenWithApps || !dependencies.mutationClient.openWithApp
        || sources.length !== 1 || !entry || entry.kind === 'directory' || entry.symlinkTargetIsDirectory === true || isArchiveVirtualPath(entry.path)) {
        dependencies.setStatusMessage(dependencies.statusText.unavailableInContext(labelForAction(action, dependencies.settings.language)));
        return;
      }
      setOpenWithEntry(entry);
      return;
    }

    if (actionId === 'external.openCurrentInFinder' || actionId === 'external.openCurrentInTerminal') {
      const openDirectory = actionId === 'external.openCurrentInFinder'
        ? dependencies.mutationClient.openCurrentInFinder
        : dependencies.mutationClient.openCurrentInTerminal;
      const label = labelForAction(action, dependencies.settings.language);
      if (!dependencies.runtimeBackendAvailable || isArchiveVirtualPath(panel.path) || !openDirectory) {
        dependencies.setStatusMessage(dependencies.statusText.unavailableInContext(label));
        return;
      }
      const path = panel.path;
      void openDirectory({ path }).then((result) => {
        dependencies.setStatusMessage(result.ok
          ? dependencies.statusText.operationDone(label)
          : `${label}: ${formatUserErrorMessage(dependencies.settings.language, result.error)}`);
      });
      return;
    }

    if (actionId === 'panel.swapPaths') { dependencies.swapPanelPaths(panelOverride); return; }

    if (actionId === 'panel.copyPathToOther') {
      if (isArchiveVirtualPath(panel.path)) {
        dependencies.setStatusMessage(dependencies.statusText.unavailableInContext(labelForAction(action, dependencies.settings.language)));
        return;
      }
      void dependencies.listPanel(oppositePanel, panel.path, { pushHistory: true }).then(() => dependencies.setActivePanel(panelOverride));
      return;
    }

    if (actionId === 'panel.compareDirectories') {
      if (isArchiveVirtualPath(dependencies.panelState.left.path) || isArchiveVirtualPath(dependencies.panelState.right.path)) {
        dependencies.setStatusMessage(dependencies.statusText.unavailableInContext(labelForAction(action, dependencies.settings.language)));
        return;
      }
      const comparison = compareDirectoryListings(dependencies.panelState.left.listing, dependencies.panelState.right.listing);
      dependencies.setDirectoryComparison(comparison);
      dependencies.setStatusMessage(dependencies.settings.language === 'ko'
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
      if (!dependencies.mutationClient.previewFile || !dependencies.runtimeBackendAvailable) {
        dependencies.setStatusMessage(dependencies.statusText.unavailableInContext(labelForAction(action, dependencies.settings.language)));
        return;
      }
      const requestId = ++previewRequestRef.current;
      setQuickPreview({ loading: true, preview: null });
      dependencies.setStatusMessage(null);
      void dependencies.mutationClient.previewFile({ path: actionTargetEntry.path }).then((result) => {
        if (requestId !== previewRequestRef.current) {
          return;
        }
        if (!result.ok) {
          setQuickPreview(null);
          dependencies.setStatusMessage(formatUserErrorMessage(dependencies.settings.language, result.error));
          return;
        }
        setQuickPreview({ loading: false, preview: result.data });
      });
      return;
    }

    if (actionId === 'nav.up') {
      dependencies.navigateUp(panelOverride);
      return;
    }

    if (actionId === 'nav.back') {
      dependencies.navigateBack(panelOverride);
      return;
    }

    if (actionId === 'nav.forward') {
      dependencies.navigateForward(panelOverride);
      return;
    }

    if (actionId === 'nav.refresh') {
      dependencies.refreshPanel(panelOverride);
      return;
    }

    if (actionId === 'nav.gotoPath') {
      dependencies.setPathPromptPanel(panelOverride);
      dependencies.setStatusMessage(null);
      return;
    }

    if (actionId === 'nav.locations') {
      void dependencies.openLocationsList(panelOverride);
      return;
    }

    if (actionId === 'nav.top') {
      dependencies.focusEntry(panelOverride, 0);
      return;
    }

    if (actionId === 'nav.bottom') {
      dependencies.focusEntry(panelOverride, panel.listing.entries.length - 1);
      return;
    }

    if (actionId === 'selection.toggle') {
      dependencies.toggleFocusedSelection(panelOverride);
      return;
    }

    if (actionId === 'selection.all') {
      dependencies.selectAllEntries(panelOverride);
      dependencies.setStatusMessage(`${labelForAction(action, dependencies.settings.language)} · ${panelIdLabel(panelOverride, dependencies.settings.language)}`);
      return;
    }

    if (actionId === 'selection.clear') {
      dependencies.clearSelection(panelOverride);
      dependencies.setStatusMessage(`${labelForAction(action, dependencies.settings.language)} · ${panelIdLabel(panelOverride, dependencies.settings.language)}`);
      return;
    }

    if (actionId === 'selection.invert') {
      dependencies.invertSelection(panelOverride);
      dependencies.setStatusMessage(`${labelForAction(action, dependencies.settings.language)} · ${panelIdLabel(panelOverride, dependencies.settings.language)}`);
      return;
    }

    if (actionId === 'view.sortName' || actionId === 'view.sortSize' || actionId === 'view.sortDate' || actionId === 'view.sortExt') {
      dependencies.applySort(panelOverride, { ...panel.sort, field: sortFieldForAction(actionId), direction: 'asc' });
      return;
    }

    if (actionId === 'view.sortAsc' || actionId === 'view.sortDesc') {
      dependencies.applySort(panelOverride, {
        ...panel.sort,
        direction: actionId === 'view.sortAsc' ? 'asc' : 'desc',
      });
      return;
    }

    if (actionId === 'view.reverseSort') {
      dependencies.applySort(panelOverride, {
        ...panel.sort,
        direction: panel.sort.direction === 'asc' ? 'desc' : 'asc',
      });
      return;
    }

    if (actionId === 'filter.start') {
      dependencies.setFilterPromptPanel(panelOverride);
      dependencies.setStatusMessage(null);
      return;
    }

    if (actionId === 'filter.clear') {
      void dependencies.listPanel(panelOverride, panel.path, {
        filter: null,
        preserveSelection: true,
        preserveFocusPath: focusedEntry?.path,
      });
      return;
    }

    if (actionId === 'view.toggleHidden') {
      void dependencies.listPanel(panelOverride, panel.path, {
        showHidden: !panel.showHidden,
        preserveSelection: true,
        preserveFocusPath: focusedEntry?.path,
      });
      return;
    }

    if (actionId === 'tab.new') { dependencies.addTab(panelOverride); return; }

    if (actionId === 'tab.close') { dependencies.closeTab(panelOverride); return; }

    if (actionId === 'tab.list') {
      dependencies.openTabList(panelOverride);
      return;
    }

    if (actionId === 'history.list') {
      dependencies.openHistoryList(panelOverride);
      return;
    }

    if (actionId === 'bookmark.add') {
      dependencies.addBookmark(panelOverride);
      return;
    }

    if (actionId === 'bookmark.list') {
      dependencies.openBookmarkList(panelOverride);
      return;
    }

    if (actionId === 'bookmark.rename') {
      dependencies.renameBookmarkForPanel(panelOverride);
      return;
    }

    if (actionId === 'layout.toggleSingleDual') {
      dependencies.applyLayout({ singlePanel: !dependencies.settings.layout.singlePanel }, `Layout · ${dependencies.settings.layout.singlePanel ? 'dual' : 'single'} panel`);
      return;
    }

    if (actionId === 'layout.ratio50') {
      dependencies.applyLayout({ ratio: '50:50' }, 'Layout ratio · 50:50');
      return;
    }

    if (actionId === 'layout.ratio70Left') {
      dependencies.applyLayout({ ratio: '70:30' }, 'Layout ratio · 70:30');
      return;
    }

    if (actionId === 'layout.ratio70Right') {
      dependencies.applyLayout({ ratio: '30:70' }, 'Layout ratio · 30:70');
      return;
    }

    if (dependencies.applyDirectSetting(actionId)) {
      return;
    }

    if (actionId === 'help.shortcuts') {
      dependencies.setHelpDialogOpen(true);
      dependencies.setStatusMessage(null);
      return;
    }

    if (actionId === 'help.about') {
      dependencies.setAboutDialogOpen(true);
      dependencies.setStatusMessage(null);
      return;
    }

    if (actionId === 'help.search') {
      dependencies.setHelpSearchOpen(true);
      dependencies.setStatusMessage(null);
      return;
    }

    if (dialogKindForAction(actionId)) {
      if (actionNeedsConcreteSources(actionId) && sources.length === 0) {
        dependencies.setStatusMessage(dependencies.statusText.virtualOperationTargetUnavailable(labelForAction(action, dependencies.settings.language)));
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
        dependencies.refreshPanelAfterSourceInvalid(panelOverride, dependencies.statusText.operationTargetChanged(labelForAction(action, dependencies.settings.language)));
        return;
      }

      const operationTargetDir = actionId === 'archive.create'
        ? targetDirOverride ?? panelListing.path
        : actionId === 'archive.extractAuto' && sources[0]
          ? joinPath(dependencies.panelState[oppositePanel].path, archiveAutoExtractFolderName(sources[0].name))
          : targetDirOverride ?? dependencies.panelState[oppositePanel].path;
      const archiveCopyPlan = actionId === 'file.copy'
        ? archiveCopyPlanForSources(
          sources,
          panelListing.path,
          operationTargetDir,
          parseArchiveVirtualPath(panelListing.path)
            ? dependencies.archivePasswordsRef.current.get(parseArchiveVirtualPath(panelListing.path)?.archivePath ?? '')
            : undefined,
        )
        : null;
      const archiveAddPlan = actionId === 'file.copy'
        ? archiveAddPlanForTarget(sources, operationTargetDir)
        : null;
      if (actionId === 'file.copy' && sources.some((source) => isArchiveVirtualPath(source.path)) && !archiveCopyPlan) {
        dependencies.setStatusMessage(dependencies.statusText.virtualOperationTargetUnavailable(labelForAction(action, dependencies.settings.language)));
        return;
      }
      if (actionId === 'file.copy' && isArchiveVirtualPath(operationTargetDir) && !archiveAddPlan) {
        dependencies.setStatusMessage(dependencies.statusText.virtualOperationTargetUnavailable(labelForAction(action, dependencies.settings.language)));
        return;
      }
      const operationRequest = {
        action,
        panelId: panelOverride,
        sources,
        targetDir: operationTargetDir,
        targetEntries: actionId === 'archive.create' && operationTargetDir === panelListing.path
          ? panelListing.entries
          : undefined,
        workingDir: panelListing.path,
        atomicExecutor: atomicExecutorForAction(actionId, dependencies.mutationClient),
        longRunningExecutor: archiveCopyPlan
          ? archiveCopyExecutorForPlan(archiveCopyPlan, dependencies.operationClient)
          : archiveAddPlan
            ? archiveAddExecutorForPlan(archiveAddPlan, dependencies.operationClient)
            : longRunningExecutorForAction(actionId, dependencies.operationClient),
        cancelExecutor: (operationId: string) => dependencies.operationClient.cancelOperation({ operationId }),
        conflictResolver: (operationId: string, decision: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel') => dependencies.operationClient.resolveConflict({ operationId, decision }),
        onAtomicSuccess: (result: unknown) => {
          const entry = result as Partial<FileEntry>;
          if (typeof entry.path === 'string' && typeof entry.name === 'string') {
            const currentPanel = dependencies.panelStateRef.current[panelOverride];
            if (!currentPanel.loading) void dependencies.listPanel(panelOverride, currentPanel.path, {
              preserveSelection: currentPanel.path !== panelListing.path,
              focusPath: currentPanel.path === panelListing.path ? entry.path : focusedEntryOf(currentPanel)?.path,
              background: true,
              forceArchiveReload: true,
            });
            dependencies.setStatusMessage(dependencies.statusText.operationDoneWithEntry(labelForAction(action, dependencies.settings.language), entry.name));
            return;
          }
          dependencies.setStatusMessage(dependencies.statusText.operationDone(labelForAction(action, dependencies.settings.language)));
        },
        onOperationSummary: (summary: OperationSummary, dialog: OperationDialogDraft) => {
          if (dialog.dialogKind === 'trash') refreshTrashUndo();
          if (shouldClearSourceSelectionAfterOperation(summary, dialog.dialogKind)) {
            dependencies.clearCompletedSelection(dialog.panelId, panelListing.path);
          }
          dependencies.refreshPanel(dialog.panelId, true);
          dependencies.refreshPanel(oppositePanelOf(dialog.panelId), true);
          completeClipboardMove(clipboardMoveSnapshot, summary);
          const moveIncomplete = clipboardMoveSnapshot && summary.completedFiles > 0
            && (summary.state !== 'completed' || summary.failedFiles > 0 || (summary.skippedFiles ?? 0) > 0);
          dependencies.setStatusMessage(`${labelForAction(action, dependencies.settings.language)} ${operationSummaryStatusLabel(summary, dependencies.settings.language)}${moveIncomplete ? dependencies.statusText.clipboardMoveIncomplete : ''}`);
        },
        onOperationStartError: (error: AppError) => {
          if (actionNeedsConcreteSources(actionId) && error.code === 'not_found') {
            dependencies.refreshPanelAfterSourceInvalid(panelOverride, dependencies.statusText.operationTargetMissing(labelForAction(action, dependencies.settings.language)));
            return 'dismiss' as const;
          }
          return 'keep' as const;
        },
      };

      if (actionId === 'file.copy') {
        const copyStatus = dependencies.statusText.operationStarted(labelForAction(action, dependencies.settings.language), sources.length, operationRequest.targetDir);
        if (archiveCopyPlan && panelListing.archiveEncrypted && !archiveCopyPlan.password) {
          pendingArchiveCopyRef.current = { request: operationRequest, plan: archiveCopyPlan, status: copyStatus };
          dependencies.setArchivePasswordRequest({ kind: 'copy', archivePath: archiveCopyPlan.archivePath });
          return;
        }
        void dependencies.startLongRunningOperation(operationRequest);
        dependencies.setStatusMessage(copyStatus);
        return;
      }

      dependencies.openOperationDialog(operationRequest);
      return;
    }

    dependencies.setStatusMessage(dependencies.statusText.actionReady(labelForAction(action, dependencies.settings.language)));
  };
  return { trashUndoAvailable, bulkRename, setBulkRename, confirmBulkRename, openWithEntry, setOpenWithEntry, handleAction, pendingArchiveCopyRef, previewRequestRef, setQuickPreview, fileClipboard, clipboardCount, clipboardCanMove, openEntry, quickPreview };
}

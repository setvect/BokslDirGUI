import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  ACTION_BY_ID,
  ariaKeyShortcutsFromRegistry,
  labelForAction,
  menuRootLabelFromRegistry,
  menuRootsFromRegistry
} from '../actions/registry';
import type { PanelId } from '../domain/types';
import {
  COMMANDER_NAVIGATION_TEXT,
  COMMANDER_STATUS_TEXT
} from '../i18n-resources';
import { OperationDialogHost } from '../operations/OperationDialogHost';
import { isOperationInFlight } from '../operations/operationLifecycle';
import { useOperationStore } from '../operations/operationStore';
import { tauriClient } from '../tauri/client';
import { AppController, DEFAULT_APP_CONTROLLER, LongRunningOperationClient, NativeFileDragClient, NativeFileDropClient, SafeMutationClient } from '../tauri/commanderClients';
import { createActionContext, resolveActionTargets } from './actionContext';
import {
  isArchiveVirtualPath
} from './archiveVirtual';
import {
  AboutDialog,
  ArchivePasswordPrompt,
  BookmarkRenamePrompt,
  FilterPrompt,
  HelpSearchDialog,
  NavigationListDialog,
  PathPrompt,
  QuickPreviewDialog,
  ShortcutHelpDialog
} from './CommanderOverlays';
import { ArchivePasswordRequest } from './commanderTypes';
import { DirectoryComparison } from './directoryComparison';
import { archiveCopyExecutorForPlan } from './fileActionExecutors';
import { FilePanel } from './FilePanel';
import { entryIcon } from './format';
import { TopMenuState } from './menuModel';
import { createTauriPanelDataSource, type PanelDataSource } from './panelDataSource';
import { rowDomId } from './panelPresentation';
import {
  focusedEntryOf
} from './panelState';
import { clampNumber, viewMetricsForSettings } from './settingsModel';
import { BottomStatusStrip, HotkeyStrip } from './StatusStrips';
import { TopMenuBar } from './TopMenuBar';
import { useCommanderActions } from './useCommanderActions';
import { useCommanderKeyboard } from './useCommanderKeyboard';
import { useCommanderSettings } from './useCommanderSettings';
import { useFileDrag } from './useFileDrag';
import { useNavigationMenus } from './useNavigationMenus';
import { usePanelNavigation } from './usePanelNavigation';

const DEFAULT_DATA_SOURCE = createTauriPanelDataSource();

interface CommanderShellProps {
  dataSource?: PanelDataSource;
  mutationClient?: SafeMutationClient;
  operationClient?: LongRunningOperationClient;
  appController?: AppController;
  runtimeBackendAvailable?: boolean;
  initialFocusIndex?: Partial<Record<PanelId, number>>;
  initialSelectedPaths?: Partial<Record<PanelId, string[]>>;
  nativeFileDropClient?: NativeFileDropClient;
  nativeFileDragClient?: NativeFileDragClient;
}

export function CommanderShell({
  dataSource = DEFAULT_DATA_SOURCE,
  mutationClient = tauriClient,
  operationClient = tauriClient,
  appController = DEFAULT_APP_CONTROLLER,
  runtimeBackendAvailable = true,
  initialFocusIndex,
  initialSelectedPaths,
  nativeFileDropClient,
  nativeFileDragClient,
}: CommanderShellProps) {
  const openOperationDialog = useOperationStore((state) => state.openDialog);
  const startLongRunningOperation = useOperationStore((state) => state.startLongRunningOperation);
  const operationDialogOpen = useOperationStore((state) => Boolean(state.dialog));
  const operationBusy = useOperationStore(isOperationInFlight);
  const shellRef = useRef<HTMLElement>(null);
  const shortcutSequenceRef = useRef<readonly string[]>([]);
  const shortcutSequenceTimeoutRef = useRef<number | null>(null);

  const topMenuStateRef = useRef<TopMenuState | null>(null);
  const { handleEntryPointerDown, dragOverPanel, handlePanelDragOver, setDragOverPanel, handlePanelDrop, pointerDragPreview } = useFileDrag({
    get runtimeBackendAvailable() { return runtimeBackendAvailable; },
    get nativeFileDropClient() { return nativeFileDropClient; },
    get nativeFileDragClient() { return nativeFileDragClient; },
    get panelStateRef() { return panelStateRef; },
    get handleAction() { return handleAction; },
    get setActivePanel() { return setActivePanel; },
    get setStatusMessage() { return setStatusMessage; },
    get statusText() { return statusText; },
    get operationBusy() { return operationBusy; },
    get shortcutSequenceRef() { return shortcutSequenceRef; },
    get shortcutSequenceTimeoutRef() { return shortcutSequenceTimeoutRef; },
    get settings() { return settings; },
    get mutationClient() { return mutationClient; },
    get panelState() { return panelState; },
  });
  const { settings, settingsRef, saveSettingsPatch, applyLayout, applyDirectSetting, applyZoom, settingsLoaded } = useCommanderSettings({
    get mutationClient() { return mutationClient; },
    get setStatusMessage() { return setStatusMessage; },
    get runtimeBackendAvailable() { return runtimeBackendAvailable; },
    get statusText() { return statusText; },
    get setActivePanel() { return setActivePanel; },
  });

  const { activateTab, clearCompletedSelection, addTab, closeTab, swapPanelPaths, moveFocusedEntry, focusBoundaryEntry, setActivePanel, panelState, panelTabs, activeTab, panelStateRef, gotoPanelPath, navigateUp, listPanel, activePanel, switchActivePanel, navigateBack, navigateForward, refreshPanel, focusEntry, toggleFocusedSelection, selectAllEntries, clearSelection, invertSelection, applySort, refreshPanelAfterSourceInvalid, archivePasswordsRef, recordFocusedRow, selectEntry, archiveListingsRef } = usePanelNavigation({
    get dataSource() { return dataSource; },
    get initialFocusIndex() { return initialFocusIndex; },
    get initialSelectedPaths() { return initialSelectedPaths; },
    get setDirectoryComparison() { return setDirectoryComparison; },
    get setStatusMessage() { return setStatusMessage; },
    get statusText() { return statusText; },
    get settings() { return settings; },
    get shellRef() { return shellRef; },
    get mutationClient() { return mutationClient; },
    get runtimeBackendAvailable() { return runtimeBackendAvailable; },
    get setArchivePasswordRequest() { return setArchivePasswordRequest; },
    get settingsRef() { return settingsRef; },
    get saveSettingsPatch() { return saveSettingsPatch; },
    get settingsLoaded() { return settingsLoaded; },
  });
  const { openLocationsList, openTabList, openHistoryList, addBookmark, openBookmarkList, renameBookmarkForPanel, deleteBookmarkForPanel, setBookmarkRenameRequest, locationsRequestRef, setNavigationList, bookmarkRenameRequest, applyBookmarkRename, navigationList, chooseNavigationItem } = useNavigationMenus({
    activateTab,
    get panelState() { return panelState; },
    get settings() { return settings; },
    get saveSettingsPatch() { return saveSettingsPatch; },
    get statusText() { return statusText; },
    get setStatusMessage() { return setStatusMessage; },
    get navigationText() { return navigationText; },
    get panelTabs() { return panelTabs; },
    get activeTab() { return activeTab; },
    get panelStateRef() { return panelStateRef; },
    get dataSource() { return dataSource; },
    get gotoPanelPath() { return gotoPanelPath; },
  });
  const { handleAction, pendingArchiveCopyRef, previewRequestRef, setQuickPreview, fileClipboard, openEntry, quickPreview } = useCommanderActions({
    clearCompletedSelection,
    get setActivePanel() { return setActivePanel; },
    get navigateUp() { return navigateUp; },
    get panelState() { return panelState; },
    get listPanel() { return listPanel; },
    get setStatusMessage() { return setStatusMessage; },
    get statusText() { return statusText; },
    get mutationClient() { return mutationClient; },
    get runtimeBackendAvailable() { return runtimeBackendAvailable; },
    get settings() { return settings; },
    get activePanel() { return activePanel; },
    get topMenuState() { return topMenuState; },
    get closeTopMenu() { return closeTopMenu; },
    get openTopMenu() { return openTopMenu; },
    get switchActivePanel() { return switchActivePanel; },
    get operationBusy() { return operationBusy; },
    get appController() { return appController; },
    get swapPanelPaths() { return swapPanelPaths; },
    get setDirectoryComparison() { return setDirectoryComparison; },
    get navigateBack() { return navigateBack; },
    get navigateForward() { return navigateForward; },
    get refreshPanel() { return refreshPanel; },
    get setPathPromptPanel() { return setPathPromptPanel; },
    get openLocationsList() { return openLocationsList; },
    get focusEntry() { return focusEntry; },
    get toggleFocusedSelection() { return toggleFocusedSelection; },
    get selectAllEntries() { return selectAllEntries; },
    get clearSelection() { return clearSelection; },
    get invertSelection() { return invertSelection; },
    get applySort() { return applySort; },
    get setFilterPromptPanel() { return setFilterPromptPanel; },
    get addTab() { return addTab; },
    get closeTab() { return closeTab; },
    get openTabList() { return openTabList; },
    get openHistoryList() { return openHistoryList; },
    get addBookmark() { return addBookmark; },
    get openBookmarkList() { return openBookmarkList; },
    get renameBookmarkForPanel() { return renameBookmarkForPanel; },
    get deleteBookmarkForPanel() { return deleteBookmarkForPanel; },
    get applyLayout() { return applyLayout; },
    get applyDirectSetting() { return applyDirectSetting; },
    get setHelpDialogOpen() { return setHelpDialogOpen; },
    get setAboutDialogOpen() { return setAboutDialogOpen; },
    get setHelpSearchOpen() { return setHelpSearchOpen; },
    get refreshPanelAfterSourceInvalid() { return refreshPanelAfterSourceInvalid; },
    get archivePasswordsRef() { return archivePasswordsRef; },
    get operationClient() { return operationClient; },
    get panelStateRef() { return panelStateRef; },
    get setArchivePasswordRequest() { return setArchivePasswordRequest; },
    get startLongRunningOperation() { return startLongRunningOperation; },
    get openOperationDialog() { return openOperationDialog; },
  });

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [filterPromptPanel, setFilterPromptPanel] = useState<PanelId | null>(null);
  const [pathPromptPanel, setPathPromptPanel] = useState<PanelId | null>(null);
  const [archivePasswordRequest, setArchivePasswordRequest] = useState<ArchivePasswordRequest | null>(null);
  const [helpDialogOpen, setHelpDialogOpen] = useState(false);
  const [helpSearchOpen, setHelpSearchOpen] = useState(false);
  const [aboutDialogOpen, setAboutDialogOpen] = useState(false);
  const [directoryComparison, setDirectoryComparison] = useState<DirectoryComparison | null>(null);
  const [topMenuState, setTopMenuStateValue] = useState<TopMenuState | null>(null);
  topMenuStateRef.current = topMenuState;
  const setTopMenuState = (next: TopMenuState | null) => {
    topMenuStateRef.current = next;
    setTopMenuStateValue(next);
  };
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
    setBookmarkRenameRequest(null);
    setArchivePasswordRequest(null);
    pendingArchiveCopyRef.current = null;
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
    pendingArchiveCopyRef.current = null;
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
    clipboardCount: fileClipboard?.entries.length ?? 0,
    clipboardMode: fileClipboard?.intent ?? null,
    clipboardCanMove: Boolean(fileClipboard && !isArchiveVirtualPath(fileClipboard.listing.path) && !isArchiveVirtualPath(activeListing.path)),
    hasOppositePanel: true,
    shellCommandEnabled: settings.external.shellCommand.enabled,
    operationBusy: operationBusy || panelState.left.loading || panelState.right.loading,
    backendAvailable: runtimeBackendAvailable,
    activePathIsArchive: isArchiveVirtualPath(activeListing.path),
  });

  const activeRowDomId = rowDomId(activePanel, panelState[activePanel].focusedIndex);
  const ariaKeyShortcuts = ariaKeyShortcutsFromRegistry();

  useEffect(() => {
    shellRef.current?.focus({ preventScroll: true });
  }, []);
  useCommanderKeyboard({
    get activePanel() { return activePanel; },
    get panelState() { return panelState; },
    get context() { return context; },
    get operationDialogOpen() { return operationDialogOpen; },
    get moveFocusedEntry() { return moveFocusedEntry; },
    get focusBoundaryEntry() { return focusBoundaryEntry; },
    get handleAction() { return handleAction; },
    get applyZoom() { return applyZoom; },
    get settings() { return settings; },
    get topMenuStateRef() { return topMenuStateRef; },
    get openTopMenu() { return openTopMenu; },
    get closeTopMenu() { return closeTopMenu; },
    get setTopMenuState() { return setTopMenuState; },
    get shellRef() { return shellRef; },
    get shortcutSequenceRef() { return shortcutSequenceRef; },
    get shortcutSequenceTimeoutRef() { return shortcutSequenceTimeoutRef; },
    get setStatusMessage() { return setStatusMessage; },
    get statusText() { return statusText; },
  });

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
          handleAction({ actionId: (action).id });
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
          onEntryFocus={(index) => recordFocusedRow('left', index)}
          onEntrySelect={(index, entry, mode) => selectEntry('left', index, entry, mode)}
          onEntryOpen={(entry) => openEntry('left', entry)}
          onOpenAction={(action, sources) => handleAction({ actionId: (action).id, panelId: 'left', sources: sources })}
          onNavigateBack={() => navigateBack('left')}
          onNavigateForward={() => navigateForward('left')}
          onNavigateUp={() => navigateUp('left')}
          onRefresh={() => refreshPanel('left')}
          onGotoPath={() => setPathPromptPanel('left')}
          onClearFilter={() => handleAction({ actionId: (ACTION_BY_ID.get('filter.clear')!).id, panelId: 'left' })}
          onRestoreFocus={() => shellRef.current?.focus({ preventScroll: true })}
          onEntryPointerDown={(event, entry) => handleEntryPointerDown(event, 'left', entry)}
          dropIntent={dragOverPanel?.panelId === 'left' ? dragOverPanel.intent : null}
          onPanelDragOver={(event) => handlePanelDragOver(event, 'left')}
          onPanelDragLeave={() => setDragOverPanel((current) => current?.panelId === 'left' ? null : current)}
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
          onEntryFocus={(index) => recordFocusedRow('right', index)}
          onEntrySelect={(index, entry, mode) => selectEntry('right', index, entry, mode)}
          onEntryOpen={(entry) => openEntry('right', entry)}
          onOpenAction={(action, sources) => handleAction({ actionId: (action).id, panelId: 'right', sources: sources })}
          onNavigateBack={() => navigateBack('right')}
          onNavigateForward={() => navigateForward('right')}
          onNavigateUp={() => navigateUp('right')}
          onRefresh={() => refreshPanel('right')}
          onGotoPath={() => setPathPromptPanel('right')}
          onClearFilter={() => handleAction({ actionId: (ACTION_BY_ID.get('filter.clear')!).id, panelId: 'right' })}
          onRestoreFocus={() => shellRef.current?.focus({ preventScroll: true })}
          onEntryPointerDown={(event, entry) => handleEntryPointerDown(event, 'right', entry)}
          dropIntent={dragOverPanel?.panelId === 'right' ? dragOverPanel.intent : null}
          onPanelDragOver={(event) => handlePanelDragOver(event, 'right')}
          onPanelDragLeave={() => setDragOverPanel((current) => current?.panelId === 'right' ? null : current)}
          onPanelDrop={(event) => handlePanelDrop(event, 'right')}
        />
      </section>
      {pointerDragPreview && (
        <div className="file-drag-preview" aria-hidden="true" style={{
          left: Math.min(pointerDragPreview.point.x + 16, Math.max(0, window.innerWidth - 340)),
          top: Math.min(pointerDragPreview.point.y + 16, Math.max(0, window.innerHeight - 160)),
        }}>
          <strong>{labelForAction(ACTION_BY_ID.get(pointerDragPreview.mode === 'move' ? 'file.move' : 'file.copy')!, settings.language)}</strong>
          {pointerDragPreview.entries.slice(0, 3).map((entry) => <div key={entry.path}>{entryIcon(entry.kind)} {entry.name}</div>)}
          {pointerDragPreview.entries.length > 3 && <div>+{pointerDragPreview.entries.length - 3}</div>}
        </div>
      )}
      <BottomStatusStrip
        language={settings.language}
        activePanel={activePanel}
        focusedEntry={activeTargets.focusedEntry}
        message={statusMessage}
        filter={activePanelState.filter}
        sizeFormat={settings.sizeFormat}
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
      {bookmarkRenameRequest ? (
        <BookmarkRenamePrompt
          language={settings.language}
          initialValue={bookmarkRenameRequest.initialValue}
          onApply={applyBookmarkRename}
          onCancel={closeOverlay}
        />
      ) : null}
      {archivePasswordRequest ? (
        <ArchivePasswordPrompt
          language={settings.language}
          archivePath={archivePasswordRequest.archivePath}
          mode={archivePasswordRequest.kind}
          onApply={(password) => {
            const request = archivePasswordRequest;
            setArchivePasswordRequest(null);
            if (request.kind === 'copy') {
              const pending = pendingArchiveCopyRef.current;
              pendingArchiveCopyRef.current = null;
              if (!pending || pending.plan.archivePath !== request.archivePath) return;
              void startLongRunningOperation({
                ...pending.request,
                longRunningExecutor: archiveCopyExecutorForPlan({ ...pending.plan, password }, operationClient),
              });
              setStatusMessage(pending.status);
              return;
            }
            archivePasswordsRef.current.set(request.archivePath, password);
            archiveListingsRef.current.delete(request.archivePath);
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

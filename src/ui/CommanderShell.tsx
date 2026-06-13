import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Popover from '@radix-ui/react-popover';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useMemo, useRef, useState } from 'react';
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
import type { DirectoryListing, FileEntry, PanelId } from '../domain/types';
import { OperationDialogHost } from '../operations/OperationDialogHost';
import { dialogKindForAction, useOperationStore } from '../operations/operationStore';
import { actionNeedsConcreteSources, createActionContext, filterEnabledActions } from './actionContext';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { entryIcon, formatModified, formatSize, summarizeEntries } from './format';
import {
  commanderKeyboardIsSuspended,
  useCommanderKeyboardBoundaryProps,
} from './keyboardOwnership';

interface PanelUiState {
  focusedIndex: number;
  selectedPaths: string[];
}

const KEYBOARD_PAGE_STEP = 12;
const FOCUSABLE_ROW_TAB_INDEX = -1;
const KEYBOARD_SEQUENCE_TIMEOUT_MS = 900;

interface KeyboardRuntime {
  context: ActionContext;
  operationDialogOpen: boolean;
  moveFocusedEntry(delta: number): void;
  focusBoundaryEntry(boundary: 'first' | 'last'): void;
  handleAction(action: AppAction): void;
}

export function CommanderShell() {
  const openOperationDialog = useOperationStore((state) => state.openDialog);
  const operationDialogOpen = useOperationStore((state) => Boolean(state.dialog));
  const shellRef = useRef<HTMLElement>(null);
  const shortcutSequenceRef = useRef<readonly string[]>([]);
  const shortcutSequenceTimeoutRef = useRef<number | null>(null);
  const keyboardRuntimeRef = useRef<KeyboardRuntime | null>(null);
  const [activePanel, setActivePanel] = useState<PanelId>('right');
  const [panelState, setPanelState] = useState<Record<PanelId, PanelUiState>>({
    left: {
      focusedIndex: INITIAL_FOCUS_INDEX.left,
      selectedPaths: INITIAL_SELECTED_PATHS.left,
    },
    right: {
      focusedIndex: INITIAL_FOCUS_INDEX.right,
      selectedPaths: INITIAL_SELECTED_PATHS.right,
    },
  });
  const [overlayMessage, setOverlayMessage] = useState<string | null>(null);

  const updatePanel = (panelId: PanelId, next: Partial<PanelUiState>) => {
    setPanelState((current) => ({
      ...current,
      [panelId]: { ...current[panelId], ...next },
    }));
  };

  const focusEntry = (panelId: PanelId, index: number) => {
    const entryCount = SAMPLE_LISTINGS[panelId].entries.length;
    const focusedIndex = clamp(index, 0, Math.max(0, entryCount - 1));
    setActivePanel(panelId);
    updatePanel(panelId, { focusedIndex });
  };

  const moveFocusedEntry = (delta: number) => {
    focusEntry(activePanel, panelState[activePanel].focusedIndex + delta);
  };

  const focusBoundaryEntry = (boundary: 'first' | 'last') => {
    const entryCount = SAMPLE_LISTINGS[activePanel].entries.length;
    focusEntry(activePanel, boundary === 'first' ? 0 : entryCount - 1);
  };

  const switchActivePanel = () => {
    const nextPanel = oppositePanelOf(activePanel);
    setActivePanel(nextPanel);
    setOverlayMessage(`활성 패널 전환: ${nextPanel.toUpperCase()}`);
  };

  const toggleFocusedSelection = (panelId: PanelId) => {
    const focusedEntry = SAMPLE_LISTINGS[panelId].entries[panelState[panelId].focusedIndex];
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
      selectedPaths: SAMPLE_LISTINGS[panelId].entries
        .filter((entry) => !entry.isVirtual)
        .map((entry) => entry.path),
    });
  };

  const clearSelection = (panelId: PanelId) => {
    updatePanel(panelId, { selectedPaths: [] });
  };

  const invertSelection = (panelId: PanelId) => {
    const concretePaths = SAMPLE_LISTINGS[panelId].entries
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
      const selected = current[panelId].selectedPaths;
      const selectedPaths = additive
        ? selected.includes(entry.path)
          ? selected.filter((path) => path !== entry.path)
          : [...selected, entry.path]
        : [entry.path];

      return {
        ...current,
        [panelId]: {
          focusedIndex: index,
          selectedPaths,
        },
      };
    });
  };

  const openEntry = (panelId: PanelId, entry: FileEntry) => {
    setActivePanel(panelId);
    setOverlayMessage(
      entry.kind === 'directory'
        ? `디렉터리 진입 예정: ${entry.name} · list_dir 경계 연결 대기`
        : `기본 앱 열기 예정: ${entry.name} · open_default 확인 대기`,
    );
  };

  const handleAction = (action: AppAction, panelOverride = activePanel, sourceOverride?: FileEntry[]) => {
    const actionId = action.id as ActionId;
    if (actionId === 'panel.switchActive') {
      switchActivePanel();
      return;
    }

    const panelListing = SAMPLE_LISTINGS[panelOverride];
    const oppositePanel = oppositePanelOf(panelOverride);
    const panelSelection = panelState[panelOverride].selectedPaths;
    const focusedEntry = panelListing.entries[panelState[panelOverride].focusedIndex];
    const selectedEntries = panelListing.entries.filter((entry) => panelSelection.includes(entry.path) && !entry.isVirtual);
    const focusedConcreteSource = focusedEntry && !focusedEntry.isVirtual ? [focusedEntry] : [];
    const sources = (sourceOverride ?? (selectedEntries.length > 0 ? selectedEntries : focusedConcreteSource)).filter(
      (entry) => !entry.isVirtual,
    );

    const actionTargetEntry = sourceOverride?.[0] ?? focusedEntry;
    if (actionId === 'nav.enter' && actionTargetEntry) {
      openEntry(panelOverride, actionTargetEntry);
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

    if (dialogKindForAction(actionId)) {
      if (actionNeedsConcreteSources(actionId) && sources.length === 0) {
        setOverlayMessage(`${labelForAction(action)} · 가상 항목은 파일 작업 대상이 될 수 없습니다.`);
        return;
      }

      openOperationDialog({
        action,
        panelId: panelOverride,
        sources,
        targetDir: SAMPLE_LISTINGS[oppositePanel].path,
        workingDir: panelListing.path,
      });
      return;
    }

    setOverlayMessage(`${labelForAction(action)} · ${action.runPath}`);
  };

  const activeListing = SAMPLE_LISTINGS[activePanel];
  const activeFocusedEntry = activeListing.entries[panelState[activePanel].focusedIndex] ?? null;
  const activeSelectedCount = activeListing.entries.filter(
    (entry) => panelState[activePanel].selectedPaths.includes(entry.path) && !entry.isVirtual,
  ).length;
  const context = createActionContext({
    activePanel,
    focusedEntry: activeFocusedEntry,
    selectedCount: activeSelectedCount,
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy: false,
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
          listing={SAMPLE_LISTINGS.left}
          active={activePanel === 'left'}
          state={panelState.left}
          onActivate={() => setActivePanel('left')}
          onStateChange={(next) => updatePanel('left', next)}
          onEntrySelect={(index, entry, additive) => selectEntry('left', index, entry, additive)}
          onEntryOpen={(entry) => openEntry('left', entry)}
          onOpenAction={(action, sources) => handleAction(action, 'left', sources)}
        />
        <FilePanel
          listing={SAMPLE_LISTINGS.right}
          active={activePanel === 'right'}
          state={panelState.right}
          onActivate={() => setActivePanel('right')}
          onStateChange={(next) => updatePanel('right', next)}
          onEntrySelect={(index, entry, additive) => selectEntry('right', index, entry, additive)}
          onEntryOpen={(entry) => openEntry('right', entry)}
          onOpenAction={(action, sources) => handleAction(action, 'right', sources)}
        />
      </section>
      <BottomStatusStrip listing={SAMPLE_LISTINGS[activePanel]} activePanel={activePanel} selectedCount={context.selectedCount} />
      <HotkeyStrip />
      <OverlayHost message={overlayMessage} onDismiss={() => setOverlayMessage(null)} />
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
  listing: DirectoryListing;
  active: boolean;
  state: PanelUiState;
  onActivate(): void;
  onStateChange(next: Partial<PanelUiState>): void;
  onEntrySelect(index: number, entry: FileEntry, additive: boolean): void;
  onEntryOpen(entry: FileEntry): void;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}

function FilePanel({ listing, active, state, onActivate, onStateChange, onEntrySelect, onEntryOpen, onOpenAction }: FilePanelProps) {
  const tableColumns = useMemo<ColumnDef<FileEntry>[]>(
    () => [
      {
        id: 'name',
        header: 'Name ▲',
        cell: ({ row }) => (
          <span className={`entry-name entry-kind-${row.original.kind}`}>
            <span className="entry-icon" aria-hidden="true">{entryIcon(row.original.kind)}</span>
            {row.original.name}
          </span>
        ),
      },
      {
        id: 'size',
        header: 'Size',
        cell: ({ row }) => formatSize(row.original),
      },
      {
        id: 'modified',
        header: 'Modified',
        cell: ({ row }) => formatModified(row.original.modifiedAt),
      },
    ],
    [],
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
    virtualizer.scrollToIndex(state.focusedIndex, { align: 'auto' });
  }, [state.focusedIndex, virtualizer]);

  return (
    <section
      className={`file-panel ${active ? 'is-active' : ''}`}
      aria-label={`${listing.panelId} panel ${listing.path}`}
      aria-current={active ? 'true' : undefined}
      onMouseDown={onActivate}
    >
      <PanelHeader listing={listing} active={active} />
      <PathControls listing={listing} />
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
          <div className="file-table-virtual-space" style={{ height: `${virtualizer.getTotalSize()}px` }}>
            {renderedRows.map((virtualRow) => {
              const row = rows[virtualRow.index];
              const entry = row.original;
              const focused = virtualRow.index === state.focusedIndex;
              const selected = state.selectedPaths.includes(entry.path);
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
                      selectedCount={state.selectedPaths.length}
                      onOpenAction={onOpenAction}
                    />
                  </ContextMenu.Portal>
                </ContextMenu.Root>
              );
            })}
          </div>
        </div>
      </div>
      <footer className="panel-status">
        <span>{summary.files} files, {summary.dirs} dirs</span>
        <span>{state.selectedPaths.length} selected</span>
        <span>{active ? 'ACTIVE' : 'TARGET'}</span>
      </footer>
    </section>
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

function PanelHeader({ listing, active }: { listing: DirectoryListing; active: boolean }) {
  return (
    <header className="panel-header">
      <span className="panel-path" title={listing.path}>· {shortenPath(listing.path)}</span>
      <span className={`panel-marker ${active ? 'active' : ''}`}>{active ? 'ACTIVE' : 'PASSIVE'}</span>
    </header>
  );
}

function PathControls({ listing }: { listing: DirectoryListing }) {
  return (
    <div className="path-controls" aria-label={`${listing.panelId} navigation controls`}>
      <button type="button">◀</button>
      <button type="button">▶</button>
      <button type="button">↑</button>
      <button type="button">⟳</button>
      <span className="path-input" title={listing.path}>{listing.path}</span>
      <button type="button">⌘</button>
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

const shortenPath = (path: string) => {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 4) {
    return `/${parts.join('/')}`;
  }
  return `/${parts.slice(0, 2).join('/')}/…/${parts.slice(-2).join('/')}`;
};

const oppositePanelOf = (panelId: PanelId): PanelId => (panelId === 'left' ? 'right' : 'left');

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const rowDomId = (panelId: PanelId, index: number) => `commander-row-${panelId}-${index}`;

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

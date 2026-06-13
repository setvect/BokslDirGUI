import * as ContextMenu from '@radix-ui/react-context-menu';
import * as Popover from '@radix-ui/react-popover';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useMemo, useRef, useState } from 'react';
import {
  ACTIONS,
  actionsForMenu,
  hotkeyStripActionsFromRegistry,
  isActionAvailable,
  labelForAction,
  menuRootsFromRegistry,
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

interface PanelUiState {
  focusedIndex: number;
  selectedPaths: string[];
}

export function CommanderShell() {
  const openOperationDialog = useOperationStore((state) => state.openDialog);
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
    const panelListing = SAMPLE_LISTINGS[panelOverride];
    const oppositePanel = panelOverride === 'left' ? 'right' : 'left';
    const panelSelection = panelState[panelOverride].selectedPaths;
    const focusedEntry = panelListing.entries[panelState[panelOverride].focusedIndex];
    const selectedEntries = panelListing.entries.filter((entry) => panelSelection.includes(entry.path) && !entry.isVirtual);
    const focusedConcreteSource = focusedEntry && !focusedEntry.isVirtual ? [focusedEntry] : [];
    const sources = (sourceOverride ?? (selectedEntries.length > 0 ? selectedEntries : focusedConcreteSource)).filter(
      (entry) => !entry.isVirtual,
    );

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

  return (
    <main className="commander-shell" aria-label="BokslDirGUI file commander shell">
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
                <Popover.Content className="menu-popover" sideOffset={4} align="start">
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
                      <kbd>{action.defaultShortcut ?? '·'}</kbd>
                    </button>
                  ))}
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          );
        })}
      </nav>
      <time className="clock" dateTime="2026-06-13T19:31:00+09:00">2026-06-13 19:31</time>
    </header>
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

  return (
    <section
      className={`file-panel ${active ? 'is-active' : ''}`}
      aria-label={`${listing.panelId} panel ${listing.path}`}
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
                      role="row"
                      tabIndex={focused ? 0 : -1}
                      aria-selected={selected}
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
                    <ContextMenu.Content className="context-menu">
                      <ContextMenu.Label className="context-label">{entry.name}</ContextMenu.Label>
                      {contextMenuActions(
                        entry,
                        createActionContext({
                          activePanel: listing.panelId,
                          focusedEntry: entry,
                          selectedCount: entry.isVirtual ? 0 : Math.max(state.selectedPaths.length, 1),
                          hasOppositePanel: true,
                          shellCommandEnabled: false,
                          operationBusy: false,
                        }),
                      ).map((action) => (
                        <ContextMenu.Item
                          key={action.id}
                          className="context-item"
                          onSelect={() => onOpenAction(action, [entry])}
                        >
                          <span>{labelForAction(action)}</span>
                          <kbd>{action.defaultShortcut ?? '·'}</kbd>
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.Content>
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
        const shortcut = action.defaultShortcut?.split('/')[0] ?? '·';
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

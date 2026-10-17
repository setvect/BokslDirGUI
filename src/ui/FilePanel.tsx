import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, type Ref, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import {
  type AppAction
} from '../actions/registry';
import type { FileEntry, Settings, PlatformInfo } from '../domain/types';
import {
  COMMANDER_UI_TEXT,
  formatUserErrorMessage
} from '../i18n-resources';
import {
  isArchiveVirtualPath
} from './archiveVirtual';
import { DirectoryComparisonState, directoryComparisonLabel } from './directoryComparison';
import { MiddleEllipsisEntryName } from './EntryName';
import { entryIcon, formatDate, formatOwnerGroup, formatSize, summarizeEntries } from './format';
import { BlankContextMenuContent, EntryContextMenuContent } from './PanelContextMenus';
import { PanelHeader } from './PanelHeader';
import { columnLayoutForPanelWidth, fileEntryAccessibleLabel, fileEntryTooltip, metadataColumnWidthsForEntries, pageMovementForViewport, rowDomId, sortMarker } from './panelPresentation';
import {
  type PanelNavigationState
} from './panelState';
import { SelectionMode } from './selectionModel';
import { useElementWidth } from './useElementWidth';

const FOCUSABLE_ROW_TAB_INDEX = -1;

export interface FilePanelHandle {
  moveFocusedPage(direction: -1 | 1, extendSelection?: boolean): void;
}

interface FilePanelProps {
  ref?: Ref<FilePanelHandle>;
  onFocusEntry(index: number, extendSelection: boolean): void;
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
  platformInfo?: PlatformInfo;
  onActivate(): void;
  onEntryFocus(index: number): void;
  onEntrySelect(index: number, entry: FileEntry, mode: SelectionMode): void;
  onEntryOpen(entry: FileEntry): void;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
  onEntryPointerDown(event: ReactPointerEvent<HTMLElement>, entry: FileEntry): void;
  dropIntent: 'copy' | 'move' | 'import' | 'blocked' | null;
  onPanelDragOver(event: DragEvent<HTMLElement>): void;
  onPanelDragLeave(): void;
  onPanelDrop(event: DragEvent<HTMLElement>): void;
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onGotoPath(): void;
  onClearFilter(): void;
  onRestoreFocus(): void;
}

export function FilePanel({
  ref,
  onFocusEntry,
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
  platformInfo,
  onActivate,
  onEntryFocus,
  onEntrySelect,
  onEntryOpen,
  onOpenAction,
  onEntryPointerDown,
  dropIntent,
  onPanelDragOver,
  onPanelDragLeave,
  onPanelDrop,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
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

  const pendingPageScroll = useRef<{ focusedIndex: number; scrollTop: number } | null>(null);
  useImperativeHandle(ref, () => ({
    moveFocusedPage(direction, extendSelection = false) {
      const scrollElement = scrollRef.current;
      if (!scrollElement) return;
      const movement = pageMovementForViewport({
        direction,
        focusedIndex: panel.focusedIndex,
        rowCount: rows.length,
        rowHeight: rowHeightPx,
        viewportHeight: scrollElement.clientHeight,
        scrollTop: scrollElement.scrollTop,
      });
      if (!movement) return;
      if (movement.focusedIndex === panel.focusedIndex) {
        virtualizer.scrollToOffset(movement.scrollTop);
      } else {
        pendingPageScroll.current = movement;
      }
      onFocusEntry(movement.focusedIndex, extendSelection);
    },
  }));

  useLayoutEffect(() => {
    const pageScroll = pendingPageScroll.current;
    pendingPageScroll.current = null;
    if (pageScroll?.focusedIndex === panel.focusedIndex) {
      virtualizer.scrollToOffset(pageScroll.scrollTop);
    } else if (rows.length > 0) {
      virtualizer.scrollToIndex(panel.focusedIndex, { align: 'auto' });
    }
  }, [panel.focusedIndex, rows.length, virtualizer]);

  useEffect(() => {
    const panelElement = panelRef.current;
    if (!panelElement) return;

    const keepPathSelectionInsidePath = () => {
      const selection = window.getSelection();
      if (!selection?.anchorNode || !selection.focusNode || selection.isCollapsed) return;

      const pathElement = [...panelElement.querySelectorAll<HTMLElement>('.path-input')]
        .find((element) => element.contains(selection.anchorNode));
      if (!pathElement || pathElement.contains(selection.focusNode)) return;

      const pathRange = document.createRange();
      pathRange.selectNodeContents(pathElement);
      const focusBeforePath = pathRange.comparePoint(selection.focusNode, selection.focusOffset) < 0;
      const boundaryText = focusBeforePath ? pathElement.firstChild : pathElement.lastChild;
      if (!boundaryText || boundaryText.nodeType !== Node.TEXT_NODE) return;

      selection.setBaseAndExtent(
        selection.anchorNode,
        selection.anchorOffset,
        boundaryText,
        focusBeforePath ? 0 : (boundaryText.textContent?.length ?? 0),
      );
    };

    document.addEventListener('selectionchange', keepPathSelectionInsidePath);
    return () => document.removeEventListener('selectionchange', keepPathSelectionInsidePath);
  }, []);

  return (
    <section
      ref={panelRef}
      className={`file-panel ${active ? 'is-active' : ''} ${hiddenByLayout ? 'is-hidden-by-layout' : ''} ${dropIntent ? `is-drop-${dropIntent}` : ''}`}
      data-panel-id={listing.panelId}
      aria-label={`${listing.panelId} panel ${listing.path}`}
      aria-current={active ? 'true' : undefined}
      aria-hidden={hiddenByLayout ? 'true' : undefined}
      onMouseDown={onActivate}
      onDragOver={onPanelDragOver}
      onDragLeave={onPanelDragLeave}
      onDrop={onPanelDrop}
    >
      {dropIntent ? (
        <span className="panel-drop-indicator" role="status">
          {dropIntent === 'copy'
            ? labels.dropCopy
            : dropIntent === 'move'
              ? labels.dropMove
              : dropIntent === 'import'
                ? labels.dropImport
                : labels.dropBlocked}
        </span>
      ) : null}
      <PanelHeader
        panel={panel}
        tabCount={tabCount}
        onClearFilter={onClearFilter}
        language={language}
        onNavigateBack={onNavigateBack}
        onNavigateForward={onNavigateForward}
        onNavigateUp={onNavigateUp}
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
                            draggable={false}
                            onPointerDown={(event) => onEntryPointerDown(event, entry)}
                            onDragStart={(event) => event.preventDefault()}
                            onClick={(event) => onEntrySelect(
                              virtualRow.index,
                              entry,
                              event.shiftKey ? 'range' : event.metaKey || event.ctrlKey ? 'additive' : 'replace',
                            )}
                            onDoubleClick={() => onEntryOpen(entry)}
                            onFocus={() => onEntryFocus(virtualRow.index)}
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
                            platformInfo={platformInfo}
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
              platformInfo={platformInfo}
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

import * as ContextMenu from '@radix-ui/react-context-menu';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useEffect, useLayoutEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import type { AppAction } from '../actions/registry';
import { displayPath } from '../domain/pathDisplay';
import type { FileEntry, PanelId, Settings } from '../domain/types';
import { COMMANDER_UI_TEXT, formatUserErrorMessage } from '../i18n-resources';
import type { SharedActionState } from './actionContext';
import { parseArchiveVirtualPath } from './archiveVirtual';
import { folderTreeActionTarget, folderTreeRowDomId, type FolderTreeRow } from './folderTreeModel';
import { entryIcon } from './format';
import { EntryContextMenuContent } from './PanelContextMenus';
import { createDirectoryListing } from './panelState';
import type { FolderTreeView } from './useFolderTrees';

// 맨 위 항목(드라이브·볼륨·서버 루트)과 열린 압축 파일은 이동만 허용
const NAVIGATION_ONLY_ACTION_IDS = ['nav.enter', 'nav.openInOtherPanel'] as const;

interface FolderTreeProps {
  panelId: PanelId;
  view: FolderTreeView;
  active: boolean;
  disconnected: boolean;
  rowHeightPx: number;
  language: Settings['language'];
  showIcons: boolean;
  dropFolderPath: string | null;
  actionState: SharedActionState;
  onRowClick(path: string): void;
  onToggleRow(path: string): void;
  onRowPointerDown(event: ReactPointerEvent<HTMLElement>, row: FolderTreeRow): void;
  onOpenAction(action: AppAction, row: FolderTreeRow, sources: FileEntry[]): void;
  onScrollElement(element: HTMLElement | null): void;
}

const rowIcon = (row: FolderTreeRow) => {
  const archive = parseArchiveVirtualPath(row.path);
  return archive && !archive.innerPath ? entryIcon('archive') : entryIcon(row.isLink ? 'symlink' : 'directory');
};

export function FolderTree({
  panelId,
  view,
  active,
  disconnected,
  rowHeightPx,
  language,
  showIcons,
  dropFolderPath,
  actionState,
  onRowClick,
  onToggleRow,
  onRowPointerDown,
  onOpenAction,
  onScrollElement,
}: FolderTreeProps) {
  const labels = COMMANDER_UI_TEXT[language];
  const { rows } = view;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeightPx,
    initialRect: { width: 220, height: 520 },
    overscan: 8,
  });
  const virtualRows = virtualizer.getVirtualItems();
  const renderedRows = virtualRows.length > 0
    ? virtualRows
    : rows.slice(0, Math.min(rows.length, 24)).map((_, index) => ({ index, start: index * rowHeightPx }));

  useEffect(() => {
    virtualizer.measure();
  }, [rowHeightPx, virtualizer]);

  // 커서(트리에 키보드가 있을 때) 또는 패널 경로의 줄이 보이게 스크롤
  const targetPath = view.cursorPath ?? view.selectedPath;
  const targetIndex = rows.findIndex((row) => row.path === targetPath);
  useLayoutEffect(() => {
    if (targetIndex >= 0) virtualizer.scrollToIndex(targetIndex, { align: 'auto' });
  }, [targetPath, targetIndex, virtualizer]);

  return (
    <div
      ref={(element) => {
        scrollRef.current = element;
        onScrollElement(element);
      }}
      className={`folder-tree${view.focused ? ' is-focused' : ''}${disconnected ? ' is-disconnected' : ''}`}
      role="tree"
      aria-label={labels.folderTree}
    >
      <div className="folder-tree-virtual-space" role="presentation" style={{ height: `${virtualizer.getTotalSize()}px` }}>
        {renderedRows.map((virtualRow) => {
          const row = rows[virtualRow.index];
          if (!row) return null;
          const selected = row.path === view.selectedPath;
          const cursor = row.path === view.cursorPath;
          const target = folderTreeActionTarget(panelId, row);
          const errorText = row.error ? `${labels.errorPrefix}: ${formatUserErrorMessage(language, row.error)}` : null;
          const title = errorText ? `${displayPath(row.path)}\n${errorText}` : displayPath(row.path);
          return (
            <ContextMenu.Root key={row.path}>
              <ContextMenu.Trigger asChild>
                <div
                  id={folderTreeRowDomId(panelId, virtualRow.index)}
                  role="treeitem"
                  tabIndex={-1}
                  aria-level={row.depth + 1}
                  aria-expanded={row.expandable ? row.expanded : undefined}
                  aria-selected={selected}
                  aria-current={cursor ? 'true' : undefined}
                  aria-busy={row.loading || undefined}
                  data-tree-path={row.path}
                  className={[
                    'folder-tree-row',
                    selected ? 'is-selected' : '',
                    cursor ? 'is-cursor' : '',
                    active ? '' : 'is-inactive',
                    row.isLink ? 'is-link' : '',
                    row.error ? 'has-error' : '',
                    dropFolderPath === row.path ? 'is-drop-target' : '',
                  ].filter(Boolean).join(' ')}
                  style={{ transform: `translateY(${virtualRow.start}px)`, '--folder-tree-depth': row.depth } as CSSProperties}
                  title={title}
                  draggable={false}
                  onPointerDown={(event) => onRowPointerDown(event, row)}
                  onDragStart={(event) => event.preventDefault()}
                  onClick={() => onRowClick(row.path)}
                  onDoubleClick={() => onToggleRow(row.path)}
                >
                  <span
                    className="folder-tree-toggle"
                    aria-hidden="true"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.stopPropagation();
                      if (row.expandable) onToggleRow(row.path);
                    }}
                    onDoubleClick={(event) => event.stopPropagation()}
                  >
                    {row.expandable ? (row.expanded ? '▾' : '▸') : ''}
                  </span>
                  {showIcons ? <span className="folder-tree-icon" aria-hidden="true">{rowIcon(row)}</span> : null}
                  <span className="folder-tree-name">{row.entry.name}</span>
                  {row.loading ? <span className="folder-tree-state" aria-hidden="true">⟳</span> : null}
                  {row.error ? <span className="folder-tree-state folder-tree-error" aria-hidden="true">!</span> : null}
                </div>
              </ContextMenu.Trigger>
              <ContextMenu.Portal>
                <EntryContextMenuContent
                  language={language}
                  entry={row.entry}
                  listing={target?.sourceListing ?? createDirectoryListing(panelId, row.path, [row.entry])}
                  selectedPaths={[]}
                  actionState={actionState}
                  allowedActionIds={target ? undefined : NAVIGATION_ONLY_ACTION_IDS}
                  onOpenAction={(action, sources) => onOpenAction(action, row, sources)}
                />
              </ContextMenu.Portal>
            </ContextMenu.Root>
          );
        })}
      </div>
    </div>
  );
}

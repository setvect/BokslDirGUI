import { useEffect, useRef, useState, type RefObject } from 'react';
import type { FileEntry, PanelId, Settings } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import { isArchiveVirtualPath } from './archiveVirtual';
import type { ListPanelOptions } from './commanderTypes';
import {
  createFolderTreeSpace,
  flattenFolderTree,
  folderTreeActionTarget,
  folderTreeChain,
  folderTreePathsToLoad,
  folderTreeRowDomId,
  folderTreeSpaceKey,
  LOCAL_FOLDER_TREE_SPACE,
  revealFolderTreePath,
  setFolderTreeExpanded,
  withFolderTreeChildren,
  withFolderTreeError,
  withFolderTreeListing,
  withFolderTreeLoading,
  withFolderTreeRoots,
  type FolderTreeRow,
  type FolderTreeSpace,
} from './folderTreeModel';
import type { PanelDataSource } from './panelDataSource';
import { panelIdLabel } from './panelPresentation';
import { PANEL_IDS, type PanelStateById } from './panelState';
import { clampFolderTreeWidth, folderTreeSettingsOf } from './settingsModel';

// 트리 커서가 멈춘 뒤 패널이 그 폴더로 따라가기까지의 시간(FR-42.6)
export const FOLDER_TREE_FOLLOW_DELAY_MS = 300;
// 끌어온 항목이 접힌 폴더 위에 머물면 펼치는 시간, 트리 위아래 가장자리 자동 스크롤
export const FOLDER_TREE_DRAG_EXPAND_DELAY_MS = 700;
const DRAG_SCROLL_EDGE_PX = 24;
const DRAG_SCROLL_STEP_PX = 18;

interface FolderTreeDependencies {
  readonly settings: Settings;
  readonly saveSettingsPatch: (patch: Partial<Settings>, successMessage: string | null) => unknown;
  readonly panelState: PanelStateById;
  readonly panelStateRef: RefObject<PanelStateById>;
  readonly activePanel: PanelId;
  readonly dataSource: Pick<PanelDataSource, 'listSubdirs' | 'listLocations'>;
  readonly archiveSubdirectories: (virtualPath: string) => FileEntry[] | null;
  readonly listPanel: (panelId: PanelId, path: string, options?: ListPanelOptions) => Promise<unknown>;
  readonly setActivePanel: (panelId: PanelId) => void;
  readonly statusText: CommanderStatusText;
  readonly rowHeightPx: number;
}

export interface FolderTreeView {
  readonly visible: boolean;
  // 100% 배율 기준 px(경계선을 끄는 동안은 저장 전 폭)
  readonly width: number;
  readonly rows: readonly FolderTreeRow[];
  readonly selectedPath: string;
  readonly cursorPath: string | null;
  readonly focused: boolean;
}

const requestKeyOf = (panelId: PanelId, spaceKey: string, path: string) => `${panelId}\u0000${spaceKey}\u0000${path}`;
const physicalLetter = (event: KeyboardEvent) =>
  /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : event.key.toLowerCase();
const sameStrings = (left: readonly string[] | null, right: readonly string[]) =>
  Boolean(left && left.length === right.length && left.every((value, index) => value === right[index]));

// 패널별 폴더 트리 상태(FR-42). 패널 이동은 `listPanel` 경로를 그대로 쓰고 트리는 읽어 둔 폴더·펼침·커서만 소유
export function useFolderTrees(deps: FolderTreeDependencies) {
  const runtimeRef = useRef(deps);
  runtimeRef.current = deps;
  const treeSettings = folderTreeSettingsOf(deps.settings);
  const [widthDraft, setWidthDraft] = useState<Record<PanelId, number | null>>({ left: null, right: null });
  const [spaces, setSpaces] = useState<Record<PanelId, Readonly<Record<string, FolderTreeSpace>>>>({ left: {}, right: {} });
  const spacesRef = useRef(spaces);
  spacesRef.current = spaces;
  const [localRoots, setLocalRoots] = useState<readonly string[] | null>(null);
  const appliedRootsRef = useRef<readonly string[] | null>(null);
  const rootsRequestRef = useRef(0);
  const [focusedPanel, setFocusedPanel] = useState<PanelId | null>(null);
  const [cursors, setCursors] = useState<Record<PanelId, string | null>>({ left: null, right: null });
  const followTimersRef = useRef<Record<PanelId, number | null>>({ left: null, right: null });
  const requestsRef = useRef(new Map<string, number>());
  const requestSeqRef = useRef(0);
  const scrollElementsRef = useRef<Record<PanelId, HTMLElement | null>>({ left: null, right: null });
  const dragHoverRef = useRef<{ panelId: PanelId; path: string; timer: number } | null>(null);

  const visible = { left: treeSettings.left.visible, right: treeSettings.right.visible };
  const panelPaths = { left: deps.panelState.left.path, right: deps.panelState.right.path };
  const rootsFor = (key: string) => (key === LOCAL_FOLDER_TREE_SPACE ? localRoots ?? [] : [key]);

  // 상태에 아직 없으면(처음 켠 직후) 같은 규칙으로 만든 임시 공간을 그림
  const spaceFor = (panelId: PanelId) => {
    const path = deps.panelState[panelId].path;
    const key = folderTreeSpaceKey(path);
    return spaces[panelId][key] ?? revealFolderTreePath(createFolderTreeSpace(key, rootsFor(key)), path);
  };
  const rowsFor = (panelId: PanelId): FolderTreeRow[] => {
    if (!visible[panelId]) return [];
    const space = spaceFor(panelId);
    const panel = deps.panelState[panelId];
    return flattenFolderTree(space, { showHidden: panel.showHidden, chain: folderTreeChain(space.roots, panel.path) });
  };
  const rows = { left: rowsFor('left'), right: rowsFor('right') };
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const cursorPathOf = (panelId: PanelId) => cursors[panelId] ?? panelPaths[panelId];

  const updateSpace = (panelId: PanelId, key: string, update: (space: FolderTreeSpace) => FolderTreeSpace) => {
    setSpaces((current) => {
      const space = current[panelId][key];
      if (!space) return current;
      const next = update(space);
      return next === space ? current : { ...current, [panelId]: { ...current[panelId], [key]: next } };
    });
  };

  const loadChildren = (panelId: PanelId, key: string, path: string, background = false) => {
    const requestKey = requestKeyOf(panelId, key, path);
    const requestId = ++requestSeqRef.current;
    requestsRef.current.set(requestKey, requestId);
    if (isArchiveVirtualPath(path)) {
      // 압축 안 폴더는 패널이 읽어 둔 압축 목록으로 만듦(추가 읽기 없음), 목록이 캐시에 없으면 읽어 둔 내용 유지
      const entries = runtimeRef.current.archiveSubdirectories(path);
      requestsRef.current.delete(requestKey);
      updateSpace(panelId, key, (space) => (entries || space.nodes[path]?.children === null
        ? withFolderTreeChildren(space, path, entries ?? [])
        : space));
      return;
    }
    const { listSubdirs } = runtimeRef.current.dataSource;
    if (!listSubdirs) {
      requestsRef.current.delete(requestKey);
      updateSpace(panelId, key, (space) => withFolderTreeChildren(space, path, []));
      return;
    }
    if (!background) updateSpace(panelId, key, (space) => withFolderTreeLoading(space, path));
    void listSubdirs({ path }).then((result) => {
      if (requestsRef.current.get(requestKey) !== requestId) return;
      requestsRef.current.delete(requestKey);
      updateSpace(panelId, key, (space) => (result.ok
        ? withFolderTreeChildren(space, path, result.data.entries)
        : withFolderTreeError(space, path, result.error)));
    });
  };

  const loadLocalRoots = () => {
    const requestId = ++rootsRequestRef.current;
    void runtimeRef.current.dataSource.listLocations().then((result) => {
      if (requestId !== rootsRequestRef.current) return;
      const roots = result.ok ? result.data.roots : [];
      setLocalRoots((current) => (sameStrings(current, roots) ? current : roots));
    });
  };

  const needsLocalRoots = PANEL_IDS.some((panelId) => visible[panelId] && folderTreeSpaceKey(panelPaths[panelId]) === LOCAL_FOLDER_TREE_SPACE);
  useEffect(() => {
    if (needsLocalRoots && localRoots === null && rootsRequestRef.current === 0) loadLocalRoots();
  }, [needsLocalRoots, localRoots]);

  // 패널 경로까지 펼치기(맨 위 항목을 새로 읽었으면 먼저 교체)
  useEffect(() => {
    const rootsChanged = localRoots !== appliedRootsRef.current;
    appliedRootsRef.current = localRoots;
    setSpaces((current) => {
      let next = current;
      for (const panelId of PANEL_IDS) {
        const byKey = { ...next[panelId] };
        let changed = false;
        const local = byKey[LOCAL_FOLDER_TREE_SPACE];
        if (rootsChanged && localRoots && local) {
          byKey[LOCAL_FOLDER_TREE_SPACE] = withFolderTreeRoots(local, localRoots);
          changed = true;
        }
        if (visible[panelId]) {
          const path = panelPaths[panelId];
          const key = folderTreeSpaceKey(path);
          const revealed = revealFolderTreePath(byKey[key] ?? createFolderTreeSpace(key, rootsFor(key)), path);
          if (revealed !== byKey[key]) {
            byKey[key] = revealed;
            changed = true;
          }
        }
        if (changed) next = { ...next, [panelId]: byKey };
      }
      return next;
    });
  }, [visible.left, visible.right, panelPaths.left, panelPaths.right, localRoots]);

  // 패널이 현재 폴더를 읽을 때마다(이동·외부 변경·작업 뒤 새로고침) 그 목록으로 트리 노드 갱신
  const listings = { left: deps.panelState.left.listing, right: deps.panelState.right.listing };
  useEffect(() => {
    for (const panelId of PANEL_IDS) {
      const panel = runtimeRef.current.panelState[panelId];
      if (!visible[panelId] || panel.loading || panel.error || panel.listing.path !== panel.path) continue;
      const key = folderTreeSpaceKey(panel.path);
      requestsRef.current.delete(requestKeyOf(panelId, key, panel.path));
      updateSpace(panelId, key, (space) => withFolderTreeListing(space, panel.listing, panel.showHidden));
    }
  }, [visible.left, visible.right, listings.left, listings.right, deps.panelState.left.loading, deps.panelState.right.loading]);

  // 펼쳐져 보이는데 아직 읽지 않은 폴더 읽기
  const showHidden = { left: deps.panelState.left.showHidden, right: deps.panelState.right.showHidden };
  useEffect(() => {
    for (const panelId of PANEL_IDS) {
      if (!visible[panelId]) continue;
      const key = folderTreeSpaceKey(panelPaths[panelId]);
      const space = spaces[panelId][key];
      if (!space) continue;
      for (const path of folderTreePathsToLoad(space, rows[panelId], showHidden[panelId])) {
        if (!requestsRef.current.has(requestKeyOf(panelId, key, path))) loadChildren(panelId, key, path);
      }
    }
  }, [spaces, visible.left, visible.right, panelPaths.left, panelPaths.right, showHidden.left, showHidden.right]);

  const clearFollow = (panelId: PanelId) => {
    const timer = followTimersRef.current[panelId];
    if (timer !== null) window.clearTimeout(timer);
    followTimersRef.current[panelId] = null;
  };

  const navigate = (panelId: PanelId, path: string) => {
    const runtime = runtimeRef.current;
    if (runtime.panelStateRef.current?.[panelId].path === path) return;
    void runtime.listPanel(panelId, path, { pushHistory: true, preserveSelection: false, focusPath: null, focusFallback: 'first-concrete' });
  };

  const scheduleFollow = (panelId: PanelId, path: string) => {
    clearFollow(panelId);
    followTimersRef.current[panelId] = window.setTimeout(() => {
      followTimersRef.current[panelId] = null;
      navigate(panelId, path);
    }, FOLDER_TREE_FOLLOW_DELAY_MS);
  };

  const flushFollow = (panelId: PanelId) => {
    if (followTimersRef.current[panelId] === null) return;
    clearFollow(panelId);
    navigate(panelId, cursorPathOf(panelId));
  };

  const blurTree = () => {
    for (const panelId of PANEL_IDS) clearFollow(panelId);
    setFocusedPanel(null);
    setCursors({ left: null, right: null });
  };

  const focusTree = (panelId: PanelId, cursorPath: string) => {
    setFocusedPanel(panelId);
    setCursors((current) => ({ ...current, [panelId]: cursorPath }));
  };

  // 다른 패널로 옮기거나 트리를 숨기면 목록으로 복귀
  useEffect(() => {
    if (focusedPanel && (focusedPanel !== deps.activePanel || !visible[focusedPanel])) blurTree();
  }, [deps.activePanel, visible.left, visible.right, focusedPanel]);

  // 트리 밖에서 패널이 이동하면(상위 폴더·뒤로·링크 폴더의 실제 위치) 커서도 패널 경로로, 따라가기 대기 중이면 유지
  useEffect(() => {
    if (!focusedPanel || followTimersRef.current[focusedPanel] !== null) return;
    const path = panelPaths[focusedPanel];
    setCursors((current) => (current[focusedPanel] === path ? current : { ...current, [focusedPanel]: path }));
  }, [panelPaths.left, panelPaths.right]);

  useEffect(() => () => {
    for (const panelId of PANEL_IDS) clearFollow(panelId);
    if (dragHoverRef.current) window.clearTimeout(dragHoverRef.current.timer);
  }, []);

  const saveTreeSettings = (panelId: PanelId, update: Partial<{ visible: boolean; width: number }>, message: string | null) => {
    const runtime = runtimeRef.current;
    const current = folderTreeSettingsOf(runtime.settings);
    void runtime.saveSettingsPatch({
      layout: { ...runtime.settings.layout, folderTree: { ...current, [panelId]: { ...current[panelId], ...update } } },
    }, message);
  };

  const toggleVisible = (panelId: PanelId) => {
    const runtime = runtimeRef.current;
    const nextVisible = !folderTreeSettingsOf(runtime.settings)[panelId].visible;
    if (!nextVisible && focusedPanel === panelId) blurTree();
    saveTreeSettings(panelId, { visible: nextVisible },
      runtime.statusText.folderTree(panelIdLabel(panelId, runtime.settings.language), nextVisible));
  };

  // 목록 ↔ 트리. 트리가 꺼져 있으면 켜면서 이동
  const toggleFocus = (panelId: PanelId) => {
    if (focusedPanel === panelId) {
      blurTree();
      return;
    }
    if (!folderTreeSettingsOf(runtimeRef.current.settings)[panelId].visible) toggleVisible(panelId);
    runtimeRef.current.setActivePanel(panelId);
    focusTree(panelId, panelPaths[panelId]);
  };

  const setWidth = (panelId: PanelId, width: number, commit: boolean) => {
    const clamped = clampFolderTreeWidth(width);
    setWidthDraft((current) => ({ ...current, [panelId]: commit ? null : clamped }));
    if (commit && folderTreeSettingsOf(runtimeRef.current.settings)[panelId].width !== clamped) {
      saveTreeSettings(panelId, { width: clamped }, null);
    }
  };

  const toggleExpanded = (panelId: PanelId, path: string, expand?: boolean) => {
    const key = folderTreeSpaceKey(runtimeRef.current.panelStateRef.current?.[panelId].path ?? panelPaths[panelId]);
    const space = spacesRef.current[panelId][key];
    const node = space?.nodes[path];
    if (!space || !node || node.entry.kind === 'symlink') return;
    const next = expand ?? !space.expanded.has(path);
    if (next === space.expanded.has(path)) return;
    updateSpace(panelId, key, (current) => setFolderTreeExpanded(current, path, next));
    // 다시 펼칠 때 읽어 둔 목록은 보여 주면서 다시 읽고, 실패했던 폴더는 다시 시도
    if (next && (node.children !== null || node.error)) loadChildren(panelId, key, path, node.children !== null && !node.error);
  };

  // 줄 클릭: 그 폴더로 바로 이동하고 트리에서 계속 키보드 조작
  const activateRow = (panelId: PanelId, path: string) => {
    runtimeRef.current.setActivePanel(panelId);
    clearFollow(panelId);
    focusTree(panelId, path);
    navigate(panelId, path);
  };

  // 펼침 화살표 클릭: 이동 없이 펼치기·접기만
  const toggleRow = (panelId: PanelId, path: string) => {
    runtimeRef.current.setActivePanel(panelId);
    if (focusedPanel !== panelId) focusTree(panelId, panelPaths[panelId]);
    toggleExpanded(panelId, path);
  };

  const moveCursor = (panelId: PanelId, index: number) => {
    const panelRows = rowsRef.current[panelId];
    const target = panelRows[Math.min(Math.max(index, 0), panelRows.length - 1)];
    if (!target || target.path === cursorPathOf(panelId)) return;
    setCursors((current) => ({ ...current, [panelId]: target.path }));
    scheduleFollow(panelId, target.path);
  };

  const moveToBoundary = (panelId: PanelId, boundary: 'first' | 'last') =>
    moveCursor(panelId, boundary === 'first' ? 0 : rowsRef.current[panelId].length - 1);

  const pageSize = (panelId: PanelId) => {
    const height = scrollElementsRef.current[panelId]?.clientHeight ?? 0;
    const rowHeight = Math.max(1, runtimeRef.current.rowHeightPx);
    return Math.max(1, Math.floor(height / rowHeight) - 1);
  };

  // 트리에 키보드가 있을 때의 이동·펼치기 키. 처리하지 않은 키는 공통 단축키로 넘어감
  const handleKey = (event: KeyboardEvent, sequencePending: boolean) => {
    const panelId = focusedPanel;
    if (!panelId || panelId !== runtimeRef.current.activePanel) return false;
    const panelRows = rowsRef.current[panelId];
    if (!panelRows.length) return false;
    const found = panelRows.findIndex((row) => row.path === cursorPathOf(panelId));
    const index = Math.max(found, 0);
    const row = panelRows[index];
    const command = event.ctrlKey || event.metaKey;
    const plain = !command && !event.altKey;
    const letter = plain && !sequencePending ? physicalLetter(event) : null;
    let handled = true;
    if (event.key === 'ArrowDown' && plain || letter === 'j') moveCursor(panelId, index + 1);
    else if (event.key === 'ArrowUp' && plain || letter === 'k') moveCursor(panelId, index - 1);
    else if (event.key === 'PageDown' || (command && !event.altKey && physicalLetter(event) === 'd')) moveCursor(panelId, index + pageSize(panelId));
    else if (event.key === 'PageUp' || (command && !event.altKey && physicalLetter(event) === 'u')) moveCursor(panelId, index - pageSize(panelId));
    else if (event.key === 'Home' && plain) moveCursor(panelId, 0);
    else if (event.key === 'End' && plain) moveCursor(panelId, panelRows.length - 1);
    else if (event.key === 'ArrowRight' && plain || letter === 'l') {
      if (row.expandable && !row.expanded) toggleExpanded(panelId, row.path, true);
      else if (row.expanded && panelRows[index + 1]?.parentPath === row.path) moveCursor(panelId, index + 1);
    } else if (event.key === 'ArrowLeft' && plain || letter === 'h') {
      if (row.expanded) toggleExpanded(panelId, row.path, false);
      else if (row.parentPath !== null) moveCursor(panelId, panelRows.findIndex((candidate) => candidate.path === row.parentPath));
    } else if (event.key === 'Enter' && plain) {
      flushFollow(panelId);
      blurTree();
    } else if (event.key === 'Escape' && plain) {
      blurTree();
    } else {
      handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
    return handled;
  };

  // 끌어 놓기 중 트리 위: 접힌 폴더에 머물면 펼치고 위아래 가장자리에서 스크롤
  const dragHover = (panelId: PanelId | null, path: string | null, point: { x: number; y: number } | null) => {
    const element = panelId ? scrollElementsRef.current[panelId] : null;
    if (element && point) {
      const rect = element.getBoundingClientRect();
      if (point.x >= rect.left && point.x <= rect.right) {
        if (point.y >= rect.top && point.y < rect.top + DRAG_SCROLL_EDGE_PX) element.scrollTop -= DRAG_SCROLL_STEP_PX;
        else if (point.y <= rect.bottom && point.y > rect.bottom - DRAG_SCROLL_EDGE_PX) element.scrollTop += DRAG_SCROLL_STEP_PX;
      }
    }
    const hover = dragHoverRef.current;
    if (hover && hover.panelId === panelId && hover.path === path) return;
    if (hover) window.clearTimeout(hover.timer);
    dragHoverRef.current = null;
    if (!panelId || !path) return;
    const timer = window.setTimeout(() => {
      dragHoverRef.current = null;
      toggleExpanded(panelId, path, true);
    }, FOLDER_TREE_DRAG_EXPAND_DELAY_MS);
    dragHoverRef.current = { panelId, path, timer };
  };

  // 새로고침: 펼친 폴더를 다시 읽음(현재 폴더는 패널 목록으로 갱신). 직접 새로고침이면 드라이브·볼륨 목록도
  const refresh = (panelId: PanelId, includeRoots = false) => {
    if (!folderTreeSettingsOf(runtimeRef.current.settings)[panelId].visible) return;
    const path = runtimeRef.current.panelStateRef.current?.[panelId].path ?? panelPaths[panelId];
    const key = folderTreeSpaceKey(path);
    const space = spacesRef.current[panelId][key];
    if (!space) return;
    if (includeRoots && key === LOCAL_FOLDER_TREE_SPACE) loadLocalRoots();
    for (const row of rowsRef.current[panelId]) {
      const node = space.nodes[row.path];
      if (row.path !== path && row.expanded && node && (node.children !== null || node.error)) {
        loadChildren(panelId, key, row.path, node.children !== null);
      }
    }
  };

  const view = (panelId: PanelId): FolderTreeView => ({
    visible: visible[panelId],
    width: widthDraft[panelId] ?? treeSettings[panelId].width,
    rows: rows[panelId],
    selectedPath: panelPaths[panelId],
    cursorPath: focusedPanel === panelId ? cursorPathOf(panelId) : null,
    focused: focusedPanel === panelId,
  });

  const cursorRow = (panelId: PanelId) =>
    focusedPanel === panelId ? rows[panelId].find((row) => row.path === cursorPathOf(panelId)) ?? null : null;

  return {
    views: { left: view('left'), right: view('right') },
    focusedPanel,
    // 트리에 키보드가 있을 때 작업 대상(맨 위 항목·열린 압축 파일이면 null)
    actionTarget: (panelId: PanelId) => {
      const row = cursorRow(panelId);
      return row ? folderTreeActionTarget(panelId, row) : null;
    },
    activeRowDomId: (panelId: PanelId) => {
      if (focusedPanel !== panelId) return null;
      const index = rows[panelId].findIndex((row) => row.path === cursorPathOf(panelId));
      return index >= 0 ? folderTreeRowDomId(panelId, index) : null;
    },
    toggleVisible,
    toggleFocus,
    blurTree,
    setWidth,
    activateRow,
    toggleRow,
    toggleExpanded,
    moveToBoundary,
    handleKey,
    dragHover,
    refresh,
    registerScrollElement: (panelId: PanelId, element: HTMLElement | null) => {
      scrollElementsRef.current[panelId] = element;
    },
  };
}

export type FolderTreeController = ReturnType<typeof useFolderTrees>;

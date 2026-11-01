import { displayPath } from '../domain/pathDisplay';
import { DEFAULT_SFTP_PORT, parseRemotePath, remoteLocationKey, remotePathParent } from '../domain/remotePath';
import type { AppError, DirectoryListing, FileEntry, PanelId } from '../domain/types';
import { archiveParentPath, parseArchiveVirtualPath } from './archiveVirtual';
import { createDirectoryListing, parentPathOf } from './panelState';

// 폴더 트리(FR-42) 순수 모델. 공간(로컬 또는 SFTP 서버)마다 읽어 둔 폴더·펼침 상태를 갖고,
// 패널 경로까지의 경로(chain)를 펼쳐 보이는 줄 목록으로 평탄화. React·Tauri와 무관.

export const LOCAL_FOLDER_TREE_SPACE = 'local';

export interface FolderTreeNode {
  readonly entry: FileEntry;
  // 읽은 하위 폴더 경로(이름순). null이면 아직 읽지 않음
  readonly children: readonly string[] | null;
  // 숨김 폴더 없이 채운 목록(숨김 파일을 끈 패널 목록에서 채움)
  readonly partial: boolean;
  readonly loading: boolean;
  readonly error: AppError | null;
}

export interface FolderTreeSpace {
  readonly key: string;
  readonly roots: readonly string[];
  readonly nodes: Readonly<Record<string, FolderTreeNode>>;
  readonly expanded: ReadonlySet<string>;
}

export interface FolderTreeRow {
  readonly path: string;
  readonly entry: FileEntry;
  readonly depth: number;
  readonly parentPath: string | null;
  // 링크 폴더와 하위 폴더가 없다고 확인된 폴더만 false
  readonly expandable: boolean;
  readonly expanded: boolean;
  readonly loading: boolean;
  readonly error: AppError | null;
  readonly isLink: boolean;
}

// 펼침 깊이 상한: 비정상 경로 관계로 인한 무한 평탄화 방지
const MAX_TREE_DEPTH = 256;

export const folderTreeSpaceKey = (path: string) => {
  const remote = parseRemotePath(path);
  return remote ? remoteLocationKey(remote) : LOCAL_FOLDER_TREE_SPACE;
};

export const isFolderTreeEntry = (entry: FileEntry) =>
  !entry.isVirtual && (entry.kind === 'directory' || (entry.kind === 'symlink' && entry.symlinkTargetIsDirectory === true));

// 트리의 상위 폴더. 압축 내부는 압축 안 상위(압축 루트면 압축 파일이 있는 폴더), 맨 위면 null
export const folderTreeParentOf = (path: string): string | null => {
  if (parseArchiveVirtualPath(path)) return archiveParentPath(path);
  const remote = parseRemotePath(path);
  if (remote) return remotePathParent(remote);
  const parent = parentPathOf(path);
  return parent === path ? null : parent;
};

const lastSegment = (path: string) => path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;

export const folderTreeNameOf = (path: string) => {
  const archive = parseArchiveVirtualPath(path);
  if (archive) return lastSegment(archive.innerPath || archive.archivePath);
  const remote = parseRemotePath(path);
  if (remote) {
    if (remote.path !== '/') return lastSegment(remote.path);
    return `${remote.user}@${remote.host}${remote.port === DEFAULT_SFTP_PORT ? '' : `:${remote.port}`}`;
  }
  return folderTreeParentOf(path) === null ? displayPath(path) : lastSegment(path);
};

// 읽기 전 경로(맨 위 항목, 패널 경로까지의 중간 폴더)의 자리 표시 항목
export const folderTreeEntryFor = (path: string): FileEntry => ({
  path,
  name: folderTreeNameOf(path),
  kind: 'directory',
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: false,
  isVirtual: false,
});

// Windows 드라이브 루트(`C:\`)와 정규화 경로(`\\?\C:\`)는 같은 폴더
const sameTreePath = (left: string, right: string) => left === right || displayPath(left) === displayPath(right);

// Rust `sort_entries`의 이름순과 같은 비교(소문자 비교 뒤 원래 이름)
const compareTreeNames = (left: string, right: string) => {
  const lowerLeft = left.toLowerCase();
  const lowerRight = right.toLowerCase();
  if (lowerLeft !== lowerRight) return lowerLeft < lowerRight ? -1 : 1;
  return left < right ? -1 : left > right ? 1 : 0;
};

export const sortFolderTreeEntries = (entries: readonly FileEntry[]) =>
  [...entries].sort((left, right) => compareTreeNames(left.name, right.name));

const emptyNode = (entry: FileEntry): FolderTreeNode => ({ entry, children: null, partial: false, loading: false, error: null });

export const createFolderTreeSpace = (key: string, roots: readonly string[] = []): FolderTreeSpace => ({
  key,
  roots: [...roots],
  nodes: Object.fromEntries(roots.map((root) => [root, emptyNode(folderTreeEntryFor(root))])),
  expanded: new Set(),
});

// 패널 경로부터 가장 가까운 맨 위 항목까지의 경로(맨 위 항목이 처음). 맨 위 항목에 없으면 가장 위 폴더에서 끝남
export const folderTreeChain = (roots: readonly string[], path: string): string[] => {
  const chain = [path];
  let current = path;
  while (!roots.some((root) => sameTreePath(root, current))) {
    const parent = folderTreeParentOf(current);
    if (parent === null || chain.includes(parent)) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
};

// 맨 위 항목 교체(위치 목록을 새로 읽은 경우). 같은 폴더의 기존 항목·상태 유지
export const withFolderTreeRoots = (space: FolderTreeSpace, roots: readonly string[]): FolderTreeSpace => {
  const nodes = { ...space.nodes };
  const nextRoots = roots.map((root) => space.roots.find((current) => sameTreePath(current, root)) ?? root);
  for (const root of nextRoots) {
    nodes[root] ??= emptyNode(folderTreeEntryFor(root));
  }
  return { ...space, roots: nextRoots, nodes };
};

// 패널 경로가 보이도록 상위 폴더를 펼치고 경로의 자리 표시 항목 보장
export const revealFolderTreePath = (space: FolderTreeSpace, path: string): FolderTreeSpace => {
  const chain = folderTreeChain(space.roots, path);
  const top = chain[0];
  if (space.roots.includes(top) && chain.every((chainPath) => space.nodes[chainPath])
    && chain.slice(0, -1).every((ancestor) => space.expanded.has(ancestor))) {
    return space;
  }
  const nodes = { ...space.nodes };
  const matchIndex = space.roots.findIndex((root) => sameTreePath(root, top));
  let roots = space.roots;
  if (matchIndex < 0) {
    roots = [...roots, top];
  } else if (roots[matchIndex] !== top) {
    // 위치 목록의 표기(`C:\`)를 패널이 쓰는 정규화 경로로 맞춤
    const previous = roots[matchIndex];
    nodes[top] = nodes[previous] ? { ...nodes[previous], entry: { ...nodes[previous].entry, path: top } } : emptyNode(folderTreeEntryFor(top));
    delete nodes[previous];
    roots = roots.map((root, index) => (index === matchIndex ? top : root));
  }
  for (const chainPath of chain) {
    nodes[chainPath] ??= emptyNode(folderTreeEntryFor(chainPath));
  }
  const ancestors = chain.slice(0, -1);
  const alreadyExpanded = ancestors.every((ancestor) => space.expanded.has(ancestor));
  const expanded = alreadyExpanded ? space.expanded : new Set([...space.expanded, ...ancestors]);
  return { ...space, roots, nodes, expanded };
};

export const setFolderTreeExpanded = (space: FolderTreeSpace, path: string, expanded: boolean): FolderTreeSpace => {
  if (space.expanded.has(path) === expanded) return space;
  const next = new Set(space.expanded);
  if (expanded) next.add(path);
  else next.delete(path);
  return { ...space, expanded: next };
};

const updateNode = (space: FolderTreeSpace, path: string, update: (node: FolderTreeNode) => FolderTreeNode): FolderTreeSpace => {
  const node = space.nodes[path];
  if (!node) return space;
  return { ...space, nodes: { ...space.nodes, [path]: update(node) } };
};

export const withFolderTreeLoading = (space: FolderTreeSpace, path: string) =>
  updateNode(space, path, (node) => ({ ...node, loading: true, error: null }));

// 읽기 실패: 전에 읽은 하위 폴더는 유지하고 오류만 표시
export const withFolderTreeError = (space: FolderTreeSpace, path: string, error: AppError) =>
  updateNode(space, path, (node) => ({ ...node, loading: false, error }));

const pruneSubtree = (nodes: Record<string, FolderTreeNode>, path: string, depth = 0) => {
  const node = nodes[path];
  if (!node || depth > MAX_TREE_DEPTH) return;
  delete nodes[path];
  for (const child of node.children ?? []) pruneSubtree(nodes, child, depth + 1);
};

// 하위 폴더 목록 반영. 이미 아는 하위 폴더의 읽은 내용·펼침은 유지하고 사라진 폴더는 하위까지 제거
export const withFolderTreeChildren = (
  space: FolderTreeSpace,
  path: string,
  entries: readonly FileEntry[],
  options: { partial?: boolean } = {},
): FolderTreeSpace => {
  const node = space.nodes[path];
  if (!node) return space;
  const childPaths = entries.map((entry) => entry.path);
  const kept = new Set(childPaths);
  const nodes = { ...space.nodes };
  for (const removed of (node.children ?? []).filter((child) => !kept.has(child))) {
    pruneSubtree(nodes, removed);
  }
  for (const entry of entries) {
    const existing = nodes[entry.path];
    nodes[entry.path] = existing ? { ...existing, entry } : emptyNode(entry);
  }
  nodes[path] = { ...node, children: childPaths, partial: options.partial ?? false, loading: false, error: null };
  return { ...space, nodes };
};

// 패널이 읽은 현재 폴더 목록으로 그 폴더의 하위 폴더 갱신(추가 읽기 없음).
// 숨김 파일을 끈 목록이면 전에 읽어 둔 숨김 폴더를 유지하고, 처음 읽는 폴더는 숨김 폴더가 빠진 목록으로 표시
export const withFolderTreeListing = (space: FolderTreeSpace, listing: DirectoryListing, showHidden: boolean): FolderTreeSpace => {
  const node = space.nodes[listing.path];
  if (!node || listing.filter || listing.truncated) return space;
  const folders = listing.entries.filter(isFolderTreeEntry);
  if (showHidden) return withFolderTreeChildren(space, listing.path, folders);
  const listed = new Set(folders.map((entry) => entry.path));
  const hiddenKnown = (node.children ?? [])
    .map((child) => space.nodes[child]?.entry)
    .filter((entry): entry is FileEntry => Boolean(entry?.isHidden && !listed.has(entry.path)));
  return withFolderTreeChildren(space, listing.path, sortFolderTreeEntries([...folders, ...hiddenKnown]), {
    partial: node.children === null || node.partial,
  });
};

const insertByName = (paths: readonly string[], path: string, nodes: FolderTreeSpace['nodes']) => {
  const name = nodes[path]?.entry.name ?? path;
  const index = paths.findIndex((candidate) => compareTreeNames(nodes[candidate]?.entry.name ?? candidate, name) > 0);
  return index < 0 ? [...paths, path] : [...paths.slice(0, index), path, ...paths.slice(index)];
};

// 보이는 줄 목록. 숨김 폴더는 패널 설정을 따르되 패널 경로까지의 폴더는 항상 표시,
// 읽기 전이거나 목록에 없는 경로상의 폴더(열린 압축 파일 포함)는 그 자리에 끼워 표시.
// 맨 위 항목인 폴더(macOS `/Volumes/…` 볼륨)는 상위 폴더 아래에 다시 넣지 않고, 같은 경로는 한 번만 표시
// (화면 줄의 키가 경로라 중복되면 갱신 때 지난 줄이 남아 이름이 겹쳐 보임)
export const flattenFolderTree = (
  space: FolderTreeSpace,
  options: { showHidden: boolean; chain: readonly string[] },
): FolderTreeRow[] => {
  const onChain = new Set(options.chain);
  const nextOnChain = new Map(options.chain.slice(0, -1).map((path, index) => [path, options.chain[index + 1]]));
  const roots = new Set(space.roots);
  const shown = new Set<string>();
  const rows: FolderTreeRow[] = [];

  const visibleChildren = (path: string, node: FolderTreeNode) => {
    let children = (node.children ?? []).filter((child) => {
      const childNode = space.nodes[child];
      return Boolean(childNode) && !roots.has(child)
        && (options.showHidden || !childNode.entry.isHidden || onChain.has(child));
    });
    const forced = nextOnChain.get(path);
    if (forced && space.nodes[forced] && !children.includes(forced)) {
      children = insertByName(children, forced, space.nodes);
    }
    return children;
  };

  const visit = (path: string, depth: number, parentPath: string | null) => {
    const node = space.nodes[path];
    if (!node || depth > MAX_TREE_DEPTH || shown.has(path)) return;
    shown.add(path);
    const isLink = node.entry.kind === 'symlink';
    const children = isLink ? [] : visibleChildren(path, node);
    const expanded = !isLink && space.expanded.has(path);
    rows.push({
      path,
      entry: node.entry,
      depth,
      parentPath,
      expandable: !isLink && (node.children === null || children.length > 0 || (options.showHidden && node.partial)),
      expanded,
      loading: node.loading,
      error: node.error,
      isLink,
    });
    if (!expanded) return;
    for (const child of children) visit(child, depth + 1, path);
  };

  for (const root of space.roots) visit(root, 0, null);
  return rows;
};

// 펼쳐져 보이는데 하위 폴더를 아직 읽지 않은 폴더(숨김 파일을 켰는데 숨김 폴더가 빠진 폴더 포함)
export const folderTreePathsToLoad = (space: FolderTreeSpace, rows: readonly FolderTreeRow[], showHidden: boolean) =>
  rows.filter((row) => {
    const node = space.nodes[row.path];
    return row.expanded && node && !node.loading && !node.error && (node.children === null || (showHidden && node.partial));
  }).map((row) => row.path);

export const folderTreeRowDomId = (panelId: PanelId, index: number) => `folder-tree-${panelId}-row-${index}`;

// 트리 폴더를 대상으로 하는 작업의 출발 목록(그 폴더가 든 상위 폴더). 맨 위 항목(드라이브·볼륨·서버 루트)과
// 열린 압축 파일 자체는 이동만 허용하고 복사·이동·삭제·이름 바꾸기 대상에서 제외
export const folderTreeActionTarget = (panelId: PanelId, row: FolderTreeRow) => {
  const archive = parseArchiveVirtualPath(row.path);
  if (row.depth === 0 || row.parentPath === null || (archive && !archive.innerPath)) return null;
  return { entry: row.entry, sourceListing: createDirectoryListing(panelId, row.parentPath, [row.entry]) };
};

// 폴더를 자기 자신이나 하위 폴더로 옮기거나 복사하는 놓기 차단용
export const pathIsSameOrInside = (path: string, folder: string) => {
  if (path === folder) return true;
  const prefix = /[\\/]$/.test(folder) ? folder : `${folder}${folder.includes('\\') && !folder.includes('/') ? '\\' : '/'}`;
  return path.startsWith(prefix);
};

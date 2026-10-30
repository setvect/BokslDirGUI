import type { FileEntry, PanelId } from '../domain/types';
import { NativeFileDragMode } from '../tauri/commanderClients';
import { basenameFromPath } from './fileActionPlans';

type ExternalDropFile = File & { path?: unknown };

export interface FileDragSource {
  panelId: PanelId;
  entries: FileEntry[];
  mode: NativeFileDragMode;
  sourcePath: string;
}

// 앱 안 드래그의 놓을 곳: 대상 폴더와, 같은 패널 하위 폴더 행이면 그 경로
export interface FileDragTarget {
  panelId: PanelId;
  targetDir: string;
  folderPath: string | null;
}

export const fileEntryFromExternalDropFile = (file: File): FileEntry | null => {
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

export const fileEntryFromExternalDropPath = (path: string): FileEntry => {
  const name = basenameFromPath(path);
  return {
    path,
    name,
    kind: 'file',
    sizeBytes: null,
    modifiedAt: null,
    createdAt: null,
    permissions: null,
    owner: null,
    group: null,
    isHidden: name.startsWith('.'),
    isVirtual: false,
  };
};

export const uniqueAbsolutePaths = (paths: string[]) => [...new Set(
  paths
    .filter((path) => pathLooksAbsolute(path)),
)];

export const samePathSet = (left: readonly string[], right: readonly string[]) => {
  if (left.length !== right.length) {
    return false;
  }
  const rightPaths = new Set(right);
  return left.every((path) => rightPaths.has(path));
};

export interface PanelDropPoint {
  panelId: PanelId;
  // 포인터 아래 행의 목록 위치, 행 밖이면 null
  rowIndex: number | null;
}

export const panelDropPointAtClientPosition = (position: { x: number; y: number }): PanelDropPoint | null => {
  const element = document.elementFromPoint(position.x, position.y);
  const panelElement = element?.closest<HTMLElement>('.file-panel[data-panel-id]');
  if (!panelElement || panelElement.getAttribute('aria-hidden') === 'true') {
    return null;
  }
  const panelId = panelElement.dataset.panelId;
  if (panelId !== 'left' && panelId !== 'right') return null;
  const rowIndex = Number(element?.closest<HTMLElement>('.file-row[data-entry-index]')?.dataset.entryIndex);
  return { panelId, rowIndex: Number.isInteger(rowIndex) ? rowIndex : null };
};

export const panelIdAtClientPosition = (position: { x: number; y: number }): PanelId | null =>
  panelDropPointAtClientPosition(position)?.panelId ?? null;

const externalDropPath = (file: File): string | null => {
  const candidate = (file as ExternalDropFile).path;
  if (typeof candidate !== 'string') {
    return null;
  }
  return pathLooksAbsolute(candidate) ? candidate : null;
};

const pathLooksAbsolute = (path: string) =>
  path.startsWith('/')
  || path.startsWith('\\\\')
  || /^[A-Za-z]:[\\/]/.test(path);

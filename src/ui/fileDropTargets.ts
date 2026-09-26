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

export const panelIdAtClientPosition = (position: { x: number; y: number }): PanelId | null => {
  const panelElement = document.elementFromPoint(position.x, position.y)
    ?.closest<HTMLElement>('.file-panel[data-panel-id]');
  if (!panelElement || panelElement.getAttribute('aria-hidden') === 'true') {
    return null;
  }
  const panelId = panelElement.dataset.panelId;
  return panelId === 'left' || panelId === 'right' ? panelId : null;
};

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

import type { EntryKind, FileEntry } from '../domain/types';

export const entryIcon = (kind: EntryKind) => {
  switch (kind) {
    case 'directory':
      return '▰';
    case 'archive':
      return '▣';
    case 'executable':
      return '◆';
    case 'symlink':
      return '↪';
    case 'file':
      return '▱';
    default:
      return '·';
  }
};

export const formatSize = (entry: FileEntry, mode: 'binary' | 'decimal' = 'binary') => {
  if (entry.kind === 'directory') {
    return '-';
  }
  if (entry.sizeBytes === null) {
    return '';
  }
  if (mode === 'decimal') {
    return `${entry.sizeBytes} B`;
  }
  if (entry.sizeBytes < 1024) {
    return `${entry.sizeBytes} B`;
  }
  if (entry.sizeBytes < 1024 * 1024) {
    return `${(entry.sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
};

export type DateDisplayFormat = 'short' | 'long';

export const formatDate = (iso: string | null, display: DateDisplayFormat = 'short') => {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return display === 'long'
    ? `${year}-${month}-${day} ${hour}:${minute}`
    : `${month}-${day} ${hour}:${minute}`;
};

export const formatDateTime = (iso: string | null) => {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  const second = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
};

export const formatModified = (iso: string | null) => formatDate(iso, 'short');

export const formatOwnerGroup = (entry: FileEntry) => {
  if (entry.owner && entry.group && entry.owner !== entry.group) {
    return `${entry.owner}/${entry.group}`;
  }
  return entry.owner ?? entry.group ?? '-';
};

export const summarizeEntries = (entries: FileEntry[]) => {
  const dirs = entries.filter((entry) => entry.kind === 'directory').length;
  const files = entries.length - dirs;
  return { dirs, files };
};

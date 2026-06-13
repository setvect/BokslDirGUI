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

export const formatSize = (entry: FileEntry) => {
  if (entry.kind === 'directory') {
    return '-';
  }
  if (entry.sizeBytes === null) {
    return '';
  }
  if (entry.sizeBytes < 1024) {
    return `${entry.sizeBytes} B`;
  }
  if (entry.sizeBytes < 1024 * 1024) {
    return `${(entry.sizeBytes / 1024).toFixed(1)} KB`;
  }
  return `${(entry.sizeBytes / 1024 / 1024).toFixed(1)} MB`;
};

export const formatModified = (iso: string | null) => {
  if (!iso) {
    return '';
  }
  const date = new Date(iso);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${month}-${day} ${hour}:${minute}`;
};

export const summarizeEntries = (entries: FileEntry[]) => {
  const dirs = entries.filter((entry) => entry.kind === 'directory').length;
  const files = entries.length - dirs;
  return { dirs, files };
};

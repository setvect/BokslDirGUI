import { displayPath } from '../domain/pathDisplay';
import type { FileEntry, PanelId, Settings, SortSpec } from '../domain/types';
import {
  FILE_ENTRY_TEXT,
  METADATA_KIND_LABELS,
  PANEL_ID_LABELS
} from '../i18n-resources';
import { formatDate, formatOwnerGroup, formatSize } from './format';
import { textDisplayWidth } from './textLayout';

// Display-only classification: never infer filesystem kind or launch behavior from a suffix.
const FILE_COLOR_EXTENSIONS = {
  script: new Set(['bat', 'cmd', 'ps1', 'psm1', 'sh', 'bash', 'zsh', 'fish']),
  executable: new Set(['exe', 'com', 'msi', 'msix', 'appx', 'appimage']),
  document: new Set(['txt', 'md', 'markdown', 'rst', 'rtf', 'doc', 'docx', 'odt', 'pdf', 'hwp', 'hwpx', 'xls', 'xlsx', 'ods', 'csv', 'tsv', 'ppt', 'pptx', 'odp', 'epub']),
  image: new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg', 'ico', 'icns', 'tif', 'tiff', 'heic', 'heif', 'avif', 'psd']),
  archive: new Set(['zip', '7z', 'rar', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'tbz2', 'txz', 'zst', 'lz', 'lzma', 'cab', 'iso', 'dmg']),
  media: new Set(['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'opus', 'mp4', 'mkv', 'avi', 'mov', 'webm', 'wmv', 'm4v']),
  source: new Set(['c', 'h', 'cpp', 'hpp', 'cs', 'rs', 'go', 'java', 'kt', 'swift', 'py', 'rb', 'php', 'js', 'jsx', 'ts', 'tsx', 'html', 'htm', 'css', 'scss', 'sql']),
};

export type FileColorGroup = keyof typeof FILE_COLOR_EXTENSIONS | 'directory' | 'symlink' | 'file';

export const fileColorGroup = (entry: Pick<FileEntry, 'name' | 'kind'>): FileColorGroup => {
  // A link named photo.jpg stays a link, and a directory named backup.zip stays a directory.
  if (entry.kind === 'symlink' || entry.kind === 'directory') return entry.kind;
  if (entry.kind === 'archive') return 'archive';
  const dot = entry.name.lastIndexOf('.');
  const extension = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : '';
  // Batch/shell scripts keep their DOS yellow even when the OS reports them executable.
  if (FILE_COLOR_EXTENSIONS.script.has(extension)) return 'script';
  if (entry.kind === 'executable') return 'executable';
  for (const group of Object.keys(FILE_COLOR_EXTENSIONS) as (keyof typeof FILE_COLOR_EXTENSIONS)[]) {
    if (FILE_COLOR_EXTENSIONS[group].has(extension)) return group;
  }
  return 'file';
};

export interface PanelColumnLayout {
  showModified: boolean;
  showSize: boolean;
  showPermissions: boolean;
  showCreated: boolean;
  showOwner: boolean;
  dateFormat: 'short' | 'long';
  cssClass: string;
  gridTemplateColumns: string;
}

const BASE_COLUMN_CHAR_WIDTH_PX = 8;
const MIN_NAME_CONTENT_CHARS = 30;
const NAME_MIN_WIDTH_RATIO = 0.48;
const CELL_HORIZONTAL_PADDING_CHARS = 3;
const COLUMN_MIN_CHARS = {
  name: MIN_NAME_CONTENT_CHARS,
  modifiedShort: 12,
  modifiedLong: 17,
  size: 10,
  permissions: 11,
  created: 17,
  owner: 14,
};

interface PanelMetadataColumnWidths {
  modifiedShort: number;
  modifiedLong: number;
  size: number;
  permissions: number;
  created: number;
  owner: number;
}

export const metadataColumnWidthsForEntries = (entries: readonly FileEntry[], sizeFormat: Settings['sizeFormat'] = 'binary'): PanelMetadataColumnWidths => {
  const maxWidth = (values: string[], base: number) => {
    let width = base;
    for (const value of new Set(values)) width = Math.max(width, textDisplayWidth(value));
    return width;
  };

  return {
    modifiedShort: maxWidth(
      entries.map((entry) => formatDate(entry.modifiedAt, 'short') || '-'),
      COLUMN_MIN_CHARS.modifiedShort,
    ),
    modifiedLong: maxWidth(
      entries.map((entry) => formatDate(entry.modifiedAt, 'long') || '-'),
      COLUMN_MIN_CHARS.modifiedLong,
    ),
    size: maxWidth(entries.map((entry) => formatSize(entry, sizeFormat) || '-'), COLUMN_MIN_CHARS.size),
    permissions: maxWidth(entries.map((entry) => entry.permissions ?? '-'), COLUMN_MIN_CHARS.permissions),
    created: maxWidth(
      entries.map((entry) => formatDate(entry.createdAt, 'long') || '-'),
      COLUMN_MIN_CHARS.created,
    ),
    owner: maxWidth(entries.map((entry) => formatOwnerGroup(entry)), COLUMN_MIN_CHARS.owner),
  };
};

export const columnLayoutForPanelWidth = (
  widthPx: number,
  scale = 1,
  entriesOrWidths: readonly FileEntry[] | PanelMetadataColumnWidths = [],
): PanelColumnLayout => {
  const width = Math.floor(widthPx / (BASE_COLUMN_CHAR_WIDTH_PX * scale));
  const columnWidths = (Array.isArray(entriesOrWidths)
    ? metadataColumnWidthsForEntries(entriesOrWidths)
    : entriesOrWidths) as PanelMetadataColumnWidths;
  const fits = (...metadataWidths: number[]) =>
    width >= nameBudgetForWidth(width) + metadataBudget(metadataWidths);

  if (fits(columnWidths.size, columnWidths.modifiedLong, columnWidths.created, columnWidths.permissions, columnWidths.owner)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: true,
      showCreated: true,
      showOwner: true,
      dateFormat: 'long',
      cssClass: 'columns-owner',
      gridTemplateColumns: gridTemplateColumnsFor([
        columnWidths.size,
        columnWidths.modifiedLong,
        columnWidths.created,
        columnWidths.permissions,
        columnWidths.owner,
      ]),
    };
  }
  if (fits(columnWidths.size, columnWidths.modifiedLong, columnWidths.created, columnWidths.permissions)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: true,
      showCreated: true,
      showOwner: false,
      dateFormat: 'long',
      cssClass: 'columns-created',
      gridTemplateColumns: gridTemplateColumnsFor([
        columnWidths.size,
        columnWidths.modifiedLong,
        columnWidths.created,
        columnWidths.permissions,
      ]),
    };
  }
  if (fits(columnWidths.size, columnWidths.modifiedLong, columnWidths.permissions)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: true,
      showCreated: false,
      showOwner: false,
      dateFormat: 'long',
      cssClass: 'columns-permissions',
      gridTemplateColumns: gridTemplateColumnsFor([
        columnWidths.size,
        columnWidths.modifiedLong,
        columnWidths.permissions,
      ]),
    };
  }
  if (fits(columnWidths.size, columnWidths.modifiedShort)) {
    return {
      showModified: true,
      showSize: true,
      showPermissions: false,
      showCreated: false,
      showOwner: false,
      dateFormat: 'short',
      cssClass: 'columns-basic',
      gridTemplateColumns: gridTemplateColumnsFor([columnWidths.size, columnWidths.modifiedShort]),
    };
  }
  if (fits(columnWidths.modifiedShort)) {
    return {
      showModified: true,
      showSize: false,
      showPermissions: false,
      showCreated: false,
      showOwner: false,
      dateFormat: 'short',
      cssClass: 'columns-name-date',
      gridTemplateColumns: gridTemplateColumnsFor([columnWidths.modifiedShort]),
    };
  }
  return {
    showModified: false,
    showSize: false,
    showPermissions: false,
    showCreated: false,
    showOwner: false,
    dateFormat: 'short',
    cssClass: 'columns-name-only',
    gridTemplateColumns: gridTemplateColumnsFor([]),
  };
};

const nameBudgetForWidth = (widthChars: number) =>
  Math.max(COLUMN_MIN_CHARS.name, Math.ceil(widthChars * NAME_MIN_WIDTH_RATIO)) + CELL_HORIZONTAL_PADDING_CHARS;

const metadataBudget = (metadataWidths: number[]) =>
  metadataWidths.reduce((total, columnWidth) => total + columnWidth + CELL_HORIZONTAL_PADDING_CHARS, 0);

const gridTemplateColumnsFor = (metadataWidths: number[]) =>
  [
    'minmax(0, 1fr)',
    ...metadataWidths.map((columnWidth) => `calc(${columnWidth}ch + var(--cell-padding-x) * 2)`),
  ].join(' ');

export const panelIdLabel = (panelId: PanelId, language: Settings['language']) => {
  return PANEL_ID_LABELS[language][panelId];
};

export const sortMarker = (direction: SortSpec['direction']) => (direction === 'asc' ? '▲' : '▼');

export const rowDomId = (panelId: PanelId, index: number) => `commander-row-${panelId}-${index}`;

export const fileEntryAccessibleLabel = (entry: FileEntry, language: Settings['language']) => {
  const text = FILE_ENTRY_TEXT[language];
  if (entry.isVirtual) {
    return `${entry.name}, ${text.parentDirectory}`;
  }
  return `${entry.name}, ${METADATA_KIND_LABELS[language][entry.kind] ?? entry.kind}, ${formatSize(entry) || text.noSize}`;
};

export const fileEntryTooltip = (entry: FileEntry, language: Settings['language']) => {
  const text = FILE_ENTRY_TEXT[language];
  if (entry.isVirtual) {
    return `${entry.name}\n${text.moveToParentDirectory}\n${text.path}: ${displayPath(entry.path)}`;
  }
  return [
    `${text.name}: ${entry.name}`,
    `${text.path}: ${displayPath(entry.path)}`,
    `${text.kind}: ${METADATA_KIND_LABELS[language][entry.kind] ?? entry.kind}`,
    `${text.size}: ${formatSize(entry) || '-'}`,
    `${text.modified}: ${formatDate(entry.modifiedAt, 'long') || '-'}`,
    `${text.created}: ${formatDate(entry.createdAt, 'long') || '-'}`,
    `${text.permissions}: ${entry.permissions ?? '-'}`,
    `${text.owner}: ${formatOwnerGroup(entry)}`,
  ].join('\n');
};


export const pageMovementForViewport = ({
  direction, focusedIndex, rowCount, rowHeight, viewportHeight, scrollTop,
}: {
  direction: -1 | 1;
  focusedIndex: number;
  rowCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
}): { focusedIndex: number; scrollTop: number } | null => {
  if (rowCount === 0 || rowHeight <= 0 || viewportHeight <= 0) return null;

  const step = Math.max(1, Math.floor(viewportHeight / rowHeight) - 1);
  const nextIndex = Math.max(0, Math.min(rowCount - 1, focusedIndex + direction * step));
  // Keep the cursor at its viewport position; recover off-screen focus at the nearest edge.
  const cursorOffset = Math.max(0, Math.min(viewportHeight - rowHeight, focusedIndex * rowHeight - scrollTop));
  const maxScrollTop = Math.max(0, rowCount * rowHeight - viewportHeight);
  return {
    focusedIndex: nextIndex,
    scrollTop: Math.max(0, Math.min(maxScrollTop, nextIndex * rowHeight - cursorOffset)),
  };
};

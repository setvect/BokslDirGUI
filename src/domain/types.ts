export type PanelId = 'left' | 'right';
export type EntryKind = 'file' | 'directory' | 'symlink' | 'executable' | 'archive' | 'unknown';
export type OperationKind =
  | 'copy'
  | 'move'
  | 'delete'
  | 'trash'
  | 'restoreTrash'
  | 'rename'
  | 'createDir'
  | 'archiveCreate'
  | 'archiveExtract'
  | 'archiveAdd';
export type OperationState =
  | 'idle'
  | 'validating'
  | 'scanning'
  | 'queued'
  | 'waitingForConflict'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'completedWithErrors'
  | 'failed'
  | 'cancelled';
export type ConflictDecision = 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel';

export interface FileEntry {
  path: string;
  name: string;
  kind: EntryKind;
  symlinkTargetIsDirectory?: boolean | null;
  sizeBytes: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
  permissions: string | null;
  owner: string | null;
  group: string | null;
  isHidden: boolean;
  isVirtual: boolean;
}

export interface AppError {
  code: string;
  messageKey: string;
  path: string | null;
  details: Record<string, unknown> | null;
  recoverable: boolean;
}

export interface SortSpec {
  field: 'name' | 'size' | 'modifiedAt' | 'extension';
  direction: 'asc' | 'desc';
  directoriesFirst: boolean;
}

export interface DirectoryListing {
  panelId: PanelId;
  path: string;
  entries: FileEntry[];
  sort: SortSpec;
  filter: string | null;
  version: number;
  totalEntries?: number;
  truncated?: boolean;
  archiveEncrypted?: boolean;
}

export interface DirectoryStats {
  totalFileBytes: number;
  fileCount: number;
  directoryCount: number;
}

export interface FileMetadata extends FileEntry {
  absolutePath: string;
  extension: string | null;
  mimeType: string | null;
  readonly: boolean;
  directoryStats: DirectoryStats | null;
  imageMetadata?: ImageMetadata | null;
}

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  exifStatus: 'present' | 'absent' | 'unreadable' | 'limited';
  fields: Array<{ key: string; value: string }>;
  truncated: boolean;
}

export interface FilePreview {
  path: string;
  name: string;
  kind: 'text' | 'image' | 'unsupported' | 'tooLarge';
  mimeType: string | null;
  sizeBytes: number;
  text: string | null;
  dataUrl: string | null;
  truncated: boolean;
  limitBytes: number;
}

export interface WatchAck {
  panelId: PanelId;
  path: string;
  version: number;
}

export interface LocationList {
  home: string;
  roots: string[];
  recent: string[];
  bookmarks: Array<{ id: string; label: string; path: string }>;
}

export interface OperationStarted {
  operationId: string;
  kind: OperationKind;
  state: OperationState;
}

export interface ConflictPrompt {
  operationId: string;
  source: FileEntry;
  destination: FileEntry;
  defaultDecision: ConflictDecision;
  availableDecisions: ConflictDecision[];
}

export interface ConflictAck {
  operationId: string;
  decision: ConflictDecision;
}

export interface CancelAck {
  operationId: string;
  state: Extract<OperationState, 'cancelling' | 'cancelled'>;
}

export interface OperationProgress {
  operationId: string;
  kind: OperationKind;
  state: OperationState;
  totalFiles: number | null;
  completedFiles: number;
  totalBytes: number | null;
  completedBytes: number;
  currentPath: string | null;
  bytesPerSecond: number | null;
  etaSeconds: number | null;
  recentErrorCount: number;
}

export interface OperationSummary {
  operationId: string;
  kind: OperationKind;
  state: Extract<OperationState, 'completed' | 'completedWithErrors' | 'failed' | 'cancelled'>;
  completedFiles: number;
  failedFiles: number;
  skippedFiles?: number;
  errors: AppError[];
}

export interface ArchiveListing {
  archivePath: string;
  entries: FileEntry[];
  encrypted: boolean;
  totalEntries: number;
  truncated: boolean;
}

export interface OpenWithApp {
  path: string;
  name: string;
  isDefault: boolean;
}

export interface ActionResult {
  ok: boolean;
  messageKey: string | null;
}

export interface ShellCommandPreview {
  confirmToken: string;
  expiresAt: string;
  fingerprint: string;
  requiresConfirmation: true;
  policy: {
    enabled: boolean;
    reasonKey: string | null;
  };
}

export interface ShellCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface SavedTab {
  path: string;
  sort: SortSpec;
  filter: string | null;
  showHidden: boolean;
  historyBack: string[];
  historyForward: string[];
}

export interface SavedPanelTabs {
  items: SavedTab[];
  activeIndex: number;
}

export interface Settings {
  window?: { width: number; height: number; maximized: boolean };
  schemaVersion: number;
  theme: 'dark' | 'light' | 'highContrast';
  language: 'ko' | 'en';
  sizeFormat: 'binary' | 'decimal';
  external: {
    /** Legacy setting retained for existing settings files; no editor action uses it. */
    editorId: string | null;
    shellCommand: {
      enabled: boolean;
    };
  };
  bookmarks: Array<{ id: string; label: string; path: string }>;
  layout: {
    singlePanel: boolean;
    ratio: '50:50' | '70:30' | '30:70';
  };
  session: {
    leftPath: string | null;
    rightPath: string | null;
    activePanel: PanelId;
    tabs?: Record<PanelId, SavedPanelTabs>;
  };
  view: {
    zoomStep: number;
    density: 'compact' | 'comfortable';
    showIcons: boolean;
  };
}

export interface NativeFileClipboard {
  changeCount: number;
  paths: string[];
  entries: FileEntry[];
}

export interface RenameRules {
  find: string; replacement: string; prefix: string;
  numbering: boolean; start: number; padding: number; preserveExtension: boolean;
}
export interface RenameItem { source: string; newName: string; stamp: string; }
export interface RenamePreview { item: RenameItem; changed: boolean; error: AppError | null; }

export interface TrashUndoPreview {
  id: string;
  entries: FileEntry[];
}

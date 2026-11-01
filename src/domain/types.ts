export type PanelId = 'left' | 'right';
export interface PlatformInfo {
  os: string;
  features: {
    openWith: boolean;
    currentFolderManager: boolean;
    currentFolderTerminal: boolean;
    nativeFileClipboard: boolean;
    trashUndo: boolean;
  };
}

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
  | 'archiveAdd'
  | 'shellCommand'
  | 'chmod';
// 원격 권한 변경의 재귀 적용 범위
export type ChmodScope = 'all' | 'files' | 'directories';
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

// 폴더 트리의 한 단계 하위 폴더(FR-42.3). 숨김 폴더 포함, 폴더를 가리키는 링크는 `kind: 'symlink'`
export interface SubdirectoryListing {
  path: string;
  entries: FileEntry[];
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

// `dir_changed` 이벤트, version은 같은 패널의 WatchAck.version과 일치할 때만 유효
export interface DirectoryChanged {
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
  commandResult?: ShellCommandResult;
}

export interface ArchiveListing {
  archivePath: string;
  entries: FileEntry[];
  encrypted: boolean;
  totalEntries: number;
  truncated: boolean;
}

export interface OpenWithApp {
  id: string;
  path: string | null;
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
  workingDir: string;
  truncated: boolean;
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
  theme: 'dark' | 'light' | 'highContrast' | 'mdir';
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
    // 기본값이면 저장 파일에서 생략, 읽을 때 `folderTreeSettingsOf`로 기본값 적용
    folderTree?: Record<PanelId, FolderTreePanelSettings>;
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
  // 기본값이면 저장 파일에서 생략, 읽을 때 `remoteSettingsOf`로 기본값 적용
  remote?: RemoteSettings;
}

// 패널별 폴더 트리 표시 여부와 폭(100% 배율 기준 px, FR-42.1)
export interface FolderTreePanelSettings {
  visible: boolean;
  width: number;
}

export type RemoteAuthMethod = 'password' | 'publicKey' | 'agent' | 'keyboardInteractive';

// 저장된 SFTP 사이트. 암호·키 암호는 OS 자격 증명 저장소에만 있고 `savedSecret`은 저장 여부만 표시
export interface RemoteSite {
  id: string;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: RemoteAuthMethod;
  keyPath?: string;
  startPath?: string;
  savedSecret: boolean;
}

// 원격 전송의 심볼릭 링크 처리(FR-37.5)
export type RemoteLinkPolicy = 'preserve' | 'follow' | 'skip';

export interface RemoteSettings {
  sites: RemoteSite[];
  keepaliveSeconds: number;
  connectTimeoutSeconds: number;
  linkPolicy: RemoteLinkPolicy;
}

// Rust `RemoteSettings::default`와 같은 값
export const DEFAULT_REMOTE_SETTINGS: RemoteSettings = { sites: [], keepaliveSeconds: 30, connectTimeoutSeconds: 15, linkPolicy: 'preserve' };

// 저장 파일에 없는 항목은 기본값으로 채움(이전 버전 설정 호환)
export const remoteSettingsOf = (settings: Pick<Settings, 'remote'>): RemoteSettings => ({ ...DEFAULT_REMOTE_SETTINGS, ...settings.remote });

// `remote_connect` 요청. 암호·키 암호는 이 요청에만 담고 저장·로그·이벤트에 남기지 않음
export interface RemoteConnectRequest {
  host: string;
  port: number;
  user: string;
  authMethod: RemoteAuthMethod;
  password?: string;
  keyPath?: string;
  passphrase?: string;
  // 저장된 사이트에서 연결: 비밀값을 비우면 자격 증명 저장소의 값 사용
  siteId?: string;
  // 연결에 성공하면 입력한 비밀값을 자격 증명 저장소에 저장
  saveSecret?: boolean;
}

// sessionId는 원격 루트 URL(`sftp://사용자@호스트:포트/`), `remoteLocationKey`와 같은 값
export interface RemoteSession {
  sessionId: string;
  user: string;
  host: string;
  port: number;
  home: string;
  homeUrl: string;
  hostKeyAlgorithm: string;
  hostKeyFingerprint: string;
  // 이번 연결 요청에서 비밀값을 저장했는지 여부
  secretStored: boolean;
}

// `~/.ssh/config` 가져오기 결과(FR-34.9)
export interface SshConfigEntry {
  alias: string;
  host: string;
  port: number;
  user: string;
  keyPath?: string;
}

export interface SshConfigImport {
  entries: SshConfigEntry[];
  warnings: string[];
}

export type RemoteConnectionState = 'connected' | 'disconnected' | 'lost';

// `remote_connection_changed` 이벤트
export interface RemoteConnectionChanged {
  sessionId: string;
  state: RemoteConnectionState;
  error: AppError | null;
}

export interface NativeFileClipboard {
  intent: 'copy' | 'move';
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

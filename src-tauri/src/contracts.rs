use crate::path_text::display_path;
use serde::Deserialize;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "camelCase")]
pub(crate) enum PanelId {
    Left,
    Right,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum EntryKind {
    File,
    Directory,
    Symlink,
    Executable,
    Archive,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SortField {
    Name,
    Size,
    ModifiedAt,
    Extension,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SortSpec {
    pub(crate) field: SortField,
    pub(crate) direction: SortDirection,
    pub(crate) directories_first: bool,
}

impl Default for SortSpec {
    fn default() -> Self {
        Self {
            field: SortField::Name,
            direction: SortDirection::Asc,
            directories_first: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileEntry {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: EntryKind,
    pub(crate) symlink_target_is_directory: Option<bool>,
    pub(crate) size_bytes: Option<u64>,
    pub(crate) modified_at: Option<String>,
    pub(crate) created_at: Option<String>,
    pub(crate) permissions: Option<String>,
    pub(crate) owner: Option<String>,
    pub(crate) group: Option<String>,
    pub(crate) is_hidden: bool,
    pub(crate) is_virtual: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryListing {
    pub(crate) panel_id: PanelId,
    pub(crate) path: String,
    pub(crate) entries: Vec<FileEntry>,
    pub(crate) sort: SortSpec,
    pub(crate) filter: Option<String>,
    pub(crate) version: u64,
    /// 항목 상한으로 잘린 목록의 전체 항목 수(원격 목록). 잘리지 않으면 생략.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) total_entries: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) truncated: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryStats {
    pub(crate) total_file_bytes: u64,
    pub(crate) file_count: u64,
    pub(crate) directory_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileMetadata {
    #[serde(flatten)]
    pub(crate) entry: FileEntry,
    pub(crate) absolute_path: String,
    pub(crate) extension: Option<String>,
    pub(crate) mime_type: Option<String>,
    pub(crate) readonly: bool,
    pub(crate) directory_stats: Option<DirectoryStats>,
    pub(crate) image_metadata: Option<ImageMetadata>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ImageMetadata {
    pub(crate) width: Option<usize>,
    pub(crate) height: Option<usize>,
    pub(crate) exif_status: String,
    pub(crate) fields: Vec<ImageMetadataField>,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct ImageMetadataField {
    pub(crate) key: String,
    pub(crate) value: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchAck {
    pub(crate) panel_id: PanelId,
    pub(crate) path: String,
    pub(crate) version: u64,
}

/// `dir_changed` 이벤트: 감시 중인 패널 디렉터리의 직접 자식이 바뀜. version은 `WatchAck.version`과 같은 감시 등록 번호.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DirectoryChanged {
    pub(crate) panel_id: PanelId,
    pub(crate) path: String,
    pub(crate) version: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct BookmarkLocation {
    pub(crate) id: String,
    pub(crate) label: String,
    pub(crate) path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LocationList {
    pub(crate) home: String,
    pub(crate) roots: Vec<String>,
    pub(crate) recent: Vec<String>,
    pub(crate) bookmarks: Vec<BookmarkLocation>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ArchiveListing {
    pub(crate) archive_path: String,
    pub(crate) entries: Vec<FileEntry>,
    pub(crate) encrypted: bool,
    pub(crate) total_entries: u64,
    pub(crate) truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OpenWithApp {
    pub(crate) id: String,
    pub(crate) path: Option<String>,
    pub(crate) name: String,
    pub(crate) is_default: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ActionResult {
    pub(crate) ok: bool,
    pub(crate) message_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FilePreview {
    pub(crate) path: String,
    pub(crate) name: String,
    pub(crate) kind: String,
    pub(crate) mime_type: Option<String>,
    pub(crate) size_bytes: u64,
    pub(crate) text: Option<String>,
    pub(crate) data_url: Option<String>,
    pub(crate) truncated: bool,
    pub(crate) limit_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellCommandPolicy {
    pub(crate) enabled: bool,
    pub(crate) reason_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellCommandPreview {
    pub(crate) confirm_token: String,
    pub(crate) expires_at: String,
    pub(crate) fingerprint: String,
    pub(crate) requires_confirmation: bool,
    pub(crate) policy: ShellCommandPolicy,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellCommandResult {
    pub(crate) working_dir: String,
    pub(crate) truncated: bool,
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) timed_out: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalSettings {
    // 기존 설정 파일 호환용 필드. 편집기 실행에는 사용하지 않음.
    pub(crate) editor_id: Option<String>,
    pub(crate) shell_command: ShellCommandEnabled,
}

impl Default for ExternalSettings {
    fn default() -> Self {
        Self {
            editor_id: None,
            shell_command: ShellCommandEnabled { enabled: false },
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ShellCommandEnabled {
    pub(crate) enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LayoutSettings {
    pub(crate) single_panel: bool,
    pub(crate) ratio: String,
}

impl Default for LayoutSettings {
    fn default() -> Self {
        Self {
            single_panel: false,
            ratio: "50:50".to_string(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionSettings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) tabs: Option<SessionTabs>,
    pub(crate) left_path: Option<String>,
    pub(crate) right_path: Option<String>,
    pub(crate) active_panel: PanelId,
}

impl Default for SessionSettings {
    fn default() -> Self {
        Self {
            tabs: None,
            left_path: None,
            right_path: None,
            active_panel: PanelId::Right,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SessionTabs {
    pub(crate) left: SavedPanelTabs,
    pub(crate) right: SavedPanelTabs,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedPanelTabs {
    pub(crate) items: Vec<SavedTab>,
    pub(crate) active_index: usize,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SavedTab {
    pub(crate) path: String,
    pub(crate) sort: SortSpec,
    pub(crate) filter: Option<String>,
    pub(crate) show_hidden: bool,
    pub(crate) history_back: Vec<String>,
    pub(crate) history_forward: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ViewSettings {
    #[serde(default)]
    pub(crate) zoom_step: i32,
    #[serde(default = "default_view_density")]
    pub(crate) density: String,
    #[serde(default = "default_show_icons")]
    pub(crate) show_icons: bool,
}

pub(crate) fn default_view_density() -> String {
    "compact".to_string()
}

pub(crate) fn default_show_icons() -> bool {
    true
}

impl Default for ViewSettings {
    fn default() -> Self {
        Self {
            zoom_step: 0,
            density: "compact".to_string(),
            show_icons: true,
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Settings {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) window: Option<WindowSettings>,
    pub(crate) schema_version: u32,
    pub(crate) theme: String,
    pub(crate) language: String,
    pub(crate) size_format: String,
    pub(crate) external: ExternalSettings,
    pub(crate) bookmarks: Vec<BookmarkLocation>,
    pub(crate) layout: LayoutSettings,
    #[serde(default)]
    pub(crate) session: SessionSettings,
    #[serde(default)]
    pub(crate) view: ViewSettings,
    #[serde(default, skip_serializing_if = "RemoteSettings::is_default")]
    pub(crate) remote: RemoteSettings,
}

/// 원격 연결 설정. 비밀 정보(암호·키 암호)는 OS 자격 증명 저장소에만 저장.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSettings {
    #[serde(default)]
    pub(crate) sites: Vec<RemoteSite>,
    #[serde(default = "default_keepalive_seconds")]
    pub(crate) keepalive_seconds: u32,
    #[serde(default = "default_connect_timeout_seconds")]
    pub(crate) connect_timeout_seconds: u32,
}

fn default_keepalive_seconds() -> u32 {
    30
}

fn default_connect_timeout_seconds() -> u32 {
    15
}

impl Default for RemoteSettings {
    fn default() -> Self {
        Self {
            sites: Vec::new(),
            keepalive_seconds: default_keepalive_seconds(),
            connect_timeout_seconds: default_connect_timeout_seconds(),
        }
    }
}

impl RemoteSettings {
    pub(crate) fn is_default(&self) -> bool {
        *self == Self::default()
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RemoteAuthMethod {
    Password,
    PublicKey,
    Agent,
    KeyboardInteractive,
}

/// 저장된 SFTP 사이트. `saved_secret`은 OS 자격 증명 저장소에 암호·키 암호를 저장했는지 여부만 표시.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSite {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) user: String,
    pub(crate) auth_method: RemoteAuthMethod,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) key_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(crate) start_path: Option<String>,
    #[serde(default)]
    pub(crate) saved_secret: bool,
}

/// `remote_connect` 요청. 비밀값을 담으므로 `Debug`·`Serialize` 미구현.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteConnectRequest {
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) user: String,
    pub(crate) auth_method: RemoteAuthMethod,
    #[serde(default)]
    pub(crate) password: Option<String>,
    #[serde(default)]
    pub(crate) key_path: Option<String>,
    #[serde(default)]
    pub(crate) passphrase: Option<String>,
}

/// 연결된 원격 위치. `session_id`는 원격 루트 URL(`sftp://사용자@호스트:포트/`).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteSession {
    pub(crate) session_id: String,
    pub(crate) user: String,
    pub(crate) host: String,
    pub(crate) port: u16,
    pub(crate) home: String,
    pub(crate) home_url: String,
    pub(crate) host_key_algorithm: String,
    pub(crate) host_key_fingerprint: String,
}

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum RemoteConnectionState {
    Connected,
    Disconnected,
    Lost,
}

/// `remote_connection_changed` 이벤트: 연결·앱 요청 해제·끊김.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RemoteConnectionChanged {
    pub(crate) session_id: String,
    pub(crate) state: RemoteConnectionState,
    pub(crate) error: Option<AppError>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            window: None,
            schema_version: 1,
            theme: "dark".to_string(),
            language: "ko".to_string(),
            size_format: "binary".to_string(),
            external: ExternalSettings::default(),
            bookmarks: Vec::new(),
            layout: LayoutSettings::default(),
            session: SessionSettings::default(),
            view: ViewSettings::default(),
            remote: RemoteSettings::default(),
        }
    }
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WindowSettings {
    pub(crate) width: u32,
    pub(crate) height: u32,
    pub(crate) maximized: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppError {
    pub(crate) code: String,
    pub(crate) message_key: String,
    pub(crate) path: Option<String>,
    pub(crate) details: Option<BTreeMap<String, String>>,
    pub(crate) recoverable: bool,
}

impl AppError {
    pub(crate) fn new(
        code: &str,
        message_key: &str,
        path: Option<&Path>,
        recoverable: bool,
    ) -> Self {
        Self {
            code: code.to_string(),
            message_key: message_key.to_string(),
            path: path.map(display_path),
            details: None,
            recoverable,
        }
    }

    pub(crate) fn with_detail(mut self, key: &str, value: impl Into<String>) -> Self {
        let details = self.details.get_or_insert_with(BTreeMap::new);
        details.insert(key.to_string(), value.into());
        self
    }
}

pub(crate) type CommandResult<T> = Result<T, AppError>;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformInfo {
    pub(crate) os: &'static str,
    pub(crate) features: PlatformFeatures,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformFeatures {
    pub(crate) open_with: bool,
    pub(crate) current_folder_manager: bool,
    pub(crate) current_folder_terminal: bool,
    pub(crate) native_file_clipboard: bool,
    pub(crate) trash_undo: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ClipboardIntent {
    Copy,
    Move,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileClipboard {
    pub(crate) change_count: i64,
    pub(crate) paths: Vec<String>,
    pub(crate) entries: Vec<FileEntry>,
    pub(crate) intent: ClipboardIntent,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameRules {
    pub(crate) find: String,
    pub(crate) replacement: String,
    pub(crate) prefix: String,
    pub(crate) numbering: bool,
    pub(crate) start: u64,
    pub(crate) padding: usize,
    pub(crate) preserve_extension: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenameItem {
    pub(crate) source: String,
    pub(crate) new_name: String,
    pub(crate) stamp: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RenamePreview {
    pub(crate) item: RenameItem,
    pub(crate) changed: bool,
    pub(crate) error: Option<AppError>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashUndoPreview {
    pub(crate) id: String,
    pub(crate) entries: Vec<FileEntry>,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OperationKind {
    Copy,
    Move,
    Delete,
    Trash,
    RestoreTrash,
    Rename,
    CreateDir,
    ArchiveCreate,
    ArchiveExtract,
    ArchiveAdd,
    ShellCommand,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OperationState {
    Idle,
    Validating,
    Scanning,
    Queued,
    WaitingForConflict,
    Running,
    Cancelling,
    Completed,
    CompletedWithErrors,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ConflictDecision {
    Overwrite,
    Skip,
    AllOverwrite,
    AllSkip,
    Cancel,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum DeleteMode {
    Trash,
    Permanent,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationStarted {
    pub(crate) operation_id: String,
    pub(crate) kind: OperationKind,
    pub(crate) state: OperationState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationProgress {
    pub(crate) operation_id: String,
    pub(crate) kind: OperationKind,
    pub(crate) state: OperationState,
    pub(crate) total_files: Option<u64>,
    pub(crate) completed_files: u64,
    pub(crate) total_bytes: Option<u64>,
    pub(crate) completed_bytes: u64,
    pub(crate) current_path: Option<String>,
    pub(crate) bytes_per_second: Option<u64>,
    pub(crate) eta_seconds: Option<u64>,
    pub(crate) recent_error_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictPrompt {
    pub(crate) operation_id: String,
    pub(crate) source: FileEntry,
    pub(crate) destination: FileEntry,
    pub(crate) default_decision: ConflictDecision,
    pub(crate) available_decisions: Vec<ConflictDecision>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct OperationSummary {
    pub(crate) operation_id: String,
    pub(crate) kind: OperationKind,
    pub(crate) state: OperationState,
    pub(crate) completed_files: u64,
    pub(crate) failed_files: u64,
    pub(crate) skipped_files: u64,
    pub(crate) errors: Vec<AppError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) command_result: Option<ShellCommandResult>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ConflictAck {
    pub(crate) operation_id: String,
    pub(crate) decision: ConflictDecision,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CancelAck {
    pub(crate) operation_id: String,
    pub(crate) state: OperationState,
}

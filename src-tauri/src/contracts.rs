use crate::path_text::display_path;
use serde::Deserialize;
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::Path;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
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
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WatchAck {
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
    pub(crate) path: String,
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
    pub(crate) exit_code: Option<i32>,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    pub(crate) timed_out: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExternalSettings {
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
    pub(crate) left_path: Option<String>,
    pub(crate) right_path: Option<String>,
    pub(crate) active_panel: PanelId,
}

impl Default for SessionSettings {
    fn default() -> Self {
        Self {
            left_path: None,
            right_path: None,
            active_panel: PanelId::Right,
        }
    }
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
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            theme: "dark".to_string(),
            language: "ko".to_string(),
            size_format: "binary".to_string(),
            external: ExternalSettings::default(),
            bookmarks: Vec::new(),
            layout: LayoutSettings::default(),
            session: SessionSettings::default(),
            view: ViewSettings::default(),
        }
    }
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

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum OperationKind {
    Copy,
    Move,
    Delete,
    Trash,
    Rename,
    CreateDir,
    ArchiveCreate,
    ArchiveExtract,
    ArchiveAdd,
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

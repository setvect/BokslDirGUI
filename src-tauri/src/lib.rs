use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum PanelId {
    Left,
    Right,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum EntryKind {
    File,
    Directory,
    Symlink,
    Executable,
    Archive,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SortField {
    Name,
    Size,
    ModifiedAt,
    Extension,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SortSpec {
    field: SortField,
    direction: SortDirection,
    directories_first: bool,
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
struct FileEntry {
    path: String,
    name: String,
    kind: EntryKind,
    symlink_target_is_directory: Option<bool>,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    created_at: Option<String>,
    permissions: Option<String>,
    owner: Option<String>,
    group: Option<String>,
    is_hidden: bool,
    is_virtual: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    panel_id: PanelId,
    path: String,
    entries: Vec<FileEntry>,
    sort: SortSpec,
    filter: Option<String>,
    version: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DirectoryStats {
    total_file_bytes: u64,
    file_count: u64,
    directory_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    #[serde(flatten)]
    entry: FileEntry,
    absolute_path: String,
    extension: Option<String>,
    mime_type: Option<String>,
    readonly: bool,
    directory_stats: Option<DirectoryStats>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WatchAck {
    panel_id: PanelId,
    path: String,
    version: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BookmarkLocation {
    id: String,
    label: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LocationList {
    home: String,
    roots: Vec<String>,
    recent: Vec<String>,
    bookmarks: Vec<BookmarkLocation>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ArchiveListing {
    archive_path: String,
    entries: Vec<FileEntry>,
    encrypted: bool,
    total_entries: u64,
    truncated: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ActionResult {
    ok: bool,
    message_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FilePreview {
    path: String,
    name: String,
    kind: String,
    mime_type: Option<String>,
    size_bytes: u64,
    text: Option<String>,
    data_url: Option<String>,
    truncated: bool,
    limit_bytes: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ShellCommandPolicy {
    enabled: bool,
    reason_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ShellCommandPreview {
    confirm_token: String,
    expires_at: String,
    fingerprint: String,
    requires_confirmation: bool,
    policy: ShellCommandPolicy,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ShellCommandResult {
    exit_code: Option<i32>,
    stdout: String,
    stderr: String,
    timed_out: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ExternalSettings {
    editor_id: Option<String>,
    shell_command: ShellCommandEnabled,
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
struct ShellCommandEnabled {
    enabled: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LayoutSettings {
    single_panel: bool,
    ratio: String,
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
struct SessionSettings {
    left_path: Option<String>,
    right_path: Option<String>,
    active_panel: PanelId,
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
struct ViewSettings {
    #[serde(default)]
    zoom_step: i32,
    #[serde(default = "default_view_density")]
    density: String,
    #[serde(default = "default_show_icons")]
    show_icons: bool,
}

fn default_view_density() -> String {
    "compact".to_string()
}

fn default_show_icons() -> bool {
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
struct Settings {
    schema_version: u32,
    theme: String,
    language: String,
    size_format: String,
    external: ExternalSettings,
    bookmarks: Vec<BookmarkLocation>,
    layout: LayoutSettings,
    #[serde(default)]
    session: SessionSettings,
    #[serde(default)]
    view: ViewSettings,
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
struct AppError {
    code: String,
    message_key: String,
    path: Option<String>,
    details: Option<BTreeMap<String, String>>,
    recoverable: bool,
}

impl AppError {
    fn new(code: &str, message_key: &str, path: Option<&Path>, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message_key: message_key.to_string(),
            path: path.map(display_path),
            details: None,
            recoverable,
        }
    }

    fn with_detail(mut self, key: &str, value: impl Into<String>) -> Self {
        let details = self.details.get_or_insert_with(BTreeMap::new);
        details.insert(key.to_string(), value.into());
        self
    }
}

type CommandResult<T> = Result<T, AppError>;

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum OperationKind {
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
enum OperationState {
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
enum ConflictDecision {
    Overwrite,
    Skip,
    AllOverwrite,
    AllSkip,
    Cancel,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum DeleteMode {
    Trash,
    Permanent,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OperationStarted {
    operation_id: String,
    kind: OperationKind,
    state: OperationState,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OperationProgress {
    operation_id: String,
    kind: OperationKind,
    state: OperationState,
    total_files: Option<u64>,
    completed_files: u64,
    total_bytes: Option<u64>,
    completed_bytes: u64,
    current_path: Option<String>,
    bytes_per_second: Option<u64>,
    eta_seconds: Option<u64>,
    recent_error_count: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ConflictPrompt {
    operation_id: String,
    source: FileEntry,
    destination: FileEntry,
    default_decision: ConflictDecision,
    available_decisions: Vec<ConflictDecision>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct OperationSummary {
    operation_id: String,
    kind: OperationKind,
    state: OperationState,
    completed_files: u64,
    failed_files: u64,
    skipped_files: u64,
    errors: Vec<AppError>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ConflictAck {
    operation_id: String,
    decision: ConflictDecision,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct CancelAck {
    operation_id: String,
    state: OperationState,
}

#[tauri::command]
fn health_check() -> &'static str {
    "ok"
}

#[tauri::command]
fn list_dir(
    panel_id: PanelId,
    path: String,
    show_hidden: bool,
    sort: SortSpec,
    filter: Option<String>,
) -> CommandResult<DirectoryListing> {
    navigation::list_dir(panel_id, &path, show_hidden, sort, filter)
}

#[tauri::command]
fn goto_path(panel_id: PanelId, path: String) -> CommandResult<DirectoryListing> {
    navigation::list_dir(panel_id, &path, false, SortSpec::default(), None)
}

#[tauri::command]
async fn get_metadata(path: String) -> CommandResult<FileMetadata> {
    let failure_path = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || navigation::get_metadata(&path))
        .await
        .map_err(|error| {
            AppError::new("io_error", "errors.io", Some(&failure_path), false)
                .with_detail("message", error.to_string())
        })?
}

const DEFAULT_TEXT_PREVIEW_LIMIT: u64 = 256 * 1024;
const MAX_TEXT_PREVIEW_LIMIT: u64 = 1024 * 1024;
const IMAGE_PREVIEW_LIMIT: u64 = 8 * 1024 * 1024;

#[tauri::command]
fn preview_file(path: String, max_bytes: Option<u64>) -> CommandResult<FilePreview> {
    let path = navigation::canonical_existing_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| map_io_error(error, Some(&path)))?;
    if !metadata.is_file() {
        return Err(AppError::new(
            "not_file",
            "errors.previewNotFile",
            Some(&path),
            true,
        ));
    }
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(&path));
    let size_bytes = metadata.len();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let mime_type = preview_mime_type(&extension).map(str::to_string);

    if preview_image_mime_type(&extension).is_some() {
        if size_bytes > IMAGE_PREVIEW_LIMIT {
            return Ok(FilePreview {
                path: display_path(&path),
                name,
                kind: "tooLarge".to_string(),
                mime_type,
                size_bytes,
                text: None,
                data_url: None,
                truncated: false,
                limit_bytes: IMAGE_PREVIEW_LIMIT,
            });
        }
        let bytes = fs::read(&path).map_err(|error| map_io_error(error, Some(&path)))?;
        let mime = preview_image_mime_type(&extension).unwrap_or("application/octet-stream");
        return Ok(FilePreview {
            path: display_path(&path),
            name,
            kind: "image".to_string(),
            mime_type: Some(mime.to_string()),
            size_bytes,
            text: None,
            data_url: Some(format!("data:{mime};base64,{}", encode_base64(&bytes))),
            truncated: false,
            limit_bytes: IMAGE_PREVIEW_LIMIT,
        });
    }

    if preview_text_mime_type(&extension).is_some() {
        let limit = max_bytes
            .unwrap_or(DEFAULT_TEXT_PREVIEW_LIMIT)
            .clamp(1, MAX_TEXT_PREVIEW_LIMIT);
        let mut bytes = Vec::with_capacity((limit.min(size_bytes) + 1) as usize);
        fs::File::open(&path)
            .map_err(|error| map_io_error(error, Some(&path)))?
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| map_io_error(error, Some(&path)))?;
        let truncated = bytes.len() as u64 > limit;
        bytes.truncate(limit as usize);
        if bytes.iter().take(8 * 1024).any(|byte| *byte == 0) {
            return Ok(FilePreview {
                path: display_path(&path),
                name,
                kind: "unsupported".to_string(),
                mime_type,
                size_bytes,
                text: None,
                data_url: None,
                truncated: false,
                limit_bytes: limit,
            });
        }
        return Ok(FilePreview {
            path: display_path(&path),
            name,
            kind: "text".to_string(),
            mime_type,
            size_bytes,
            text: Some(String::from_utf8_lossy(&bytes).into_owned()),
            data_url: None,
            truncated,
            limit_bytes: limit,
        });
    }

    Ok(FilePreview {
        path: display_path(&path),
        name,
        kind: "unsupported".to_string(),
        mime_type,
        size_bytes,
        text: None,
        data_url: None,
        truncated: false,
        limit_bytes: max_bytes.unwrap_or(DEFAULT_TEXT_PREVIEW_LIMIT),
    })
}

fn preview_image_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn preview_text_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "txt" | "log" => Some("text/plain"),
        "md" | "markdown" => Some("text/markdown"),
        "json" => Some("application/json"),
        "yaml" | "yml" => Some("application/yaml"),
        "toml" => Some("application/toml"),
        "xml" => Some("application/xml"),
        "csv" => Some("text/csv"),
        "rs" | "ts" | "tsx" | "js" | "jsx" | "css" | "html" | "htm" | "sh" | "zsh" | "bash" | "py" | "java" | "kt" | "c" | "h" | "cpp" | "hpp" | "sql" => Some("text/plain"),
        _ => None,
    }
}

fn preview_mime_type(extension: &str) -> Option<&'static str> {
    preview_image_mime_type(extension).or_else(|| preview_text_mime_type(extension))
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 { TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char } else { '=' });
        encoded.push(if chunk.len() > 2 { TABLE[(third & 0x3f) as usize] as char } else { '=' });
    }
    encoded
}

#[tauri::command]
fn watch_path(panel_id: PanelId, path: String) -> CommandResult<WatchAck> {
    let path = navigation::canonical_existing_path(&path)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&path),
            true,
        ));
    }
    Ok(WatchAck {
        panel_id,
        path: display_path(&path),
        version: listing_version(&path),
    })
}

#[tauri::command]
fn list_locations() -> CommandResult<LocationList> {
    navigation::list_locations()
}

#[tauri::command]
fn create_dir(parent: String, name: String) -> CommandResult<FileEntry> {
    mutation::create_dir(&parent, &name)
}

#[tauri::command]
fn rename_entry(path: String, new_name: String) -> CommandResult<FileEntry> {
    mutation::rename_entry(&path, &new_name)
}

#[tauri::command]
fn start_copy(
    app: tauri::AppHandle,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    operation::start_copy(Some(&app), sources, target_dir, policy)
}

#[tauri::command]
fn start_move(
    app: tauri::AppHandle,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    operation::start_move(Some(&app), sources, target_dir, policy)
}

#[tauri::command]
fn start_delete(
    app: tauri::AppHandle,
    targets: Vec<String>,
    mode: DeleteMode,
    confirm_token: Option<String>,
) -> CommandResult<OperationStarted> {
    operation::start_delete(Some(&app), targets, mode, confirm_token.as_deref())
}

#[tauri::command]
fn cancel_operation(operation_id: String) -> CommandResult<CancelAck> {
    operation::cancel_operation(operation_id)
}

#[tauri::command]
fn resolve_conflict(
    operation_id: String,
    decision: ConflictDecision,
) -> CommandResult<ConflictAck> {
    operation::resolve_conflict(operation_id, decision)
}

#[tauri::command]
fn archive_list(
    archive_path: String,
    password: Option<String>,
    limit: Option<usize>,
) -> CommandResult<ArchiveListing> {
    archive::archive_list(&archive_path, password, limit)
}

#[tauri::command]
fn archive_create(
    app: tauri::AppHandle,
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> CommandResult<OperationStarted> {
    operation::start_archive_create(Some(&app), sources, target_archive, format, password)
}

#[tauri::command]
fn archive_extract(
    app: tauri::AppHandle,
    archive_path: String,
    target_dir: String,
    password: Option<String>,
    policy: ConflictDecision,
    entries: Option<Vec<String>>,
    strip_prefix: Option<String>,
) -> CommandResult<OperationStarted> {
    operation::start_archive_extract(
        Some(&app),
        archive_path,
        target_dir,
        password,
        policy,
        entries,
        strip_prefix,
    )
}

#[tauri::command]
fn archive_add(
    app: tauri::AppHandle,
    sources: Vec<String>,
    archive_path: String,
    target_inner_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    operation::start_archive_add(Some(&app), sources, archive_path, target_inner_dir, policy)
}

#[tauri::command]
fn open_default(path: String) -> CommandResult<ActionResult> {
    external::open_default(&path)
}

#[tauri::command]
fn reveal_in_manager(path: String) -> CommandResult<ActionResult> {
    external::reveal_in_manager(&path)
}

#[tauri::command]
fn open_external_editor(path: String, editor_id: Option<String>) -> CommandResult<ActionResult> {
    external::open_external_editor(&path, editor_id.as_deref())
}

#[tauri::command]
fn prepare_shell_command(
    working_dir: String,
    command: String,
    args: Option<Vec<String>>,
) -> CommandResult<ShellCommandPreview> {
    shell_command::prepare_shell_command(&working_dir, &command, args.unwrap_or_default())
}

#[tauri::command]
fn run_shell_command(
    working_dir: String,
    command: String,
    args: Option<Vec<String>>,
    confirm_token: String,
) -> CommandResult<ShellCommandResult> {
    shell_command::run_shell_command(
        &working_dir,
        &command,
        args.unwrap_or_default(),
        &confirm_token,
    )
}

#[tauri::command]
fn load_settings() -> CommandResult<Settings> {
    settings_service::load_settings()
}

#[tauri::command]
fn save_settings(patch: serde_json::Value) -> CommandResult<Settings> {
    settings_service::save_settings(patch)
}

mod settings_service {
    use super::*;
    static SETTINGS_SAVE_LOCK: Mutex<()> = Mutex::new(());

    pub(super) fn load_settings() -> CommandResult<Settings> {
        let path = settings_path()?;
        if !path.exists() {
            return Ok(Settings::default());
        }
        let text = fs::read_to_string(&path).map_err(|error| map_io_error(error, Some(&path)))?;
        let settings = serde_json::from_str::<Settings>(&text).map_err(|error| {
            AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(&path),
                true,
            )
            .with_detail("message", error.to_string())
        })?;
        validate_settings(&settings, &path)?;
        Ok(settings)
    }

    pub(super) fn save_settings(patch: serde_json::Value) -> CommandResult<Settings> {
        let _guard = SETTINGS_SAVE_LOCK.lock().map_err(|_| AppError::new(
            "io_error", "errors.settingsSaveFailed", None, true))?;
        let path = settings_path()?;
        let current = load_settings()?;
        let mut value = serde_json::to_value(current).map_err(|error| {
            AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(&path),
                true,
            )
            .with_detail("message", error.to_string())
        })?;
        merge_json(&mut value, patch);
        let next: Settings = serde_json::from_value(value).map_err(|error| {
            AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(&path),
                true,
            )
            .with_detail("message", error.to_string())
        })?;
        validate_settings(&next, &path)?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
        }
        let tmp = path.with_extension("json.tmp");
        let body = serde_json::to_string_pretty(&next).map_err(|error| {
            AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(&path),
                true,
            )
            .with_detail("message", error.to_string())
        })?;
        fs::write(&tmp, body).map_err(|error| map_io_error(error, Some(&tmp)))?;
        fs::rename(&tmp, &path).map_err(|error| map_io_error(error, Some(&path)))?;
        Ok(next)
    }

    pub(super) fn settings_path() -> CommandResult<PathBuf> {
        if let Some(path) = env::var_os("BOKSLDIRGUI_SETTINGS_PATH") {
            return Ok(PathBuf::from(path));
        }
        let home = home_dir()?;
        #[cfg(target_os = "macos")]
        let path = home
            .join("Library")
            .join("Application Support")
            .join("BokslDirGUI")
            .join("settings.json");
        #[cfg(target_os = "windows")]
        let path = env::var_os("APPDATA")
            .map(PathBuf::from)
            .unwrap_or(home)
            .join("BokslDirGUI")
            .join("settings.json");
        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        let path = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or_else(|| home.join(".config"))
            .join("BokslDirGUI")
            .join("settings.json");
        Ok(path)
    }

    fn validate_settings(settings: &Settings, path: &Path) -> CommandResult<()> {
        if !["dark", "light", "highContrast"].contains(&settings.theme.as_str()) {
            return Err(AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(path),
                true,
            )
            .with_detail("field", "theme"));
        }
        if !["ko", "en"].contains(&settings.language.as_str()) {
            return Err(AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(path),
                true,
            )
            .with_detail("field", "language"));
        }
        if !["binary", "decimal"].contains(&settings.size_format.as_str()) {
            return Err(AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(path),
                true,
            )
            .with_detail("field", "sizeFormat"));
        }
        if !["50:50", "70:30", "30:70"].contains(&settings.layout.ratio.as_str()) {
            return Err(AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(path),
                true,
            )
            .with_detail("field", "layout.ratio"));
        }
        if !(-3..=5).contains(&settings.view.zoom_step) {
            return Err(AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(path),
                true,
            )
            .with_detail("field", "view.zoomStep"));
        }
        if !["compact", "comfortable"].contains(&settings.view.density.as_str()) {
            return Err(AppError::new(
                "invalid_settings",
                "errors.settingsInvalid",
                Some(path),
                true,
            )
            .with_detail("field", "view.density"));
        }
        Ok(())
    }

    fn merge_json(target: &mut serde_json::Value, patch: serde_json::Value) {
        match (target, patch) {
            (serde_json::Value::Object(target), serde_json::Value::Object(patch)) => {
                for (key, value) in patch {
                    merge_json(target.entry(key).or_insert(serde_json::Value::Null), value);
                }
            }
            (target, patch) => *target = patch,
        }
    }

    fn home_dir() -> CommandResult<PathBuf> {
        env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| env::current_dir().ok())
            .ok_or_else(|| AppError::new("io_error", "errors.homeUnavailable", None, true))
    }
}

mod shell_command {
    use super::*;

    static SHELL_TOKENS: OnceLock<Mutex<BTreeMap<String, ShellToken>>> = OnceLock::new();
    static SHELL_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);
    #[cfg(test)]
    static SHELL_TEST_CLOCK_OFFSET_MS: AtomicU64 = AtomicU64::new(0);
    const SHELL_TOKEN_TTL: Duration = Duration::from_secs(60);
    const SHELL_OUTPUT_LIMIT: usize = 16 * 1024;

    #[derive(Debug, Clone)]
    struct ShellToken {
        fingerprint: String,
        expires_at: Instant,
        expires_at_text: String,
        used: bool,
    }

    pub(super) fn prepare_shell_command(
        working_dir: &str,
        command: &str,
        args: Vec<String>,
    ) -> CommandResult<ShellCommandPreview> {
        let settings = settings_service::load_settings()?;
        let working_dir = navigation::canonical_existing_path(working_dir)?;
        if !working_dir.is_dir() {
            return Err(AppError::new(
                "not_directory",
                "errors.notDirectory",
                Some(&working_dir),
                true,
            ));
        }
        let fingerprint = fingerprint(&working_dir, command, &args)?;
        let enabled = settings.external.shell_command.enabled;
        if !enabled {
            return Ok(ShellCommandPreview {
                confirm_token: "disabled".to_string(),
                expires_at: epoch_text(),
                fingerprint,
                requires_confirmation: true,
                policy: ShellCommandPolicy {
                    enabled: false,
                    reason_key: Some(
                        "settings.external.shellCommand.disabledByDefault".to_string(),
                    ),
                },
            });
        }
        let token = next_token();
        let expires_at = shell_now_instant() + SHELL_TOKEN_TTL;
        let expires_at_text = unix_text(shell_now_system() + SHELL_TOKEN_TTL);
        token_registry()
            .lock()
            .expect("shell token registry lock should not be poisoned")
            .insert(
                token.clone(),
                ShellToken {
                    fingerprint: fingerprint.clone(),
                    expires_at,
                    expires_at_text: expires_at_text.clone(),
                    used: false,
                },
            );
        Ok(ShellCommandPreview {
            confirm_token: token,
            expires_at: expires_at_text,
            fingerprint,
            requires_confirmation: true,
            policy: ShellCommandPolicy {
                enabled: true,
                reason_key: None,
            },
        })
    }

    pub(super) fn run_shell_command(
        working_dir: &str,
        command: &str,
        args: Vec<String>,
        confirm_token: &str,
    ) -> CommandResult<ShellCommandResult> {
        let settings = settings_service::load_settings()?;
        if !settings.external.shell_command.enabled {
            return Err(AppError::new(
                "disabled",
                "errors.shellCommandDisabled",
                None,
                true,
            ));
        }
        let working_dir = navigation::canonical_existing_path(working_dir)?;
        if !working_dir.is_dir() {
            return Err(AppError::new(
                "not_directory",
                "errors.notDirectory",
                Some(&working_dir),
                true,
            ));
        }
        let fingerprint = fingerprint(&working_dir, command, &args)?;
        consume_token(confirm_token, &fingerprint)?;
        let output = Command::new(command)
            .args(&args)
            .current_dir(&working_dir)
            .output()
            .map_err(|error| map_io_error(error, Some(&working_dir)))?;
        Ok(ShellCommandResult {
            exit_code: output.status.code(),
            stdout: limit_output(&String::from_utf8_lossy(&output.stdout)),
            stderr: limit_output(&String::from_utf8_lossy(&output.stderr)),
            timed_out: false,
        })
    }

    fn consume_token(token: &str, fingerprint: &str) -> CommandResult<()> {
        let mut registry = token_registry()
            .lock()
            .expect("shell token registry lock should not be poisoned");
        let Some(stored) = registry.get_mut(token) else {
            return Err(AppError::new(
                "invalid_token",
                "errors.confirmationRequired",
                None,
                true,
            ));
        };
        if stored.used
            || stored.expires_at < shell_now_instant()
            || stored.fingerprint != fingerprint
        {
            return Err(
                AppError::new("invalid_token", "errors.confirmationRequired", None, true)
                    .with_detail("expiresAt", stored.expires_at_text.clone()),
            );
        }
        stored.used = true;
        Ok(())
    }

    fn fingerprint(working_dir: &Path, command: &str, args: &[String]) -> CommandResult<String> {
        let command = command.trim();
        if command.is_empty() || command.contains('\0') {
            return Err(AppError::new(
                "invalid_command",
                "errors.invalidShellCommand",
                Some(working_dir),
                true,
            ));
        }
        if args.iter().any(|arg| arg.contains('\0')) {
            return Err(AppError::new(
                "invalid_command",
                "errors.invalidShellCommand",
                Some(working_dir),
                true,
            ));
        }
        Ok(format!(
            "{}::{}::{:?}",
            display_path(working_dir),
            command,
            args
        ))
    }

    fn token_registry() -> &'static Mutex<BTreeMap<String, ShellToken>> {
        SHELL_TOKENS.get_or_init(|| Mutex::new(BTreeMap::new()))
    }

    fn shell_now_instant() -> Instant {
        Instant::now() + shell_clock_offset()
    }

    fn shell_now_system() -> SystemTime {
        SystemTime::now() + shell_clock_offset()
    }

    fn shell_clock_offset() -> Duration {
        #[cfg(test)]
        {
            Duration::from_millis(SHELL_TEST_CLOCK_OFFSET_MS.load(AtomicOrdering::SeqCst))
        }
        #[cfg(not(test))]
        {
            Duration::ZERO
        }
    }

    #[cfg(test)]
    pub(super) fn advance_clock_past_token_ttl_for_test() {
        SHELL_TEST_CLOCK_OFFSET_MS.store(
            (SHELL_TOKEN_TTL + Duration::from_secs(1)).as_millis() as u64,
            AtomicOrdering::SeqCst,
        );
    }

    #[cfg(test)]
    pub(super) fn reset_clock_for_test() {
        SHELL_TEST_CLOCK_OFFSET_MS.store(0, AtomicOrdering::SeqCst);
    }

    fn next_token() -> String {
        let counter = SHELL_TOKEN_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        format!("shell-{nonce}-{counter}")
    }

    fn limit_output(value: &str) -> String {
        value.chars().take(SHELL_OUTPUT_LIMIT).collect()
    }

    fn epoch_text() -> String {
        unix_text(UNIX_EPOCH)
    }
}

mod external {
    use super::*;

    pub(super) fn open_default(path: &str) -> CommandResult<ActionResult> {
        let path = navigation::canonical_existing_path(path)?;
        run_open_command(&path, false, None)
    }

    pub(super) fn reveal_in_manager(path: &str) -> CommandResult<ActionResult> {
        let path = navigation::canonical_existing_path(path)?;
        run_open_command(&path, true, None)
    }

    pub(super) fn open_external_editor(
        path: &str,
        editor_id: Option<&str>,
    ) -> CommandResult<ActionResult> {
        let path = navigation::canonical_existing_path(path)?;
        let settings = settings_service::load_settings()?;
        let editor = editor_id
            .map(str::to_string)
            .or(settings.external.editor_id)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| {
                AppError::new(
                    "disabled",
                    "errors.externalEditorNotConfigured",
                    Some(&path),
                    true,
                )
            })?;
        run_open_command(&path, false, Some(editor))
    }

    fn run_open_command(
        path: &Path,
        reveal: bool,
        editor: Option<String>,
    ) -> CommandResult<ActionResult> {
        if env::var_os("BOKSLDIRGUI_EXTERNAL_DRY_RUN").is_some() {
            return Ok(ActionResult {
                ok: true,
                message_key: Some("external.dryRun".to_string()),
            });
        }

        let mut command = if let Some(editor) = editor {
            let mut command = Command::new(editor);
            command.arg(path);
            command
        } else {
            platform_open_command(path, reveal)?
        };
        command
            .spawn()
            .map_err(|error| map_io_error(error, Some(path)))?;
        Ok(ActionResult {
            ok: true,
            message_key: None,
        })
    }

    #[cfg(target_os = "macos")]
    fn platform_open_command(path: &Path, reveal: bool) -> CommandResult<Command> {
        let mut command = Command::new("open");
        if reveal {
            command.arg("-R");
        }
        command.arg(path);
        Ok(command)
    }

    #[cfg(target_os = "windows")]
    fn platform_open_command(path: &Path, reveal: bool) -> CommandResult<Command> {
        let mut command = Command::new("explorer");
        if reveal {
            command.arg("/select,");
        }
        command.arg(path);
        Ok(command)
    }

    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    fn platform_open_command(path: &Path, _reveal: bool) -> CommandResult<Command> {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        Ok(command)
    }
}

mod archive {
    use super::*;

    const DEFAULT_ARCHIVE_LIST_LIMIT: usize = 50_000;
    const MAX_ARCHIVE_LIST_LIMIT: usize = 200_000;

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct ArchiveEntryInfo {
        path: String,
        kind: EntryKind,
        size_bytes: Option<u64>,
        modified_at: Option<String>,
        created_at: Option<String>,
        permissions: Option<String>,
    }

    pub(super) fn archive_list(
        archive_path: &str,
        password: Option<String>,
        limit: Option<usize>,
    ) -> CommandResult<ArchiveListing> {
        let archive = navigation::canonical_existing_path(archive_path)?;
        let password = password.as_deref().filter(|value| !value.is_empty());
        let (entries, encrypted) = list_archive_entries(&archive, password)?;
        let total_entries = entries.len() as u64;
        let limit = limit
            .unwrap_or(DEFAULT_ARCHIVE_LIST_LIMIT)
            .clamp(1, MAX_ARCHIVE_LIST_LIMIT);
        let truncated = entries.len() > limit;
        let entries = entries
            .iter()
            .take(limit)
            .map(|entry| archive_entry_for_info(&archive, entry))
            .collect();
        Ok(ArchiveListing {
            archive_path: display_path(&archive),
            entries,
            encrypted,
            total_entries,
            truncated,
        })
    }

    fn list_archive_entries(
        archive: &Path,
        password: Option<&str>,
    ) -> CommandResult<(Vec<ArchiveEntryInfo>, bool)> {
        match archive_format_name(archive).as_deref() {
            Some("zip" | "jar" | "war") => list_zip_entries_with_metadata(archive, password),
            Some("7z") => list_7z_entries_with_metadata(archive, password),
            Some("tar" | "tar.gz" | "tar.zst") => {
                list_tar_entries_with_metadata(archive).map(|entries| (entries, false))
            }
            _ => Err(AppError::new(
                "unsupported",
                "errors.archiveFormatUnsupported",
                Some(archive),
                true,
            )),
        }
    }

    // macOS unzip -Z1 mangles UTF-8 filenames when the ZIP UTF-8 flag is absent.
    // The system tar (libarchive) preserves the stored names, including archives
    // written by macOS zip, while unzip still supplies the metadata below.
    pub(super) fn zip_name_listing_command(archive: &Path) -> Command {
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = Command::new("tar");
            command.arg("-tf");
            command
        };
        #[cfg(not(target_os = "macos"))]
        let mut command = {
            let mut command = Command::new("unzip");
            command.arg("-Z1");
            command
        };
        command.arg(archive);
        command
    }

    fn list_zip_entries_with_metadata(
        archive: &Path,
        _password: Option<&str>,
    ) -> CommandResult<(Vec<ArchiveEntryInfo>, bool)> {
        let output = zip_name_listing_command(archive)
            .output()
            .map_err(|error| map_io_error(error, Some(archive)))?;
        let names = parse_zip_name_output(output, archive, None)?;
        let detail_output = Command::new("unzip")
            .args(["-Z", "-T", "-l"])
            .arg(archive)
            .output()
            .map_err(|error| map_io_error(error, Some(archive)))?;
        let entries = parse_zipinfo_long_output(detail_output, archive, &names)?;
        let encrypted = Command::new("zipinfo")
            .arg("-v")
            .arg(archive)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .is_some_and(|output| {
                String::from_utf8_lossy(&output.stdout)
                    .to_ascii_lowercase()
                    .contains("file security status:                           encrypted")
            });
        Ok((entries, encrypted))
    }

    fn list_7z_entries_with_metadata(
        archive: &Path,
        password: Option<&str>,
    ) -> CommandResult<(Vec<ArchiveEntryInfo>, bool)> {
        let binary = find_binary("7zz")
            .or_else(|| find_binary("7z"))
            .ok_or_else(|| {
                AppError::new(
                    "unsupported",
                    "errors.archiveProviderUnavailable",
                    Some(archive),
                    true,
                )
                .with_detail("provider", "7z")
            })?;
        let mut command = Command::new(binary);
        command.arg("l").arg("-slt");
        if let Some(password) = password {
            command.arg(format!("-p{password}"));
        }
        let output = command
            .arg(archive)
            .output()
            .map_err(|error| map_io_error(error, Some(archive)))?;
        if !output.status.success() {
            return Err(archive_provider_output_error(&output, archive, password));
        }
        let encrypted = String::from_utf8_lossy(&output.stdout).contains("Encrypted = +");
        Ok((parse_7z_slt_entries(&output.stdout), encrypted))
    }

    fn list_tar_entries_with_metadata(archive: &Path) -> CommandResult<Vec<ArchiveEntryInfo>> {
        let output = Command::new("tar")
            .arg("-tf")
            .arg(archive)
            .output()
            .map_err(|error| map_io_error(error, Some(archive)))?;
        if !output.status.success() {
            return Err(archive_provider_output_error(&output, archive, None));
        }
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(|path| ArchiveEntryInfo {
                path: path.to_string(),
                kind: entry_kind_for_archive_member(path, path.ends_with('/'), None, None),
                size_bytes: None,
                modified_at: None,
                created_at: None,
                permissions: None,
            })
            .collect())
    }

    fn archive_provider_output_error(
        output: &std::process::Output,
        archive: &Path,
        password: Option<&str>,
    ) -> AppError {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let lowered = stderr.to_ascii_lowercase();
        let password_error = lowered.contains("password") || lowered.contains("encrypted");
        let (code, message_key) = if password_error && password.is_some() {
            ("invalid_password", "errors.archivePasswordInvalid")
        } else if password_error {
            ("password_required", "errors.archivePasswordRequired")
        } else {
            ("external_command_failed", "errors.externalCommandFailed")
        };
        let stderr = stderr.into_owned();
        let stderr = password
            .filter(|secret| !secret.is_empty())
            .map_or(stderr.clone(), |secret| stderr.replace(secret, "[redacted]"));
        AppError::new(code, message_key, Some(archive), true)
            .with_detail("stderr", stderr.chars().take(512).collect::<String>())
    }

    fn archive_format_name(path: &Path) -> Option<String> {
        let name = path.file_name()?.to_string_lossy().to_ascii_lowercase();
        for (suffix, format) in [
            (".tar.gz", "tar.gz"),
            (".tgz", "tar.gz"),
            (".tar.zst", "tar.zst"),
            (".tzst", "tar.zst"),
            (".zip", "zip"),
            (".jar", "jar"),
            (".war", "war"),
            (".tar", "tar"),
            (".7z", "7z"),
        ] {
            if name.ends_with(suffix) {
                return Some(format.to_string());
            }
        }
        None
    }

    fn parse_zip_name_output(
        output: std::process::Output,
        archive: &Path,
        password: Option<&str>,
    ) -> CommandResult<Vec<String>> {
        if !output.status.success() {
            return Err(archive_provider_output_error(
                &output,
                archive,
                password,
            ));
        }
        Ok(String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::trim)
            .filter(|line| !line.is_empty())
            .map(str::to_string)
            .collect())
    }

    fn parse_zipinfo_long_output(
        output: std::process::Output,
        archive: &Path,
        names: &[String],
    ) -> CommandResult<Vec<ArchiveEntryInfo>> {
        if !output.status.success() {
            return Err(AppError::new(
                "external_command_failed",
                "errors.externalCommandFailed",
                Some(archive),
                true,
            )
            .with_detail(
                "stderr",
                String::from_utf8_lossy(&output.stderr)
                    .chars()
                    .take(512)
                    .collect::<String>(),
            ));
        }

        let metadata: Vec<ZipInfoMetadata> = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(parse_zipinfo_long_line)
            .collect();
        Ok(names
            .iter()
            .enumerate()
            .map(|(index, name)| {
                let metadata = metadata.get(index);
                let permissions = metadata.map(|item| item.permissions.clone());
                let kind = entry_kind_for_archive_member(
                    name,
                    name.ends_with('/'),
                    permissions.as_deref(),
                    None,
                );
                ArchiveEntryInfo {
                    path: name.clone(),
                    kind,
                    size_bytes: metadata
                        .and_then(|item| item.size_bytes)
                        .filter(|_| !name.ends_with('/')),
                    modified_at: metadata.and_then(|item| item.modified_at.clone()),
                    created_at: None,
                    permissions,
                }
            })
            .collect())
    }

    #[derive(Debug, Clone, PartialEq, Eq)]
    struct ZipInfoMetadata {
        permissions: String,
        size_bytes: Option<u64>,
        modified_at: Option<String>,
    }

    fn parse_zipinfo_long_line(line: &str) -> Option<ZipInfoMetadata> {
        let columns: Vec<&str> = line.split_whitespace().collect();
        let permissions = columns.first()?;
        if permissions.len() != 10 || !matches!(permissions.as_bytes()[0], b'-' | b'd' | b'l') {
            return None;
        }
        Some(ZipInfoMetadata {
            permissions: (*permissions).to_string(),
            size_bytes: columns.get(3).and_then(|value| value.parse::<u64>().ok()),
            modified_at: columns
                .get(7)
                .and_then(|value| zipinfo_timestamp_to_iso(value)),
        })
    }

    pub(super) fn parse_7z_slt_paths(stdout: &[u8]) -> Vec<String> {
        parse_7z_slt_entries(stdout)
            .into_iter()
            .map(|entry| entry.path)
            .collect()
    }

    fn parse_7z_slt_entries(stdout: &[u8]) -> Vec<ArchiveEntryInfo> {
        let text = String::from_utf8_lossy(stdout);
        let mut in_entries = false;
        let mut current = SevenZipEntryFields::default();
        let mut entries = Vec::new();
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with("----------") {
                in_entries = true;
                continue;
            }
            if !in_entries || trimmed.is_empty() {
                continue;
            }
            let Some((key, value)) = trimmed.split_once(" = ") else {
                continue;
            };
            if key == "Path" {
                if let Some(entry) = current.finish() {
                    entries.push(entry);
                }
                current = SevenZipEntryFields::default();
                current.path = Some(value.trim().to_string());
                continue;
            }
            current.apply(key, value);
        }
        if let Some(entry) = current.finish() {
            entries.push(entry);
        }
        entries
    }

    #[cfg(test)]
    pub(super) fn parse_7z_slt_paths_for_test(stdout: &[u8]) -> Vec<String> {
        parse_7z_slt_paths(stdout)
    }

    #[cfg(test)]
    pub(super) fn parse_7z_slt_entries_for_test(stdout: &[u8]) -> Vec<FileEntry> {
        parse_7z_slt_entries(stdout)
            .iter()
            .map(|entry| archive_entry_for_info(Path::new("/tmp/archive.7z"), entry))
            .collect()
    }

    #[cfg(test)]
    pub(super) fn parse_zipinfo_long_output_for_test(
        stdout: &[u8],
        names: &[String],
    ) -> Vec<FileEntry> {
        let output = std::process::Output {
            status: success_status_for_test(),
            stdout: stdout.to_vec(),
            stderr: Vec::new(),
        };
        parse_zipinfo_long_output(output, Path::new("/tmp/archive.zip"), names)
            .expect("zipinfo fixture should parse")
            .iter()
            .map(|entry| archive_entry_for_info(Path::new("/tmp/archive.zip"), entry))
            .collect()
    }

    #[cfg(all(test, unix))]
    fn success_status_for_test() -> std::process::ExitStatus {
        use std::os::unix::process::ExitStatusExt;
        std::process::ExitStatus::from_raw(0)
    }

    #[derive(Default)]
    struct SevenZipEntryFields {
        path: Option<String>,
        size_bytes: Option<u64>,
        modified_at: Option<String>,
        created_at: Option<String>,
        attributes: Option<String>,
        folder: Option<bool>,
    }

    impl SevenZipEntryFields {
        fn apply(&mut self, key: &str, value: &str) {
            let value = value.trim();
            match key {
                "Size" => self.size_bytes = value.parse::<u64>().ok(),
                "Modified" => self.modified_at = seven_zip_timestamp_to_iso(value),
                "Created" => self.created_at = seven_zip_timestamp_to_iso(value),
                "Attributes" => self.attributes = Some(value.to_string()),
                "Folder" => self.folder = Some(value == "+"),
                _ => {}
            }
        }

        fn finish(self) -> Option<ArchiveEntryInfo> {
            let path = self.path?.trim().to_string();
            if path.is_empty() {
                return None;
            }
            let permissions = permission_text_from_7z_attributes(self.attributes.as_deref());
            let kind = entry_kind_for_archive_member(
                &path,
                path.ends_with('/') || self.folder.unwrap_or(false),
                permissions.as_deref(),
                self.attributes.as_deref(),
            );
            Some(ArchiveEntryInfo {
                path,
                size_bytes: if kind == EntryKind::Directory {
                    None
                } else {
                    self.size_bytes
                },
                modified_at: self.modified_at,
                created_at: self.created_at,
                permissions,
                kind,
            })
        }
    }

    fn archive_entry_for_info(archive: &Path, entry: &ArchiveEntryInfo) -> FileEntry {
        FileEntry {
            path: format!("{}!{}", display_path(archive), entry.path),
            name: entry
                .path
                .trim_end_matches('/')
                .rsplit('/')
                .next()
                .unwrap_or(&entry.path)
                .to_string(),
            kind: entry.kind.clone(),
            symlink_target_is_directory: None,
            size_bytes: entry.size_bytes,
            modified_at: entry.modified_at.clone(),
            created_at: entry.created_at.clone(),
            permissions: entry.permissions.clone(),
            owner: None,
            group: None,
            is_hidden: entry
                .path
                .rsplit('/')
                .next()
                .is_some_and(|value| value.starts_with('.')),
            is_virtual: false,
        }
    }

    fn entry_kind_for_archive_member(
        name: &str,
        is_dir: bool,
        permissions: Option<&str>,
        attributes: Option<&str>,
    ) -> EntryKind {
        if is_dir || permissions.is_some_and(|value| value.starts_with('d')) {
            return EntryKind::Directory;
        }
        if permissions.is_some_and(|value| value.starts_with('l')) {
            return EntryKind::Symlink;
        }
        if attributes.is_some_and(|value| value.contains('D')) {
            return EntryKind::Directory;
        }
        if is_archive_path(Path::new(name)) {
            return EntryKind::Archive;
        }
        EntryKind::File
    }

    fn zipinfo_timestamp_to_iso(value: &str) -> Option<String> {
        if value.len() < 15 {
            return None;
        }
        let (date, time) = value.split_once('.')?;
        if date.len() != 8 || time.len() < 6 {
            return None;
        }
        Some(format!(
            "{}-{}-{}T{}:{}:{}",
            &date[0..4],
            &date[4..6],
            &date[6..8],
            &time[0..2],
            &time[2..4],
            &time[4..6]
        ))
    }

    fn seven_zip_timestamp_to_iso(value: &str) -> Option<String> {
        let normalized = value.trim();
        if normalized.len() < 19 {
            return None;
        }
        let timestamp = &normalized[0..19];
        if timestamp.as_bytes().get(10) != Some(&b' ') {
            return None;
        }
        Some(format!("{}T{}", &timestamp[0..10], &timestamp[11..19]))
    }

    fn permission_text_from_7z_attributes(attributes: Option<&str>) -> Option<String> {
        attributes?
            .split_whitespace()
            .find(|part| part.len() == 10 && matches!(part.as_bytes()[0], b'-' | b'd' | b'l'))
            .map(str::to_string)
    }

    fn find_binary(name: &str) -> Option<String> {
        let path_var = env::var_os("PATH")?;
        for dir in env::split_paths(&path_var) {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(display_path(&candidate));
            }
        }
        None
    }

    #[cfg(test)]
    pub(super) fn seven_zip_binary_for_test() -> Option<String> {
        find_binary("7zz").or_else(|| find_binary("7z"))
    }
}

mod navigation {
    use super::*;

    pub(super) fn list_dir(
        panel_id: PanelId,
        path: &str,
        show_hidden: bool,
        sort: SortSpec,
        filter: Option<String>,
    ) -> CommandResult<DirectoryListing> {
        let path = canonical_existing_path(path)?;
        if !path.is_dir() {
            return Err(AppError::new(
                "not_directory",
                "errors.notDirectory",
                Some(&path),
                true,
            ));
        }

        let mut entries = Vec::new();
        if let Some(parent) = path.parent() {
            entries.push(parent_virtual_entry(parent));
        }

        let normalized_filter = filter
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_lowercase);
        let read_dir = fs::read_dir(&path).map_err(|error| map_io_error(error, Some(&path)))?;
        for entry in read_dir {
            let entry = entry.map_err(|error| map_io_error(error, Some(&path)))?;
            let entry_path = entry.path();
            let name = entry.file_name().to_string_lossy().into_owned();
            if !show_hidden && is_hidden_name(&name) {
                continue;
            }
            if let Some(filter_text) = normalized_filter.as_deref() {
                if !name.to_lowercase().contains(filter_text) {
                    continue;
                }
            }
            entries.push(file_entry_from_path(&entry_path, false)?);
        }

        sort_entries(&mut entries, &sort);

        Ok(DirectoryListing {
            panel_id,
            path: display_path(&path),
            entries,
            sort,
            filter,
            version: listing_version(&path),
        })
    }

    pub(super) fn get_metadata(path: &str) -> CommandResult<FileMetadata> {
        let path = canonical_existing_path(path)?;
        let entry = file_entry_from_path(&path, false)?;
        let readonly = fs::metadata(&path)
            .map_err(|error| map_io_error(error, Some(&path)))?
            .permissions()
            .readonly();
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_string());
        let mime_type = extension
            .as_deref()
            .and_then(mime_from_extension)
            .map(str::to_string);
        let directory_stats = if entry.kind == EntryKind::Directory {
            Some(collect_directory_stats(&path)?)
        } else {
            None
        };
        Ok(FileMetadata {
            absolute_path: display_path(&path),
            extension,
            mime_type,
            readonly,
            directory_stats,
            entry,
        })
    }

    fn collect_directory_stats(root: &Path) -> CommandResult<DirectoryStats> {
        let mut stats = DirectoryStats {
            total_file_bytes: 0,
            file_count: 0,
            directory_count: 0,
        };
        let mut pending = vec![root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            let children =
                fs::read_dir(&directory).map_err(|error| map_io_error(error, Some(&directory)))?;
            for child in children {
                let child = child.map_err(|error| map_io_error(error, Some(&directory)))?;
                let path = child.path();
                let metadata = fs::symlink_metadata(&path)
                    .map_err(|error| map_io_error(error, Some(&path)))?;
                if metadata.is_dir() {
                    stats.directory_count = stats.directory_count.saturating_add(1);
                    pending.push(path);
                } else if metadata.is_file() {
                    stats.file_count = stats.file_count.saturating_add(1);
                    stats.total_file_bytes = stats.total_file_bytes.saturating_add(metadata.len());
                }
            }
        }
        Ok(stats)
    }

    pub(super) fn list_locations() -> CommandResult<LocationList> {
        let home = env::var_os("HOME")
            .map(PathBuf::from)
            .or_else(|| env::current_dir().ok())
            .ok_or_else(|| AppError::new("io_error", "errors.homeUnavailable", None, true))?;
        let home = canonical_existing_path(&home.to_string_lossy())?;

        let mut roots = Vec::from([String::from("/")]);
        #[cfg(target_os = "macos")]
        {
            let volumes = Path::new("/Volumes");
            if let Ok(items) = fs::read_dir(volumes) {
                for item in items.flatten() {
                    if let Ok(path) = item.path().canonicalize() {
                        roots.push(display_path(&path));
                    }
                }
            }
        }
        roots.sort();
        roots.dedup();

        let recent = env::current_dir()
            .ok()
            .and_then(|path| path.canonicalize().ok())
            .map(|path| vec![display_path(&path)])
            .unwrap_or_default();

        let bookmarks = settings_service::load_settings()
            .map(|settings| settings.bookmarks)
            .unwrap_or_default();

        Ok(LocationList {
            home: display_path(&home),
            roots,
            recent,
            bookmarks,
        })
    }

    pub(super) fn canonical_existing_path(path: &str) -> CommandResult<PathBuf> {
        let raw = PathBuf::from(path);
        raw.canonicalize()
            .map_err(|error| map_io_error(error, Some(&raw)))
    }
}

mod mutation {
    use super::*;

    pub(super) fn create_dir(parent: &str, name: &str) -> CommandResult<FileEntry> {
        let parent = navigation::canonical_existing_path(parent)?;
        if !parent.is_dir() {
            return Err(AppError::new(
                "not_directory",
                "errors.notDirectory",
                Some(&parent),
                true,
            ));
        }

        let safe_name = validate_child_name(name, Some(&parent))?;
        let target = parent.join(safe_name);
        if path_is_occupied(&target) {
            return Err(AppError::new(
                "already_exists",
                "errors.alreadyExists",
                Some(&target),
                true,
            ));
        }

        fs::create_dir(&target).map_err(|error| map_io_error(error, Some(&target)))?;
        file_entry_from_path(&target, false)
    }

    pub(super) fn rename_entry(path: &str, new_name: &str) -> CommandResult<FileEntry> {
        let raw_source = PathBuf::from(path);
        let raw_parent = raw_source.parent().ok_or_else(|| {
            AppError::new(
                "invalid_path",
                "errors.invalidPath",
                Some(&raw_source),
                true,
            )
        })?;
        let source_name = raw_source
            .file_name()
            .and_then(|value| value.to_str())
            .ok_or_else(|| {
                AppError::new(
                    "invalid_name",
                    "errors.invalidName",
                    Some(&raw_source),
                    true,
                )
            })?;
        // The existing entry name is an exact filesystem identity, including whitespace.
        validate_child_name(source_name, Some(&raw_source))?;
        let parent = navigation::canonical_existing_path(&raw_parent.to_string_lossy())?;
        if !parent.is_dir() {
            return Err(AppError::new(
                "not_directory",
                "errors.notDirectory",
                Some(&parent),
                true,
            ));
        }
        let source = parent.join(source_name);
        fs::symlink_metadata(&source).map_err(|error| map_io_error(error, Some(&source)))?;
        let safe_name = validate_child_name(new_name, Some(&parent))?;
        let target = parent.join(safe_name);

        if target == source {
            return file_entry_from_path(&source, false);
        }

        if path_is_occupied(&target) {
            return Err(AppError::new(
                "already_exists",
                "errors.alreadyExists",
                Some(&target),
                true,
            ));
        }

        rename_no_replace(&source, &target).map_err(|error| map_io_error(error, Some(&target)))?;
        file_entry_from_path(&target, false)
    }

    fn validate_child_name<'a>(name: &'a str, path: Option<&Path>) -> CommandResult<&'a str> {
        let trimmed = name.trim();
        if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
            return Err(AppError::new(
                "invalid_name",
                "errors.invalidName",
                path,
                true,
            ));
        }
        if trimmed.contains('\0') || trimmed.contains('/') || trimmed.contains('\\') {
            return Err(
                AppError::new("invalid_name", "errors.invalidName", path, true)
                    .with_detail("name", trimmed),
            );
        }
        if Path::new(trimmed).components().count() != 1 {
            return Err(
                AppError::new("invalid_name", "errors.invalidName", path, true)
                    .with_detail("name", trimmed),
            );
        }
        Ok(trimmed)
    }

    pub(super) fn path_is_occupied(path: &Path) -> bool {
        fs::symlink_metadata(path).is_ok()
    }

    #[cfg(target_os = "macos")]
    pub(super) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
        use std::ffi::CString;
        use std::os::raw::{c_char, c_int};
        use std::os::unix::ffi::OsStrExt;

        extern "C" {
            fn renamex_np(from: *const c_char, to: *const c_char, flags: c_int) -> c_int;
        }

        const RENAME_EXCL: c_int = 0x00000004;
        let source = CString::new(source.as_os_str().as_bytes())?;
        let target = CString::new(target.as_os_str().as_bytes())?;
        let result = unsafe { renamex_np(source.as_ptr(), target.as_ptr(), RENAME_EXCL) };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(super) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
        use std::ffi::CString;
        use std::os::raw::{c_char, c_long};
        use std::os::unix::ffi::OsStrExt;

        extern "C" {
            fn syscall(num: c_long, ...) -> c_long;
        }

        #[cfg(target_arch = "x86_64")]
        const SYS_RENAMEAT2: c_long = 316;
        #[cfg(target_arch = "aarch64")]
        const SYS_RENAMEAT2: c_long = 276;
        #[cfg(target_arch = "x86")]
        const SYS_RENAMEAT2: c_long = 353;
        #[cfg(target_arch = "arm")]
        const SYS_RENAMEAT2: c_long = 382;
        const AT_FDCWD: c_long = -100;
        const RENAME_NOREPLACE: c_long = 1;

        let source = CString::new(source.as_os_str().as_bytes())?;
        let target = CString::new(target.as_os_str().as_bytes())?;
        let result = unsafe {
            syscall(
                SYS_RENAMEAT2,
                AT_FDCWD,
                source.as_ptr() as *const c_char,
                AT_FDCWD,
                target.as_ptr() as *const c_char,
                RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(windows)]
    pub(super) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
        use std::os::windows::ffi::OsStrExt;

        extern "system" {
            fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
        }

        const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        let result =
            unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) };
        if result != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }

    #[cfg(not(any(
        target_os = "macos",
        target_os = "linux",
        target_os = "android",
        windows
    )))]
    pub(super) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
        if path_is_occupied(target) {
            return Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "target already exists",
            ));
        }
        fs::rename(source, target)
    }
}

mod operation;

fn parent_virtual_entry(parent: &Path) -> FileEntry {
    FileEntry {
        path: display_path(parent),
        name: "..".to_string(),
        kind: EntryKind::Directory,
        symlink_target_is_directory: None,
        size_bytes: None,
        modified_at: None,
        created_at: None,
        permissions: None,
        owner: None,
        group: None,
        is_hidden: false,
        is_virtual: true,
    }
}

fn file_entry_from_path(path: &Path, is_virtual: bool) -> CommandResult<FileEntry> {
    let metadata = fs::symlink_metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(path));
    let kind = classify_entry(path, &metadata);
    let symlink_target_is_directory = if metadata.file_type().is_symlink() {
        fs::metadata(path).ok().map(|target| target.is_dir())
    } else {
        None
    };
    let size_bytes = if metadata.is_file() {
        Some(metadata.len())
    } else {
        None
    };

    Ok(FileEntry {
        path: display_path(path),
        name: name.clone(),
        kind,
        symlink_target_is_directory,
        size_bytes,
        modified_at: metadata.modified().ok().and_then(system_time_to_rfc3339),
        created_at: metadata.created().ok().and_then(system_time_to_rfc3339),
        permissions: Some(format_permissions(&metadata)),
        owner: owner_text(&metadata),
        group: group_text(&metadata),
        is_hidden: is_hidden_name(&name),
        is_virtual,
    })
}

fn classify_entry(path: &Path, metadata: &fs::Metadata) -> EntryKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return EntryKind::Symlink;
    }
    if metadata.is_dir() {
        return EntryKind::Directory;
    }
    if metadata.is_file() {
        if is_archive_path(path) {
            return EntryKind::Archive;
        }
        if is_executable(metadata) {
            return EntryKind::Executable;
        }
        return EntryKind::File;
    }
    EntryKind::Unknown
}

fn is_archive_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let lowered = name.to_lowercase();
    [
        ".zip", ".jar", ".war", ".tar", ".tar.gz", ".tgz", ".tar.zst", ".tzst", ".7z",
    ]
    .iter()
    .any(|suffix| lowered.ends_with(suffix))
}

#[cfg(unix)]
fn owner_text(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.uid().to_string())
}

#[cfg(not(unix))]
fn owner_text(_metadata: &fs::Metadata) -> Option<String> {
    None
}

#[cfg(unix)]
fn group_text(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.gid().to_string())
}

#[cfg(not(unix))]
fn group_text(_metadata: &fs::Metadata) -> Option<String> {
    None
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn format_permissions(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = metadata.permissions().mode();
    let mut out = String::new();
    out.push(if metadata.is_dir() { 'd' } else { '-' });
    for bit in [
        0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
    ] {
        out.push(match bit {
            0o400 | 0o040 | 0o004 => {
                if mode & bit != 0 {
                    'r'
                } else {
                    '-'
                }
            }
            0o200 | 0o020 | 0o002 => {
                if mode & bit != 0 {
                    'w'
                } else {
                    '-'
                }
            }
            _ => {
                if mode & bit != 0 {
                    'x'
                } else {
                    '-'
                }
            }
        });
    }
    out
}

#[cfg(not(unix))]
fn format_permissions(metadata: &fs::Metadata) -> String {
    if metadata.permissions().readonly() {
        "readonly".to_string()
    } else {
        "readwrite".to_string()
    }
}

fn sort_entries(entries: &mut [FileEntry], sort: &SortSpec) {
    entries.sort_by(|left, right| {
        if left.is_virtual != right.is_virtual {
            return right.is_virtual.cmp(&left.is_virtual);
        }
        if sort.directories_first {
            let left_dir = left.kind == EntryKind::Directory;
            let right_dir = right.kind == EntryKind::Directory;
            if left_dir != right_dir {
                return right_dir.cmp(&left_dir);
            }
        }

        let ordering = match sort.field {
            SortField::Name => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
            SortField::Size => left
                .size_bytes
                .unwrap_or(0)
                .cmp(&right.size_bytes.unwrap_or(0)),
            SortField::ModifiedAt => left.modified_at.cmp(&right.modified_at),
            SortField::Extension => extension_of(&left.name).cmp(&extension_of(&right.name)),
        };

        match sort.direction {
            SortDirection::Asc => ordering.then_with(|| left.name.cmp(&right.name)),
            SortDirection::Desc => {
                reverse_ordering(ordering).then_with(|| right.name.cmp(&left.name))
            }
        }
    });
}

fn reverse_ordering(ordering: Ordering) -> Ordering {
    match ordering {
        Ordering::Less => Ordering::Greater,
        Ordering::Equal => Ordering::Equal,
        Ordering::Greater => Ordering::Less,
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') && name != ".."
}

fn system_time_to_rfc3339(time: SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    Some(datetime.to_rfc3339())
}

fn unix_text(time: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339()
}

fn listing_version(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(1)
}

fn mime_from_extension(extension: &str) -> Option<&'static str> {
    match extension.to_lowercase().as_str() {
        "md" => Some("text/markdown"),
        "txt" => Some("text/plain"),
        "json" => Some("application/json"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "zip" => Some("application/zip"),
        "7z" => Some("application/x-7z-compressed"),
        _ => None,
    }
}

fn map_io_error(error: io::Error, path: Option<&Path>) -> AppError {
    let (code, message_key, recoverable) = match error.kind() {
        io::ErrorKind::NotFound => ("not_found", "errors.notFound", true),
        io::ErrorKind::AlreadyExists => ("already_exists", "errors.alreadyExists", true),
        io::ErrorKind::PermissionDenied => ("permission_denied", "errors.permissionDenied", true),
        io::ErrorKind::InvalidInput => ("invalid_path", "errors.invalidPath", true),
        _ => ("io_error", "errors.io", false),
    };
    AppError::new(code, message_key, path, recoverable)
        .with_detail("ioKind", format!("{:?}", error.kind()))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[tauri::command]
fn show_drop_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let overlay = app
        .get_webview_window("drop-overlay")
        .ok_or_else(|| "drop overlay window is unavailable".to_string())?;
    let position = main.inner_position().map_err(|error| error.to_string())?;
    let size = main.inner_size().map_err(|error| error.to_string())?;
    overlay
        .set_position(tauri::Position::Physical(position))
        .map_err(|error| error.to_string())?;
    overlay
        .set_size(tauri::Size::Physical(size))
        .map_err(|error| error.to_string())?;
    overlay.show().map_err(|error| error.to_string())
}

#[tauri::command]
fn hide_drop_overlay(app: tauri::AppHandle) -> Result<(), String> {
    let overlay = app
        .get_webview_window("drop-overlay")
        .ok_or_else(|| "drop overlay window is unavailable".to_string())?;
    overlay.hide().map_err(|error| error.to_string())
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
struct ClientCursorPosition {
    x: f64,
    y: f64,
}

#[tauri::command]
fn main_cursor_position(app: tauri::AppHandle) -> Result<ClientCursorPosition, String> {
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "main window is unavailable".to_string())?;
    let cursor = app.cursor_position().map_err(|error| error.to_string())?;
    let origin = main.inner_position().map_err(|error| error.to_string())?;
    let scale_factor = main.scale_factor().map_err(|error| error.to_string())?;
    Ok(ClientCursorPosition {
        x: (cursor.x - f64::from(origin.x)) / scale_factor,
        y: (cursor.y - f64::from(origin.y)) / scale_factor,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_drag::init())
        .on_window_event(|window, event| {
            if window.label() == "main" && matches!(event, tauri::WindowEvent::Destroyed) {
                if let Some(overlay) = window.app_handle().get_webview_window("drop-overlay") {
                    let _ = overlay.close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            list_dir,
            get_metadata,
            preview_file,
            watch_path,
            goto_path,
            list_locations,
            create_dir,
            rename_entry,
            start_copy,
            start_move,
            start_delete,
            cancel_operation,
            resolve_conflict,
            archive_list,
            archive_create,
            archive_extract,
            archive_add,
            open_default,
            reveal_in_manager,
            open_external_editor,
            prepare_shell_command,
            run_shell_command,
            load_settings,
            save_settings,
            show_drop_overlay,
            hide_drop_overlay,
            main_cursor_position
        ])
        .run(tauri::generate_context!())
        .expect("failed to run BokslDirGUI Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

    static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);
    pub(super) static TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

    struct TempFixture {
        root: PathBuf,
    }

    impl TempFixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock must be after epoch")
                .as_nanos();
            let counter = FIXTURE_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
            let root = env::temp_dir().join(format!(
                "boksldir-gui-navigation-{}-{nonce}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(root.join("folder")).expect("fixture folder should be created");
            let mut file =
                File::create(root.join("alpha.txt")).expect("fixture file should be created");
            file.write_all(b"hello")
                .expect("fixture file should be written");
            File::create(root.join("archive.7z")).expect("archive fixture should be created");
            File::create(root.join(".hidden")).expect("hidden fixture should be created");
            Self { root }
        }
    }

    impl Drop for TempFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn health_check_reports_ok() {
        assert_eq!(health_check(), "ok");
    }

    #[test]
    fn list_dir_returns_normalized_read_only_listing() {
        let fixture = TempFixture::new();
        let listing = list_dir(
            PanelId::Left,
            fixture.root.to_string_lossy().into_owned(),
            false,
            SortSpec::default(),
            None,
        )
        .expect("listing should succeed");

        assert_eq!(listing.panel_id, PanelId::Left);
        assert!(Path::new(&listing.path).is_absolute());
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == ".." && entry.is_virtual));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "folder" && entry.kind == EntryKind::Directory));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "alpha.txt" && entry.kind == EntryKind::File));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "archive.7z" && entry.kind == EntryKind::Archive));
        assert!(!listing.entries.iter().any(|entry| entry.name == ".hidden"));
    }

    #[cfg(unix)]
    #[test]
    fn list_dir_identifies_symlink_targets_without_changing_link_kind() {
        use std::os::unix::fs::symlink;

        let fixture = TempFixture::new();
        let directory_link = fixture.root.join("directory-link");
        let file_link = fixture.root.join("file-link");
        let broken_link = fixture.root.join("broken-link");
        symlink(fixture.root.join("folder"), &directory_link).unwrap();
        symlink(fixture.root.join("alpha.txt"), &file_link).unwrap();
        symlink(fixture.root.join("missing"), &broken_link).unwrap();

        let listing = list_dir(
            PanelId::Left,
            fixture.root.to_string_lossy().into_owned(),
            false,
            SortSpec::default(),
            None,
        )
        .unwrap();
        for (name, target_is_directory) in [
            ("directory-link", Some(true)),
            ("file-link", Some(false)),
            ("broken-link", None),
        ] {
            let entry = listing.entries.iter().find(|entry| entry.name == name).unwrap();
            assert_eq!(entry.kind, EntryKind::Symlink);
            assert_eq!(entry.symlink_target_is_directory, target_is_directory);
            assert_eq!(
                serde_json::to_value(entry).unwrap()["symlinkTargetIsDirectory"],
                serde_json::json!(target_is_directory)
            );
        }

        let target_listing = list_dir(
            PanelId::Left,
            directory_link.to_string_lossy().into_owned(),
            false,
            SortSpec::default(),
            None,
        )
        .unwrap();
        assert_eq!(
            target_listing.path,
            display_path(&fixture.root.join("folder").canonicalize().unwrap())
        );
    }

    #[test]
    fn list_dir_can_include_hidden_and_filter_entries() {
        let fixture = TempFixture::new();
        let listing = list_dir(
            PanelId::Right,
            fixture.root.to_string_lossy().into_owned(),
            true,
            SortSpec::default(),
            Some("hid".to_string()),
        )
        .expect("listing should succeed");

        assert!(listing.entries.iter().any(|entry| entry.name == ".hidden"));
        assert!(!listing
            .entries
            .iter()
            .any(|entry| entry.name == "alpha.txt"));
    }

    #[test]
    fn get_metadata_reports_file_details() {
        let fixture = TempFixture::new();
        let metadata = tauri::async_runtime::block_on(get_metadata(
            fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned(),
        ))
        .expect("metadata should succeed");

        assert_eq!(metadata.entry.name, "alpha.txt");
        assert_eq!(metadata.entry.size_bytes, Some(5));
        assert_eq!(metadata.extension, Some("txt".to_string()));
        assert_eq!(metadata.mime_type, Some("text/plain".to_string()));
        assert_eq!(metadata.directory_stats, None);
    }

    #[test]
    fn get_metadata_counts_nested_regular_files_and_subdirectories() {
        let fixture = TempFixture::new();
        let root = fixture.root.join("folder");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir(root.join("empty")).unwrap();
        fs::write(root.join("one.txt"), b"one").unwrap();
        fs::write(nested.join("two.txt"), b"12345").unwrap();
        fs::write(nested.join(".hidden"), b"xy").unwrap();

        let metadata = tauri::async_runtime::block_on(get_metadata(display_path(&root))).unwrap();
        assert_eq!(metadata.entry.kind, EntryKind::Directory);
        assert_eq!(metadata.entry.size_bytes, None);
        assert_eq!(
            metadata.directory_stats,
            Some(DirectoryStats {
                total_file_bytes: 10,
                file_count: 3,
                directory_count: 2,
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn get_metadata_does_not_follow_links_or_count_sockets() {
        use std::os::unix::net::UnixListener;
        let short_root = env::temp_dir().join(format!(
            "bdm-{}-{}",
            std::process::id(),
            FIXTURE_COUNTER.fetch_add(1, AtomicOrdering::Relaxed)
        ));
        fs::create_dir(&short_root).unwrap();
        let fixture = TempFixture { root: short_root };
        let root = fixture.root.join("folder");
        let outside = fixture.root.join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        fs::write(outside.join("file.txt"), b"outside").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked-folder")).unwrap();
        let _listener = UnixListener::bind(root.join("monitor.ipc")).unwrap();

        let metadata = tauri::async_runtime::block_on(get_metadata(display_path(&root))).unwrap();
        assert_eq!(
            metadata.directory_stats,
            Some(DirectoryStats {
                total_file_bytes: 0,
                file_count: 0,
                directory_count: 0,
            })
        );
    }

    #[test]
    fn preview_file_limits_text_and_never_executes_unsupported_content() {
        let fixture = TempFixture::new();
        let text_path = fixture.root.join("preview.md");
        fs::write(&text_path, "가나다라마바사 abcdefghijklmnopqrstuvwxyz")
            .expect("preview text should be written");
        let text = preview_file(text_path.to_string_lossy().into_owned(), Some(12))
            .expect("text preview should succeed");
        assert_eq!(text.kind, "text");
        assert!(text.truncated);
        assert!(text.text.is_some());
        assert!(text.data_url.is_none());
        assert_eq!(text.limit_bytes, 12);

        let executable = fixture.root.join("program.bin");
        fs::write(&executable, b"#!/bin/sh\necho should-not-run\n")
            .expect("unsupported preview fixture should be written");
        let unsupported = preview_file(executable.to_string_lossy().into_owned(), None)
            .expect("unsupported preview should be a successful state");
        assert_eq!(unsupported.kind, "unsupported");
        assert!(unsupported.text.is_none());
        assert!(unsupported.data_url.is_none());

        let image_path = fixture.root.join("pixel.png");
        fs::write(&image_path, [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a])
            .expect("image preview fixture should be written");
        let image = preview_file(image_path.to_string_lossy().into_owned(), None)
            .expect("small image preview should succeed");
        assert_eq!(image.kind, "image");
        assert!(image.data_url.as_deref().is_some_and(|url| url.starts_with("data:image/png;base64,")));
    }

    #[test]
    fn invalid_path_returns_typed_error() {
        let fixture = TempFixture::new();
        let error = tauri::async_runtime::block_on(get_metadata(
            fixture
                .root
                .join("missing.txt")
                .to_string_lossy()
                .into_owned(),
        ))
        .expect_err("missing file should fail");

        assert_eq!(error.code, "not_found");
        assert_eq!(error.message_key, "errors.notFound");
        assert!(error.recoverable);
    }

    #[test]
    fn list_locations_returns_home_and_roots() {
        let locations = list_locations().expect("locations should be available");
        assert!(!locations.home.is_empty());
        assert!(locations.roots.iter().any(|root| root == "/"));
    }

    #[test]
    fn watch_path_validates_directory_and_returns_version() {
        let fixture = TempFixture::new();
        let ack = watch_path(PanelId::Left, fixture.root.to_string_lossy().into_owned())
            .expect("watch ack should succeed");

        assert_eq!(ack.panel_id, PanelId::Left);
        assert!(ack.version > 0);
    }

    #[test]
    fn create_dir_creates_child_with_validated_name() {
        let fixture = TempFixture::new();
        let created = create_dir(
            fixture.root.to_string_lossy().into_owned(),
            "new-folder".to_string(),
        )
        .expect("directory should be created");

        assert_eq!(created.name, "new-folder");
        assert_eq!(created.kind, EntryKind::Directory);
        assert!(fixture.root.join("new-folder").is_dir());
    }

    #[test]
    fn create_dir_rejects_existing_and_nested_names() {
        let fixture = TempFixture::new();

        let existing = create_dir(
            fixture.root.to_string_lossy().into_owned(),
            "folder".to_string(),
        )
        .expect_err("existing directory should fail");
        assert_eq!(existing.code, "already_exists");
        assert!(existing.recoverable);

        let invalid = create_dir(
            fixture.root.to_string_lossy().into_owned(),
            "nested/folder".to_string(),
        )
        .expect_err("path separator should fail");
        assert_eq!(invalid.code, "invalid_name");
    }

    #[test]
    fn rename_entry_renames_within_same_parent_without_overwrite() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        let renamed = rename_entry(
            source.to_string_lossy().into_owned(),
            "beta.txt".to_string(),
        )
        .expect("rename should succeed");

        assert_eq!(renamed.name, "beta.txt");
        assert!(fixture.root.join("beta.txt").is_file());
        assert!(!source.exists());
    }

    #[test]
    fn rename_entry_rejects_existing_and_invalid_names() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        let existing = rename_entry(
            source.to_string_lossy().into_owned(),
            "archive.7z".to_string(),
        )
        .expect_err("rename overwrite should fail");
        assert_eq!(existing.code, "already_exists");

        let invalid = rename_entry(
            source.to_string_lossy().into_owned(),
            "../escape.txt".to_string(),
        )
        .expect_err("path traversal should fail");
        assert_eq!(invalid.code, "invalid_name");
        assert!(source.exists());
    }

    #[cfg(unix)]
    #[test]
    fn rename_entry_rejects_dangling_symlink_target() {
        use std::os::unix::fs::symlink;

        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");
        let dangling = fixture.root.join("dangling-link");
        symlink(fixture.root.join("missing-target"), &dangling)
            .expect("dangling symlink should be created");

        let error = rename_entry(
            source.to_string_lossy().into_owned(),
            "dangling-link".to_string(),
        )
        .expect_err("rename should not overwrite dangling symlink path");

        assert_eq!(error.code, "already_exists");
        assert!(source.exists());
        assert!(fs::symlink_metadata(dangling).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn rename_entry_renames_symlink_entry_not_target() {
        use std::os::unix::fs::symlink;

        let fixture = TempFixture::new();
        let target = fixture.root.join("alpha.txt");
        let link = fixture.root.join("alpha-link");
        let renamed_link = fixture.root.join("renamed-link");
        symlink(&target, &link).expect("symlink source should be created");

        let renamed = rename_entry(
            link.to_string_lossy().into_owned(),
            "renamed-link".to_string(),
        )
        .expect("symlink entry rename should succeed");

        assert_eq!(renamed.name, "renamed-link");
        assert_eq!(renamed.kind, EntryKind::Symlink);
        assert!(target.exists(), "target file must not be renamed");
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(fs::symlink_metadata(&renamed_link).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn rename_entry_renames_dangling_symlink_source_entry() {
        use std::os::unix::fs::symlink;

        let fixture = TempFixture::new();
        let link = fixture.root.join("dangling-source");
        let renamed_link = fixture.root.join("renamed-dangling-source");
        symlink(fixture.root.join("missing-target"), &link)
            .expect("dangling symlink source should be created");

        let renamed = rename_entry(
            link.to_string_lossy().into_owned(),
            "renamed-dangling-source".to_string(),
        )
        .expect("dangling symlink source entry rename should succeed");

        assert_eq!(renamed.name, "renamed-dangling-source");
        assert_eq!(renamed.kind, EntryKind::Symlink);
        assert!(fs::symlink_metadata(&link).is_err());
        assert!(fs::symlink_metadata(&renamed_link).is_ok());
    }

    #[test]
    fn start_copy_recursively_copies_files_and_directories() {
        let fixture = TempFixture::new();
        let target = fixture.root.join("copy-target");
        fs::create_dir_all(&target).expect("target directory should be created");
        let nested = fixture.root.join("folder/nested.txt");
        fs::write(&nested, b"nested").expect("nested fixture should be written");

        let started = operation::start_copy(
            None,
            vec![fixture.root.join("folder").to_string_lossy().into_owned()],
            target.to_string_lossy().into_owned(),
            ConflictDecision::Skip,
        )
        .expect("copy should start");

        assert_eq!(started.kind, OperationKind::Copy);
        assert_eq!(started.state, OperationState::Queued);
        assert_eq!(
            fs::read(target.join("folder/nested.txt")).expect("copied file should exist"),
            b"nested"
        );
    }

    #[test]
    fn start_copy_applies_conflict_skip_and_overwrite_policies() {
        let fixture = TempFixture::new();
        let target = fixture.root.join("copy-conflict-target");
        fs::create_dir_all(&target).expect("target directory should be created");
        fs::write(target.join("alpha.txt"), b"old").expect("conflict target should be written");

        operation::start_copy(
            None,
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            target.to_string_lossy().into_owned(),
            ConflictDecision::Skip,
        )
        .expect("copy skip should start");
        assert_eq!(
            fs::read(target.join("alpha.txt")).expect("target should remain"),
            b"old"
        );

        operation::start_copy(
            None,
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            target.to_string_lossy().into_owned(),
            ConflictDecision::Overwrite,
        )
        .expect("copy overwrite should start");
        assert_eq!(
            fs::read(target.join("alpha.txt")).expect("target should be overwritten"),
            b"hello"
        );
    }

    #[test]
    fn start_copy_can_cancel_before_copying_work() {
        let fixture = TempFixture::new();
        let target = fixture.root.join("cancel-target");
        fs::create_dir_all(&target).expect("target directory should be created");

        let summary = operation::start_copy_cancel_after_for_test(
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            target.to_string_lossy().into_owned(),
            ConflictDecision::Overwrite,
            0,
        );

        assert_eq!(summary.state, OperationState::Cancelled);
        assert!(!target.join("alpha.txt").exists());
    }

    #[test]
    fn start_move_renames_to_target_directory() {
        let fixture = TempFixture::new();
        let target = fixture.root.join("move-target");
        fs::create_dir_all(&target).expect("target directory should be created");
        let source = fixture.root.join("alpha.txt");

        let started = operation::start_move(
            None,
            vec![source.to_string_lossy().into_owned()],
            target.to_string_lossy().into_owned(),
            ConflictDecision::Skip,
        )
        .expect("move should start");

        assert_eq!(started.kind, OperationKind::Move);
        assert!(!source.exists());
        assert_eq!(
            fs::read(target.join("alpha.txt")).expect("moved file should exist"),
            b"hello"
        );
    }

    #[test]
    fn start_copy_to_same_directory_overwrite_is_noop_not_delete() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        operation::start_copy(
            None,
            vec![source.to_string_lossy().into_owned()],
            fixture.root.to_string_lossy().into_owned(),
            ConflictDecision::Overwrite,
        )
        .expect("same-directory copy should be accepted as no-op");

        assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
    }

    #[test]
    fn start_copy_to_same_directory_all_overwrite_is_noop_not_delete() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        operation::start_copy(
            None,
            vec![source.to_string_lossy().into_owned()],
            fixture.root.to_string_lossy().into_owned(),
            ConflictDecision::AllOverwrite,
        )
        .expect("same-directory copy should be accepted as no-op");

        assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
    }
    #[test]
    fn start_move_to_same_directory_overwrite_is_noop_not_delete() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        operation::start_move(
            None,
            vec![source.to_string_lossy().into_owned()],
            fixture.root.to_string_lossy().into_owned(),
            ConflictDecision::Overwrite,
        )
        .expect("same-directory move should be accepted as no-op");

        assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
    }

    #[test]
    fn start_move_to_same_directory_all_overwrite_is_noop_not_delete() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        operation::start_move(
            None,
            vec![source.to_string_lossy().into_owned()],
            fixture.root.to_string_lossy().into_owned(),
            ConflictDecision::AllOverwrite,
        )
        .expect("same-directory move should be accepted as no-op");

        assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
    }
    #[test]
    fn start_delete_requires_confirm_token_for_permanent_delete() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        let error = operation::start_delete(
            None,
            vec![source.to_string_lossy().into_owned()],
            DeleteMode::Permanent,
            None,
        )
        .expect_err("permanent delete should require confirmation token");

        assert_eq!(error.code, "confirmation_required");
        assert!(source.exists());
    }

    #[test]
    fn start_delete_permanently_removes_confirmed_targets() {
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");

        let started = operation::start_delete(
            None,
            vec![source.to_string_lossy().into_owned()],
            DeleteMode::Permanent,
            Some("PERMANENT_DELETE"),
        )
        .expect("confirmed permanent delete should start");

        assert_eq!(started.kind, OperationKind::Delete);
        assert!(!source.exists());
    }

    #[test]
    fn start_delete_trash_moves_without_permanent_fallback() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        let trash_dir = fixture.root.join("trash-fixture");
        fs::create_dir_all(&trash_dir).expect("trash fixture should be created");
        env::set_var("BOKSLDIRGUI_TRASH_DIR", &trash_dir);
        let source = fixture.root.join("alpha.txt");

        let started = operation::start_delete(
            None,
            vec![source.to_string_lossy().into_owned()],
            DeleteMode::Trash,
            None,
        )
        .expect("trash delete should start");
        env::remove_var("BOKSLDIRGUI_TRASH_DIR");

        assert_eq!(started.kind, OperationKind::Trash);
        assert!(!source.exists());
        assert!(fs::read_dir(&trash_dir)
            .expect("trash dir should be readable")
            .flatten()
            .any(|entry| entry.file_name().to_string_lossy().contains("alpha.txt")));
    }

    #[test]
    fn start_delete_trash_failure_keeps_source_without_permanent_fallback() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        let invalid_trash = fixture.root.join("not-a-trash-directory");
        fs::write(&invalid_trash, b"file blocks trash directory")
            .expect("blocking file should be written");
        env::set_var("BOKSLDIRGUI_TRASH_DIR", &invalid_trash);
        let source = fixture.root.join("alpha.txt");

        let started = operation::start_delete(
            None,
            vec![source.to_string_lossy().into_owned()],
            DeleteMode::Trash,
            None,
        )
        .expect("trash operation should be accepted and report failure by summary event");
        env::remove_var("BOKSLDIRGUI_TRASH_DIR");

        assert_eq!(started.kind, OperationKind::Trash);
        assert!(
            source.exists(),
            "trash failure must not fall back to permanent deletion"
        );
    }
    #[test]
    fn delete_guard_rejects_protected_root_path() {
        let error = operation::start_delete(
            None,
            vec!["/".to_string()],
            DeleteMode::Permanent,
            Some("PERMANENT_DELETE"),
        )
        .expect_err("root delete should be rejected");

        assert_eq!(error.code, "invalid_path");
    }

    #[test]
    fn delete_guard_rejects_platform_protected_paths() {
        for protected in ["/System", "/bin", "/usr", "/Users"] {
            let error = operation::guard_delete_target(Path::new(protected))
                .expect_err("protected OS path should be rejected");
            assert_eq!(error.code, "invalid_path");
        }
    }

    #[test]
    fn resolve_conflict_feeds_backend_wait_channel() {
        let resolved =
            operation::conflict_decision_after_resolve_for_test(ConflictDecision::Overwrite);
        assert_eq!(resolved, ConflictDecision::Overwrite);
    }
    #[test]
    fn cross_device_error_detection_supports_move_fallback_policy() {
        let error = io::Error::from_raw_os_error(18);
        assert!(operation::is_cross_device_error(&error));
    }

    #[test]
    fn load_and_save_settings_persist_bookmarks_and_layout() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        let settings_path = fixture.root.join("settings/settings.json");
        env::set_var("BOKSLDIRGUI_SETTINGS_PATH", &settings_path);

        let initial = load_settings().expect("missing settings should use defaults");
        assert_eq!(initial.schema_version, 1);
        assert_eq!(initial.layout.ratio, "50:50");
        assert_eq!(initial.view.zoom_step, 0);

        let saved = save_settings(serde_json::json!({
            "bookmarks": [{ "id": "root", "label": "Root", "path": fixture.root.to_string_lossy() }],
            "layout": { "singlePanel": true, "ratio": "70:30" },
            "session": { "leftPath": fixture.root.to_string_lossy(), "rightPath": fixture.root.to_string_lossy(), "activePanel": "left" },
            "view": { "zoomStep": 2, "density": "compact", "showIcons": false },
            "theme": "highContrast",
            "language": "en",
            "external": { "editorId": "vim", "shellCommand": { "enabled": true } }
        }))
        .expect("settings patch should be saved");
        assert_eq!(saved.bookmarks[0].label, "Root");
        assert!(saved.layout.single_panel);
        assert_eq!(saved.layout.ratio, "70:30");
        assert_eq!(saved.view.zoom_step, 2);
        assert!(!saved.view.show_icons);
        assert_eq!(saved.external.editor_id.as_deref(), Some("vim"));
        assert!(saved.external.shell_command.enabled);
        assert_eq!(saved.session.active_panel, PanelId::Left);
        assert_eq!(
            saved.session.left_path.as_deref(),
            Some(fixture.root.to_string_lossy().as_ref())
        );
        assert!(settings_path.is_file());

        let locations = list_locations().expect("locations should load bookmark settings");
        assert!(locations
            .bookmarks
            .iter()
            .any(|bookmark| bookmark.id == "root"));

        env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
    }

    #[test]
    fn save_settings_rejects_invalid_layout_ratio() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        env::set_var(
            "BOKSLDIRGUI_SETTINGS_PATH",
            fixture.root.join("settings.json"),
        );

        let error = save_settings(serde_json::json!({
            "layout": { "singlePanel": false, "ratio": "90:10" }
        }))
        .expect_err("invalid layout ratio should fail");

        env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
        assert_eq!(error.code, "invalid_settings");
        assert_eq!(
            error
                .details
                .and_then(|details| details.get("field").cloned()),
            Some("layout.ratio".to_string())
        );
    }

    #[test]
    fn shell_command_is_disabled_by_default_and_uses_one_shot_tokens_when_enabled() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        shell_command::reset_clock_for_test();
        env::set_var(
            "BOKSLDIRGUI_SETTINGS_PATH",
            fixture.root.join("settings.json"),
        );

        let disabled = prepare_shell_command(
            fixture.root.to_string_lossy().into_owned(),
            "echo".to_string(),
            Some(vec!["hello".to_string()]),
        )
        .expect("disabled shell preview should be returned");
        assert!(!disabled.policy.enabled);
        assert_eq!(disabled.confirm_token, "disabled");

        save_settings(serde_json::json!({
            "external": { "shellCommand": { "enabled": true } }
        }))
        .expect("shell command setting should be enabled for test");
        let preview = prepare_shell_command(
            fixture.root.to_string_lossy().into_owned(),
            "echo".to_string(),
            Some(vec!["hello".to_string()]),
        )
        .expect("enabled shell preview should issue token");
        assert!(preview.policy.enabled);
        let result = run_shell_command(
            fixture.root.to_string_lossy().into_owned(),
            "echo".to_string(),
            Some(vec!["hello".to_string()]),
            preview.confirm_token.clone(),
        )
        .expect("tokenized shell command should run");
        assert_eq!(result.exit_code, Some(0));
        assert_eq!(result.stdout.trim(), "hello");

        let reused = run_shell_command(
            fixture.root.to_string_lossy().into_owned(),
            "echo".to_string(),
            Some(vec!["hello".to_string()]),
            preview.confirm_token,
        )
        .expect_err("shell confirm token must be one-shot");
        env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
        assert_eq!(reused.code, "invalid_token");
        shell_command::reset_clock_for_test();
    }

    #[test]
    fn shell_command_confirm_token_expires_after_ttl() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        shell_command::reset_clock_for_test();
        env::set_var(
            "BOKSLDIRGUI_SETTINGS_PATH",
            fixture.root.join("settings.json"),
        );
        save_settings(serde_json::json!({
            "external": { "shellCommand": { "enabled": true } }
        }))
        .expect("shell command setting should be enabled for ttl test");

        let preview = prepare_shell_command(
            fixture.root.to_string_lossy().into_owned(),
            "echo".to_string(),
            Some(vec!["expired".to_string()]),
        )
        .expect("enabled shell preview should issue token");

        shell_command::advance_clock_past_token_ttl_for_test();
        let expired = run_shell_command(
            fixture.root.to_string_lossy().into_owned(),
            "echo".to_string(),
            Some(vec!["expired".to_string()]),
            preview.confirm_token,
        )
        .expect_err("expired shell confirm token must be rejected");

        shell_command::reset_clock_for_test();
        env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
        assert_eq!(expired.code, "invalid_token");
        assert_eq!(expired.message_key, "errors.confirmationRequired");
        assert!(expired
            .details
            .and_then(|details| details.get("expiresAt").cloned())
            .is_some());
    }

    #[test]
    fn external_open_commands_support_dry_run_and_editor_policy() {
        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        let source = fixture.root.join("alpha.txt");
        env::set_var(
            "BOKSLDIRGUI_SETTINGS_PATH",
            fixture.root.join("settings.json"),
        );
        env::set_var("BOKSLDIRGUI_EXTERNAL_DRY_RUN", "1");

        let opened = open_default(source.to_string_lossy().into_owned())
            .expect("dry-run default open should succeed");
        assert_eq!(opened.message_key, Some("external.dryRun".to_string()));
        let revealed = reveal_in_manager(source.to_string_lossy().into_owned())
            .expect("dry-run reveal should succeed");
        assert!(revealed.ok);

        let missing_editor = open_external_editor(source.to_string_lossy().into_owned(), None)
            .expect_err("external editor requires configured editor");
        assert_eq!(
            missing_editor.message_key,
            "errors.externalEditorNotConfigured"
        );
        let editor = open_external_editor(
            source.to_string_lossy().into_owned(),
            Some("fake-editor".to_string()),
        )
        .expect("explicit editor id should pass dry-run");
        assert!(editor.ok);

        env::remove_var("BOKSLDIRGUI_EXTERNAL_DRY_RUN");
        env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
    }

    #[test]
    fn archive_zip_create_list_extract_round_trip_uses_relative_entry_names() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        if !command_available("zip") || !command_available("unzip") {
            return;
        }
        let fixture = TempFixture::new();
        fs::write(fixture.root.join("folder").join("beta.txt"), b"nested")
            .expect("nested archive fixture should be written");
        let korean_dir = fixture.root.join("한글 폴더");
        fs::create_dir_all(&korean_dir).expect("Korean archive directory should be created");
        fs::write(korean_dir.join("메모.md"), b"korean path")
            .expect("Korean archive fixture should be written");
        let archive_path = fixture.root.join("round-trip.zip");
        let extract_dir = fixture.root.join("extract");
        let partial_extract_dir = fixture.root.join("partial-extract");
        fs::create_dir_all(&extract_dir).expect("extract directory should be created");
        fs::create_dir_all(&partial_extract_dir).expect("partial extract directory should exist");

        let created = operation::start_archive_create(
            None,
            vec![
                fixture
                    .root
                    .join("alpha.txt")
                    .to_string_lossy()
                    .into_owned(),
                fixture.root.join("folder").to_string_lossy().into_owned(),
                korean_dir.to_string_lossy().into_owned(),
            ],
            archive_path.to_string_lossy().into_owned(),
            "zip".to_string(),
            None,
        )
        .expect("archive create should start");
        assert_eq!(created.kind, OperationKind::ArchiveCreate);
        assert!(archive_path.is_file());

        let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
            .expect("zip listing should succeed");
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "alpha.txt"));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path.ends_with("!한글 폴더/메모.md")));
        assert!(listing
            .entries
            .iter()
            .all(|entry| !entry.name.contains('�')));
        assert!(!listing
            .entries
            .iter()
            .any(|entry| entry.name.contains("boksldir-gui-navigation")));

        let added_file = fixture.root.join("added.txt");
        fs::write(&added_file, b"first").expect("archive add fixture should be written");
        let added_dir = fixture.root.join("added-dir");
        fs::create_dir_all(&added_dir).expect("archive add directory should be created");
        fs::write(added_dir.join("nested.txt"), b"added nested")
            .expect("nested archive add fixture should be written");
        let added = operation::start_archive_add(
            None,
            vec![
                added_file.to_string_lossy().into_owned(),
                added_dir.to_string_lossy().into_owned(),
            ],
            archive_path.to_string_lossy().into_owned(),
            "folder".to_string(),
            ConflictDecision::Overwrite,
        )
        .expect("archive add should start");
        assert_eq!(added.kind, OperationKind::ArchiveAdd);
        let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
            .expect("updated zip listing should succeed");
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path.ends_with("!folder/added.txt")));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path.ends_with("!folder/added-dir/nested.txt")));

        fs::write(&added_file, b"second").expect("archive conflict fixture should be updated");
        operation::start_archive_add(
            None,
            vec![added_file.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "folder".to_string(),
            ConflictDecision::Skip,
        )
        .expect("archive add skip should start");
        operation::start_archive_add(
            None,
            vec![added_file.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "folder".to_string(),
            ConflictDecision::AllSkip,
        )
        .expect("archive add all-skip should start");

        let extracted = operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            None,
            None,
        )
        .expect("archive extract should start");
        assert_eq!(extracted.kind, OperationKind::ArchiveExtract);
        assert_eq!(
            fs::read(extract_dir.join("alpha.txt")).expect("extracted file should exist"),
            b"hello"
        );
        assert_eq!(
            fs::read(extract_dir.join("folder").join("beta.txt"))
                .expect("nested extracted file should exist"),
            b"nested"
        );
        assert_eq!(
            fs::read(extract_dir.join("한글 폴더").join("메모.md"))
                .expect("Korean extracted file should exist"),
            b"korean path"
        );
        assert_eq!(
            fs::read(extract_dir.join("folder").join("added.txt"))
                .expect("archive-added file should be extracted"),
            b"first",
            "skip must preserve the existing archive entry"
        );
        assert_eq!(
            fs::read(
                extract_dir
                    .join("folder")
                    .join("added-dir")
                    .join("nested.txt")
            )
            .expect("archive-added directory should be extracted"),
            b"added nested"
        );

        operation::start_archive_add(
            None,
            vec![added_file.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "folder".to_string(),
            ConflictDecision::AllOverwrite,
        )
        .expect("archive add all-overwrite should start");
        let overwrite_extract_dir = fixture.root.join("overwrite-extract");
        fs::create_dir_all(&overwrite_extract_dir)
            .expect("overwrite extract directory should exist");
        operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            overwrite_extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            Some(vec!["folder/added.txt".to_string()]),
            Some("folder".to_string()),
        )
        .expect("overwritten archive entry should extract");
        assert_eq!(
            fs::read(overwrite_extract_dir.join("added.txt"))
                .expect("overwritten archive entry should exist"),
            b"second"
        );

        fs::write(&added_file, b"cancelled").expect("archive cancel fixture should be updated");
        operation::start_archive_add(
            None,
            vec![added_file.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "folder".to_string(),
            ConflictDecision::Cancel,
        )
        .expect("archive add cancel should start");
        let cancel_extract_dir = fixture.root.join("cancel-extract");
        fs::create_dir_all(&cancel_extract_dir).expect("cancel extract directory should exist");
        operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            cancel_extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            Some(vec!["folder/added.txt".to_string()]),
            Some("folder".to_string()),
        )
        .expect("entry should still extract after cancelled overwrite");
        assert_eq!(
            fs::read(cancel_extract_dir.join("added.txt"))
                .expect("cancelled overwrite must preserve existing entry"),
            b"second"
        );

        operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            partial_extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            Some(vec!["folder/beta.txt".to_string()]),
            Some("folder".to_string()),
        )
        .expect("partial archive extract should start");
        assert_eq!(
            fs::read(partial_extract_dir.join("beta.txt"))
                .expect("partial extract should strip current archive folder prefix"),
            b"nested"
        );
        assert!(
            !partial_extract_dir.join("folder").exists(),
            "copying from inside archive folder should not recreate the current folder prefix"
        );
        operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            partial_extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            Some(vec!["한글 폴더/메모.md".to_string()]),
            Some("한글 폴더".to_string()),
        )
        .expect("Korean entry should extract by its displayed name");
        assert_eq!(
            fs::read(partial_extract_dir.join("메모.md"))
                .expect("selected Korean entry should exist"),
            b"korean path"
        );
    }

    #[test]
    fn archive_required_formats_create_list_and_extract_round_trip() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        if !command_available("zip") || !command_available("unzip") || !command_available("tar") {
            return;
        }
        for (suffix, format) in [
            ("jar", "jar"),
            ("war", "war"),
            ("tar", "tar"),
            ("tar.gz", "tar.gz"),
            ("tgz", "tar.gz"),
            ("tar.zst", "tar.zst"),
            ("tzst", "tar.zst"),
        ] {
            let fixture = TempFixture::new();
            let archive_path = fixture.root.join(format!("required-format.{suffix}"));
            let extract_dir = fixture.root.join("extract-required-format");
            fs::create_dir_all(&extract_dir).expect("format extract directory should exist");
            let created = operation::start_archive_create(
                None,
                vec![fixture
                    .root
                    .join("alpha.txt")
                    .to_string_lossy()
                    .into_owned()],
                archive_path.to_string_lossy().into_owned(),
                format.to_string(),
                None,
            )
            .expect("required archive format create should start");
            assert_eq!(created.kind, OperationKind::ArchiveCreate);
            assert!(archive_path.is_file(), "{suffix} archive should be created");

            let listing =
                archive_list(archive_path.to_string_lossy().into_owned(), None, Some(100))
                    .expect("required archive format listing should succeed");
            assert!(listing
                .entries
                .iter()
                .any(|entry| entry.name == "alpha.txt"));
            assert!(!listing.truncated);

            operation::start_archive_extract(
                None,
                archive_path.to_string_lossy().into_owned(),
                extract_dir.to_string_lossy().into_owned(),
                None,
                ConflictDecision::Overwrite,
                None,
                None,
            )
            .expect("required archive format extract should start");
            assert_eq!(
                fs::read(extract_dir.join("alpha.txt"))
                    .expect("required archive format should extract alpha.txt"),
                b"hello",
                "{suffix} round trip should preserve content"
            );
        }
    }

    #[test]
    fn archive_listing_limit_reports_truncation() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        if !command_available("zip") || !command_available("unzip") {
            return;
        }
        let fixture = TempFixture::new();
        let source_dir = fixture.root.join("large-listing");
        fs::create_dir_all(&source_dir).expect("large listing directory should exist");
        for index in 0..120 {
            fs::write(source_dir.join(format!("entry-{index:03}.txt")), b"x")
                .expect("large listing entry should be written");
        }
        let archive_path = fixture.root.join("large-listing.zip");
        operation::start_archive_create(
            None,
            vec![source_dir.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "zip".to_string(),
            None,
        )
        .expect("large listing archive create should start");
        let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, Some(25))
            .expect("limited archive listing should succeed");
        assert_eq!(listing.entries.len(), 25);
        assert!(listing.total_entries >= 120);
        assert!(listing.truncated);
    }

    #[test]
    fn archive_password_round_trip_and_unsafe_entry_guards() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        let fixture = TempFixture::new();
        if !command_available("zip") || !command_available("unzip") {
            return;
        }
        let secret_archive = fixture.root.join("secret.zip");
        let password_summary = operation::archive_create_summary_for_test(
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            secret_archive.to_string_lossy().into_owned(),
            "zip".to_string(),
            Some("secret".to_string()),
        );
        assert_eq!(password_summary.kind, OperationKind::ArchiveCreate);
        assert_eq!(password_summary.state, OperationState::Completed);
        let listing = archive_list(
            secret_archive.to_string_lossy().into_owned(),
            Some("secret".to_string()),
            Some(100),
        )
        .expect("password-protected zip listing should succeed");
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "alpha.txt"));

        let wrong_target = fixture.root.join("wrong-password-extract");
        fs::create_dir_all(&wrong_target).expect("wrong-password target should exist");
        let wrong_password = operation::archive_extract_summary_for_test(
            secret_archive.to_string_lossy().into_owned(),
            wrong_target.to_string_lossy().into_owned(),
            Some("not-the-password".to_string()),
            ConflictDecision::Overwrite,
        );
        assert_eq!(wrong_password.state, OperationState::Failed);
        let serialized_wrong = serde_json::to_string(&wrong_password)
            .expect("wrong-password summary should serialize");
        assert!(!serialized_wrong.contains("not-the-password"));

        let correct_target = fixture.root.join("correct-password-extract");
        fs::create_dir_all(&correct_target).expect("correct-password target should exist");
        let correct_password = operation::archive_extract_summary_for_test(
            secret_archive.to_string_lossy().into_owned(),
            correct_target.to_string_lossy().into_owned(),
            Some("secret".to_string()),
            ConflictDecision::Overwrite,
        );
        assert_eq!(correct_password.state, OperationState::Completed);
        assert_eq!(
            fs::read(correct_target.join("alpha.txt"))
                .expect("password-protected zip should extract"),
            b"hello"
        );

        assert!(operation::archive_entry_is_unsafe_for_test("../escape.txt"));
        assert!(operation::archive_entry_is_unsafe_for_test("/absolute.txt"));
        assert!(operation::archive_entry_is_unsafe_for_test(
            "C:\\absolute.txt"
        ));
        assert!(operation::archive_entry_is_unsafe_for_test(
            "\\absolute.txt"
        ));
        assert!(operation::archive_entry_is_unsafe_for_test(
            "safe\0hidden.txt"
        ));
        assert!(!operation::archive_entry_is_unsafe_for_test(
            "safe/entry.txt"
        ));

        let archive = fixture.root.join("unsafe-target.zip");
        File::create(&archive).expect("unsafe target archive fixture should exist");
        let unsafe_add = operation::archive_add_summary_for_test(
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            archive.to_string_lossy().into_owned(),
            "../escape".to_string(),
            ConflictDecision::Overwrite,
        );
        assert_eq!(unsafe_add.kind, OperationKind::ArchiveAdd);
        assert_eq!(unsafe_add.state, OperationState::Failed);
        assert_eq!(unsafe_add.errors[0].message_key, "errors.archiveUnsafePath");
    }

    #[test]
    fn external_archive_provider_is_killed_when_operation_is_cancelled() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        let Some((result, elapsed)) = operation::external_archive_command_cancel_for_test() else {
            return;
        };
        let error = result.expect_err("cancelled external provider should return cancellation");
        assert_eq!(error.code, "operation_cancelled");
        assert!(
            elapsed < Duration::from_secs(5),
            "cancel should kill the external provider promptly, elapsed={elapsed:?}"
        );
    }

    #[test]
    #[cfg(unix)]
    fn archive_extract_preflight_listing_provider_is_killed_when_cancelled() {
        use std::os::unix::fs::PermissionsExt;

        let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
        let fixture = TempFixture::new();
        let listing_provider = if cfg!(target_os = "macos") { "tar" } else { "unzip" };
        let fake_provider = fixture.root.join(listing_provider);
        fs::write(&fake_provider, "#!/bin/sh\nwhile :; do :; done\n")
            .expect("fake archive listing provider should be written");
        let mut permissions = fs::metadata(&fake_provider)
            .expect("fake archive listing metadata should exist")
            .permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(&fake_provider, permissions)
            .expect("fake archive listing provider should be executable");
        let archive = fixture.root.join("blocked.zip");
        File::create(&archive).expect("blocked archive fixture should be created");
        let old_path = env::var_os("PATH");
        let next_path = match old_path.as_ref() {
            Some(path) => format!(
                "{}:{}",
                fixture.root.to_string_lossy(),
                path.to_string_lossy()
            ),
            None => fixture.root.to_string_lossy().into_owned(),
        };
        env::set_var("PATH", next_path);

        let (result, elapsed) = operation::archive_entry_listing_cancel_for_test(archive);

        match old_path {
            Some(path) => env::set_var("PATH", path),
            None => env::remove_var("PATH"),
        }
        let error = result.expect_err("cancelled archive listing should return cancellation");
        assert_eq!(error.code, "operation_cancelled");
        assert!(
            elapsed < Duration::from_secs(5),
            "cancel should kill the archive listing provider promptly, elapsed={elapsed:?}"
        );
    }

    #[test]
    fn archive_7z_slt_parser_preserves_spaces_and_unsafe_paths() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        let paths = archive::parse_7z_slt_paths_for_test(
            b"Path = fixture.7z\nType = 7z\n----------\nPath = dir/my file.txt\nSize = 5\nPath = ../escape file.txt\nSize = 1\n",
        );

        assert_eq!(
            paths,
            vec![
                "dir/my file.txt".to_string(),
                "../escape file.txt".to_string()
            ]
        );
        assert!(!operation::archive_entry_is_unsafe_for_test(&paths[0]));
        assert!(operation::archive_entry_is_unsafe_for_test(&paths[1]));
    }

    #[test]
    fn archive_listing_parsers_keep_file_metadata_when_available() {
        let names = vec![
            "alpha.txt".to_string(),
            "dir/".to_string(),
            "dir/beta space.txt".to_string(),
        ];
        let zip_entries = archive::parse_zipinfo_long_output_for_test(
            b"Archive: fixture.zip\n-rw-r--r--  3.0 unx        5 tx        5 stor 20260702.233028 alpha.txt\ndrwxr-xr-x  3.0 unx        0 bx        0 stor 20260702.233029 dir/\n-rw-r--r--  3.0 unx       10 tx       10 stor 20260702.233030 dir/beta space.txt\n",
            &names,
        );
        assert_eq!(zip_entries[0].name, "alpha.txt");
        assert_eq!(zip_entries[0].size_bytes, Some(5));
        assert_eq!(
            zip_entries[0].modified_at.as_deref(),
            Some("2026-07-02T23:30:28")
        );
        assert_eq!(zip_entries[0].permissions.as_deref(), Some("-rw-r--r--"));
        assert_eq!(zip_entries[1].kind, EntryKind::Directory);
        assert_eq!(zip_entries[2].path, "/tmp/archive.zip!dir/beta space.txt");
        assert_eq!(zip_entries[2].size_bytes, Some(10));

        let seven_zip_entries = archive::parse_7z_slt_entries_for_test(
            b"Path = fixture.7z\nType = 7z\n----------\nPath = dir/my file.txt\nSize = 5\nModified = 2026-07-02 23:30:28\nCreated = 2026-07-02 23:00:01\nAttributes = A -rw-r--r--\nFolder = -\nPath = dir\nModified = 2026-07-02 23:30:29\nAttributes = D drwxr-xr-x\nFolder = +\n",
        );
        assert_eq!(seven_zip_entries[0].name, "my file.txt");
        assert_eq!(seven_zip_entries[0].size_bytes, Some(5));
        assert_eq!(
            seven_zip_entries[0].modified_at.as_deref(),
            Some("2026-07-02T23:30:28")
        );
        assert_eq!(
            seven_zip_entries[0].created_at.as_deref(),
            Some("2026-07-02T23:00:01")
        );
        assert_eq!(
            seven_zip_entries[0].permissions.as_deref(),
            Some("-rw-r--r--")
        );
        assert_eq!(seven_zip_entries[1].kind, EntryKind::Directory);
        assert_eq!(
            seven_zip_entries[1].permissions.as_deref(),
            Some("drwxr-xr-x")
        );
    }

    #[test]
    fn archive_7z_provider_lists_real_fixture_when_available() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        let Some(binary) = archive::seven_zip_binary_for_test() else {
            return;
        };
        let fixture = TempFixture::new();
        fs::write(fixture.root.join("space name.txt"), b"space")
            .expect("space-name fixture should be written");
        let archive_path = fixture.root.join("provider-fixture.7z");
        let output = Command::new(binary)
            .args([
                "a",
                "-bd",
                "provider-fixture.7z",
                "alpha.txt",
                "space name.txt",
            ])
            .current_dir(&fixture.root)
            .output()
            .expect("7z provider should be executable");
        assert!(
            output.status.success(),
            "7z provider should create fixture: {}",
            String::from_utf8_lossy(&output.stderr)
        );

        let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
            .expect("7z listing should succeed when provider is available");
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "alpha.txt"));
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "space name.txt"));

        let added = fixture.root.join("added-7z.txt");
        fs::write(&added, b"first").expect("7z add fixture should be written");
        operation::start_archive_add(
            None,
            vec![added.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "nested".to_string(),
            ConflictDecision::Overwrite,
        )
        .expect("7z archive add should start");
        let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
            .expect("updated 7z listing should succeed");
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.path.ends_with("!nested/added-7z.txt")));

        fs::write(&added, b"second").expect("7z conflict fixture should be updated");
        operation::start_archive_add(
            None,
            vec![added.to_string_lossy().into_owned()],
            archive_path.to_string_lossy().into_owned(),
            "nested".to_string(),
            ConflictDecision::Overwrite,
        )
        .expect("7z archive overwrite should start");
        let extract_dir = fixture.root.join("7z-add-extract");
        fs::create_dir_all(&extract_dir).expect("7z extract directory should exist");
        operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            Some(vec!["nested/added-7z.txt".to_string()]),
            Some("nested".to_string()),
        )
        .expect("7z archive-added entry should extract");
        assert_eq!(
            fs::read(extract_dir.join("added-7z.txt")).expect("overwritten 7z entry should exist"),
            b"second"
        );
    }

    #[test]
    fn archive_7z_password_and_large_listing_when_provider_is_available() {
        let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
        let Some(_binary) = archive::seven_zip_binary_for_test() else {
            return;
        };
        let fixture = TempFixture::new();
        let large_source = fixture.root.join("large-7z-listing");
        fs::create_dir_all(&large_source).expect("large 7z source should exist");
        for index in 0..120 {
            fs::write(large_source.join(format!("entry-{index:03}.txt")), b"x")
                .expect("large 7z entry should be written");
        }
        let large_archive = fixture.root.join("large-listing.7z");
        let large_summary = operation::archive_create_summary_for_test(
            vec![large_source.to_string_lossy().into_owned()],
            large_archive.to_string_lossy().into_owned(),
            "7z".to_string(),
            None,
        );
        assert_eq!(large_summary.state, OperationState::Completed);
        let limited = archive_list(
            large_archive.to_string_lossy().into_owned(),
            None,
            Some(25),
        )
        .expect("limited 7z listing should succeed");
        assert_eq!(limited.entries.len(), 25);
        assert!(limited.total_entries >= 120);
        assert!(limited.truncated);

        let encrypted_archive = fixture.root.join("encrypted.7z");
        let encrypted_summary = operation::archive_create_summary_for_test(
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            encrypted_archive.to_string_lossy().into_owned(),
            "7z".to_string(),
            Some("seven-secret".to_string()),
        );
        assert_eq!(encrypted_summary.state, OperationState::Completed);
        assert!(!serde_json::to_string(&encrypted_summary)
            .expect("encrypted summary should serialize")
            .contains("seven-secret"));

        let wrong = archive_list(
            encrypted_archive.to_string_lossy().into_owned(),
            Some("wrong-seven-secret".to_string()),
            Some(100),
        )
        .expect_err("wrong 7z password should fail");
        assert_eq!(wrong.code, "invalid_password");
        assert!(!serde_json::to_string(&wrong)
            .expect("password error should serialize")
            .contains("wrong-seven-secret"));

        let listing = archive_list(
            encrypted_archive.to_string_lossy().into_owned(),
            Some("seven-secret".to_string()),
            Some(100),
        )
        .expect("encrypted 7z listing should succeed with the password");
        assert!(listing.encrypted);
        assert!(listing.entries.iter().any(|entry| entry.name == "alpha.txt"));

        let extract_dir = fixture.root.join("encrypted-7z-extract");
        fs::create_dir_all(&extract_dir).expect("encrypted 7z target should exist");
        let extracted = operation::archive_extract_summary_for_test(
            encrypted_archive.to_string_lossy().into_owned(),
            extract_dir.to_string_lossy().into_owned(),
            Some("seven-secret".to_string()),
            ConflictDecision::Overwrite,
        );
        assert_eq!(extracted.state, OperationState::Completed);
        assert_eq!(
            fs::read(extract_dir.join("alpha.txt")).expect("encrypted 7z file should extract"),
            b"hello"
        );
    }

    fn command_available(command: &str) -> bool {
        Command::new(command).arg("--help").output().is_ok()
    }
}

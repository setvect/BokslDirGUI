use crate::archive;
use crate::contracts::{
    ActionResult, AppError, ArchiveListing, CancelAck, CommandResult, ConflictAck,
    ConflictDecision, DeleteMode, DirectoryListing, FileEntry, FileMetadata, FilePreview,
    LocationList, OpenWithApp, OperationStarted, PanelId, Settings, ShellCommandPreview,
    SortSpec, WatchAck,
};
use crate::external;
use crate::mutation;
use crate::navigation;
use crate::operation;
use crate::settings_service;
use crate::shell_command;
use std::path::PathBuf;
use tauri::Manager;

#[tauri::command]
pub(crate) fn get_platform_info() -> crate::contracts::PlatformInfo {
    crate::platform::info()
}

#[tauri::command]
pub(crate) fn health_check() -> &'static str {
    "ok"
}

#[tauri::command]
pub(crate) fn list_dir(
    panel_id: PanelId,
    path: String,
    show_hidden: bool,
    sort: SortSpec,
    filter: Option<String>,
) -> CommandResult<DirectoryListing> {
    navigation::list_dir(panel_id, &path, show_hidden, sort, filter)
}

/// 주소 입력 이동. `~`는 홈, 상대 경로는 `base`(활성 패널의 실제 디렉터리) 기준으로 해석(FR-26.4).
#[tauri::command]
pub(crate) fn goto_path(panel_id: PanelId, path: String, base: Option<String>) -> CommandResult<DirectoryListing> {
    let resolved = navigation::resolve_input_path(&path, base.as_deref())?;
    navigation::list_dir(panel_id, &resolved.to_string_lossy(), false, SortSpec::default(), None)
}

#[tauri::command]
pub(crate) async fn get_metadata(path: String) -> CommandResult<FileMetadata> {
    let failure_path = PathBuf::from(&path);
    tauri::async_runtime::spawn_blocking(move || navigation::get_metadata(&path))
        .await
        .map_err(|error| {
            AppError::new("io_error", "errors.io", Some(&failure_path), false)
                .with_detail("message", error.to_string())
        })?
}

#[tauri::command]
pub(crate) fn preview_file(path: String, max_bytes: Option<u64>) -> CommandResult<FilePreview> {
    crate::preview::preview_file(path, max_bytes)
}

#[tauri::command]
pub(crate) fn watch_path(app: tauri::AppHandle, panel_id: PanelId, path: String) -> CommandResult<WatchAck> {
    use tauri::Emitter;
    crate::watch_service::watch(panel_id, &path, move |changed| {
        let _ = app.emit(crate::watch_service::DIR_CHANGED_EVENT, changed);
    })
}

#[tauri::command]
pub(crate) fn unwatch_path(panel_id: PanelId) {
    crate::watch_service::unwatch(panel_id);
}

#[tauri::command]
pub(crate) fn list_locations() -> CommandResult<LocationList> {
    navigation::list_locations()
}

#[tauri::command]
pub(crate) fn create_dir(parent: String, name: String) -> CommandResult<FileEntry> {
    mutation::create_dir(&parent, &name)
}

#[tauri::command]
pub(crate) fn rename_entry(path: String, new_name: String) -> CommandResult<FileEntry> {
    mutation::rename_entry(&path, &new_name)
}

#[tauri::command]
pub(crate) fn start_copy(
    app: tauri::AppHandle,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    operation::start_copy(Some(&app), sources, target_dir, policy)
}

#[tauri::command]
pub(crate) fn start_move(
    app: tauri::AppHandle,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    operation::start_move(Some(&app), sources, target_dir, policy)
}

#[tauri::command]
pub(crate) fn start_delete(
    app: tauri::AppHandle,
    targets: Vec<String>,
    mode: DeleteMode,
    confirm_token: Option<String>,
) -> CommandResult<OperationStarted> {
    operation::start_delete(Some(&app), targets, mode, confirm_token.as_deref())
}

#[tauri::command]
pub(crate) fn cancel_operation(operation_id: String) -> CommandResult<CancelAck> {
    operation::cancel_operation(operation_id)
}

#[tauri::command]
pub(crate) fn resolve_conflict(
    operation_id: String,
    decision: ConflictDecision,
) -> CommandResult<ConflictAck> {
    operation::resolve_conflict(operation_id, decision)
}

#[tauri::command]
pub(crate) fn archive_list(
    archive_path: String,
    password: Option<String>,
    limit: Option<usize>,
) -> CommandResult<ArchiveListing> {
    archive::archive_list(&archive_path, password, limit)
}

#[tauri::command]
pub(crate) fn archive_create(
    app: tauri::AppHandle,
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> CommandResult<OperationStarted> {
    operation::start_archive_create(Some(&app), sources, target_archive, format, password)
}

#[tauri::command]
pub(crate) fn archive_extract(
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
pub(crate) fn archive_add(
    app: tauri::AppHandle,
    sources: Vec<String>,
    archive_path: String,
    target_inner_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    operation::start_archive_add(Some(&app), sources, archive_path, target_inner_dir, policy)
}

async fn run_external_service<T: Send + 'static>(
    action: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    tauri::async_runtime::spawn_blocking(action).await
        .map_err(|_| AppError::new("external_failed", "errors.externalCommandFailed", None, true))?
}

#[tauri::command]
pub(crate) async fn open_default(path: String) -> CommandResult<ActionResult> {
    run_external_service(move || external::open_default(&path)).await
}

#[tauri::command]
pub(crate) async fn list_open_with_apps(path: String) -> CommandResult<Vec<OpenWithApp>> {
    run_external_service(move || crate::open_with::list_apps(&path)).await
}

#[tauri::command]
pub(crate) async fn open_with_app(path: String, application_id: String) -> CommandResult<ActionResult> {
    run_external_service(move || crate::open_with::open(&path, &application_id)).await
}

#[tauri::command]
pub(crate) async fn reveal_in_manager(path: String) -> CommandResult<ActionResult> {
    run_external_service(move || external::reveal_in_manager(&path)).await
}

#[tauri::command]
pub(crate) async fn open_current_in_file_manager(path: String) -> CommandResult<ActionResult> {
    run_external_service(move || external::open_current_in_file_manager(&path)).await
}

#[tauri::command]
pub(crate) async fn open_current_in_terminal(path: String) -> CommandResult<ActionResult> {
    run_external_service(move || external::open_current_in_terminal(&path)).await
}

#[tauri::command]
pub(crate) fn prepare_shell_command(
    working_dir: String,
    command: String,
    args: Option<Vec<String>>,
) -> CommandResult<ShellCommandPreview> {
    shell_command::prepare_shell_command(&working_dir, &command, args.unwrap_or_default())
}

#[tauri::command]
pub(crate) fn run_shell_command(
    app: tauri::AppHandle,
    working_dir: String,
    command: String,
    args: Option<Vec<String>>,
    confirm_token: Option<String>,
) -> CommandResult<OperationStarted> {
    let (command, directory) = shell_command::confirmed_command(&working_dir, &command,
        args.unwrap_or_default(), confirm_token.as_deref())?;
    operation::start_shell_command(&app, command, directory)
}

#[tauri::command]
pub(crate) fn load_settings() -> CommandResult<Settings> {
    settings_service::load_settings()
}

#[tauri::command]
pub(crate) fn save_settings(patch: serde_json::Value) -> CommandResult<Settings> {
    settings_service::save_settings(patch)
}

#[tauri::command]
pub(crate) async fn prepare_native_file_drag(paths: Vec<String>) -> CommandResult<Vec<String>> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || crate::native_drop::prepare_paths(paths))
            .await.map_err(|error| AppError::new("io_error", "errors.io", None, false)
                .with_detail("message", error.to_string()))?
    }
    #[cfg(not(windows))]
    {
        let _ = paths;
        Err(AppError::new("unsupported", "errors.commandNotImplemented", None, true))
    }
}

#[tauri::command]
pub(crate) fn show_drop_overlay(app: tauri::AppHandle) -> Result<(), String> {
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
pub(crate) async fn read_file_clipboard(app: tauri::AppHandle, resolve: bool) -> CommandResult<crate::contracts::FileClipboard> {
    run_external_service(move || crate::file_clipboard::read(&app, resolve)).await
}
#[tauri::command]
pub(crate) async fn write_file_clipboard(app: tauri::AppHandle, paths: Vec<String>, intent: crate::contracts::ClipboardIntent) -> CommandResult<i64> {
    run_external_service(move || crate::file_clipboard::write(&app, paths, intent)).await
}
#[tauri::command]
pub(crate) async fn clear_file_clipboard(app: tauri::AppHandle, change_count: i64) -> CommandResult<()> {
    run_external_service(move || crate::file_clipboard::clear(&app, change_count)).await
}

#[tauri::command]
pub(crate) async fn preview_bulk_rename(sources: Vec<String>, rules: crate::contracts::RenameRules) -> CommandResult<Vec<crate::contracts::RenamePreview>> {
    tauri::async_runtime::spawn_blocking(move || crate::bulk_rename::preview(sources, rules))
        .await.map_err(|error| AppError::new("io_error", "errors.io", None, true).with_detail("message", error.to_string()))?
}
#[tauri::command]
pub(crate) async fn start_bulk_rename(app: tauri::AppHandle, items: Vec<crate::contracts::RenameItem>) -> CommandResult<OperationStarted> {
    tauri::async_runtime::spawn_blocking(move || operation::start_bulk_rename(Some(&app), items))
        .await.map_err(|error| AppError::new("io_error", "errors.io", None, true).with_detail("message", error.to_string()))?
}

#[tauri::command]
pub(crate) fn preview_trash_undo() -> Option<crate::contracts::TrashUndoPreview> {
    operation::preview_trash_undo()
}

#[tauri::command]
pub(crate) fn start_trash_undo(app: tauri::AppHandle, id: String) -> CommandResult<OperationStarted> {
    operation::start_trash_undo(Some(&app), id)
}

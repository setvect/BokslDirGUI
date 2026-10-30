use crate::contracts::{
    AppError, CommandResult, ConflictDecision, DeleteMode, OperationKind, OperationStarted,
    OperationState,
};

use super::archive_ops::{run_archive_add, run_archive_create, run_archive_extract};
use super::delete::run_delete;
use super::file_io::{collect_source_paths, guard_delete_target};
use super::runtime::{launch_operation, PERMANENT_DELETE_CONFIRM_TOKEN};
use super::transfer::{run_copy, run_move};

pub(crate) fn start_copy(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    launch_operation(app, OperationKind::Copy, Some(OperationState::Validating), move |app, operation_id| {
        match run_copy(app, operation_id, &sources, &target_dir, policy, None) {
            Ok(summary) | Err(summary) => summary,
        }
    })
}

pub(crate) fn start_move(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    launch_operation(app, OperationKind::Move, Some(OperationState::Validating), move |app, operation_id| {
        run_move(app, operation_id, &sources, &target_dir, policy)
    })
}

pub(crate) fn start_delete(
    app: Option<&tauri::AppHandle>,
    targets: Vec<String>,
    mode: DeleteMode,
    confirm_token: Option<&str>,
) -> CommandResult<OperationStarted> {
    if mode == DeleteMode::Permanent && confirm_token != Some(PERMANENT_DELETE_CONFIRM_TOKEN) {
        return Err(AppError::new(
            "confirmation_required",
            "errors.confirmationRequired",
            None,
            true,
        ));
    }
    let preflight_targets = collect_source_paths(&targets)?;
    for target in &preflight_targets {
        guard_delete_target(target)?;
    }
    let kind = if mode == DeleteMode::Trash {
        OperationKind::Trash
    } else {
        OperationKind::Delete
    };
    launch_operation(app, kind, Some(OperationState::Validating), move |app, operation_id| {
        run_delete(app, operation_id, &targets, mode)
    })
}

pub(crate) fn start_archive_create(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> CommandResult<OperationStarted> {
    launch_operation(app, OperationKind::ArchiveCreate, Some(OperationState::Validating), move |app, operation_id| {
        run_archive_create(app, operation_id, sources, target_archive, format, password)
    })
}

pub(crate) fn start_archive_extract(
    app: Option<&tauri::AppHandle>,
    archive_path: String,
    target_dir: String,
    password: Option<String>,
    policy: ConflictDecision,
    entries: Option<Vec<String>>,
    strip_prefix: Option<String>,
) -> CommandResult<OperationStarted> {
    launch_operation(app, OperationKind::ArchiveExtract, Some(OperationState::Validating), move |app, operation_id| {
        run_archive_extract(app, operation_id, archive_path, target_dir, password, policy, entries, strip_prefix)
    })
}

pub(crate) fn start_archive_add(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    archive_path: String,
    target_inner_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    launch_operation(app, OperationKind::ArchiveAdd, Some(OperationState::Validating), move |app, operation_id| {
        run_archive_add(app, operation_id, sources, archive_path, target_inner_dir, policy)
    })
}

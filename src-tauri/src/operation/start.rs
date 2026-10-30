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
    if super::remote_transfer::involves_remote(&sources, &target_dir) {
        return super::remote_transfer::start_remote_transfer(app, OperationKind::Copy, sources, target_dir, policy, remote_link_policy());
    }
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
    if super::remote_transfer::involves_remote(&sources, &target_dir) {
        return super::remote_transfer::start_remote_transfer(app, OperationKind::Move, sources, target_dir, policy, remote_link_policy());
    }
    launch_operation(app, OperationKind::Move, Some(OperationState::Validating), move |app, operation_id| {
        run_move(app, operation_id, &sources, &target_dir, policy)
    })
}

/// 원격 전송의 링크 처리 설정. 설정을 읽지 못하면 기본값(링크 보존).
fn remote_link_policy() -> crate::contracts::RemoteLinkPolicy {
    crate::settings_service::load_settings().map(|settings| settings.remote.link_policy).unwrap_or_default()
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
    // 원격 대상은 휴지통이 없어 영구 삭제만 허용(FR-38.2)
    if targets.iter().any(|target| crate::remote::path::is_remote_path(target)) {
        if mode != DeleteMode::Permanent {
            return Err(AppError::new("unsupported", "errors.remoteTrashUnsupported", None, true));
        }
        return super::remote_ops::start_remote_delete(app, targets);
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

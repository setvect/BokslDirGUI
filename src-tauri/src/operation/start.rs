use crate::contracts::{
    AppError, CommandResult, ConflictDecision, DeleteMode, OperationKind, OperationStarted,
    OperationState,
};

use std::thread;

use super::archive_ops::{run_archive_add, run_archive_create, run_archive_extract};
use super::delete::run_delete;
use super::file_io::{collect_source_paths, guard_delete_target};
use super::runtime::{
    emit_state, emit_summary, finish_operation, next_operation_id, register_operation,
    PERMANENT_DELETE_CONFIRM_TOKEN,
};
use super::transfer::{run_copy, run_move};

pub(crate) fn start_copy(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    let operation_id = next_operation_id(OperationKind::Copy);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind: OperationKind::Copy,
        state: OperationState::Queued,
    };
    if let Some(app) = app {
        let app = app.clone();
        thread::spawn({
            let operation_id = operation_id.clone();
            move || {
                emit_state(
                    Some(&app),
                    &operation_id,
                    OperationKind::Copy,
                    OperationState::Validating,
                    None,
                    0,
                    0,
                    None,
                );
                match run_copy(
                    Some(&app),
                    &operation_id,
                    &sources,
                    &target_dir,
                    policy,
                    None,
                ) {
                    Ok(summary) | Err(summary) => emit_summary(Some(&app), &summary),
                }
                finish_operation(&operation_id);
            }
        });
    } else {
        emit_state(
            app,
            &operation_id,
            OperationKind::Copy,
            OperationState::Validating,
            None,
            0,
            0,
            None,
        );
        match run_copy(app, &operation_id, &sources, &target_dir, policy, None) {
            Ok(summary) | Err(summary) => emit_summary(app, &summary),
        }
        finish_operation(&operation_id);
    }
    Ok(started)
}

pub(crate) fn start_move(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    let operation_id = next_operation_id(OperationKind::Move);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind: OperationKind::Move,
        state: OperationState::Queued,
    };
    if let Some(app) = app {
        let app = app.clone();
        thread::spawn({
            let operation_id = operation_id.clone();
            move || {
                emit_state(
                    Some(&app),
                    &operation_id,
                    OperationKind::Move,
                    OperationState::Validating,
                    None,
                    0,
                    0,
                    None,
                );
                let summary = run_move(Some(&app), &operation_id, &sources, &target_dir, policy);
                emit_summary(Some(&app), &summary);
                finish_operation(&operation_id);
            }
        });
    } else {
        emit_state(
            app,
            &operation_id,
            OperationKind::Move,
            OperationState::Validating,
            None,
            0,
            0,
            None,
        );
        let summary = run_move(app, &operation_id, &sources, &target_dir, policy);
        emit_summary(app, &summary);
        finish_operation(&operation_id);
    }
    Ok(started)
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
    let operation_id = next_operation_id(kind);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind,
        state: OperationState::Queued,
    };
    if let Some(app) = app {
        let app = app.clone();
        thread::spawn({
            let operation_id = operation_id.clone();
            move || {
                emit_state(
                    Some(&app),
                    &operation_id,
                    kind,
                    OperationState::Validating,
                    None,
                    0,
                    0,
                    None,
                );
                let summary = run_delete(Some(&app), &operation_id, &targets, mode);
                emit_summary(Some(&app), &summary);
                finish_operation(&operation_id);
            }
        });
    } else {
        emit_state(
            app,
            &operation_id,
            kind,
            OperationState::Validating,
            None,
            0,
            0,
            None,
        );
        let summary = run_delete(app, &operation_id, &targets, mode);
        emit_summary(app, &summary);
        finish_operation(&operation_id);
    }
    Ok(started)
}

pub(crate) fn start_archive_create(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> CommandResult<OperationStarted> {
    let operation_id = next_operation_id(OperationKind::ArchiveCreate);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind: OperationKind::ArchiveCreate,
        state: OperationState::Queued,
    };
    if let Some(app) = app {
        let app = app.clone();
        thread::spawn({
            let operation_id = operation_id.clone();
            move || {
                emit_state(
                    Some(&app),
                    &operation_id,
                    OperationKind::ArchiveCreate,
                    OperationState::Validating,
                    None,
                    0,
                    0,
                    None,
                );
                let summary = run_archive_create(
                    Some(&app),
                    &operation_id,
                    sources,
                    target_archive,
                    format,
                    password,
                );
                emit_summary(Some(&app), &summary);
                finish_operation(&operation_id);
            }
        });
    } else {
        emit_state(
            app,
            &operation_id,
            OperationKind::ArchiveCreate,
            OperationState::Validating,
            None,
            0,
            0,
            None,
        );
        let summary = run_archive_create(
            app,
            &operation_id,
            sources,
            target_archive,
            format,
            password,
        );
        emit_summary(app, &summary);
        finish_operation(&operation_id);
    }
    Ok(started)
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
    let operation_id = next_operation_id(OperationKind::ArchiveExtract);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind: OperationKind::ArchiveExtract,
        state: OperationState::Queued,
    };
    if let Some(app) = app {
        let app = app.clone();
        thread::spawn({
            let operation_id = operation_id.clone();
            move || {
                emit_state(
                    Some(&app),
                    &operation_id,
                    OperationKind::ArchiveExtract,
                    OperationState::Validating,
                    None,
                    0,
                    0,
                    None,
                );
                let summary = run_archive_extract(
                    Some(&app),
                    &operation_id,
                    archive_path,
                    target_dir,
                    password,
                    policy,
                    entries,
                    strip_prefix,
                );
                emit_summary(Some(&app), &summary);
                finish_operation(&operation_id);
            }
        });
    } else {
        emit_state(
            app,
            &operation_id,
            OperationKind::ArchiveExtract,
            OperationState::Validating,
            None,
            0,
            0,
            None,
        );
        let summary = run_archive_extract(
            app,
            &operation_id,
            archive_path,
            target_dir,
            password,
            policy,
            entries,
            strip_prefix,
        );
        emit_summary(app, &summary);
        finish_operation(&operation_id);
    }
    Ok(started)
}

pub(crate) fn start_archive_add(
    app: Option<&tauri::AppHandle>,
    sources: Vec<String>,
    archive_path: String,
    target_inner_dir: String,
    policy: ConflictDecision,
) -> CommandResult<OperationStarted> {
    let operation_id = next_operation_id(OperationKind::ArchiveAdd);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind: OperationKind::ArchiveAdd,
        state: OperationState::Queued,
    };
    if let Some(app) = app {
        let app = app.clone();
        thread::spawn({
            let operation_id = operation_id.clone();
            move || {
                emit_state(
                    Some(&app),
                    &operation_id,
                    OperationKind::ArchiveAdd,
                    OperationState::Validating,
                    None,
                    0,
                    0,
                    None,
                );
                let summary = run_archive_add(
                    Some(&app),
                    &operation_id,
                    sources,
                    archive_path,
                    target_inner_dir,
                    policy,
                );
                emit_summary(Some(&app), &summary);
                finish_operation(&operation_id);
            }
        });
    } else {
        emit_state(
            app,
            &operation_id,
            OperationKind::ArchiveAdd,
            OperationState::Validating,
            None,
            0,
            0,
            None,
        );
        let summary = run_archive_add(
            app,
            &operation_id,
            sources,
            archive_path,
            target_inner_dir,
            policy,
        );
        emit_summary(app, &summary);
        finish_operation(&operation_id);
    }
    Ok(started)
}

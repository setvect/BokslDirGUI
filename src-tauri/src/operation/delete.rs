#[cfg(test)]
use super::file_io::unique_temp_target;
use crate::contracts::{
    AppError, CommandResult, DeleteMode, OperationKind, OperationState, OperationSummary,
};
use crate::filesystem::map_io_error;
#[cfg(test)]
use crate::mutation;
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
#[cfg(test)]
use std::{env, path::PathBuf};

use super::file_io::{
    collect_source_paths, count_entries_and_bytes, guard_delete_target, ProgressTicker,
};
use super::runtime::should_cancel_for_test;
use super::runtime::{
    cancel_summary, check_cancelled, emit_progress, emit_state, error_summary, is_cancelled,
    is_operation_cancelled_error, summary_from_stats, OperationStats,
};

pub(super) fn run_delete(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    targets: &[String],
    mode: DeleteMode,
) -> OperationSummary {
    let kind = if mode == DeleteMode::Trash {
        OperationKind::Trash
    } else {
        OperationKind::Delete
    };
    let targets = match collect_source_paths(targets) {
        Ok(paths) => paths,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    for target in &targets {
        if let Err(error) = guard_delete_target(target) {
            return error_summary(operation_id, kind, error);
        }
    }
    emit_state(
        app,
        operation_id,
        kind,
        OperationState::Scanning,
        None,
        0,
        0,
        None,
    );
    let mut total_bytes = 0;
    let mut total_files = 0;
    let mut target_counts = BTreeMap::new();
    for target in &targets {
        match count_entries_and_bytes(operation_id, target, &mut total_bytes) {
            Ok(count) => {
                total_files += count;
                target_counts.insert(target.clone(), count);
            }
            Err(error) => return error_summary(operation_id, kind, error),
        }
    }
    let mut stats = OperationStats::new(total_files, total_bytes);
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Queued,
        &stats,
        None,
    );
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Running,
        &stats,
        None,
    );

    for target in &targets {
        if is_cancelled(operation_id) {
            return cancel_summary(operation_id, kind, &stats);
        }
        let result = if mode == DeleteMode::Trash {
            move_to_trash(target)
        } else {
            delete_tree_cancellable(
                app,
                operation_id,
                target,
                &mut stats,
                &mut ProgressTicker::new(),
            )
        };
        match result {
            Ok(()) => {
                if mode == DeleteMode::Trash {
                    stats.completed_files += target_counts.get(target).copied().unwrap_or(1);
                }
                emit_progress(
                    app,
                    operation_id,
                    kind,
                    OperationState::Running,
                    &stats,
                    Some(target),
                );
            }
            Err(error) => {
                if is_operation_cancelled_error(&error) {
                    return cancel_summary(operation_id, kind, &stats);
                }
                stats.failed_files += 1;
                stats.errors.push(error);
            }
        }
    }
    summary_from_stats(operation_id, kind, &stats)
}

pub(super) fn move_to_trash(source: &Path) -> CommandResult<()> {
    #[cfg(test)]
    if let Some(path) = env::var_os("BOKSLDIRGUI_TRASH_DIR") {
        let trash_dir = PathBuf::from(path);
        fs::create_dir_all(&trash_dir).map_err(|error| map_io_error(error, Some(&trash_dir)))?;
        let target = unique_temp_target(&trash_dir, source);
        return mutation::rename_no_replace(source, &target)
            .map_err(|error| map_io_error(error, Some(source)));
    }
    #[cfg(target_os = "macos")]
    let result = {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        let mut context = trash::TrashContext::default();
        context.set_delete_method(DeleteMethod::NsFileManager);
        context.delete(source)
    };
    #[cfg(not(target_os = "macos"))]
    let result = trash::delete(source);

    result.map_err(|error| {
        AppError::new("trash_failed", "errors.trashFailed", Some(source), true)
            .with_detail("message", error.to_string())
    })
}

pub(super) fn delete_tree_cancellable(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    path: &Path,
    stats: &mut OperationStats,
    ticker: &mut ProgressTicker,
) -> CommandResult<()> {
    check_cancelled(operation_id, path)?;
    let metadata = fs::symlink_metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
    if metadata.is_dir() {
        for child in fs::read_dir(path).map_err(|error| map_io_error(error, Some(path)))? {
            let child = child.map_err(|error| map_io_error(error, Some(path)))?;
            delete_tree_cancellable(app, operation_id, &child.path(), stats, ticker)?;
        }
        check_cancelled(operation_id, path)?;
        fs::remove_dir(path).map_err(|error| map_io_error(error, Some(path)))?;
    } else {
        fs::remove_file(path).map_err(|error| map_io_error(error, Some(path)))?;
        if metadata.is_file() {
            stats.completed_bytes += metadata.len();
        }
    }
    stats.completed_files += 1;
    if ticker.should_emit() {
        emit_progress(
            app,
            operation_id,
            OperationKind::Delete,
            OperationState::Running,
            stats,
            Some(path),
        );
    }
    if should_cancel_for_test(operation_id, stats) {
        check_cancelled(operation_id, path)?;
    }
    Ok(())
}

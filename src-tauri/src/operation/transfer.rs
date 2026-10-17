use crate::contracts::{
    AppError, ConflictDecision, OperationKind, OperationState, OperationSummary,
};
use crate::filesystem::map_io_error;
use crate::mutation;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

use super::conflict::handle_conflict;
use super::file_io::{
    canonical_existing_directory, collect_source_paths, copy_tree, copy_tree_replacing,
    count_entries_and_bytes, is_cross_device_error, is_socket_file_type, path_is_occupied,
    remove_entry_any, same_path, path_is_within, scan_work, SpecialFileScanPolicy,
};
use super::runtime::should_cancel_for_test;
use super::runtime::{
    cancel_summary, emit_progress, emit_state, error_summary, is_cancelled,
    is_operation_cancelled_error, summary_from_stats, OperationStats,
};

pub(super) fn run_copy(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    sources: &[String],
    target_dir: &str,
    policy: ConflictDecision,
    cancel_after_completed: Option<u64>,
) -> Result<OperationSummary, OperationSummary> {
    let kind = OperationKind::Copy;
    let target_dir = match canonical_existing_directory(target_dir) {
        Ok(path) => path,
        Err(error) => return Err(error_summary(operation_id, kind, error)),
    };
    let sources = match collect_source_paths(sources) {
        Ok(paths) => paths,
        Err(error) => return Err(error_summary(operation_id, kind, error)),
    };
    for source in &sources {
        let destination = source.file_name().map(|name| target_dir.join(name));
        if (source.is_dir() && path_is_within(&target_dir, source))
            || destination.is_some_and(|destination| {
                source != &destination && path_is_within(source, &destination)
            })
        {
            return Err(error_summary(
                operation_id,
                kind,
                AppError::new("invalid_path", "errors.copyIntoSelf", Some(source), true),
            ));
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
    let mut work = Vec::new();
    let mut total_bytes = 0;
    for source in &sources {
        let source_name = source
            .file_name()
            .ok_or_else(|| AppError::new("invalid_path", "errors.invalidPath", Some(source), true));
        let Ok(source_name) = source_name else {
            return Err(error_summary(operation_id, kind, source_name.unwrap_err()));
        };
        scan_work(
            operation_id,
            source,
            Path::new(source_name),
            &mut work,
            &mut total_bytes,
            SpecialFileScanPolicy::IncludeForCopy,
        )
        .map_err(|error| error_summary(operation_id, kind, error))?;
    }
    let actionable_files = work
        .iter()
        .filter(|entry| !is_socket_file_type(&entry.metadata.file_type()))
        .count() as u64;
    let mut stats = OperationStats::new(actionable_files, total_bytes);
    drop(work);
    stats.cancel_after_completed = cancel_after_completed;
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

    for source in &sources {
        if is_cancelled(operation_id) || should_cancel_for_test(operation_id, &stats) {
            return Err(cancel_summary(operation_id, kind, &stats));
        }
        let source_name = match source.file_name() {
            Some(name) => PathBuf::from(name),
            None => {
                stats.failed_files += 1;
                stats.errors.push(AppError::new(
                    "invalid_path",
                    "errors.invalidPath",
                    Some(source),
                    true,
                ));
                continue;
            }
        };
        let destination = target_dir.join(&source_name);
        if fs::symlink_metadata(source)
            .is_ok_and(|metadata| is_socket_file_type(&metadata.file_type()))
        {
            stats.skipped_files += 1;
            continue;
        }
        if same_path(source, &destination) {
            stats.skipped_files += 1;
            continue;
        }
        let decision = handle_conflict(
            app,
            operation_id,
            source,
            &destination,
            policy,
            &mut stats,
            kind,
        );
        match decision {
            ConflictDecision::Skip | ConflictDecision::AllSkip => {
                stats.skipped_files += 1;
                continue;
            }
            ConflictDecision::Cancel => return Err(cancel_summary(operation_id, kind, &stats)),
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite
                if path_is_occupied(&destination) =>
            {
                if let Err(error) = copy_tree_replacing(
                    app,
                    operation_id,
                    source,
                    &target_dir,
                    &destination,
                    &mut stats,
                    kind,
                ) {
                    if is_operation_cancelled_error(&error) {
                        return Err(cancel_summary(operation_id, kind, &stats));
                    }
                    stats.failed_files += 1;
                    stats.errors.push(error);
                }
                continue;
            }
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {}
        }
        if let Err(error) = copy_tree(app, operation_id, source, &target_dir, &mut stats, kind) {
            if is_operation_cancelled_error(&error) {
                return Err(cancel_summary(operation_id, kind, &stats));
            }
            stats.failed_files += 1;
            stats.errors.push(error);
        }
    }
    Ok(summary_from_stats(operation_id, kind, &stats))
}

pub(super) fn run_move(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    sources: &[String],
    target_dir: &str,
    policy: ConflictDecision,
) -> OperationSummary {
    run_move_with_rename(app, operation_id, sources, target_dir, policy, mutation::rename_no_replace)
}

pub(super) fn run_move_with_rename(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    sources: &[String],
    target_dir: &str,
    policy: ConflictDecision,
    rename: impl Fn(&Path, &Path) -> std::io::Result<()>,
) -> OperationSummary {
    let kind = OperationKind::Move;
    let target_dir = match canonical_existing_directory(target_dir) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let sources = match collect_source_paths(sources) {
        Ok(paths) => paths,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    for source in &sources {
        let destination = source.file_name().map(|name| target_dir.join(name));
        if (source.is_dir() && path_is_within(&target_dir, source))
            || destination.is_some_and(|destination| {
                source != &destination && path_is_within(source, &destination)
            })
        {
            return error_summary(
                operation_id,
                kind,
                AppError::new("invalid_path", "errors.moveIntoSelf", Some(source), true),
            );
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
    for source in &sources {
        let mut work = Vec::new();
        let name = match source.file_name() {
            Some(name) => PathBuf::from(name),
            None => {
                return error_summary(
                    operation_id,
                    kind,
                    AppError::new("invalid_path", "errors.invalidPath", Some(source), true),
                )
            }
        };
        if let Err(error) = scan_work(
            operation_id,
            source,
            &name,
            &mut work,
            &mut total_bytes,
            SpecialFileScanPolicy::Reject,
        ) {
            return error_summary(operation_id, kind, error);
        }
        total_files += work.len() as u64;
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

    for source in &sources {
        if is_cancelled(operation_id) {
            return cancel_summary(operation_id, kind, &stats);
        }
        let name = match source.file_name() {
            Some(name) => name,
            None => {
                stats.failed_files += 1;
                stats.errors.push(AppError::new(
                    "invalid_path",
                    "errors.invalidPath",
                    Some(source),
                    true,
                ));
                continue;
            }
        };
        let destination = target_dir.join(name);
        if same_path(source, &destination) {
            stats.skipped_files += 1;
            continue;
        }
        let decision = handle_conflict(
            app,
            operation_id,
            source,
            &destination,
            policy,
            &mut stats,
            kind,
        );
        match decision {
            ConflictDecision::Skip | ConflictDecision::AllSkip => {
                stats.skipped_files += 1;
                continue;
            }
            ConflictDecision::Cancel => return cancel_summary(operation_id, kind, &stats),
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite
                if path_is_occupied(&destination) =>
            {
                if let Err(error) = copy_tree_replacing(
                    app,
                    operation_id,
                    source,
                    &target_dir,
                    &destination,
                    &mut stats,
                    kind,
                ) {
                    if is_operation_cancelled_error(&error) {
                        return cancel_summary(operation_id, kind, &stats);
                    }
                    stats.failed_files += 1;
                    stats.errors.push(error);
                    continue;
                }
                if let Err(error) = remove_entry_any(source) {
                    stats.failed_files += 1;
                    stats.errors.push(map_io_error(error, Some(source)));
                }
                continue;
            }
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {}
        }
        let mut source_bytes = 0;
        let source_entries = match count_entries_and_bytes(operation_id, source, &mut source_bytes)
        {
            Ok(count) => count,
            Err(error) => {
                stats.failed_files += 1;
                if is_operation_cancelled_error(&error) {
                    return cancel_summary(operation_id, kind, &stats);
                }
                stats.errors.push(error);
                continue;
            }
        };
        match rename(source, &destination) {
            Ok(()) => {
                stats.completed_files += source_entries;
                stats.completed_bytes += source_bytes;
                emit_progress(
                    app,
                    operation_id,
                    kind,
                    OperationState::Running,
                    &stats,
                    Some(&destination),
                );
            }
            Err(error) if is_cross_device_error(&error) => {
                if let Err(error) =
                    copy_tree(app, operation_id, source, &target_dir, &mut stats, kind)
                {
                    if is_operation_cancelled_error(&error) {
                        return cancel_summary(operation_id, kind, &stats);
                    }
                    stats.failed_files += 1;
                    stats.errors.push(error);
                    continue;
                }
                if let Err(error) = remove_entry_any(source) {
                    stats.failed_files += 1;
                    stats.errors.push(map_io_error(error, Some(source)));
                }
            }
            Err(error) => {
                stats.failed_files += 1;
                stats.errors.push(map_io_error(error, Some(&destination)));
            }
        }
    }
    summary_from_stats(operation_id, kind, &stats)
}

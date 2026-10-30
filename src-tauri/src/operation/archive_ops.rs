use crate::contracts::{
    AppError, CommandResult, ConflictDecision, OperationKind, OperationState, OperationSummary,
};
use crate::filesystem::map_io_error;
use crate::mutation;
use crate::navigation;
use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use std::collections::HashSet;

use super::conflict::{handle_archive_conflict, handle_conflict};
use crate::archive_provider::archive_format;
use super::file_io::{
    collect_source_paths, copy_file_no_replace, copy_tree, copy_tree_replacing,
    copy_tree_to_destination, count_entries_and_bytes, path_is_occupied, publish_replacement,
    scan_work, unique_temp_target, ProgressTicker, SpecialFileScanPolicy,
};
use super::process::{
    redact_error_secret, run_external_command,
    run_external_command_capture_observed, run_external_command_capture_with_secret,
    run_external_command_with_secret,
};
use super::runtime::{
    cancel_summary, emit_progress, error_summary, is_cancelled, is_operation_cancelled_error,
    summary_from_stats, OperationStats,
};

pub(super) fn run_archive_create(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> OperationSummary {
    let kind = OperationKind::ArchiveCreate;
    let password = password.as_deref().filter(|value| !value.is_empty());
    let sources = match collect_source_paths(&sources) {
        Ok(paths) => paths,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let target = PathBuf::from(&target_archive);
    if let Err(error) = crate::platform::validate_path_input(&target).and_then(|()| {
        mutation::validate_child_name(target.file_name().and_then(|name| name.to_str()).unwrap_or(""), Some(&target)).map(|_| ())
    }) {
        return error_summary(operation_id, kind, error);
    }
    let parent = match target.parent() {
        Some(parent) => match navigation::canonical_existing_directory(&parent.to_string_lossy()) {
            Ok(parent) => parent,
            Err(error) => return error_summary(operation_id, kind, error),
        },
        None => {
            return error_summary(
                operation_id,
                kind,
                AppError::new("invalid_path", "errors.invalidPath", Some(&target), true),
            )
        }
    };
    let target = parent.join(target.file_name().unwrap_or_default());
    if mutation::path_is_occupied(&target) {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "already_exists",
                "errors.alreadyExists",
                Some(&target),
                true,
            ),
        );
    }

    if sources
        .iter()
        .any(|source| source.is_dir() && parent.starts_with(source))
    {
        return error_summary(
            operation_id,
            kind,
            AppError::new("invalid_path", "errors.copyIntoSelf", Some(&target), true),
        );
    }
    let staged_target = unique_temp_target(&parent, &target);
    let mut total_bytes = 0;
    let mut total_files = 0;
    for source in &sources {
        match count_entries_and_bytes(operation_id, source, &mut total_bytes) {
            Ok(count) => total_files += count,
            Err(error) => return error_summary(operation_id, kind, error),
        }
    }
    let mut stats = OperationStats::new(total_files, total_bytes);
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Scanning,
        &stats,
        Some(&target),
    );
    if is_cancelled(operation_id) {
        return cancel_summary(operation_id, kind, &stats);
    }

    let archive_format =
        archive_format(&target).map(str::to_string).unwrap_or_else(|| format.to_ascii_lowercase());
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Running,
        &stats,
        Some(&target),
    );
    let command_result = match archive_format.as_str() {
        "zip" => run_zip_create_with_progress(
            app,
            operation_id,
            &staged_target,
            &sources,
            password,
            &target,
            &mut stats,
        ),
        "jar" | "war" if password.is_none() => run_zip_create_with_progress(
            app,
            operation_id,
            &staged_target,
            &sources,
            None,
            &target,
            &mut stats,
        ),
        "7z" => run_7z_create_with_progress(
            app,
            operation_id,
            &staged_target,
            &sources,
            password,
            &target,
            &mut stats,
        ),
        "tar" | "tar.gz" | "tar.zst" if password.is_none() => {
            run_tar_create(app, operation_id, &staged_target, &sources, &archive_format, &target, &mut stats)
        }
        "jar" | "war" | "tar" | "tar.gz" | "tar.zst" => Err(AppError::new(
            "unsupported",
            "errors.archivePasswordFormatUnsupported",
            Some(&target),
            true,
        )),
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(&target),
            true,
        )
        .with_detail("format", archive_format)),
    };

    let command_result = command_result.and_then(|()| {
        mutation::rename_no_replace(&staged_target, &target)
            .map_err(|error| map_io_error(error, Some(&target)))
    });
    if command_result.is_err() {
        let _ = fs::remove_file(&staged_target);
    }

    match command_result {
        Ok(()) => {
            stats.completed_files = total_files;
            stats.completed_bytes = total_bytes;
            emit_progress(
                app,
                operation_id,
                kind,
                OperationState::Completed,
                &stats,
                Some(&target),
            );
            summary_from_stats(operation_id, kind, &stats)
        }
        Err(error) if is_operation_cancelled_error(&error) => {
            cancel_summary(operation_id, kind, &stats)
        }
        Err(error) => error_summary(operation_id, kind, error),
    }
}

pub(super) fn run_archive_extract(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    archive_path: String,
    target_dir: String,
    password: Option<String>,
    policy: ConflictDecision,
    selected_entries: Option<Vec<String>>,
    strip_prefix: Option<String>,
) -> OperationSummary {
    let kind = OperationKind::ArchiveExtract;
    if strip_prefix.as_deref().is_some_and(archive_entry_is_unsafe) {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                Some(Path::new(&archive_path)),
                true,
            ),
        );
    }
    let password = password.as_deref().filter(|value| !value.is_empty());
    let archive = match navigation::canonical_existing_path(&archive_path) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let target_candidate = PathBuf::from(&target_dir);
    if let Err(error) = crate::platform::validate_path_input(&target_candidate) {
        return error_summary(operation_id, kind, error);
    }
    if !target_candidate.exists() {
        if let Err(error) = fs::create_dir_all(&target_candidate) {
            return error_summary(
                operation_id,
                kind,
                map_io_error(error, Some(&target_candidate)),
            );
        }
    }
    let target = match navigation::canonical_existing_directory(&target_dir) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };

    let mut stats = OperationStats::new(0, 0);
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Scanning,
        &stats,
        Some(&archive),
    );
    if is_cancelled(operation_id) {
        return cancel_summary(operation_id, kind, &stats);
    }

    let all_entries = match list_archive_entry_names_for_operation(operation_id, &archive, password)
    {
        Ok(entries) => entries,
        Err(error) if is_operation_cancelled_error(&error) => {
            return cancel_summary(operation_id, kind, &stats)
        }
        Err(error) => return error_summary(operation_id, kind, error),
    };
    if let Some(unsafe_entry) = all_entries
        .iter()
        .find(|entry| archive_entry_is_unsafe(entry))
    {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                Some(&archive),
                true,
            )
            .with_detail("entry", unsafe_entry),
        );
    }
    let entries = match archive_entries_for_extract(&all_entries, selected_entries.as_deref()) {
        Ok(entries) => entries,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let normalized_prefix = normalize_archive_entry(strip_prefix.as_deref().unwrap_or(""));
    if !normalized_prefix.is_empty()
        && entries.iter().any(|entry| {
            let entry = normalize_archive_entry(entry);
            entry != normalized_prefix && !entry.starts_with(&format!("{normalized_prefix}/"))
        })
    {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                Some(&archive),
                true,
            ),
        );
    }
    stats.total_files = entries.len() as u64;
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Scanning,
        &stats,
        Some(&archive),
    );
    if is_cancelled(operation_id) {
        return cancel_summary(operation_id, kind, &stats);
    }

    let command_result = run_archive_extract_selected(
        app,
        operation_id,
        &archive,
        &target,
        password,
        policy,
        &entries,
        strip_prefix.as_deref().unwrap_or(""),
        &mut stats,
        kind,
    );

    match command_result {
        Ok(()) => {
            emit_progress(
                app,
                operation_id,
                kind,
                OperationState::Completed,
                &stats,
                Some(&target),
            );
            summary_from_stats(operation_id, kind, &stats)
        }
        Err(error) if is_operation_cancelled_error(&error) => {
            cancel_summary(operation_id, kind, &stats)
        }
        Err(error) => {
            stats.failed_files += 1;
            stats.errors.push(error);
            summary_from_stats(operation_id, kind, &stats)
        }
    }
}

pub(super) fn run_archive_add(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    source_paths: Vec<String>,
    archive_path: String,
    target_inner_dir: String,
    policy: ConflictDecision,
) -> OperationSummary {
    let kind = OperationKind::ArchiveAdd;
    if archive_entry_is_unsafe(&target_inner_dir) {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                Some(Path::new(&archive_path)),
                true,
            )
            .with_detail("entry", target_inner_dir),
        );
    }
    let target_inner_dir = normalize_archive_entry(&target_inner_dir);
    let archive = match navigation::canonical_existing_path(&archive_path) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    if !matches!(
        archive_format(&archive),
        Some("zip" | "jar" | "war" | "7z")
    ) {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsupported",
                "errors.archiveFormatUnsupported",
                Some(&archive),
                true,
            ),
        );
    }
    let sources = match collect_source_paths(&source_paths) {
        Ok(paths) => paths,
        Err(error) => return error_summary(operation_id, kind, error),
    };

    let mut source_work_counts = Vec::with_capacity(sources.len());
    let mut total_files = 0_u64;
    let mut total_bytes = 0_u64;
    for source in &sources {
        let mut work = Vec::new();
        let mut source_bytes = 0_u64;
        if let Err(error) = scan_work(
            operation_id,
            source,
            Path::new(""),
            &mut work,
            &mut source_bytes,
            SpecialFileScanPolicy::Reject,
        ) {
            return error_summary(operation_id, kind, error);
        }
        let count = work.len() as u64;
        source_work_counts.push(count);
        total_files = total_files.saturating_add(count);
        total_bytes = total_bytes.saturating_add(source_bytes);
    }
    let mut stats = OperationStats::new(total_files, total_bytes);
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Scanning,
        &stats,
        Some(&archive),
    );
    if is_cancelled(operation_id) {
        return cancel_summary(operation_id, kind, &stats);
    }

    let mut archive_entries =
        match list_archive_entry_names_for_operation(operation_id, &archive, None) {
            Ok(entries) => entries,
            Err(error) if is_operation_cancelled_error(&error) => {
                return cancel_summary(operation_id, kind, &stats)
            }
            Err(error) => return error_summary(operation_id, kind, error),
        };
    if let Some(unsafe_entry) = archive_entries
        .iter()
        .find(|entry| archive_entry_is_unsafe(entry))
    {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                Some(&archive),
                true,
            )
            .with_detail("entry", unsafe_entry),
        );
    }

    let staging = match unique_archive_add_staging_dir(operation_id) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let mut roots_to_add = Vec::new();
    let mut entries_to_delete = Vec::new();
    for (source, source_work_count) in sources.iter().zip(source_work_counts.iter().copied()) {
        if is_cancelled(operation_id) {
            let _ = fs::remove_dir_all(&staging);
            return cancel_summary(operation_id, kind, &stats);
        }
        let Some(source_name) = source.file_name().and_then(|value| value.to_str()) else {
            let _ = fs::remove_dir_all(&staging);
            return error_summary(
                operation_id,
                kind,
                AppError::new("invalid_path", "errors.invalidPath", Some(source), true),
            );
        };
        let destination_entry = if target_inner_dir.is_empty() {
            source_name.to_string()
        } else {
            format!("{target_inner_dir}/{source_name}")
        };
        if archive_entry_is_unsafe(&destination_entry) {
            let _ = fs::remove_dir_all(&staging);
            return error_summary(
                operation_id,
                kind,
                AppError::new(
                    "unsafe_archive_entry",
                    "errors.archiveUnsafePath",
                    Some(&archive),
                    true,
                )
                .with_detail("entry", destination_entry),
            );
        }

        let conflicting_entries = archive_conflicting_entries(&archive_entries, &destination_entry);
        if !conflicting_entries.is_empty() {
            let decision = handle_archive_conflict(
                app,
                operation_id,
                source,
                &archive,
                &destination_entry,
                policy,
                &stats,
                kind,
            );
            match decision {
                ConflictDecision::Skip | ConflictDecision::AllSkip => {
                    stats.skipped_files = stats.skipped_files.saturating_add(source_work_count);
                    continue;
                }
                ConflictDecision::Cancel => {
                    let _ = fs::remove_dir_all(&staging);
                    return cancel_summary(operation_id, kind, &stats);
                }
                ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {
                    let removed: HashSet<String> = conflicting_entries
                        .iter()
                        .map(|entry| normalize_archive_entry(entry))
                        .collect();
                    entries_to_delete.extend(conflicting_entries);
                    archive_entries
                        .retain(|entry| !removed.contains(&normalize_archive_entry(entry)));
                }
            }
        }

        let staged_destination = staging.join(Path::new(&destination_entry));
        if let Err(error) = copy_tree_to_destination(
            app,
            operation_id,
            source,
            &staged_destination,
            &mut stats,
            kind,
        ) {
            let _ = fs::remove_dir_all(&staging);
            return if is_operation_cancelled_error(&error) {
                cancel_summary(operation_id, kind, &stats)
            } else {
                error_summary(operation_id, kind, error)
            };
        }
        roots_to_add.push(destination_entry);
    }

    if roots_to_add.is_empty() {
        let _ = fs::remove_dir_all(&staging);
        emit_progress(
            app,
            operation_id,
            kind,
            OperationState::Completed,
            &stats,
            Some(&archive),
        );
        return summary_from_stats(operation_id, kind, &stats);
    }

    entries_to_delete.sort();
    entries_to_delete.dedup();
    let working_archive = unique_temp_target(archive.parent().unwrap(), &archive);
    if let Err(error) = copy_file_no_replace(&archive, &working_archive, |_| {
        if is_cancelled(operation_id) {
            Err(AppError::new(
                "operation_cancelled",
                "errors.operationCancelled",
                Some(&archive),
                true,
            ))
        } else {
            Ok(())
        }
    }) {
        let _ = fs::remove_dir_all(&staging);
        return if is_operation_cancelled_error(&error) {
            stats.completed_files = 0;
            stats.completed_bytes = 0;
            cancel_summary(operation_id, kind, &stats)
        } else {
            error_summary(operation_id, kind, error)
        };
    }
    let add_result = run_archive_delete_entries(operation_id, &working_archive, &entries_to_delete)
        .and_then(|()| {
            run_archive_add_entries(operation_id, &working_archive, &staging, &roots_to_add)
        })
        .and_then(|()| {
            publish_replacement(&working_archive, &archive, mutation::rename_no_replace)
        });
    let _ = fs::remove_file(&working_archive);
    let _ = fs::remove_dir_all(&staging);
    match add_result {
        Ok(()) => {
            emit_progress(
                app,
                operation_id,
                kind,
                OperationState::Completed,
                &stats,
                Some(&archive),
            );
            summary_from_stats(operation_id, kind, &stats)
        }
        Err(error) if is_operation_cancelled_error(&error) => {
            stats.completed_files = 0;
            stats.completed_bytes = 0;
            cancel_summary(operation_id, kind, &stats)
        }
        Err(error) => error_summary(operation_id, kind, error),
    }
}

#[cfg(test)]
pub(super) fn run_zip_create(
    operation_id: &str,
    target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
) -> CommandResult<()> {
    run_zip_create_observed(operation_id, target, sources, password, None)
}

pub(super) fn run_zip_create_with_progress(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    staged_target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
    display_target: &Path,
    stats: &mut OperationStats,
) -> CommandResult<()> {
    // Info-ZIP reports completed input bytes per entry and emits dots while a large entry runs.
    if crate::archive_provider::zip_uses_seven_zip() {
        return run_7z_create_with_progress(app, operation_id, staged_target, sources, password, display_target, stats);
    }
    let mut parser = ZipProgressParser::default();
    let mut ticker = ProgressTicker::new();
    let mut observer = |chunk: &[u8]| {
        if let Some((completed_files, completed_bytes)) = parser.ingest(chunk) {
            stats.completed_files = completed_files.min(stats.total_files);
            stats.completed_bytes = completed_bytes.min(stats.total_bytes);
            if ticker.should_emit() {
                emit_progress(
                    app,
                    operation_id,
                    OperationKind::ArchiveCreate,
                    OperationState::Running,
                    stats,
                    Some(display_target),
                );
            }
        }
    };
    run_zip_create_observed(
        operation_id,
        staged_target,
        sources,
        password,
        Some(&mut observer),
    )
}

pub(super) fn run_zip_create_observed(
    operation_id: &str,
    target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
    observer: Option<&mut dyn FnMut(&[u8])>,
) -> CommandResult<()> {
    if crate::archive_provider::zip_uses_seven_zip() {
        return run_7z_create_observed(operation_id, target, sources, password, observer);
    }
    let zip = crate::archive_provider::require_tool("zip", target)?;
    let working_dir = common_source_parent(sources, target)?;
    let mut command = Command::new(zip);
    command.current_dir(&working_dir);
    command.arg("-r");
    if observer.is_some() {
        command.args(["-db", "-dc", "-dd", "-du", "-ds", "1m"]);
    } else {
        command.arg("-q");
    }
    if let Some(password) = password {
        command.arg("-P").arg(password);
    }
    command.arg(target);
    for source in sources {
        command.arg(Path::new(".").join(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?));
    }
    run_external_command_capture_observed(operation_id, command, Some(target), observer)
        .map(|_| ())
        .map_err(|error| redact_error_secret(error, password))
}

pub(super) const ZIP_PROGRESS_DOT_BYTES: u64 = 1024 * 1024;

#[derive(Default)]
pub(super) struct ZipProgressParser {
    pub(super) line: Vec<u8>,
    pub(super) completed_files: u64,
    pub(super) completed_bytes: u64,
}

impl ZipProgressParser {
    pub(super) fn ingest(&mut self, chunk: &[u8]) -> Option<(u64, u64)> {
        let previous = (self.completed_files, self.completed_bytes);
        for &byte in chunk {
            if byte == b'\n' || byte == b'\r' {
                self.update(true);
                self.line.clear();
            } else {
                self.line.push(byte);
            }
        }
        self.update(false);
        let current = (self.completed_files, self.completed_bytes);
        (current != previous).then_some(current)
    }

    pub(super) fn update(&mut self, line_finished: bool) {
        let line = String::from_utf8_lossy(&self.line);
        let Some((before_files, before_bytes)) = zip_progress_prefix(&line) else {
            return;
        };
        self.completed_files = self.completed_files.max(before_files);
        self.completed_bytes = self.completed_bytes.max(before_bytes);
        if !line.contains(" adding: ") {
            return;
        }
        let trailing_dots = self
            .line
            .iter()
            .rev()
            .take_while(|&&byte| byte == b'.')
            .count();
        if trailing_dots > 0
            && self.line.len() > trailing_dots
            && self.line.get(self.line.len() - trailing_dots - 1) == Some(&b' ')
        {
            self.completed_bytes = self
                .completed_bytes
                .max(before_bytes.saturating_add(trailing_dots as u64 * ZIP_PROGRESS_DOT_BYTES));
        }
        if line_finished && line.ends_with(')') {
            self.completed_files = self.completed_files.max(before_files.saturating_add(1));
            if let Some(size) = zip_completed_entry_size(&line) {
                self.completed_bytes = self.completed_bytes.max(before_bytes.saturating_add(size));
            }
        }
    }
}

pub(super) fn zip_progress_prefix(line: &str) -> Option<(u64, u64)> {
    let bracket = line.find('[')?;
    let file_count = line[..bracket].split('/').next()?.trim().parse().ok()?;
    let bytes_end = line[bracket + 1..].find(']')? + bracket + 1;
    let bytes = parse_zip_human_bytes(line[bracket + 1..bytes_end].split('/').next()?.trim())?;
    Some((file_count, bytes))
}

pub(super) fn zip_completed_entry_size(line: &str) -> Option<u64> {
    let status_start = line.rfind(" (")?;
    let before_status = &line[..status_start];
    let size_start = before_status.rfind(" (")? + 2;
    parse_zip_human_bytes(before_status[size_start..].strip_suffix(')')?)
}

pub(super) fn parse_zip_human_bytes(value: &str) -> Option<u64> {
    let number_end = value
        .find(|character: char| !character.is_ascii_digit() && character != '.')
        .unwrap_or(value.len());
    let number: f64 = value[..number_end].parse().ok()?;
    let multiplier = match value[number_end..].trim() {
        "" => 1_u64,
        "K" => 1024,
        "M" => 1024 * 1024,
        "G" => 1024 * 1024 * 1024,
        "T" => 1024_u64.pow(4),
        _ => return None,
    };
    Some((number * multiplier as f64) as u64)
}

pub(super) fn run_7z_create_with_progress(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    staged_target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
    display_target: &Path,
    stats: &mut OperationStats,
) -> CommandResult<()> {
    let mut parser = SevenZipProgressParser::default();
    let mut ticker = ProgressTicker::new();
    let mut observer = |chunk: &[u8]| {
        if let Some(percent) = parser.ingest(chunk) {
            // 7z exposes a percent, so both counters are estimates until publication succeeds.
            stats.completed_bytes = (stats.total_bytes as u128 * percent as u128 / 100) as u64;
            stats.completed_files = (stats.total_files as u128 * percent as u128 / 100) as u64;
            if ticker.should_emit() {
                emit_progress(
                    app,
                    operation_id,
                    OperationKind::ArchiveCreate,
                    OperationState::Running,
                    stats,
                    Some(display_target),
                );
            }
        }
    };
    let result = run_7z_create_observed(
        operation_id,
        staged_target,
        sources,
        password,
        Some(&mut observer),
    );
    if result.is_ok() {
        stats.completed_files = stats.total_files;
        stats.completed_bytes = stats.total_bytes;
    }
    result
}

pub(super) fn run_7z_create_observed(
    operation_id: &str,
    target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
    observer: Option<&mut dyn FnMut(&[u8])>,
) -> CommandResult<()> {
    let seven_zip = crate::archive_provider::require_tool("7z", target)?;
    let working_dir = common_source_parent(sources, target)?;
    let mut command = Command::new(seven_zip);
    command.current_dir(&working_dir);
    let zip = matches!(archive_format(target), Some("zip" | "jar" | "war"));
    command.args(["a", "-y", "-spd", "-sccUTF-8", if zip { "-tzip" } else { "-t7z" }]);
    if observer.is_some() {
        command.arg("-bsp1");
    }
    if let Some(password) = password {
        command.arg(format!("-p{password}"));
        if !zip { command.arg("-mhe=on"); }
    }
    command.arg(target);
    for source in sources {
        command.arg(Path::new(".").join(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?));
    }
    run_external_command_capture_observed(operation_id, command, Some(target), observer)
        .map(|_| ())
        .map_err(|error| redact_error_secret(error, password))
}

#[derive(Default)]
pub(super) struct SevenZipProgressParser {
    pub(super) line: Vec<u8>,
    pub(super) percent: u8,
}

impl SevenZipProgressParser {
    pub(super) fn ingest(&mut self, chunk: &[u8]) -> Option<u8> {
        let previous = self.percent;
        for &byte in chunk {
            if byte == b'\n' || byte == b'\r' {
                self.update();
                self.line.clear();
            } else {
                self.line.push(byte);
            }
        }
        self.update();
        (self.percent > previous).then_some(self.percent)
    }

    pub(super) fn update(&mut self) {
        let line = String::from_utf8_lossy(&self.line);
        let trimmed = line.trim_start();
        let digits = trimmed.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 3 || trimmed.as_bytes().get(digits) != Some(&b'%') {
            return;
        }
        if let Ok(value) = trimmed[..digits].parse::<u8>() {
            if value <= 100 {
                self.percent = self.percent.max(value);
            }
        }
    }
}

pub(super) fn run_tar_create(
    app: Option<&tauri::AppHandle>, operation_id: &str, target: &Path, sources: &[PathBuf],
    format: &str, display_target: &Path, stats: &mut OperationStats,
) -> CommandResult<()> {
    let mut ticker = ProgressTicker::new();
    crate::archive_tar::create(target, sources, format, &|| is_cancelled(operation_id), &mut |files, bytes| {
        stats.completed_files = files.min(stats.total_files);
        stats.completed_bytes = bytes.min(stats.total_bytes);
        if ticker.should_emit() {
            emit_progress(app, operation_id, OperationKind::ArchiveCreate, OperationState::Running, stats, Some(display_target));
        }
    }).map_err(|error| map_tar_error(error, operation_id, target))
}

fn map_tar_error(error: std::io::Error, operation_id: &str, path: &Path) -> AppError {
    if is_cancelled(operation_id) {
        AppError::new("operation_cancelled", "errors.operationCancelled", Some(path), true)
    } else if error.to_string() == "unsafe_archive_entry" {
        AppError::new("unsafe_archive_entry", "errors.archiveUnsafePath", Some(path), true)
    } else { map_io_error(error, Some(path)) }
}

pub(super) fn common_source_parent(sources: &[PathBuf], target: &Path) -> CommandResult<PathBuf> {
    let Some(first_parent) = sources.first().and_then(|source| source.parent()) else {
        return Err(AppError::new(
            "invalid_path",
            "errors.invalidPath",
            Some(target),
            true,
        ));
    };
    for source in sources {
        if source.parent() != Some(first_parent) {
            return Err(AppError::new(
                "invalid_path",
                "errors.archiveSourcesMustShareParent",
                Some(source),
                true,
            ));
        }
    }
    Ok(first_parent.to_path_buf())
}

pub(super) fn run_zip_extract(
    operation_id: &str,
    archive: &Path,
    target: &Path,
    password: Option<&str>,
    policy: ConflictDecision,
    entries: Option<&[String]>,
) -> CommandResult<()> {
    if crate::archive_provider::zip_uses_seven_zip() {
        return run_7z_extract(operation_id, archive, target, password, policy, entries);
    }
    let unzip = crate::archive_provider::require_tool("unzip", archive)?;
    let mut command = Command::new(unzip);
    if let Some(password) = password {
        command.arg("-P").arg(password);
    }
    match policy {
        ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {
            command.arg("-o");
        }
        ConflictDecision::Skip | ConflictDecision::AllSkip => {
            command.arg("-n");
        }
        ConflictDecision::Cancel => {
            return Err(AppError::new(
                "operation_cancelled",
                "errors.operationCancelled",
                Some(archive),
                true,
            ));
        }
    }
    command.arg("-q").arg(archive);
    for entry in entries.unwrap_or(&[]) {
        command.arg(entry);
    }
    command.arg("-d").arg(target);
    run_external_command_with_secret(operation_id, command, Some(archive), password)
}

pub(super) fn run_7z_extract(
    operation_id: &str,
    archive: &Path,
    target: &Path,
    password: Option<&str>,
    policy: ConflictDecision,
    entries: Option<&[String]>,
) -> CommandResult<()> {
    let seven_zip = crate::archive_provider::require_tool("7z", archive)?;
    let mut command = Command::new(seven_zip);
    command.args(["x", "-spd", "-sccUTF-8"]);
    if let Some(password) = password {
        command.arg(format!("-p{password}"));
    }
    match policy {
        ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {
            command.arg("-aoa");
        }
        ConflictDecision::Skip | ConflictDecision::AllSkip => {
            command.arg("-aos");
        }
        ConflictDecision::Cancel => {
            return Err(AppError::new(
                "operation_cancelled",
                "errors.operationCancelled",
                Some(archive),
                true,
            ));
        }
    }
    command
        .arg(format!("-o{}", target.to_string_lossy()))
        .arg(archive);
    for entry in entries.unwrap_or(&[]) {
        command.arg(format!("-i!{entry}"));
    }
    run_external_command_with_secret(operation_id, command, Some(archive), password)
}

pub(super) fn run_tar_extract(
    operation_id: &str, archive: &Path, target: &Path, entries: Option<&[String]>,
) -> CommandResult<()> {
    let format = archive_format(archive).unwrap_or_default();
    crate::archive_tar::extract(archive, format, target, entries, &|| is_cancelled(operation_id))
        .map_err(|error| map_tar_error(error, operation_id, archive))
}

pub(super) fn run_archive_extract_selected(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    archive: &Path,
    target: &Path,
    password: Option<&str>,
    policy: ConflictDecision,
    entries: &[String],
    strip_prefix: &str,
    stats: &mut OperationStats,
    kind: OperationKind,
) -> CommandResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    let staging = unique_archive_extract_staging_dir(operation_id)?;
    let extract_result = match archive_format(archive) {
        Some("zip" | "jar" | "war") => run_zip_extract(
            operation_id,
            archive,
            &staging,
            password,
            ConflictDecision::Overwrite,
            Some(entries),
        ),
        Some("7z") => run_7z_extract(
            operation_id,
            archive,
            &staging,
            password,
            ConflictDecision::Overwrite,
            Some(entries),
        ),
        Some("tar" | "tar.gz" | "tar.zst") if password.is_none() => {
            run_tar_extract(operation_id, archive, &staging, Some(entries))
        }
        Some("tar" | "tar.gz" | "tar.zst") => Err(AppError::new(
            "unsupported",
            "errors.archivePasswordFormatUnsupported",
            Some(archive),
            true,
        )),
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(archive),
            true,
        )),
    };
    if let Err(error) = extract_result {
        let _ = fs::remove_dir_all(&staging);
        return Err(error);
    }

    let selected_roots = selected_staged_roots(entries, strip_prefix);
    let mut copied = HashSet::new();
    for relative in selected_roots {
        if is_cancelled(operation_id) {
            let _ = fs::remove_dir_all(&staging);
            return Err(AppError::new(
                "operation_cancelled",
                "errors.operationCancelled",
                Some(archive),
                true,
            ));
        }
        let source = staging.join(&relative);
        if !copied.insert(source.clone()) {
            continue;
        }
        let canonical_staging = staging
            .canonicalize()
            .map_err(|error| map_io_error(error, Some(&staging)))?;
        let canonical_parent = source
            .parent()
            .and_then(|parent| parent.canonicalize().ok());
        if !canonical_parent.is_some_and(|parent| parent.starts_with(&canonical_staging)) {
            let _ = fs::remove_dir_all(&staging);
            return Err(AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                Some(archive),
                true,
            ));
        }
        if !path_is_occupied(&source) {
            stats.failed_files += 1;
            stats.errors.push(AppError::new(
                "not_found",
                "errors.notFound",
                Some(&source),
                true,
            ));
            continue;
        }
        let destination = target.join(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(&source), true)
        })?);
        let decision = handle_conflict(
            app,
            operation_id,
            &source,
            &destination,
            policy,
            stats,
            kind,
        );
        match decision {
            ConflictDecision::Skip | ConflictDecision::AllSkip => {
                stats.skipped_files += 1;
                continue;
            }
            ConflictDecision::Cancel => {
                let _ = fs::remove_dir_all(&staging);
                return Err(AppError::new(
                    "operation_cancelled",
                    "errors.operationCancelled",
                    Some(&source),
                    true,
                ));
            }
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite
                if path_is_occupied(&destination) =>
            {
                if let Err(error) = copy_tree_replacing(
                    app,
                    operation_id,
                    &source,
                    target,
                    &destination,
                    stats,
                    kind,
                ) {
                    let _ = fs::remove_dir_all(&staging);
                    return Err(error);
                }
            }
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {
                if let Err(error) = copy_tree(app, operation_id, &source, target, stats, kind) {
                    let _ = fs::remove_dir_all(&staging);
                    return Err(error);
                }
            }
        }
    }
    let _ = fs::remove_dir_all(&staging);
    Ok(())
}

pub(super) fn archive_entries_for_extract(
    all_entries: &[String],
    selected_entries: Option<&[String]>,
) -> CommandResult<Vec<String>> {
    let Some(selected_entries) = selected_entries else {
        return Ok(all_entries.to_vec());
    };
    if selected_entries.is_empty() {
        return Ok(all_entries.to_vec());
    }
    let mut expanded = Vec::new();
    let mut seen = HashSet::new();
    for selected in selected_entries {
        let selected = normalize_archive_entry(selected);
        if selected.is_empty() || archive_entry_is_unsafe(&selected) {
            return Err(AppError::new(
                "unsafe_archive_entry",
                "errors.archiveUnsafePath",
                None,
                true,
            )
            .with_detail("entry", selected));
        }
        let directory_prefix = format!("{}/", selected.trim_end_matches('/'));
        let matches: Vec<String> = all_entries
            .iter()
            .filter(|entry| {
                let normalized = normalize_archive_entry(entry);
                normalized == selected || normalized.starts_with(&directory_prefix)
            })
            .cloned()
            .collect();
        if matches.is_empty() {
            return Err(AppError::new("not_found", "errors.notFound", None, true)
                .with_detail("entry", selected));
        }
        for entry in matches {
            if seen.insert(entry.clone()) {
                expanded.push(entry);
            }
        }
    }
    Ok(expanded)
}

pub(super) fn selected_staged_roots(entries: &[String], strip_prefix: &str) -> Vec<PathBuf> {
    let strip_prefix = normalize_archive_entry(strip_prefix)
        .trim_end_matches('/')
        .to_string();
    let mut roots = Vec::new();
    let mut seen = HashSet::new();
    for entry in entries {
        let normalized = normalize_archive_entry(entry);
        let stripped = strip_archive_prefix(&normalized, &strip_prefix);
        let Some(root_name) = stripped.split('/').find(|segment| !segment.is_empty()) else {
            continue;
        };
        let root = if strip_prefix.is_empty() {
            PathBuf::from(root_name)
        } else if normalized == strip_prefix {
            PathBuf::from(&strip_prefix)
        } else {
            PathBuf::from(&strip_prefix).join(root_name)
        };
        if !root.as_os_str().is_empty() && seen.insert(root.clone()) {
            roots.push(root);
        }
    }
    roots
}

pub(super) fn strip_archive_prefix<'a>(entry: &'a str, strip_prefix: &str) -> &'a str {
    if strip_prefix.is_empty() {
        return entry;
    }
    if entry == strip_prefix {
        return entry.rsplit('/').next().unwrap_or(entry);
    }
    entry
        .strip_prefix(&format!("{}/", strip_prefix))
        .unwrap_or(entry)
}

pub(super) fn normalize_archive_entry(entry: &str) -> String {
    entry
        .replace('\\', "/")
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/")
}


pub(super) fn unique_archive_extract_staging_dir(operation_id: &str) -> CommandResult<PathBuf> {
    let base = env::temp_dir().join(format!(
        "boksldir-gui-archive-extract-{}-{}",
        operation_id,
        unix_millis()
    ));
    fs::create_dir_all(&base).map_err(|error| map_io_error(error, Some(&base)))?;
    Ok(base)
}

pub(super) fn unique_archive_add_staging_dir(operation_id: &str) -> CommandResult<PathBuf> {
    let base = env::temp_dir().join(format!(
        "boksldir-gui-archive-add-{}-{}",
        operation_id,
        unix_millis()
    ));
    fs::create_dir_all(&base).map_err(|error| map_io_error(error, Some(&base)))?;
    Ok(base)
}

pub(super) fn archive_conflicting_entries(entries: &[String], destination: &str) -> Vec<String> {
    let destination = normalize_archive_entry(destination);
    let prefix = format!("{destination}/");
    entries
        .iter()
        .filter(|entry| {
            let normalized = normalize_archive_entry(entry);
            normalized == destination || normalized.starts_with(&prefix)
        })
        .cloned()
        .collect()
}

pub(super) fn run_archive_delete_entries(
    operation_id: &str,
    archive: &Path,
    entries: &[String],
) -> CommandResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    match archive_format(archive) {
        Some("zip" | "jar" | "war") if !crate::archive_provider::zip_uses_seven_zip() => {
            let zip = crate::archive_provider::require_tool("zip", archive)?;
            let mut command = Command::new(zip);
            command.arg("-d").arg("-q").arg(archive);
            for entry in entries {
                command.arg(entry);
            }
            run_external_command(operation_id, command, Some(archive))
        }
        Some("zip" | "jar" | "war" | "7z") => {
            let seven_zip = crate::archive_provider::require_tool("7z", archive)?;
            let mut command = Command::new(seven_zip);
            command.args(["d", "-y", "-spd", "-sccUTF-8"]).arg(archive);
            for entry in entries {
                command.arg(format!("-i!{entry}"));
            }
            run_external_command(operation_id, command, Some(archive))
        }
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(archive),
            true,
        )),
    }
}

pub(super) fn run_archive_add_entries(
    operation_id: &str,
    archive: &Path,
    staging: &Path,
    entries: &[String],
) -> CommandResult<()> {
    match archive_format(archive) {
        Some("zip" | "jar" | "war") if !crate::archive_provider::zip_uses_seven_zip() => {
            let zip = crate::archive_provider::require_tool("zip", archive)?;
            let mut command = Command::new(zip);
            command
                .current_dir(staging)
                .arg("-r")
                .arg("-q")
                .arg(archive);
            for entry in entries {
                command.arg(entry);
            }
            run_external_command(operation_id, command, Some(archive))
        }
        Some("zip" | "jar" | "war" | "7z") => {
            let seven_zip = crate::archive_provider::require_tool("7z", archive)?;
            let mut command = Command::new(seven_zip);
            command.current_dir(staging).args(["a", "-y", "-spd", "-sccUTF-8"]).arg(archive);
            for entry in entries {
                command.arg(format!("-i!{entry}"));
            }
            run_external_command(operation_id, command, Some(archive))
        }
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(archive),
            true,
        )),
    }
}

pub(super) fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

pub(super) fn list_archive_entry_names_for_operation(
    operation_id: &str,
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<Vec<String>> {
    match archive_format(archive) {
        Some("zip" | "jar" | "war") if !crate::archive_provider::zip_uses_seven_zip() => {
            list_zip_entries_for_operation(operation_id, archive, password)
        }
        Some("zip" | "jar" | "war" | "7z") => list_7z_entries_for_operation(operation_id, archive, password),
        Some("tar" | "tar.gz" | "tar.zst") if password.is_none() => {
            list_tar_entries_for_operation(operation_id, archive)
        }
        Some("tar" | "tar.gz" | "tar.zst") => Err(AppError::new(
            "unsupported",
            "errors.archivePasswordFormatUnsupported",
            Some(archive),
            true,
        )),
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(archive),
            true,
        )),
    }
}

pub(super) fn list_zip_entries_for_operation(
    operation_id: &str,
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<Vec<String>> {
    let command = crate::archive::zip_name_listing_command(archive);
    let stdout =
        run_external_command_capture_with_secret(operation_id, command, Some(archive), password)?;
    Ok(String::from_utf8_lossy(&stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

pub(super) fn list_7z_entries_for_operation(
    operation_id: &str,
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<Vec<String>> {
    let seven_zip = crate::archive_provider::require_tool("7z", archive)?;
    let mut command = Command::new(seven_zip);
    command.args(["l", "-slt", "-sccUTF-8"]);
    if let Some(password) = password {
        command.arg(format!("-p{password}"));
    }
    command.arg(archive);
    let stdout =
        run_external_command_capture_with_secret(operation_id, command, Some(archive), password)?;
    crate::archive::safe_7z_entry_names(&stdout, archive)
}

pub(super) fn list_tar_entries_for_operation(operation_id: &str, archive: &Path) -> CommandResult<Vec<String>> {
    let format = archive_format(archive).unwrap_or_default();
    let members = crate::archive_tar::list(archive, format, &|| is_cancelled(operation_id))
        .map_err(|error| map_tar_error(error, operation_id, archive))?;
    if let Some(member) = members.iter().find(|member| member.link || archive_entry_is_unsafe(&member.path)) {
        return Err(AppError::new("unsafe_archive_entry", "errors.archiveUnsafePath", Some(archive), true)
            .with_detail("entry", &member.path));
    }
    Ok(members.into_iter().map(|member| member.path).collect())
}

pub(super) fn archive_entry_is_unsafe(entry: &str) -> bool {
    archive_entry_is_unsafe_on(entry, cfg!(windows))
}

pub(super) fn archive_entry_is_unsafe_on(entry: &str, windows: bool) -> bool {
    crate::archive_provider::unsafe_entry(entry, windows)
}

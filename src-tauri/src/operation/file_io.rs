use crate::contracts::{AppError, CommandResult, OperationKind, OperationState};
use crate::filesystem::map_io_error;
use crate::mutation;
use crate::path_text::display_path;
use std::fs;
use std::io;
use std::io::Read;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::Ordering as AtomicOrdering;
use std::time::Duration;
use std::time::Instant;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use std::io::Write;

use super::runtime::should_cancel_for_test;
use super::runtime::{check_cancelled, emit_progress, is_cancelled, OperationStats, OP_COUNTER};
pub(super) const COPY_PROGRESS_CHUNK_BYTES: usize = 1024 * 1024;
pub(super) const COPY_PROGRESS_EMIT_INTERVAL_MS: u64 = 120;

#[derive(Debug, Clone)]
pub(super) struct WorkEntry {
    pub(super) source: PathBuf,
    pub(super) relative: PathBuf,
    pub(super) metadata: fs::Metadata,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum SpecialFileScanPolicy {
    Reject,
    IncludeForCopy,
}

pub(super) fn copy_tree(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    source_root: &Path,
    destination_parent: &Path,
    stats: &mut OperationStats,
    kind: OperationKind,
) -> CommandResult<()> {
    let source_name = source_root.file_name().ok_or_else(|| {
        AppError::new(
            "invalid_path",
            "errors.invalidPath",
            Some(source_root),
            true,
        )
    })?;
    copy_tree_to_destination(
        app,
        operation_id,
        source_root,
        &destination_parent.join(source_name),
        stats,
        kind,
    )
}

pub(super) fn copy_tree_replacing(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    source_root: &Path,
    destination_parent: &Path,
    destination: &Path,
    stats: &mut OperationStats,
    kind: OperationKind,
) -> CommandResult<()> {
    let temp_destination = unique_temp_target(destination_parent, destination);
    let mut staged_stats = stats.clone();
    let copy_result = copy_tree_to_destination(
        app,
        operation_id,
        source_root,
        &temp_destination,
        &mut staged_stats,
        kind,
    );
    if let Err(error) = copy_result {
        let _ = remove_entry_any(&temp_destination);
        return Err(error);
    }
    if is_cancelled(operation_id) {
        let _ = remove_entry_any(&temp_destination);
        return Err(AppError::new(
            "operation_cancelled",
            "errors.operationCancelled",
            Some(source_root),
            true,
        ));
    }
    if let Err(error) =
        publish_replacement(&temp_destination, destination, mutation::rename_no_replace)
    {
        let _ = remove_entry_any(&temp_destination);
        return Err(error);
    }
    *stats = staged_stats;
    Ok(())
}

// Keep the old entry until the staged copy has been published. If rollback is
// blocked by another writer, retain the backup and report its recovery path.
pub(super) fn publish_replacement<F>(
    staged: &Path,
    destination: &Path,
    publish: F,
) -> CommandResult<()>
where
    F: FnOnce(&Path, &Path) -> io::Result<()>,
{
    let backup = unique_temp_target(
        destination.parent().unwrap_or_else(|| Path::new(".")),
        destination,
    );
    mutation::rename_no_replace(destination, &backup)
        .map_err(|error| map_io_error(error, Some(destination)))?;
    if let Err(error) = publish(staged, destination) {
        let mut error = map_io_error(error, Some(destination));
        if let Err(rollback) = mutation::rename_no_replace(&backup, destination) {
            error = error
                .with_detail("backupPath", display_path(&backup))
                .with_detail("rollbackError", rollback.to_string());
        }
        return Err(error);
    }
    remove_entry_any(&backup).map_err(|error| {
        map_io_error(error, Some(&backup)).with_detail("backupPath", display_path(&backup))
    })?;
    Ok(())
}

pub(super) fn is_socket_file_type(file_type: &fs::FileType) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        file_type.is_socket()
    }
    #[cfg(not(unix))]
    {
        let _ = file_type;
        false
    }
}

pub(super) fn copy_tree_to_destination(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    source_root: &Path,
    destination_root: &Path,
    stats: &mut OperationStats,
    kind: OperationKind,
) -> CommandResult<()> {
    let mut work = Vec::new();
    let mut ignored_total_bytes = 0;
    scan_work(
        operation_id,
        source_root,
        Path::new(""),
        &mut work,
        &mut ignored_total_bytes,
        if kind == OperationKind::Copy {
            SpecialFileScanPolicy::IncludeForCopy
        } else {
            SpecialFileScanPolicy::Reject
        },
    )?;
    let mut progress_ticker = ProgressTicker::new();
    for entry in work {
        if is_cancelled(operation_id) || should_cancel_for_test(operation_id, stats) {
            return Err(AppError::new(
                "operation_cancelled",
                "errors.operationCancelled",
                Some(&entry.source),
                true,
            ));
        }
        let destination = if entry.relative.as_os_str().is_empty() {
            destination_root.to_path_buf()
        } else {
            destination_root.join(&entry.relative)
        };
        let file_type = entry.metadata.file_type();
        if file_type.is_dir() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
            }
            fs::create_dir(&destination)
                .map_err(|error| map_io_error(error, Some(&destination)))?;
        } else if file_type.is_symlink() {
            copy_symlink(&entry.source, &destination)?;
        } else if file_type.is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
            }
            copy_file_no_replace(&entry.source, &destination, |copied_bytes| {
                stats.completed_bytes = stats.completed_bytes.saturating_add(copied_bytes);
                if is_cancelled(operation_id) {
                    return Err(AppError::new(
                        "operation_cancelled",
                        "errors.operationCancelled",
                        Some(&entry.source),
                        true,
                    ));
                }
                if progress_ticker.should_emit() {
                    emit_progress(
                        app,
                        operation_id,
                        kind,
                        OperationState::Running,
                        stats,
                        Some(&entry.source),
                    );
                }
                Ok(())
            })?;
        } else {
            if kind == OperationKind::Copy && is_socket_file_type(&file_type) {
                stats.skipped_files += 1;
                continue;
            }
            if kind != OperationKind::Copy || entry.relative.as_os_str().is_empty() {
                return Err(AppError::new(
                    "unsupported",
                    "errors.specialFileCopyUnsupported",
                    Some(&entry.source),
                    true,
                ));
            }
            stats.failed_files += 1;
            stats.skipped_files += 1;
            stats.errors.push(AppError::new(
                "unsupported",
                "errors.specialFileCopySkipped",
                Some(&entry.source),
                true,
            ));
            continue;
        }
        stats.completed_files += 1;
        if progress_ticker.should_emit() {
            emit_progress(
                app,
                operation_id,
                kind,
                OperationState::Running,
                stats,
                Some(&entry.source),
            );
        }
    }
    emit_progress(
        app,
        operation_id,
        kind,
        OperationState::Running,
        stats,
        Some(source_root),
    );
    Ok(())
}

pub(super) fn copy_file_no_replace<F>(
    source: &Path,
    destination: &Path,
    mut on_chunk: F,
) -> CommandResult<()>
where
    F: FnMut(u64) -> CommandResult<()>,
{
    let mut source_file =
        fs::File::open(source).map_err(|error| map_io_error(error, Some(source)))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
        let mode = source_file
            .metadata()
            .map_err(|error| map_io_error(error, Some(source)))?
            .permissions()
            .mode();
        options.mode(mode);
    }
    let mut destination_file = options
        .open(destination)
        .map_err(|error| map_io_error(error, Some(destination)))?;
    let result: CommandResult<()> = (|| {
        let mut buffer = vec![0_u8; COPY_PROGRESS_CHUNK_BYTES];
        loop {
            let read = source_file
                .read(&mut buffer)
                .map_err(|error| map_io_error(error, Some(source)))?;
            if read == 0 {
                break;
            }
            destination_file
                .write_all(&buffer[..read])
                .map_err(|error| map_io_error(error, Some(destination)))?;
            on_chunk(read as u64)?;
        }
        let source_metadata = source_file.metadata().map_err(|error| map_io_error(error, Some(source)))?;
        crate::platform::copy_file_attributes(&destination_file, &source_metadata)
            .map_err(|error| map_io_error(error, Some(destination)))?;
        Ok(())
    })();
    drop(destination_file);
    if let Err(mut error) = result {
        if let Err(cleanup) = fs::remove_file(destination) {
            error = error
                .with_detail("partialPath", display_path(destination))
                .with_detail("cleanupError", cleanup.to_string());
        }
        return Err(error);
    }
    Ok(())
}

#[derive(Debug)]
pub(super) struct ProgressTicker {
    pub(super) last_emit: Instant,
    pub(super) interval: Duration,
}

impl ProgressTicker {
    pub(super) fn new() -> Self {
        Self {
            last_emit: Instant::now(),
            interval: Duration::from_millis(COPY_PROGRESS_EMIT_INTERVAL_MS),
        }
    }

    pub(super) fn should_emit(&mut self) -> bool {
        if self.last_emit.elapsed() < self.interval {
            return false;
        }
        self.last_emit = Instant::now();
        true
    }
}

pub(super) fn scan_work(
    operation_id: &str,
    source: &Path,
    relative: &Path,
    out: &mut Vec<WorkEntry>,
    total_bytes: &mut u64,
    special_file_policy: SpecialFileScanPolicy,
) -> CommandResult<()> {
    check_cancelled(operation_id, source)?;
    let metadata = crate::platform::entry_metadata(source)?;
    if !metadata.is_file()
        && !metadata.is_dir()
        && !metadata.file_type().is_symlink()
        && special_file_policy == SpecialFileScanPolicy::Reject
    {
        return Err(AppError::new(
            "unsupported",
            "errors.specialFileCopyUnsupported",
            Some(source),
            true,
        ));
    }
    if metadata.is_file() {
        *total_bytes += metadata.len();
    }
    out.push(WorkEntry {
        source: source.to_path_buf(),
        relative: relative.to_path_buf(),
        metadata: metadata.clone(),
    });
    if metadata.is_dir() {
        for child in fs::read_dir(source).map_err(|error| map_io_error(error, Some(source)))? {
            let child = child.map_err(|error| map_io_error(error, Some(source)))?;
            scan_work(
                operation_id,
                &child.path(),
                &relative.join(child.file_name()),
                out,
                total_bytes,
                special_file_policy,
            )?;
        }
    }
    Ok(())
}

pub(super) fn collect_source_paths(paths: &[String]) -> CommandResult<Vec<PathBuf>> {
    if paths.is_empty() {
        return Err(AppError::new(
            "invalid_path",
            "errors.emptyOperation",
            None,
            true,
        ));
    }
    paths
        .iter()
        .map(|path| canonical_existing_entry(path))
        .collect()
}

pub(super) use crate::navigation::canonical_existing_entry;

pub(super) use crate::navigation::canonical_existing_directory;

pub(super) fn same_path(left: &Path, right: &Path) -> bool {
    left == right || same_file::is_same_file(left, right).unwrap_or(false)
}

pub(super) fn path_is_within(path: &Path, ancestor: &Path) -> bool {
    path.ancestors().any(|candidate| same_path(candidate, ancestor))
}

pub(super) fn path_is_occupied(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

pub(super) fn remove_entry_any(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    #[cfg(windows)]
    {
        use std::os::windows::fs::FileTypeExt;
        if metadata.file_type().is_symlink_dir() { return fs::remove_dir(path); }
    }
    if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(unix)]
pub(super) fn copy_symlink(source: &Path, destination: &Path) -> CommandResult<()> {
    use std::os::unix::fs::symlink;
    let target = fs::read_link(source).map_err(|error| map_io_error(error, Some(source)))?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
    }
    symlink(target, destination).map_err(|error| map_io_error(error, Some(destination)))
}

#[cfg(windows)]
pub(super) fn copy_symlink(source: &Path, destination: &Path) -> CommandResult<()> {
    use std::os::windows::fs::{FileTypeExt, symlink_dir, symlink_file};
    let metadata = crate::platform::entry_metadata(source)?;
    let target = fs::read_link(source).map_err(|e| map_io_error(e, Some(source)))?;
    let result = if metadata.file_type().is_symlink_dir() {
        symlink_dir(target, destination)
    } else {
        symlink_file(target, destination)
    };
    result.map_err(|e| map_io_error(e, Some(destination)))
}

#[cfg(not(any(unix, windows)))]
pub(super) fn copy_symlink(source: &Path, _destination: &Path) -> CommandResult<()> {
    Err(AppError::new(
        "unsupported",
        "errors.symlinkCopyUnsupported",
        Some(source),
        true,
    ))
}

pub(crate) fn guard_delete_target(path: &Path) -> CommandResult<()> {
    if path.parent().is_none() || path == Path::new("/") || is_protected_delete_path(path) {
        return Err(AppError::new(
            "invalid_path",
            "errors.protectedPath",
            Some(path),
            true,
        ));
    }
    Ok(())
}

pub(super) fn is_protected_delete_path(path: &Path) -> bool {
    crate::platform::protected_delete_path(path)
}

pub(super) fn count_entries_and_bytes(
    operation_id: &str,
    path: &Path,
    total_bytes: &mut u64,
) -> CommandResult<u64> {
    check_cancelled(operation_id, path)?;
    let metadata = crate::platform::entry_metadata(path)?;
    if metadata.is_file() {
        *total_bytes += metadata.len();
    }
    if !metadata.is_dir() {
        return Ok(1);
    }
    let mut total = 1;
    for child in fs::read_dir(path).map_err(|error| map_io_error(error, Some(path)))? {
        let child = child.map_err(|error| map_io_error(error, Some(path)))?;
        total += count_entries_and_bytes(operation_id, &child.path(), total_bytes)?;
    }
    Ok(total)
}

pub(super) fn unique_temp_target(parent: &Path, destination: &Path) -> PathBuf {
    let name = destination
        .file_name()
        .map(|value| value.to_string_lossy())
        .unwrap_or_else(|| "entry".into());
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let counter = OP_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
    parent.join(format!(".boksldirgui-op-{nonce}-{counter}-{name}"))
}

pub(crate) fn is_cross_device_error(error: &io::Error) -> bool {
    crate::platform::cross_device_error(error.raw_os_error(), cfg!(windows))
}

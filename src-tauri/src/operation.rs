use super::*;
use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Condvar};
use std::thread;
use std::time::Duration;

static OP_COUNTER: AtomicU64 = AtomicU64::new(0);
static CANCELLED: OnceLock<Mutex<BTreeMap<String, bool>>> = OnceLock::new();
static CONFLICTS: OnceLock<(Mutex<BTreeMap<String, ConflictState>>, Condvar)> = OnceLock::new();
static EXTERNAL_PROCESSES: OnceLock<Mutex<BTreeMap<String, Arc<Mutex<Child>>>>> = OnceLock::new();
const PERMANENT_DELETE_CONFIRM_TOKEN: &str = "PERMANENT_DELETE";
const CONFLICT_WAIT_POLL_MS: u64 = 200;

#[derive(Debug, Clone, Default)]
struct ConflictState {
    pending_decision: Option<ConflictDecision>,
    apply_all_decision: Option<ConflictDecision>,
}

#[derive(Debug, Clone)]
struct WorkEntry {
    source: PathBuf,
    relative: PathBuf,
    metadata: fs::Metadata,
}

#[derive(Debug, Clone)]
struct OperationStats {
    total_files: u64,
    total_bytes: u64,
    completed_files: u64,
    completed_bytes: u64,
    failed_files: u64,
    errors: Vec<AppError>,
    started_at: Instant,
    cancel_after_completed: Option<u64>,
}

impl OperationStats {
    fn new(total_files: u64, total_bytes: u64) -> Self {
        Self {
            total_files,
            total_bytes,
            completed_files: 0,
            completed_bytes: 0,
            failed_files: 0,
            errors: Vec::new(),
            started_at: Instant::now(),
            cancel_after_completed: None,
        }
    }
}

pub(super) fn start_copy(
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

pub(super) fn start_move(
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

pub(super) fn start_delete(
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

pub(super) fn start_archive_create(
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

pub(super) fn start_archive_extract(
    app: Option<&tauri::AppHandle>,
    archive_path: String,
    target_dir: String,
    password: Option<String>,
    policy: ConflictDecision,
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
        );
        emit_summary(app, &summary);
        finish_operation(&operation_id);
    }
    Ok(started)
}

pub(super) fn cancel_operation(operation_id: String) -> CommandResult<CancelAck> {
    let registered = {
        let mut guard = cancelled_registry()
            .lock()
            .expect("cancel registry lock should not be poisoned");
        match guard.get_mut(&operation_id) {
            Some(cancelled) => {
                *cancelled = true;
                true
            }
            None => false,
        }
    };
    if registered {
        kill_registered_external_process(&operation_id);
        let (_, cvar) = conflict_registry();
        cvar.notify_all();
    }
    Ok(CancelAck {
        operation_id,
        state: if registered {
            OperationState::Cancelling
        } else {
            OperationState::Cancelled
        },
    })
}

pub(super) fn resolve_conflict(
    operation_id: String,
    decision: ConflictDecision,
) -> CommandResult<ConflictAck> {
    let (lock, cvar) = conflict_registry();
    let mut guard = lock
        .lock()
        .expect("conflict registry lock should not be poisoned");
    if let Some(state) = guard.get_mut(&operation_id) {
        if decision == ConflictDecision::AllOverwrite || decision == ConflictDecision::AllSkip {
            state.apply_all_decision = Some(decision);
        }
        state.pending_decision = Some(decision);
        cvar.notify_all();
    }
    Ok(ConflictAck {
        operation_id,
        decision,
    })
}

fn run_copy(
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
        if source.is_dir() && target_dir.starts_with(source) {
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
        scan_work(source, Path::new(source_name), &mut work, &mut total_bytes)
            .map_err(|error| error_summary(operation_id, kind, error))?;
    }
    let mut stats = OperationStats::new(work.len() as u64, total_bytes);
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
        if same_path(source, &destination) {
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
            ConflictDecision::Skip | ConflictDecision::AllSkip => continue,
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

fn run_move(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    sources: &[String],
    target_dir: &str,
    policy: ConflictDecision,
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
        if source.is_dir() && target_dir.starts_with(source) {
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
        if let Err(error) = scan_work(source, &name, &mut work, &mut total_bytes) {
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
            ConflictDecision::Skip | ConflictDecision::AllSkip => continue,
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
        let source_entries = match count_entries_and_bytes(source, &mut source_bytes) {
            Ok(count) => count,
            Err(error) => {
                stats.failed_files += 1;
                stats.errors.push(map_io_error(error, Some(source)));
                continue;
            }
        };
        match mutation::rename_no_replace(source, &destination) {
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

fn run_delete(
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
        match count_entries_and_bytes(target, &mut total_bytes) {
            Ok(count) => {
                total_files += count;
                target_counts.insert(target.clone(), count);
            }
            Err(error) => {
                return error_summary(operation_id, kind, map_io_error(error, Some(target)))
            }
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

    let trash_dir = if mode == DeleteMode::Trash {
        match trash_directory() {
            Ok(path) => Some(path),
            Err(error) => return error_summary(operation_id, kind, error),
        }
    } else {
        None
    };

    for target in &targets {
        if is_cancelled(operation_id) {
            return cancel_summary(operation_id, kind, &stats);
        }
        let result = if let Some(trash_dir) = trash_dir.as_ref() {
            let trash_target = unique_trash_target(trash_dir, target);
            fs::rename(target, trash_target).map_err(|error| map_io_error(error, Some(target)))
        } else {
            remove_entry_any(target).map_err(|error| map_io_error(error, Some(target)))
        };
        match result {
            Ok(()) => {
                stats.completed_files += target_counts.get(target).copied().unwrap_or(1);
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
                stats.failed_files += 1;
                stats.errors.push(error);
            }
        }
    }
    summary_from_stats(operation_id, kind, &stats)
}

fn run_archive_create(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> OperationSummary {
    let kind = OperationKind::ArchiveCreate;
    if password.as_deref().is_some_and(|value| !value.is_empty()) {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsupported",
                "errors.archivePasswordCreateUnsupported",
                None,
                true,
            ),
        );
    }
    let sources = match collect_source_paths(&sources) {
        Ok(paths) => paths,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let target = PathBuf::from(&target_archive);
    let parent = match target.parent() {
        Some(parent) => match navigation::canonical_existing_path(&parent.to_string_lossy()) {
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
    if !parent.is_dir() {
        return error_summary(
            operation_id,
            kind,
            AppError::new("not_directory", "errors.notDirectory", Some(&parent), true),
        );
    }
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

    let total_bytes = sources
        .iter()
        .filter_map(|path| fs::metadata(path).ok())
        .map(|metadata| metadata.len())
        .sum();
    let mut stats = OperationStats::new(sources.len() as u64, total_bytes);
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

    let archive_format = format.to_ascii_lowercase();
    let command_result = if archive_format == "zip"
        || target.extension().and_then(|value| value.to_str()) == Some("zip")
    {
        run_zip_create(operation_id, &target, &sources)
    } else if archive_format == "7z"
        || target.extension().and_then(|value| value.to_str()) == Some("7z")
    {
        run_7z_create(operation_id, &target, &sources)
    } else {
        Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(&target),
            true,
        )
        .with_detail("format", archive_format))
    };

    match command_result {
        Ok(()) => {
            stats.completed_files = sources.len() as u64;
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

fn run_archive_extract(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    archive_path: String,
    target_dir: String,
    password: Option<String>,
    policy: ConflictDecision,
) -> OperationSummary {
    let kind = OperationKind::ArchiveExtract;
    if password.as_deref().is_some_and(|value| !value.is_empty()) {
        return error_summary(
            operation_id,
            kind,
            AppError::new(
                "unsupported",
                "errors.archivePasswordExtractUnsupported",
                None,
                true,
            ),
        );
    }
    let archive = match navigation::canonical_existing_path(&archive_path) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let target_candidate = PathBuf::from(&target_dir);
    if !target_candidate.exists() {
        if let Err(error) = fs::create_dir_all(&target_candidate) {
            return error_summary(
                operation_id,
                kind,
                map_io_error(error, Some(&target_candidate)),
            );
        }
    }
    let target = match navigation::canonical_existing_path(&target_dir) {
        Ok(path) => path,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    if !target.is_dir() {
        return error_summary(
            operation_id,
            kind,
            AppError::new("not_directory", "errors.notDirectory", Some(&target), true),
        );
    }

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

    let entries = match list_archive_entry_names_for_operation(operation_id, &archive) {
        Ok(entries) => entries,
        Err(error) if is_operation_cancelled_error(&error) => {
            return cancel_summary(operation_id, kind, &stats)
        }
        Err(error) => return error_summary(operation_id, kind, error),
    };
    if let Some(unsafe_entry) = entries.iter().find(|entry| archive_entry_is_unsafe(entry)) {
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

    let command_result = if archive.extension().and_then(|value| value.to_str()) == Some("zip") {
        run_zip_extract(operation_id, &archive, &target, policy)
    } else if archive.extension().and_then(|value| value.to_str()) == Some("7z") {
        run_7z_extract(operation_id, &archive, &target, policy)
    } else {
        Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(&archive),
            true,
        ))
    };

    match command_result {
        Ok(()) => {
            stats.completed_files = entries.len() as u64;
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

fn run_zip_create(operation_id: &str, target: &Path, sources: &[PathBuf]) -> CommandResult<()> {
    let zip = external_binary("zip").ok_or_else(|| {
        AppError::new(
            "unsupported",
            "errors.archiveProviderUnavailable",
            Some(target),
            true,
        )
        .with_detail("provider", "zip")
    })?;
    let working_dir = common_source_parent(sources, target)?;
    let mut command = Command::new(zip);
    command.current_dir(&working_dir);
    command.arg("-r").arg("-q").arg(target);
    for source in sources {
        command.arg(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?);
    }
    run_external_command(operation_id, command, Some(target))
}

fn run_7z_create(operation_id: &str, target: &Path, sources: &[PathBuf]) -> CommandResult<()> {
    let seven_zip = external_binary("7zz")
        .or_else(|| external_binary("7z"))
        .ok_or_else(|| {
            AppError::new(
                "unsupported",
                "errors.archiveProviderUnavailable",
                Some(target),
                true,
            )
            .with_detail("provider", "7z")
        })?;
    let working_dir = common_source_parent(sources, target)?;
    let mut command = Command::new(seven_zip);
    command.current_dir(&working_dir);
    command.arg("a").arg("-y").arg(target);
    for source in sources {
        command.arg(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?);
    }
    run_external_command(operation_id, command, Some(target))
}

fn common_source_parent(sources: &[PathBuf], target: &Path) -> CommandResult<PathBuf> {
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

fn run_zip_extract(
    operation_id: &str,
    archive: &Path,
    target: &Path,
    policy: ConflictDecision,
) -> CommandResult<()> {
    let unzip = external_binary("unzip").ok_or_else(|| {
        AppError::new(
            "unsupported",
            "errors.archiveProviderUnavailable",
            Some(archive),
            true,
        )
        .with_detail("provider", "unzip")
    })?;
    let mut command = Command::new(unzip);
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
    command.arg("-q").arg(archive).arg("-d").arg(target);
    run_external_command(operation_id, command, Some(archive))
}

fn run_7z_extract(
    operation_id: &str,
    archive: &Path,
    target: &Path,
    policy: ConflictDecision,
) -> CommandResult<()> {
    let seven_zip = external_binary("7zz")
        .or_else(|| external_binary("7z"))
        .ok_or_else(|| {
            AppError::new(
                "unsupported",
                "errors.archiveProviderUnavailable",
                Some(archive),
                true,
            )
            .with_detail("provider", "7z")
        })?;
    let mut command = Command::new(seven_zip);
    command.arg("x");
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
    run_external_command(operation_id, command, Some(archive))
}

fn list_archive_entry_names_for_operation(
    operation_id: &str,
    archive: &Path,
) -> CommandResult<Vec<String>> {
    match archive
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("zip") => list_zip_entries_for_operation(operation_id, archive),
        Some("7z") => list_7z_entries_for_operation(operation_id, archive),
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(archive),
            true,
        )),
    }
}

fn list_zip_entries_for_operation(
    operation_id: &str,
    archive: &Path,
) -> CommandResult<Vec<String>> {
    let unzip = external_binary("unzip").ok_or_else(|| {
        AppError::new(
            "unsupported",
            "errors.archiveProviderUnavailable",
            Some(archive),
            true,
        )
        .with_detail("provider", "unzip")
    })?;
    let mut command = Command::new(unzip);
    command.arg("-Z1").arg(archive);
    let stdout = run_external_command_capture(operation_id, command, Some(archive))?;
    Ok(String::from_utf8_lossy(&stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn list_7z_entries_for_operation(operation_id: &str, archive: &Path) -> CommandResult<Vec<String>> {
    let seven_zip = external_binary("7zz")
        .or_else(|| external_binary("7z"))
        .ok_or_else(|| {
            AppError::new(
                "unsupported",
                "errors.archiveProviderUnavailable",
                Some(archive),
                true,
            )
            .with_detail("provider", "7z")
        })?;
    let mut command = Command::new(seven_zip);
    command.arg("l").arg("-slt").arg(archive);
    let stdout = run_external_command_capture(operation_id, command, Some(archive))?;
    Ok(super::archive::parse_7z_slt_paths(&stdout))
}

fn run_external_command(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
) -> CommandResult<()> {
    run_external_command_capture(operation_id, command, path).map(|_| ())
}

fn run_external_command_capture(
    operation_id: &str,
    mut command: Command,
    path: Option<&Path>,
) -> CommandResult<Vec<u8>> {
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| map_io_error(error, path))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let mut stdout_reader = stdout.map(|mut stdout| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stdout.read_to_end(&mut bytes);
            bytes
        })
    });
    let mut stderr_reader = stderr.map(|mut stderr| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stderr.read_to_end(&mut bytes);
            bytes
        })
    });
    let child_handle = Arc::new(Mutex::new(child));
    register_external_process(operation_id, Arc::clone(&child_handle));

    let status = loop {
        if is_cancelled(operation_id) {
            kill_external_child(&child_handle);
        }
        let status = match child_handle
            .lock()
            .expect("external process lock should not be poisoned")
            .try_wait()
        {
            Ok(status) => status,
            Err(error) => {
                kill_external_child(&child_handle);
                unregister_external_process(operation_id);
                if let Some(reader) = stdout_reader.take() {
                    let _ = reader.join();
                }
                if let Some(reader) = stderr_reader.take() {
                    let _ = reader.join();
                }
                return Err(map_io_error(error, path));
            }
        };
        if let Some(status) = status {
            break status;
        }
        thread::sleep(Duration::from_millis(50));
    };
    unregister_external_process(operation_id);

    let stdout = match stdout_reader.take() {
        Some(reader) => reader.join().unwrap_or_default(),
        None => Vec::new(),
    };
    let stderr = match stderr_reader.take() {
        Some(reader) => reader.join().unwrap_or_default(),
        None => Vec::new(),
    };

    if is_cancelled(operation_id) {
        return Err(AppError::new(
            "operation_cancelled",
            "errors.operationCancelled",
            path,
            true,
        ));
    }
    if status.success() {
        return Ok(stdout);
    }
    Err(AppError::new(
        "external_command_failed",
        "errors.externalCommandFailed",
        path,
        true,
    )
    .with_detail(
        "exitCode",
        status
            .code()
            .map_or_else(|| "signal".to_string(), |code| code.to_string()),
    )
    .with_detail(
        "stderr",
        String::from_utf8_lossy(&stderr)
            .chars()
            .take(512)
            .collect::<String>(),
    ))
}

fn external_binary(name: &str) -> Option<String> {
    let path_var = env::var_os("PATH")?;
    for dir in env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(display_path(&candidate));
        }
    }
    None
}

fn archive_entry_is_unsafe(entry: &str) -> bool {
    let path = Path::new(entry);
    path.is_absolute()
        || path
            .components()
            .any(|component| matches!(component, std::path::Component::ParentDir))
        || entry.contains('\0')
}

#[cfg(test)]
pub(super) fn archive_entry_is_unsafe_for_test(entry: &str) -> bool {
    archive_entry_is_unsafe(entry)
}

#[cfg(test)]
pub(super) fn archive_create_summary_for_test(
    sources: Vec<String>,
    target_archive: String,
    format: String,
    password: Option<String>,
) -> OperationSummary {
    run_archive_create(
        None,
        "archive-create-test",
        sources,
        target_archive,
        format,
        password,
    )
}

#[cfg(test)]
pub(super) fn external_archive_command_cancel_for_test() -> Option<(CommandResult<()>, Duration)> {
    let sleep = external_binary("sleep")?;
    let operation_id = next_operation_id(OperationKind::ArchiveCreate);
    register_operation(&operation_id);
    let worker_operation_id = operation_id.clone();
    let worker = thread::spawn(move || {
        let started_at = Instant::now();
        let mut command = Command::new(sleep);
        command.arg("10");
        let result = run_external_command(&worker_operation_id, command, None);
        (result, started_at.elapsed())
    });
    thread::sleep(Duration::from_millis(150));
    let _ = cancel_operation(operation_id.clone());
    let outcome = worker
        .join()
        .expect("external cancel test worker should finish");
    finish_operation(&operation_id);
    Some(outcome)
}

#[cfg(test)]
pub(super) fn archive_entry_listing_cancel_for_test(
    archive: PathBuf,
) -> (CommandResult<Vec<String>>, Duration) {
    let operation_id = next_operation_id(OperationKind::ArchiveExtract);
    register_operation(&operation_id);
    let worker_operation_id = operation_id.clone();
    let worker = thread::spawn(move || {
        let started_at = Instant::now();
        let result = list_archive_entry_names_for_operation(&worker_operation_id, &archive);
        (result, started_at.elapsed())
    });
    thread::sleep(Duration::from_millis(150));
    let _ = cancel_operation(operation_id.clone());
    let outcome = worker
        .join()
        .expect("archive listing cancel test worker should finish");
    finish_operation(&operation_id);
    outcome
}

fn copy_tree(
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

fn copy_tree_replacing(
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
    if let Err(error) = remove_entry_any(destination) {
        let _ = remove_entry_any(&temp_destination);
        return Err(map_io_error(error, Some(destination)));
    }
    if let Err(error) = fs::rename(&temp_destination, destination) {
        let _ = remove_entry_any(&temp_destination);
        return Err(map_io_error(error, Some(destination)));
    }
    *stats = staged_stats;
    Ok(())
}

fn copy_tree_to_destination(
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
        source_root,
        Path::new(""),
        &mut work,
        &mut ignored_total_bytes,
    )?;
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
            fs::create_dir_all(&destination)
                .map_err(|error| map_io_error(error, Some(&destination)))?;
        } else if file_type.is_symlink() {
            copy_symlink(&entry.source, &destination)?;
        } else if file_type.is_file() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
            }
            copy_file_no_replace(&entry.source, &destination)?;
            stats.completed_bytes += entry.metadata.len();
        }
        stats.completed_files += 1;
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
}

fn copy_file_no_replace(source: &Path, destination: &Path) -> CommandResult<()> {
    let mut source_file =
        fs::File::open(source).map_err(|error| map_io_error(error, Some(source)))?;
    let mut destination_file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(destination)
        .map_err(|error| map_io_error(error, Some(destination)))?;
    io::copy(&mut source_file, &mut destination_file)
        .map_err(|error| map_io_error(error, Some(destination)))?;
    Ok(())
}

fn scan_work(
    source: &Path,
    relative: &Path,
    out: &mut Vec<WorkEntry>,
    total_bytes: &mut u64,
) -> CommandResult<()> {
    let metadata =
        fs::symlink_metadata(source).map_err(|error| map_io_error(error, Some(source)))?;
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
                &child.path(),
                &relative.join(child.file_name()),
                out,
                total_bytes,
            )?;
        }
    }
    Ok(())
}

fn collect_source_paths(paths: &[String]) -> CommandResult<Vec<PathBuf>> {
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

fn canonical_existing_entry(path: &str) -> CommandResult<PathBuf> {
    let raw = PathBuf::from(path);
    let parent = raw
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "errors.invalidPath", Some(&raw), true))?;
    let name = raw
        .file_name()
        .ok_or_else(|| AppError::new("invalid_path", "errors.invalidPath", Some(&raw), true))?;
    let parent = navigation::canonical_existing_path(&parent.to_string_lossy())?;
    let entry = parent.join(name);
    fs::symlink_metadata(&entry).map_err(|error| map_io_error(error, Some(&entry)))?;
    Ok(entry)
}

fn canonical_existing_directory(path: &str) -> CommandResult<PathBuf> {
    let path = navigation::canonical_existing_path(path)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&path),
            true,
        ));
    }
    Ok(path)
}

fn handle_conflict(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    source: &Path,
    destination: &Path,
    policy: ConflictDecision,
    stats: &mut OperationStats,
    kind: OperationKind,
) -> ConflictDecision {
    if !path_is_occupied(destination) {
        return ConflictDecision::Overwrite;
    }
    if let (Ok(source_entry), Ok(destination_entry)) = (
        file_entry_from_path(source, false),
        file_entry_from_path(destination, false),
    ) {
        emit_conflict(
            app,
            ConflictPrompt {
                operation_id: operation_id.to_string(),
                source: source_entry,
                destination: destination_entry,
                default_decision: policy,
                available_decisions: vec![
                    ConflictDecision::Overwrite,
                    ConflictDecision::Skip,
                    ConflictDecision::AllOverwrite,
                    ConflictDecision::AllSkip,
                    ConflictDecision::Cancel,
                ],
            },
        );
        emit_progress(
            app,
            operation_id,
            kind,
            OperationState::WaitingForConflict,
            stats,
            Some(source),
        );
    }
    if app.is_some() {
        wait_for_conflict_decision(operation_id, policy)
    } else {
        policy
    }
}

fn same_path(left: &Path, right: &Path) -> bool {
    match (left.canonicalize(), right.canonicalize()) {
        (Ok(left), Ok(right)) => left == right,
        _ => left == right,
    }
}

fn path_is_occupied(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn remove_entry_any(path: &Path) -> io::Result<()> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_dir() {
        fs::remove_dir_all(path)
    } else {
        fs::remove_file(path)
    }
}

#[cfg(unix)]
fn copy_symlink(source: &Path, destination: &Path) -> CommandResult<()> {
    use std::os::unix::fs::symlink;
    let target = fs::read_link(source).map_err(|error| map_io_error(error, Some(source)))?;
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
    }
    symlink(target, destination).map_err(|error| map_io_error(error, Some(destination)))
}

#[cfg(not(unix))]
fn copy_symlink(source: &Path, _destination: &Path) -> CommandResult<()> {
    Err(AppError::new(
        "unsupported",
        "errors.symlinkCopyUnsupported",
        Some(source),
        true,
    ))
}

pub(super) fn guard_delete_target(path: &Path) -> CommandResult<()> {
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

fn is_protected_delete_path(path: &Path) -> bool {
    const PROTECTED_UNIX_PATHS: &[&str] = &[
        "/Applications",
        "/bin",
        "/etc",
        "/Library",
        "/Network",
        "/private",
        "/sbin",
        "/System",
        "/usr",
        "/Users",
        "/var",
        "/Volumes",
    ];
    if PROTECTED_UNIX_PATHS
        .iter()
        .any(|protected| path == Path::new(protected))
    {
        return true;
    }
    env::var_os("HOME")
        .map(PathBuf::from)
        .is_some_and(|home| path == home)
}

fn trash_directory() -> CommandResult<PathBuf> {
    if let Some(path) = env::var_os("BOKSLDIRGUI_TRASH_DIR") {
        let path = PathBuf::from(path);
        fs::create_dir_all(&path).map_err(|error| map_io_error(error, Some(&path)))?;
        return Ok(path);
    }
    #[cfg(target_os = "macos")]
    let candidate = env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".Trash"));
    #[cfg(target_os = "linux")]
    let candidate = env::var_os("HOME")
        .map(PathBuf::from)
        .map(|home| home.join(".local/share/Trash/files"));
    #[cfg(windows)]
    let candidate: Option<PathBuf> = None;
    #[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
    let candidate: Option<PathBuf> = None;
    let Some(candidate) = candidate else {
        return Err(AppError::new(
            "unsupported",
            "errors.trashUnsupported",
            None,
            true,
        ));
    };
    fs::create_dir_all(&candidate).map_err(|error| map_io_error(error, Some(&candidate)))?;
    Ok(candidate)
}

fn unique_trash_target(trash_dir: &Path, source: &Path) -> PathBuf {
    let name = source.file_name().unwrap_or_default().to_string_lossy();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    trash_dir.join(format!("BokslDirGUI-{nonce}-{name}"))
}

fn count_entries_and_bytes(path: &Path, total_bytes: &mut u64) -> io::Result<u64> {
    let metadata = fs::symlink_metadata(path)?;
    if metadata.is_file() {
        *total_bytes += metadata.len();
    }
    if !metadata.is_dir() {
        return Ok(1);
    }
    let mut total = 1;
    for child in fs::read_dir(path)? {
        total += count_entries_and_bytes(&child?.path(), total_bytes)?;
    }
    Ok(total)
}

fn unique_temp_target(parent: &Path, destination: &Path) -> PathBuf {
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

fn wait_for_conflict_decision(
    operation_id: &str,
    default_decision: ConflictDecision,
) -> ConflictDecision {
    let (lock, cvar) = conflict_registry();
    let mut guard = lock
        .lock()
        .expect("conflict registry lock should not be poisoned");
    loop {
        if is_cancelled(operation_id) {
            return ConflictDecision::Cancel;
        }
        if !is_operation_registered(operation_id) {
            return ConflictDecision::Cancel;
        }
        let state = guard.entry(operation_id.to_string()).or_default();
        if let Some(decision) = state.apply_all_decision {
            return decision;
        }
        if let Some(decision) = state.pending_decision.take() {
            return decision;
        }
        if default_decision == ConflictDecision::AllOverwrite
            || default_decision == ConflictDecision::AllSkip
        {
            state.apply_all_decision = Some(default_decision);
            return default_decision;
        }
        guard = cvar
            .wait_timeout(guard, Duration::from_millis(CONFLICT_WAIT_POLL_MS))
            .expect("conflict registry lock should not be poisoned")
            .0;
    }
}

fn conflict_registry() -> &'static (Mutex<BTreeMap<String, ConflictState>>, Condvar) {
    CONFLICTS.get_or_init(|| (Mutex::new(BTreeMap::new()), Condvar::new()))
}

fn next_operation_id(kind: OperationKind) -> String {
    let prefix = match kind {
        OperationKind::Copy => "copy",
        OperationKind::Move => "move",
        OperationKind::Delete => "delete",
        OperationKind::Trash => "trash",
        OperationKind::Rename => "rename",
        OperationKind::CreateDir => "create-dir",
        OperationKind::ArchiveCreate => "archive-create",
        OperationKind::ArchiveExtract => "archive-extract",
    };
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let counter = OP_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
    format!("op-{prefix}-{nonce}-{counter}")
}

fn register_operation(operation_id: &str) {
    cancelled_registry()
        .lock()
        .expect("cancel registry lock should not be poisoned")
        .insert(operation_id.to_string(), false);
    conflict_registry()
        .0
        .lock()
        .expect("conflict registry lock should not be poisoned")
        .insert(operation_id.to_string(), ConflictState::default());
}

fn finish_operation(operation_id: &str) {
    unregister_external_process(operation_id);
    cancelled_registry()
        .lock()
        .expect("cancel registry lock should not be poisoned")
        .remove(operation_id);
    conflict_registry()
        .0
        .lock()
        .expect("conflict registry lock should not be poisoned")
        .remove(operation_id);
}

fn is_cancelled(operation_id: &str) -> bool {
    cancelled_registry()
        .lock()
        .expect("cancel registry lock should not be poisoned")
        .get(operation_id)
        .copied()
        .unwrap_or(false)
}

fn is_operation_registered(operation_id: &str) -> bool {
    cancelled_registry()
        .lock()
        .expect("cancel registry lock should not be poisoned")
        .contains_key(operation_id)
}

fn is_operation_cancelled_error(error: &AppError) -> bool {
    error.code == "operation_cancelled"
}

fn should_cancel_for_test(operation_id: &str, stats: &OperationStats) -> bool {
    let should_cancel = stats
        .cancel_after_completed
        .is_some_and(|limit| stats.completed_files >= limit);
    if should_cancel {
        let _ = cancel_operation(operation_id.to_string());
    }
    should_cancel
}

fn cancelled_registry() -> &'static Mutex<BTreeMap<String, bool>> {
    CANCELLED.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn external_process_registry() -> &'static Mutex<BTreeMap<String, Arc<Mutex<Child>>>> {
    EXTERNAL_PROCESSES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn register_external_process(operation_id: &str, child: Arc<Mutex<Child>>) {
    external_process_registry()
        .lock()
        .expect("external process registry lock should not be poisoned")
        .insert(operation_id.to_string(), child);
}

fn unregister_external_process(operation_id: &str) {
    external_process_registry()
        .lock()
        .expect("external process registry lock should not be poisoned")
        .remove(operation_id);
}

fn kill_registered_external_process(operation_id: &str) {
    let child = external_process_registry()
        .lock()
        .expect("external process registry lock should not be poisoned")
        .get(operation_id)
        .cloned();
    if let Some(child) = child {
        kill_external_child(&child);
    }
}

fn kill_external_child(child: &Arc<Mutex<Child>>) {
    let _ = child
        .lock()
        .expect("external process lock should not be poisoned")
        .kill();
}

fn summary_from_stats(
    operation_id: &str,
    kind: OperationKind,
    stats: &OperationStats,
) -> OperationSummary {
    let state = if stats.errors.is_empty() && stats.failed_files == 0 {
        OperationState::Completed
    } else if stats.completed_files > 0 {
        OperationState::CompletedWithErrors
    } else {
        OperationState::Failed
    };
    OperationSummary {
        operation_id: operation_id.to_string(),
        kind,
        state,
        completed_files: stats.completed_files,
        failed_files: stats.failed_files,
        errors: stats.errors.clone(),
    }
}

fn error_summary(operation_id: &str, kind: OperationKind, error: AppError) -> OperationSummary {
    OperationSummary {
        operation_id: operation_id.to_string(),
        kind,
        state: OperationState::Failed,
        completed_files: 0,
        failed_files: 1,
        errors: vec![error],
    }
}

fn cancel_summary(
    operation_id: &str,
    kind: OperationKind,
    stats: &OperationStats,
) -> OperationSummary {
    OperationSummary {
        operation_id: operation_id.to_string(),
        kind,
        state: OperationState::Cancelled,
        completed_files: stats.completed_files,
        failed_files: stats.failed_files,
        errors: stats.errors.clone(),
    }
}

fn emit_state(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    kind: OperationKind,
    state: OperationState,
    total_files: Option<u64>,
    completed_files: u64,
    completed_bytes: u64,
    current_path: Option<&Path>,
) {
    let progress = OperationProgress {
        operation_id: operation_id.to_string(),
        kind,
        state,
        total_files,
        completed_files,
        total_bytes: None,
        completed_bytes,
        current_path: current_path.map(display_path),
        bytes_per_second: None,
        eta_seconds: None,
        recent_error_count: 0,
    };
    emit_progress_payload(app, &progress);
}

fn emit_progress(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    kind: OperationKind,
    state: OperationState,
    stats: &OperationStats,
    current_path: Option<&Path>,
) {
    let elapsed = stats.started_at.elapsed().as_secs().max(1);
    let bytes_per_second = if stats.completed_bytes > 0 {
        Some(stats.completed_bytes / elapsed)
    } else {
        None
    };
    let eta_seconds = match (
        bytes_per_second,
        stats.total_bytes.checked_sub(stats.completed_bytes),
    ) {
        (Some(rate), Some(remaining)) if rate > 0 => Some(remaining / rate),
        _ => None,
    };
    let progress = OperationProgress {
        operation_id: operation_id.to_string(),
        kind,
        state,
        total_files: Some(stats.total_files),
        completed_files: stats.completed_files,
        total_bytes: Some(stats.total_bytes),
        completed_bytes: stats.completed_bytes,
        current_path: current_path.map(display_path),
        bytes_per_second,
        eta_seconds,
        recent_error_count: stats.errors.len() as u64,
    };
    emit_progress_payload(app, &progress);
}

fn emit_progress_payload(app: Option<&tauri::AppHandle>, progress: &OperationProgress) {
    if let Some(app) = app {
        let _ = app.emit("operation_progress", progress);
    }
}

fn emit_conflict(app: Option<&tauri::AppHandle>, prompt: ConflictPrompt) {
    if let Some(app) = app {
        let _ = app.emit("operation_conflict", prompt);
    }
}

fn emit_summary(app: Option<&tauri::AppHandle>, summary: &OperationSummary) {
    if let Some(app) = app {
        let _ = app.emit("operation_summary", summary);
        let _ = app.emit("operation_completed", summary);
    }
}

pub(super) fn is_cross_device_error(error: &io::Error) -> bool {
    error.raw_os_error() == Some(18)
}

#[cfg(test)]
pub(super) fn conflict_decision_after_resolve_for_test(
    decision: ConflictDecision,
) -> ConflictDecision {
    let operation_id = next_operation_id(OperationKind::Copy);
    register_operation(&operation_id);
    let resolver_operation_id = operation_id.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(20));
        let _ = resolve_conflict(resolver_operation_id, decision);
    });
    let resolved = wait_for_conflict_decision(&operation_id, ConflictDecision::Skip);
    finish_operation(&operation_id);
    resolved
}

#[cfg(test)]
pub(super) fn start_copy_cancel_after_for_test(
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
    cancel_after_completed: u64,
) -> OperationSummary {
    let operation_id = next_operation_id(OperationKind::Copy);
    register_operation(&operation_id);
    let summary = match run_copy(
        None,
        &operation_id,
        &sources,
        &target_dir,
        policy,
        Some(cancel_after_completed),
    ) {
        Ok(summary) | Err(summary) => summary,
    };
    finish_operation(&operation_id);
    summary
}

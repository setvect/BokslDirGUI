use super::*;
use std::collections::HashSet;
use std::io::{Read, Write};
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
const COPY_PROGRESS_CHUNK_BYTES: usize = 1024 * 1024;
const COPY_PROGRESS_EMIT_INTERVAL_MS: u64 = 120;

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
    skipped_files: u64,
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
            skipped_files: 0,
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

pub(super) fn start_archive_add(
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
        let destination = source.file_name().map(|name| target_dir.join(name));
        if (source.is_dir() && target_dir.starts_with(source))
            || destination.is_some_and(|destination| {
                source != &destination && source.starts_with(&destination)
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
        )
        .map_err(|error| error_summary(operation_id, kind, error))?;
    }
    let mut stats = OperationStats::new(work.len() as u64, total_bytes);
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
        let destination = source.file_name().map(|name| target_dir.join(name));
        if (source.is_dir() && target_dir.starts_with(source))
            || destination.is_some_and(|destination| {
                source != &destination && source.starts_with(&destination)
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
        if let Err(error) = scan_work(operation_id, source, &name, &mut work, &mut total_bytes) {
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

fn run_archive_create(
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
        archive_format_name(&target).unwrap_or_else(|| format.to_ascii_lowercase());
    let command_result = match archive_format.as_str() {
        "zip" => run_zip_create(operation_id, &staged_target, &sources, password),
        "jar" | "war" if password.is_none() => {
            run_zip_create(operation_id, &staged_target, &sources, None)
        }
        "7z" => run_7z_create(operation_id, &staged_target, &sources, password),
        "tar" | "tar.gz" | "tar.zst" if password.is_none() => {
            run_tar_create(operation_id, &staged_target, &sources)
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

fn run_archive_extract(
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

fn run_archive_add(
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
        archive_format_name(&archive).as_deref(),
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

fn run_zip_create(
    operation_id: &str,
    target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
) -> CommandResult<()> {
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
    command.arg("-r").arg("-q");
    if let Some(password) = password {
        command.arg("-P").arg(password);
    }
    command.arg(target);
    for source in sources {
        command.arg(Path::new(".").join(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?));
    }
    run_external_command_with_secret(operation_id, command, Some(target), password)
}

fn run_7z_create(
    operation_id: &str,
    target: &Path,
    sources: &[PathBuf],
    password: Option<&str>,
) -> CommandResult<()> {
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
    command.arg("a").arg("-y");
    if let Some(password) = password {
        command.arg(format!("-p{password}")).arg("-mhe=on");
    }
    command.arg(target);
    for source in sources {
        command.arg(Path::new(".").join(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?));
    }
    run_external_command_with_secret(operation_id, command, Some(target), password)
}

fn run_tar_create(operation_id: &str, target: &Path, sources: &[PathBuf]) -> CommandResult<()> {
    let tar = external_binary("tar").ok_or_else(|| {
        AppError::new(
            "unsupported",
            "errors.archiveProviderUnavailable",
            Some(target),
            true,
        )
        .with_detail("provider", "tar")
    })?;
    let working_dir = common_source_parent(sources, target)?;
    let mut command = Command::new(tar);
    command.current_dir(&working_dir).arg("-acf").arg(target);
    for source in sources {
        command.arg(Path::new(".").join(source.file_name().ok_or_else(|| {
            AppError::new("invalid_path", "errors.invalidPath", Some(source), true)
        })?));
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
    password: Option<&str>,
    policy: ConflictDecision,
    entries: Option<&[String]>,
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

fn run_7z_extract(
    operation_id: &str,
    archive: &Path,
    target: &Path,
    password: Option<&str>,
    policy: ConflictDecision,
    entries: Option<&[String]>,
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
        command.arg(entry);
    }
    run_external_command_with_secret(operation_id, command, Some(archive), password)
}

fn run_tar_extract(
    operation_id: &str,
    archive: &Path,
    target: &Path,
    entries: Option<&[String]>,
) -> CommandResult<()> {
    let tar = external_binary("tar").ok_or_else(|| {
        AppError::new(
            "unsupported",
            "errors.archiveProviderUnavailable",
            Some(archive),
            true,
        )
        .with_detail("provider", "tar")
    })?;
    let mut command = Command::new(tar);
    command.arg("-xf").arg(archive).arg("-C").arg(target);
    for entry in entries.unwrap_or(&[]) {
        command.arg(entry);
    }
    run_external_command(operation_id, command, Some(archive))
}

fn run_archive_extract_selected(
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
    let extract_result = match archive_format_name(archive).as_deref() {
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

fn archive_entries_for_extract(
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

fn selected_staged_roots(entries: &[String], strip_prefix: &str) -> Vec<PathBuf> {
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

fn strip_archive_prefix<'a>(entry: &'a str, strip_prefix: &str) -> &'a str {
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

fn normalize_archive_entry(entry: &str) -> String {
    entry
        .replace('\\', "/")
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect::<Vec<_>>()
        .join("/")
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

fn unique_archive_extract_staging_dir(operation_id: &str) -> CommandResult<PathBuf> {
    let base = env::temp_dir().join(format!(
        "boksldir-gui-archive-extract-{}-{}",
        operation_id,
        unix_millis()
    ));
    fs::create_dir_all(&base).map_err(|error| map_io_error(error, Some(&base)))?;
    Ok(base)
}

fn unique_archive_add_staging_dir(operation_id: &str) -> CommandResult<PathBuf> {
    let base = env::temp_dir().join(format!(
        "boksldir-gui-archive-add-{}-{}",
        operation_id,
        unix_millis()
    ));
    fs::create_dir_all(&base).map_err(|error| map_io_error(error, Some(&base)))?;
    Ok(base)
}

fn archive_conflicting_entries(entries: &[String], destination: &str) -> Vec<String> {
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

fn run_archive_delete_entries(
    operation_id: &str,
    archive: &Path,
    entries: &[String],
) -> CommandResult<()> {
    if entries.is_empty() {
        return Ok(());
    }
    match archive_format_name(archive).as_deref() {
        Some("zip" | "jar" | "war") => {
            let zip = external_binary("zip").ok_or_else(|| {
                AppError::new(
                    "unsupported",
                    "errors.archiveProviderUnavailable",
                    Some(archive),
                    true,
                )
                .with_detail("provider", "zip")
            })?;
            let mut command = Command::new(zip);
            command.arg("-d").arg("-q").arg(archive);
            for entry in entries {
                command.arg(entry);
            }
            run_external_command(operation_id, command, Some(archive))
        }
        Some("7z") => {
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
            command.arg("d").arg("-y").arg(archive);
            for entry in entries {
                command.arg(entry);
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

fn run_archive_add_entries(
    operation_id: &str,
    archive: &Path,
    staging: &Path,
    entries: &[String],
) -> CommandResult<()> {
    match archive_format_name(archive).as_deref() {
        Some("zip" | "jar" | "war") => {
            let zip = external_binary("zip").ok_or_else(|| {
                AppError::new(
                    "unsupported",
                    "errors.archiveProviderUnavailable",
                    Some(archive),
                    true,
                )
                .with_detail("provider", "zip")
            })?;
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
        Some("7z") => {
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
            command.current_dir(staging).arg("a").arg("-y").arg(archive);
            for entry in entries {
                command.arg(entry);
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

fn unix_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default()
}

fn list_archive_entry_names_for_operation(
    operation_id: &str,
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<Vec<String>> {
    match archive_format_name(archive).as_deref() {
        Some("zip" | "jar" | "war") => {
            list_zip_entries_for_operation(operation_id, archive, password)
        }
        Some("7z") => list_7z_entries_for_operation(operation_id, archive, password),
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

fn list_zip_entries_for_operation(
    operation_id: &str,
    archive: &Path,
    password: Option<&str>,
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
    command.arg("-Z1");
    command.arg(archive);
    let stdout = run_external_command_capture_with_secret(
        operation_id,
        command,
        Some(archive),
        password,
    )?;
    Ok(String::from_utf8_lossy(&stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn list_7z_entries_for_operation(
    operation_id: &str,
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<Vec<String>> {
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
    command.arg("l").arg("-slt");
    if let Some(password) = password {
        command.arg(format!("-p{password}"));
    }
    command.arg(archive);
    let stdout = run_external_command_capture_with_secret(
        operation_id,
        command,
        Some(archive),
        password,
    )?;
    Ok(super::archive::parse_7z_slt_paths(&stdout))
}

fn list_tar_entries_for_operation(
    operation_id: &str,
    archive: &Path,
) -> CommandResult<Vec<String>> {
    let tar = external_binary("tar").ok_or_else(|| {
        AppError::new(
            "unsupported",
            "errors.archiveProviderUnavailable",
            Some(archive),
            true,
        )
        .with_detail("provider", "tar")
    })?;
    let mut command = Command::new(tar);
    command.arg("-tf").arg(archive);
    let stdout = run_external_command_capture(operation_id, command, Some(archive))?;
    Ok(String::from_utf8_lossy(&stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn run_external_command(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
) -> CommandResult<()> {
    run_external_command_capture(operation_id, command, path).map(|_| ())
}

fn run_external_command_with_secret(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
    secret: Option<&str>,
) -> CommandResult<()> {
    run_external_command(operation_id, command, path)
        .map_err(|error| redact_error_secret(error, secret))
}

fn run_external_command_capture_with_secret(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
    secret: Option<&str>,
) -> CommandResult<Vec<u8>> {
    run_external_command_capture(operation_id, command, path)
        .map_err(|error| redact_error_secret(error, secret))
}

fn redact_error_secret(mut error: AppError, secret: Option<&str>) -> AppError {
    let Some(secret) = secret.filter(|value| !value.is_empty()) else {
        return error;
    };
    if let Some(details) = error.details.as_mut() {
        for value in details.values_mut() {
            *value = value.replace(secret, "[redacted]");
        }
    }
    error
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
    let normalized = entry.replace('\\', "/");
    let bytes = normalized.as_bytes();
    normalized.starts_with('/')
        || bytes.get(1) == Some(&b':')
        || normalized.split('/').any(|component| component == "..")
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
pub(super) fn archive_add_summary_for_test(
    sources: Vec<String>,
    archive_path: String,
    target_inner_dir: String,
    policy: ConflictDecision,
) -> OperationSummary {
    run_archive_add(
        None,
        "archive-add-test",
        sources,
        archive_path,
        target_inner_dir,
        policy,
    )
}

#[cfg(test)]
pub(super) fn archive_extract_summary_for_test(
    archive_path: String,
    target_dir: String,
    password: Option<String>,
    policy: ConflictDecision,
) -> OperationSummary {
    run_archive_extract(
        None,
        "archive-extract-test",
        archive_path,
        target_dir,
        password,
        policy,
        None,
        None,
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
        let result = list_archive_entry_names_for_operation(&worker_operation_id, &archive, None);
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
fn publish_replacement<F>(staged: &Path, destination: &Path, publish: F) -> CommandResult<()>
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
        operation_id,
        source_root,
        Path::new(""),
        &mut work,
        &mut ignored_total_bytes,
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

fn copy_file_no_replace<F>(source: &Path, destination: &Path, mut on_chunk: F) -> CommandResult<()>
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
        let permissions = source_file
            .metadata()
            .map_err(|error| map_io_error(error, Some(source)))?
            .permissions();
        destination_file
            .set_permissions(permissions)
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
struct ProgressTicker {
    last_emit: Instant,
    interval: Duration,
}

impl ProgressTicker {
    fn new() -> Self {
        Self {
            last_emit: Instant::now(),
            interval: Duration::from_millis(COPY_PROGRESS_EMIT_INTERVAL_MS),
        }
    }

    fn should_emit(&mut self) -> bool {
        if self.last_emit.elapsed() < self.interval {
            return false;
        }
        self.last_emit = Instant::now();
        true
    }
}

fn scan_work(
    operation_id: &str,
    source: &Path,
    relative: &Path,
    out: &mut Vec<WorkEntry>,
    total_bytes: &mut u64,
) -> CommandResult<()> {
    check_cancelled(operation_id, source)?;
    let metadata =
        fs::symlink_metadata(source).map_err(|error| map_io_error(error, Some(source)))?;
    if !metadata.is_file() && !metadata.is_dir() && !metadata.file_type().is_symlink() {
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

fn handle_archive_conflict(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    source: &Path,
    archive: &Path,
    destination_entry: &str,
    policy: ConflictDecision,
    stats: &OperationStats,
    kind: OperationKind,
) -> ConflictDecision {
    if app.is_none() {
        return policy;
    }
    if let Some(decision) = conflict_apply_all_decision(operation_id, policy) {
        return decision;
    }
    if let Ok(source_entry) = file_entry_from_path(source, false) {
        let name = destination_entry
            .rsplit('/')
            .next()
            .unwrap_or(destination_entry)
            .to_string();
        let destination = FileEntry {
            path: format!("{}:/{}", display_path(archive), destination_entry),
            name: name.clone(),
            kind: source_entry.kind.clone(),
            size_bytes: None,
            modified_at: None,
            created_at: None,
            permissions: None,
            owner: None,
            group: None,
            is_hidden: name.starts_with('.'),
            is_virtual: false,
        };
        emit_conflict(
            app,
            ConflictPrompt {
                operation_id: operation_id.to_string(),
                source: source_entry,
                destination,
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
    wait_for_conflict_decision(operation_id, policy)
}

fn conflict_apply_all_decision(
    operation_id: &str,
    default_decision: ConflictDecision,
) -> Option<ConflictDecision> {
    if matches!(
        default_decision,
        ConflictDecision::AllOverwrite | ConflictDecision::AllSkip
    ) {
        return Some(default_decision);
    }
    conflict_registry()
        .0
        .lock()
        .expect("conflict registry lock should not be poisoned")
        .get(operation_id)
        .and_then(|state| state.apply_all_decision)
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

fn move_to_trash(source: &Path) -> CommandResult<()> {
    #[cfg(test)]
    if let Some(path) = env::var_os("BOKSLDIRGUI_TRASH_DIR") {
        let trash_dir = PathBuf::from(path);
        fs::create_dir_all(&trash_dir).map_err(|error| map_io_error(error, Some(&trash_dir)))?;
        let target = unique_temp_target(&trash_dir, source);
        return mutation::rename_no_replace(source, &target)
            .map_err(|error| map_io_error(error, Some(source)));
    }
    trash::delete(source).map_err(|error| {
        AppError::new("trash_failed", "errors.trashFailed", Some(source), true)
            .with_detail("message", error.to_string())
    })
}

fn check_cancelled(operation_id: &str, path: &Path) -> CommandResult<()> {
    if is_cancelled(operation_id) {
        return Err(AppError::new(
            "operation_cancelled",
            "errors.operationCancelled",
            Some(path),
            true,
        ));
    }
    Ok(())
}

fn count_entries_and_bytes(
    operation_id: &str,
    path: &Path,
    total_bytes: &mut u64,
) -> CommandResult<u64> {
    check_cancelled(operation_id, path)?;
    let metadata = fs::symlink_metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
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

fn delete_tree_cancellable(
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
        OperationKind::ArchiveAdd => "archive-add",
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
        skipped_files: stats.skipped_files,
        errors: stats.errors.clone(),
    }
}

fn error_summary(operation_id: &str, kind: OperationKind, error: AppError) -> OperationSummary {
    OperationSummary {
        operation_id: operation_id.to_string(),
        kind,
        state: if is_operation_cancelled_error(&error) {
            OperationState::Cancelled
        } else {
            OperationState::Failed
        },
        completed_files: 0,
        failed_files: if is_operation_cancelled_error(&error) {
            0
        } else {
            1
        },
        skipped_files: 0,
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
        skipped_files: stats.skipped_files,
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

#[cfg(test)]
mod review_tests {
    use super::*;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = env::temp_dir().join(next_operation_id(OperationKind::Copy));
            fs::create_dir(&root).unwrap();
            Self(root)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn cancelled_copy_removes_partial_file_and_preserves_source() {
        let fixture = Fixture::new();
        let source = fixture.0.join("source");
        let destination = fixture.0.join("destination");
        fs::write(&source, vec![42; COPY_PROGRESS_CHUNK_BYTES + 1]).unwrap();
        let error = copy_file_no_replace(&source, &destination, |_| {
            Err(AppError::new(
                "operation_cancelled",
                "errors.operationCancelled",
                None,
                true,
            ))
        })
        .unwrap_err();
        assert_eq!(error.code, "operation_cancelled");
        assert!(!destination.exists());
        assert_eq!(
            fs::metadata(source).unwrap().len(),
            (COPY_PROGRESS_CHUNK_BYTES + 1) as u64
        );
    }

    #[cfg(unix)]
    #[test]
    fn copy_preserves_executable_and_private_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let fixture = Fixture::new();
        let source = fixture.0.join("source");
        let destination = fixture.0.join("destination");
        fs::write(&source, b"#!/bin/sh\n").unwrap();
        fs::set_permissions(&source, fs::Permissions::from_mode(0o700)).unwrap();
        copy_file_no_replace(&source, &destination, |_| Ok(())).unwrap();
        assert_eq!(
            fs::metadata(destination).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }

    #[test]
    fn failed_overwrite_publication_restores_original() {
        let fixture = Fixture::new();
        let staged = fixture.0.join("staged");
        let destination = fixture.0.join("destination");
        fs::write(&staged, b"new").unwrap();
        fs::write(&destination, b"original").unwrap();
        let result = publish_replacement(&staged, &destination, |_, _| {
            Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "injected publication failure",
            ))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"original");
        assert_eq!(fs::read(&staged).unwrap(), b"new");
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 2);
    }

    #[test]
    fn blocked_overwrite_rollback_keeps_backup_and_concurrent_file() {
        let fixture = Fixture::new();
        let staged = fixture.0.join("staged");
        let destination = fixture.0.join("destination");
        fs::write(&staged, b"new").unwrap();
        fs::write(&destination, b"original").unwrap();
        let error = publish_replacement(&staged, &destination, |_, dest| {
            fs::write(dest, b"concurrent").unwrap();
            Err(io::Error::new(
                io::ErrorKind::AlreadyExists,
                "concurrent writer",
            ))
        })
        .unwrap_err();
        let backup = &error.details.unwrap()["backupPath"];
        assert_eq!(fs::read(backup).unwrap(), b"original");
        assert_eq!(fs::read(destination).unwrap(), b"concurrent");
    }

    #[cfg(unix)]
    #[test]
    fn move_rejects_socket_before_overwriting_or_deleting_anything() {
        use std::os::unix::net::UnixListener;
        let fixture = Fixture::new();
        let source = fixture.0.join("source");
        let target = fixture.0.join("target");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(source.join("keep"), b"source").unwrap();
        let _socket = UnixListener::bind(source.join("socket")).unwrap();
        fs::write(target.join("source"), b"destination").unwrap();
        let summary = run_move(
            None,
            "socket-test",
            &[display_path(&source)],
            &display_path(&target),
            ConflictDecision::AllOverwrite,
        );
        assert_eq!(summary.state, OperationState::Failed);
        assert_eq!(
            summary.errors[0].message_key,
            "errors.specialFileCopyUnsupported"
        );
        assert_eq!(fs::read(source.join("keep")).unwrap(), b"source");
        assert_eq!(fs::read(target.join("source")).unwrap(), b"destination");
    }

    #[test]
    fn archive_extract_rejects_escaping_strip_prefix_before_creating_target() {
        let fixture = Fixture::new();
        let target = fixture.0.join("not-created");
        let summary = run_archive_extract(
            None,
            "prefix-test",
            "missing.zip".into(),
            display_path(&target),
            None,
            ConflictDecision::AllOverwrite,
            Some(vec!["safe.txt".into()]),
            Some("../outside".into()),
        );
        assert_eq!(summary.errors[0].code, "unsafe_archive_entry");
        assert!(!target.exists());
    }

    #[test]
    fn archive_skip_does_not_count_as_success() {
        let _env_guard = crate::tests::TEST_ENV_MUTEX.lock().unwrap();
        if external_binary("zip").is_none() || external_binary("unzip").is_none() {
            return;
        }
        let fixture = Fixture::new();
        let source = fixture.0.join("source.txt");
        let archive = fixture.0.join("test.zip");
        let target = fixture.0.join("target");
        fs::write(&source, b"source").unwrap();
        fs::create_dir(&target).unwrap();
        fs::write(target.join("source.txt"), b"original").unwrap();
        run_zip_create("zip-test", &archive, &[source], None).unwrap();
        let summary = run_archive_extract(
            None,
            "skip-test",
            display_path(&archive),
            display_path(&target),
            None,
            ConflictDecision::AllSkip,
            None,
            None,
        );
        assert_eq!(summary.completed_files, 0);
        assert_eq!(summary.skipped_files, 1);
        assert_eq!(fs::read(target.join("source.txt")).unwrap(), b"original");
    }

    #[test]
    fn rename_preserves_exact_source_name_with_surrounding_spaces() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join(" note "), b"intended").unwrap();
        fs::write(fixture.0.join("note"), b"unrelated").unwrap();
        mutation::rename_entry(&display_path(&fixture.0.join(" note ")), "renamed").unwrap();
        assert_eq!(fs::read(fixture.0.join("renamed")).unwrap(), b"intended");
        assert_eq!(fs::read(fixture.0.join("note")).unwrap(), b"unrelated");
    }
    #[test]
    fn copy_and_move_reject_overwriting_a_source_ancestor() {
        let fixture = Fixture::new();
        let parent = fixture.0.join("same");
        fs::create_dir(&parent).unwrap();
        let source = parent.join("same");
        fs::write(&source, b"source").unwrap();
        fs::write(parent.join("sibling"), b"keep").unwrap();
        let paths = vec![display_path(&source)];
        let copied = run_copy(
            None,
            "ancestor-copy",
            &paths,
            &display_path(&fixture.0),
            ConflictDecision::AllOverwrite,
            None,
        )
        .unwrap_err();
        let moved = run_move(
            None,
            "ancestor-move",
            &paths,
            &display_path(&fixture.0),
            ConflictDecision::AllOverwrite,
        );
        assert_eq!(copied.state, OperationState::Failed);
        assert_eq!(moved.state, OperationState::Failed);
        assert_eq!(fs::read(source).unwrap(), b"source");
        assert_eq!(fs::read(parent.join("sibling")).unwrap(), b"keep");
    }

    #[test]
    fn recursive_scan_and_delete_observe_cancellation() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("first"), b"one").unwrap();
        fs::write(fixture.0.join("second"), b"two").unwrap();
        let id = next_operation_id(OperationKind::Delete);
        register_operation(&id);
        let mut stats = OperationStats::new(3, 6);
        stats.cancel_after_completed = Some(1);
        let result = delete_tree_cancellable(
            None,
            &id,
            &fixture.0,
            &mut stats,
            &mut ProgressTicker::new(),
        );
        let scan = scan_work(&id, &fixture.0, Path::new(""), &mut Vec::new(), &mut 0);
        finish_operation(&id);
        assert_eq!(result.unwrap_err().code, "operation_cancelled");
        assert_eq!(scan.unwrap_err().code, "operation_cancelled");
        assert_eq!(stats.completed_files, 1);
        assert_eq!(fs::read_dir(&fixture.0).unwrap().count(), 1);
    }

    #[test]
    fn settings_save_preserves_corrupt_file_and_serializes_patches() {
        let _env_guard = crate::tests::TEST_ENV_MUTEX.lock().unwrap();
        let fixture = Fixture::new();
        let path = fixture.0.join("settings.json");
        fs::write(&path, b"{corrupt user settings").unwrap();
        let old = env::var_os("BOKSLDIRGUI_SETTINGS_PATH");
        env::set_var("BOKSLDIRGUI_SETTINGS_PATH", &path);
        let failed = settings_service::save_settings(serde_json::json!({"theme": "light"}));
        let contents = fs::read(&path).unwrap();
        fs::remove_file(&path).unwrap();
        let a = thread::spawn(|| {
            settings_service::save_settings(serde_json::json!({"theme": "light"}))
        });
        let b = thread::spawn(|| {
            settings_service::save_settings(serde_json::json!({"language": "en"}))
        });
        let outcomes = (a.join().unwrap(), b.join().unwrap());
        let saved = settings_service::load_settings();
        match old {
            Some(value) => env::set_var("BOKSLDIRGUI_SETTINGS_PATH", value),
            None => env::remove_var("BOKSLDIRGUI_SETTINGS_PATH"),
        }
        assert!(failed.is_err());
        assert_eq!(contents, b"{corrupt user settings");
        assert!(outcomes.0.is_ok() && outcomes.1.is_ok());
        let saved = saved.unwrap();
        assert_eq!(saved.theme, "light");
        assert_eq!(saved.language, "en");
    }

    #[cfg(unix)]
    #[test]
    fn failing_archive_provider_never_publishes_partial_create_or_add() {
        use std::os::unix::fs::PermissionsExt;
        let _env_guard = crate::tests::TEST_ENV_MUTEX.lock().unwrap();
        if external_binary("zip").is_none() || external_binary("unzip").is_none() {
            return;
        }
        let fixture = Fixture::new();
        let source = fixture.0.join("source.txt");
        let archive = fixture.0.join("original.zip");
        fs::write(&source, b"source").unwrap();
        run_zip_create("provider-setup", &archive, &[source.clone()], None).unwrap();
        let original = fs::read(&archive).unwrap();
        let bin = fixture.0.join("bin");
        fs::create_dir(&bin).unwrap();
        let fake_zip = bin.join("zip");
        fs::write(&fake_zip, "#!/bin/sh\nfor arg do\n case \"$arg\" in /*.zip) printf broken > \"$arg\";; esac\ndone\nexit 1\n").unwrap();
        fs::set_permissions(&fake_zip, fs::Permissions::from_mode(0o755)).unwrap();
        let old_path = env::var_os("PATH").unwrap();
        let mut paths = vec![bin];
        paths.extend(env::split_paths(&old_path));
        env::set_var("PATH", env::join_paths(paths).unwrap());
        let created_path = fixture.0.join("new.zip");
        let created = run_archive_create(
            None,
            "failed-create",
            vec![display_path(&source)],
            display_path(&created_path),
            "zip".into(),
            None,
        );
        let added = run_archive_add(
            None,
            "failed-add",
            vec![display_path(&source)],
            display_path(&archive),
            "new-folder".into(),
            ConflictDecision::AllOverwrite,
        );
        env::set_var("PATH", old_path);
        assert_eq!(created.state, OperationState::Failed);
        assert_eq!(added.state, OperationState::Failed);
        assert!(!created_path.exists());
        assert_eq!(fs::read(&archive).unwrap(), original);
        assert!(!fs::read_dir(&fixture.0).unwrap().any(|entry| entry
            .unwrap()
            .file_name()
            .to_string_lossy()
            .starts_with(".boksldirgui-op")));
    }
}

use crate::contracts::{
    AppError, CancelAck, CommandResult, ConflictAck, ConflictDecision, ConflictPrompt,
    OperationKind, OperationProgress, OperationStarted, OperationState, OperationSummary,
};
use crate::path_text::display_path;
use std::collections::BTreeMap;
use std::path::Path;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering as AtomicOrdering;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use std::time::Instant;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;
use tauri::Emitter;

use process_wrap::std::ChildWrapper;
pub(super) type ExternalChild = Arc<Mutex<Box<dyn ChildWrapper>>>;
use std::sync::Arc;
use std::sync::Condvar;

pub(super) static OP_COUNTER: AtomicU64 = AtomicU64::new(0);
pub(super) static CANCELLED: OnceLock<Mutex<BTreeMap<String, bool>>> = OnceLock::new();
pub(super) static CONFLICTS: OnceLock<(Mutex<BTreeMap<String, ConflictState>>, Condvar)> =
    OnceLock::new();
pub(super) static EXTERNAL_PROCESSES: OnceLock<Mutex<BTreeMap<String, ExternalChild>>> =
    OnceLock::new();
pub(super) const PERMANENT_DELETE_CONFIRM_TOKEN: &str = "PERMANENT_DELETE";
pub(super) const CONFLICT_WAIT_POLL_MS: u64 = 200;

#[derive(Debug, Clone, Default)]
pub(super) struct ConflictState {
    pub(super) pending_decision: Option<ConflictDecision>,
    pub(super) apply_all_decision: Option<ConflictDecision>,
}

#[derive(Debug, Clone)]
pub(super) struct OperationStats {
    pub(super) total_files: u64,
    pub(super) total_bytes: u64,
    pub(super) completed_files: u64,
    pub(super) completed_bytes: u64,
    pub(super) failed_files: u64,
    pub(super) skipped_files: u64,
    pub(super) errors: Vec<AppError>,
    pub(super) started_at: Instant,
    pub(super) cancel_after_completed: Option<u64>,
}

impl OperationStats {
    pub(super) fn new(total_files: u64, total_bytes: u64) -> Self {
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

pub(crate) fn cancel_operation(operation_id: String) -> CommandResult<CancelAck> {
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

pub(crate) fn resolve_conflict(
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

pub(super) fn conflict_apply_all_decision(
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

pub(super) fn check_cancelled(operation_id: &str, path: &Path) -> CommandResult<()> {
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

pub(super) fn wait_for_conflict_decision(
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

pub(super) fn conflict_registry() -> &'static (Mutex<BTreeMap<String, ConflictState>>, Condvar) {
    CONFLICTS.get_or_init(|| (Mutex::new(BTreeMap::new()), Condvar::new()))
}

/// 앱에서 시작한 장기 작업은 한 번에 하나만 실행(프론트 작업 차단과 같은 정책의 백엔드 방어선).
static ACTIVE_APP_OPERATION: Mutex<bool> = Mutex::new(false);

/// 앱 작업 자리. Drop 시 해제, 앱 없이 동기로 실행하는 경로(테스트)는 자리를 잡지 않음.
pub(super) struct OperationSlot {
    held: bool,
}

impl OperationSlot {
    pub(super) fn claim(app: Option<&tauri::AppHandle>) -> CommandResult<Self> {
        if app.is_none() {
            return Ok(Self { held: false });
        }
        claim_slot(&ACTIVE_APP_OPERATION)?;
        Ok(Self { held: true })
    }
}

impl Drop for OperationSlot {
    fn drop(&mut self) {
        if self.held {
            release_slot(&ACTIVE_APP_OPERATION);
        }
    }
}

pub(super) fn claim_slot(slot: &Mutex<bool>) -> CommandResult<()> {
    let mut active = slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    if *active {
        return Err(AppError::new("operation_busy", "errors.operationBusy", None, true));
    }
    *active = true;
    Ok(())
}

pub(super) fn release_slot(slot: &Mutex<bool>) {
    *slot.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = false;
}

/// 장기 작업 시작 공통 경계: 자리 확보 → 등록 → Queued 응답, 작업 스레드에서 첫 상태 알림·실행·요약 발행·등록 해제.
/// 앱이 없으면(테스트) 같은 순서를 현재 스레드에서 실행. 요약 발행 전에 자리를 풀어 프론트가 바로 다음 작업 시작 가능.
pub(super) fn launch_operation(
    app: Option<&tauri::AppHandle>,
    kind: OperationKind,
    initial_state: Option<OperationState>,
    run: impl FnOnce(Option<&tauri::AppHandle>, &str) -> OperationSummary + Send + 'static,
) -> CommandResult<OperationStarted> {
    let slot = OperationSlot::claim(app)?;
    launch_claimed_operation(app, kind, initial_state, slot, run)
}

/// 시작 전 상태를 바꾸는 작업(휴지통 되돌리기 기록 꺼내기)은 자리를 먼저 잡고 이 함수로 시작.
pub(super) fn launch_claimed_operation(
    app: Option<&tauri::AppHandle>,
    kind: OperationKind,
    initial_state: Option<OperationState>,
    slot: OperationSlot,
    run: impl FnOnce(Option<&tauri::AppHandle>, &str) -> OperationSummary + Send + 'static,
) -> CommandResult<OperationStarted> {
    let operation_id = next_operation_id(kind);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind,
        state: OperationState::Queued,
    };
    let execute = move |app: Option<&tauri::AppHandle>, operation_id: &str| {
        if let Some(state) = initial_state {
            emit_state(app, operation_id, kind, state, None, 0, 0, None);
        }
        let summary = run(app, operation_id);
        drop(slot);
        emit_summary(app, &summary);
        finish_operation(operation_id);
    };
    match app {
        Some(app) => {
            let app = app.clone();
            let worker_id = operation_id.clone();
            if let Err(error) = std::thread::Builder::new()
                .name("boksldir-operation".to_owned())
                .spawn(move || execute(Some(&app), &worker_id))
            {
                finish_operation(&operation_id);
                return Err(crate::filesystem::map_io_error(error, None));
            }
        }
        None => execute(None, &operation_id),
    }
    Ok(started)
}

pub(super) fn next_operation_id(kind: OperationKind) -> String {
    let prefix = match kind {
        OperationKind::Copy => "copy",
        OperationKind::Move => "move",
        OperationKind::Delete => "delete",
        OperationKind::Trash => "trash",
        OperationKind::RestoreTrash => "restore-trash",
        OperationKind::Rename => "rename",
        OperationKind::CreateDir => "create-dir",
        OperationKind::ArchiveCreate => "archive-create",
        OperationKind::ArchiveExtract => "archive-extract",
        OperationKind::ArchiveAdd => "archive-add",
        OperationKind::ShellCommand => "shell-command",
        OperationKind::Chmod => "chmod",
    };
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let counter = OP_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
    format!("op-{prefix}-{nonce}-{counter}")
}

pub(super) fn register_operation(operation_id: &str) {
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

pub(super) fn finish_operation(operation_id: &str) {
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

pub(super) fn is_cancelled(operation_id: &str) -> bool {
    cancelled_registry()
        .lock()
        .expect("cancel registry lock should not be poisoned")
        .get(operation_id)
        .copied()
        .unwrap_or(false)
}

pub(super) fn is_operation_registered(operation_id: &str) -> bool {
    cancelled_registry()
        .lock()
        .expect("cancel registry lock should not be poisoned")
        .contains_key(operation_id)
}

pub(super) fn is_operation_cancelled_error(error: &AppError) -> bool {
    error.code == "operation_cancelled"
}

pub(super) fn cancelled_registry() -> &'static Mutex<BTreeMap<String, bool>> {
    CANCELLED.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub(super) fn external_process_registry() -> &'static Mutex<BTreeMap<String, ExternalChild>> {
    EXTERNAL_PROCESSES.get_or_init(|| Mutex::new(BTreeMap::new()))
}

pub(super) fn register_external_process(operation_id: &str, child: ExternalChild) {
    external_process_registry()
        .lock()
        .expect("external process registry lock should not be poisoned")
        .insert(operation_id.to_string(), child);
}

pub(super) fn unregister_external_process(operation_id: &str) {
    external_process_registry()
        .lock()
        .expect("external process registry lock should not be poisoned")
        .remove(operation_id);
}

pub(super) fn kill_registered_external_process(operation_id: &str) {
    let child = external_process_registry()
        .lock()
        .expect("external process registry lock should not be poisoned")
        .get(operation_id)
        .cloned();
    if let Some(child) = child {
        kill_external_child(&child);
    }
}

pub(super) fn kill_external_child(child: &ExternalChild) {
    let _ = child
        .lock()
        .expect("external process lock should not be poisoned")
        .start_kill();
}

pub(super) fn summary_from_stats(
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
        command_result: None,
    }
}

pub(super) fn error_summary(
    operation_id: &str,
    kind: OperationKind,
    error: AppError,
) -> OperationSummary {
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
        command_result: None,
    }
}

pub(super) fn cancel_summary(
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
        command_result: None,
    }
}

pub(super) fn emit_state(
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

pub(super) fn emit_progress(
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

// 프론트 `src/tauri/commands.ts`의 `EVENTS`와 같은 이름(contract.test.ts가 대조).
const OPERATION_PROGRESS_EVENT: &str = "operation_progress";
const OPERATION_CONFLICT_EVENT: &str = "operation_conflict";
const OPERATION_SUMMARY_EVENT: &str = "operation_summary";

pub(super) fn emit_progress_payload(app: Option<&tauri::AppHandle>, progress: &OperationProgress) {
    if let Some(app) = app {
        let _ = app.emit(OPERATION_PROGRESS_EVENT, progress);
    }
}

pub(super) fn emit_conflict(app: Option<&tauri::AppHandle>, prompt: ConflictPrompt) {
    if let Some(app) = app {
        let _ = app.emit(OPERATION_CONFLICT_EVENT, prompt);
    }
}

pub(super) fn emit_summary(app: Option<&tauri::AppHandle>, summary: &OperationSummary) {
    if let Some(app) = app {
        let _ = app.emit(OPERATION_SUMMARY_EVENT, summary);
    }
}

pub(super) fn should_cancel_for_test(operation_id: &str, stats: &OperationStats) -> bool {
    let should_cancel = stats
        .cancel_after_completed
        .is_some_and(|limit| stats.completed_files >= limit);
    if should_cancel {
        let _ = cancel_operation(operation_id.to_string());
    }
    should_cancel
}

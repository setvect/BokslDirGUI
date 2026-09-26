use crate::contracts::{CommandResult, ConflictDecision, OperationKind, OperationSummary};
use std::path::PathBuf;
use std::process::Command;
use std::time::Duration;
use std::time::Instant;

use std::thread;

use super::archive_ops::{
    archive_entry_is_unsafe, list_archive_entry_names_for_operation, run_archive_add,
    run_archive_create, run_archive_extract,
};
use super::process::{external_binary, run_external_command};
use super::runtime::{
    cancel_operation, finish_operation, next_operation_id, register_operation, resolve_conflict,
    wait_for_conflict_decision,
};
use super::transfer::run_copy;

#[cfg(test)]
pub(crate) fn archive_entry_is_unsafe_for_test(entry: &str) -> bool {
    archive_entry_is_unsafe(entry)
}

#[cfg(test)]
pub(crate) fn archive_create_summary_for_test(
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
pub(crate) fn archive_add_summary_for_test(
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
pub(crate) fn archive_extract_summary_for_test(
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
pub(crate) fn external_archive_command_cancel_for_test() -> Option<(CommandResult<()>, Duration)> {
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
pub(crate) fn archive_entry_listing_cancel_for_test(
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

#[cfg(test)]
pub(crate) fn conflict_decision_after_resolve_for_test(
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
pub(crate) fn start_copy_cancel_after_for_test(
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

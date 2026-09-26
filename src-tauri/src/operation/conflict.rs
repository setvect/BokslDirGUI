use crate::contracts::{
    ConflictDecision, ConflictPrompt, FileEntry, OperationKind, OperationState,
};
use crate::filesystem::file_entry_from_path;
use crate::path_text::display_path;
use std::path::Path;

use super::file_io::path_is_occupied;
use super::runtime::{
    conflict_apply_all_decision, emit_conflict, emit_progress, wait_for_conflict_decision,
    OperationStats,
};

pub(super) fn handle_conflict(
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

pub(super) fn handle_archive_conflict(
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
            symlink_target_is_directory: None,
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

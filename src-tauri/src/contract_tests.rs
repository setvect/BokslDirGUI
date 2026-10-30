use crate::contracts::{
    AppError, EntryKind, FileEntry, OperationKind, OperationProgress, OperationState, Settings, OperationSummary, ShellCommandResult,
    RenameItem, RenamePreview, RenameRules, TrashUndoPreview,
};
use std::path::Path;

fn fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../src/tauri/fixtures/contract.json")).unwrap()
}

#[test]
fn file_entry_wire_fields_preserve_nulls_and_unicode() {
    let entry = FileEntry {
        path: "/fixture/한글".into(),
        name: "한글".into(),
        kind: EntryKind::Directory,
        symlink_target_is_directory: None,
        size_bytes: None,
        modified_at: None,
        created_at: None,
        permissions: None,
        owner: None,
        group: None,
        is_hidden: false,
        is_virtual: false,
    };
    assert_eq!(serde_json::to_value(entry).unwrap(), fixture()["entry"]);
}

#[test]
fn operation_progress_and_error_wire_fields_are_stable() {
    let progress = OperationProgress {
        operation_id: "op-fixture".into(),
        kind: OperationKind::ArchiveExtract,
        state: OperationState::WaitingForConflict,
        total_files: None,
        completed_files: 2,
        total_bytes: Some(1024),
        completed_bytes: 512,
        current_path: None,
        bytes_per_second: None,
        eta_seconds: None,
        recent_error_count: 1,
    };
    let error = AppError::new(
        "permission_denied",
        "errors.permissionDenied",
        Some(Path::new("/fixture/한글")),
        true,
    )
    .with_detail("reason", "fixture");
    assert_eq!(
        serde_json::to_value(progress).unwrap(),
        fixture()["progress"]
    );
    assert_eq!(serde_json::to_value(error).unwrap(), fixture()["error"]);
}

#[test]
fn existing_settings_json_round_trips_without_migration() {
    let value = fixture()["settings"].clone();
    let settings: Settings = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(settings).unwrap(), value);
}


#[test]
fn command_summary_preserves_output_and_other_summaries_omit_the_extra_field() {
    let mut summary = OperationSummary {
        operation_id: "op-command-fixture".into(), kind: OperationKind::ShellCommand, state: OperationState::Cancelled,
        completed_files: 0, failed_files: 0, skipped_files: 0, errors: vec![],
        command_result: Some(ShellCommandResult { working_dir: "/fixture/한글".into(), exit_code: None,
            stdout: "부분 출력\n".into(), stderr: "".into(), timed_out: false, truncated: true }),
    };
    assert_eq!(serde_json::to_value(&summary).unwrap(), fixture()["commandSummary"]);
    summary.kind = OperationKind::Copy;
    summary.command_result = None;
    assert!(serde_json::to_value(summary).unwrap().get("commandResult").is_none());
}

#[test]
fn bulk_rename_and_trash_undo_wire_fields_are_stable() {
    let rules: RenameRules = serde_json::from_value(fixture()["renameRules"].clone()).unwrap();
    assert_eq!(
        (rules.find.as_str(), rules.replacement.as_str(), rules.start, rules.padding, rules.numbering, rules.preserve_extension),
        ("사진", "photo", 1, 3, true, true)
    );
    let item: RenameItem = serde_json::from_value(fixture()["renamePreview"]["item"].clone()).unwrap();
    let preview = RenamePreview { item, changed: true, error: None };
    assert_eq!(serde_json::to_value(preview).unwrap(), fixture()["renamePreview"]);

    let entry = FileEntry {
        path: "/fixture/한글/사진 1.jpg".into(),
        name: "사진 1.jpg".into(),
        kind: EntryKind::File,
        symlink_target_is_directory: None,
        size_bytes: Some(2048),
        modified_at: None,
        created_at: None,
        permissions: None,
        owner: None,
        group: None,
        is_hidden: false,
        is_virtual: false,
    };
    let trash = TrashUndoPreview { id: "trash-fixture".into(), entries: vec![entry] };
    assert_eq!(serde_json::to_value(trash).unwrap(), fixture()["trashUndoPreview"]);
}

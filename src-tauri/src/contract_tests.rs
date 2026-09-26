use crate::contracts::{
    AppError, EntryKind, FileEntry, OperationKind, OperationProgress, OperationState, Settings,
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

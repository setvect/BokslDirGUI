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

#[test]
fn archive_format_table_matches_the_frontend_fixture() {
    let rows: Vec<serde_json::Value> =
        serde_json::from_str(include_str!("../../src/tauri/fixtures/archive-formats.json")).unwrap();
    let fixture: Vec<(&str, &str)> = rows
        .iter()
        .map(|row| (row["suffix"].as_str().unwrap(), row["format"].as_str().unwrap()))
        .collect();
    assert_eq!(fixture, crate::archive_provider::ARCHIVE_FORMATS.to_vec());
    assert_eq!(crate::archive_provider::archive_format(Path::new("/x/Bundle.TAR.GZ")), Some("tar.gz"));
    assert_eq!(crate::archive_provider::archive_format(Path::new("/x/app.war")), Some("war"));
    assert!(!crate::archive_provider::is_archive_path(Path::new("/x/notes.txt")));
}

#[test]
fn remote_settings_round_trip_without_secret_fields() {
    let value = fixture()["remoteSettings"].clone();
    let remote: crate::contracts::RemoteSettings = serde_json::from_value(value.clone()).unwrap();
    assert_eq!(serde_json::to_value(&remote).unwrap(), value);
    assert_eq!(remote.sites[0].auth_method, crate::contracts::RemoteAuthMethod::PublicKey);
    let text = value.to_string().to_lowercase();
    assert!(!text.contains("password\"") && !text.contains("passphrase"));
}

#[test]
fn remote_connection_contract_matches_the_frontend_fixture() {
    let request: crate::contracts::RemoteConnectRequest =
        serde_json::from_value(fixture()["remoteConnectRequest"].clone()).unwrap();
    assert_eq!(request.auth_method, crate::contracts::RemoteAuthMethod::PublicKey);
    assert_eq!(request.passphrase.as_deref(), Some("fixture-passphrase"));
    let session = crate::contracts::RemoteSession {
        session_id: "sftp://boksl@example.com:2222/".into(),
        user: "boksl".into(),
        host: "example.com".into(),
        port: 2222,
        home: "/home/boksl".into(),
        home_url: "sftp://boksl@example.com:2222/home/boksl".into(),
        host_key_algorithm: "ssh-ed25519".into(),
        host_key_fingerprint: "SHA256:fixture".into(),
    };
    assert_eq!(serde_json::to_value(&session).unwrap(), fixture()["remoteSession"]);
    let changed = crate::contracts::RemoteConnectionChanged {
        session_id: session.session_id.clone(),
        state: crate::contracts::RemoteConnectionState::Lost,
        error: Some(crate::contracts::AppError::new(
            "remote_connection_lost",
            "errors.remoteConnectionLost",
            Some(Path::new("sftp://boksl@example.com:2222/")),
            true,
        )),
    };
    assert_eq!(serde_json::to_value(&changed).unwrap(), fixture()["remoteConnectionChanged"]);
}

#[test]
fn remote_path_cases_match_the_frontend_fixture() {
    let cases: serde_json::Value =
        serde_json::from_str(include_str!("../../src/tauri/fixtures/remote-paths.json")).unwrap();
    for case in cases["valid"].as_array().unwrap() {
        let parsed = crate::remote::path::RemotePath::parse(case["input"].as_str().unwrap()).unwrap();
        assert_eq!(parsed.location.user, case["user"].as_str().unwrap());
        assert_eq!(parsed.location.host, case["host"].as_str().unwrap());
        assert_eq!(u64::from(parsed.location.port), case["port"].as_u64().unwrap());
        assert_eq!(parsed.path, case["path"].as_str().unwrap());
        assert_eq!(parsed.url(), case["url"].as_str().unwrap());
    }
    for input in cases["invalid"].as_array().unwrap() {
        assert!(crate::remote::path::RemotePath::parse(input.as_str().unwrap()).is_err(), "{input}");
    }
}

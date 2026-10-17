use crate::contracts::{AppError, ConflictDecision, OperationKind, OperationState};
use crate::mutation;
use crate::path_text::display_path;
use crate::settings_service;
use std::env;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;

use std::thread;

use super::archive_ops::{
    parse_zip_human_bytes, run_archive_add, run_archive_create, run_archive_extract,
    run_zip_create, run_zip_create_with_progress, SevenZipProgressParser, ZipProgressParser,
    ZIP_PROGRESS_DOT_BYTES,
};
use super::delete::delete_tree_cancellable;
use super::file_io::{
    copy_file_no_replace, publish_replacement, scan_work, ProgressTicker, SpecialFileScanPolicy,
    COPY_PROGRESS_CHUNK_BYTES,
};
use super::process::{external_binary, run_external_command_capture_observed};
use super::runtime::{finish_operation, next_operation_id, register_operation, OperationStats};
use super::transfer::{run_copy, run_move};

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
fn zip_progress_parser_tracks_entries_bytes_and_chunked_dot_output() {
    let mut parser = ZipProgressParser::default();
    assert_eq!(
        parser.ingest(b"  0/  3 [   0/ 305]   adding: folder/ (0) (stored 0%)\n"),
        Some((1, 0))
    );
    assert_eq!(
        parser.ingest(b"  1/  2 [   0/ 305]   adding: folder/b.txt (5) (stored 0%)\n"),
        Some((2, 5))
    );
    assert_eq!(
        parser.ingest(b"  2/  1 [   5/ 16M]   adding: folder/big.bin ."),
        Some((2, ZIP_PROGRESS_DOT_BYTES + 5))
    );
    assert_eq!(
        parser.ingest(b"... (16M) (deflated 50%)\n"),
        Some((3, 16 * 1024 * 1024 + 5))
    );
    assert_eq!(parse_zip_human_bytes("1.5G"), Some(1610612736));
}

#[test]
fn seven_zip_progress_parser_tracks_carriage_return_percentages() {
    let mut parser = SevenZipProgressParser::default();
    assert_eq!(parser.ingest(b" 12% 3 + file\r 47"), Some(12));
    assert_eq!(parser.ingest(b"% 8 + file\r"), Some(47));
    assert_eq!(parser.ingest(b"warning 99%\n 100%\r"), Some(100));
}

#[cfg(unix)]
#[test]
fn external_command_observer_receives_output_before_process_exit() {
    let fixture = Fixture::new();
    let signal = fixture.0.join("observed");
    let mut command = Command::new("/bin/sh");
    command.arg("-c").arg(
        r#"printf 'ready\n'; count=0; while [ ! -f "$1" ] && [ "$count" -lt 40 ]; do sleep 0.05; count=$((count + 1)); done; test -f "$1""#,
    );
    command.arg("sh").arg(&signal);
    let mut observer = |chunk: &[u8]| {
        if chunk.windows(5).any(|window| window == b"ready") {
            fs::write(&signal, b"seen").unwrap();
        }
    };
    let output = run_external_command_capture_observed(
        "stream-test",
        command,
        Some(&fixture.0),
        Some(&mut observer),
    )
    .unwrap();
    assert_eq!(output, b"ready\n");
    assert!(signal.exists());
}

#[test]
fn zip_create_reports_processed_items_before_publication() {
    let _env_guard = crate::tests::TEST_ENV_MUTEX.lock().unwrap();
    if external_binary("zip").is_none() {
        crate::tests::report_missing_provider("zip");
        return;
    }
    let fixture = Fixture::new();
    let source = fixture.0.join("한글 폴더");
    fs::create_dir(&source).unwrap();
    fs::write(source.join("가.txt"), b"hello").unwrap();
    fs::write(source.join("b.txt"), b"world").unwrap();
    let archive = fixture.0.join("output.zip");
    let mut stats = OperationStats::new(3, 10);
    run_zip_create_with_progress(
        None,
        "zip-progress-test",
        &archive,
        &[source],
        None,
        &archive,
        &mut stats,
    )
    .unwrap();
    assert!(archive.exists());
    assert_eq!(stats.completed_files, 3);
    assert_eq!(stats.completed_bytes, 10);
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
fn copy_omits_nested_sockets_without_failing() {
    use std::os::unix::net::UnixListener;
    let fixture = Fixture::new();
    let source = fixture.0.join("source");
    let git_dir = source.join(".git");
    let target = fixture.0.join("target");
    fs::create_dir_all(&git_dir).unwrap();
    fs::create_dir(&target).unwrap();
    fs::write(source.join("keep.txt"), b"file").unwrap();
    fs::write(git_dir.join("config"), b"config").unwrap();
    let socket_one = git_dir.join("monitor.ipc");
    let socket_two = git_dir.join("daemon.ipc");
    let _listeners = (
        UnixListener::bind(&socket_one).unwrap(),
        UnixListener::bind(&socket_two).unwrap(),
    );

    let summary = run_copy(
        None,
        "copy-special-test",
        &[display_path(&source)],
        &display_path(&target),
        ConflictDecision::AllOverwrite,
        None,
    )
    .expect("copy should continue after unsupported nested entries");

    assert_eq!(summary.state, OperationState::Completed);
    assert_eq!(summary.completed_files, 4);
    assert_eq!(summary.failed_files, 0);
    assert_eq!(summary.skipped_files, 2);
    assert!(summary.errors.is_empty());
    assert_eq!(fs::read(target.join("source/keep.txt")).unwrap(), b"file");
    assert_eq!(
        fs::read(target.join("source/.git/config")).unwrap(),
        b"config"
    );
    assert!(!target.join("source/.git/monitor.ipc").exists());
    assert!(!target.join("source/.git/daemon.ipc").exists());
    assert!(socket_one.exists());
    assert!(socket_two.exists());
}

#[cfg(unix)]
#[test]
fn copy_omits_a_directly_selected_socket_without_creating_a_target() {
    use std::os::unix::net::UnixListener;
    let fixture = Fixture::new();
    let source = fixture.0.join("monitor.ipc");
    let _listener = UnixListener::bind(&source).unwrap();
    let target = fixture.0.join("target");
    fs::create_dir(&target).unwrap();

    let summary = run_copy(
        None,
        "copy-direct-socket-test",
        &[display_path(&source)],
        &display_path(&target),
        ConflictDecision::AllOverwrite,
        None,
    )
    .expect("a socket alone should be omitted without an error");

    assert_eq!(summary.state, OperationState::Completed);
    assert_eq!(summary.completed_files, 0);
    assert_eq!(summary.failed_files, 0);
    assert_eq!(summary.skipped_files, 1);
    assert!(summary.errors.is_empty());
    assert!(!target.join("monitor.ipc").exists());
    assert!(source.exists());
}

#[cfg(unix)]
#[test]
fn copy_still_reports_a_named_pipe_as_unsupported() {
    let fixture = Fixture::new();
    let source = fixture.0.join("source");
    let target = fixture.0.join("target");
    fs::create_dir(&source).unwrap();
    fs::create_dir(&target).unwrap();
    fs::write(source.join("keep.txt"), b"file").unwrap();
    let pipe = source.join("queue");
    assert!(Command::new("mkfifo")
        .arg(&pipe)
        .status()
        .unwrap()
        .success());

    let summary = run_copy(
        None,
        "copy-pipe-test",
        &[display_path(&source)],
        &display_path(&target),
        ConflictDecision::AllOverwrite,
        None,
    )
    .expect("copy should report the unsupported pipe and continue");

    assert_eq!(summary.state, OperationState::CompletedWithErrors);
    assert_eq!(summary.failed_files, 1);
    assert_eq!(summary.skipped_files, 1);
    assert_eq!(summary.errors.len(), 1);
    assert_eq!(
        summary.errors[0].message_key,
        "errors.specialFileCopySkipped"
    );
    assert_eq!(fs::read(target.join("source/keep.txt")).unwrap(), b"file");
    assert!(!target.join("source/queue").exists());
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
        crate::tests::report_missing_provider("zip/unzip");
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
    let name = if cfg!(windows) { " note" } else { " note " };
    fs::write(fixture.0.join(name), b"intended").unwrap();
    fs::write(fixture.0.join("note"), b"unrelated").unwrap();
    mutation::rename_entry(&display_path(&fixture.0.join(name)), "renamed").unwrap();
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
    let scan = scan_work(
        &id,
        &fixture.0,
        Path::new(""),
        &mut Vec::new(),
        &mut 0,
        SpecialFileScanPolicy::Reject,
    );
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
    let a =
        thread::spawn(|| settings_service::save_settings(serde_json::json!({"theme": "light"})));
    let b =
        thread::spawn(|| settings_service::save_settings(serde_json::json!({"language": "en"})));
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
        crate::tests::report_missing_provider("zip/unzip");
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

#[test]
fn cross_volume_move_copies_before_removing_source_and_keeps_source_on_copy_failure() {
    use super::transfer::run_move_with_rename;
    let fixture = Fixture::new();
    let source = fixture.0.join("source.txt");
    let target = fixture.0.join("target"); fs::create_dir(&target).unwrap();
    fs::write(&source, "original").unwrap();
    let summary = run_move_with_rename(None, "cross-volume", &[display_path(&source)], &display_path(&target),
        ConflictDecision::Skip, |_, _| Err(io::Error::from_raw_os_error(if cfg!(windows) { 17 } else { 18 })));
    assert_eq!(summary.state, OperationState::Completed);
    assert!(!source.exists()); assert_eq!(fs::read_to_string(target.join("source.txt")).unwrap(), "original");
    fs::write(&source, "second").unwrap(); fs::remove_file(target.join("source.txt")).unwrap();
    let summary = run_move_with_rename(None, "failed-cross-volume", &[display_path(&source)], &display_path(&target),
        ConflictDecision::Skip, |_, _| {
            // 스캔 이후 대상이 생기는 경합: 새 대상과 원본 모두 보존.
            fs::write(target.join("source.txt"), "concurrent").unwrap();
            Err(io::Error::from_raw_os_error(if cfg!(windows) { 17 } else { 18 }))
        });
    assert_eq!(summary.state, OperationState::Failed);
    assert_eq!(fs::read_to_string(&source).unwrap(), "second");
    assert_eq!(fs::read_to_string(target.join("source.txt")).unwrap(), "concurrent");
}

#[test]
fn cross_volume_move_cancellation_keeps_source() {
    use super::transfer::run_move_with_rename;
    let fixture = Fixture::new(); let source = fixture.0.join("source.txt");
    let target = fixture.0.join("target"); fs::create_dir(&target).unwrap(); fs::write(&source, "original").unwrap();
    let id = next_operation_id(OperationKind::Move); register_operation(&id);
    let summary = run_move_with_rename(None, &id, &[display_path(&source)], &display_path(&target),
        ConflictDecision::Skip, |_, _| {
            super::runtime::cancel_operation(id.clone()).unwrap();
            Err(io::Error::from_raw_os_error(if cfg!(windows) { 17 } else { 18 }))
        });
    finish_operation(&id);
    assert_eq!(summary.state, OperationState::Cancelled);
    assert_eq!(fs::read_to_string(source).unwrap(), "original");
    assert!(!target.join("source.txt").exists());
}

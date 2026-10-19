use super::super::runtime::{
    cancel_operation, finish_operation, next_operation_id, register_operation,
};
use super::{capture_process, CapturePolicy};
use crate::contracts::OperationKind;
use std::io::Write;
use std::path::PathBuf;
use std::process::Command;
use std::time::{Duration, Instant};

const FIXTURE_TEST: &str = "operation::process::tests::process_fixture_entry";

#[cfg(windows)]
#[test]
fn long_working_directory_spawn_failure_has_a_specific_recovery_hint() {
    use super::spawn_error;
    use std::io::Error;
    use std::path::Path;

    let directory = PathBuf::from(format!(r"C:\{}", "한글😀".repeat(70)));
    for code in [87, 267] {
        let error = spawn_error(Error::from_raw_os_error(code), Some(&directory), None);
        assert_eq!(error.code, "working_directory_too_long");
        assert_eq!(error.message_key, "errors.workingDirectoryTooLong");
        assert!(error.recoverable);
        assert!(error.path.is_some());
    }
    // Other failures and short/missing working directories keep their original diagnosis.
    assert_eq!(spawn_error(Error::from_raw_os_error(5), Some(&directory), None).code, "permission_denied");
    for directory in [None, Some(Path::new(r"C:\short"))] {
        assert_ne!(spawn_error(Error::from_raw_os_error(267), directory, None).code, "working_directory_too_long");
    }
}

pub(in crate::operation) fn fixture_command(mode: &str) -> Command {
    let mut command = Command::new(std::env::current_exe().unwrap());
    command
        .args(["--exact", FIXTURE_TEST, "--nocapture"])
        .env("BOKSLDIRGUI_PROCESS_FIXTURE", mode);
    command
}

// Execute this test in a separate process to exercise real pipes and process descendants on both OSes.
#[test]
fn process_fixture_entry() {
    let Ok(mode) = std::env::var("BOKSLDIRGUI_PROCESS_FIXTURE") else {
        return;
    };
    match mode.as_str() {
        "flood" => {
            let chunk = [b'x'; 8192];
            for _ in 0..256 {
                std::io::stdout().write_all(&chunk).unwrap();
                std::io::stderr().write_all(&chunk).unwrap();
            }
        }
        "sleep" => std::thread::sleep(Duration::from_secs(10)),
        "fail" => std::process::exit(7),
        "child" => {
            let root = PathBuf::from(std::env::var_os("BOKSLDIRGUI_PROCESS_DIRECTORY").unwrap());
            std::fs::write(root.join("ready"), b"child started").unwrap();
            std::thread::sleep(Duration::from_secs(3));
            std::fs::write(root.join("should-not-exist"), b"child survived").unwrap();
        }
        "tree" | "orphan" => {
            let mut child = fixture_command("child").spawn().unwrap();
            if mode == "tree" {
                child.wait().unwrap();
            }
        }
        _ => panic!("unknown test mode"),
    }
}

fn policy(timeout: Duration) -> CapturePolicy {
    CapturePolicy {
        stdout_limit: Some(1024),
        stderr_limit: 1024,
        timeout: Some(timeout),
    }
}

#[test]
fn bounded_capture_drains_both_streams_and_preserves_failure_status() {
    let output = capture_process(
        "bounded-test",
        fixture_command("flood"),
        None,
        policy(Duration::from_secs(20)),
        None,
        None,
    )
    .unwrap();
    assert!(output.status.success());
    assert!(!output.timed_out);
    assert!(output.truncated);
    assert_eq!(output.stdout.len(), 1024);
    assert_eq!(output.stderr.len(), 1024);
    let output = capture_process(
        "failure-test",
        fixture_command("fail"),
        None,
        policy(Duration::from_secs(20)),
        None,
        None,
    )
    .unwrap();
    assert_eq!(output.status.code(), Some(7));
}

#[test]
fn timeout_terminates_a_process_without_waiting_for_its_full_duration() {
    let start = Instant::now();
    let output = capture_process(
        "timeout-test",
        fixture_command("sleep"),
        None,
        policy(Duration::from_millis(150)),
        None,
        None,
    )
    .unwrap();
    assert!(output.timed_out);
    assert!(!output.cancelled);
    assert!(start.elapsed() < Duration::from_secs(3));
}

#[test]
fn cancellation_kills_descendants_even_after_the_parent_exits() {
    for mode in ["tree", "orphan"] {
        let id = next_operation_id(OperationKind::ShellCommand);
        register_operation(&id);
        let root = std::env::temp_dir().join(&id);
        std::fs::create_dir(&root).unwrap();
        let mut command = fixture_command(mode);
        command.env("BOKSLDIRGUI_PROCESS_DIRECTORY", &root);
        let worker_id = id.clone();
        let worker = std::thread::spawn(move || {
            capture_process(
                &worker_id,
                command,
                None,
                policy(Duration::from_secs(15)),
                None,
                None,
            )
        });
        let start = Instant::now();
        while !root.join("ready").exists() && start.elapsed() < Duration::from_secs(10) {
            std::thread::sleep(Duration::from_millis(10));
        }
        let ready = root.join("ready").exists();
        let cancel_at = Instant::now();
        cancel_operation(id.clone()).unwrap();
        let result = worker.join().unwrap();
        finish_operation(&id);
        assert!(ready, "child fixture did not start: {mode}");
        assert!(result.unwrap().cancelled);
        assert!(
            cancel_at.elapsed() < Duration::from_secs(2),
            "descendant kept output pipes alive: {mode}"
        );
        assert!(!root.join("should-not-exist").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
}

#[test]
fn cancellation_before_spawn_starts_no_process() {
    let id = next_operation_id(OperationKind::ShellCommand);
    register_operation(&id);
    cancel_operation(id.clone()).unwrap();
    let result = capture_process(
        &id,
        fixture_command("sleep"),
        None,
        policy(Duration::from_secs(1)),
        None,
        None,
    );
    finish_operation(&id);
    assert_eq!(result.err().unwrap().code, "operation_cancelled");
}

use crate::contracts::{AppError, CommandResult};
use crate::filesystem::map_io_error;
use std::io::Read;
use std::path::Path;
use std::process::Command;
use std::sync::Mutex;
use std::time::Duration;

use std::process::Stdio;
use std::sync::mpsc;
use std::sync::Arc;
use std::thread;

use super::runtime::{
    is_cancelled, kill_external_child, register_external_process, unregister_external_process,
};

pub(super) fn run_external_command(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
) -> CommandResult<()> {
    run_external_command_capture(operation_id, command, path).map(|_| ())
}

pub(super) fn run_external_command_with_secret(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
    secret: Option<&str>,
) -> CommandResult<()> {
    run_external_command(operation_id, command, path)
        .map_err(|error| redact_error_secret(error, secret))
}

pub(super) fn run_external_command_capture_with_secret(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
    secret: Option<&str>,
) -> CommandResult<Vec<u8>> {
    run_external_command_capture(operation_id, command, path)
        .map_err(|error| redact_error_secret(error, secret))
}

pub(super) fn redact_error_secret(mut error: AppError, secret: Option<&str>) -> AppError {
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

pub(super) fn run_external_command_capture(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
) -> CommandResult<Vec<u8>> {
    run_external_command_capture_observed(operation_id, command, path, None)
}

pub(super) fn run_external_command_capture_observed(
    operation_id: &str,
    command: Command,
    path: Option<&Path>,
    on_stdout: Option<&mut dyn FnMut(&[u8])>,
) -> CommandResult<Vec<u8>> {
    let output = capture_process(
        operation_id,
        command,
        path,
        CapturePolicy {
            stdout_limit: None,
            stderr_limit: 64 * 1024,
            timeout: None,
        },
        on_stdout,
        None,
    )?;
    if output.cancelled {
        return Err(AppError::new(
            "operation_cancelled",
            "errors.operationCancelled",
            path,
            true,
        ));
    }
    if output.status.success() {
        return Ok(output.stdout);
    }
    Err(AppError::new(
        "external_command_failed",
        "errors.externalCommandFailed",
        path,
        true,
    )
    .with_detail(
        "exitCode",
        output
            .status
            .code()
            .map_or_else(|| "signal".to_owned(), |code| code.to_string()),
    )
    .with_detail(
        "stderr",
        String::from_utf8_lossy(&output.stderr)
            .chars()
            .take(512)
            .collect::<String>(),
    ))
}

pub(super) struct CapturePolicy {
    pub(super) stdout_limit: Option<usize>,
    pub(super) stderr_limit: usize,
    pub(super) timeout: Option<Duration>,
}

pub(super) struct CapturedProcess {
    pub(super) status: std::process::ExitStatus,
    pub(super) stdout: Vec<u8>,
    pub(super) stderr: Vec<u8>,
    pub(super) truncated: bool,
    pub(super) timed_out: bool,
    pub(super) cancelled: bool,
}

struct CapturedStream {
    bytes: Vec<u8>,
    total: u64,
}

fn read_stream(
    mut stream: impl Read,
    limit: Option<usize>,
    observer: Option<mpsc::SyncSender<Vec<u8>>>,
    total: Arc<std::sync::atomic::AtomicU64>,
) -> std::io::Result<CapturedStream> {
    let mut captured = CapturedStream {
        bytes: Vec::new(),
        total: 0,
    };
    let mut chunk = [0; 8192];
    loop {
        let count = match stream.read(&mut chunk) {
            Ok(0) => break,
            Ok(count) => count,
            Err(e) if e.kind() == std::io::ErrorKind::Interrupted => continue,
            Err(e) => return Err(e),
        };
        captured.total += count as u64;
        total.fetch_add(count as u64, std::sync::atomic::Ordering::Relaxed);
        let retained = limit.map_or(count, |max| {
            count.min(max.saturating_sub(captured.bytes.len()))
        });
        captured.bytes.extend_from_slice(&chunk[..retained]);
        if let Some(observer) = &observer {
            // Bounded queue: progress output cannot grow unchecked while the consumer is busy.
            let _ = observer.send(chunk[..count].to_vec());
        }
    }
    Ok(captured)
}

fn spawn_managed(command: Command) -> std::io::Result<Box<dyn process_wrap::std::ChildWrapper>> {
    let mut command = process_wrap::std::CommandWrap::from(command);
    #[cfg(unix)]
    command.wrap(process_wrap::std::ProcessGroup::leader());
    #[cfg(windows)]
    {
        let mut flags = process_wrap::std::CreationFlags(Default::default());
        flags.0 .0 = 0x08000000; // CREATE_NO_WINDOW; JobObject temporarily adds CREATE_SUSPENDED.
        command.wrap(flags).wrap(process_wrap::std::JobObject);
    }
    command.spawn()
}

fn spawn_error(error: std::io::Error, working_dir: Option<&Path>, path: Option<&Path>) -> AppError {
    #[cfg(windows)]
    if matches!(error.raw_os_error(), Some(87 | 267))
        && working_dir.is_some_and(|directory| {
            use std::os::windows::ffi::OsStrExt;
            directory.as_os_str().encode_wide().count() >= 260
        })
    {
        // CreateProcessW still limits the working directory even when file APIs accept long paths.
        return AppError::new(
            "working_directory_too_long",
            "errors.workingDirectoryTooLong",
            working_dir,
            true,
        ).with_detail("osCode", error.raw_os_error().unwrap().to_string());
    }
    #[cfg(not(windows))]
    let _ = working_dir;
    map_io_error(error, path)
}

/// One capture/cancellation boundary for archive tools and user commands.
/// Readers keep draining after their retention limit, so full pipes cannot deadlock the child.
pub(super) fn capture_process(
    operation_id: &str,
    mut command: Command,
    path: Option<&Path>,
    policy: CapturePolicy,
    mut on_stdout: Option<&mut dyn FnMut(&[u8])>,
    mut on_tick: Option<&mut dyn FnMut(u64)>,
) -> CommandResult<CapturedProcess> {
    if is_cancelled(operation_id) {
        return Err(AppError::new(
            "operation_cancelled",
            "errors.operationCancelled",
            path,
            true,
        ));
    }
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let working_dir = command.get_current_dir().map(Path::to_path_buf);
    let mut child = spawn_managed(command)
        .map_err(|error| spawn_error(error, working_dir.as_deref(), path))?;
    let stdout = child.stdout().take().expect("piped stdout");
    let stderr = child.stderr().take().expect("piped stderr");
    let child_handle = Arc::new(Mutex::new(child));
    register_external_process(operation_id, Arc::clone(&child_handle));
    struct Registration<'a> {
        id: &'a str,
        child: super::runtime::ExternalChild,
        complete: bool,
    }
    impl Drop for Registration<'_> {
        fn drop(&mut self) {
            if !self.complete {
                kill_external_child(&self.child);
                let _ = self.child.lock().expect("external process lock").wait();
            }
            unregister_external_process(self.id);
        }
    }
    let mut registration = Registration {
        id: operation_id,
        child: Arc::clone(&child_handle),
        complete: false,
    };
    let (progress_tx, progress_rx) = mpsc::sync_channel::<Vec<u8>>(16);
    let stdout_tx = on_stdout.is_some().then_some(progress_tx);
    let total = Arc::new(std::sync::atomic::AtomicU64::new(0));
    let stdout_total = Arc::clone(&total);
    let stderr_total = Arc::clone(&total);
    let stdout_reader =
        thread::spawn(move || read_stream(stdout, policy.stdout_limit, stdout_tx, stdout_total));
    let stderr_reader =
        thread::spawn(move || read_stream(stderr, Some(policy.stderr_limit), None, stderr_total));
    let started = std::time::Instant::now();
    let mut status = None;
    let mut timed_out = false;
    let mut killed = false;
    let mut wait_error = None;
    loop {
        if let Some(observer) = on_stdout.as_mut() {
            // Bound each drain to keep cancellation responsive during continuous output.
            for _ in 0..32 {
                match progress_rx.try_recv() {
                    Ok(chunk) => observer(&chunk),
                    Err(_) => break,
                }
            }
        }
        if let Some(tick) = on_tick.as_mut() {
            tick(total.load(std::sync::atomic::Ordering::Relaxed));
        }
        if !killed
            && (is_cancelled(operation_id)
                || policy
                    .timeout
                    .is_some_and(|limit| started.elapsed() >= limit))
        {
            timed_out = !is_cancelled(operation_id);
            kill_external_child(&child_handle);
            killed = true;
        }
        if status.is_none() && wait_error.is_none() {
            match child_handle
                .lock()
                .expect("external process lock")
                .try_wait()
            {
                Ok(value) => status = value,
                Err(error) => wait_error = Some(error),
            }
        }
        if wait_error.is_some() && !killed {
            kill_external_child(&child_handle);
            killed = true;
        }
        if (status.is_some() || wait_error.is_some())
            && stdout_reader.is_finished()
            && stderr_reader.is_finished()
        {
            break;
        }
        thread::sleep(Duration::from_millis(25));
    }
    if let Some(observer) = on_stdout.as_mut() {
        while let Ok(chunk) = progress_rx.try_recv() {
            observer(&chunk);
        }
    }
    let join = |result: thread::Result<std::io::Result<CapturedStream>>| {
        result
            .unwrap_or_else(|_| Err(std::io::Error::other("output reader panicked")))
            .map_err(|e| map_io_error(e, path))
    };
    let stdout = join(stdout_reader.join())?;
    let stderr = join(stderr_reader.join())?;
    if let Some(error) = wait_error {
        return Err(map_io_error(error, path));
    }
    registration.complete = true;
    Ok(CapturedProcess {
        status: status.expect("process exit status"),
        truncated: stdout.total > stdout.bytes.len() as u64
            || stderr.total > stderr.bytes.len() as u64,
        stdout: stdout.bytes,
        stderr: stderr.bytes,
        timed_out,
        cancelled: is_cancelled(operation_id),
    })
}

pub(super) fn external_binary(name: &str) -> Option<String> {
    if matches!(name, "7zz" | "7z") {
        return crate::archive_provider::seven_zip();
    }
    crate::platform::find_executable(name)
}

#[cfg(test)]
#[path = "process_tests.rs"]
pub(super) mod tests;

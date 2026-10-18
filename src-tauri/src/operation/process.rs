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
    mut command: Command,
    path: Option<&Path>,
    mut on_stdout: Option<&mut dyn FnMut(&[u8])>,
) -> CommandResult<Vec<u8>> {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|error| map_io_error(error, path))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let (progress_tx, progress_rx) = mpsc::channel::<Vec<u8>>();
    let observe_stdout = on_stdout.is_some();
    let mut stdout_reader = stdout.map(|mut stdout| {
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let mut chunk = [0; 8192];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        bytes.extend_from_slice(&chunk[..count]);
                        if observe_stdout {
                            let _ = progress_tx.send(chunk[..count].to_vec());
                        }
                    }
                }
            }
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
        if let Some(observer) = on_stdout.as_mut() {
            while let Ok(chunk) = progress_rx.try_recv() {
                observer(&chunk);
            }
        }
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
    if let Some(observer) = on_stdout.as_mut() {
        while let Ok(chunk) = progress_rx.try_recv() {
            observer(&chunk);
        }
    }
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

pub(super) fn external_binary(name: &str) -> Option<String> {
    if matches!(name, "7zz" | "7z") {
        return crate::archive_provider::seven_zip();
    }
    crate::platform::find_executable(name)
}

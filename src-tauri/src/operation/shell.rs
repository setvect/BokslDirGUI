use super::process::{capture_process, CapturePolicy};
use super::runtime::{emit_state, error_summary, is_cancelled, launch_operation};
use crate::contracts::{
    AppError, CommandResult, OperationKind, OperationStarted, OperationState, OperationSummary,
    ShellCommandResult,
};
use crate::path_text::display_path;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{Duration, Instant};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5 * 60);
const OUTPUT_LIMIT: usize = 16 * 1024;

pub(crate) fn start(
    app: &tauri::AppHandle,
    command: Command,
    directory: PathBuf,
) -> CommandResult<OperationStarted> {
    launch_operation(Some(app), OperationKind::ShellCommand, None, move |app, operation_id| {
        run(app, operation_id, command, &directory, COMMAND_TIMEOUT)
    })
}

fn run(
    app: Option<&tauri::AppHandle>,
    id: &str,
    command: Command,
    directory: &Path,
    timeout: Duration,
) -> OperationSummary {
    let kind = OperationKind::ShellCommand;
    emit_state(
        app,
        id,
        kind,
        OperationState::Running,
        None,
        0,
        0,
        Some(directory),
    );
    let mut last_tick = Instant::now();
    let output = capture_process(
        id,
        command,
        Some(directory),
        CapturePolicy {
            stdout_limit: Some(OUTPUT_LIMIT),
            stderr_limit: OUTPUT_LIMIT,
            timeout: Some(timeout),
        },
        None,
        Some(&mut |bytes| {
            if last_tick.elapsed() >= Duration::from_millis(200) {
                emit_state(
                    app,
                    id,
                    kind,
                    if is_cancelled(id) {
                        OperationState::Cancelling
                    } else {
                        OperationState::Running
                    },
                    None,
                    0,
                    bytes,
                    Some(directory),
                );
                last_tick = Instant::now();
            }
        }),
    );
    let output = match output {
        Ok(output) => output,
        Err(error) => return error_summary(id, kind, error),
    };
    let (state, errors) = if output.timed_out {
        (
            OperationState::Failed,
            vec![AppError::new(
                "command_timed_out",
                "errors.shellCommandTimedOut",
                Some(directory),
                true,
            )],
        )
    } else if output.cancelled {
        (OperationState::Cancelled, Vec::new())
    } else if !output.status.success() {
        (
            OperationState::Failed,
            vec![AppError::new(
                "external_command_failed",
                "errors.externalCommandFailed",
                Some(directory),
                true,
            )],
        )
    } else {
        (OperationState::Completed, Vec::new())
    };
    OperationSummary {
        operation_id: id.to_owned(),
        kind,
        state,
        completed_files: u64::from(state == OperationState::Completed),
        failed_files: u64::from(state == OperationState::Failed),
        skipped_files: 0,
        errors,
        command_result: Some(ShellCommandResult {
            working_dir: display_path(directory),
            exit_code: output.status.code(),
            stdout: decode_output(&output.stdout),
            stderr: decode_output(&output.stderr),
            truncated: output.truncated,
            timed_out: output.timed_out,
        }),
    }
}

fn decode_output(bytes: &[u8]) -> String {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let little = bytes[0] == 0xff;
        let units = bytes[2..]
            .chunks_exact(2)
            .map(|b| {
                if little {
                    u16::from_le_bytes([b[0], b[1]])
                } else {
                    u16::from_be_bytes([b[0], b[1]])
                }
            })
            .collect::<Vec<_>>();
        return String::from_utf16_lossy(&units);
    }
    let bytes = bytes.strip_prefix(&[0xef, 0xbb, 0xbf]).unwrap_or(bytes);
    match std::str::from_utf8(bytes) {
        Ok(value) => return value.to_owned(),
        Err(error) if error.error_len().is_none() => {
            return String::from_utf8_lossy(&bytes[..error.valid_up_to()]).into_owned()
        }
        Err(_) => {}
    }
    #[cfg(windows)]
    {
        use windows::Win32::Globalization::{
            GetOEMCP, MultiByteToWideChar, MULTI_BYTE_TO_WIDE_CHAR_FLAGS,
        };
        let mut wide = vec![0u16; bytes.len()];
        let count = unsafe {
            MultiByteToWideChar(
                GetOEMCP(),
                MULTI_BYTE_TO_WIDE_CHAR_FLAGS(0),
                bytes,
                Some(&mut wide),
            )
        };
        if count > 0 {
            return String::from_utf16_lossy(&wide[..count as usize]);
        }
    }
    String::from_utf8_lossy(bytes).into_owned()
}

#[cfg(test)]
pub(crate) fn run_for_test(
    working_dir: String,
    command: String,
    args: Option<Vec<String>>,
    token: Option<String>,
) -> CommandResult<ShellCommandResult> {
    let (command, directory) = crate::shell_command::confirmed_command(
        &working_dir,
        &command,
        args.unwrap_or_default(),
        token.as_deref(),
    )?;
    let id = super::runtime::next_operation_id(OperationKind::ShellCommand);
    super::runtime::register_operation(&id);
    let summary = run(None, &id, command, &directory, COMMAND_TIMEOUT);
    super::runtime::finish_operation(&id);
    summary.command_result.ok_or_else(|| {
        summary
            .errors
            .into_iter()
            .next()
            .expect("failed shell result has error")
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_output, run};
    use crate::contracts::OperationState;
    use crate::operation::process::tests::fixture_command;
    use std::time::Duration;
    #[test]
    fn command_summary_retains_output_on_success_failure_and_timeout() {
        let dir = std::env::temp_dir();
        let summary = run(
            None,
            "summary-flood",
            fixture_command("flood"),
            &dir,
            Duration::from_secs(20),
        );
        assert_eq!(summary.state, OperationState::Completed);
        let result = summary.command_result.unwrap();
        assert!(result.truncated);
        assert_eq!(result.stdout.len(), 16 * 1024);
        assert_eq!(result.stderr.len(), 16 * 1024);
        let summary = run(
            None,
            "summary-failure",
            fixture_command("fail"),
            &dir,
            Duration::from_secs(20),
        );
        assert_eq!(summary.state, OperationState::Failed);
        assert_eq!(summary.command_result.unwrap().exit_code, Some(7));
        let summary = run(
            None,
            "summary-timeout",
            fixture_command("sleep"),
            &dir,
            Duration::from_millis(150),
        );
        assert_eq!(summary.state, OperationState::Failed);
        assert_eq!(summary.errors[0].code, "command_timed_out");
        assert!(summary.command_result.unwrap().timed_out);
    }

    #[test]
    fn decodes_unicode_boms_without_exposing_binary_nuls() {
        assert_eq!(decode_output(b"\xef\xbb\xbfhello"), "hello");
        assert_eq!(decode_output(&[0xed, 0x95, 0x9c, 0xe3]), "한");
        assert_eq!(decode_output(&[0xff, 0xfe, 0x5c, 0xd5, 0x00, 0xae]), "한글");
        assert_eq!(decode_output(&[0xfe, 0xff, 0xd5, 0x5c, 0xae, 0x00]), "한글");
    }
}

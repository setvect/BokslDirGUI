use crate::contracts::{ActionResult, AppError, CommandResult};
#[cfg(not(windows))]
use crate::filesystem::map_io_error;
use crate::navigation;
use std::env;
use std::path::Path;
#[cfg(not(windows))]
use std::process::Command;

pub(crate) fn open_default(path: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    run_open_command(&path, false)
}

pub(crate) fn reveal_in_manager(path: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    run_open_command(&path, true)
}

pub(crate) fn open_current_in_file_manager(path: &str) -> CommandResult<ActionResult> {
    open_directory_in_app(path, false)
}

pub(crate) fn open_current_in_terminal(path: &str) -> CommandResult<ActionResult> {
    open_directory_in_app(path, true)
}

fn open_directory_in_app(path: &str, terminal: bool) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_directory(path)?;
    #[cfg(target_os = "macos")]
    {
        if env::var_os("BOKSLDIRGUI_EXTERNAL_DRY_RUN").is_none() {
            let mut command = Command::new("open");
            command
                .arg("-b")
                .arg(if terminal { "com.apple.Terminal" } else { "com.apple.finder" })
                .arg(&path);
            launch_external(command, &path)?;
        }
        Ok(ActionResult {
            ok: true,
            message_key: None,
        })
    }
    #[cfg(windows)]
    {
        if terminal {
            if env::var_os("BOKSLDIRGUI_EXTERNAL_DRY_RUN").is_none() {
                crate::external_terminal::open(&path)?;
            }
            Ok(ActionResult { ok: true, message_key: None })
        } else {
            run_open_command(&path, false)
        }
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = terminal;
        Err(AppError::new(
            "unsupported",
            "errors.commandNotImplemented",
            Some(&path),
            true,
        ))
    }
}

fn run_open_command(path: &Path, reveal: bool) -> CommandResult<ActionResult> {
    if env::var_os("BOKSLDIRGUI_EXTERNAL_DRY_RUN").is_some() {
        return Ok(ActionResult {
            ok: true,
            message_key: Some("external.dryRun".to_string()),
        });
    }

    #[cfg(windows)]
    {
        let path = path.to_owned();
        crate::windows_shell::run_sta(move || crate::windows_shell::open_item(&path, reveal)
            .map_err(|e| crate::windows_shell::error(e, Some(&path))))?;
    }
    #[cfg(not(windows))]
    launch_external(platform_open_command(path, reveal)?, path)?;
    Ok(ActionResult {
        ok: true,
        message_key: None,
    })
}

#[cfg(target_os = "macos")]
fn platform_open_command(path: &Path, reveal: bool) -> CommandResult<Command> {
    let mut command = Command::new("open");
    if reveal {
        command.arg("-R");
    }
    command.arg(path);
    Ok(command)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn platform_open_command(path: &Path, _reveal: bool) -> CommandResult<Command> {
    let mut command = Command::new("xdg-open");
    command.arg(path);
    Ok(command)
}

// `open`은 실행 요청만 넘기고 바로 끝나므로 종료 상태로 실패를 보고하고 자식 프로세스 회수
#[cfg(target_os = "macos")]
fn launch_external(mut command: Command, path: &Path) -> CommandResult<()> {
    let status = command
        .status()
        .map_err(|error| map_io_error(error, Some(path)))?;
    if !status.success() {
        return Err(AppError::new(
            "external_failed",
            "errors.externalCommandFailed",
            Some(path),
            true,
        ));
    }
    Ok(())
}

// `xdg-open`은 환경에 따라 연결 앱 종료까지 기다릴 수 있어 응답을 막지 않고 백그라운드에서 회수
#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn launch_external(mut command: Command, path: &Path) -> CommandResult<()> {
    let mut child = command
        .spawn()
        .map_err(|error| map_io_error(error, Some(path)))?;
    std::thread::spawn(move || {
        let _ = child.wait();
    });
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::launch_external;
    use std::path::Path;
    use std::process::Command;

    #[test]
    fn launch_external_waits_for_open_and_reports_its_failure() {
        let path = Path::new("/");
        assert!(launch_external(Command::new("/usr/bin/true"), path).is_ok());
        let error = launch_external(Command::new("/usr/bin/false"), path).unwrap_err();
        assert_eq!(error.message_key, "errors.externalCommandFailed");
    }
}

use crate::contracts::{ActionResult, AppError, CommandResult};
use crate::filesystem::map_io_error;
use crate::navigation;
use std::env;
use std::path::Path;
use std::process::Command;

pub(crate) fn open_default(path: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    run_open_command(&path, false)
}

pub(crate) fn reveal_in_manager(path: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    run_open_command(&path, true)
}

pub(crate) fn open_current_in_finder(path: &str) -> CommandResult<ActionResult> {
    open_directory_in_app(path, "com.apple.finder")
}

pub(crate) fn open_current_in_terminal(path: &str) -> CommandResult<ActionResult> {
    open_directory_in_app(path, "com.apple.Terminal")
}

fn open_directory_in_app(path: &str, bundle_id: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&path),
            true,
        ));
    }
    #[cfg(target_os = "macos")]
    {
        if env::var_os("BOKSLDIRGUI_EXTERNAL_DRY_RUN").is_none() {
            Command::new("open")
                .arg("-b")
                .arg(bundle_id)
                .arg(&path)
                .spawn()
                .map_err(|error| map_io_error(error, Some(&path)))?;
        }
        Ok(ActionResult {
            ok: true,
            message_key: None,
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
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

    let mut command = platform_open_command(path, reveal)?;
    command
        .spawn()
        .map_err(|error| map_io_error(error, Some(path)))?;
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

#[cfg(target_os = "windows")]
fn platform_open_command(path: &Path, reveal: bool) -> CommandResult<Command> {
    let mut command = Command::new("explorer");
    if reveal {
        command.arg("/select,");
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

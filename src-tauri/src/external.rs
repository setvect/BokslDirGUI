use crate::contracts::{ActionResult, AppError, CommandResult};
use crate::filesystem::map_io_error;
use crate::navigation;
use crate::settings_service;
use std::env;
use std::path::Path;
use std::process::Command;

pub(crate) fn open_default(path: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    run_open_command(&path, false, None)
}

pub(crate) fn reveal_in_manager(path: &str) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    run_open_command(&path, true, None)
}

pub(crate) fn open_external_editor(
    path: &str,
    editor_id: Option<&str>,
) -> CommandResult<ActionResult> {
    let path = navigation::canonical_existing_path(path)?;
    let settings = settings_service::load_settings()?;
    let editor = editor_id
        .map(str::to_string)
        .or(settings.external.editor_id)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            AppError::new(
                "disabled",
                "errors.externalEditorNotConfigured",
                Some(&path),
                true,
            )
        })?;
    run_open_command(&path, false, Some(editor))
}

fn run_open_command(
    path: &Path,
    reveal: bool,
    editor: Option<String>,
) -> CommandResult<ActionResult> {
    if env::var_os("BOKSLDIRGUI_EXTERNAL_DRY_RUN").is_some() {
        return Ok(ActionResult {
            ok: true,
            message_key: Some("external.dryRun".to_string()),
        });
    }

    let mut command = if let Some(editor) = editor {
        let mut command = Command::new(editor);
        command.arg(path);
        command
    } else {
        platform_open_command(path, reveal)?
    };
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

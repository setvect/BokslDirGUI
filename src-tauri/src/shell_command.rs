use crate::contracts::{
    AppError, CommandResult, ShellCommandPolicy, ShellCommandPreview, ShellCommandResult,
};
use crate::filesystem::{map_io_error, unix_text};
use crate::navigation;
use crate::path_text::display_path;
use crate::settings_service;
use std::collections::BTreeMap;
use std::path::Path;
use std::process::Command;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering as AtomicOrdering;
use std::sync::Mutex;
use std::sync::OnceLock;
use std::time::Duration;
use std::time::Instant;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

static SHELL_TOKENS: OnceLock<Mutex<BTreeMap<String, ShellToken>>> = OnceLock::new();
static SHELL_TOKEN_COUNTER: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static SHELL_TEST_CLOCK_OFFSET_MS: AtomicU64 = AtomicU64::new(0);
const SHELL_TOKEN_TTL: Duration = Duration::from_secs(60);
const SHELL_OUTPUT_LIMIT: usize = 16 * 1024;

#[derive(Debug, Clone)]
struct ShellToken {
    fingerprint: String,
    expires_at: Instant,
    expires_at_text: String,
    used: bool,
}

pub(crate) fn prepare_shell_command(
    working_dir: &str,
    command: &str,
    args: Vec<String>,
) -> CommandResult<ShellCommandPreview> {
    let settings = settings_service::load_settings()?;
    let working_dir = navigation::canonical_existing_path(working_dir)?;
    if !working_dir.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&working_dir),
            true,
        ));
    }
    let fingerprint = fingerprint(&working_dir, command, &args)?;
    let enabled = settings.external.shell_command.enabled;
    if !enabled {
        return Ok(ShellCommandPreview {
            confirm_token: "disabled".to_string(),
            expires_at: epoch_text(),
            fingerprint,
            requires_confirmation: true,
            policy: ShellCommandPolicy {
                enabled: false,
                reason_key: Some("settings.external.shellCommand.disabledByDefault".to_string()),
            },
        });
    }
    let token = next_token();
    let expires_at = shell_now_instant() + SHELL_TOKEN_TTL;
    let expires_at_text = unix_text(shell_now_system() + SHELL_TOKEN_TTL);
    token_registry()
        .lock()
        .expect("shell token registry lock should not be poisoned")
        .insert(
            token.clone(),
            ShellToken {
                fingerprint: fingerprint.clone(),
                expires_at,
                expires_at_text: expires_at_text.clone(),
                used: false,
            },
        );
    Ok(ShellCommandPreview {
        confirm_token: token,
        expires_at: expires_at_text,
        fingerprint,
        requires_confirmation: true,
        policy: ShellCommandPolicy {
            enabled: true,
            reason_key: None,
        },
    })
}

pub(crate) fn run_shell_command(
    working_dir: &str,
    command: &str,
    args: Vec<String>,
    confirm_token: Option<&str>,
) -> CommandResult<ShellCommandResult> {
    let settings = settings_service::load_settings()?;
    if !settings.external.shell_command.enabled {
        return Err(AppError::new(
            "disabled",
            "errors.shellCommandDisabled",
            None,
            true,
        ));
    }
    let working_dir = navigation::canonical_existing_path(working_dir)?;
    if !working_dir.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&working_dir),
            true,
        ));
    }
    let fingerprint = fingerprint(&working_dir, command, &args)?;
    if let Some(confirm_token) = confirm_token {
        consume_token(confirm_token, &fingerprint)?;
    }
    let output = Command::new(command)
        .args(&args)
        .current_dir(&working_dir)
        .output()
        .map_err(|error| map_io_error(error, Some(&working_dir)))?;
    Ok(ShellCommandResult {
        exit_code: output.status.code(),
        stdout: limit_output(&String::from_utf8_lossy(&output.stdout)),
        stderr: limit_output(&String::from_utf8_lossy(&output.stderr)),
        timed_out: false,
    })
}

fn consume_token(token: &str, fingerprint: &str) -> CommandResult<()> {
    let mut registry = token_registry()
        .lock()
        .expect("shell token registry lock should not be poisoned");
    let Some(stored) = registry.get_mut(token) else {
        return Err(AppError::new(
            "invalid_token",
            "errors.shellConfirmationInvalid",
            None,
            true,
        ));
    };
    if stored.used || stored.expires_at < shell_now_instant() || stored.fingerprint != fingerprint {
        return Err(AppError::new(
            "invalid_token",
            "errors.shellConfirmationInvalid",
            None,
            true,
        )
        .with_detail("expiresAt", stored.expires_at_text.clone()));
    }
    stored.used = true;
    Ok(())
}

fn fingerprint(working_dir: &Path, command: &str, args: &[String]) -> CommandResult<String> {
    let command = command.trim();
    if command.is_empty() || command.contains('\0') {
        return Err(AppError::new(
            "invalid_command",
            "errors.invalidShellCommand",
            Some(working_dir),
            true,
        ));
    }
    if args.iter().any(|arg| arg.contains('\0')) {
        return Err(AppError::new(
            "invalid_command",
            "errors.invalidShellCommand",
            Some(working_dir),
            true,
        ));
    }
    Ok(format!(
        "{}::{}::{:?}",
        display_path(working_dir),
        command,
        args
    ))
}

fn token_registry() -> &'static Mutex<BTreeMap<String, ShellToken>> {
    SHELL_TOKENS.get_or_init(|| Mutex::new(BTreeMap::new()))
}

fn shell_now_instant() -> Instant {
    Instant::now() + shell_clock_offset()
}

fn shell_now_system() -> SystemTime {
    SystemTime::now() + shell_clock_offset()
}

fn shell_clock_offset() -> Duration {
    #[cfg(test)]
    {
        Duration::from_millis(SHELL_TEST_CLOCK_OFFSET_MS.load(AtomicOrdering::SeqCst))
    }
    #[cfg(not(test))]
    {
        Duration::ZERO
    }
}

#[cfg(test)]
pub(crate) fn advance_clock_past_token_ttl_for_test() {
    SHELL_TEST_CLOCK_OFFSET_MS.store(
        (SHELL_TOKEN_TTL + Duration::from_secs(1)).as_millis() as u64,
        AtomicOrdering::SeqCst,
    );
}

#[cfg(test)]
pub(crate) fn reset_clock_for_test() {
    SHELL_TEST_CLOCK_OFFSET_MS.store(0, AtomicOrdering::SeqCst);
}

fn next_token() -> String {
    let counter = SHELL_TOKEN_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("shell-{nonce}-{counter}")
}

fn limit_output(value: &str) -> String {
    value.chars().take(SHELL_OUTPUT_LIMIT).collect()
}

fn epoch_text() -> String {
    unix_text(UNIX_EPOCH)
}

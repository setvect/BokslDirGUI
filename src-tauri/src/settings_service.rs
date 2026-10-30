use crate::contracts::{AppError, CommandResult, Settings};
use crate::filesystem::map_io_error;
use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use std::sync::Mutex;

static SETTINGS_SAVE_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn load_settings() -> CommandResult<Settings> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(Settings::default());
    }
    let text = fs::read_to_string(&path).map_err(|error| map_io_error(error, Some(&path)))?;
    let settings = serde_json::from_str::<Settings>(&text).map_err(|error| {
        AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(&path),
            true,
        )
        .with_detail("message", error.to_string())
    })?;
    validate_settings(&settings, &path)?;
    Ok(settings)
}

pub(crate) fn save_settings(patch: serde_json::Value) -> CommandResult<Settings> {
    let _guard = SETTINGS_SAVE_LOCK
        .lock()
        .map_err(|_| AppError::new("io_error", "errors.settingsSaveFailed", None, true))?;
    let path = settings_path()?;
    let current = load_settings()?;
    let mut value = serde_json::to_value(current).map_err(|error| {
        AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(&path),
            true,
        )
        .with_detail("message", error.to_string())
    })?;
    merge_json(&mut value, patch);
    let next: Settings = serde_json::from_value(value).map_err(|error| {
        AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(&path),
            true,
        )
        .with_detail("message", error.to_string())
    })?;
    validate_settings(&next, &path)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| map_io_error(error, Some(parent)))?;
    }
    let tmp = path.with_extension("json.tmp");
    let body = serde_json::to_string_pretty(&next).map_err(|error| {
        AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(&path),
            true,
        )
        .with_detail("message", error.to_string())
    })?;
    fs::write(&tmp, body).map_err(|error| map_io_error(error, Some(&tmp)))?;
    fs::rename(&tmp, &path).map_err(|error| map_io_error(error, Some(&path)))?;
    Ok(next)
}

pub(crate) fn settings_path() -> CommandResult<PathBuf> {
    if let Some(path) = env::var_os("BOKSLDIRGUI_SETTINGS_PATH") {
        return Ok(PathBuf::from(path));
    }
    let path = crate::platform::config_dir()?.join("BokslDirGUI").join("settings.json");
    Ok(path)
}

fn validate_settings(settings: &Settings, path: &Path) -> CommandResult<()> {
    if let Some(tabs) = &settings.session.tabs {
        for panel in [&tabs.left, &tabs.right] {
            if panel.items.is_empty() || panel.items.len() > 5 || panel.active_index >= panel.items.len()
                || panel.items.iter().any(|tab| tab.path.is_empty() || tab.path.contains('\0')
                    || tab.history_back.len() > 100 || tab.history_forward.len() > 100) {
                return Err(AppError::new("invalid_settings", "errors.settingsInvalid", Some(path), true)
                    .with_detail("field", "session.tabs"));
            }
        }
    }
    if let Some(window) = &settings.window {
        if window.width < 800 || window.height < 400 || window.width > 16384 || window.height > 16384 {
            return Err(AppError::new("invalid_settings", "errors.settingsInvalid", Some(path), true)
                .with_detail("field", "window"));
        }
    }
    if !["dark", "light", "highContrast", "mdir"].contains(&settings.theme.as_str()) {
        return Err(AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(path),
            true,
        )
        .with_detail("field", "theme"));
    }
    if !["ko", "en"].contains(&settings.language.as_str()) {
        return Err(AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(path),
            true,
        )
        .with_detail("field", "language"));
    }
    if !["binary", "decimal"].contains(&settings.size_format.as_str()) {
        return Err(AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(path),
            true,
        )
        .with_detail("field", "sizeFormat"));
    }
    if !["50:50", "70:30", "30:70"].contains(&settings.layout.ratio.as_str()) {
        return Err(AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(path),
            true,
        )
        .with_detail("field", "layout.ratio"));
    }
    if !(-3..=5).contains(&settings.view.zoom_step) {
        return Err(AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(path),
            true,
        )
        .with_detail("field", "view.zoomStep"));
    }
    validate_remote_settings(&settings.remote, path)?;
    if !["compact", "comfortable"].contains(&settings.view.density.as_str()) {
        return Err(AppError::new(
            "invalid_settings",
            "errors.settingsInvalid",
            Some(path),
            true,
        )
        .with_detail("field", "view.density"));
    }
    Ok(())
}

// 사이트는 연결 대상이므로 빈 값·제어 문자·중복 ID·범위 밖 시간 설정 거부.
fn validate_remote_settings(remote: &crate::contracts::RemoteSettings, path: &Path) -> CommandResult<()> {
    let invalid = |field: &str| AppError::new("invalid_settings", "errors.settingsInvalid", Some(path), true)
        .with_detail("field", field);
    let text_ok = |text: &str| !text.trim().is_empty() && !text.chars().any(char::is_control);
    let mut ids = std::collections::HashSet::new();
    for site in &remote.sites {
        if !text_ok(&site.id) || !ids.insert(site.id.as_str()) || !text_ok(&site.name) || site.name.chars().count() > 120
            || !text_ok(&site.host) || site.host.contains(char::is_whitespace) || !text_ok(&site.user) || site.port == 0
            || site.key_path.as_deref().is_some_and(|key| !text_ok(key))
            || site.start_path.as_deref().is_some_and(|start| !text_ok(start)) {
            return Err(invalid("remote.sites"));
        }
    }
    if !(5..=600).contains(&remote.keepalive_seconds) {
        return Err(invalid("remote.keepaliveSeconds"));
    }
    if !(3..=120).contains(&remote.connect_timeout_seconds) {
        return Err(invalid("remote.connectTimeoutSeconds"));
    }
    Ok(())
}

fn merge_json(target: &mut serde_json::Value, patch: serde_json::Value) {
    match (target, patch) {
        (serde_json::Value::Object(target), serde_json::Value::Object(patch)) => {
            for (key, value) in patch {
                merge_json(target.entry(key).or_insert(serde_json::Value::Null), value);
            }
        }
        (target, patch) => *target = patch,
    }
}

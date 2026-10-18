use crate::contracts::{ActionResult, AppError, CommandResult, OpenWithApp};
use crate::navigation;
use std::path::{Path, PathBuf};

fn file_path(path: &str) -> CommandResult<PathBuf> {
    let path = navigation::canonical_existing_path(path)?;
    if !path.is_file() {
        return Err(AppError::new(
            "invalid_path",
            "errors.openWithFileRequired",
            Some(&path),
            true,
        ));
    }
    Ok(path)
}

pub(crate) fn list_apps(path: &str) -> CommandResult<Vec<OpenWithApp>> {
    let path = file_path(path)?;
    platform_apps(&path)
}

pub(crate) fn open(path: &str, application_id: &str) -> CommandResult<ActionResult> {
    let path = file_path(path)?;
    #[cfg(windows)]
    { return crate::windows_open_with::open(path, application_id.to_owned()); }
    #[cfg(not(windows))]
    {
        // 재조회한 OS 등록 항목만 실행. 프론트엔드가 전달한 임의 경로 실행 금지.
        let apps = platform_apps(&path)?;
        let application = apps.iter().find(|app| app.id == application_id)
            .and_then(|app| app.path.as_ref()).map(PathBuf::from)
            .filter(|app| app.is_dir())
            .ok_or_else(|| AppError::new("invalid_application", "errors.openWithAppUnavailable", Some(&path), true))?;
        #[cfg(target_os = "macos")]
        {
            let status = open_command(&path, &application).status()
                .map_err(|error| crate::filesystem::map_io_error(error, Some(&path)))?;
            if !status.success() {
                return Err(AppError::new("external_failed", "errors.externalCommandFailed", Some(&path), true));
            }
            Ok(ActionResult { ok: true, message_key: None })
        }
        #[cfg(not(target_os = "macos"))]
        { let _ = application; Err(AppError::new("unsupported", "errors.commandNotImplemented", Some(&path), true)) }
    }
}

#[cfg(target_os = "macos")]
fn open_command(path: &Path, application: &Path) -> std::process::Command {
    let mut command = std::process::Command::new("/usr/bin/open");
    command.arg("-a").arg(application).arg(path);
    command
}

#[cfg(target_os = "macos")]
fn platform_apps(path: &Path) -> CommandResult<Vec<OpenWithApp>> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    objc2::rc::autoreleasepool(|_| {
        let workspace = NSWorkspace::sharedWorkspace();
        let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        let default_path = workspace
            .URLForApplicationToOpenURL(&url)
            .and_then(|url| url.path())
            .and_then(|path| std::fs::canonicalize(path.to_string()).ok());
        let file_manager = NSFileManager::defaultManager();
        let mut apps = Vec::new();
        for url in workspace.URLsForApplicationsToOpenURL(&url) {
            let Some(raw_path) = url.path() else { continue };
            let Ok(app_path) = std::fs::canonicalize(raw_path.to_string()) else {
                continue;
            };
            if !app_path.is_dir() {
                continue;
            }
            apps.push(OpenWithApp {
                is_default: default_path.as_ref() == Some(&app_path),
                name: file_manager.displayNameAtPath(&raw_path).to_string(),
                id: app_path.to_string_lossy().into_owned(),
                path: Some(app_path.to_string_lossy().into_owned()),
            });
        }
        apps.sort_by(|a, b| {
            b.is_default
                .cmp(&a.is_default)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
                .then_with(|| a.path.cmp(&b.path))
        });
        apps.dedup_by(|a, b| a.path == b.path);
        Ok(apps)
    })
}

#[cfg(windows)]
fn platform_apps(path: &Path) -> CommandResult<Vec<OpenWithApp>> {
    crate::windows_open_with::list(path.to_owned())
}

#[cfg(not(any(target_os = "macos", windows)))]
fn platform_apps(path: &Path) -> CommandResult<Vec<OpenWithApp>> {
    Err(AppError::new(
        "unsupported",
        "errors.commandNotImplemented",
        Some(path),
        true,
    ))
}

#[cfg(test)]
mod tests {
    use super::list_apps;
    #[cfg(target_os = "macos")]
    use super::{open, open_command};
    #[cfg(target_os = "macos")]
    use std::path::Path;

    #[test]
    fn rejects_directories_and_missing_files() {
        assert!(list_apps("/this-file-does-not-exist-boksldir").is_err());
        assert_eq!(
            list_apps(std::env::temp_dir().to_str().unwrap())
                .unwrap_err()
                .message_key,
            "errors.openWithFileRequired"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn native_lookup_returns_real_bundles_and_rejects_an_unlisted_application() {
        let dir = std::env::temp_dir().join(format!("boksldir-open-with-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("한글 sample.json");
        std::fs::write(&path, "{}").unwrap();
        let apps = list_apps(path.to_str().unwrap()).unwrap();
        eprintln!("JSON applications: {:?}", apps);
        assert!(apps.iter().all(|app| Path::new(app.path.as_ref().unwrap()).is_dir()));
        assert!(apps.iter().filter(|app| app.is_default).count() <= 1);
        let mut unique = std::collections::HashSet::new();
        assert!(apps.iter().all(|app| unique.insert(&app.id)));
        let error = open(path.to_str().unwrap(), dir.to_str().unwrap()).unwrap_err();
        assert_eq!(error.message_key, "errors.openWithAppUnavailable");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn launch_arguments_keep_spaces_and_shell_characters_literal() {
        let command = open_command(
            Path::new("/tmp/data $(touch unwanted).json"),
            Path::new("/Applications/Visual Studio Code.app"),
        );
        assert_eq!(command.get_program(), "/usr/bin/open");
        assert_eq!(
            command.get_args().collect::<Vec<_>>(),
            vec![
                "-a",
                "/Applications/Visual Studio Code.app",
                "/tmp/data $(touch unwanted).json"
            ]
        );
    }
}

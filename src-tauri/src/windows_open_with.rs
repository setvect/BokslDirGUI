use crate::contracts::{ActionResult, AppError, CommandResult, OpenWithApp};
use crate::windows_shell;
use std::path::{Path, PathBuf};
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::Com::IDataObject;
use windows::Win32::UI::Shell::{
    AssocQueryStringW, BHID_DataObject, IAssocHandler, SHAssocEnumHandlers, ASSOCF_NONE, ASSOCSTR,
    ASSOCSTR_APPID, ASSOCSTR_EXECUTABLE, ASSOCSTR_FRIENDLYAPPNAME, ASSOCSTR_PROGID,
    ASSOC_FILTER_NONE,
};

struct RegisteredApp {
    display: OpenWithApp,
    handler: Option<IAssocHandler>,
    association: Option<String>,
}

fn association_value(extension: &HSTRING, kind: ASSOCSTR) -> Option<String> {
    let mut length = 0;
    let _ = unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            kind,
            extension,
            PCWSTR::null(),
            None,
            &mut length,
        )
    };
    if length == 0 || length > 32768 {
        return None;
    }
    let mut buffer = vec![0u16; length as usize];
    unsafe {
        AssocQueryStringW(
            ASSOCF_NONE,
            kind,
            extension,
            PCWSTR::null(),
            Some(PWSTR(buffer.as_mut_ptr())),
            &mut length,
        )
    }
    .ok()
    .ok()?;
    let end = buffer.iter().position(|c| *c == 0)?;
    String::from_utf16(&buffer[..end])
        .ok()
        .filter(|s| !s.is_empty())
}

fn registered_apps(path: &Path) -> windows::core::Result<Vec<RegisteredApp>> {
    let extension = HSTRING::from(
        path.extension()
            .map(|e| format!(".{}", e.to_string_lossy()))
            .unwrap_or_else(|| ".".to_owned()),
    );
    let default_id = association_value(&extension, ASSOCSTR_PROGID);
    let default_name = association_value(&extension, ASSOCSTR_FRIENDLYAPPNAME);
    let default_executable = association_value(&extension, ASSOCSTR_EXECUTABLE);
    let default_handler_id =
        association_value(&extension, ASSOCSTR_APPID).or_else(|| default_executable.clone());
    let mut apps = Vec::new();
    // Resolve the default independently: IsRecommended is not a default-app indicator.
    if let (Some(id), Some(name)) = (default_id, default_name) {
        apps.push(RegisteredApp {
            display: OpenWithApp {
                id: format!("default:{id}"),
                name,
                path: default_executable.clone(),
                is_default: true,
            },
            handler: None,
            association: Some(id),
        });
    }
    let enumerator = match unsafe { SHAssocEnumHandlers(&extension, ASSOC_FILTER_NONE) } {
        Ok(value) => value,
        // Unassociated extensions have no handler, rather than an arbitrary executable fallback.
        Err(e) if [0x80070483u32, 0x80070002].contains(&(e.code().0 as u32)) => return Ok(apps),
        Err(e) => return Err(e),
    };
    loop {
        let mut fetched = 0;
        let mut next = [None];
        unsafe { enumerator.Next(&mut next, Some(&mut fetched))? };
        if fetched == 0 {
            break;
        }
        let Some(handler) = next[0].take() else {
            break;
        };
        let id = unsafe { windows_shell::take_string(handler.GetName()?)? };
        let name = unsafe { windows_shell::take_string(handler.GetUIName()?)? };
        if id.is_empty() || name.is_empty() {
            continue;
        }
        let display_path = Path::new(&id).is_absolute().then(|| id.clone());
        // Replace the synthetic default with its actual registered handler when identity matches.
        let default_index = apps
            .iter()
            .position(|app: &RegisteredApp| app.association.is_some());
        let is_default = default_index.is_some()
            && default_handler_id
                .as_ref()
                .is_some_and(|key| key.eq_ignore_ascii_case(&id));
        if is_default {
            apps.remove(default_index.unwrap());
        }
        if apps
            .iter()
            .any(|app| app.display.id == format!("handler:{id}"))
        {
            continue;
        }
        apps.push(RegisteredApp {
            display: OpenWithApp {
                id: format!("handler:{id}"),
                name,
                path: display_path,
                is_default,
            },
            handler: Some(handler),
            association: None,
        });
    }
    apps.sort_by(|a, b| {
        b.display
            .is_default
            .cmp(&a.display.is_default)
            .then_with(|| {
                a.display
                    .name
                    .to_lowercase()
                    .cmp(&b.display.name.to_lowercase())
            })
            .then_with(|| a.display.id.cmp(&b.display.id))
    });
    Ok(apps)
}

pub(crate) fn list(path: PathBuf) -> CommandResult<Vec<OpenWithApp>> {
    windows_shell::run_sta(move || {
        registered_apps(&path)
            .map(|apps| apps.into_iter().map(|app| app.display).collect())
            .map_err(|e| windows_shell::error(e, Some(&path)))
    })
}

pub(crate) fn open(path: PathBuf, application_id: String) -> CommandResult<ActionResult> {
    windows_shell::run_sta(move || {
        // Re-enumeration rejects stale/unregistered IDs and any client-supplied executable path.
        let apps = registered_apps(&path).map_err(|e| windows_shell::error(e, Some(&path)))?;
        let app = apps
            .into_iter()
            .find(|app| app.display.id == application_id)
            .ok_or_else(|| {
                AppError::new(
                    "invalid_application",
                    "errors.openWithAppUnavailable",
                    Some(&path),
                    true,
                )
            })?;
        let result = if let Some(handler) = app.handler {
            (|| {
                let item = windows_shell::item(&path)?;
                let data: IDataObject = unsafe { item.BindToHandler(None, &BHID_DataObject)? };
                unsafe { handler.Invoke(&data) }
            })()
        } else {
            windows_shell::open_association(&path, false, app.association.as_deref())
        };
        result.map_err(|e| windows_shell::error(e, Some(&path)))?;
        Ok(ActionResult {
            ok: true,
            message_key: None,
        })
    })
}

#[cfg(test)]
mod tests {
    use super::{list, open};

    #[test]
    fn registered_app_ids_are_unique_and_unregistered_execution_is_rejected() {
        let dir =
            std::env::temp_dir().join(format!("boksldir-windows-open-with-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("한글 [file] & name.txt");
        std::fs::write(&path, "data").unwrap();
        let apps = list(path.clone()).unwrap();
        let mut ids = std::collections::HashSet::new();
        assert!(apps
            .iter()
            .all(|app| !app.name.is_empty() && ids.insert(&app.id)));
        assert!(apps.iter().filter(|app| app.is_default).count() <= 1);
        let error = open(path, "C:\\unregistered-app.exe".to_owned()).unwrap_err();
        assert_eq!(error.code, "invalid_application");
        std::fs::remove_dir_all(dir).unwrap();
    }
}

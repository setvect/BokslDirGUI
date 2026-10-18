//! OS 경계만 소유. 패널 상태와 파일 작업 상태는 기존 소유자에서 유지.
use crate::contracts::{AppError, CommandResult};
use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlatformInfo {
    os: &'static str,
    features: PlatformFeatures,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PlatformFeatures {
    open_with: bool,
    current_folder_manager: bool,
    current_folder_terminal: bool,
    native_file_clipboard: bool,
    trash_undo: bool,
}
pub(crate) fn info() -> PlatformInfo {
    info_for_os(std::env::consts::OS)
}
fn info_for_os(os: &'static str) -> PlatformInfo {
    let mac = os == "macos";
    PlatformInfo {
        os,
        features: PlatformFeatures {
            open_with: mac,
            current_folder_manager: mac,
            current_folder_terminal: mac,
            native_file_clipboard: mac,
            trash_undo: mac,
        },
    }
}
pub(crate) fn home_dir() -> CommandResult<PathBuf> {
    dirs::home_dir()
        .filter(|p| p.is_absolute())
        .ok_or_else(|| AppError::new("io_error", "errors.homeUnavailable", None, true))
}
pub(crate) fn config_dir() -> CommandResult<PathBuf> {
    dirs::config_dir()
        .filter(|p| p.is_absolute())
        .ok_or_else(|| AppError::new("io_error", "errors.homeUnavailable", None, true))
}
pub(crate) fn roots() -> CommandResult<Vec<String>> {
    #[cfg(windows)]
    {
        let mask = unsafe { windows_sys::Win32::Storage::FileSystem::GetLogicalDrives() };
        if mask == 0 {
            return Err(crate::filesystem::map_io_error(
                std::io::Error::last_os_error(),
                None,
            ));
        }
        Ok(drive_roots(mask))
    }
    #[cfg(not(windows))]
    {
        let mut roots = vec![String::from("/")];
        #[cfg(target_os = "macos")]
        if let Ok(items) = std::fs::read_dir("/Volumes") {
            for item in items.flatten() {
                if let Ok(path) = item.path().canonicalize() {
                    roots.push(crate::path_text::display_path(&path));
                }
            }
        }
        roots.sort();
        roots.dedup();
        Ok(roots)
    }
}
#[cfg(any(windows, test))]
fn drive_roots(mask: u32) -> Vec<String> {
    (0..26)
        .filter(|i| mask & (1 << i) != 0)
        .map(|i| format!("{}:\\", (b'A' + i) as char))
        .collect()
}

// 생성 대상에만 적용. 기존 항목의 정확한 이름은 정규화하거나 trim하지 않음.
pub(crate) fn valid_windows_child_name(name: &str) -> bool {
    if name.is_empty()
        || name.ends_with(['.', ' '])
        || name.chars().any(|c| c < ' ' || "<>:\"/\\|?*".contains(c))
    {
        return false;
    }
    let base = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end()
        .to_uppercase();
    if ["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$"].contains(&base.as_str()) {
        return false;
    }
    for prefix in ["COM", "LPT"] {
        if let Some(suffix) = base.strip_prefix(prefix) {
            if ["1", "2", "3", "4", "5", "6", "7", "8", "9", "¹", "²", "³"].contains(&suffix) {
                return false;
            }
        }
    }
    true
}
pub(crate) fn cross_device_error(code: Option<i32>, windows: bool) -> bool {
    code == Some(if windows { 17 } else { 18 })
}
pub(crate) fn protected_delete_path(path: &Path) -> bool {
    let mut protected = Vec::new();
    if let Ok(home) = home_dir() {
        protected.push(home);
    }
    #[cfg(windows)]
    {
        for key in [
            "SystemRoot",
            "WINDIR",
            "ProgramFiles",
            "ProgramFiles(x86)",
            "ProgramData",
            "PUBLIC",
        ] {
            if let Some(value) = std::env::var_os(key).filter(|v| !v.is_empty()) {
                let value = PathBuf::from(value);
                if value.is_absolute() {
                    protected.push(value);
                }
            }
        }
        if let Ok(home) = home_dir() {
            if let Some(users) = home.parent() {
                protected.push(users.to_path_buf());
            }
        }
    }
    #[cfg(not(windows))]
    protected.extend(
        [
            "/Applications",
            "/bin",
            "/etc",
            "/Library",
            "/Network",
            "/private",
            "/sbin",
            "/System",
            "/usr",
            "/Users",
            "/var",
            "/Volumes",
        ]
        .map(PathBuf::from),
    );
    protected
        .iter()
        .any(|p| path == p || same_file::is_same_file(path, p).unwrap_or(false))
}

// 알 수 없는 재파싱 지점과 junction은 따라가지 않고 거부하여 대상 재귀 변경 방지.
pub(crate) fn validate_reparse_point(
    path: &Path,
    metadata: &std::fs::Metadata,
) -> CommandResult<()> {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        use windows_sys::Win32::Storage::FileSystem::*;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT == 0 {
            return Ok(());
        }
        let tag = with_entry_handle(path, |handle| {
            let mut tag: FILE_ATTRIBUTE_TAG_INFO = unsafe { std::mem::zeroed() };
            let ok = unsafe {
                GetFileInformationByHandleEx(
                    handle,
                    FileAttributeTagInfo,
                    &mut tag as *mut _ as *mut _,
                    std::mem::size_of_val(&tag) as u32,
                )
            };
            if ok == 0 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(tag.ReparseTag)
        })
        .map_err(|e| crate::filesystem::map_io_error(e, Some(path)))?;
        if tag != 0xA000000C {
            return Err(AppError::new(
                "unsupported",
                "errors.reparsePointUnsupported",
                Some(path),
                true,
            ));
        }
    }
    #[cfg(not(windows))]
    let _ = (path, metadata);
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::{
        config_dir, cross_device_error, drive_roots, home_dir, info, info_for_os,
        valid_windows_child_name,
    };
    #[test]
    fn windows_names_and_drive_masks_are_checked_on_every_host() {
        for name in [
            "CON", "nul.txt", "LPT1.log", "COM¹", "a:b", "a?b", "end.", "end ", "a\n", "..", "",
        ] {
            assert!(!valid_windows_child_name(name), "{name:?}");
        }
        for name in ["한글 😀.txt", "COM10", "my.con", ".hidden", " leading.txt"] {
            assert!(valid_windows_child_name(name), "{name:?}");
        }
        assert_eq!(drive_roots(0b1100), vec!["C:\\", "D:\\"]);
        assert!(cross_device_error(Some(17), true));
        assert!(!cross_device_error(Some(18), true));
        assert!(cross_device_error(Some(18), false));
    }
    #[test]
    fn capabilities_match_implemented_os_services() {
        let value = serde_json::to_value(info()).unwrap();
        assert_eq!(value["os"], std::env::consts::OS);
        assert_eq!(
            value["features"]["nativeFileClipboard"],
            cfg!(target_os = "macos")
        );
        let fixtures: serde_json::Value =
            serde_json::from_str(include_str!("../../src/tauri/fixtures/platform.json")).unwrap();
        assert_eq!(
            serde_json::to_value(info_for_os("macos")).unwrap(),
            fixtures[0]
        );
        assert_eq!(
            serde_json::to_value(info_for_os("windows")).unwrap(),
            fixtures[1]
        );
        assert!(home_dir().unwrap().is_absolute());
        assert!(config_dir().unwrap().is_absolute());
    }
}

// 내부 도구 실행은 쉘 없이 실행 가능한 파일만 탐색. .cmd/.bat 자동 실행 제외.
pub(crate) fn find_executable(name: &str) -> Option<String> {
    for dir in std::env::split_paths(&std::env::var_os("PATH")?) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(crate::path_text::display_path(&candidate));
        }
        #[cfg(windows)]
        if candidate.extension().is_none() {
            let candidate = candidate.with_extension("exe");
            if candidate.is_file() {
                return Some(crate::path_text::display_path(&candidate));
            }
        }
    }
    None
}

pub(crate) fn validate_path_input(path: &Path) -> CommandResult<()> {
    #[cfg(windows)]
    {
        use std::path::{Component, Prefix};
        let allowed_prefix = matches!(path.components().next(), Some(Component::Prefix(p))
            if matches!(p.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_) | Prefix::UNC(_, _) | Prefix::VerbatimUNC(_, _)));
        let ads = path
            .components()
            .any(|c| matches!(c, Component::Normal(name) if name.to_string_lossy().contains(':')));
        if !path.is_absolute() || !allowed_prefix || ads {
            return Err(AppError::new(
                "invalid_path",
                "errors.invalidPath",
                Some(path),
                true,
            ));
        }
    }
    #[cfg(not(windows))]
    let _ = path;
    Ok(())
}

#[cfg(windows)]
fn with_entry_handle<T>(
    path: &Path,
    read: impl FnOnce(windows_sys::Win32::Foundation::HANDLE) -> std::io::Result<T>,
) -> std::io::Result<T> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::{Foundation::*, Storage::FileSystem::*};
    struct Handle(HANDLE);
    impl Drop for Handle {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let handle = unsafe {
        CreateFileW(
            wide.as_ptr(),
            FILE_READ_ATTRIBUTES,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_OPEN_REPARSE_POINT | FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error());
    }
    let handle = Handle(handle);
    read(handle.0)
}

#[cfg(windows)]
pub(crate) fn entry_identity(path: &Path) -> CommandResult<String> {
    use windows_sys::Win32::Storage::FileSystem::*;
    with_entry_handle(path, |handle| {
        let mut info: BY_HANDLE_FILE_INFORMATION = unsafe { std::mem::zeroed() };
        if unsafe { GetFileInformationByHandle(handle, &mut info) } == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(format!(
            "{}:{}:{}",
            info.dwVolumeSerialNumber, info.nFileIndexHigh, info.nFileIndexLow
        ))
    })
    .map_err(|e| crate::filesystem::map_io_error(e, Some(path)))
}

pub(crate) fn copy_file_attributes(
    file: &std::fs::File,
    source: &std::fs::Metadata,
) -> std::io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::{fs::MetadataExt, io::AsRawHandle};
        use windows_sys::Win32::Storage::FileSystem::*;
        // ACL/ADS/압축 속성까지 복제한다는 의미가 아님. 지원 속성만 명시적으로 보존.
        let attributes = source.file_attributes()
            & (FILE_ATTRIBUTE_READONLY
                | FILE_ATTRIBUTE_HIDDEN
                | FILE_ATTRIBUTE_SYSTEM
                | FILE_ATTRIBUTE_ARCHIVE);
        let info = FILE_BASIC_INFO {
            CreationTime: 0,
            LastAccessTime: 0,
            LastWriteTime: 0,
            ChangeTime: 0,
            FileAttributes: if attributes == 0 {
                FILE_ATTRIBUTE_NORMAL
            } else {
                attributes
            },
        };
        let ok = unsafe {
            SetFileInformationByHandle(
                file.as_raw_handle(),
                FileBasicInfo,
                &info as *const _ as *const _,
                std::mem::size_of_val(&info) as u32,
            )
        };
        if ok == 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    file.set_permissions(source.permissions())
}

use crate::contracts::{AppError, CommandResult, FileEntry};
use crate::filesystem::{file_entry_from_path, map_io_error};
use crate::navigation;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;

pub(crate) fn create_dir(parent: &str, name: &str) -> CommandResult<FileEntry> {
    let parent = navigation::canonical_existing_path(parent)?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&parent),
            true,
        ));
    }

    let safe_name = validate_child_name(name, Some(&parent))?;
    let target = parent.join(safe_name);
    if path_is_occupied(&target) {
        return Err(AppError::new(
            "already_exists",
            "errors.alreadyExists",
            Some(&target),
            true,
        ));
    }

    fs::create_dir(&target).map_err(|error| map_io_error(error, Some(&target)))?;
    file_entry_from_path(&target, false)
}

pub(crate) fn rename_entry(path: &str, new_name: &str) -> CommandResult<FileEntry> {
    let raw_source = PathBuf::from(path);
    let raw_parent = raw_source.parent().ok_or_else(|| {
        AppError::new(
            "invalid_path",
            "errors.invalidPath",
            Some(&raw_source),
            true,
        )
    })?;
    let source_name = raw_source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| {
            AppError::new(
                "invalid_name",
                "errors.invalidName",
                Some(&raw_source),
                true,
            )
        })?;
    // The existing entry name is an exact filesystem identity, including whitespace.
    validate_child_name(source_name, Some(&raw_source))?;
    let parent = navigation::canonical_existing_path(&raw_parent.to_string_lossy())?;
    if !parent.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&parent),
            true,
        ));
    }
    let source = parent.join(source_name);
    fs::symlink_metadata(&source).map_err(|error| map_io_error(error, Some(&source)))?;
    let safe_name = validate_child_name(new_name, Some(&parent))?;
    let target = parent.join(safe_name);

    if target == source {
        return file_entry_from_path(&source, false);
    }

    if path_is_occupied(&target) {
        return Err(AppError::new(
            "already_exists",
            "errors.alreadyExists",
            Some(&target),
            true,
        ));
    }

    rename_no_replace(&source, &target).map_err(|error| map_io_error(error, Some(&target)))?;
    file_entry_from_path(&target, false)
}

pub(crate) fn validate_child_name<'a>(name: &'a str, path: Option<&Path>) -> CommandResult<&'a str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return Err(AppError::new(
            "invalid_name",
            "errors.invalidName",
            path,
            true,
        ));
    }
    if trimmed.contains('\0') || trimmed.contains('/') || trimmed.contains('\\') {
        return Err(
            AppError::new("invalid_name", "errors.invalidName", path, true)
                .with_detail("name", trimmed),
        );
    }
    if Path::new(trimmed).components().count() != 1 {
        return Err(
            AppError::new("invalid_name", "errors.invalidName", path, true)
                .with_detail("name", trimmed),
        );
    }
    Ok(trimmed)
}

pub(crate) fn path_is_occupied(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok()
}

#[cfg(target_os = "macos")]
pub(crate) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_int};
    use std::os::unix::ffi::OsStrExt;

    extern "C" {
        fn renamex_np(from: *const c_char, to: *const c_char, flags: c_int) -> c_int;
    }

    const RENAME_EXCL: c_int = 0x00000004;
    let source = CString::new(source.as_os_str().as_bytes())?;
    let target = CString::new(target.as_os_str().as_bytes())?;
    let result = unsafe { renamex_np(source.as_ptr(), target.as_ptr(), RENAME_EXCL) };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::raw::{c_char, c_long};
    use std::os::unix::ffi::OsStrExt;

    extern "C" {
        fn syscall(num: c_long, ...) -> c_long;
    }

    #[cfg(target_arch = "x86_64")]
    const SYS_RENAMEAT2: c_long = 316;
    #[cfg(target_arch = "aarch64")]
    const SYS_RENAMEAT2: c_long = 276;
    #[cfg(target_arch = "x86")]
    const SYS_RENAMEAT2: c_long = 353;
    #[cfg(target_arch = "arm")]
    const SYS_RENAMEAT2: c_long = 382;
    const AT_FDCWD: c_long = -100;
    const RENAME_NOREPLACE: c_long = 1;

    let source = CString::new(source.as_os_str().as_bytes())?;
    let target = CString::new(target.as_os_str().as_bytes())?;
    let result = unsafe {
        syscall(
            SYS_RENAMEAT2,
            AT_FDCWD,
            source.as_ptr() as *const c_char,
            AT_FDCWD,
            target.as_ptr() as *const c_char,
            RENAME_NOREPLACE,
        )
    };
    if result == 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(windows)]
pub(crate) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;

    extern "system" {
        fn MoveFileExW(existing: *const u16, new_name: *const u16, flags: u32) -> i32;
    }

    const MOVEFILE_WRITE_THROUGH: u32 = 0x00000008;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let result = unsafe { MoveFileExW(source.as_ptr(), target.as_ptr(), MOVEFILE_WRITE_THROUGH) };
    if result != 0 {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(
    target_os = "macos",
    target_os = "linux",
    target_os = "android",
    windows
)))]
pub(crate) fn rename_no_replace(source: &Path, target: &Path) -> io::Result<()> {
    if path_is_occupied(target) {
        return Err(io::Error::new(
            io::ErrorKind::AlreadyExists,
            "target already exists",
        ));
    }
    fs::rename(source, target)
}

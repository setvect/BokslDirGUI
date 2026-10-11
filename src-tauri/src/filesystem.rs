use crate::contracts::{
    AppError, CommandResult, EntryKind, FileEntry, SortDirection, SortField, SortSpec,
};
use crate::path_text::display_path;
use std::cmp::Ordering;
use std::fs;
use std::io;
use std::path::Path;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

pub(crate) fn parent_virtual_entry(parent: &Path) -> FileEntry {
    FileEntry {
        path: display_path(parent),
        name: "..".to_string(),
        kind: EntryKind::Directory,
        symlink_target_is_directory: None,
        size_bytes: None,
        modified_at: None,
        created_at: None,
        permissions: None,
        owner: None,
        group: None,
        is_hidden: false,
        is_virtual: true,
    }
}

pub(crate) fn file_entry_from_path(path: &Path, is_virtual: bool) -> CommandResult<FileEntry> {
    let metadata = fs::symlink_metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(path));
    let kind = classify_entry(path, &metadata);
    let symlink_target_is_directory = if metadata.file_type().is_symlink() {
        fs::metadata(path).ok().map(|target| target.is_dir())
    } else {
        None
    };
    let size_bytes = if metadata.is_file() {
        Some(metadata.len())
    } else {
        None
    };

    Ok(FileEntry {
        path: display_path(path),
        name: name.clone(),
        kind,
        symlink_target_is_directory,
        size_bytes,
        modified_at: metadata.modified().ok().and_then(system_time_to_rfc3339),
        created_at: metadata.created().ok().and_then(system_time_to_rfc3339),
        permissions: Some(format_permissions(&metadata)),
        owner: owner_text(&metadata),
        group: group_text(&metadata),
        is_hidden: is_hidden_name(&name),
        is_virtual,
    })
}

pub(crate) fn classify_entry(path: &Path, metadata: &fs::Metadata) -> EntryKind {
    let file_type = metadata.file_type();
    if file_type.is_symlink() {
        return EntryKind::Symlink;
    }
    if metadata.is_dir() {
        return EntryKind::Directory;
    }
    if metadata.is_file() {
        if is_archive_path(path) {
            return EntryKind::Archive;
        }
        if is_executable(metadata) {
            return EntryKind::Executable;
        }
        return EntryKind::File;
    }
    EntryKind::Unknown
}

pub(crate) fn is_archive_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let lowered = name.to_lowercase();
    [
        ".zip", ".jar", ".war", ".tar", ".tar.gz", ".tgz", ".tar.zst", ".tzst", ".7z",
    ]
    .iter()
    .any(|suffix| lowered.ends_with(suffix))
}

#[cfg(unix)]
pub(crate) fn owner_text(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.uid().to_string())
}

#[cfg(not(unix))]
pub(crate) fn owner_text(_metadata: &fs::Metadata) -> Option<String> {
    None
}

#[cfg(unix)]
pub(crate) fn group_text(metadata: &fs::Metadata) -> Option<String> {
    use std::os::unix::fs::MetadataExt;
    Some(metadata.gid().to_string())
}

#[cfg(not(unix))]
pub(crate) fn group_text(_metadata: &fs::Metadata) -> Option<String> {
    None
}

#[cfg(unix)]
pub(crate) fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
pub(crate) fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
pub(crate) fn format_permissions(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = metadata.permissions().mode();
    let mut out = String::new();
    out.push(if metadata.is_dir() { 'd' } else { '-' });
    for bit in [
        0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001,
    ] {
        out.push(match bit {
            0o400 | 0o040 | 0o004 => {
                if mode & bit != 0 {
                    'r'
                } else {
                    '-'
                }
            }
            0o200 | 0o020 | 0o002 => {
                if mode & bit != 0 {
                    'w'
                } else {
                    '-'
                }
            }
            _ => {
                if mode & bit != 0 {
                    'x'
                } else {
                    '-'
                }
            }
        });
    }
    out
}

#[cfg(not(unix))]
pub(crate) fn format_permissions(metadata: &fs::Metadata) -> String {
    if metadata.permissions().readonly() {
        "readonly".to_string()
    } else {
        "readwrite".to_string()
    }
}

pub(crate) fn sort_entries(entries: &mut [FileEntry], sort: &SortSpec) {
    entries.sort_by(|left, right| {
        if left.is_virtual != right.is_virtual {
            return right.is_virtual.cmp(&left.is_virtual);
        }
        if sort.directories_first {
            let left_dir = left.kind == EntryKind::Directory;
            let right_dir = right.kind == EntryKind::Directory;
            if left_dir != right_dir {
                return right_dir.cmp(&left_dir);
            }
        }

        let ordering = match sort.field {
            SortField::Name => left.name.to_lowercase().cmp(&right.name.to_lowercase()),
            SortField::Size => left
                .size_bytes
                .unwrap_or(0)
                .cmp(&right.size_bytes.unwrap_or(0)),
            SortField::ModifiedAt => left.modified_at.cmp(&right.modified_at),
            SortField::Extension => extension_of(&left.name).cmp(&extension_of(&right.name)),
        };

        match sort.direction {
            SortDirection::Asc => ordering.then_with(|| left.name.cmp(&right.name)),
            SortDirection::Desc => {
                reverse_ordering(ordering).then_with(|| right.name.cmp(&left.name))
            }
        }
    });
}

pub(crate) fn reverse_ordering(ordering: Ordering) -> Ordering {
    match ordering {
        Ordering::Less => Ordering::Greater,
        Ordering::Equal => Ordering::Equal,
        Ordering::Greater => Ordering::Less,
    }
}

pub(crate) fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

pub(crate) fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') && name != ".."
}

pub(crate) fn system_time_to_rfc3339(time: SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    Some(datetime.to_rfc3339())
}

pub(crate) fn unix_text(time: SystemTime) -> String {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    datetime.to_rfc3339()
}

pub(crate) fn listing_version(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(1)
}

pub(crate) fn mime_from_extension(extension: &str) -> Option<&'static str> {
    match extension.to_lowercase().as_str() {
        "md" => Some("text/markdown"),
        "txt" => Some("text/plain"),
        "json" => Some("application/json"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "tif" | "tiff" => Some("image/tiff"),
        "dng" => Some("image/x-adobe-dng"),
        "heic" => Some("image/heic"),
        "heif" => Some("image/heif"),
        "avif" => Some("image/avif"),
        "webp" => Some("image/webp"),
        "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"),
        "zip" => Some("application/zip"),
        "7z" => Some("application/x-7z-compressed"),
        _ => None,
    }
}

pub(crate) fn map_io_error(error: io::Error, path: Option<&Path>) -> AppError {
    let (code, message_key, recoverable) = match error.kind() {
        io::ErrorKind::NotFound => ("not_found", "errors.notFound", true),
        io::ErrorKind::AlreadyExists => ("already_exists", "errors.alreadyExists", true),
        io::ErrorKind::PermissionDenied => ("permission_denied", "errors.permissionDenied", true),
        io::ErrorKind::InvalidInput => ("invalid_path", "errors.invalidPath", true),
        _ => ("io_error", "errors.io", false),
    };
    AppError::new(code, message_key, path, recoverable)
        .with_detail("ioKind", format!("{:?}", error.kind()))
}

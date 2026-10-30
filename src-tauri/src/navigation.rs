use crate::contracts::{
    AppError, CommandResult, DirectoryListing, DirectoryStats, EntryKind, FileMetadata,
    LocationList, PanelId, SortSpec,
};
use crate::filesystem::{
    file_entry_from_path, listing_version, map_io_error, mime_from_extension,
    parent_virtual_entry, sort_entries,
};
use crate::path_text::display_path;
use crate::settings_service;
use std::env;
use std::fs;
use std::path::Path;
use std::path::PathBuf;

pub(crate) fn list_dir(
    panel_id: PanelId,
    path: &str,
    show_hidden: bool,
    sort: SortSpec,
    filter: Option<String>,
) -> CommandResult<DirectoryListing> {
    let path = canonical_existing_directory(path)?;

    let mut entries = Vec::new();
    if let Some(parent) = path.parent() {
        entries.push(parent_virtual_entry(parent));
    }

    let normalized_filter = filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let read_dir = fs::read_dir(&path).map_err(|error| map_io_error(error, Some(&path)))?;
    for entry in read_dir {
        let entry = entry.map_err(|error| map_io_error(error, Some(&path)))?;
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let file_entry = file_entry_from_path(&entry_path, false)?;
        if !show_hidden && file_entry.is_hidden {
            continue;
        }
        if let Some(filter_text) = normalized_filter.as_deref() {
            if !name.to_lowercase().contains(filter_text) {
                continue;
            }
        }
        entries.push(file_entry);
    }

    sort_entries(&mut entries, &sort);

    Ok(DirectoryListing {
        panel_id,
        path: display_path(&path),
        entries,
        sort,
        filter,
        version: listing_version(&path),
        total_entries: None,
        truncated: None,
    })
}

pub(crate) fn get_metadata(path: &str) -> CommandResult<FileMetadata> {
    // Resolve the parent only: properties and native return matching describe
    // the selected entry, including dangling links, rather than its target.
    let path = if Path::new(path).file_name().is_some() {
        canonical_existing_entry(path)?
    } else {
        canonical_existing_path(path)?
    };
    let entry = file_entry_from_path(&path, false)?;
    let readonly = fs::symlink_metadata(&path)
        .map_err(|error| map_io_error(error, Some(&path)))?
        .permissions()
        .readonly();
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_string());
    let mime_type = extension
        .as_deref()
        .and_then(mime_from_extension)
        .map(str::to_string);
    let directory_stats = if entry.kind == EntryKind::Directory {
        Some(collect_directory_stats(&path)?)
    } else {
        None
    };
    let image_metadata = if matches!(entry.kind, EntryKind::File | EntryKind::Executable) {
        crate::image_metadata::read_image_metadata(&path)
    } else {
        None
    };
    Ok(FileMetadata {
        absolute_path: display_path(&path),
        extension,
        mime_type,
        readonly,
        directory_stats,
        image_metadata,
        entry,
    })
}

fn collect_directory_stats(root: &Path) -> CommandResult<DirectoryStats> {
    let mut stats = DirectoryStats {
        total_file_bytes: 0,
        file_count: 0,
        directory_count: 0,
    };
    let mut pending = vec![root.to_path_buf()];
    while let Some(directory) = pending.pop() {
        let children =
            fs::read_dir(&directory).map_err(|error| map_io_error(error, Some(&directory)))?;
        for child in children {
            let child = child.map_err(|error| map_io_error(error, Some(&directory)))?;
            let path = child.path();
            let metadata =
                fs::symlink_metadata(&path).map_err(|error| map_io_error(error, Some(&path)))?;
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                // 크기 계산은 링크·junction·클라우드 재파싱 지점을 따라가지 않음.
                if metadata.file_attributes() & 0x400 != 0 { continue; }
            }
            if metadata.is_dir() {
                stats.directory_count = stats.directory_count.saturating_add(1);
                pending.push(path);
            } else if metadata.is_file() {
                stats.file_count = stats.file_count.saturating_add(1);
                stats.total_file_bytes = stats.total_file_bytes.saturating_add(metadata.len());
            }
        }
    }
    Ok(stats)
}

pub(crate) fn list_locations() -> CommandResult<LocationList> {
    let home = crate::platform::home_dir()?;
    let home = canonical_existing_path(&home.to_string_lossy())?;
    let roots = crate::platform::roots()?;

    let recent = env::current_dir()
        .ok()
        .and_then(|path| path.canonicalize().ok())
        .map(|path| vec![display_path(&path)])
        .unwrap_or_default();

    let bookmarks = settings_service::load_settings()
        .map(|settings| settings.bookmarks)
        .unwrap_or_default();

    Ok(LocationList {
        home: display_path(&home),
        roots,
        recent,
        bookmarks,
    })
}

pub(crate) fn canonical_existing_path(path: &str) -> CommandResult<PathBuf> {
    let raw = PathBuf::from(path);
    crate::platform::validate_path_input(&raw)?;
    raw.canonicalize()
        .map_err(|error| map_io_error(error, Some(&raw)))
}

/// 주소 입력 해석: `~`·`~/…`(Windows는 `~\…`도)는 홈 기준, 상대 경로는 기준 디렉터리가 있으면 그 아래로 결합.
/// 기준 없는 상대 경로와 절대 경로는 입력 그대로 반환.
pub(crate) fn resolve_input_path(raw: &str, base: Option<&str>) -> CommandResult<PathBuf> {
    if raw == "~" {
        return crate::platform::home_dir();
    }
    let home_relative = raw
        .strip_prefix("~/")
        .or_else(|| if cfg!(windows) { raw.strip_prefix("~\\") } else { None });
    if let Some(rest) = home_relative {
        return Ok(crate::platform::home_dir()?.join(rest));
    }
    let path = PathBuf::from(raw);
    match base {
        Some(base) if !path.is_absolute() && !raw.is_empty() => Ok(PathBuf::from(base).join(path)),
        _ => Ok(path),
    }
}

/// 존재하는 디렉터리 경로 정규화, 파일이면 not_directory 오류.
pub(crate) fn canonical_existing_directory(path: &str) -> CommandResult<PathBuf> {
    let path = canonical_existing_path(path)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&path),
            true,
        ));
    }
    Ok(path)
}

pub(crate) fn canonical_existing_entry(path: &str) -> CommandResult<PathBuf> {
    let raw = PathBuf::from(path);
    crate::platform::validate_path_input(&raw)?;
    let parent = raw
        .parent()
        .ok_or_else(|| AppError::new("invalid_path", "errors.invalidPath", Some(&raw), true))?;
    let name = raw
        .file_name()
        .ok_or_else(|| AppError::new("invalid_path", "errors.invalidPath", Some(&raw), true))?;
    let parent = canonical_existing_path(&parent.to_string_lossy())?;
    let entry = parent.join(name);
    fs::symlink_metadata(&entry).map_err(|error| map_io_error(error, Some(&entry)))?;
    Ok(entry)
}

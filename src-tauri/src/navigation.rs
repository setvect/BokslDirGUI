use crate::contracts::{
    AppError, CommandResult, DirectoryListing, DirectoryStats, EntryKind, FileMetadata,
    LocationList, PanelId, SortSpec,
};
use crate::filesystem::{
    file_entry_from_path, is_hidden_name, listing_version, map_io_error, mime_from_extension,
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
    let path = canonical_existing_path(path)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&path),
            true,
        ));
    }

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
        if !show_hidden && is_hidden_name(&name) {
            continue;
        }
        if let Some(filter_text) = normalized_filter.as_deref() {
            if !name.to_lowercase().contains(filter_text) {
                continue;
            }
        }
        entries.push(file_entry_from_path(&entry_path, false)?);
    }

    sort_entries(&mut entries, &sort);

    Ok(DirectoryListing {
        panel_id,
        path: display_path(&path),
        entries,
        sort,
        filter,
        version: listing_version(&path),
    })
}

pub(crate) fn get_metadata(path: &str) -> CommandResult<FileMetadata> {
    let path = canonical_existing_path(path)?;
    let entry = file_entry_from_path(&path, false)?;
    let readonly = fs::metadata(&path)
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
    Ok(FileMetadata {
        absolute_path: display_path(&path),
        extension,
        mime_type,
        readonly,
        directory_stats,
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
    let home = env::var_os("HOME")
        .map(PathBuf::from)
        .or_else(|| env::current_dir().ok())
        .ok_or_else(|| AppError::new("io_error", "errors.homeUnavailable", None, true))?;
    let home = canonical_existing_path(&home.to_string_lossy())?;

    let mut roots = Vec::from([String::from("/")]);
    #[cfg(target_os = "macos")]
    {
        let volumes = Path::new("/Volumes");
        if let Ok(items) = fs::read_dir(volumes) {
            for item in items.flatten() {
                if let Ok(path) = item.path().canonicalize() {
                    roots.push(display_path(&path));
                }
            }
        }
    }
    roots.sort();
    roots.dedup();

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
    raw.canonicalize()
        .map_err(|error| map_io_error(error, Some(&raw)))
}

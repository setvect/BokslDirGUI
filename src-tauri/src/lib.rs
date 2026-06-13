use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum PanelId {
    Left,
    Right,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum EntryKind {
    File,
    Directory,
    Symlink,
    Executable,
    Archive,
    Unknown,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SortField {
    Name,
    Size,
    ModifiedAt,
    Extension,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
enum SortDirection {
    Asc,
    Desc,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SortSpec {
    field: SortField,
    direction: SortDirection,
    directories_first: bool,
}

impl Default for SortSpec {
    fn default() -> Self {
        Self {
            field: SortField::Name,
            direction: SortDirection::Asc,
            directories_first: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileEntry {
    path: String,
    name: String,
    kind: EntryKind,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    created_at: Option<String>,
    permissions: Option<String>,
    is_hidden: bool,
    is_virtual: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct DirectoryListing {
    panel_id: PanelId,
    path: String,
    entries: Vec<FileEntry>,
    sort: SortSpec,
    filter: Option<String>,
    version: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct FileMetadata {
    #[serde(flatten)]
    entry: FileEntry,
    absolute_path: String,
    extension: Option<String>,
    mime_type: Option<String>,
    readonly: bool,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct WatchAck {
    panel_id: PanelId,
    path: String,
    version: u64,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BookmarkLocation {
    id: String,
    label: String,
    path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct LocationList {
    home: String,
    roots: Vec<String>,
    recent: Vec<String>,
    bookmarks: Vec<BookmarkLocation>,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct AppError {
    code: String,
    message_key: String,
    path: Option<String>,
    details: Option<BTreeMap<String, String>>,
    recoverable: bool,
}

impl AppError {
    fn new(code: &str, message_key: &str, path: Option<&Path>, recoverable: bool) -> Self {
        Self {
            code: code.to_string(),
            message_key: message_key.to_string(),
            path: path.map(display_path),
            details: None,
            recoverable,
        }
    }

    fn with_detail(mut self, key: &str, value: impl Into<String>) -> Self {
        let details = self.details.get_or_insert_with(BTreeMap::new);
        details.insert(key.to_string(), value.into());
        self
    }
}

type CommandResult<T> = Result<T, AppError>;

#[tauri::command]
fn health_check() -> &'static str {
    "ok"
}

#[tauri::command]
fn list_dir(
    panel_id: PanelId,
    path: String,
    show_hidden: bool,
    sort: SortSpec,
    filter: Option<String>,
) -> CommandResult<DirectoryListing> {
    navigation::list_dir(panel_id, &path, show_hidden, sort, filter)
}

#[tauri::command]
fn goto_path(panel_id: PanelId, path: String) -> CommandResult<DirectoryListing> {
    navigation::list_dir(panel_id, &path, false, SortSpec::default(), None)
}

#[tauri::command]
fn get_metadata(path: String) -> CommandResult<FileMetadata> {
    navigation::get_metadata(&path)
}

#[tauri::command]
fn watch_path(panel_id: PanelId, path: String) -> CommandResult<WatchAck> {
    let path = navigation::canonical_existing_path(&path)?;
    if !path.is_dir() {
        return Err(AppError::new(
            "not_directory",
            "errors.notDirectory",
            Some(&path),
            true,
        ));
    }
    Ok(WatchAck {
        panel_id,
        path: display_path(&path),
        version: listing_version(&path),
    })
}

#[tauri::command]
fn list_locations() -> CommandResult<LocationList> {
    navigation::list_locations()
}

mod navigation {
    use super::*;

    pub(super) fn list_dir(
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

    pub(super) fn get_metadata(path: &str) -> CommandResult<FileMetadata> {
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
        let mime_type = extension.as_deref().and_then(mime_from_extension).map(str::to_string);
        Ok(FileMetadata {
            absolute_path: display_path(&path),
            extension,
            mime_type,
            readonly,
            entry,
        })
    }

    pub(super) fn list_locations() -> CommandResult<LocationList> {
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

        Ok(LocationList {
            home: display_path(&home),
            roots,
            recent,
            bookmarks: Vec::new(),
        })
    }

    pub(super) fn canonical_existing_path(path: &str) -> CommandResult<PathBuf> {
        let raw = PathBuf::from(path);
        raw.canonicalize()
            .map_err(|error| map_io_error(error, Some(&raw)))
    }
}

fn parent_virtual_entry(parent: &Path) -> FileEntry {
    FileEntry {
        path: display_path(parent),
        name: "..".to_string(),
        kind: EntryKind::Directory,
        size_bytes: None,
        modified_at: None,
        created_at: None,
        permissions: None,
        is_hidden: false,
        is_virtual: true,
    }
}

fn file_entry_from_path(path: &Path, is_virtual: bool) -> CommandResult<FileEntry> {
    let metadata = fs::symlink_metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(path));
    let kind = classify_entry(path, &metadata);
    let size_bytes = if metadata.is_file() { Some(metadata.len()) } else { None };

    Ok(FileEntry {
        path: display_path(path),
        name: name.clone(),
        kind,
        size_bytes,
        modified_at: metadata.modified().ok().and_then(system_time_to_rfc3339),
        created_at: metadata.created().ok().and_then(system_time_to_rfc3339),
        permissions: Some(format_permissions(&metadata)),
        is_hidden: is_hidden_name(&name),
        is_virtual,
    })
}

fn classify_entry(path: &Path, metadata: &fs::Metadata) -> EntryKind {
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

fn is_archive_path(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let lowered = name.to_lowercase();
    [".zip", ".tar", ".tar.gz", ".tgz", ".tar.xz", ".txz", ".tar.zst", ".7z", ".rar"]
        .iter()
        .any(|suffix| lowered.ends_with(suffix))
}

#[cfg(unix)]
fn is_executable(metadata: &fs::Metadata) -> bool {
    use std::os::unix::fs::PermissionsExt;
    metadata.permissions().mode() & 0o111 != 0
}

#[cfg(not(unix))]
fn is_executable(_metadata: &fs::Metadata) -> bool {
    false
}

#[cfg(unix)]
fn format_permissions(metadata: &fs::Metadata) -> String {
    use std::os::unix::fs::PermissionsExt;
    let mode = metadata.permissions().mode();
    let mut out = String::new();
    out.push(if metadata.is_dir() { 'd' } else { '-' });
    for bit in [0o400, 0o200, 0o100, 0o040, 0o020, 0o010, 0o004, 0o002, 0o001] {
        out.push(match bit {
            0o400 | 0o040 | 0o004 => {
                if mode & bit != 0 { 'r' } else { '-' }
            }
            0o200 | 0o020 | 0o002 => {
                if mode & bit != 0 { 'w' } else { '-' }
            }
            _ => {
                if mode & bit != 0 { 'x' } else { '-' }
            }
        });
    }
    out
}

#[cfg(not(unix))]
fn format_permissions(metadata: &fs::Metadata) -> String {
    if metadata.permissions().readonly() {
        "readonly".to_string()
    } else {
        "readwrite".to_string()
    }
}

fn sort_entries(entries: &mut [FileEntry], sort: &SortSpec) {
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
            SortField::Size => left.size_bytes.unwrap_or(0).cmp(&right.size_bytes.unwrap_or(0)),
            SortField::ModifiedAt => left.modified_at.cmp(&right.modified_at),
            SortField::Extension => extension_of(&left.name).cmp(&extension_of(&right.name)),
        };

        match sort.direction {
            SortDirection::Asc => ordering.then_with(|| left.name.cmp(&right.name)),
            SortDirection::Desc => reverse_ordering(ordering).then_with(|| right.name.cmp(&left.name)),
        }
    });
}

fn reverse_ordering(ordering: Ordering) -> Ordering {
    match ordering {
        Ordering::Less => Ordering::Greater,
        Ordering::Equal => Ordering::Equal,
        Ordering::Greater => Ordering::Less,
    }
}

fn extension_of(name: &str) -> String {
    Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_lowercase()
}

fn is_hidden_name(name: &str) -> bool {
    name.starts_with('.') && name != ".."
}

fn system_time_to_rfc3339(time: SystemTime) -> Option<String> {
    let datetime: chrono::DateTime<chrono::Utc> = time.into();
    Some(datetime.to_rfc3339())
}

fn listing_version(path: &Path) -> u64 {
    fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs())
        .unwrap_or(1)
}

fn mime_from_extension(extension: &str) -> Option<&'static str> {
    match extension.to_lowercase().as_str() {
        "md" => Some("text/markdown"),
        "txt" => Some("text/plain"),
        "json" => Some("application/json"),
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "zip" => Some("application/zip"),
        "7z" => Some("application/x-7z-compressed"),
        _ => None,
    }
}

fn map_io_error(error: io::Error, path: Option<&Path>) -> AppError {
    let (code, message_key, recoverable) = match error.kind() {
        io::ErrorKind::NotFound => ("not_found", "errors.notFound", true),
        io::ErrorKind::PermissionDenied => ("permission_denied", "errors.permissionDenied", true),
        io::ErrorKind::InvalidInput => ("invalid_path", "errors.invalidPath", true),
        _ => ("io_error", "errors.io", false),
    };
    AppError::new(code, message_key, path, recoverable).with_detail("ioKind", format!("{:?}", error.kind()))
}

fn display_path(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            health_check,
            list_dir,
            get_metadata,
            watch_path,
            goto_path,
            list_locations
        ])
        .run(tauri::generate_context!())
        .expect("failed to run BokslDirGUI Tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;
    use std::sync::atomic::{AtomicU64, Ordering as AtomicOrdering};

    static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct TempFixture {
        root: PathBuf,
    }

    impl TempFixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock must be after epoch")
                .as_nanos();
            let counter = FIXTURE_COUNTER.fetch_add(1, AtomicOrdering::Relaxed);
            let root = env::temp_dir().join(format!(
                "boksldir-gui-navigation-{}-{nonce}-{counter}",
                std::process::id()
            ));
            fs::create_dir_all(root.join("folder")).expect("fixture folder should be created");
            let mut file = File::create(root.join("alpha.txt")).expect("fixture file should be created");
            file.write_all(b"hello").expect("fixture file should be written");
            File::create(root.join("archive.7z")).expect("archive fixture should be created");
            File::create(root.join(".hidden")).expect("hidden fixture should be created");
            Self { root }
        }
    }

    impl Drop for TempFixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn health_check_reports_ok() {
        assert_eq!(health_check(), "ok");
    }

    #[test]
    fn list_dir_returns_normalized_read_only_listing() {
        let fixture = TempFixture::new();
        let listing = list_dir(
            PanelId::Left,
            fixture.root.to_string_lossy().into_owned(),
            false,
            SortSpec::default(),
            None,
        )
        .expect("listing should succeed");

        assert_eq!(listing.panel_id, PanelId::Left);
        assert!(Path::new(&listing.path).is_absolute());
        assert!(listing.entries.iter().any(|entry| entry.name == ".." && entry.is_virtual));
        assert!(listing.entries.iter().any(|entry| entry.name == "folder" && entry.kind == EntryKind::Directory));
        assert!(listing.entries.iter().any(|entry| entry.name == "alpha.txt" && entry.kind == EntryKind::File));
        assert!(listing.entries.iter().any(|entry| entry.name == "archive.7z" && entry.kind == EntryKind::Archive));
        assert!(!listing.entries.iter().any(|entry| entry.name == ".hidden"));
    }

    #[test]
    fn list_dir_can_include_hidden_and_filter_entries() {
        let fixture = TempFixture::new();
        let listing = list_dir(
            PanelId::Right,
            fixture.root.to_string_lossy().into_owned(),
            true,
            SortSpec::default(),
            Some("hid".to_string()),
        )
        .expect("listing should succeed");

        assert!(listing.entries.iter().any(|entry| entry.name == ".hidden"));
        assert!(!listing.entries.iter().any(|entry| entry.name == "alpha.txt"));
    }

    #[test]
    fn get_metadata_reports_file_details() {
        let fixture = TempFixture::new();
        let metadata = get_metadata(fixture.root.join("alpha.txt").to_string_lossy().into_owned())
            .expect("metadata should succeed");

        assert_eq!(metadata.entry.name, "alpha.txt");
        assert_eq!(metadata.entry.size_bytes, Some(5));
        assert_eq!(metadata.extension, Some("txt".to_string()));
        assert_eq!(metadata.mime_type, Some("text/plain".to_string()));
    }

    #[test]
    fn invalid_path_returns_typed_error() {
        let fixture = TempFixture::new();
        let error = get_metadata(fixture.root.join("missing.txt").to_string_lossy().into_owned())
            .expect_err("missing file should fail");

        assert_eq!(error.code, "not_found");
        assert_eq!(error.message_key, "errors.notFound");
        assert!(error.recoverable);
    }

    #[test]
    fn list_locations_returns_home_and_roots() {
        let locations = list_locations().expect("locations should be available");
        assert!(!locations.home.is_empty());
        assert!(locations.roots.iter().any(|root| root == "/"));
    }

    #[test]
    fn watch_path_validates_directory_and_returns_version() {
        let fixture = TempFixture::new();
        let ack = watch_path(PanelId::Left, fixture.root.to_string_lossy().into_owned())
            .expect("watch ack should succeed");

        assert_eq!(ack.panel_id, PanelId::Left);
        assert!(ack.version > 0);
    }
}

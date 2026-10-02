use crate::archive;
use crate::commands::{
    archive_list, create_dir, get_metadata, health_check, list_dir, list_locations, load_settings,
    open_current_in_finder, open_current_in_terminal, open_default,
    prepare_shell_command, preview_file, rename_entry, reveal_in_manager, run_shell_command,
    save_settings, watch_path,
};
use crate::contracts::{
    ConflictDecision, DeleteMode, DirectoryStats, EntryKind, OperationKind, OperationState,
    PanelId, SortSpec,
};
use crate::operation;
use crate::path_text::display_path;
use crate::shell_command;
use std::env;
use std::fs;
use std::io;
use std::path::Path;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering as AtomicOrdering;
use std::time::Duration;
use std::time::SystemTime;
use std::time::UNIX_EPOCH;

use std::fs::File;
use std::io::Write;

static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);
pub(super) static TEST_ENV_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

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
        let mut file =
            File::create(root.join("alpha.txt")).expect("fixture file should be created");
        file.write_all(b"hello")
            .expect("fixture file should be written");
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
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == ".." && entry.is_virtual));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "folder" && entry.kind == EntryKind::Directory));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "alpha.txt" && entry.kind == EntryKind::File));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "archive.7z" && entry.kind == EntryKind::Archive));
    assert!(!listing.entries.iter().any(|entry| entry.name == ".hidden"));
}

#[cfg(unix)]
#[test]
fn list_dir_identifies_symlink_targets_without_changing_link_kind() {
    use std::os::unix::fs::symlink;

    let fixture = TempFixture::new();
    let directory_link = fixture.root.join("directory-link");
    let file_link = fixture.root.join("file-link");
    let broken_link = fixture.root.join("broken-link");
    symlink(fixture.root.join("folder"), &directory_link).unwrap();
    symlink(fixture.root.join("alpha.txt"), &file_link).unwrap();
    symlink(fixture.root.join("missing"), &broken_link).unwrap();

    let listing = list_dir(
        PanelId::Left,
        fixture.root.to_string_lossy().into_owned(),
        false,
        SortSpec::default(),
        None,
    )
    .unwrap();
    for (name, target_is_directory) in [
        ("directory-link", Some(true)),
        ("file-link", Some(false)),
        ("broken-link", None),
    ] {
        let entry = listing
            .entries
            .iter()
            .find(|entry| entry.name == name)
            .unwrap();
        assert_eq!(entry.kind, EntryKind::Symlink);
        assert_eq!(entry.symlink_target_is_directory, target_is_directory);
        assert_eq!(
            serde_json::to_value(entry).unwrap()["symlinkTargetIsDirectory"],
            serde_json::json!(target_is_directory)
        );
    }

    let target_listing = list_dir(
        PanelId::Left,
        directory_link.to_string_lossy().into_owned(),
        false,
        SortSpec::default(),
        None,
    )
    .unwrap();
    assert_eq!(
        target_listing.path,
        display_path(&fixture.root.join("folder").canonicalize().unwrap())
    );
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
    assert!(!listing
        .entries
        .iter()
        .any(|entry| entry.name == "alpha.txt"));
}

#[test]
fn get_metadata_reports_file_details() {
    let fixture = TempFixture::new();
    let metadata = tauri::async_runtime::block_on(get_metadata(
        fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned(),
    ))
    .expect("metadata should succeed");

    assert_eq!(metadata.entry.name, "alpha.txt");
    assert_eq!(metadata.entry.size_bytes, Some(5));
    assert_eq!(metadata.extension, Some("txt".to_string()));
    assert_eq!(metadata.mime_type, Some("text/plain".to_string()));
    assert_eq!(metadata.directory_stats, None);
}

#[test]
fn get_metadata_counts_nested_regular_files_and_subdirectories() {
    let fixture = TempFixture::new();
    let root = fixture.root.join("folder");
    let nested = root.join("nested");
    fs::create_dir_all(&nested).unwrap();
    fs::create_dir(root.join("empty")).unwrap();
    fs::write(root.join("one.txt"), b"one").unwrap();
    fs::write(nested.join("two.txt"), b"12345").unwrap();
    fs::write(nested.join(".hidden"), b"xy").unwrap();

    let metadata = tauri::async_runtime::block_on(get_metadata(display_path(&root))).unwrap();
    assert_eq!(metadata.entry.kind, EntryKind::Directory);
    assert_eq!(metadata.entry.size_bytes, None);
    assert_eq!(
        metadata.directory_stats,
        Some(DirectoryStats {
            total_file_bytes: 10,
            file_count: 3,
            directory_count: 2,
        })
    );
}

#[cfg(unix)]
#[test]
fn get_metadata_does_not_follow_links_or_count_sockets() {
    use std::os::unix::net::UnixListener;
    let short_root = env::temp_dir().join(format!(
        "bdm-{}-{}",
        std::process::id(),
        FIXTURE_COUNTER.fetch_add(1, AtomicOrdering::Relaxed)
    ));
    fs::create_dir(&short_root).unwrap();
    let fixture = TempFixture { root: short_root };
    let root = fixture.root.join("folder");
    let outside = fixture.root.join("outside");
    fs::create_dir(&root).unwrap();
    fs::create_dir(&outside).unwrap();
    fs::write(outside.join("file.txt"), b"outside").unwrap();
    std::os::unix::fs::symlink(&outside, root.join("linked-folder")).unwrap();
    let _listener = UnixListener::bind(root.join("monitor.ipc")).unwrap();

    let metadata = tauri::async_runtime::block_on(get_metadata(display_path(&root))).unwrap();
    assert_eq!(
        metadata.directory_stats,
        Some(DirectoryStats {
            total_file_bytes: 0,
            file_count: 0,
            directory_count: 0,
        })
    );
}

#[test]
fn preview_file_limits_text_and_never_executes_unsupported_content() {
    let fixture = TempFixture::new();
    let text_path = fixture.root.join("preview.md");
    fs::write(&text_path, "가나다라마바사 abcdefghijklmnopqrstuvwxyz")
        .expect("preview text should be written");
    let text = preview_file(text_path.to_string_lossy().into_owned(), Some(12))
        .expect("text preview should succeed");
    assert_eq!(text.kind, "text");
    assert!(text.truncated);
    assert!(text.text.is_some());
    assert!(text.data_url.is_none());
    assert_eq!(text.limit_bytes, 12);

    let executable = fixture.root.join("program.bin");
    fs::write(&executable, b"#!/bin/sh\necho should-not-run\n")
        .expect("unsupported preview fixture should be written");
    let unsupported = preview_file(executable.to_string_lossy().into_owned(), None)
        .expect("unsupported preview should be a successful state");
    assert_eq!(unsupported.kind, "unsupported");
    assert!(unsupported.text.is_none());
    assert!(unsupported.data_url.is_none());

    let image_path = fixture.root.join("pixel.png");
    fs::write(
        &image_path,
        [0x89, b'P', b'N', b'G', 0x0d, 0x0a, 0x1a, 0x0a],
    )
    .expect("image preview fixture should be written");
    let image = preview_file(image_path.to_string_lossy().into_owned(), None)
        .expect("small image preview should succeed");
    assert_eq!(image.kind, "image");
    assert!(image
        .data_url
        .as_deref()
        .is_some_and(|url| url.starts_with("data:image/png;base64,")));
}

#[test]
fn invalid_path_returns_typed_error() {
    let fixture = TempFixture::new();
    let error = tauri::async_runtime::block_on(get_metadata(
        fixture
            .root
            .join("missing.txt")
            .to_string_lossy()
            .into_owned(),
    ))
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

#[test]
fn create_dir_creates_child_with_validated_name() {
    let fixture = TempFixture::new();
    let created = create_dir(
        fixture.root.to_string_lossy().into_owned(),
        "new-folder".to_string(),
    )
    .expect("directory should be created");

    assert_eq!(created.name, "new-folder");
    assert_eq!(created.kind, EntryKind::Directory);
    assert!(fixture.root.join("new-folder").is_dir());
}

#[test]
fn create_dir_rejects_existing_and_nested_names() {
    let fixture = TempFixture::new();

    let existing = create_dir(
        fixture.root.to_string_lossy().into_owned(),
        "folder".to_string(),
    )
    .expect_err("existing directory should fail");
    assert_eq!(existing.code, "already_exists");
    assert!(existing.recoverable);

    let invalid = create_dir(
        fixture.root.to_string_lossy().into_owned(),
        "nested/folder".to_string(),
    )
    .expect_err("path separator should fail");
    assert_eq!(invalid.code, "invalid_name");
}

#[test]
fn rename_entry_renames_within_same_parent_without_overwrite() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    let renamed = rename_entry(
        source.to_string_lossy().into_owned(),
        "beta.txt".to_string(),
    )
    .expect("rename should succeed");

    assert_eq!(renamed.name, "beta.txt");
    assert!(fixture.root.join("beta.txt").is_file());
    assert!(!source.exists());
}

#[test]
fn rename_entry_rejects_existing_and_invalid_names() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    let existing = rename_entry(
        source.to_string_lossy().into_owned(),
        "archive.7z".to_string(),
    )
    .expect_err("rename overwrite should fail");
    assert_eq!(existing.code, "already_exists");

    let invalid = rename_entry(
        source.to_string_lossy().into_owned(),
        "../escape.txt".to_string(),
    )
    .expect_err("path traversal should fail");
    assert_eq!(invalid.code, "invalid_name");
    assert!(source.exists());
}

#[cfg(unix)]
#[test]
fn rename_entry_rejects_dangling_symlink_target() {
    use std::os::unix::fs::symlink;

    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");
    let dangling = fixture.root.join("dangling-link");
    symlink(fixture.root.join("missing-target"), &dangling)
        .expect("dangling symlink should be created");

    let error = rename_entry(
        source.to_string_lossy().into_owned(),
        "dangling-link".to_string(),
    )
    .expect_err("rename should not overwrite dangling symlink path");

    assert_eq!(error.code, "already_exists");
    assert!(source.exists());
    assert!(fs::symlink_metadata(dangling).is_ok());
}

#[cfg(unix)]
#[test]
fn rename_entry_renames_symlink_entry_not_target() {
    use std::os::unix::fs::symlink;

    let fixture = TempFixture::new();
    let target = fixture.root.join("alpha.txt");
    let link = fixture.root.join("alpha-link");
    let renamed_link = fixture.root.join("renamed-link");
    symlink(&target, &link).expect("symlink source should be created");

    let renamed = rename_entry(
        link.to_string_lossy().into_owned(),
        "renamed-link".to_string(),
    )
    .expect("symlink entry rename should succeed");

    assert_eq!(renamed.name, "renamed-link");
    assert_eq!(renamed.kind, EntryKind::Symlink);
    assert!(target.exists(), "target file must not be renamed");
    assert!(fs::symlink_metadata(&link).is_err());
    assert!(fs::symlink_metadata(&renamed_link).is_ok());
}

#[cfg(unix)]
#[test]
fn rename_entry_renames_dangling_symlink_source_entry() {
    use std::os::unix::fs::symlink;

    let fixture = TempFixture::new();
    let link = fixture.root.join("dangling-source");
    let renamed_link = fixture.root.join("renamed-dangling-source");
    symlink(fixture.root.join("missing-target"), &link)
        .expect("dangling symlink source should be created");

    let renamed = rename_entry(
        link.to_string_lossy().into_owned(),
        "renamed-dangling-source".to_string(),
    )
    .expect("dangling symlink source entry rename should succeed");

    assert_eq!(renamed.name, "renamed-dangling-source");
    assert_eq!(renamed.kind, EntryKind::Symlink);
    assert!(fs::symlink_metadata(&link).is_err());
    assert!(fs::symlink_metadata(&renamed_link).is_ok());
}

#[test]
fn start_copy_recursively_copies_files_and_directories() {
    let fixture = TempFixture::new();
    let target = fixture.root.join("copy-target");
    fs::create_dir_all(&target).expect("target directory should be created");
    let nested = fixture.root.join("folder/nested.txt");
    fs::write(&nested, b"nested").expect("nested fixture should be written");

    let started = operation::start_copy(
        None,
        vec![fixture.root.join("folder").to_string_lossy().into_owned()],
        target.to_string_lossy().into_owned(),
        ConflictDecision::Skip,
    )
    .expect("copy should start");

    assert_eq!(started.kind, OperationKind::Copy);
    assert_eq!(started.state, OperationState::Queued);
    assert_eq!(
        fs::read(target.join("folder/nested.txt")).expect("copied file should exist"),
        b"nested"
    );
}

#[test]
fn start_copy_applies_conflict_skip_and_overwrite_policies() {
    let fixture = TempFixture::new();
    let target = fixture.root.join("copy-conflict-target");
    fs::create_dir_all(&target).expect("target directory should be created");
    fs::write(target.join("alpha.txt"), b"old").expect("conflict target should be written");

    operation::start_copy(
        None,
        vec![fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned()],
        target.to_string_lossy().into_owned(),
        ConflictDecision::Skip,
    )
    .expect("copy skip should start");
    assert_eq!(
        fs::read(target.join("alpha.txt")).expect("target should remain"),
        b"old"
    );

    operation::start_copy(
        None,
        vec![fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned()],
        target.to_string_lossy().into_owned(),
        ConflictDecision::Overwrite,
    )
    .expect("copy overwrite should start");
    assert_eq!(
        fs::read(target.join("alpha.txt")).expect("target should be overwritten"),
        b"hello"
    );
}

#[test]
fn start_copy_can_cancel_before_copying_work() {
    let fixture = TempFixture::new();
    let target = fixture.root.join("cancel-target");
    fs::create_dir_all(&target).expect("target directory should be created");

    let summary = operation::start_copy_cancel_after_for_test(
        vec![fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned()],
        target.to_string_lossy().into_owned(),
        ConflictDecision::Overwrite,
        0,
    );

    assert_eq!(summary.state, OperationState::Cancelled);
    assert!(!target.join("alpha.txt").exists());
}

#[test]
fn start_move_renames_to_target_directory() {
    let fixture = TempFixture::new();
    let target = fixture.root.join("move-target");
    fs::create_dir_all(&target).expect("target directory should be created");
    let source = fixture.root.join("alpha.txt");

    let started = operation::start_move(
        None,
        vec![source.to_string_lossy().into_owned()],
        target.to_string_lossy().into_owned(),
        ConflictDecision::Skip,
    )
    .expect("move should start");

    assert_eq!(started.kind, OperationKind::Move);
    assert!(!source.exists());
    assert_eq!(
        fs::read(target.join("alpha.txt")).expect("moved file should exist"),
        b"hello"
    );
}

#[test]
fn start_copy_to_same_directory_overwrite_is_noop_not_delete() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    operation::start_copy(
        None,
        vec![source.to_string_lossy().into_owned()],
        fixture.root.to_string_lossy().into_owned(),
        ConflictDecision::Overwrite,
    )
    .expect("same-directory copy should be accepted as no-op");

    assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
}

#[test]
fn start_copy_to_same_directory_all_overwrite_is_noop_not_delete() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    operation::start_copy(
        None,
        vec![source.to_string_lossy().into_owned()],
        fixture.root.to_string_lossy().into_owned(),
        ConflictDecision::AllOverwrite,
    )
    .expect("same-directory copy should be accepted as no-op");

    assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
}
#[test]
fn start_move_to_same_directory_overwrite_is_noop_not_delete() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    operation::start_move(
        None,
        vec![source.to_string_lossy().into_owned()],
        fixture.root.to_string_lossy().into_owned(),
        ConflictDecision::Overwrite,
    )
    .expect("same-directory move should be accepted as no-op");

    assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
}

#[test]
fn start_move_to_same_directory_all_overwrite_is_noop_not_delete() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    operation::start_move(
        None,
        vec![source.to_string_lossy().into_owned()],
        fixture.root.to_string_lossy().into_owned(),
        ConflictDecision::AllOverwrite,
    )
    .expect("same-directory move should be accepted as no-op");

    assert_eq!(fs::read(&source).expect("source must remain"), b"hello");
}
#[test]
fn start_delete_requires_confirm_token_for_permanent_delete() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    let error = operation::start_delete(
        None,
        vec![source.to_string_lossy().into_owned()],
        DeleteMode::Permanent,
        None,
    )
    .expect_err("permanent delete should require confirmation token");

    assert_eq!(error.code, "confirmation_required");
    assert!(source.exists());
}

#[test]
fn start_delete_permanently_removes_confirmed_targets() {
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");

    let started = operation::start_delete(
        None,
        vec![source.to_string_lossy().into_owned()],
        DeleteMode::Permanent,
        Some("PERMANENT_DELETE"),
    )
    .expect("confirmed permanent delete should start");

    assert_eq!(started.kind, OperationKind::Delete);
    assert!(!source.exists());
}

#[test]
fn start_delete_trash_moves_without_permanent_fallback() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    let trash_dir = fixture.root.join("trash-fixture");
    fs::create_dir_all(&trash_dir).expect("trash fixture should be created");
    env::set_var("BOKSLDIRGUI_TRASH_DIR", &trash_dir);
    let source = fixture.root.join("alpha.txt");

    let started = operation::start_delete(
        None,
        vec![source.to_string_lossy().into_owned()],
        DeleteMode::Trash,
        None,
    )
    .expect("trash delete should start");
    env::remove_var("BOKSLDIRGUI_TRASH_DIR");

    assert_eq!(started.kind, OperationKind::Trash);
    assert!(!source.exists());
    assert!(fs::read_dir(&trash_dir)
        .expect("trash dir should be readable")
        .flatten()
        .any(|entry| entry.file_name().to_string_lossy().contains("alpha.txt")));
}

#[test]
fn start_delete_trash_failure_keeps_source_without_permanent_fallback() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    let invalid_trash = fixture.root.join("not-a-trash-directory");
    fs::write(&invalid_trash, b"file blocks trash directory")
        .expect("blocking file should be written");
    env::set_var("BOKSLDIRGUI_TRASH_DIR", &invalid_trash);
    let source = fixture.root.join("alpha.txt");

    let started = operation::start_delete(
        None,
        vec![source.to_string_lossy().into_owned()],
        DeleteMode::Trash,
        None,
    )
    .expect("trash operation should be accepted and report failure by summary event");
    env::remove_var("BOKSLDIRGUI_TRASH_DIR");

    assert_eq!(started.kind, OperationKind::Trash);
    assert!(
        source.exists(),
        "trash failure must not fall back to permanent deletion"
    );
}
#[test]
fn delete_guard_rejects_protected_root_path() {
    let error = operation::start_delete(
        None,
        vec!["/".to_string()],
        DeleteMode::Permanent,
        Some("PERMANENT_DELETE"),
    )
    .expect_err("root delete should be rejected");

    assert_eq!(error.code, "invalid_path");
}

#[test]
fn delete_guard_rejects_platform_protected_paths() {
    for protected in ["/System", "/bin", "/usr", "/Users"] {
        let error = operation::guard_delete_target(Path::new(protected))
            .expect_err("protected OS path should be rejected");
        assert_eq!(error.code, "invalid_path");
    }
}

#[test]
fn resolve_conflict_feeds_backend_wait_channel() {
    let resolved = operation::conflict_decision_after_resolve_for_test(ConflictDecision::Overwrite);
    assert_eq!(resolved, ConflictDecision::Overwrite);
}
#[test]
fn cross_device_error_detection_supports_move_fallback_policy() {
    let error = io::Error::from_raw_os_error(18);
    assert!(operation::is_cross_device_error(&error));
}

#[test]
fn load_and_save_settings_persist_bookmarks_and_layout() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    let settings_path = fixture.root.join("settings/settings.json");
    env::set_var("BOKSLDIRGUI_SETTINGS_PATH", &settings_path);

    let initial = load_settings().expect("missing settings should use defaults");
    assert_eq!(initial.schema_version, 1);
    assert_eq!(initial.layout.ratio, "50:50");
    assert_eq!(initial.view.zoom_step, 0);

    let saved = save_settings(serde_json::json!({
        "bookmarks": [{ "id": "root", "label": "Root", "path": fixture.root.to_string_lossy() }],
        "layout": { "singlePanel": true, "ratio": "70:30" },
        "session": { "leftPath": fixture.root.to_string_lossy(), "rightPath": fixture.root.to_string_lossy(), "activePanel": "left" },
        "view": { "zoomStep": 2, "density": "compact", "showIcons": false },
        "theme": "highContrast",
        "language": "en",
        "external": { "editorId": "vim", "shellCommand": { "enabled": true } }
    }))
    .expect("settings patch should be saved");
    assert_eq!(saved.bookmarks[0].label, "Root");
    assert!(saved.layout.single_panel);
    assert_eq!(saved.layout.ratio, "70:30");
    assert_eq!(saved.view.zoom_step, 2);
    assert!(!saved.view.show_icons);
    assert_eq!(saved.external.editor_id.as_deref(), Some("vim"));
    assert!(saved.external.shell_command.enabled);
    assert_eq!(saved.session.active_panel, PanelId::Left);
    assert_eq!(
        saved.session.left_path.as_deref(),
        Some(fixture.root.to_string_lossy().as_ref())
    );
    assert!(settings_path.is_file());

    let locations = list_locations().expect("locations should load bookmark settings");
    assert!(locations
        .bookmarks
        .iter()
        .any(|bookmark| bookmark.id == "root"));

    env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
}

#[test]
fn save_settings_rejects_invalid_layout_ratio() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    env::set_var(
        "BOKSLDIRGUI_SETTINGS_PATH",
        fixture.root.join("settings.json"),
    );

    let error = save_settings(serde_json::json!({
        "layout": { "singlePanel": false, "ratio": "90:10" }
    }))
    .expect_err("invalid layout ratio should fail");

    env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
    assert_eq!(error.code, "invalid_settings");
    assert_eq!(
        error
            .details
            .and_then(|details| details.get("field").cloned()),
        Some("layout.ratio".to_string())
    );
}

#[test]
fn shell_command_is_disabled_by_default_and_uses_one_shot_tokens_when_enabled() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    shell_command::reset_clock_for_test();
    env::set_var(
        "BOKSLDIRGUI_SETTINGS_PATH",
        fixture.root.join("settings.json"),
    );

    let disabled = prepare_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["hello".to_string()]),
    )
    .expect("disabled shell preview should be returned");
    assert!(!disabled.policy.enabled);
    assert_eq!(disabled.confirm_token, "disabled");
    let denied = run_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["blocked".to_string()]),
        None,
    )
    .expect_err("direct shell command must respect the disabled setting");
    assert_eq!(denied.code, "disabled");

    save_settings(serde_json::json!({
        "external": { "shellCommand": { "enabled": true } }
    }))
    .expect("shell command setting should be enabled for test");
    let preview = prepare_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["hello".to_string()]),
    )
    .expect("enabled shell preview should issue token");
    assert!(preview.policy.enabled);
    let direct = run_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["direct".to_string()]),
        None,
    )
    .expect("enabled shell command should run without a confirmation token");
    assert_eq!(direct.exit_code, Some(0));
    assert_eq!(direct.stdout.trim(), "direct");
    let result = run_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["hello".to_string()]),
        Some(preview.confirm_token.clone()),
    )
    .expect("tokenized shell command should run");
    assert_eq!(result.exit_code, Some(0));
    assert_eq!(result.stdout.trim(), "hello");

    let reused = run_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["hello".to_string()]),
        Some(preview.confirm_token),
    )
    .expect_err("shell confirm token must be one-shot");
    env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
    assert_eq!(reused.code, "invalid_token");
    shell_command::reset_clock_for_test();
}

#[test]
fn shell_command_confirm_token_expires_after_ttl() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    shell_command::reset_clock_for_test();
    env::set_var(
        "BOKSLDIRGUI_SETTINGS_PATH",
        fixture.root.join("settings.json"),
    );
    save_settings(serde_json::json!({
        "external": { "shellCommand": { "enabled": true } }
    }))
    .expect("shell command setting should be enabled for ttl test");

    let preview = prepare_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["expired".to_string()]),
    )
    .expect("enabled shell preview should issue token");

    shell_command::advance_clock_past_token_ttl_for_test();
    let expired = run_shell_command(
        fixture.root.to_string_lossy().into_owned(),
        "echo".to_string(),
        Some(vec!["expired".to_string()]),
        Some(preview.confirm_token),
    )
    .expect_err("expired shell confirm token must be rejected");

    shell_command::reset_clock_for_test();
    env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
    assert_eq!(expired.code, "invalid_token");
    assert_eq!(expired.message_key, "errors.shellConfirmationInvalid");
    assert!(expired
        .details
        .and_then(|details| details.get("expiresAt").cloned())
        .is_some());
}

#[test]
fn external_open_commands_support_dry_run() {
    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    let source = fixture.root.join("alpha.txt");
    env::set_var(
        "BOKSLDIRGUI_SETTINGS_PATH",
        fixture.root.join("settings.json"),
    );
    env::set_var("BOKSLDIRGUI_EXTERNAL_DRY_RUN", "1");

    let opened = open_default(source.to_string_lossy().into_owned())
        .expect("dry-run default open should succeed");
    assert_eq!(opened.message_key, Some("external.dryRun".to_string()));
    let revealed = reveal_in_manager(source.to_string_lossy().into_owned())
        .expect("dry-run reveal should succeed");
    assert!(revealed.ok);

    #[cfg(target_os = "macos")]
    {
        for open_directory in [open_current_in_finder, open_current_in_terminal] {
            let opened = open_directory(fixture.root.to_string_lossy().into_owned())
                .expect("dry-run current directory open should succeed");
            assert!(opened.ok);
        }
    }
    for open_directory in [open_current_in_finder, open_current_in_terminal] {
        let file_error = open_directory(source.to_string_lossy().into_owned())
            .expect_err("a file must not be opened as the current directory");
        assert_eq!(file_error.code, "not_directory");
        let missing_error =
            open_directory(fixture.root.join("missing").to_string_lossy().into_owned())
                .expect_err("a missing current directory must fail");
        assert_eq!(missing_error.code, "not_found");
    }

    env::remove_var("BOKSLDIRGUI_EXTERNAL_DRY_RUN");
    env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
}

#[test]
fn archive_zip_create_list_extract_round_trip_uses_relative_entry_names() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    if !command_available("zip") || !command_available("unzip") {
        return;
    }
    let fixture = TempFixture::new();
    fs::write(fixture.root.join("folder").join("beta.txt"), b"nested")
        .expect("nested archive fixture should be written");
    let korean_dir = fixture.root.join("한글 폴더");
    fs::create_dir_all(&korean_dir).expect("Korean archive directory should be created");
    fs::write(korean_dir.join("메모.md"), b"korean path")
        .expect("Korean archive fixture should be written");
    let archive_path = fixture.root.join("round-trip.zip");
    let extract_dir = fixture.root.join("extract");
    let partial_extract_dir = fixture.root.join("partial-extract");
    fs::create_dir_all(&extract_dir).expect("extract directory should be created");
    fs::create_dir_all(&partial_extract_dir).expect("partial extract directory should exist");

    let created = operation::start_archive_create(
        None,
        vec![
            fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned(),
            fixture.root.join("folder").to_string_lossy().into_owned(),
            korean_dir.to_string_lossy().into_owned(),
        ],
        archive_path.to_string_lossy().into_owned(),
        "zip".to_string(),
        None,
    )
    .expect("archive create should start");
    assert_eq!(created.kind, OperationKind::ArchiveCreate);
    assert!(archive_path.is_file());

    let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
        .expect("zip listing should succeed");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "alpha.txt"));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path.ends_with("!한글 폴더/메모.md")));
    assert!(listing
        .entries
        .iter()
        .all(|entry| !entry.name.contains('�')));
    assert!(!listing
        .entries
        .iter()
        .any(|entry| entry.name.contains("boksldir-gui-navigation")));

    let added_file = fixture.root.join("added.txt");
    fs::write(&added_file, b"first").expect("archive add fixture should be written");
    let added_dir = fixture.root.join("added-dir");
    fs::create_dir_all(&added_dir).expect("archive add directory should be created");
    fs::write(added_dir.join("nested.txt"), b"added nested")
        .expect("nested archive add fixture should be written");
    let added = operation::start_archive_add(
        None,
        vec![
            added_file.to_string_lossy().into_owned(),
            added_dir.to_string_lossy().into_owned(),
        ],
        archive_path.to_string_lossy().into_owned(),
        "folder".to_string(),
        ConflictDecision::Overwrite,
    )
    .expect("archive add should start");
    assert_eq!(added.kind, OperationKind::ArchiveAdd);
    let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
        .expect("updated zip listing should succeed");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path.ends_with("!folder/added.txt")));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path.ends_with("!folder/added-dir/nested.txt")));

    fs::write(&added_file, b"second").expect("archive conflict fixture should be updated");
    operation::start_archive_add(
        None,
        vec![added_file.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "folder".to_string(),
        ConflictDecision::Skip,
    )
    .expect("archive add skip should start");
    operation::start_archive_add(
        None,
        vec![added_file.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "folder".to_string(),
        ConflictDecision::AllSkip,
    )
    .expect("archive add all-skip should start");

    let extracted = operation::start_archive_extract(
        None,
        archive_path.to_string_lossy().into_owned(),
        extract_dir.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
        None,
        None,
    )
    .expect("archive extract should start");
    assert_eq!(extracted.kind, OperationKind::ArchiveExtract);
    assert_eq!(
        fs::read(extract_dir.join("alpha.txt")).expect("extracted file should exist"),
        b"hello"
    );
    assert_eq!(
        fs::read(extract_dir.join("folder").join("beta.txt"))
            .expect("nested extracted file should exist"),
        b"nested"
    );
    assert_eq!(
        fs::read(extract_dir.join("한글 폴더").join("메모.md"))
            .expect("Korean extracted file should exist"),
        b"korean path"
    );
    assert_eq!(
        fs::read(extract_dir.join("folder").join("added.txt"))
            .expect("archive-added file should be extracted"),
        b"first",
        "skip must preserve the existing archive entry"
    );
    assert_eq!(
        fs::read(
            extract_dir
                .join("folder")
                .join("added-dir")
                .join("nested.txt")
        )
        .expect("archive-added directory should be extracted"),
        b"added nested"
    );

    operation::start_archive_add(
        None,
        vec![added_file.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "folder".to_string(),
        ConflictDecision::AllOverwrite,
    )
    .expect("archive add all-overwrite should start");
    let overwrite_extract_dir = fixture.root.join("overwrite-extract");
    fs::create_dir_all(&overwrite_extract_dir).expect("overwrite extract directory should exist");
    operation::start_archive_extract(
        None,
        archive_path.to_string_lossy().into_owned(),
        overwrite_extract_dir.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
        Some(vec!["folder/added.txt".to_string()]),
        Some("folder".to_string()),
    )
    .expect("overwritten archive entry should extract");
    assert_eq!(
        fs::read(overwrite_extract_dir.join("added.txt"))
            .expect("overwritten archive entry should exist"),
        b"second"
    );

    fs::write(&added_file, b"cancelled").expect("archive cancel fixture should be updated");
    operation::start_archive_add(
        None,
        vec![added_file.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "folder".to_string(),
        ConflictDecision::Cancel,
    )
    .expect("archive add cancel should start");
    let cancel_extract_dir = fixture.root.join("cancel-extract");
    fs::create_dir_all(&cancel_extract_dir).expect("cancel extract directory should exist");
    operation::start_archive_extract(
        None,
        archive_path.to_string_lossy().into_owned(),
        cancel_extract_dir.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
        Some(vec!["folder/added.txt".to_string()]),
        Some("folder".to_string()),
    )
    .expect("entry should still extract after cancelled overwrite");
    assert_eq!(
        fs::read(cancel_extract_dir.join("added.txt"))
            .expect("cancelled overwrite must preserve existing entry"),
        b"second"
    );

    operation::start_archive_extract(
        None,
        archive_path.to_string_lossy().into_owned(),
        partial_extract_dir.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
        Some(vec!["folder/beta.txt".to_string()]),
        Some("folder".to_string()),
    )
    .expect("partial archive extract should start");
    assert_eq!(
        fs::read(partial_extract_dir.join("beta.txt"))
            .expect("partial extract should strip current archive folder prefix"),
        b"nested"
    );
    assert!(
        !partial_extract_dir.join("folder").exists(),
        "copying from inside archive folder should not recreate the current folder prefix"
    );
    operation::start_archive_extract(
        None,
        archive_path.to_string_lossy().into_owned(),
        partial_extract_dir.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
        Some(vec!["한글 폴더/메모.md".to_string()]),
        Some("한글 폴더".to_string()),
    )
    .expect("Korean entry should extract by its displayed name");
    assert_eq!(
        fs::read(partial_extract_dir.join("메모.md")).expect("selected Korean entry should exist"),
        b"korean path"
    );
}

#[test]
fn archive_required_formats_create_list_and_extract_round_trip() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    if !command_available("zip") || !command_available("unzip") || !command_available("tar") {
        return;
    }
    for (suffix, format) in [
        ("jar", "jar"),
        ("war", "war"),
        ("tar", "tar"),
        ("tar.gz", "tar.gz"),
        ("tgz", "tar.gz"),
        ("tar.zst", "tar.zst"),
        ("tzst", "tar.zst"),
    ] {
        let fixture = TempFixture::new();
        let archive_path = fixture.root.join(format!("required-format.{suffix}"));
        let extract_dir = fixture.root.join("extract-required-format");
        fs::create_dir_all(&extract_dir).expect("format extract directory should exist");
        let created = operation::start_archive_create(
            None,
            vec![fixture
                .root
                .join("alpha.txt")
                .to_string_lossy()
                .into_owned()],
            archive_path.to_string_lossy().into_owned(),
            format.to_string(),
            None,
        )
        .expect("required archive format create should start");
        assert_eq!(created.kind, OperationKind::ArchiveCreate);
        assert!(archive_path.is_file(), "{suffix} archive should be created");

        let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, Some(100))
            .expect("required archive format listing should succeed");
        assert!(listing
            .entries
            .iter()
            .any(|entry| entry.name == "alpha.txt"));
        assert!(!listing.truncated);

        operation::start_archive_extract(
            None,
            archive_path.to_string_lossy().into_owned(),
            extract_dir.to_string_lossy().into_owned(),
            None,
            ConflictDecision::Overwrite,
            None,
            None,
        )
        .expect("required archive format extract should start");
        assert_eq!(
            fs::read(extract_dir.join("alpha.txt"))
                .expect("required archive format should extract alpha.txt"),
            b"hello",
            "{suffix} round trip should preserve content"
        );
    }
}

#[test]
fn archive_listing_limit_reports_truncation() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    if !command_available("zip") || !command_available("unzip") {
        return;
    }
    let fixture = TempFixture::new();
    let source_dir = fixture.root.join("large-listing");
    fs::create_dir_all(&source_dir).expect("large listing directory should exist");
    for index in 0..120 {
        fs::write(source_dir.join(format!("entry-{index:03}.txt")), b"x")
            .expect("large listing entry should be written");
    }
    let archive_path = fixture.root.join("large-listing.zip");
    operation::start_archive_create(
        None,
        vec![source_dir.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "zip".to_string(),
        None,
    )
    .expect("large listing archive create should start");
    let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, Some(25))
        .expect("limited archive listing should succeed");
    assert_eq!(listing.entries.len(), 25);
    assert!(listing.total_entries >= 120);
    assert!(listing.truncated);
}

#[test]
fn archive_password_round_trip_and_unsafe_entry_guards() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    let fixture = TempFixture::new();
    if !command_available("zip") || !command_available("unzip") {
        return;
    }
    let secret_archive = fixture.root.join("secret.zip");
    let password_summary = operation::archive_create_summary_for_test(
        vec![fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned()],
        secret_archive.to_string_lossy().into_owned(),
        "zip".to_string(),
        Some("secret".to_string()),
    );
    assert_eq!(password_summary.kind, OperationKind::ArchiveCreate);
    assert_eq!(password_summary.state, OperationState::Completed);
    let listing = archive_list(
        secret_archive.to_string_lossy().into_owned(),
        Some("secret".to_string()),
        Some(100),
    )
    .expect("password-protected zip listing should succeed");
    assert!(listing.encrypted);
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "alpha.txt"));

    let missing_target = fixture.root.join("missing-password-extract");
    fs::create_dir_all(&missing_target).expect("missing-password target should exist");
    let missing_password = operation::archive_extract_summary_for_test(
        secret_archive.to_string_lossy().into_owned(),
        missing_target.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
    );
    assert_eq!(missing_password.state, OperationState::Failed);
    assert!(!missing_target.join("alpha.txt").exists());

    let wrong_target = fixture.root.join("wrong-password-extract");
    fs::create_dir_all(&wrong_target).expect("wrong-password target should exist");
    let wrong_password = operation::archive_extract_summary_for_test(
        secret_archive.to_string_lossy().into_owned(),
        wrong_target.to_string_lossy().into_owned(),
        Some("not-the-password".to_string()),
        ConflictDecision::Overwrite,
    );
    assert_eq!(wrong_password.state, OperationState::Failed);
    let serialized_wrong =
        serde_json::to_string(&wrong_password).expect("wrong-password summary should serialize");
    assert!(!serialized_wrong.contains("not-the-password"));

    let correct_target = fixture.root.join("correct-password-extract");
    fs::create_dir_all(&correct_target).expect("correct-password target should exist");
    let correct_password = operation::archive_extract_summary_for_test(
        secret_archive.to_string_lossy().into_owned(),
        correct_target.to_string_lossy().into_owned(),
        Some("secret".to_string()),
        ConflictDecision::Overwrite,
    );
    assert_eq!(correct_password.state, OperationState::Completed);
    assert_eq!(
        fs::read(correct_target.join("alpha.txt")).expect("password-protected zip should extract"),
        b"hello"
    );

    assert!(operation::archive_entry_is_unsafe_for_test("../escape.txt"));
    assert!(operation::archive_entry_is_unsafe_for_test("/absolute.txt"));
    assert!(operation::archive_entry_is_unsafe_for_test(
        "C:\\absolute.txt"
    ));
    assert!(operation::archive_entry_is_unsafe_for_test(
        "\\absolute.txt"
    ));
    assert!(operation::archive_entry_is_unsafe_for_test(
        "safe\0hidden.txt"
    ));
    assert!(!operation::archive_entry_is_unsafe_for_test(
        "safe/entry.txt"
    ));

    let archive = fixture.root.join("unsafe-target.zip");
    File::create(&archive).expect("unsafe target archive fixture should exist");
    let unsafe_add = operation::archive_add_summary_for_test(
        vec![fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned()],
        archive.to_string_lossy().into_owned(),
        "../escape".to_string(),
        ConflictDecision::Overwrite,
    );
    assert_eq!(unsafe_add.kind, OperationKind::ArchiveAdd);
    assert_eq!(unsafe_add.state, OperationState::Failed);
    assert_eq!(unsafe_add.errors[0].message_key, "errors.archiveUnsafePath");
}

#[test]
fn external_archive_provider_is_killed_when_operation_is_cancelled() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    let Some((result, elapsed)) = operation::external_archive_command_cancel_for_test() else {
        return;
    };
    let error = result.expect_err("cancelled external provider should return cancellation");
    assert_eq!(error.code, "operation_cancelled");
    assert!(
        elapsed < Duration::from_secs(5),
        "cancel should kill the external provider promptly, elapsed={elapsed:?}"
    );
}

#[test]
#[cfg(unix)]
fn archive_extract_preflight_listing_provider_is_killed_when_cancelled() {
    use std::os::unix::fs::PermissionsExt;

    let _env_guard = TEST_ENV_MUTEX.lock().expect("test env mutex should lock");
    let fixture = TempFixture::new();
    let listing_provider = if cfg!(target_os = "macos") {
        "tar"
    } else {
        "unzip"
    };
    let fake_provider = fixture.root.join(listing_provider);
    fs::write(&fake_provider, "#!/bin/sh\nwhile :; do :; done\n")
        .expect("fake archive listing provider should be written");
    let mut permissions = fs::metadata(&fake_provider)
        .expect("fake archive listing metadata should exist")
        .permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(&fake_provider, permissions)
        .expect("fake archive listing provider should be executable");
    let archive = fixture.root.join("blocked.zip");
    File::create(&archive).expect("blocked archive fixture should be created");
    let old_path = env::var_os("PATH");
    let next_path = match old_path.as_ref() {
        Some(path) => format!(
            "{}:{}",
            fixture.root.to_string_lossy(),
            path.to_string_lossy()
        ),
        None => fixture.root.to_string_lossy().into_owned(),
    };
    env::set_var("PATH", next_path);

    let (result, elapsed) = operation::archive_entry_listing_cancel_for_test(archive);

    match old_path {
        Some(path) => env::set_var("PATH", path),
        None => env::remove_var("PATH"),
    }
    let error = result.expect_err("cancelled archive listing should return cancellation");
    assert_eq!(error.code, "operation_cancelled");
    assert!(
        elapsed < Duration::from_secs(5),
        "cancel should kill the archive listing provider promptly, elapsed={elapsed:?}"
    );
}

#[test]
fn archive_7z_slt_parser_preserves_spaces_and_unsafe_paths() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    let paths = archive::parse_7z_slt_paths_for_test(
        b"Path = fixture.7z\nType = 7z\n----------\nPath = dir/my file.txt\nSize = 5\nPath = ../escape file.txt\nSize = 1\n",
    );

    assert_eq!(
        paths,
        vec![
            "dir/my file.txt".to_string(),
            "../escape file.txt".to_string()
        ]
    );
    assert!(!operation::archive_entry_is_unsafe_for_test(&paths[0]));
    assert!(operation::archive_entry_is_unsafe_for_test(&paths[1]));
}

#[test]
fn archive_listing_parsers_keep_file_metadata_when_available() {
    let names = vec![
        "alpha.txt".to_string(),
        "dir/".to_string(),
        "dir/beta space.txt".to_string(),
    ];
    let zip_entries = archive::parse_zipinfo_long_output_for_test(
        b"Archive: fixture.zip\n-rw-r--r--  3.0 unx        5 tx        5 stor 20260702.233028 alpha.txt\ndrwxr-xr-x  3.0 unx        0 bx        0 stor 20260702.233029 dir/\n-rw-r--r--  3.0 unx       10 tx       10 stor 20260702.233030 dir/beta space.txt\n",
        &names,
    );
    assert_eq!(zip_entries[0].name, "alpha.txt");
    assert_eq!(zip_entries[0].size_bytes, Some(5));
    assert_eq!(
        zip_entries[0].modified_at.as_deref(),
        Some("2026-07-02T23:30:28")
    );
    assert_eq!(zip_entries[0].permissions.as_deref(), Some("-rw-r--r--"));
    assert_eq!(zip_entries[1].kind, EntryKind::Directory);
    assert_eq!(zip_entries[2].path, "/tmp/archive.zip!dir/beta space.txt");
    assert_eq!(zip_entries[2].size_bytes, Some(10));

    let seven_zip_entries = archive::parse_7z_slt_entries_for_test(
        b"Path = fixture.7z\nType = 7z\n----------\nPath = dir/my file.txt\nSize = 5\nModified = 2026-07-02 23:30:28\nCreated = 2026-07-02 23:00:01\nAttributes = A -rw-r--r--\nFolder = -\nPath = dir\nModified = 2026-07-02 23:30:29\nAttributes = D drwxr-xr-x\nFolder = +\n",
    );
    assert_eq!(seven_zip_entries[0].name, "my file.txt");
    assert_eq!(seven_zip_entries[0].size_bytes, Some(5));
    assert_eq!(
        seven_zip_entries[0].modified_at.as_deref(),
        Some("2026-07-02T23:30:28")
    );
    assert_eq!(
        seven_zip_entries[0].created_at.as_deref(),
        Some("2026-07-02T23:00:01")
    );
    assert_eq!(
        seven_zip_entries[0].permissions.as_deref(),
        Some("-rw-r--r--")
    );
    assert_eq!(seven_zip_entries[1].kind, EntryKind::Directory);
    assert_eq!(
        seven_zip_entries[1].permissions.as_deref(),
        Some("drwxr-xr-x")
    );
}

#[test]
fn archive_7z_provider_lists_real_fixture_when_available() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    let Some(binary) = archive::seven_zip_binary_for_test() else {
        return;
    };
    let fixture = TempFixture::new();
    fs::write(fixture.root.join("space name.txt"), b"space")
        .expect("space-name fixture should be written");
    let archive_path = fixture.root.join("provider-fixture.7z");
    let output = Command::new(binary)
        .args([
            "a",
            "-bd",
            "provider-fixture.7z",
            "alpha.txt",
            "space name.txt",
        ])
        .current_dir(&fixture.root)
        .output()
        .expect("7z provider should be executable");
    assert!(
        output.status.success(),
        "7z provider should create fixture: {}",
        String::from_utf8_lossy(&output.stderr)
    );

    let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
        .expect("7z listing should succeed when provider is available");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "alpha.txt"));
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "space name.txt"));

    let added = fixture.root.join("added-7z.txt");
    fs::write(&added, b"first").expect("7z add fixture should be written");
    operation::start_archive_add(
        None,
        vec![added.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "nested".to_string(),
        ConflictDecision::Overwrite,
    )
    .expect("7z archive add should start");
    let listing = archive_list(archive_path.to_string_lossy().into_owned(), None, None)
        .expect("updated 7z listing should succeed");
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.path.ends_with("!nested/added-7z.txt")));

    fs::write(&added, b"second").expect("7z conflict fixture should be updated");
    operation::start_archive_add(
        None,
        vec![added.to_string_lossy().into_owned()],
        archive_path.to_string_lossy().into_owned(),
        "nested".to_string(),
        ConflictDecision::Overwrite,
    )
    .expect("7z archive overwrite should start");
    let extract_dir = fixture.root.join("7z-add-extract");
    fs::create_dir_all(&extract_dir).expect("7z extract directory should exist");
    operation::start_archive_extract(
        None,
        archive_path.to_string_lossy().into_owned(),
        extract_dir.to_string_lossy().into_owned(),
        None,
        ConflictDecision::Overwrite,
        Some(vec!["nested/added-7z.txt".to_string()]),
        Some("nested".to_string()),
    )
    .expect("7z archive-added entry should extract");
    assert_eq!(
        fs::read(extract_dir.join("added-7z.txt")).expect("overwritten 7z entry should exist"),
        b"second"
    );
}

#[test]
fn archive_7z_password_and_large_listing_when_provider_is_available() {
    let _env_guard = TEST_ENV_MUTEX.lock().unwrap();
    let Some(_binary) = archive::seven_zip_binary_for_test() else {
        return;
    };
    let fixture = TempFixture::new();
    let large_source = fixture.root.join("large-7z-listing");
    fs::create_dir_all(&large_source).expect("large 7z source should exist");
    for index in 0..120 {
        fs::write(large_source.join(format!("entry-{index:03}.txt")), b"x")
            .expect("large 7z entry should be written");
    }
    let large_archive = fixture.root.join("large-listing.7z");
    let large_summary = operation::archive_create_summary_for_test(
        vec![large_source.to_string_lossy().into_owned()],
        large_archive.to_string_lossy().into_owned(),
        "7z".to_string(),
        None,
    );
    assert_eq!(large_summary.state, OperationState::Completed);
    let limited = archive_list(large_archive.to_string_lossy().into_owned(), None, Some(25))
        .expect("limited 7z listing should succeed");
    assert_eq!(limited.entries.len(), 25);
    assert!(limited.total_entries >= 120);
    assert!(limited.truncated);

    let encrypted_archive = fixture.root.join("encrypted.7z");
    let encrypted_summary = operation::archive_create_summary_for_test(
        vec![fixture
            .root
            .join("alpha.txt")
            .to_string_lossy()
            .into_owned()],
        encrypted_archive.to_string_lossy().into_owned(),
        "7z".to_string(),
        Some("seven-secret".to_string()),
    );
    assert_eq!(encrypted_summary.state, OperationState::Completed);
    assert!(!serde_json::to_string(&encrypted_summary)
        .expect("encrypted summary should serialize")
        .contains("seven-secret"));

    let wrong = archive_list(
        encrypted_archive.to_string_lossy().into_owned(),
        Some("wrong-seven-secret".to_string()),
        Some(100),
    )
    .expect_err("wrong 7z password should fail");
    assert_eq!(wrong.code, "invalid_password");
    assert!(!serde_json::to_string(&wrong)
        .expect("password error should serialize")
        .contains("wrong-seven-secret"));

    let listing = archive_list(
        encrypted_archive.to_string_lossy().into_owned(),
        Some("seven-secret".to_string()),
        Some(100),
    )
    .expect("encrypted 7z listing should succeed with the password");
    assert!(listing.encrypted);
    assert!(listing
        .entries
        .iter()
        .any(|entry| entry.name == "alpha.txt"));

    let extract_dir = fixture.root.join("encrypted-7z-extract");
    fs::create_dir_all(&extract_dir).expect("encrypted 7z target should exist");
    let extracted = operation::archive_extract_summary_for_test(
        encrypted_archive.to_string_lossy().into_owned(),
        extract_dir.to_string_lossy().into_owned(),
        Some("seven-secret".to_string()),
        ConflictDecision::Overwrite,
    );
    assert_eq!(extracted.state, OperationState::Completed);
    assert_eq!(
        fs::read(extract_dir.join("alpha.txt")).expect("encrypted 7z file should extract"),
        b"hello"
    );
}

fn command_available(command: &str) -> bool {
    Command::new(command).arg("--help").output().is_ok()
}

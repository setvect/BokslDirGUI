//! 실제 Windows API·파일 시스템 전용 회귀. Mac 실행 결과와 구분.
use crate::{commands, mutation, platform};
use std::{fs, path::PathBuf};
struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!(
            "boksldir-win-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn windows_archive_targets_reject_ads_and_reserved_names_before_writing() {
    use crate::contracts::{ConflictDecision, OperationState};
    let f = Fixture::new();
    let source = f.0.join("source.txt");
    fs::write(&source, "preserved").unwrap();
    for name in ["source.txt:archive.zip", "NUL.zip", "archive.zip."] {
        let summary = crate::operation::archive_create_summary_for_test(
            vec![source.to_string_lossy().into_owned()], f.0.join(name).to_string_lossy().into_owned(),
            "zip".into(), None);
        assert_eq!(summary.state, OperationState::Failed, "{name}");
    }
    let summary = crate::operation::archive_extract_summary_for_test(
        source.to_string_lossy().into_owned(), f.0.join("source.txt:out").to_string_lossy().into_owned(),
        None, ConflictDecision::Overwrite);
    assert_eq!(summary.state, OperationState::Failed);
    assert_eq!(fs::read_to_string(source).unwrap(), "preserved");
    assert_eq!(fs::read_dir(&f.0).unwrap().count(), 1);
}
#[test]
fn windows_names_case_only_rename_and_protected_home() {
    let f = Fixture::new();
    for name in ["CON", "a:b", "name.", "name "] {
        assert_eq!(
            mutation::create_dir(f.0.to_str().unwrap(), name)
                .unwrap_err()
                .code,
            "invalid_name"
        );
    }
    let source = f.0.join("original.txt");
    fs::write(&source, "kept").unwrap();
    mutation::rename_entry(source.to_str().unwrap(), "ORIGINAL.txt").unwrap();
    assert!(fs::read_dir(&f.0)
        .unwrap()
        .any(|e| e.unwrap().file_name() == "ORIGINAL.txt"));
    assert_eq!(
        fs::read_to_string(f.0.join("ORIGINAL.txt")).unwrap(),
        "kept"
    );
    assert!(crate::operation::guard_delete_target(&platform::home_dir().unwrap()).is_err());
    assert!(platform::roots()
        .unwrap()
        .iter()
        .all(|root| root.ends_with(":\\")));
}
#[test]
fn windows_hidden_attributes_executables_and_file_locks() {
    use std::os::windows::{ffi::OsStrExt, fs::OpenOptionsExt};
    use windows_sys::Win32::Storage::FileSystem::{SetFileAttributesW, FILE_ATTRIBUTE_HIDDEN};
    let f = Fixture::new();
    let source = f.0.join("hidden.EXE");
    fs::write(&source, "kept").unwrap();
    let wide: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    assert_ne!(
        unsafe { SetFileAttributesW(wide.as_ptr(), FILE_ATTRIBUTE_HIDDEN) },
        0
    );
    let entry = crate::filesystem::file_entry_from_path(&source, false).unwrap();
    assert!(entry.is_hidden);
    assert_eq!(entry.kind, crate::contracts::EntryKind::Executable);
    let lock = fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&source)
        .unwrap();
    let error = mutation::rename_no_replace(&source, &f.0.join("moved.exe")).unwrap_err();
    assert_eq!(
        crate::filesystem::map_io_error(error, Some(&source)).code,
        "file_in_use"
    );
    drop(lock);
    assert!(source.exists());
    let target = f.0.join("copies");
    fs::create_dir(&target).unwrap();
    crate::operation::start_copy(
        None,
        vec![source.to_string_lossy().into_owned()],
        target.to_string_lossy().into_owned(),
        crate::contracts::ConflictDecision::Skip,
    )
    .unwrap();
    let copied =
        crate::filesystem::file_entry_from_path(&target.join("hidden.EXE"), false).unwrap();
    assert!(copied.is_hidden);
    assert_eq!(fs::read(target.join("hidden.EXE")).unwrap(), b"kept");
}
#[test]
fn windows_settings_save_twice_and_contract() {
    let _guard = crate::tests::TEST_ENV_MUTEX.lock().unwrap();
    let f = Fixture::new();
    std::env::set_var("BOKSLDIRGUI_SETTINGS_PATH", f.0.join("settings.json"));
    commands::save_settings(serde_json::json!({"language":"en"})).unwrap();
    commands::save_settings(serde_json::json!({"language":"ko"})).unwrap();
    assert_eq!(
        serde_json::to_value(commands::load_settings().unwrap()).unwrap()["language"],
        "ko"
    );
    std::env::remove_var("BOKSLDIRGUI_SETTINGS_PATH");
    let info = serde_json::to_value(commands::get_platform_info()).unwrap();
    assert_eq!(info["os"], "windows");
    assert_eq!(info["features"]["trashUndo"], true);
}

#[test]
fn windows_junction_is_rejected_without_traversing_its_target() {
    let f = Fixture::new();
    fs::create_dir(f.0.join("target")).unwrap();
    fs::write(f.0.join("target/keep.txt"), "keep").unwrap();
    let status = std::process::Command::new("cmd.exe")
        .args(["/D", "/C", "mklink", "/J", "junction", "target"])
        .current_dir(&f.0)
        .status()
        .unwrap();
    assert!(status.success());
    let junction = f.0.join("junction");
    let metadata = fs::symlink_metadata(&junction).unwrap();
    assert_eq!(
        platform::validate_reparse_point(&junction, &metadata)
            .unwrap_err()
            .message_key,
        "errors.reparsePointUnsupported"
    );
    assert_eq!(
        fs::read_to_string(f.0.join("target/keep.txt")).unwrap(),
        "keep"
    );
    fs::remove_dir(&junction).unwrap();
}

#[test]
fn windows_identity_detects_replaced_entry_and_rejects_device_or_ads_paths() {
    let f = Fixture::new();
    let file = f.0.join("original.txt");
    fs::write(&file, "same").unwrap();
    let first = platform::entry_identity(&file).unwrap();
    fs::rename(&file, f.0.join("previous.txt")).unwrap();
    fs::write(&file, "same").unwrap();
    assert_ne!(first, platform::entry_identity(&file).unwrap());
    for path in [
        r"C:relative",
        r"\\.\PhysicalDrive0",
        r"C:\file.txt:stream",
        r"\\?\GLOBALROOT\Device\HarddiskVolume1",
    ] {
        assert!(platform::validate_path_input(std::path::Path::new(path)).is_err());
    }
}

#[test]
fn windows_mutations_reject_ads_before_resolving_parent() {
    let f = Fixture::new();
    let file = f.0.join("original.txt");
    fs::write(&file, "keep").unwrap();
    let ads = format!("{}:stream", file.display());
    assert_eq!(
        mutation::rename_entry(&ads, "renamed.txt")
            .unwrap_err()
            .code,
        "invalid_path"
    );
    let rules = crate::bulk_rename::RenameRules {
        find: String::new(),
        replacement: String::new(),
        prefix: "new-".into(),
        numbering: false,
        start: 1,
        padding: 1,
        preserve_extension: true,
    };
    assert_eq!(
        crate::bulk_rename::preview(vec![ads.clone()], rules)
            .unwrap_err()
            .code,
        "invalid_path"
    );
    assert_eq!(fs::read_to_string(file).unwrap(), "keep");
}

#[test]
#[ignore = "Windows 개발자 모드 또는 심볼릭 링크 생성 권한 필요: 전용 실행 검증"]
fn windows_symlink_policy_preserves_link_identity() {
    use std::os::windows::fs::{symlink_dir, symlink_file};
    let f = Fixture::new();
    fs::create_dir(f.0.join("target")).unwrap();
    fs::write(f.0.join("target/keep.txt"), "keep").unwrap();
    let directory_link = f.0.join("directory-link");
    symlink_dir(f.0.join("target"), &directory_link).unwrap();
    let file_link = f.0.join("file-link");
    symlink_file(f.0.join("target/keep.txt"), &file_link).unwrap();
    for link in [&directory_link, &file_link] {
        platform::validate_reparse_point(link, &fs::symlink_metadata(link).unwrap()).unwrap();
    }
    let target = f.0.join("copies");
    fs::create_dir(&target).unwrap();
    let paths = vec![
        directory_link.to_string_lossy().into_owned(),
        file_link.to_string_lossy().into_owned(),
    ];
    crate::operation::start_copy(
        None,
        paths.clone(),
        target.to_string_lossy().into_owned(),
        crate::contracts::ConflictDecision::Skip,
    )
    .unwrap();
    assert_eq!(
        fs::read_link(target.join("directory-link")).unwrap(),
        fs::read_link(&directory_link).unwrap()
    );
    assert_eq!(
        fs::read_link(target.join("file-link")).unwrap(),
        fs::read_link(&file_link).unwrap()
    );
    crate::operation::start_delete(
        None,
        paths,
        crate::contracts::DeleteMode::Permanent,
        Some("PERMANENT_DELETE"),
    )
    .unwrap();
    assert!(!directory_link.exists());
    assert!(!file_link.exists());
    assert_eq!(
        fs::read_to_string(f.0.join("target/keep.txt")).unwrap(),
        "keep"
    );
}

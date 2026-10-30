#[cfg(not(any(target_os = "macos", windows)))]
use crate::contracts::AppError;
use crate::contracts::{ClipboardIntent, CommandResult, FileClipboard};


#[cfg(windows)]
#[path = "file_clipboard/windows.rs"]
mod native_windows;
#[cfg(any(windows, test))]
#[path = "file_clipboard/windows_format.rs"]
mod windows_format;


#[cfg(target_os = "macos")]
mod native {
    use super::FileClipboard;
    use crate::contracts::{AppError, CommandResult};
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};
    use std::path::Path;

    // General NSPasteboard is shared with WebKit. A worker-side mutex cannot
    // synchronize WebKit's access, so all native access must run on the UI thread.
    pub(super) fn with_general<T: Send + 'static>(
        app: &tauri::AppHandle,
        action: impl FnOnce(&NSPasteboard) -> CommandResult<T> + Send + 'static,
    ) -> CommandResult<T> {
        if objc2::MainThreadMarker::new().is_some() {
            return access_general(action);
        }
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        app.run_on_main_thread(move || {
            let _ = sender.send(access_general(action));
        }).map_err(|_| changed())?;
        // Called by the command's blocking worker, never by the UI thread.
        receiver.recv().map_err(|_| changed())?
    }

    fn access_general<T>(action: impl FnOnce(&NSPasteboard) -> CommandResult<T>) -> CommandResult<T> {
        // Fail safely if a future caller bypasses the main-thread dispatcher.
        let _main_thread = objc2::MainThreadMarker::new().ok_or_else(changed)?;
        objc2::rc::autoreleasepool(|_| action(&NSPasteboard::generalPasteboard()))
    }

    pub(super) fn read(board: &NSPasteboard) -> CommandResult<FileClipboard> {
        let version = board.changeCount() as i64;
        let mut paths = Vec::new();
        if let Some(items) = board.pasteboardItems() {
            for item in items {
                let Some(value) = item.stringForType(&NSString::from_str("public.file-url")) else {
                    continue;
                };
                let Some(url) = NSURL::URLWithString(&value) else {
                    continue;
                };
                if url.host().is_some_and(|host| {
                    !host.to_string().is_empty() && host.to_string() != "localhost"
                }) {
                    continue;
                }
                if !url.isFileURL() {
                    continue;
                }
                let Some(path) = url.path() else { continue };
                let path = path.to_string();
                if Path::new(&path).is_absolute() && !path.contains('\0') && !paths.contains(&path)
                {
                    paths.push(path);
                }
            }
        }
        if board.changeCount() as i64 != version {
            return Err(changed());
        }
        Ok(FileClipboard {
            intent: super::ClipboardIntent::Copy,
            change_count: version,
            paths,
            entries: Vec::new(),
        })
    }

    pub(super) fn validate_paths(paths: &[String]) -> CommandResult<()> {
        if paths.is_empty() {
            return Err(changed());
        }
        // 모든 경로 확인 후에만 기존 클립보드 교체. 링크 자체를 보존하기 위해 대상 canonicalize 금지.
        for path in paths {
            let raw = Path::new(&path);
            if !raw.is_absolute() || path.contains('\0') {
                return Err(AppError::new(
                    "invalid_path",
                    "errors.invalidPath",
                    Some(raw),
                    true,
                ));
            }
            std::fs::symlink_metadata(raw)
                .map_err(|e| crate::filesystem::map_io_error(e, Some(raw)))?;
        }
        Ok(())
    }

    pub(super) fn write(board: &NSPasteboard, paths: Vec<String>) -> CommandResult<i64> {
        let mut items = Vec::new();
        for path in paths {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            let item = NSPasteboardItem::new();
            let value = url.absoluteString().ok_or_else(changed)?;
            if !item.setString_forType(&value, &NSString::from_str("public.file-url")) {
                return Err(changed());
            }
            items.push(item);
        }
        let objects: Vec<&ProtocolObject<dyn NSPasteboardWriting>> = items
            .iter()
            .map(|item| ProtocolObject::from_ref(&**item))
            .collect();
        board.clearContents();
        if !board.writeObjects(&NSArray::from_slice(&objects)) {
            return Err(changed());
        }
        Ok(board.changeCount() as i64)
    }

    pub(super) fn clear(board: &NSPasteboard, version: i64) {
        // 완료 뒤 사용자가 새로 복사한 자료는 지우지 않음.
        if board.changeCount() as i64 == version {
            board.clearContents();
        }
    }

    pub(super) fn changed() -> AppError {
        AppError::new(
            "clipboard_changed",
            "errors.fileClipboardChanged",
            None,
            true,
        )
    }

    #[test]
    fn general_clipboard_rejects_worker_access_before_touching_appkit() {
        std::thread::scope(|scope| {
            let workers: Vec<_> = (0..8).map(|_| scope.spawn(|| {
                let result = access_general(|_| -> CommandResult<()> {
                    panic!("general pasteboard must not be accessed on a worker");
                });
                assert!(result.is_err());
            })).collect();
            for worker in workers { worker.join().unwrap(); }
        });
    }

    #[test]
    fn file_urls_round_trip_without_touching_the_general_clipboard() {
        objc2::rc::autoreleasepool(|_| {
            let board = NSPasteboard::pasteboardWithName(&NSString::from_str(&format!(
                "BokslDir.tests.{}",
                std::process::id()
            )));
            let temp = crate::test_util::TempDir::new("clipboard");
            let dir = temp.path().to_path_buf();
            let file = dir.join("한글 space # %.json");
            std::fs::write(&file, "{}").unwrap();
            let link = dir.join("link.json");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            let paths = vec![
                file.to_string_lossy().into_owned(),
                link.to_string_lossy().into_owned(),
                dir.to_string_lossy().into_owned(),
            ];
            validate_paths(&paths).unwrap();
            let version = write(&board, paths.clone()).unwrap();
            let mut result = read(&board).unwrap();
            super::resolve_entries(&mut result).unwrap();
            assert_eq!(result.paths.len(), paths.len());
            assert_eq!(std::fs::read(&result.paths[0]).unwrap(), b"{}");
            assert_eq!(result.entries.len(), 3);
            assert_eq!(result.entries[1].path, paths[1]);
            board.clearContents();
            board.setString_forType(
                &NSString::from_str("plain text"),
                &NSString::from_str("public.utf8-plain-text"),
            );
            clear(&board, version);
            assert_eq!(
                board
                    .stringForType(&NSString::from_str("public.utf8-plain-text"))
                    .unwrap()
                    .to_string(),
                "plain text"
            );
            assert!(read(&board).unwrap().paths.is_empty());
            write(&board, paths).unwrap();
            std::fs::remove_file(&file).unwrap();
            assert!(super::resolve_entries(&mut read(&board).unwrap()).is_err());
            board.clearContents();
        });
    }
}

#[cfg(target_os = "macos")]
fn resolve_entries(clipboard: &mut FileClipboard) -> CommandResult<()> {
    clipboard.entries = clipboard.paths.iter()
        .map(|path| crate::filesystem::file_entry_from_path(std::path::Path::new(path), false))
        .collect::<CommandResult<Vec<_>>>()?;
    Ok(())
}

pub(crate) fn read(_app: &tauri::AppHandle, resolve: bool) -> CommandResult<FileClipboard> {
    #[cfg(target_os = "macos")]
    {
        let mut clipboard = native::with_general(_app, native::read)?;
        if resolve {
            // Filesystem access may block on network volumes; keep it off the UI thread.
            resolve_entries(&mut clipboard)?;
            let version = native::with_general(_app, |board| Ok(board.changeCount() as i64))?;
            if version != clipboard.change_count { return Err(native::changed()); }
        }
        Ok(clipboard)
    }
    #[cfg(windows)]
    {
        native_windows::read(resolve)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = resolve;
        Err(unsupported())
    }
}
pub(crate) fn write(_app: &tauri::AppHandle, paths: Vec<String>, intent: ClipboardIntent) -> CommandResult<i64> {
    #[cfg(target_os = "macos")]
    {
        let _ = intent; // Finder exposes copy; the app owns its Move Here intent.
        native::validate_paths(&paths)?;
        native::with_general(_app, move |board| native::write(board, paths))
    }
    #[cfg(windows)]
    {
        native_windows::write(paths, intent)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = (paths, intent);
        Err(unsupported())
    }
}
pub(crate) fn clear(_app: &tauri::AppHandle, change_count: i64) -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        native::with_general(_app, move |board| {
            native::clear(board, change_count);
            Ok(())
        })
    }
    #[cfg(windows)]
    {
        native_windows::clear(change_count)
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        let _ = change_count;
        Err(unsupported())
    }
}
#[cfg(not(any(target_os = "macos", windows)))]
fn unsupported() -> AppError {
    AppError::new("unsupported", "errors.commandNotImplemented", None, true)
}

#[test]
fn native_clipboard_contract_preserves_intent_and_windows_paths() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../src/tauri/fixtures/contract.json")).unwrap();
    let value = FileClipboard {
        change_count: 42,
        intent: ClipboardIntent::Move,
        paths: vec![r"C:\fixture\한글 space.txt".to_owned()],
        entries: vec![],
    };
    assert_eq!(
        serde_json::to_value(value).unwrap(),
        fixture["fileClipboard"]
    );
}

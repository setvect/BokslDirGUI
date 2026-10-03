#[cfg(not(target_os = "macos"))]
use crate::contracts::AppError;
use crate::contracts::{CommandResult, FileEntry};
use serde::Serialize;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct FileClipboard {
    change_count: i64,
    paths: Vec<String>,
    entries: Vec<FileEntry>,
}

#[cfg(target_os = "macos")]
mod native {
    use super::FileClipboard;
    use crate::contracts::{AppError, CommandResult};
    use objc2::runtime::ProtocolObject;
    use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardWriting};
    use objc2_foundation::{NSArray, NSString, NSURL};
    use std::path::Path;

    pub(super) fn read(board: &NSPasteboard, resolve: bool) -> CommandResult<FileClipboard> {
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
        let entries = if resolve {
            paths
                .iter()
                .map(|path| crate::filesystem::file_entry_from_path(Path::new(path), false))
                .collect::<CommandResult<Vec<_>>>()?
        } else {
            Vec::new()
        };
        if board.changeCount() as i64 != version {
            return Err(changed());
        }
        Ok(FileClipboard {
            change_count: version,
            paths,
            entries,
        })
    }

    pub(super) fn write(board: &NSPasteboard, paths: Vec<String>) -> CommandResult<i64> {
        if paths.is_empty() {
            return Err(changed());
        }
        // 모든 경로 확인 후에만 기존 클립보드 교체. 링크 자체를 보존하기 위해 대상 canonicalize 금지.
        let mut items = Vec::new();
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

    fn changed() -> AppError {
        AppError::new(
            "clipboard_changed",
            "errors.fileClipboardChanged",
            None,
            true,
        )
    }

    #[test]
    fn file_urls_round_trip_without_touching_the_general_clipboard() {
        objc2::rc::autoreleasepool(|_| {
            let board = NSPasteboard::pasteboardWithName(&NSString::from_str(&format!(
                "BokslDir.tests.{}",
                std::process::id()
            )));
            let dir =
                std::env::temp_dir().join(format!("boksldir-clipboard-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let file = dir.join("한글 space # %.json");
            std::fs::write(&file, "{}").unwrap();
            let link = dir.join("link.json");
            std::os::unix::fs::symlink(&file, &link).unwrap();
            let paths = vec![
                file.to_string_lossy().into_owned(),
                link.to_string_lossy().into_owned(),
                dir.to_string_lossy().into_owned(),
            ];
            let version = write(&board, paths.clone()).unwrap();
            let result = read(&board, true).unwrap();
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
            assert!(read(&board, true).unwrap().paths.is_empty());
            write(&board, paths).unwrap();
            std::fs::remove_file(&file).unwrap();
            assert!(read(&board, true).is_err());
            board.clearContents();
            std::fs::remove_dir_all(dir).unwrap();
        });
    }
}

pub(crate) fn read(resolve: bool) -> CommandResult<FileClipboard> {
    #[cfg(target_os = "macos")]
    {
        objc2::rc::autoreleasepool(|_| {
            native::read(&objc2_app_kit::NSPasteboard::generalPasteboard(), resolve)
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = resolve;
        Err(unsupported())
    }
}
pub(crate) fn write(paths: Vec<String>) -> CommandResult<i64> {
    #[cfg(target_os = "macos")]
    {
        objc2::rc::autoreleasepool(|_| {
            native::write(&objc2_app_kit::NSPasteboard::generalPasteboard(), paths)
        })
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = paths;
        Err(unsupported())
    }
}
pub(crate) fn clear(change_count: i64) -> CommandResult<()> {
    #[cfg(target_os = "macos")]
    {
        objc2::rc::autoreleasepool(|_| {
            native::clear(
                &objc2_app_kit::NSPasteboard::generalPasteboard(),
                change_count,
            )
        });
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = change_count;
        Err(unsupported())
    }
}
#[cfg(not(target_os = "macos"))]
fn unsupported() -> AppError {
    AppError::new("unsupported", "errors.commandNotImplemented", None, true)
}

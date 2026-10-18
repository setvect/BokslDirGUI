use super::{windows_format as format, ClipboardIntent, FileClipboard};
use crate::contracts::{AppError, CommandResult};
use std::path::Path;
use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL, HWND};
use windows::Win32::Globalization::{MultiByteToWideChar, CP_ACP, MB_ERR_INVALID_CHARS};
use windows::Win32::System::DataExchange::*;
use windows::Win32::System::Memory::{
    GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DestroyWindow, HWND_MESSAGE, WINDOW_EX_STYLE, WINDOW_STYLE,
};

const CF_HDROP: u32 = 15;
fn io(error: windows::core::Error) -> AppError {
    AppError::new("clipboard_unavailable", "errors.io", None, true)
        .with_detail("hresult", format!("{:08X}", error.code().0 as u32))
}
fn changed() -> AppError {
    AppError::new(
        "clipboard_changed",
        "errors.fileClipboardChanged",
        None,
        true,
    )
}
struct Owner(HWND);
impl Owner {
    fn new() -> CommandResult<Self> {
        unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!("BokslDir clipboard"),
                WINDOW_STYLE(0),
                0,
                0,
                0,
                0,
                Some(HWND_MESSAGE),
                None,
                None,
                None,
            )
        }
        .map(Self)
        .map_err(io)
    }
}
impl Drop for Owner {
    fn drop(&mut self) {
        let _ = unsafe { DestroyWindow(self.0) };
    }
}
struct Open;
impl Open {
    fn new(owner: &Owner) -> CommandResult<Self> {
        // Other desktop applications may briefly hold the clipboard; never wait indefinitely.
        for attempt in 0..5 {
            match unsafe { OpenClipboard(Some(owner.0)) } {
                Ok(()) => return Ok(Self),
                Err(error) if attempt == 4 => return Err(io(error)),
                _ => std::thread::sleep(std::time::Duration::from_millis(10)),
            }
        }
        unreachable!()
    }
}
impl Drop for Open {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}
struct Block(HGLOBAL);
impl Block {
    fn new(bytes: &[u8]) -> CommandResult<Self> {
        let block =
            Self(unsafe { GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, bytes.len()) }.map_err(io)?);
        let pointer = unsafe { GlobalLock(block.0) };
        if pointer.is_null() {
            return Err(io(windows::core::Error::from_win32()));
        }
        unsafe {
            std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer.cast(), bytes.len());
            let _ = GlobalUnlock(block.0);
        }
        Ok(block)
    }
    fn publish(self, kind: u32) -> CommandResult<()> {
        unsafe { SetClipboardData(kind, Some(HANDLE(self.0 .0))) }.map_err(io)?;
        std::mem::forget(self); // Clipboard owns the allocation only after success.
        Ok(())
    }
}
impl Drop for Block {
    fn drop(&mut self) {
        let _ = unsafe { GlobalFree(Some(self.0)) };
    }
}
// Caller must keep Open alive; borrowed clipboard handles are never freed by this process.
fn data(kind: u32) -> CommandResult<Option<Vec<u8>>> {
    if unsafe { IsClipboardFormatAvailable(kind) }.is_err() {
        return Ok(None);
    }
    let handle = HGLOBAL(unsafe { GetClipboardData(kind) }.map_err(io)?.0);
    let length = unsafe { GlobalSize(handle) };
    if length == 0 || length > format::MAX_BYTES {
        return Err(format::invalid());
    }
    let pointer = unsafe { GlobalLock(handle) };
    if pointer.is_null() {
        return Err(io(windows::core::Error::from_win32()));
    }
    let bytes = unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), length).to_vec() };
    let _ = unsafe { GlobalUnlock(handle) };
    Ok(Some(bytes))
}
fn effect_format() -> CommandResult<u32> {
    let kind = unsafe { RegisterClipboardFormatW(w!("Preferred DropEffect")) };
    if kind == 0 {
        Err(io(windows::core::Error::from_win32()))
    } else {
        Ok(kind)
    }
}
fn ansi(bytes: &[u8]) -> CommandResult<String> {
    let mut wide = vec![0u16; bytes.len()];
    let count =
        unsafe { MultiByteToWideChar(CP_ACP, MB_ERR_INVALID_CHARS, bytes, Some(&mut wide)) };
    if count == 0 {
        return Err(format::invalid());
    }
    String::from_utf16(&wide[..count as usize]).map_err(|_| format::invalid())
}
fn sequence() -> CommandResult<i64> {
    match unsafe { GetClipboardSequenceNumber() } {
        0 => Err(changed()),
        value => Ok(i64::from(value)),
    }
}
fn validate(paths: &[String]) -> CommandResult<()> {
    for path in paths {
        if !Path::new(path).is_absolute() || path.contains('\0') {
            return Err(format::invalid());
        }
    }
    Ok(())
}

pub(super) fn read(resolve: bool) -> CommandResult<FileClipboard> {
    let owner = Owner::new()?;
    let open = Open::new(&owner)?;
    let mut paths = match data(CF_HDROP)? {
        Some(bytes) => format::decode(&bytes, ansi)?,
        None => Vec::new(),
    };
    validate(&paths)?;
    let mut seen = std::collections::HashSet::new();
    paths.retain(|path| seen.insert(path.clone()));
    let intent = if paths.is_empty() {
        ClipboardIntent::Copy
    } else {
        format::intent(data(effect_format()?)?.as_deref())?
    };
    // Delayed rendering can change the sequence; capture it after all formats are materialized.
    let version = sequence()?;
    drop(open);
    let entries = if resolve {
        paths
            .iter()
            .map(|path| crate::filesystem::file_entry_from_path(Path::new(path), false))
            .collect::<CommandResult<Vec<_>>>()?
    } else {
        Vec::new()
    };
    if sequence()? != version {
        return Err(changed());
    }
    Ok(FileClipboard {
        change_count: version,
        paths,
        entries,
        intent,
    })
}

pub(super) fn write(paths: Vec<String>, intent: ClipboardIntent) -> CommandResult<i64> {
    validate(&paths)?;
    for path in &paths {
        std::fs::symlink_metadata(path)
            .map_err(|error| crate::filesystem::map_io_error(error, Some(Path::new(path))))?;
    }
    // Validate and allocate both formats before replacing the current clipboard.
    let paths: Vec<String> = paths
        .iter()
        .map(|path| {
            crate::windows_shell::compatible_path(Path::new(path))
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    let files = Block::new(&format::encode(&paths)?)?;
    let effect = Block::new(
        &(if intent == ClipboardIntent::Move {
            2u32
        } else {
            1u32
        })
        .to_le_bytes(),
    )?;
    let kind = effect_format()?;
    let owner = Owner::new()?;
    let _open = Open::new(&owner)?;
    unsafe { EmptyClipboard() }.map_err(io)?;
    let result = effect.publish(kind).and_then(|_| files.publish(CF_HDROP));
    if let Err(error) = result {
        let _ = unsafe { EmptyClipboard() }; // Do not expose an incomplete copy/move pair.
        return Err(error);
    }
    sequence()
}

pub(super) fn clear(version: i64) -> CommandResult<()> {
    let owner = Owner::new()?;
    let _open = Open::new(&owner)?;
    if sequence()? == version {
        unsafe { EmptyClipboard() }.map_err(io)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{clear, read, write, ClipboardIntent};
    #[test]
    #[ignore = "실제 시스템 클립보드 교체: 폐기 가능한 Windows 테스트 세션에서 명시 실행"]
    fn native_file_clipboard_round_trip_and_stale_clear() {
        let root = std::env::temp_dir().join(format!("boksldir-clipboard-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("한글 space # % 📁.txt");
        std::fs::write(&file, b"clipboard fixture").unwrap();
        let paths = vec![
            file.to_string_lossy().into_owned(),
            root.to_string_lossy().into_owned(),
        ];
        // The app supplies canonical verbatim paths; Explorer requires ordinary spellings.
        let canonical = paths
            .iter()
            .map(|path| std::fs::canonicalize(path).unwrap().to_string_lossy().into_owned())
            .collect();
        let copied = write(canonical, ClipboardIntent::Copy).unwrap();
        let data = read(true).unwrap();
        assert_eq!(data.paths, paths);
        assert_eq!(data.entries.len(), 2);
        assert_eq!(data.intent, ClipboardIntent::Copy);
        assert_eq!(data.change_count, copied);
        let cut = write(paths.clone(), ClipboardIntent::Move).unwrap();
        assert_ne!(cut, copied);
        clear(copied).unwrap();
        assert_eq!(read(false).unwrap().intent, ClipboardIntent::Move);
        assert!(write(vec![r"relative\missing".into()], ClipboardIntent::Copy).is_err());
        assert_eq!(read(false).unwrap().change_count, cut);
        std::fs::remove_file(&file).unwrap();
        assert!(read(true).is_err());
        clear(cut).unwrap();
        assert!(read(false).unwrap().paths.is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}

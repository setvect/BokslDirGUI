//! Shell COM objects stay on one initialized apartment, including their destruction.
use crate::contracts::{AppError, CommandResult};
use std::os::windows::ffi::OsStrExt;
use std::path::Path;
use windows::core::{HSTRING, PCWSTR, PWSTR};
use windows::Win32::System::Com::{
    CoInitializeEx, CoTaskMemFree, CoUninitialize, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{
    Common::ITEMIDLIST, IShellItem, SHCreateItemFromParsingName, SHGetIDListFromObject,
    SHOpenFolderAndSelectItems, ShellExecuteExW, SEE_MASK_CLASSNAME, SEE_MASK_FLAG_NO_UI,
    SEE_MASK_IDLIST, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
};
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

pub(crate) fn error(error: windows::core::Error, path: Option<&Path>) -> AppError {
    AppError::new(
        "external_failed",
        "errors.externalCommandFailed",
        path,
        true,
    )
    .with_detail("hresult", format!("{:08X}", error.code().0 as u32))
}

pub(crate) fn run_sta<T: Send + 'static>(
    task: impl FnOnce() -> CommandResult<T> + Send + 'static,
) -> CommandResult<T> {
    std::thread::spawn(move || {
        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|e| error(e, None))?;
        struct Apartment;
        impl Drop for Apartment {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }
        let _apartment = Apartment;
        task()
    })
    .join()
    .map_err(|_| {
        AppError::new(
            "external_failed",
            "errors.externalCommandFailed",
            None,
            true,
        )
    })?
}

pub(crate) fn item(path: &Path) -> windows::core::Result<IShellItem> {
    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe { SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None) }
}

pub(crate) unsafe fn take_string(value: PWSTR) -> windows::core::Result<String> {
    let result = value.to_string();
    CoTaskMemFree(Some(value.0.cast()));
    Ok(result?)
}

struct ItemId(*mut ITEMIDLIST);
impl Drop for ItemId {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0.cast())) };
    }
}

pub(crate) fn open_item(path: &Path, reveal: bool) -> windows::core::Result<()> {
    open_association(path, reveal, None)
}

pub(crate) fn open_association(
    path: &Path,
    reveal: bool,
    association: Option<&str>,
) -> windows::core::Result<()> {
    let shell_item = item(path)?;
    let id = ItemId(unsafe { SHGetIDListFromObject(&shell_item)? });
    // A single absolute PIDL selects the item in its parent. No Explorer command-line parsing.
    if reveal {
        unsafe { SHOpenFolderAndSelectItems(id.0, None, 0) }
    } else {
        let association = association.map(HSTRING::from);
        let mut info = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            fMask: SEE_MASK_IDLIST | SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpIDList: id.0.cast(),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        if let Some(association) = &association {
            info.fMask |= SEE_MASK_CLASSNAME;
            info.lpClass = PCWSTR(association.as_ptr());
        }
        unsafe { ShellExecuteExW(&mut info) }
    }
}

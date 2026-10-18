//! Windows Recycle Bin receipts use Shell item IDs; never rename $Recycle.Bin files directly.
use super::{Identity, Receipt, TrashDestination};
use crate::contracts::{AppError, CommandResult};
use crate::operation::runtime::check_cancelled;
use crate::windows_shell;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use windows::core::{implement, Ref, HRESULT, PCWSTR};
use windows::Win32::Foundation::{E_ABORT, E_FAIL};
use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER};
use windows::Win32::UI::Shell::{
    Common::ITEMIDLIST, FileOperation, IFileOperation, IFileOperationProgressSink,
    IFileOperationProgressSink_Impl, ILGetSize, IShellItem, SHCreateItemFromIDList,
    SHGetIDListFromObject, FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_ALLOWUNDO,
    FOF_NO_CONNECTED_ELEMENTS, FOF_NO_UI, FOF_RENAMEONCOLLISION, FOF_WANTNUKEWARNING,
    SIGDN_FILESYSPATH, TSF_DELETE_RECYCLE_IF_POSSIBLE, TSF_OVERWRITE_EXIST,
};

fn error(value: windows::core::Error, path: &Path) -> AppError {
    // Preserve the common not-found / access / collision error policy for Win32 HRESULTs.
    let hr = value.code().0 as u32;
    if (hr >> 16) & 0x1fff == 7 {
        return crate::filesystem::map_io_error(
            std::io::Error::from_raw_os_error((hr & 0xffff) as i32),
            Some(path),
        );
    }
    AppError::new("trash_failed", "errors.trashFailed", Some(path), true)
        .with_detail("hresult", format!("{hr:08X}"))
}
fn failed(path: &Path) -> AppError {
    AppError::new("trash_failed", "errors.trashFailed", Some(path), true)
}
fn item_path(item: &IShellItem) -> windows::core::Result<PathBuf> {
    unsafe { windows_shell::take_string(item.GetDisplayName(SIGDN_FILESYSPATH)?) }
        .map(PathBuf::from)
}
struct ItemId(*mut ITEMIDLIST);
impl Drop for ItemId {
    fn drop(&mut self) {
        unsafe { CoTaskMemFree(Some(self.0.cast())) };
    }
}
fn item_id(item: &IShellItem) -> windows::core::Result<Vec<u8>> {
    let id = ItemId(unsafe { SHGetIDListFromObject(item)? });
    let size = unsafe { ILGetSize(Some(id.0)) } as usize;
    if !(2..=1024 * 1024).contains(&size) {
        return Err(E_FAIL.into());
    }
    Ok(unsafe { std::slice::from_raw_parts(id.0.cast::<u8>(), size).to_vec() })
}
#[derive(Clone)]
enum Mode {
    Trash { source: PathBuf, identity: Identity },
    Restore(Receipt),
}
impl Mode {
    fn source(&self) -> &Path {
        match self {
            Self::Trash { source, .. } => source,
            Self::Restore(receipt) => &receipt.trashed,
        }
    }
}
#[derive(Default)]
struct Outcome {
    destination: Option<TrashDestination>,
    error: Option<AppError>,
}
#[implement(IFileOperationProgressSink)]
struct Sink {
    operation_id: String,
    mode: Mode,
    outcome: Arc<Mutex<Outcome>>,
}
impl Sink_Impl {
    fn reject(&self, error: AppError) -> windows::core::Result<()> {
        self.outcome.lock().unwrap().error.get_or_insert(error);
        Err(E_ABORT.into())
    }
    fn cancelled(&self) -> windows::core::Result<()> {
        match check_cancelled(&self.operation_id, self.mode.source()) {
            Ok(()) => Ok(()),
            Err(error) => self.reject(error),
        }
    }
    fn record(
        &self,
        result: HRESULT,
        item: Ref<'_, IShellItem>,
        recycled: bool,
    ) -> windows::core::Result<()> {
        if let Err(e) = result.ok() {
            return self.reject(error(e, self.mode.source()));
        }
        let destination = (|| {
            let item = item.ok()?;
            let path = item_path(item)?;
            let recycle_id = if recycled { Some(item_id(item)?) } else { None };
            Ok::<_, windows::core::Error>(TrashDestination { path, recycle_id })
        })();
        match destination {
            Ok(value) => {
                self.outcome.lock().unwrap().destination = Some(value);
                Ok(())
            }
            Err(e) => self.reject(error(e, self.mode.source())),
        }
    }
}
#[allow(non_snake_case)]
impl IFileOperationProgressSink_Impl for Sink_Impl {
    fn StartOperations(&self) -> windows::core::Result<()> {
        self.cancelled()
    }
    fn FinishOperations(&self, result: HRESULT) -> windows::core::Result<()> {
        if let Err(e) = result.ok() {
            return self.reject(error(e, self.mode.source()));
        }
        Ok(())
    }
    fn PreDeleteItem(&self, flags: u32, item: Ref<'_, IShellItem>) -> windows::core::Result<()> {
        self.cancelled()?;
        let Mode::Trash { source, identity } = &self.mode else {
            return self.reject(failed(self.mode.source()));
        };
        // An irreversible delete must never be a fallback for a trash request.
        if flags & TSF_DELETE_RECYCLE_IF_POSSIBLE.0 as u32 == 0 {
            return self.reject(AppError::new(
                "trash_unavailable",
                "errors.trashFailed",
                Some(source),
                true,
            ));
        }
        let checked = (|| {
            let actual = item_path(item.ok().map_err(|e| error(e, source))?)
                .map_err(|e| error(e, source))?;
            if Identity::read(source)? != *identity || Identity::read(&actual)? != *identity {
                return Err(AppError::new(
                    "source_changed",
                    "errors.trashUndoChanged",
                    Some(source),
                    true,
                ));
            }
            Ok(())
        })();
        match checked {
            Ok(()) => Ok(()),
            Err(e) => self.reject(e),
        }
    }
    fn PostDeleteItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        result: HRESULT,
        item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        self.record(result, item, true)
    }
    fn PreMoveItem(
        &self,
        flags: u32,
        item: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
    ) -> windows::core::Result<()> {
        self.cancelled()?;
        let Mode::Restore(receipt) = &self.mode else {
            return self.reject(failed(self.mode.source()));
        };
        if flags & TSF_OVERWRITE_EXIST.0 as u32 != 0 {
            return self.reject(failed(Path::new(&receipt.entry.path)));
        }
        let checked = (|| {
            super::validate_restore(receipt)?;
            let actual = item_path(item.ok().map_err(|e| error(e, &receipt.trashed))?)
                .map_err(|e| error(e, &receipt.trashed))?;
            if Identity::read(&actual)? != receipt.identity {
                return Err(failed(&actual));
            }
            Ok(())
        })();
        match checked {
            Ok(()) => Ok(()),
            Err(e) => self.reject(e),
        }
    }
    fn PostMoveItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        result: HRESULT,
        item: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        self.record(result, item, false)
    }
    fn PreRenameItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostRenameItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreCopyItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
    ) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostCopyItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn PreNewItem(&self, _: u32, _: Ref<'_, IShellItem>, _: &PCWSTR) -> windows::core::Result<()> {
        Err(E_ABORT.into())
    }
    fn PostNewItem(
        &self,
        _: u32,
        _: Ref<'_, IShellItem>,
        _: &PCWSTR,
        _: &PCWSTR,
        _: u32,
        _: HRESULT,
        _: Ref<'_, IShellItem>,
    ) -> windows::core::Result<()> {
        Ok(())
    }
    fn UpdateProgress(&self, _: u32, _: u32) -> windows::core::Result<()> {
        self.cancelled()
    }
    fn ResetTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn PauseTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
    fn ResumeTimer(&self) -> windows::core::Result<()> {
        Ok(())
    }
}
struct Subscription {
    operation: IFileOperation,
    cookie: u32,
}
impl Drop for Subscription {
    fn drop(&mut self) {
        let _ = unsafe { self.operation.Unadvise(self.cookie) };
    }
}
fn perform(mode: Mode, operation_id: String) -> CommandResult<TrashDestination> {
    let outcome = Arc::new(Mutex::new(Outcome::default()));
    let sink: IFileOperationProgressSink = Sink {
        operation_id: operation_id.clone(),
        mode: mode.clone(),
        outcome: Arc::clone(&outcome),
    }
    .into();
    let operation: IFileOperation =
        unsafe { CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER) }
            .map_err(|e| error(e, mode.source()))?;
    let cookie = unsafe { operation.Advise(&sink) }.map_err(|e| error(e, mode.source()))?;
    let _subscription = Subscription {
        operation: operation.clone(),
        cookie,
    };
    let common = FOF_NO_UI | FOFX_EARLYFAILURE | FOF_NO_CONNECTED_ELEMENTS;
    unsafe {
        match &mode {
            Mode::Trash { source, .. } => {
                operation
                    .SetOperationFlags(
                        common | FOF_ALLOWUNDO | FOFX_RECYCLEONDELETE | FOF_WANTNUKEWARNING,
                    )
                    .map_err(|e| error(e, source))?;
                let item = windows_shell::item(source).map_err(|e| error(e, source))?;
                operation
                    .DeleteItem(&item, None)
                    .map_err(|e| error(e, source))?;
            }
            Mode::Restore(receipt) => {
                operation
                    .SetOperationFlags(common | FOF_RENAMEONCOLLISION)
                    .map_err(|e| error(e, &receipt.trashed))?;
                let id = receipt
                    .recycle_id
                    .as_ref()
                    .ok_or_else(|| failed(&receipt.trashed))?;
                let item: IShellItem = SHCreateItemFromIDList(id.as_ptr().cast())
                    .map_err(|e| error(e, &receipt.trashed))?;
                let parent =
                    windows_shell::item(&receipt.parent).map_err(|e| error(e, &receipt.parent))?;
                let name: Vec<u16> = receipt.entry.name.encode_utf16().chain(Some(0)).collect();
                operation
                    .MoveItem(&item, &parent, PCWSTR(name.as_ptr()), None)
                    .map_err(|e| error(e, &receipt.trashed))?;
            }
        }
        let performed = operation.PerformOperations();
        let aborted = operation.GetAnyOperationsAborted();
        let mut output = outcome.lock().unwrap();
        // Post callbacks report the actual mutation; retain its receipt even after a late cancel/error.
        if let Some(destination) = output.destination.take() {
            return Ok(destination);
        }
        if let Some(error) = output.error.take() {
            return Err(error);
        }
        check_cancelled(&operation_id, mode.source())?;
        performed.map_err(|e| error(e, mode.source()))?;
        if aborted.map_err(|e| error(e, mode.source()))?.as_bool() {
            return Err(failed(mode.source()));
        }
    }
    Err(failed(mode.source()))
}
pub(super) fn trash(
    source: &Path,
    operation_id: &str,
    identity: &Identity,
) -> CommandResult<TrashDestination> {
    let mode = Mode::Trash {
        source: source.to_owned(),
        identity: identity.clone(),
    };
    let operation_id = operation_id.to_owned();
    windows_shell::run_sta(move || perform(mode, operation_id))
}
pub(super) fn restore(receipt: &mut Receipt, operation_id: &str) -> CommandResult<()> {
    let mode = Mode::Restore(receipt.clone());
    let operation_id = operation_id.to_owned();
    let destination = windows_shell::run_sta(move || perform(mode, operation_id))?;
    super::accept_restored_location(receipt, destination.path)
}

#[cfg(test)]
pub(super) fn purge_fixture(receipt: &Receipt) -> CommandResult<()> {
    if !receipt.trashed.exists() {
        return Ok(());
    }
    if Identity::read(&receipt.trashed)? != receipt.identity {
        return Err(failed(&receipt.trashed));
    }
    let receipt = receipt.clone();
    windows_shell::run_sta(move || {
        let id = receipt
            .recycle_id
            .as_ref()
            .ok_or_else(|| failed(&receipt.trashed))?;
        unsafe {
            let item: IShellItem = SHCreateItemFromIDList(id.as_ptr().cast())
                .map_err(|e| error(e, &receipt.trashed))?;
            let operation: IFileOperation =
                CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER)
                    .map_err(|e| error(e, &receipt.trashed))?;
            operation
                .SetOperationFlags(FOF_NO_UI | FOFX_EARLYFAILURE | FOF_NO_CONNECTED_ELEMENTS)
                .map_err(|e| error(e, &receipt.trashed))?;
            operation
                .DeleteItem(&item, None)
                .map_err(|e| error(e, &receipt.trashed))?;
            operation
                .PerformOperations()
                .map_err(|e| error(e, &receipt.trashed))?;
            if operation
                .GetAnyOperationsAborted()
                .map_err(|e| error(e, &receipt.trashed))?
                .as_bool()
            {
                return Err(failed(&receipt.trashed));
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::{Identity, Mode, Outcome, Sink};
    use crate::contracts::OperationKind;
    use crate::operation::runtime::{
        cancel_operation, finish_operation, next_operation_id, register_operation,
    };
    use std::sync::{Arc, Mutex};
    use windows::Win32::UI::Shell::IFileOperationProgressSink;

    #[test]
    fn sink_rejects_permanent_delete_and_observes_cancellation_before_mutation() {
        let root = std::env::temp_dir().join(next_operation_id(OperationKind::Trash));
        std::fs::create_dir(&root).unwrap();
        let file = root.join("kept.txt");
        std::fs::write(&file, b"keep me").unwrap();
        let id = next_operation_id(OperationKind::Trash);
        let output = Arc::new(Mutex::new(Outcome::default()));
        let sink: IFileOperationProgressSink = Sink {
            operation_id: id.clone(),
            mode: Mode::Trash {
                source: file.clone(),
                identity: Identity::read(&file).unwrap(),
            },
            outcome: Arc::clone(&output),
        }
        .into();
        assert!(unsafe { sink.PreDeleteItem(0, None) }.is_err());
        assert_eq!(
            output.lock().unwrap().error.take().unwrap().code,
            "trash_unavailable"
        );
        register_operation(&id);
        cancel_operation(id.clone()).unwrap();
        assert!(unsafe { sink.PreDeleteItem(128, None) }.is_err());
        assert_eq!(
            output.lock().unwrap().error.take().unwrap().code,
            "operation_cancelled"
        );
        finish_operation(&id);
        assert!(output.lock().unwrap().destination.is_none());
        assert_eq!(std::fs::read(&file).unwrap(), b"keep me");
        std::fs::remove_dir_all(root).unwrap();
    }
}

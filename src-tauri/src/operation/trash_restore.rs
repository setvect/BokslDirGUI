//! Session-only receipts. Only paths returned by the OS trash API can be restored.
use super::runtime::{
    cancel_summary, emit_progress, emit_summary, finish_operation, is_cancelled, next_operation_id,
    register_operation, summary_from_stats, OperationStats,
};
use crate::contracts::{
    AppError, CommandResult, FileEntry, OperationKind, OperationStarted, OperationState,
    OperationSummary,
};
use crate::filesystem::{file_entry_from_path, map_io_error};
use crate::mutation::rename_no_replace;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

const HISTORY_LIMIT: usize = 20;
static HISTORY: OnceLock<Mutex<History>> = OnceLock::new();
#[derive(Default)]
struct History {
    batches: Vec<Batch>,
    restoring: Option<usize>,
}
struct Batch {
    id: String,
    receipts: Vec<Receipt>,
}
struct Receipt {
    entry: FileEntry,
    trashed: PathBuf,
    identity: Identity,
    parent: PathBuf,
    parent_identity: Identity,
}
#[derive(PartialEq, Eq)]
struct Identity {
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    created: Option<std::time::SystemTime>,
}
impl Identity {
    fn read(path: &Path) -> CommandResult<Self> {
        let metadata = fs::symlink_metadata(path).map_err(|e| map_io_error(e, Some(path)))?;
        #[cfg(unix)]
        use std::os::unix::fs::MetadataExt;
        Ok(Self {
            #[cfg(unix)]
            device: metadata.dev(),
            #[cfg(unix)]
            inode: metadata.ino(),
            created: metadata.created().ok(),
        })
    }
}
fn history() -> &'static Mutex<History> {
    HISTORY.get_or_init(|| Mutex::new(History::default()))
}
fn stale() -> AppError {
    AppError::new("trash_undo_stale", "errors.trashUndoStale", None, true)
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TrashUndoPreview {
    pub(crate) id: String,
    pub(crate) entries: Vec<FileEntry>,
}
impl History {
    fn preview(&self) -> Option<TrashUndoPreview> {
        if self.restoring.is_some() {
            return None;
        }
        self.batches.last().map(|batch| TrashUndoPreview {
            id: batch.id.clone(),
            entries: batch.receipts.iter().map(|r| r.entry.clone()).collect(),
        })
    }
    fn push(&mut self, batch: Batch) {
        if batch.receipts.is_empty() {
            return;
        }
        self.batches.push(batch);
        if self.batches.len() > HISTORY_LIMIT {
            self.batches.remove(0);
            self.restoring = self.restoring.map(|index| index.saturating_sub(1));
        }
    }
    fn take(&mut self, id: &str) -> CommandResult<Batch> {
        if self.restoring.is_some() || self.batches.last().map(|b| b.id.as_str()) != Some(id) {
            return Err(stale());
        }
        self.restoring = Some(self.batches.len() - 1);
        Ok(self.batches.pop().unwrap())
    }
    fn finish(&mut self, batch: Batch) {
        // A new deletion may have finished during restore; retain its ordering.
        let index = self
            .restoring
            .take()
            .unwrap_or(self.batches.len())
            .min(self.batches.len());
        if !batch.receipts.is_empty() {
            self.batches.insert(index, batch);
        }
        if self.batches.len() > HISTORY_LIMIT {
            self.batches.remove(0);
        }
    }
}
pub(crate) fn preview() -> Option<TrashUndoPreview> {
    history().lock().unwrap().preview()
}

// RAII records successful items even when deletion later fails or is cancelled.
pub(super) struct TrashRecorder(Batch);
impl TrashRecorder {
    pub(super) fn new(id: &str) -> Self {
        Self(Batch {
            id: id.into(),
            receipts: vec![],
        })
    }
    pub(super) fn trash(&mut self, source: &Path) -> CommandResult<()> {
        let entry = file_entry_from_path(source, false)?;
        let identity = Identity::read(source)?;
        let parent = source
            .parent()
            .ok_or_else(stale)?
            .canonicalize()
            .map_err(|e| map_io_error(e, Some(source)))?;
        let parent_identity = Identity::read(&parent)?;
        if let Some(trashed) = move_to_trash(source)? {
            self.0.receipts.push(Receipt {
                entry,
                trashed,
                identity,
                parent,
                parent_identity,
            });
        }
        Ok(())
    }
}
impl Drop for TrashRecorder {
    fn drop(&mut self) {
        history().lock().unwrap().push(Batch {
            id: self.0.id.clone(),
            receipts: std::mem::take(&mut self.0.receipts),
        });
    }
}
fn move_to_trash(source: &Path) -> CommandResult<Option<PathBuf>> {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("BOKSLDIRGUI_TRASH_DIR") {
        let trash = PathBuf::from(path);
        fs::create_dir_all(&trash).map_err(|e| map_io_error(e, Some(&trash)))?;
        let target = super::file_io::unique_temp_target(&trash, source);
        rename_no_replace(source, &target).map_err(|e| map_io_error(e, Some(source)))?;
        return Ok(Some(target));
    }
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSFileManager, NSString, NSURL};
        return objc2::rc::autoreleasepool(|_| {
            let path = source.to_str().ok_or_else(stale)?;
            let url = NSURL::fileURLWithPath(&NSString::from_str(path));
            let mut result = None;
            NSFileManager::defaultManager()
                .trashItemAtURL_resultingItemURL_error(&url, Some(&mut result))
                .map_err(|e| {
                    AppError::new("trash_failed", "errors.trashFailed", Some(source), true)
                        .with_detail("message", e.to_string())
                })?;
            // The OS may rename the item in Trash; never infer its path from the basename.
            Ok(result
                .and_then(|url| url.path())
                .map(|path| PathBuf::from(path.to_string())))
        });
    }
    #[cfg(not(target_os = "macos"))]
    {
        trash::delete(source).map_err(|e| {
            AppError::new("trash_failed", "errors.trashFailed", Some(source), true)
                .with_detail("message", e.to_string())
        })?;
        Ok(None)
    }
}

pub(crate) fn start(app: Option<&tauri::AppHandle>, id: String) -> CommandResult<OperationStarted> {
    let batch = history().lock().unwrap().take(&id)?;
    let operation_id = next_operation_id(OperationKind::RestoreTrash);
    register_operation(&operation_id);
    let started = OperationStarted {
        operation_id: operation_id.clone(),
        kind: OperationKind::RestoreTrash,
        state: OperationState::Queued,
    };
    let asynchronous = app.is_some();
    let app = app.cloned();
    let run = move || {
        let (summary, remaining) = run_restore(app.as_ref(), &operation_id, batch, None);
        history().lock().unwrap().finish(remaining);
        emit_summary(app.as_ref(), &summary);
        finish_operation(&operation_id);
    };
    if asynchronous {
        std::thread::spawn(run);
    } else {
        run();
    }
    Ok(started)
}
fn restore(receipt: &Receipt) -> CommandResult<()> {
    let target = Path::new(&receipt.entry.path);
    // Refuse a replaced item or moved/replaced parent, including a new symlink at that path.
    let identity = Identity::read(&receipt.trashed).map_err(|error| {
        if error.code == "not_found" {
            AppError::new(
                "trash_item_missing",
                "errors.trashUndoMissing",
                Some(target),
                true,
            )
        } else {
            error
        }
    })?;
    if identity != receipt.identity {
        return Err(AppError::new(
            "trash_item_replaced",
            "errors.trashUndoChanged",
            Some(target),
            true,
        ));
    }
    if Identity::read(&receipt.parent)? != receipt.parent_identity
        || target.parent().and_then(|p| p.canonicalize().ok()).as_ref() != Some(&receipt.parent)
    {
        return Err(AppError::new(
            "trash_undo_changed",
            "errors.trashUndoChanged",
            Some(target),
            true,
        ));
    }
    rename_no_replace(&receipt.trashed, target).map_err(|e| map_io_error(e, Some(target)))
}
fn run_restore(
    app: Option<&tauri::AppHandle>,
    id: &str,
    batch: Batch,
    cancel_after: Option<u64>,
) -> (OperationSummary, Batch) {
    let mut stats = OperationStats::new(batch.receipts.len() as u64, 0);
    let mut remaining = Batch {
        id: batch.id,
        receipts: vec![],
    };
    let mut cancelled = false;
    for receipt in batch.receipts {
        if cancelled || is_cancelled(id) || cancel_after.is_some_and(|n| stats.completed_files >= n)
        {
            cancelled = true;
            remaining.receipts.push(receipt);
            continue;
        }
        emit_progress(
            app,
            id,
            OperationKind::RestoreTrash,
            OperationState::Running,
            &stats,
            Some(Path::new(&receipt.entry.path)),
        );
        match restore(&receipt) {
            Ok(()) => stats.completed_files += 1,
            Err(error) => {
                stats.failed_files += 1;
                let lost =
                    error.code == "trash_item_missing" || error.code == "trash_item_replaced";
                stats.errors.push(error);
                if !lost {
                    remaining.receipts.push(receipt);
                }
            }
        }
    }
    let summary = if cancelled {
        cancel_summary(id, OperationKind::RestoreTrash, &stats)
    } else {
        summary_from_stats(id, OperationKind::RestoreTrash, &stats)
    };
    (summary, remaining)
}

#[cfg(test)]
mod tests {
    use crate::contracts::OperationKind;
    use crate::contracts::OperationState;
    use crate::filesystem::file_entry_from_path;
    use crate::operation::runtime::next_operation_id;
    use crate::operation::trash_restore::{
        run_restore, Batch, History, Identity, Receipt, HISTORY_LIMIT,
    };
    use std::fs;
    use std::path::{Path, PathBuf};
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(next_operation_id(OperationKind::RestoreTrash));
            fs::create_dir_all(root.join("original")).unwrap();
            fs::create_dir_all(root.join("trash")).unwrap();
            Self(root)
        }
        fn trash(&self, name: &str) -> Receipt {
            let source = self.0.join("original").join(name);
            let entry = file_entry_from_path(&source, false).unwrap();
            let identity = Identity::read(&source).unwrap();
            let parent = source.parent().unwrap().canonicalize().unwrap();
            let parent_identity = Identity::read(&parent).unwrap();
            let trashed = self.0.join("trash").join(format!("renamed-{name}"));
            fs::rename(&source, &trashed).unwrap();
            Receipt {
                entry,
                identity,
                parent,
                parent_identity,
                trashed,
            }
        }
        fn file(&self, name: &str) -> Receipt {
            fs::write(self.0.join("original").join(name), "original content").unwrap();
            self.trash(name)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }
    fn batch(id: &str, receipts: Vec<Receipt>) -> Batch {
        Batch {
            id: id.into(),
            receipts,
        }
    }
    #[test]
    fn restores_files_folders_and_symlinks_using_recorded_paths() {
        let fixture = Fixture::new();
        let mut receipts = vec![fixture.file("한글 # %.json")];
        let directory = fixture.0.join("original/folder");
        fs::create_dir(&directory).unwrap();
        fs::write(directory.join("child"), "child").unwrap();
        receipts.push(fixture.trash("folder"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("missing-target", fixture.0.join("original/link")).unwrap();
            receipts.push(fixture.trash("link"));
        }
        let count = receipts.len() as u64;
        let (summary, remaining) = run_restore(None, "restore", batch("a", receipts), None);
        assert_eq!(summary.state, OperationState::Completed);
        assert_eq!(summary.completed_files, count);
        assert!(remaining.receipts.is_empty());
        assert_eq!(
            fs::read_to_string(fixture.0.join("original/한글 # %.json")).unwrap(),
            "original content"
        );
        assert_eq!(
            fs::read_to_string(directory.join("child")).unwrap(),
            "child"
        );
        #[cfg(unix)]
        assert_eq!(
            fs::read_link(fixture.0.join("original/link")).unwrap(),
            Path::new("missing-target")
        );
    }
    #[test]
    fn conflict_does_not_overwrite_and_can_be_retried() {
        let fixture = Fixture::new();
        let receipt = fixture.file("same");
        fs::write(&receipt.entry.path, "new content").unwrap();
        let (summary, remaining) = run_restore(None, "conflict", batch("a", vec![receipt]), None);
        assert_eq!(summary.failed_files, 1);
        assert_eq!(summary.completed_files, 0);
        assert_eq!(
            fs::read_to_string(&remaining.receipts[0].entry.path).unwrap(),
            "new content"
        );
        assert!(remaining.receipts[0].trashed.exists());
        fs::remove_file(&remaining.receipts[0].entry.path).unwrap();
        assert_eq!(
            run_restore(None, "retry", remaining, None).0.state,
            OperationState::Completed
        );
    }
    #[test]
    fn partial_cancel_retains_only_unrestored_receipts() {
        let fixture = Fixture::new();
        let (summary, remaining) = run_restore(
            None,
            "cancel",
            batch("a", vec![fixture.file("a"), fixture.file("b")]),
            Some(1),
        );
        assert_eq!(summary.state, OperationState::Cancelled);
        assert_eq!(summary.completed_files, 1);
        assert_eq!(remaining.receipts.len(), 1);
        assert_eq!(remaining.receipts[0].entry.name, "b");
        let (summary, remaining) = run_restore(None, "retry", remaining, None);
        assert_eq!(summary.completed_files, 1);
        assert!(remaining.receipts.is_empty());
    }
    #[test]
    fn emptied_or_replaced_trash_is_reported_without_restoring_another_file() {
        let fixture = Fixture::new();
        let missing = fixture.file("missing");
        fs::remove_file(&missing.trashed).unwrap();
        let replaced = fixture.file("replaced");
        fs::rename(&replaced.trashed, fixture.0.join("retained-original")).unwrap();
        fs::write(&replaced.trashed, "unrelated").unwrap();
        let replaced_path = replaced.trashed.clone();
        let (summary, remaining) =
            run_restore(None, "missing", batch("a", vec![missing, replaced]), None);
        assert_eq!(summary.failed_files, 2);
        assert_eq!(summary.errors[0].code, "trash_item_missing");
        assert_eq!(summary.errors[1].code, "trash_item_replaced");
        assert!(remaining.receipts.is_empty());
        assert_eq!(fs::read_to_string(replaced_path).unwrap(), "unrelated");
    }
    #[test]
    fn replaced_parent_is_rejected_and_missing_parent_retains_receipt() {
        let fixture = Fixture::new();
        let receipt = fixture.file("a");
        fs::rename(fixture.0.join("original"), fixture.0.join("old-parent")).unwrap();
        let (summary, remaining) =
            run_restore(None, "missing-parent", batch("a", vec![receipt]), None);
        assert_eq!(summary.failed_files, 1);
        assert_eq!(remaining.receipts.len(), 1);
        fs::create_dir(fixture.0.join("original")).unwrap();
        let (summary, remaining) = run_restore(None, "replaced-parent", remaining, None);
        assert_eq!(summary.errors[0].code, "trash_undo_changed");
        assert_eq!(remaining.receipts.len(), 1);
        assert!(!fixture.0.join("original/a").exists());
    }
    #[test]
    fn history_checks_receipt_id_serializes_restore_and_preserves_order() {
        let fixture = Fixture::new();
        let mut history = History::default();
        history.push(batch("old", vec![fixture.file("old")]));
        history.push(batch("recent", vec![fixture.file("recent")]));
        assert!(history.take("old").is_err());
        let recent = history.take("recent").unwrap();
        assert!(history.preview().is_none());
        assert!(history.take("recent").is_err());
        history.push(batch("new", vec![fixture.file("new")]));
        history.finish(recent);
        assert_eq!(history.preview().unwrap().id, "new");
        let mut newest = history.take("new").unwrap();
        newest.receipts.clear();
        history.finish(newest);
        assert_eq!(history.preview().unwrap().id, "recent");
        let mut recent = history.take("recent").unwrap();
        recent.receipts.clear();
        history.finish(recent);
        assert_eq!(history.preview().unwrap().id, "old");
        for i in 0..HISTORY_LIMIT {
            history.push(batch(
                &format!("{i}"),
                vec![fixture.file(&format!("file-{i}"))],
            ));
        }
        assert_eq!(history.batches.len(), HISTORY_LIMIT);
        assert_eq!(history.batches[0].id, "0");
    }
    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "실제 macOS 휴지통을 이용하는 임시 파일 왕복 검증: 명시적 실행 전용"]
    fn native_macos_trash_roundtrip() {
        let _env_guard = crate::tests::TEST_ENV_MUTEX.lock().unwrap();
        assert!(std::env::var_os("BOKSLDIRGUI_TRASH_DIR").is_none());
        let fixture = Fixture::new();
        let source = fixture.0.join("original/복원 확인 # %.txt");
        fs::write(&source, "native trash roundtrip").unwrap();
        let mut recorder = crate::operation::trash_restore::TrashRecorder::new("native-test");
        recorder
            .trash(&source)
            .expect("native trash should return the stored location");
        assert!(!source.exists());
        let receipts = std::mem::take(&mut recorder.0.receipts);
        assert_eq!(receipts.len(), 1);
        let (summary, remaining) =
            run_restore(None, "native-test", batch("native-test", receipts), None);
        assert!(
            remaining.receipts.is_empty(),
            "native restore errors: {:?}",
            summary.errors
        );
        assert_eq!(summary.state, OperationState::Completed);
        assert_eq!(
            fs::read_to_string(source).unwrap(),
            "native trash roundtrip"
        );
    }
}

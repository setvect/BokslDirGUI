//! 패널 디렉터리 감시. 패널마다 감시 하나, 변경이 잠시 멈추면 변경 알림을 한 번 발행.
use crate::contracts::{AppError, CommandResult, DirectoryChanged, PanelId, WatchAck};
use crate::path_text::display_path;
use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

// 프론트 `src/tauri/commands.ts`의 `EVENTS.dirChanged`와 같은 이름(contract.test.ts가 대조).
pub(crate) const DIR_CHANGED_EVENT: &str = "dir_changed";
/// 연속 변경(복사·압축 해제 중 다수 생성)을 한 번의 새로고침으로 묶는 조용한 시간.
const QUIET_PERIOD: Duration = Duration::from_millis(300);

static VERSION: AtomicU64 = AtomicU64::new(0);

/// 살아 있는 동안만 감시. Drop하면 감시와 알림 스레드 종료.
pub(crate) struct DirectoryWatch {
    _watcher: RecommendedWatcher,
}

fn watches() -> &'static Mutex<HashMap<PanelId, DirectoryWatch>> {
    static WATCHES: OnceLock<Mutex<HashMap<PanelId, DirectoryWatch>>> = OnceLock::new();
    WATCHES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 패널 감시 교체. 실제 디렉터리만 허용, 버전으로 늦게 도착한 이전 감시 알림 구분.
pub(crate) fn watch(
    panel_id: PanelId,
    path: &str,
    on_change: impl Fn(&DirectoryChanged) + Send + 'static,
) -> CommandResult<WatchAck> {
    let path = crate::navigation::canonical_existing_directory(path)?;
    let version = VERSION.fetch_add(1, Ordering::Relaxed) + 1;
    let changed = DirectoryChanged { panel_id, path: display_path(&path), version };
    let watch = start(&path, QUIET_PERIOD, move || on_change(&changed))?;
    watches()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .insert(panel_id, watch);
    Ok(WatchAck { panel_id, path: display_path(&path), version })
}

pub(crate) fn unwatch(panel_id: PanelId) {
    watches()
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .remove(&panel_id);
}

/// 디렉터리 하나의 직접 자식 변경 감시 시작(하위 폴더 내부 변경 제외).
pub(crate) fn start(
    path: &Path,
    quiet: Duration,
    on_change: impl FnMut() + Send + 'static,
) -> CommandResult<DirectoryWatch> {
    let (sender, receiver) = mpsc::channel::<()>();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if result.is_ok_and(|event| !matches!(event.kind, EventKind::Access(_))) {
            let _ = sender.send(());
        }
    })
    .map_err(|error| watch_error(&error, path))?;
    watcher
        .watch(path, RecursiveMode::NonRecursive)
        .map_err(|error| watch_error(&error, path))?;
    std::thread::Builder::new()
        .name("boksldir-watch".to_owned())
        .spawn(move || coalesce(&receiver, quiet, on_change))
        .map_err(|error| crate::filesystem::map_io_error(error, Some(path)))?;
    Ok(DirectoryWatch { _watcher: watcher })
}

/// 첫 알림 뒤 조용한 시간 동안 이어진 알림을 묶어 한 번만 실행. 감시가 해제되면(송신 측 Drop) 알림 없이 종료.
fn coalesce(receiver: &Receiver<()>, quiet: Duration, mut on_change: impl FnMut()) {
    while receiver.recv().is_ok() {
        loop {
            match receiver.recv_timeout(quiet) {
                Ok(()) => continue,
                Err(RecvTimeoutError::Timeout) => {
                    on_change();
                    break;
                }
                Err(RecvTimeoutError::Disconnected) => return,
            }
        }
    }
}

fn watch_error(error: &notify::Error, path: &Path) -> AppError {
    AppError::new("watch_failed", "errors.watchFailed", Some(path), true)
        .with_detail("reason", error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{coalesce, start};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{mpsc, Arc};
    use std::time::Duration;

    #[test]
    fn bursts_of_changes_notify_once_and_stop_without_a_late_notice_after_unwatch() {
        let (sender, receiver) = mpsc::channel();
        let count = Arc::new(AtomicUsize::new(0));
        let observed = Arc::clone(&count);
        let worker = std::thread::spawn(move || {
            coalesce(&receiver, Duration::from_millis(80), move || {
                observed.fetch_add(1, Ordering::SeqCst);
            })
        });
        for _ in 0..5 {
            sender.send(()).unwrap();
        }
        std::thread::sleep(Duration::from_millis(400));
        assert_eq!(count.load(Ordering::SeqCst), 1);
        sender.send(()).unwrap();
        drop(sender);
        worker.join().unwrap();
        assert_eq!(count.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn real_directory_watch_reports_a_new_entry() {
        let dir = crate::test_util::TempDir::new("watch");
        let (sender, receiver) = mpsc::channel();
        let _watch = start(dir.path(), Duration::from_millis(100), move || {
            let _ = sender.send(());
        })
        .expect("directory watch should start");
        // FSEvents는 등록 직후 잠시 이벤트를 놓칠 수 있어 생성 전 짧게 대기.
        std::thread::sleep(Duration::from_millis(300));
        std::fs::write(dir.path().join("새 파일.txt"), b"x").unwrap();
        receiver
            .recv_timeout(Duration::from_secs(10))
            .expect("a created entry should be reported");
    }
}

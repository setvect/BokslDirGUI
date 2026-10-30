//! SFTP 원격 파일 관리: 원격 경로, 연결·인증, 목록·파일 관리, 전송.
//! 원격 요청은 전용 비동기 런타임에서 실행. 명령은 `run`, 동기 작업 스레드는 `block_on` 사용.
pub(crate) mod bulk_rename;
pub(crate) mod connection;
pub(crate) mod credentials;
pub(crate) mod listing;
pub(crate) mod ops;
pub(crate) mod path;
pub(crate) mod ssh_config;
#[cfg(test)]
pub(crate) mod test_server;
#[cfg(test)]
mod tests;

use crate::contracts::{AppError, CommandResult};
use std::future::Future;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::OnceLock;

/// SSH 세션 작업이 계속 실행될 런타임. 명령 호출마다 바뀌지 않도록 앱 전체에서 하나만 사용.
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .thread_name("boksl-remote")
            .enable_all()
            .build()
            .expect("remote runtime should start")
    })
}

/// 비동기 명령에서 원격 요청 실행.
pub(crate) async fn run<T: Send + 'static>(
    future: impl Future<Output = CommandResult<T>> + Send + 'static,
) -> CommandResult<T> {
    runtime().spawn(future).await.map_err(|error| {
        AppError::new("remote_failed", "errors.remoteOperationFailed", None, true)
            .with_detail("message", error.to_string())
    })?
}

/// 동기 작업 스레드에서 원격 요청 실행. 비동기 런타임 작업 스레드에서는 호출 금지.
pub(crate) fn block_on<F: Future>(future: F) -> F::Output {
    runtime().block_on(future)
}

/// 원격 파일을 기본 앱으로 열 때 받는 앱 전용 임시 위치(FR-39.2). 사용자 파일과 섞이지 않게 임시 폴더 아래에 둠.
fn open_temp_root() -> PathBuf {
    std::env::temp_dir().join("BokslDirGUI-remote-open")
}

/// 열기마다 새 하위 폴더: 같은 이름 파일을 덮어쓰거나 이전에 연 파일을 바꾸지 않음.
pub(crate) fn new_open_dir() -> CommandResult<PathBuf> {
    static NEXT: AtomicU64 = AtomicU64::new(0);
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let dir = open_temp_root().join(format!("{}-{millis}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
    std::fs::create_dir_all(&dir).map_err(|error| crate::filesystem::map_io_error(error, Some(&dir)))?;
    Ok(dir)
}

/// 앱 종료 때 받은 임시 파일 정리. 다른 앱이 열고 있어 지우지 못한 파일은 다음 종료 때 다시 시도.
pub(crate) fn clear_open_temp() {
    let _ = std::fs::remove_dir_all(open_temp_root());
}

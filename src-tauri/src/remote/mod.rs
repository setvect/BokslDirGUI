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

//! 원격 영구 삭제·권한 변경·다중 이름 변경 작업: 작업 런타임(자리·진행률·취소·요약)에서 SFTP 요청 실행.
//! 작업 스레드는 동기 흐름을 유지하고 요청마다 원격 런타임에서 실행(`remote::block_on`).
use super::file_io::ProgressTicker;
use super::runtime::{
    cancel_summary, check_cancelled, emit_progress, emit_state, error_summary, is_cancelled,
    launch_operation, summary_from_stats, OperationStats,
};
use crate::contracts::{
    AppError, ChmodScope, CommandResult, OperationKind, OperationStarted, OperationState,
    OperationSummary, RenameItem,
};
use crate::remote::connection::RemoteConnection;
use crate::remote::ops::{self, RemoteTreeItem};
use crate::remote::path::RemotePath;
use crate::remote::{block_on, bulk_rename};
use std::collections::HashSet;
use std::path::Path;

/// 원격 대상 삭제는 휴지통이 없어 영구 삭제만 허용. 시작 전 연결·보호 경로 확인.
pub(super) fn start_remote_delete(app: Option<&tauri::AppHandle>, targets: Vec<String>) -> CommandResult<OperationStarted> {
    let (connection, roots) = ops::same_location_targets(&targets)?;
    for root in &roots {
        ops::guard_delete_target(&connection, root)?;
    }
    launch_operation(app, OperationKind::Delete, Some(OperationState::Validating), move |app, operation_id| {
        run_remote_delete(app, operation_id, &targets)
    })
}

pub(crate) fn start_remote_chmod(
    app: Option<&tauri::AppHandle>,
    targets: Vec<String>,
    mode: u32,
    recursive: bool,
    scope: ChmodScope,
) -> CommandResult<OperationStarted> {
    if mode > 0o7777 {
        return Err(AppError::new("invalid_mode", "errors.remoteInvalidMode", None, true).with_detail("mode", format!("{mode:o}")));
    }
    ops::same_location_targets(&targets)?;
    launch_operation(app, OperationKind::Chmod, Some(OperationState::Validating), move |app, operation_id| {
        run_remote_chmod(app, operation_id, &targets, mode, recursive, scope)
    })
}

pub(super) fn start_remote_bulk_rename(app: Option<&tauri::AppHandle>, items: Vec<RenameItem>) -> CommandResult<OperationStarted> {
    let sources = items.iter().map(|item| RemotePath::parse(&item.source)).collect::<CommandResult<Vec<_>>>()?;
    let connection = bulk_rename::plan_connection(&sources)?;
    block_on(bulk_rename::validate_plan(&connection, &items))?;
    launch_operation(app, OperationKind::Rename, None, move |app, operation_id| {
        run_remote_bulk_rename(app, operation_id, &connection, &items)
    })
}

fn url_path(path: &RemotePath) -> String {
    path.url()
}

/// 대상마다 하위 항목을 먼저 모아 전체 수를 알린 뒤 깊은 항목부터 삭제. 대상 하나가 실패하면 그 대상의 남은 항목은 건너뜀.
pub(crate) fn run_remote_delete(app: Option<&tauri::AppHandle>, operation_id: &str, targets: &[String]) -> OperationSummary {
    let kind = OperationKind::Delete;
    let (connection, roots) = match ops::same_location_targets(targets) {
        Ok(prepared) => prepared,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    emit_state(app, operation_id, kind, OperationState::Scanning, None, 0, 0, None);
    let plans = match scan_all(&connection, operation_id, &roots) {
        Ok(plans) => plans,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let total_files = plans.iter().map(Vec::len).sum::<usize>() as u64;
    let total_bytes = plans.iter().flatten().filter(|item| item.attrs.is_regular()).map(|item| item.attrs.size.unwrap_or(0)).sum();
    let mut stats = OperationStats::new(total_files, total_bytes);
    emit_progress(app, operation_id, kind, OperationState::Running, &stats, None);
    let mut ticker = ProgressTicker::new();
    for items in &plans {
        for item in items {
            let url = url_path(&item.path);
            if is_cancelled(operation_id) {
                return cancel_summary(operation_id, kind, &stats);
            }
            match block_on(ops::remove(&connection, item)) {
                Ok(()) => {
                    stats.completed_files += 1;
                    if item.attrs.is_regular() {
                        stats.completed_bytes += item.attrs.size.unwrap_or(0);
                    }
                    if ticker.should_emit() {
                        emit_progress(app, operation_id, kind, OperationState::Running, &stats, Some(Path::new(&url)));
                    }
                }
                Err(error) => {
                    stats.failed_files += 1;
                    stats.errors.push(error);
                    break;
                }
            }
        }
    }
    emit_progress(app, operation_id, kind, OperationState::Running, &stats, None);
    summary_from_stats(operation_id, kind, &stats)
}

/// 재귀가 아니면 선택 항목만 변경. 재귀 적용이면 선택 항목을 포함한 모든 항목을 범위(파일·폴더)로 거르고,
/// 링크와 그 대상은 건드리지 않음(파일만 바꿀 때 선택 폴더의 실행 권한이 빠져 들어갈 수 없게 되는 일 방지).
pub(crate) fn run_remote_chmod(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    targets: &[String],
    mode: u32,
    recursive: bool,
    scope: ChmodScope,
) -> OperationSummary {
    let kind = OperationKind::Chmod;
    let (connection, roots) = match ops::same_location_targets(targets) {
        Ok(prepared) => prepared,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    emit_state(app, operation_id, kind, OperationState::Scanning, None, 0, 0, None);
    let mut planned: Vec<RemoteTreeItem> = Vec::new();
    for root in &roots {
        let items = if recursive {
            match scan_all(&connection, operation_id, std::slice::from_ref(root)) {
                Ok(mut plans) => plans.pop().unwrap_or_default(),
                Err(error) => return error_summary(operation_id, kind, error),
            }
        } else {
            match block_on(ops::lstat(&connection, root)) {
                Ok(attrs) => vec![RemoteTreeItem { path: root.clone(), attrs }],
                Err(error) => return error_summary(operation_id, kind, error),
            }
        };
        planned.extend(items.into_iter().filter(|item| {
            let in_scope = match scope {
                ChmodScope::All => true,
                ChmodScope::Files => !item.attrs.is_dir(),
                ChmodScope::Directories => item.attrs.is_dir(),
            };
            !recursive || (!item.attrs.is_symlink() && in_scope)
        }));
    }
    let mut stats = OperationStats::new(planned.len() as u64, 0);
    emit_progress(app, operation_id, kind, OperationState::Running, &stats, None);
    let mut ticker = ProgressTicker::new();
    for item in &planned {
        if is_cancelled(operation_id) {
            return cancel_summary(operation_id, kind, &stats);
        }
        match block_on(ops::set_permissions(&connection, &item.path, mode)) {
            Ok(()) => stats.completed_files += 1,
            Err(error) => {
                stats.failed_files += 1;
                stats.errors.push(error);
            }
        }
        if ticker.should_emit() {
            emit_progress(app, operation_id, kind, OperationState::Running, &stats, Some(Path::new(&url_path(&item.path))));
        }
    }
    emit_progress(app, operation_id, kind, OperationState::Running, &stats, None);
    summary_from_stats(operation_id, kind, &stats)
}

/// 항목마다 실행 직전에 다시 검증하고 덮어쓰기 금지 이름 변경. 첫 실패에서 중단(로컬과 같은 정책).
fn run_remote_bulk_rename(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    connection: &RemoteConnection,
    items: &[RenameItem],
) -> OperationSummary {
    let kind = OperationKind::Rename;
    let sources: HashSet<String> = items
        .iter()
        .filter_map(|item| RemotePath::parse(&item.source).ok())
        .map(|source| source.path)
        .collect();
    let mut stats = OperationStats::new(items.len() as u64, 0);
    for item in items {
        if check_cancelled(operation_id, Path::new(&item.source)).is_err() {
            let mut summary = summary_from_stats(operation_id, kind, &stats);
            summary.state = OperationState::Cancelled;
            return summary;
        }
        emit_progress(app, operation_id, kind, OperationState::Running, &stats, Some(Path::new(&item.source)));
        let result = block_on(async {
            let target = bulk_rename::check_item(connection, item, &sources).await?;
            let source = RemotePath::parse(&item.source)?;
            if target == source {
                return Ok(false);
            }
            ops::rename_no_replace(connection, &source, &target).await.map(|()| true)
        });
        match result {
            Ok(true) => stats.completed_files += 1,
            Ok(false) => stats.skipped_files += 1,
            Err(error) => {
                stats.failed_files += 1;
                stats.errors.push(error);
                break;
            }
        }
    }
    summary_from_stats(operation_id, kind, &stats)
}

fn scan_all(connection: &RemoteConnection, operation_id: &str, roots: &[RemotePath]) -> CommandResult<Vec<Vec<RemoteTreeItem>>> {
    let check = |path: &RemotePath| check_cancelled(operation_id, Path::new(&path.url()));
    roots.iter().map(|root| block_on(ops::scan_tree(connection, root, &check))).collect()
}

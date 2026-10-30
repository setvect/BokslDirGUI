//! 로컬↔원격·원격↔원격 복사와 이동(FR-37). 최상위 항목마다 임시 이름으로 전송한 뒤 게시하고,
//! 충돌 선택·링크 정책·끊김 뒤 이어받기·수정 시각 보존을 적용. 로컬↔로컬은 `transfer` 담당.
use super::file_io::{
    canonical_existing_directory, path_is_occupied, publish_replacement, remove_entry_any,
    ProgressTicker,
};
use super::runtime::{
    cancel_summary, conflict_apply_all_decision, emit_conflict, emit_progress, emit_state,
    error_summary, is_cancelled, launch_operation, summary_from_stats, wait_for_conflict_decision,
    OperationStats,
};
use crate::contracts::{
    AppError, CommandResult, ConflictDecision, ConflictPrompt, FileEntry, OperationKind,
    OperationStarted, OperationState, OperationSummary, RemoteLinkPolicy,
};
use crate::filesystem::{file_entry_from_path, map_io_error};
use crate::path_text::display_path;
use crate::remote::block_on;
use crate::remote::connection::{self, sftp_error, RemoteConnection};
use crate::remote::listing::{entry_from_attrs, existing_directory, is_listable_name, read_directory};
use crate::remote::ops;
use crate::remote::path::{is_remote_path, RemoteLocation, RemotePath};
use russh_sftp::protocol::{FileAttributes, OpenFlags};
use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::{Duration, UNIX_EPOCH};
use tokio::io::{AsyncReadExt, AsyncSeekExt, AsyncWriteExt};

const CHUNK_BYTES: usize = 256 * 1024;
/// 링크를 따라 복사할 때 폴더 깊이 상한(순환·과도한 중첩 방지).
const MAX_FOLLOW_DEPTH: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
enum Endpoint {
    Local(PathBuf),
    Remote(RemotePath),
}

impl Endpoint {
    fn parse(text: &str) -> CommandResult<Self> {
        if is_remote_path(text) {
            Ok(Self::Remote(RemotePath::parse(text)?))
        } else {
            Ok(Self::Local(PathBuf::from(text)))
        }
    }

    fn join(&self, name: &str) -> Self {
        match self {
            Self::Local(path) => Self::Local(path.join(name)),
            Self::Remote(path) => Self::Remote(path.join(name)),
        }
    }

    fn display(&self) -> String {
        match self {
            Self::Local(path) => display_path(path),
            Self::Remote(path) => path.url(),
        }
    }

    fn name(&self) -> Option<String> {
        match self {
            Self::Local(path) => path.file_name().map(|name| name.to_string_lossy().into_owned()),
            Self::Remote(path) => path.file_name().map(str::to_string),
        }
    }

    fn location(&self) -> Option<&RemoteLocation> {
        match self {
            Self::Local(_) => None,
            Self::Remote(path) => Some(&path.location),
        }
    }

    /// 같은 파일 시스템에서 `self`가 `ancestor`이거나 그 안에 있음.
    fn is_within(&self, ancestor: &Self) -> bool {
        match (self, ancestor) {
            (Self::Local(path), Self::Local(ancestor)) => super::file_io::path_is_within(path, ancestor),
            (Self::Remote(path), Self::Remote(ancestor)) => {
                path.location == ancestor.location
                    && (path.path == ancestor.path || path.path.starts_with(&format!("{}/", ancestor.path.trim_end_matches('/'))))
            }
            _ => false,
        }
    }

    fn error_path(&self) -> PathBuf {
        PathBuf::from(self.display())
    }
}

/// 전송 원본 파일 속성.
#[derive(Debug, Clone, Copy)]
struct FileFacts {
    size: u64,
    mtime: Option<u64>,
}

#[derive(Debug, Clone)]
enum ItemKind {
    Directory,
    File(FileFacts),
    Link(String),
}

/// 최상위 원본 기준 상대 경로와 전송할 항목. 상위 폴더가 하위 항목보다 먼저 옴.
#[derive(Debug, Clone)]
struct TransferItem {
    relative: Vec<String>,
    source: Endpoint,
    kind: ItemKind,
}

struct TransferContext<'a> {
    app: Option<&'a tauri::AppHandle>,
    operation_id: &'a str,
    kind: OperationKind,
    connections: HashMap<RemoteLocation, Arc<RemoteConnection>>,
    stats: OperationStats,
    ticker: ProgressTicker,
}

impl TransferContext<'_> {
    fn connection(&self, path: &RemotePath) -> CommandResult<&Arc<RemoteConnection>> {
        self.connections.get(&path.location).ok_or_else(|| connection::not_connected(&path.location))
    }

    fn check_cancelled(&self, at: &Endpoint) -> CommandResult<()> {
        if is_cancelled(self.operation_id) {
            return Err(cancelled_error(at));
        }
        Ok(())
    }

    fn progress(&mut self, at: &Endpoint, force: bool) {
        if force || self.ticker.should_emit() {
            emit_progress(self.app, self.operation_id, self.kind, OperationState::Running, &self.stats, Some(&at.error_path()));
        }
    }
}

fn cancelled_error(at: &Endpoint) -> AppError {
    AppError::new("operation_cancelled", "errors.operationCancelled", Some(&at.error_path()), true)
}

/// 원본·대상 중 하나라도 원격이면 이 모듈이 처리.
pub(super) fn involves_remote(sources: &[String], target_dir: &str) -> bool {
    is_remote_path(target_dir) || sources.iter().any(|source| is_remote_path(source))
}

/// 시작 전 확인: 경로 형식, 원본 위치 하나, 관련 원격 연결 존재.
pub(super) fn start_remote_transfer(
    app: Option<&tauri::AppHandle>,
    kind: OperationKind,
    sources: Vec<String>,
    target_dir: String,
    policy: ConflictDecision,
    link_policy: RemoteLinkPolicy,
) -> CommandResult<OperationStarted> {
    prepare(&sources, &target_dir)?;
    launch_operation(app, kind, Some(OperationState::Validating), move |app, operation_id| {
        run_remote_transfer(app, operation_id, kind, &sources, &target_dir, policy, link_policy)
    })
}

type Prepared = (Vec<Endpoint>, Endpoint, HashMap<RemoteLocation, Arc<RemoteConnection>>);

fn prepare(sources: &[String], target_dir: &str) -> CommandResult<Prepared> {
    let parsed = sources.iter().map(|source| Endpoint::parse(source)).collect::<CommandResult<Vec<_>>>()?;
    let Some(first) = parsed.first() else {
        return Err(AppError::new("invalid_path", "errors.emptyOperation", None, true));
    };
    if parsed.iter().any(|source| source.location() != first.location()) {
        return Err(AppError::new("invalid_path", "errors.remoteMixedLocations", None, true));
    }
    let target = Endpoint::parse(target_dir)?;
    let mut connections = HashMap::new();
    for location in [first.location(), target.location()].into_iter().flatten() {
        connections.insert(location.clone(), connection::connection(location)?);
    }
    Ok((parsed, target, connections))
}

pub(crate) fn run_remote_transfer(
    app: Option<&tauri::AppHandle>,
    operation_id: &str,
    kind: OperationKind,
    sources: &[String],
    target_dir: &str,
    policy: ConflictDecision,
    link_policy: RemoteLinkPolicy,
) -> OperationSummary {
    let (sources, target, connections) = match prepare(sources, target_dir) {
        Ok(prepared) => prepared,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    let mut context = TransferContext {
        app,
        operation_id,
        kind,
        connections,
        stats: OperationStats::new(0, 0),
        ticker: ProgressTicker::new(),
    };
    let target = match resolve_target_dir(&context, &target) {
        Ok(target) => target,
        Err(error) => return error_summary(operation_id, kind, error),
    };
    for source in &sources {
        if target.is_within(source) {
            let key = if kind == OperationKind::Move { "errors.moveIntoSelf" } else { "errors.copyIntoSelf" };
            return error_summary(operation_id, kind, AppError::new("invalid_path", key, Some(&source.error_path()), true));
        }
    }
    emit_state(app, operation_id, kind, OperationState::Scanning, None, 0, 0, None);
    // 같은 서버 안 이동은 서버 이름 변경으로 처리(FR-37.2)
    if kind == OperationKind::Move && sources.iter().all(|source| source.location().is_some() && source.location() == target.location()) {
        return run_same_server_move(&mut context, &sources, &target, policy);
    }
    let mut plans = Vec::new();
    let mut skipped_links = 0;
    for source in &sources {
        match scan_source(&context, source, link_policy, &mut skipped_links) {
            Ok(items) => plans.push(items),
            Err(error) => return error_summary(operation_id, kind, error),
        }
    }
    let total_files = plans.iter().map(Vec::len).sum::<usize>() as u64;
    let total_bytes = plans.iter().flatten().map(|item| match item.kind {
        ItemKind::File(facts) => facts.size,
        _ => 0,
    }).sum();
    context.stats = OperationStats::new(total_files, total_bytes);
    context.stats.skipped_files = skipped_links;
    emit_progress(app, operation_id, kind, OperationState::Running, &context.stats, None);
    for (source, items) in sources.iter().zip(&plans) {
        if is_cancelled(operation_id) {
            return cancel_summary(operation_id, kind, &context.stats);
        }
        match transfer_root(&mut context, source, items, &target, policy) {
            Ok(()) => {}
            Err(error) if error.code == "operation_cancelled" => return cancel_summary(operation_id, kind, &context.stats),
            Err(error) => {
                context.stats.failed_files += 1;
                context.stats.errors.push(error);
            }
        }
    }
    emit_progress(app, operation_id, kind, OperationState::Running, &context.stats, None);
    summary_from_stats(operation_id, kind, &context.stats)
}

fn resolve_target_dir(context: &TransferContext, target: &Endpoint) -> CommandResult<Endpoint> {
    match target {
        Endpoint::Local(path) => Ok(Endpoint::Local(canonical_existing_directory(&display_path(path))?)),
        Endpoint::Remote(path) => {
            let connection = context.connection(path)?;
            Ok(Endpoint::Remote(block_on(existing_directory(connection, path))?.0))
        }
    }
}

/// 같은 서버 안 이동: 항목마다 서버 이름 변경, 충돌은 선택에 따라 건너뛰거나 기존 항목을 지운 뒤 이동.
fn run_same_server_move(context: &mut TransferContext, sources: &[Endpoint], target: &Endpoint, policy: ConflictDecision) -> OperationSummary {
    let (operation_id, kind) = (context.operation_id, context.kind);
    context.stats = OperationStats::new(sources.len() as u64, 0);
    emit_progress(context.app, operation_id, kind, OperationState::Running, &context.stats, None);
    for source in sources {
        if is_cancelled(operation_id) {
            return cancel_summary(operation_id, kind, &context.stats);
        }
        let result = (|| -> CommandResult<bool> {
            let (Endpoint::Remote(from), Endpoint::Remote(target_dir)) = (source, target) else {
                return Err(AppError::new("invalid_path", "errors.invalidPath", Some(&source.error_path()), true));
            };
            let name = from.file_name().ok_or_else(|| AppError::new("invalid_path", "errors.protectedPath", Some(&source.error_path()), true))?;
            let destination = target_dir.join(name);
            if destination == *from {
                return Ok(false);
            }
            let connection = Arc::clone(context.connection(from)?);
            if block_on(ops::exists(&connection, &destination))? {
                match decide_conflict(context, source, &Endpoint::Remote(destination.clone()), policy) {
                    ConflictDecision::Skip | ConflictDecision::AllSkip => return Ok(false),
                    ConflictDecision::Cancel => return Err(cancelled_error(source)),
                    ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {
                        return remote_replace(&connection, from, &destination).map(|()| true);
                    }
                }
            }
            block_on(ops::rename_no_replace(&connection, from, &destination)).map(|()| true)
        })();
        match result {
            Ok(true) => context.stats.completed_files += 1,
            Ok(false) => context.stats.skipped_files += 1,
            Err(error) if error.code == "operation_cancelled" => return cancel_summary(operation_id, kind, &context.stats),
            Err(error) => {
                context.stats.failed_files += 1;
                context.stats.errors.push(error);
            }
        }
        context.progress(source, true);
    }
    summary_from_stats(operation_id, kind, &context.stats)
}

/// 최상위 항목 하나 전송: 임시 이름으로 받은 뒤 게시, 이동이면 성공 후 원본 삭제.
fn transfer_root(context: &mut TransferContext, source: &Endpoint, items: &[TransferItem], target: &Endpoint, policy: ConflictDecision) -> CommandResult<()> {
    let Some(root) = items.first() else {
        return Ok(());
    };
    let name = source.name().ok_or_else(|| AppError::new("invalid_path", "errors.invalidPath", Some(&source.error_path()), true))?;
    let destination = target.join(&name);
    if destination == *source {
        context.stats.skipped_files += items.len() as u64;
        return Ok(());
    }
    let occupied = exists(context, &destination)?;
    if occupied {
        match decide_conflict(context, source, &destination, policy) {
            ConflictDecision::Skip | ConflictDecision::AllSkip => {
                context.stats.skipped_files += items.len() as u64;
                return Ok(());
            }
            ConflictDecision::Cancel => return Err(cancelled_error(source)),
            ConflictDecision::Overwrite | ConflictDecision::AllOverwrite => {}
        }
    }
    let stage = target.join(&stage_name(&name, &root.kind));
    let staged = items.iter().try_for_each(|item| {
        let at = item.relative.iter().fold(stage.clone(), |path, part| path.join(part));
        transfer_item(context, item, &at)
    });
    if let Err(error) = staged {
        // 끊김으로 남은 단일 파일 임시본은 다음 전송에서 이어받기, 그 밖에는 정리
        let keep_for_resume = matches!(root.kind, ItemKind::File(_)) && is_connection_error(&error);
        if !keep_for_resume {
            let _ = remove_tree(context, &stage);
        }
        return Err(error);
    }
    if let Err(error) = publish(context, &stage, &destination, occupied) {
        let _ = remove_tree(context, &stage);
        return Err(error);
    }
    if context.kind == OperationKind::Move {
        remove_tree(context, source)?;
    }
    context.progress(&destination, true);
    Ok(())
}

fn is_connection_error(error: &AppError) -> bool {
    matches!(error.code.as_str(), "remote_connection_lost" | "remote_not_connected" | "remote_timeout")
}

static STAGE_NONCE: AtomicU64 = AtomicU64::new(0);

/// 임시 이름: 파일은 원본 크기·수정 시각을 담아 같은 원본이면 이어받기, 그 밖은 고유 이름.
fn stage_name(name: &str, kind: &ItemKind) -> String {
    let short: String = name.chars().take(120).collect();
    match kind {
        ItemKind::File(facts) => format!(".{short}.boksldir-{}-{}.part", facts.size, facts.mtime.unwrap_or(0)),
        _ => format!(
            ".{short}.boksldir-{}-{}.part",
            std::process::id(),
            STAGE_NONCE.fetch_add(1, Ordering::Relaxed)
        ),
    }
}

fn decide_conflict(context: &mut TransferContext, source: &Endpoint, destination: &Endpoint, policy: ConflictDecision) -> ConflictDecision {
    if let Some(decision) = conflict_apply_all_decision(context.operation_id, policy) {
        return decision;
    }
    if context.app.is_none() {
        return policy;
    }
    if let (Ok(source_entry), Ok(destination_entry)) = (entry_of(context, source), entry_of(context, destination)) {
        emit_conflict(context.app, ConflictPrompt {
            operation_id: context.operation_id.to_string(),
            source: source_entry,
            destination: destination_entry,
            default_decision: policy,
            available_decisions: vec![
                ConflictDecision::Overwrite,
                ConflictDecision::Skip,
                ConflictDecision::AllOverwrite,
                ConflictDecision::AllSkip,
                ConflictDecision::Cancel,
            ],
        });
        emit_progress(context.app, context.operation_id, context.kind, OperationState::WaitingForConflict, &context.stats, Some(&source.error_path()));
    }
    wait_for_conflict_decision(context.operation_id, policy)
}

fn entry_of(context: &TransferContext, at: &Endpoint) -> CommandResult<FileEntry> {
    match at {
        Endpoint::Local(path) => file_entry_from_path(path, false),
        Endpoint::Remote(path) => {
            let attrs = block_on(ops::lstat(context.connection(path)?, path))?;
            Ok(entry_from_attrs(path, path.file_name().unwrap_or("/"), &attrs, None))
        }
    }
}

fn exists(context: &TransferContext, at: &Endpoint) -> CommandResult<bool> {
    match at {
        Endpoint::Local(path) => Ok(path_is_occupied(path)),
        Endpoint::Remote(path) => block_on(ops::exists(context.connection(path)?, path)),
    }
}

/// 원본 항목 목록. 링크 정책: 보존은 링크 문자열 복사, 대상 복사는 따라가 실제 항목 전송, 건너뛰기는 수만 셈.
/// 링크를 따라갈 때만 실제 경로로 조상 폴더 재진입(순환)을 확인.
fn scan_source(context: &TransferContext, root: &Endpoint, policy: RemoteLinkPolicy, skipped_links: &mut u64) -> CommandResult<Vec<TransferItem>> {
    let mut items = Vec::new();
    let mut stack = vec![(root.clone(), Vec::<String>::new(), Arc::new(Vec::<String>::new()))];
    while let Some((at, relative, ancestors)) = stack.pop() {
        context.check_cancelled(&at)?;
        let kind = match probe(context, &at, policy)? {
            Probe::Skip => {
                *skipped_links += 1;
                continue;
            }
            Probe::Item(kind) => kind,
            Probe::Directory => {
                let identity = if policy == RemoteLinkPolicy::Follow { real_path(context, &at)? } else { at.display() };
                if ancestors.len() >= MAX_FOLLOW_DEPTH || ancestors.contains(&identity) {
                    return Err(AppError::new("invalid_path", "errors.remoteLinkLoop", Some(&at.error_path()), true));
                }
                let mut chain = ancestors.as_ref().clone();
                chain.push(identity);
                let chain = Arc::new(chain);
                for name in child_names(context, &at)?.into_iter().rev() {
                    let mut child_relative = relative.clone();
                    child_relative.push(name.clone());
                    stack.push((at.join(&name), child_relative, Arc::clone(&chain)));
                }
                ItemKind::Directory
            }
        };
        items.push(TransferItem { relative, source: at, kind });
    }
    Ok(items)
}

fn real_path(context: &TransferContext, at: &Endpoint) -> CommandResult<String> {
    match at {
        Endpoint::Local(path) => std::fs::canonicalize(path).map(|real| display_path(&real)).map_err(|error| map_io_error(error, Some(path))),
        Endpoint::Remote(path) => block_on(context.connection(path)?.sftp.canonicalize(path.path.as_str()))
            .map(|real| format!("{}{real}", connection::session_id(&path.location)))
            .map_err(|error| sftp_error(&path.location, &path.path, &error)),
    }
}

enum Probe {
    Skip,
    Item(ItemKind),
    Directory,
}

fn probe(context: &TransferContext, at: &Endpoint, policy: RemoteLinkPolicy) -> CommandResult<Probe> {
    match at {
        Endpoint::Local(path) => {
            let metadata = std::fs::symlink_metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
            if metadata.file_type().is_symlink() {
                return match policy {
                    RemoteLinkPolicy::Skip => Ok(Probe::Skip),
                    RemoteLinkPolicy::Preserve => {
                        let target = std::fs::read_link(path).map_err(|error| map_io_error(error, Some(path)))?;
                        Ok(Probe::Item(ItemKind::Link(target.to_string_lossy().replace('\\', "/"))))
                    }
                    RemoteLinkPolicy::Follow => {
                        let followed = std::fs::metadata(path).map_err(|error| map_io_error(error, Some(path)))?;
                        local_probe(path, &followed)
                    }
                };
            }
            local_probe(path, &metadata)
        }
        Endpoint::Remote(path) => {
            let connection = context.connection(path)?;
            let attrs = block_on(ops::lstat(connection, path))?;
            if attrs.is_symlink() {
                return match policy {
                    RemoteLinkPolicy::Skip => Ok(Probe::Skip),
                    RemoteLinkPolicy::Preserve => {
                        let target = block_on(connection.sftp.read_link(path.path.as_str()))
                            .map_err(|error| sftp_error(&path.location, &path.path, &error))?;
                        Ok(Probe::Item(ItemKind::Link(target)))
                    }
                    RemoteLinkPolicy::Follow => {
                        let followed = block_on(connection.sftp.metadata(path.path.as_str()))
                            .map_err(|error| sftp_error(&path.location, &path.path, &error))?;
                        remote_probe(path, &followed)
                    }
                };
            }
            remote_probe(path, &attrs)
        }
    }
}

fn local_probe(path: &Path, metadata: &std::fs::Metadata) -> CommandResult<Probe> {
    if metadata.is_dir() {
        return Ok(Probe::Directory);
    }
    if !metadata.is_file() {
        return Err(AppError::new("unsupported", "errors.specialFileCopyUnsupported", Some(path), true));
    }
    let mtime = metadata.modified().ok().and_then(|time| time.duration_since(UNIX_EPOCH).ok()).map(|age| age.as_secs());
    Ok(Probe::Item(ItemKind::File(FileFacts { size: metadata.len(), mtime })))
}

fn remote_probe(path: &RemotePath, attrs: &FileAttributes) -> CommandResult<Probe> {
    if attrs.is_dir() {
        return Ok(Probe::Directory);
    }
    if !attrs.is_regular() {
        return Err(AppError::new("unsupported", "errors.specialFileCopyUnsupported", Some(Path::new(&path.url())), true));
    }
    Ok(Probe::Item(ItemKind::File(FileFacts { size: attrs.size.unwrap_or(0), mtime: attrs.mtime.map(u64::from) })))
}

fn child_names(context: &TransferContext, at: &Endpoint) -> CommandResult<Vec<String>> {
    let mut names = match at {
        Endpoint::Local(path) => std::fs::read_dir(path)
            .map_err(|error| map_io_error(error, Some(path)))?
            .map(|entry| entry.map(|entry| entry.file_name().to_string_lossy().into_owned()).map_err(|error| map_io_error(error, Some(path))))
            .collect::<CommandResult<Vec<_>>>()?,
        Endpoint::Remote(path) => block_on(read_directory(context.connection(path)?, path))?
            .into_iter()
            .map(|item| item.name)
            .filter(|name| is_listable_name(name))
            .collect(),
    };
    names.sort();
    Ok(names)
}

fn transfer_item(context: &mut TransferContext, item: &TransferItem, at: &Endpoint) -> CommandResult<()> {
    context.check_cancelled(&item.source)?;
    match &item.kind {
        ItemKind::Directory => make_dir(context, at)?,
        ItemKind::Link(target) => make_link(context, target, at)?,
        ItemKind::File(facts) => copy_file(context, &item.source, *facts, at)?,
    }
    context.stats.completed_files += 1;
    context.progress(&item.source, false);
    Ok(())
}

fn make_dir(context: &TransferContext, at: &Endpoint) -> CommandResult<()> {
    match at {
        Endpoint::Local(path) => std::fs::create_dir(path).map_err(|error| map_io_error(error, Some(path))),
        Endpoint::Remote(path) => block_on(context.connection(path)?.sftp.create_dir(path.path.as_str()))
            .map_err(|error| sftp_error(&path.location, &path.path, &error)),
    }
}

fn make_link(context: &TransferContext, target: &str, at: &Endpoint) -> CommandResult<()> {
    match at {
        Endpoint::Local(path) => {
            #[cfg(unix)]
            let result = std::os::unix::fs::symlink(target, path);
            #[cfg(windows)]
            let result = std::os::windows::fs::symlink_file(target.replace('/', "\\"), path);
            result.map_err(|error| map_io_error(error, Some(path)).with_detail("linkTarget", target))
        }
        // OpenSSH 인자 순서: (링크 대상, 새 링크 경로)
        Endpoint::Remote(path) => block_on(context.connection(path)?.sftp.symlink(target, path.path.as_str()))
            .map_err(|error| sftp_error(&path.location, &path.path, &error)),
    }
}

/// 파일 하나 전송. 같은 원본의 임시본이 더 짧게 남아 있고 표본 내용이 원본과 같으면 그 길이부터 이어받기(FR-37.7).
fn copy_file(context: &mut TransferContext, source: &Endpoint, facts: FileFacts, at: &Endpoint) -> CommandResult<()> {
    let source_conn = source_connection(context, source)?;
    let target_conn = source_connection(context, at)?;
    let partial = match at {
        Endpoint::Local(path) => std::fs::metadata(path).ok().filter(|metadata| metadata.is_file()).map(|metadata| metadata.len()),
        Endpoint::Remote(path) => block_on(ops::lstat(context.connection(path)?, path)).ok().filter(FileAttributes::is_regular).and_then(|attrs| attrs.size),
    }
    .filter(|length| *length > 0 && *length < facts.size)
    .unwrap_or(0);
    let resume_from = if partial > 0 && block_on(partial_matches(source, source_conn.as_deref(), at, target_conn.as_deref(), partial))? {
        partial
    } else {
        0
    };
    context.stats.completed_bytes += resume_from;
    let operation_id = context.operation_id.to_string();
    let mut written = resume_from;
    let result = block_on(async {
        let mut reader = open_reader(source, source_conn.as_deref(), resume_from).await?;
        let mut writer = open_writer(at, target_conn.as_deref(), resume_from).await?;
        let mut buffer = vec![0u8; CHUNK_BYTES];
        loop {
            if is_cancelled(&operation_id) {
                return Err(cancelled_error(source));
            }
            let read = reader.read(&mut buffer, source).await?;
            if read == 0 {
                break;
            }
            writer.write(&buffer[..read], at).await?;
            written += read as u64;
            context.stats.completed_bytes += read as u64;
            context.progress(source, false);
        }
        writer.finish(at).await
    });
    result?;
    if written != facts.size {
        return Err(AppError::new("remote_failed", "errors.remoteSizeMismatch", Some(&at.error_path()), true)
            .with_detail("expected", facts.size.to_string())
            .with_detail("actual", written.to_string()));
    }
    if let Some(mtime) = facts.mtime {
        set_mtime(context, at, mtime)?;
    }
    Ok(())
}

const RESUME_SAMPLES: u64 = 16;
const RESUME_WINDOW: u64 = 4096;

/// 이어받기 전 임시본 확인: 고르게 나눈 위치의 내용이 원본과 같아야 함(끊김 전후 처리 순서로 생긴 빈 구간 방지).
async fn partial_matches(
    source: &Endpoint,
    source_conn: Option<&RemoteConnection>,
    partial: &Endpoint,
    partial_conn: Option<&RemoteConnection>,
    length: u64,
) -> CommandResult<bool> {
    let window = RESUME_WINDOW.min(length);
    for index in 0..RESUME_SAMPLES {
        let offset = (length - window) * index / (RESUME_SAMPLES - 1);
        let expected = read_window(source, source_conn, offset, window as usize).await?;
        let actual = read_window(partial, partial_conn, offset, window as usize).await?;
        if expected != actual {
            return Ok(false);
        }
    }
    Ok(true)
}

async fn read_window(at: &Endpoint, connection: Option<&RemoteConnection>, offset: u64, length: usize) -> CommandResult<Vec<u8>> {
    let mut reader = open_reader(at, connection, offset).await?;
    let mut data = vec![0u8; length];
    let mut filled = 0;
    while filled < length {
        let read = reader.read(&mut data[filled..], at).await?;
        if read == 0 {
            break;
        }
        filled += read;
    }
    data.truncate(filled);
    Ok(data)
}

fn source_connection(context: &TransferContext, at: &Endpoint) -> CommandResult<Option<Arc<RemoteConnection>>> {
    match at {
        Endpoint::Local(_) => Ok(None),
        Endpoint::Remote(path) => context.connection(path).map(|connection| Some(Arc::clone(connection))),
    }
}

enum Reader {
    Local(std::fs::File),
    Remote(russh_sftp::client::fs::File),
}

impl Reader {
    async fn read(&mut self, buffer: &mut [u8], at: &Endpoint) -> CommandResult<usize> {
        match self {
            Self::Local(file) => file.read(buffer).map_err(|error| map_io_error(error, Some(&at.error_path()))),
            Self::Remote(file) => file.read(buffer).await.map_err(|error| remote_io_error(at, &error)),
        }
    }
}

enum Writer {
    Local(std::fs::File),
    Remote(russh_sftp::client::fs::File),
}

impl Writer {
    async fn write(&mut self, data: &[u8], at: &Endpoint) -> CommandResult<()> {
        match self {
            Self::Local(file) => file.write_all(data).map_err(|error| map_io_error(error, Some(&at.error_path()))),
            Self::Remote(file) => file.write_all(data).await.map_err(|error| remote_io_error(at, &error)),
        }
    }

    /// 남은 쓰기 응답까지 확인하고 닫기. 원격 쓰기 오류(용량 부족 등)는 여기서 드러날 수 있음.
    async fn finish(self, at: &Endpoint) -> CommandResult<()> {
        match self {
            Self::Local(file) => file.sync_all().map_err(|error| map_io_error(error, Some(&at.error_path()))),
            Self::Remote(file) => file.close().await.map_err(|error| remote_io_error(at, &error)),
        }
    }
}

async fn open_reader(at: &Endpoint, connection: Option<&RemoteConnection>, offset: u64) -> CommandResult<Reader> {
    match (at, connection) {
        (Endpoint::Local(path), _) => {
            let mut file = std::fs::File::open(path).map_err(|error| map_io_error(error, Some(path)))?;
            if offset > 0 {
                file.seek(SeekFrom::Start(offset)).map_err(|error| map_io_error(error, Some(path)))?;
            }
            Ok(Reader::Local(file))
        }
        (Endpoint::Remote(path), Some(connection)) => {
            let mut file = connection.sftp.open(path.path.as_str()).await.map_err(|error| sftp_error(&path.location, &path.path, &error))?;
            if offset > 0 {
                file.seek(SeekFrom::Start(offset)).await.map_err(|error| remote_io_error(at, &error))?;
            }
            Ok(Reader::Remote(file))
        }
        (Endpoint::Remote(path), None) => Err(connection::not_connected(&path.location)),
    }
}

async fn open_writer(at: &Endpoint, connection: Option<&RemoteConnection>, offset: u64) -> CommandResult<Writer> {
    match (at, connection) {
        (Endpoint::Local(path), _) => {
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create(true)
                .truncate(offset == 0)
                .open(path)
                .map_err(|error| map_io_error(error, Some(path)))?;
            if offset > 0 {
                file.seek(SeekFrom::Start(offset)).map_err(|error| map_io_error(error, Some(path)))?;
            }
            Ok(Writer::Local(file))
        }
        (Endpoint::Remote(path), Some(connection)) => {
            let flags = if offset > 0 { OpenFlags::WRITE | OpenFlags::CREATE } else { OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE };
            let mut file = connection
                .sftp
                .open_with_flags(path.path.as_str(), flags)
                .await
                .map_err(|error| sftp_error(&path.location, &path.path, &error))?;
            if offset > 0 {
                file.seek(SeekFrom::Start(offset)).await.map_err(|error| remote_io_error(at, &error))?;
            }
            Ok(Writer::Remote(file))
        }
        (Endpoint::Remote(path), None) => Err(connection::not_connected(&path.location)),
    }
}

/// 파일 핸들 읽기·쓰기 오류: 연결이 끊겼으면 끊김, 그 밖은 서버 문구를 담은 원격 오류.
fn remote_io_error(at: &Endpoint, error: &std::io::Error) -> AppError {
    let closed = matches!(at, Endpoint::Remote(path) if connection::connection(&path.location).is_err());
    let (code, key) = if closed {
        ("remote_connection_lost", "errors.remoteConnectionLost")
    } else {
        ("remote_failed", "errors.remoteOperationFailed")
    };
    AppError::new(code, key, Some(&at.error_path()), true).with_detail("serverMessage", error.to_string().chars().take(200).collect::<String>())
}

fn set_mtime(context: &TransferContext, at: &Endpoint, mtime: u64) -> CommandResult<()> {
    match at {
        Endpoint::Local(path) => std::fs::File::options()
            .write(true)
            .open(path)
            .and_then(|file| file.set_modified(UNIX_EPOCH + Duration::from_secs(mtime)))
            .map_err(|error| map_io_error(error, Some(path))),
        Endpoint::Remote(path) => {
            let seconds = u32::try_from(mtime).unwrap_or(u32::MAX);
            let attrs = FileAttributes { atime: Some(seconds), mtime: Some(seconds), ..FileAttributes::empty() };
            block_on(context.connection(path)?.sftp.set_metadata(path.path.as_str(), attrs))
                .map_err(|error| sftp_error(&path.location, &path.path, &error))
        }
    }
}

/// 임시본을 최종 이름으로 게시. 기존 항목이 있으면(덮어쓰기 선택) 백업으로 옮긴 뒤 게시하고 백업 삭제.
fn publish(context: &TransferContext, stage: &Endpoint, destination: &Endpoint, replace: bool) -> CommandResult<()> {
    match (stage, destination) {
        (Endpoint::Local(stage), Endpoint::Local(destination)) => {
            if replace {
                publish_replacement(stage, destination, crate::mutation::rename_no_replace)
            } else {
                crate::mutation::rename_no_replace(stage, destination).map_err(|error| map_io_error(error, Some(destination)))
            }
        }
        (Endpoint::Remote(stage), Endpoint::Remote(destination)) => {
            let connection = context.connection(destination)?;
            if replace {
                remote_replace(connection, stage, destination)
            } else {
                block_on(ops::rename_no_replace(connection, stage, destination))
            }
        }
        _ => Err(AppError::new("invalid_path", "errors.invalidPath", Some(&destination.error_path()), true)),
    }
}

/// 원격 교체: 기존 항목을 백업 이름으로 옮기고 새 항목을 게시한 뒤 백업 삭제, 게시 실패 시 백업 복원.
fn remote_replace(connection: &RemoteConnection, staged: &RemotePath, destination: &RemotePath) -> CommandResult<()> {
    let parent = destination.parent().ok_or_else(|| ops::already_exists(destination))?;
    let backup = parent.join(&format!(
        ".{}.boksldir-backup-{}-{}",
        destination.file_name().unwrap_or("entry").chars().take(120).collect::<String>(),
        std::process::id(),
        STAGE_NONCE.fetch_add(1, Ordering::Relaxed)
    ));
    block_on(ops::rename_no_replace(connection, destination, &backup))?;
    if let Err(error) = block_on(ops::rename_no_replace(connection, staged, destination)) {
        let _ = block_on(ops::rename_no_replace(connection, &backup, destination));
        return Err(error);
    }
    remove_remote_tree(connection, &backup)
}

fn remove_tree(context: &TransferContext, at: &Endpoint) -> CommandResult<()> {
    match at {
        Endpoint::Local(path) => {
            if !path_is_occupied(path) {
                return Ok(());
            }
            remove_entry_any(path).map_err(|error| map_io_error(error, Some(path)))
        }
        Endpoint::Remote(path) => {
            let connection = context.connection(path)?;
            if !block_on(ops::exists(connection, path))? {
                return Ok(());
            }
            remove_remote_tree(connection, path)
        }
    }
}

fn remove_remote_tree(connection: &RemoteConnection, path: &RemotePath) -> CommandResult<()> {
    let items = block_on(ops::scan_tree(connection, path, &|_| Ok(())))?;
    for item in &items {
        block_on(ops::remove(connection, item))?;
    }
    Ok(())
}

/// 시험용: 취소 요청을 받을 수 있게 작업을 등록한 상태로 실행.
#[cfg(test)]
pub(crate) fn run_registered_for_test(
    operation_id: &str,
    kind: OperationKind,
    sources: &[String],
    target_dir: &str,
    policy: ConflictDecision,
    link_policy: RemoteLinkPolicy,
) -> OperationSummary {
    super::runtime::register_operation(operation_id);
    let summary = run_remote_transfer(None, operation_id, kind, sources, target_dir, policy, link_policy);
    super::runtime::finish_operation(operation_id);
    summary
}

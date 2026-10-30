//! 원격 파일 관리 요청: 이름 검증, 새 폴더, 덮어쓰기 금지 이름 변경, 트리 순회, 삭제·권한 변경 단위 요청.
use super::connection::{self, sftp_error, RemoteConnection};
use super::listing::{entry_from_attrs, existing_directory, is_listable_name, read_directory};
use super::path::RemotePath;
use crate::contracts::{AppError, CommandResult, FileEntry};
use russh_sftp::protocol::{FileAttributes, StatusCode};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

/// 순회 결과 항목: 링크는 따라가지 않은 속성(lstat).
pub(crate) struct RemoteTreeItem {
    pub(crate) path: RemotePath,
    pub(crate) attrs: FileAttributes,
}

/// 원격 이름 검증: 로컬(Windows 외)과 같은 규칙. 앞뒤 공백 제거, 빈 이름·`.`·`..`·`/`·`\`·NUL 거부.
pub(crate) fn validate_name<'a>(name: &'a str, at: &RemotePath) -> CommandResult<&'a str> {
    let trimmed = name.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." || trimmed.contains(['/', '\\', '\0']) {
        return Err(AppError::new("invalid_name", "errors.invalidName", Some(Path::new(&at.url())), true)
            .with_detail("name", trimmed));
    }
    Ok(trimmed)
}

pub(crate) fn already_exists(path: &RemotePath) -> AppError {
    AppError::new("already_exists", "errors.alreadyExists", Some(Path::new(&path.url())), true)
}

/// 원격 루트·홈은 삭제 대상에서 제외(로컬 보호 경로와 같은 오류).
pub(crate) fn guard_delete_target(connection: &RemoteConnection, path: &RemotePath) -> CommandResult<()> {
    if path.path == "/" || path.path == connection.home {
        return Err(AppError::new("invalid_path", "errors.protectedPath", Some(Path::new(&path.url())), true));
    }
    Ok(())
}

/// 여러 원격 대상의 공통 연결. 서로 다른 서버가 섞이면 거부, 다른 대상 안에 든 대상은 제외.
pub(crate) fn same_location_targets(targets: &[String]) -> CommandResult<(Arc<RemoteConnection>, Vec<RemotePath>)> {
    let parsed = targets.iter().map(|target| RemotePath::parse(target)).collect::<CommandResult<Vec<_>>>()?;
    let Some(first) = parsed.first() else {
        return Err(AppError::new("invalid_path", "errors.emptyOperation", None, true));
    };
    if parsed.iter().any(|path| path.location != first.location) {
        return Err(AppError::new("invalid_path", "errors.remoteMixedLocations", None, true));
    }
    let connection = connection::connection(&first.location)?;
    let nested = |path: &RemotePath| {
        parsed.iter().any(|other| other.path != path.path && path.path.starts_with(&format!("{}/", other.path.trim_end_matches('/'))))
    };
    let mut roots: Vec<RemotePath> = Vec::new();
    for path in &parsed {
        if !nested(path) && !roots.contains(path) {
            roots.push(path.clone());
        }
    }
    Ok((connection, roots))
}

pub(crate) async fn lstat(connection: &RemoteConnection, path: &RemotePath) -> CommandResult<FileAttributes> {
    connection
        .sftp
        .symlink_metadata(path.path.as_str())
        .await
        .map_err(|error| sftp_error(&path.location, &path.path, &error))
}

/// 항목 존재 여부(링크 자체 기준). 없음 외 오류는 그대로 반환.
pub(crate) async fn exists(connection: &RemoteConnection, path: &RemotePath) -> CommandResult<bool> {
    match connection.sftp.symlink_metadata(path.path.as_str()).await {
        Ok(_) => Ok(true),
        Err(russh_sftp::client::error::Error::Status(status)) if status.status_code == StatusCode::NoSuchFile => Ok(false),
        Err(error) => Err(sftp_error(&path.location, &path.path, &error)),
    }
}

async fn entry_of(connection: &RemoteConnection, path: &RemotePath) -> CommandResult<FileEntry> {
    let attrs = lstat(connection, path).await?;
    Ok(entry_from_attrs(path, path.file_name().unwrap_or("/"), &attrs, None))
}

pub(crate) async fn create_dir(parent: &str, name: &str) -> CommandResult<FileEntry> {
    let requested = RemotePath::parse(parent)?;
    let connection = connection::connection(&requested.location)?;
    let (parent, _) = existing_directory(&connection, &requested).await?;
    let target = parent.join(validate_name(name, &parent)?);
    if exists(&connection, &target).await? {
        return Err(already_exists(&target));
    }
    connection
        .sftp
        .create_dir(target.path.as_str())
        .await
        .map_err(|error| sftp_error(&target.location, &target.path, &error))?;
    entry_of(&connection, &target).await
}

pub(crate) async fn rename_entry(path: &str, new_name: &str) -> CommandResult<FileEntry> {
    let source = RemotePath::parse(path)?;
    let connection = connection::connection(&source.location)?;
    let Some(parent) = source.parent() else {
        return Err(AppError::new("invalid_path", "errors.protectedPath", Some(Path::new(&source.url())), true));
    };
    lstat(&connection, &source).await?;
    let target = parent.join(validate_name(new_name, &parent)?);
    if target != source {
        rename_no_replace(&connection, &source, &target).await?;
    }
    entry_of(&connection, &target).await
}

static RENAME_NONCE: AtomicU64 = AtomicU64::new(0);

/// 덮어쓰기 금지 이름 변경. 대소문자만 바뀌면 대소문자 무시 파일 시스템에서 같은 항목일 수 있어
/// 목록에서 정확한 이름을 확인하고, 별칭이면 임시 이름을 거쳐 변경.
pub(crate) async fn rename_no_replace(connection: &RemoteConnection, source: &RemotePath, target: &RemotePath) -> CommandResult<()> {
    let parent = target.parent();
    let case_only = source.parent() == parent
        && source.file_name().map(str::to_lowercase) == target.file_name().map(str::to_lowercase);
    if !case_only {
        if exists(connection, target).await? {
            return Err(already_exists(target));
        }
        return plain_rename(connection, source, target).await;
    }
    let Some(parent) = parent else {
        return Err(already_exists(target));
    };
    let exact = read_directory(connection, &parent).await?.iter().any(|item| Some(item.name.as_str()) == target.file_name());
    if exact {
        return Err(already_exists(target));
    }
    if !exists(connection, target).await? {
        return plain_rename(connection, source, target).await;
    }
    let nonce = RENAME_NONCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(&format!(".boksldir-rename-{}-{nonce}", std::process::id()));
    plain_rename(connection, source, &temporary).await?;
    if let Err(error) = plain_rename(connection, &temporary, target).await {
        let _ = plain_rename(connection, &temporary, source).await;
        return Err(error);
    }
    Ok(())
}

/// SSH_FXP_RENAME: OpenSSH는 대상이 있으면 실패하므로 서버 쪽에서도 덮어쓰지 않음.
async fn plain_rename(connection: &RemoteConnection, source: &RemotePath, target: &RemotePath) -> CommandResult<()> {
    connection
        .sftp
        .rename(source.path.as_str(), target.path.as_str())
        .await
        .map_err(|error| sftp_error(&target.location, &target.path, &error))
}

/// 하위 항목이 상위 폴더보다 먼저 오는 깊이 우선 순서로 모음. 링크는 따라가지 않고, 경로 조작 이름은 제외.
/// `check`는 항목마다 호출하는 취소 확인.
pub(crate) async fn scan_tree(
    connection: &RemoteConnection,
    root: &RemotePath,
    check: &dyn Fn(&RemotePath) -> CommandResult<()>,
) -> CommandResult<Vec<RemoteTreeItem>> {
    let attrs = lstat(connection, root).await?;
    let mut ordered = Vec::new();
    let mut stack = vec![(root.clone(), attrs, false)];
    while let Some((path, attrs, expanded)) = stack.pop() {
        check(&path)?;
        if attrs.is_dir() && !expanded {
            let children = read_directory(connection, &path).await?;
            stack.push((path.clone(), attrs, true));
            for item in children {
                if is_listable_name(&item.name) {
                    stack.push((path.join(&item.name), item.attrs, false));
                }
            }
        } else {
            ordered.push(RemoteTreeItem { path, attrs });
        }
    }
    Ok(ordered)
}

/// 항목 하나 삭제: 폴더는 비어 있어야 함, 링크는 링크 자체만 삭제.
pub(crate) async fn remove(connection: &RemoteConnection, item: &RemoteTreeItem) -> CommandResult<()> {
    let path = item.path.path.as_str();
    let result = if item.attrs.is_dir() {
        connection.sftp.remove_dir(path).await
    } else {
        connection.sftp.remove_file(path).await
    };
    result.map_err(|error| sftp_error(&item.path.location, &item.path.path, &error))
}

/// 권한 비트(파일 종류 비트 제외)만 바꾸는 SETSTAT.
pub(crate) async fn set_permissions(connection: &RemoteConnection, path: &RemotePath, mode: u32) -> CommandResult<()> {
    let attrs = FileAttributes { permissions: Some(mode & 0o7777), ..FileAttributes::empty() };
    connection
        .sftp
        .set_metadata(path.path.as_str(), attrs)
        .await
        .map_err(|error| sftp_error(&path.location, &path.path, &error))
}

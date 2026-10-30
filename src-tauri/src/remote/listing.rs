//! 원격 디렉터리 목록과 경로 이동: SFTP 목록을 패널 항목으로 변환, 심볼릭 링크 대상 종류 확인.
use super::connection::{self, sftp_error, RemoteConnection};
use super::path::{is_remote_path, RemotePath};
use crate::contracts::{
    AppError, CommandResult, DirectoryListing, EntryKind, FileEntry, FileMetadata, PanelId, SortSpec,
};
use crate::filesystem::{is_hidden_name, mime_from_extension, sort_entries};
use russh_sftp::protocol::{FileAttributes, FileType};
use std::path::Path;
use std::sync::Arc;

/// 한 목록에 담는 원격 항목 상한(NFR-4.3). 넘으면 정렬 순서 앞쪽만 담고 잘림 표시.
const MAX_REMOTE_ENTRIES: usize = 50_000;
/// 심볼릭 링크 대상 확인 동시 요청 수.
const LINK_LOOKUP_BATCH: usize = 32;

/// 원격 목록 한 항목: 이름, `ls -l` 형식 설명(소유자·그룹 이름 추출용), 속성.
pub(crate) struct RemoteDirItem {
    pub(crate) name: String,
    pub(crate) longname: String,
    pub(crate) attrs: FileAttributes,
}

pub(crate) async fn list_dir(
    panel_id: PanelId,
    path: &str,
    show_hidden: bool,
    sort: SortSpec,
    filter: Option<String>,
) -> CommandResult<DirectoryListing> {
    list_dir_limited(panel_id, path, show_hidden, sort, filter, MAX_REMOTE_ENTRIES).await
}

pub(crate) async fn list_dir_limited(
    panel_id: PanelId,
    path: &str,
    show_hidden: bool,
    sort: SortSpec,
    filter: Option<String>,
    limit: usize,
) -> CommandResult<DirectoryListing> {
    let requested = RemotePath::parse(path)?;
    let connection = connection::connection(&requested.location)?;
    let (directory, attrs) = existing_directory(&connection, &requested).await?;
    let filter_text = filter
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_lowercase);
    let mut entries = Vec::new();
    if let Some(parent) = directory.parent() {
        entries.push(parent_entry(&parent));
    }
    let mut links = Vec::new();
    for item in read_directory(&connection, &directory).await? {
        if !is_listable_name(&item.name)
            || (!show_hidden && is_hidden_name(&item.name))
            || filter_text.as_deref().is_some_and(|text| !item.name.to_lowercase().contains(text))
        {
            continue;
        }
        let entry = entry_from_item(&directory, &item);
        if entry.kind == EntryKind::Symlink {
            links.push(entries.len());
        }
        entries.push(entry);
    }
    resolve_link_targets(&connection, &mut entries, &links).await;
    sort_entries(&mut entries, &sort);
    let total = entries.iter().filter(|entry| !entry.is_virtual).count();
    let truncated = total > limit;
    if truncated {
        entries.truncate(limit + usize::from(directory.parent().is_some()));
    }
    Ok(DirectoryListing {
        panel_id,
        path: directory.url(),
        entries,
        sort,
        filter,
        version: attrs.mtime.map(u64::from).unwrap_or(1),
        total_entries: truncated.then_some(total),
        truncated: truncated.then_some(true),
    })
}

/// 주소 입력 이동: `sftp://` 입력은 그대로, 원격 패널 기준의 `~`·상대 경로는 원격 홈·현재 폴더 기준 해석(FR-36.4).
pub(crate) async fn goto_path(panel_id: PanelId, input: &str, base: Option<&str>) -> CommandResult<DirectoryListing> {
    let input = input.trim();
    let target = if is_remote_path(input) {
        RemotePath::parse(input)?
    } else {
        let base = RemotePath::parse(base.unwrap_or_default())?;
        let connection = connection::connection(&base.location)?;
        base.resolve(input, &connection.home)
    };
    list_dir(panel_id, &target.url(), false, SortSpec::default(), None).await
}

/// 원격 항목 정보. 링크는 링크 자체를 설명하고 대상 종류만 확인, 폴더 크기 합계는 계산하지 않음.
pub(crate) async fn metadata(path: &str) -> CommandResult<FileMetadata> {
    let target = RemotePath::parse(path)?;
    let connection = connection::connection(&target.location)?;
    let attrs = connection
        .sftp
        .symlink_metadata(target.path.as_str())
        .await
        .map_err(|error| sftp_error(&target.location, &target.path, &error))?;
    let name = target.file_name().unwrap_or("/").to_string();
    let mut entry = entry_from_attrs(&target, &name, &attrs, None);
    if entry.kind == EntryKind::Symlink {
        entry.symlink_target_is_directory =
            connection.sftp.metadata(target.path.as_str()).await.ok().map(|attrs| attrs.is_dir());
    }
    let extension = Path::new(&name).extension().and_then(|value| value.to_str()).map(str::to_string);
    let mime_type = extension.as_deref().and_then(mime_from_extension).map(str::to_string);
    Ok(FileMetadata {
        absolute_path: target.url(),
        extension,
        mime_type,
        readonly: attrs.permissions.is_some_and(|mode| mode & 0o222 == 0),
        directory_stats: None,
        image_metadata: None,
        entry,
    })
}

/// 실제 경로(심볼릭 링크 해석)와 디렉터리 여부 확인.
pub(crate) async fn existing_directory(
    connection: &RemoteConnection,
    requested: &RemotePath,
) -> CommandResult<(RemotePath, FileAttributes)> {
    let real = connection
        .sftp
        .canonicalize(requested.path.as_str())
        .await
        .map_err(|error| sftp_error(&requested.location, &requested.path, &error))?;
    let directory = RemotePath::new(requested.location.clone(), &real);
    let attrs = connection
        .sftp
        .metadata(directory.path.as_str())
        .await
        .map_err(|error| sftp_error(&directory.location, &directory.path, &error))?;
    if !attrs.is_dir() {
        return Err(AppError::new("not_directory", "errors.notDirectory", Some(Path::new(&directory.url())), true));
    }
    Ok((directory, attrs))
}

/// SFTP READDIR 전체 읽기. 목록 설명(longname)을 함께 받으려고 원시 세션 사용.
pub(crate) async fn read_directory(connection: &RemoteConnection, directory: &RemotePath) -> CommandResult<Vec<RemoteDirItem>> {
    let raw = &connection.raw;
    let to_error = |error: russh_sftp::client::error::Error| sftp_error(&directory.location, &directory.path, &error);
    let handle = raw.opendir(directory.path.as_str()).await.map_err(to_error)?.handle;
    let mut items = Vec::new();
    let result = loop {
        match raw.readdir(handle.as_str()).await {
            Ok(name) => items.extend(name.files.into_iter().map(|file| RemoteDirItem {
                name: file.filename,
                longname: file.longname,
                attrs: file.attrs,
            })),
            Err(russh_sftp::client::error::Error::Status(status))
                if status.status_code == russh_sftp::protocol::StatusCode::Eof =>
            {
                break Ok(());
            }
            Err(error) => break Err(to_error(error)),
        }
    };
    let _ = raw.close(handle.as_str()).await;
    result.map(|()| items)
}

/// 경로 구분자·빈 이름·`.`·`..`이 섞인 서버 응답 이름은 경로 조작 방지로 제외.
pub(crate) fn is_listable_name(name: &str) -> bool {
    !name.is_empty() && name != "." && name != ".." && !name.contains('/') && !name.contains('\0')
}

fn parent_entry(parent: &RemotePath) -> FileEntry {
    FileEntry {
        path: parent.url(),
        name: "..".to_string(),
        kind: EntryKind::Directory,
        symlink_target_is_directory: None,
        size_bytes: None,
        modified_at: None,
        created_at: None,
        permissions: None,
        owner: None,
        group: None,
        is_hidden: false,
        is_virtual: true,
    }
}

pub(crate) fn entry_from_item(directory: &RemotePath, item: &RemoteDirItem) -> FileEntry {
    entry_from_attrs(&directory.join(&item.name), &item.name, &item.attrs, Some(&item.longname))
}

pub(crate) fn entry_from_attrs(path: &RemotePath, name: &str, attrs: &FileAttributes, longname: Option<&str>) -> FileEntry {
    let kind = match attrs.file_type() {
        FileType::Dir => EntryKind::Directory,
        FileType::Symlink => EntryKind::Symlink,
        FileType::File if attrs.permissions.is_some_and(|mode| mode & 0o111 != 0) => EntryKind::Executable,
        FileType::File => EntryKind::File,
        FileType::Other => EntryKind::Unknown,
    };
    let (owner, group) = longname.and_then(owner_group_names).unzip();
    FileEntry {
        path: path.url(),
        name: name.to_string(),
        size_bytes: (kind != EntryKind::Directory).then_some(attrs.size).flatten(),
        modified_at: attrs.mtime.and_then(|seconds| chrono::DateTime::from_timestamp(i64::from(seconds), 0)).map(|time| time.to_rfc3339()),
        created_at: None,
        permissions: attrs.permissions.map(|mode| mode_text(mode, &kind)),
        owner: owner.or_else(|| attrs.uid.map(|uid| uid.to_string())),
        group: group.or_else(|| attrs.gid.map(|gid| gid.to_string())),
        is_hidden: is_hidden_name(name),
        is_virtual: false,
        symlink_target_is_directory: None,
        kind,
    }
}

/// OpenSSH 목록 설명 `-rw-r--r--  1 user group 12 Jan 1 00:00 name`의 소유자·그룹 이름.
fn owner_group_names(longname: &str) -> Option<(String, String)> {
    let mut fields = longname.split_whitespace();
    let mode = fields.next()?;
    let mode_like = mode.len() >= 10 && mode.starts_with(['-', 'd', 'l', 'c', 'b', 'p', 's']);
    if !mode_like {
        return None;
    }
    let _links = fields.next()?;
    Some((fields.next()?.to_string(), fields.next()?.to_string()))
}

fn mode_text(mode: u32, kind: &EntryKind) -> String {
    let mut text = String::with_capacity(10);
    text.push(match kind {
        EntryKind::Directory => 'd',
        EntryKind::Symlink => 'l',
        _ => '-',
    });
    for (bit, flag) in [(0o400, 'r'), (0o200, 'w'), (0o100, 'x'), (0o040, 'r'), (0o020, 'w'), (0o010, 'x'), (0o004, 'r'), (0o002, 'w'), (0o001, 'x')] {
        text.push(if mode & bit != 0 { flag } else { '-' });
    }
    text
}

/// 심볼릭 링크 대상이 디렉터리인지 확인(FR-36.5). 끊긴 링크는 미확인으로 유지.
async fn resolve_link_targets(connection: &Arc<RemoteConnection>, entries: &mut [FileEntry], links: &[usize]) {
    for batch in links.chunks(LINK_LOOKUP_BATCH) {
        let mut lookups = tokio::task::JoinSet::new();
        for &index in batch {
            let connection = Arc::clone(connection);
            let Ok(target) = RemotePath::parse(&entries[index].path) else {
                continue;
            };
            lookups.spawn(async move {
                let is_dir = connection.sftp.metadata(target.path.as_str()).await.ok().map(|attrs| attrs.is_dir());
                (index, is_dir)
            });
        }
        while let Some(Ok((index, is_dir))) = lookups.join_next().await {
            entries[index].symlink_target_is_directory = is_dir;
        }
    }
}

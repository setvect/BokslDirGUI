//! 원격 다중 이름 변경 계획(FR-38.5): 로컬과 같은 이름 규칙·충돌 판정, 원본 표식은 크기·수정 시각·권한.
use super::connection::RemoteConnection;
use super::ops::{exists, lstat, validate_name};
use super::path::RemotePath;
use crate::bulk_rename::{planned_name, validate_preview_input};
use crate::contracts::{AppError, CommandResult, RenameItem, RenamePreview, RenameRules};
use russh_sftp::protocol::FileAttributes;
use std::collections::HashSet;
use std::path::Path;

pub(crate) fn stamp(attrs: &FileAttributes) -> String {
    format!(
        "{}:{}:{}",
        attrs.size.unwrap_or_default(),
        attrs.mtime.unwrap_or_default(),
        attrs.permissions.unwrap_or_default()
    )
}

pub(crate) async fn preview(sources: Vec<String>, rules: RenameRules) -> CommandResult<Vec<RenamePreview>> {
    validate_preview_input(&sources, &rules)?;
    let parsed = sources.iter().map(|source| RemotePath::parse(source)).collect::<CommandResult<Vec<_>>>()?;
    let connection = plan_connection(&parsed)?;
    let mut rows = Vec::with_capacity(parsed.len());
    for (index, source) in parsed.iter().enumerate() {
        let attrs = lstat(&connection, source).await?;
        let name = source.file_name().ok_or_else(|| invalid(source))?;
        let new_name = planned_name(name, attrs.is_dir(), &rules, index);
        rows.push(RenamePreview {
            changed: new_name != name,
            item: RenameItem { source: source.url(), new_name, stamp: stamp(&attrs) },
            error: None,
        });
    }
    let items: Vec<RenameItem> = rows.iter().map(|row| row.item.clone()).collect();
    for (row, error) in rows.iter_mut().zip(plan_errors(&connection, &items).await) {
        row.error = error;
    }
    Ok(rows)
}

/// 실행 전 전체 계획 검증. 첫 오류 반환.
pub(crate) async fn validate_plan(connection: &RemoteConnection, items: &[RenameItem]) -> CommandResult<()> {
    if items.is_empty() || items.len() > 10_000 {
        return Err(AppError::new("invalid_name", "errors.invalidName", None, true));
    }
    match plan_errors(connection, items).await.into_iter().flatten().next() {
        Some(error) => Err(error),
        None => Ok(()),
    }
}

/// 계획의 원격 연결. 서로 다른 서버가 섞이면 거부.
pub(crate) fn plan_connection(sources: &[RemotePath]) -> CommandResult<std::sync::Arc<RemoteConnection>> {
    let Some(first) = sources.first() else {
        return Err(AppError::new("invalid_name", "errors.invalidName", None, true));
    };
    if sources.iter().any(|source| source.location != first.location) {
        return Err(AppError::new("invalid_path", "errors.remoteMixedLocations", None, true));
    }
    super::connection::connection(&first.location)
}

/// 항목별 오류: 이름 규칙, 원본 변경, 대상 충돌, 중첩 원본, 계획 안 중복(서버 대소문자 구분을 알 수 없어 보수적으로 비교).
async fn plan_errors(connection: &RemoteConnection, items: &[RenameItem]) -> Vec<Option<AppError>> {
    let sources: HashSet<String> = items
        .iter()
        .filter_map(|item| RemotePath::parse(&item.source).ok())
        .map(|source| source.path)
        .collect();
    let mut targets = HashSet::new();
    let mut seen_sources = HashSet::new();
    let mut errors = Vec::with_capacity(items.len());
    for item in items {
        let checked = check_item(connection, item, &sources).await;
        let duplicate = checked.as_ref().ok().is_some_and(|target| {
            !targets.insert(target.path.to_lowercase()) || !seen_sources.insert(item.source.clone())
        });
        errors.push(match checked {
            Err(error) => Some(error),
            Ok(_) if duplicate => Some(
                AppError::new("already_exists", "errors.renameDuplicate", Some(Path::new(&item.source)), true),
            ),
            Ok(_) => None,
        });
    }
    errors
}

/// 항목 하나 검증. 통과하면 대상 경로 반환.
pub(crate) async fn check_item(
    connection: &RemoteConnection,
    item: &RenameItem,
    sources: &HashSet<String>,
) -> CommandResult<RemotePath> {
    let source = RemotePath::parse(&item.source)?;
    let parent = source.parent().ok_or_else(|| invalid(&source))?;
    let target = parent.join(validate_name(&item.new_name, &parent)?);
    let attrs = lstat(connection, &source).await?;
    if stamp(&attrs) != item.stamp {
        return Err(AppError::new("source_changed", "errors.renameSourceChanged", Some(Path::new(&item.source)), true));
    }
    let case_only = source.file_name().map(str::to_lowercase) == target.file_name().map(str::to_lowercase);
    if target != source && !case_only && exists(connection, &target).await? {
        return Err(super::ops::already_exists(&target));
    }
    let nested = std::iter::successors(source.parent(), RemotePath::parent).any(|ancestor| sources.contains(&ancestor.path));
    if nested {
        return Err(AppError::new("invalid_path", "errors.renameNestedSources", Some(Path::new(&item.source)), true));
    }
    Ok(target)
}

fn invalid(path: &RemotePath) -> AppError {
    AppError::new("invalid_name", "errors.invalidName", Some(Path::new(&path.url())), true)
}

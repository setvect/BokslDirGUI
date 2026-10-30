use crate::contracts::{AppError, ArchiveListing, CommandResult, EntryKind, FileEntry};
use crate::archive_provider::is_archive_path;
use crate::filesystem::map_io_error;
use crate::navigation;
use crate::path_text::display_path;
use std::path::Path;
use std::process::Command;

const DEFAULT_ARCHIVE_LIST_LIMIT: usize = 50_000;
const MAX_ARCHIVE_LIST_LIMIT: usize = 200_000;

#[derive(Debug, Clone, PartialEq, Eq)]
struct ArchiveEntryInfo {
    path: String,
    kind: EntryKind,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    created_at: Option<String>,
    permissions: Option<String>,
}

pub(crate) fn archive_list(
    archive_path: &str,
    password: Option<String>,
    limit: Option<usize>,
) -> CommandResult<ArchiveListing> {
    let archive = navigation::canonical_existing_path(archive_path)?;
    let password = password.as_deref().filter(|value| !value.is_empty());
    let (entries, encrypted) = list_archive_entries(&archive, password)?;
    let total_entries = entries.len() as u64;
    let limit = limit
        .unwrap_or(DEFAULT_ARCHIVE_LIST_LIMIT)
        .clamp(1, MAX_ARCHIVE_LIST_LIMIT);
    let truncated = entries.len() > limit;
    let entries = entries
        .iter()
        .take(limit)
        .map(|entry| archive_entry_for_info(&archive, entry))
        .collect();
    Ok(ArchiveListing {
        archive_path: display_path(&archive),
        entries,
        encrypted,
        total_entries,
        truncated,
    })
}

fn list_archive_entries(
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<(Vec<ArchiveEntryInfo>, bool)> {
    match crate::archive_provider::archive_format(archive) {
        Some("zip" | "jar" | "war") if crate::archive_provider::zip_uses_seven_zip() => {
            list_7z_entries_with_metadata(archive, password)
        }
        Some("zip" | "jar" | "war") => list_zip_entries_with_metadata(archive, password),
        Some("7z") => list_7z_entries_with_metadata(archive, password),
        Some("tar" | "tar.gz" | "tar.zst") => {
            list_tar_entries_with_metadata(archive).map(|entries| (entries, false))
        }
        _ => Err(AppError::new(
            "unsupported",
            "errors.archiveFormatUnsupported",
            Some(archive),
            true,
        )),
    }
}

// Apps launched from Finder inherit no LANG, and the system tar then escapes
// UTF-8 names as octal bytes. Pin a UTF-8 locale for the listing tools.
fn listing_tool(program: &str) -> Command {
    let mut command = Command::new(program);
    #[cfg(target_os = "macos")]
    command.env("LC_ALL", "en_US.UTF-8");
    command
}

// macOS unzip -Z1 mangles UTF-8 filenames when the ZIP UTF-8 flag is absent.
// The system tar (libarchive) preserves the stored names, including archives
// written by macOS zip, while unzip still supplies the metadata below.
pub(crate) fn zip_name_listing_command(archive: &Path) -> Command {
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = listing_tool("tar");
        command.arg("-tf");
        command
    };
    #[cfg(not(target_os = "macos"))]
    let mut command = {
        let mut command = listing_tool("unzip");
        command.arg("-Z1");
        command
    };
    command.arg(archive);
    command
}

fn list_zip_entries_with_metadata(
    archive: &Path,
    _password: Option<&str>,
) -> CommandResult<(Vec<ArchiveEntryInfo>, bool)> {
    let output = zip_name_listing_command(archive)
        .output()
        .map_err(|error| map_io_error(error, Some(archive)))?;
    let names = parse_zip_name_output(output, archive, None)?;
    let detail_output = listing_tool("unzip")
        .args(["-Z", "-T", "-l"])
        .arg(archive)
        .output()
        .map_err(|error| map_io_error(error, Some(archive)))?;
    let encrypted = zipinfo_long_output_has_encrypted_entry(&detail_output.stdout);
    let entries = parse_zipinfo_long_output(detail_output, archive, &names)?;
    Ok((entries, encrypted))
}

fn list_7z_entries_with_metadata(
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<(Vec<ArchiveEntryInfo>, bool)> {
    let binary = crate::archive_provider::require_tool("7z", archive)?;
    let mut command = Command::new(binary);
    crate::platform::hide_console_window(&mut command);
    command.args(["l", "-slt", "-sccUTF-8"]);
    if let Some(password) = password {
        command.arg(format!("-p{password}"));
    }
    let output = command
        .arg(archive)
        .output()
        .map_err(|error| map_io_error(error, Some(archive)))?;
    if !output.status.success() {
        return Err(archive_provider_output_error(&output, archive, password));
    }
    let encrypted = String::from_utf8_lossy(&output.stdout).contains("Encrypted = +");
    Ok((parse_7z_slt_entries(&output.stdout), encrypted))
}

fn list_tar_entries_with_metadata(archive: &Path) -> CommandResult<Vec<ArchiveEntryInfo>> {
    let format = crate::archive_provider::archive_format(archive).unwrap_or_default();
    let members = crate::archive_tar::list(archive, format, &|| false)
        .map_err(|error| map_io_error(error, Some(archive)))?;
    Ok(members.into_iter().map(|member| ArchiveEntryInfo {
        kind: if member.link { EntryKind::Symlink }
            else { entry_kind_for_archive_member(&member.path, member.directory, None, None) },
        path: member.path,
        size_bytes: if member.directory { None } else { Some(member.size) },
        modified_at: None, created_at: None, permissions: None,
    }).collect())
}

fn archive_provider_output_error(
    output: &std::process::Output,
    archive: &Path,
    password: Option<&str>,
) -> AppError {
    let stderr = String::from_utf8_lossy(&output.stderr);
    let lowered = stderr.to_ascii_lowercase();
    let password_error = lowered.contains("password") || lowered.contains("encrypted");
    let (code, message_key) = if password_error && password.is_some() {
        ("invalid_password", "errors.archivePasswordInvalid")
    } else if password_error {
        ("password_required", "errors.archivePasswordRequired")
    } else {
        ("external_command_failed", "errors.externalCommandFailed")
    };
    let stderr = stderr.into_owned();
    let stderr = password
        .filter(|secret| !secret.is_empty())
        .map_or(stderr.clone(), |secret| {
            stderr.replace(secret, "[redacted]")
        });
    AppError::new(code, message_key, Some(archive), true)
        .with_detail("stderr", stderr.chars().take(512).collect::<String>())
}


fn parse_zip_name_output(
    output: std::process::Output,
    archive: &Path,
    password: Option<&str>,
) -> CommandResult<Vec<String>> {
    if !output.status.success() {
        return Err(archive_provider_output_error(&output, archive, password));
    }
    Ok(String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect())
}

fn parse_zipinfo_long_output(
    output: std::process::Output,
    archive: &Path,
    names: &[String],
) -> CommandResult<Vec<ArchiveEntryInfo>> {
    if !output.status.success() {
        return Err(AppError::new(
            "external_command_failed",
            "errors.externalCommandFailed",
            Some(archive),
            true,
        )
        .with_detail(
            "stderr",
            String::from_utf8_lossy(&output.stderr)
                .chars()
                .take(512)
                .collect::<String>(),
        ));
    }

    let metadata: Vec<ZipInfoMetadata> = String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter_map(parse_zipinfo_long_line)
        .collect();
    Ok(names
        .iter()
        .enumerate()
        .map(|(index, name)| {
            let metadata = metadata.get(index);
            let permissions = metadata.map(|item| item.permissions.clone());
            let kind = entry_kind_for_archive_member(
                name,
                name.ends_with('/'),
                permissions.as_deref(),
                None,
            );
            ArchiveEntryInfo {
                path: name.clone(),
                kind,
                size_bytes: metadata
                    .and_then(|item| item.size_bytes)
                    .filter(|_| !name.ends_with('/')),
                modified_at: metadata.and_then(|item| item.modified_at.clone()),
                created_at: None,
                permissions,
            }
        })
        .collect())
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ZipInfoMetadata {
    permissions: String,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
}

/// zipinfo 긴 목록의 다섯째 필드 첫 글자가 대문자(T·B)면 암호화 항목(zipinfo 설명서 기준).
/// 항목마다 여러 줄을 내는 `zipinfo -v` 전체 출력(5만 항목 약 69MB)을 다시 읽지 않기 위한 판정.
pub(crate) fn zipinfo_long_output_has_encrypted_entry(stdout: &[u8]) -> bool {
    String::from_utf8_lossy(stdout).lines().any(|line| {
        parse_zipinfo_long_line(line).is_some()
            && line
                .split_whitespace()
                .nth(4)
                .and_then(|field| field.chars().next())
                .is_some_and(|marker| marker == 'T' || marker == 'B')
    })
}

fn parse_zipinfo_long_line(line: &str) -> Option<ZipInfoMetadata> {
    let columns: Vec<&str> = line.split_whitespace().collect();
    let permissions = columns.first()?;
    if permissions.len() != 10 || !matches!(permissions.as_bytes()[0], b'-' | b'd' | b'l') {
        return None;
    }
    Some(ZipInfoMetadata {
        permissions: (*permissions).to_string(),
        size_bytes: columns.get(3).and_then(|value| value.parse::<u64>().ok()),
        modified_at: columns
            .get(7)
            .and_then(|value| zipinfo_timestamp_to_iso(value)),
    })
}

#[cfg(test)]
pub(crate) fn parse_7z_slt_paths(stdout: &[u8]) -> Vec<String> {
    parse_7z_slt_entries(stdout)
        .into_iter()
        .map(|entry| entry.path)
        .collect()
}

pub(crate) fn safe_7z_entry_names(stdout: &[u8], archive: &Path) -> CommandResult<Vec<String>> {
    let entries = parse_7z_slt_entries(stdout);
    // 외부 도구가 링크를 먼저 생성하여 뒤 항목의 쓰기 경계를 바꾸지 못하도록 사전 거부.
    if let Some(entry) = entries.iter().find(|entry| entry.kind == EntryKind::Symlink) {
        return Err(AppError::new("unsafe_archive_entry", "errors.archiveUnsafePath", Some(archive), true)
            .with_detail("entry", &entry.path));
    }
    Ok(entries.into_iter().map(|entry| entry.path).collect())
}

fn parse_7z_slt_entries(stdout: &[u8]) -> Vec<ArchiveEntryInfo> {
    let text = String::from_utf8_lossy(stdout);
    let mut in_entries = false;
    let mut current = SevenZipEntryFields::default();
    let mut entries = Vec::new();
    for line in text.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("----------") {
            in_entries = true;
            continue;
        }
        if !in_entries || trimmed.is_empty() {
            continue;
        }
        let Some((key, value)) = line.split_once(" = ") else {
            continue;
        };
        if key == "Path" {
            if let Some(entry) = current.finish() {
                entries.push(entry);
            }
            current = SevenZipEntryFields::default();
            // 7z의 Windows 구분자만 가상 경로 구분자로 통일. ..·절대 경로는 안전 검사에 유지.
            current.path = Some(value.replace('\\', "/"));
            continue;
        }
        current.apply(key, value);
    }
    if let Some(entry) = current.finish() {
        entries.push(entry);
    }
    entries
}

#[cfg(test)]
pub(crate) fn parse_7z_slt_paths_for_test(stdout: &[u8]) -> Vec<String> {
    parse_7z_slt_paths(stdout)
}

#[cfg(test)]
pub(crate) fn parse_7z_slt_entries_for_test(stdout: &[u8]) -> Vec<FileEntry> {
    parse_7z_slt_entries(stdout)
        .iter()
        .map(|entry| archive_entry_for_info(Path::new("/tmp/archive.7z"), entry))
        .collect()
}

#[cfg(test)]
pub(crate) fn parse_zipinfo_long_output_for_test(
    stdout: &[u8],
    names: &[String],
) -> Vec<FileEntry> {
    let output = std::process::Output {
        status: success_status_for_test(),
        stdout: stdout.to_vec(),
        stderr: Vec::new(),
    };
    parse_zipinfo_long_output(output, Path::new("/tmp/archive.zip"), names)
        .expect("zipinfo fixture should parse")
        .iter()
        .map(|entry| archive_entry_for_info(Path::new("/tmp/archive.zip"), entry))
        .collect()
}

#[cfg(all(test, unix))]
fn success_status_for_test() -> std::process::ExitStatus {
    use std::os::unix::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(0)
}

#[cfg(all(test, windows))]
fn success_status_for_test() -> std::process::ExitStatus {
    use std::os::windows::process::ExitStatusExt;
    std::process::ExitStatus::from_raw(0)
}

#[derive(Default)]
struct SevenZipEntryFields {
    path: Option<String>,
    size_bytes: Option<u64>,
    modified_at: Option<String>,
    created_at: Option<String>,
    attributes: Option<String>,
    folder: Option<bool>,
    link: bool,
}

impl SevenZipEntryFields {
    fn apply(&mut self, key: &str, value: &str) {
        let value = value.trim();
        match key {
            "Size" => self.size_bytes = value.parse::<u64>().ok(),
            "Modified" => self.modified_at = seven_zip_timestamp_to_iso(value),
            "Created" => self.created_at = seven_zip_timestamp_to_iso(value),
            "Attributes" => self.attributes = Some(value.to_string()),
            "Folder" => self.folder = Some(value == "+"),
            "Symbolic Link" | "Hard Link" => self.link = !value.is_empty(),
            _ => {}
        }
    }

    fn finish(self) -> Option<ArchiveEntryInfo> {
        let path = self.path?;
        if path.is_empty() {
            return None;
        }
        let permissions = permission_text_from_7z_attributes(self.attributes.as_deref());
        let kind = if self.link { EntryKind::Symlink } else { entry_kind_for_archive_member(
            &path,
            path.ends_with('/') || self.folder.unwrap_or(false),
            permissions.as_deref(),
            self.attributes.as_deref(),
        ) };
        Some(ArchiveEntryInfo {
            path,
            size_bytes: if kind == EntryKind::Directory {
                None
            } else {
                self.size_bytes
            },
            modified_at: self.modified_at,
            created_at: self.created_at,
            permissions,
            kind,
        })
    }
}

fn archive_entry_for_info(archive: &Path, entry: &ArchiveEntryInfo) -> FileEntry {
    FileEntry {
        path: format!("{}!{}", display_path(archive), entry.path),
        name: entry
            .path
            .trim_end_matches('/')
            .rsplit('/')
            .next()
            .unwrap_or(&entry.path)
            .to_string(),
        kind: entry.kind.clone(),
        symlink_target_is_directory: None,
        size_bytes: entry.size_bytes,
        modified_at: entry.modified_at.clone(),
        created_at: entry.created_at.clone(),
        permissions: entry.permissions.clone(),
        owner: None,
        group: None,
        is_hidden: entry
            .path
            .rsplit('/')
            .next()
            .is_some_and(|value| value.starts_with('.')),
        is_virtual: false,
    }
}

fn entry_kind_for_archive_member(
    name: &str,
    is_dir: bool,
    permissions: Option<&str>,
    attributes: Option<&str>,
) -> EntryKind {
    if is_dir || permissions.is_some_and(|value| value.starts_with('d')) {
        return EntryKind::Directory;
    }
    if permissions.is_some_and(|value| value.starts_with('l')) {
        return EntryKind::Symlink;
    }
    if attributes.is_some_and(|value| value.contains('D')) {
        return EntryKind::Directory;
    }
    if is_archive_path(Path::new(name)) {
        return EntryKind::Archive;
    }
    EntryKind::File
}

fn zipinfo_timestamp_to_iso(value: &str) -> Option<String> {
    if value.len() < 15 {
        return None;
    }
    let (date, time) = value.split_once('.')?;
    if date.len() != 8 || time.len() < 6 {
        return None;
    }
    Some(format!(
        "{}-{}-{}T{}:{}:{}",
        &date[0..4],
        &date[4..6],
        &date[6..8],
        &time[0..2],
        &time[2..4],
        &time[4..6]
    ))
}

fn seven_zip_timestamp_to_iso(value: &str) -> Option<String> {
    let normalized = value.trim();
    if normalized.len() < 19 {
        return None;
    }
    let timestamp = &normalized[0..19];
    if timestamp.as_bytes().get(10) != Some(&b' ') {
        return None;
    }
    Some(format!("{}T{}", &timestamp[0..10], &timestamp[11..19]))
}

fn permission_text_from_7z_attributes(attributes: Option<&str>) -> Option<String> {
    attributes?
        .split_whitespace()
        .find(|part| part.len() == 10 && matches!(part.as_bytes()[0], b'-' | b'd' | b'l'))
        .map(str::to_string)
}


#[cfg(test)]
pub(crate) fn seven_zip_binary_for_test() -> Option<String> {
    crate::archive_provider::seven_zip()
}

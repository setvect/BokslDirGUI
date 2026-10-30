//! 압축 형식 판정, 도구 선택·탐색 책임. 작업 상태·취소는 기존 operation 계층에서 소유.
use crate::contracts::{AppError, CommandResult};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

/// 압축 파일로 다루는 확장자와 형식 이름, 긴 확장자부터 비교.
/// 프론트 `src/domain/archiveFormats.ts`와 같은 표, 양쪽 테스트가 `src/tauri/fixtures/archive-formats.json`과 대조.
pub(crate) const ARCHIVE_FORMATS: [(&str, &str); 9] = [
    (".tar.gz", "tar.gz"),
    (".tgz", "tar.gz"),
    (".tar.zst", "tar.zst"),
    (".tzst", "tar.zst"),
    (".zip", "zip"),
    (".jar", "jar"),
    (".war", "war"),
    (".tar", "tar"),
    (".7z", "7z"),
];

pub(crate) fn archive_format(path: &Path) -> Option<&'static str> {
    let name = path.file_name()?.to_str()?.to_ascii_lowercase();
    ARCHIVE_FORMATS
        .iter()
        .find(|(suffix, _)| name.ends_with(suffix))
        .map(|(_, format)| *format)
}

pub(crate) fn is_archive_path(path: &Path) -> bool {
    archive_format(path).is_some()
}

static RESOURCE_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn unsafe_entry(entry: &str, windows: bool) -> bool {
    let normalized = entry.replace('\\', "/");
    normalized.starts_with('/')
        || normalized.as_bytes().get(1) == Some(&b':')
        || normalized.split('/').any(|part| part == "..")
        || entry.contains('\0')
        || (windows
            && normalized
                .split('/')
                .filter(|part| !part.is_empty() && *part != ".")
                .any(|part| !crate::platform::valid_windows_child_name(part)))
}

/// ZIP 계열(zip·jar·war)의 생성·목록·해제·추가 도구 선택: Windows는 배포한 7-Zip, 그 밖은 Info-ZIP.
pub(crate) fn zip_uses_seven_zip() -> bool {
    cfg!(windows) || (cfg!(test) && std::env::var_os("BOKSLDIRGUI_TEST_WINDOWS_ARCHIVES").is_some())
}

pub(crate) fn set_resource_directory(directory: PathBuf) {
    let _ = RESOURCE_DIRECTORY.set(directory);
}

pub(crate) fn seven_zip() -> Option<String> {
    #[cfg(test)]
    if let Some(path) = std::env::var_os("BOKSLDIRGUI_TEST_7ZIP") {
        return Some(path.to_string_lossy().into_owned());
    }
    let name = if cfg!(windows) { "7za.exe" } else { "7zz" };
    if let Some(path) = RESOURCE_DIRECTORY
        .get()
        .map(|root| root.join("archive-tools").join(name))
    {
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    // 개발·테스트만 저장소 리소스 사용. Windows 설치 앱은 PATH의 임의 파일로 대체하지 않음.
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/archive-tools")
            .join(name);
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    #[cfg(not(windows))]
    return crate::platform::find_executable("7zz")
        .or_else(|| crate::platform::find_executable("7z"));
    #[cfg(windows)]
    None
}

/// 외부 압축 도구 경로. 7-Zip은 배포 리소스 우선(`seven_zip`), 나머지는 PATH.
pub(crate) fn find_tool(name: &str) -> Option<String> {
    if matches!(name, "7zz" | "7z") {
        return seven_zip();
    }
    crate::platform::find_executable(name)
}

/// 도구가 없으면 대상 압축 경로와 provider 이름을 담은 오류.
pub(crate) fn require_tool(name: &str, path: &Path) -> CommandResult<String> {
    find_tool(name).ok_or_else(|| {
        AppError::new("unsupported", "errors.archiveProviderUnavailable", Some(path), true)
            .with_detail("provider", name)
    })
}

#[cfg(test)]
pub(crate) fn zip_available() -> bool {
    if zip_uses_seven_zip() {
        seven_zip().is_some()
    } else {
        crate::platform::find_executable("zip").is_some()
            && crate::platform::find_executable("unzip").is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::require_tool;
    use std::path::Path;

    #[test]
    fn missing_archive_tool_reports_provider_unavailable() {
        let error = require_tool("boksldir-missing-archive-tool", Path::new("/tmp/sample.zip")).unwrap_err();
        assert_eq!(
            (error.code.as_str(), error.message_key.as_str(), error.recoverable),
            ("unsupported", "errors.archiveProviderUnavailable", true)
        );
        let provider = error.details.as_ref().and_then(|details| details.get("provider"));
        assert_eq!(provider.map(String::as_str), Some("boksldir-missing-archive-tool"));
    }
}

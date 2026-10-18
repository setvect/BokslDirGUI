//! 압축 도구의 배포 위치와 탐색 책임. 작업 상태·취소는 기존 operation 계층에서 소유.
use std::path::PathBuf;
use std::sync::OnceLock;

static RESOURCE_DIRECTORY: OnceLock<PathBuf> = OnceLock::new();

pub(crate) fn set_resource_directory(directory: PathBuf) {
    let _ = RESOURCE_DIRECTORY.set(directory);
}

pub(crate) fn seven_zip() -> Option<String> {
    let name = if cfg!(windows) { "7za.exe" } else { "7zz" };
    if let Some(path) = RESOURCE_DIRECTORY.get().map(|root| root.join("archive-tools").join(name)) {
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    // 개발·테스트만 저장소 리소스 사용. Windows 설치 앱은 PATH의 임의 파일로 대체하지 않음.
    #[cfg(debug_assertions)]
    {
        let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/archive-tools").join(name);
        if path.is_file() {
            return Some(path.to_string_lossy().into_owned());
        }
    }
    #[cfg(not(windows))]
    return crate::platform::find_executable("7zz").or_else(|| crate::platform::find_executable("7z"));
    #[cfg(windows)]
    None
}

use crate::contracts::{AppError, CommandResult, FilePreview};
use crate::filesystem::map_io_error;
use crate::navigation;
use crate::path_text::display_path;
use std::fs;
use std::io::Read;

const DEFAULT_TEXT_PREVIEW_LIMIT: u64 = 256 * 1024;
const MAX_TEXT_PREVIEW_LIMIT: u64 = 1024 * 1024;
const IMAGE_PREVIEW_LIMIT: u64 = 8 * 1024 * 1024;

pub(crate) fn preview_file(path: String, max_bytes: Option<u64>) -> CommandResult<FilePreview> {
    let path = navigation::canonical_existing_path(&path)?;
    let metadata = fs::metadata(&path).map_err(|error| map_io_error(error, Some(&path)))?;
    if !metadata.is_file() {
        return Err(AppError::new(
            "not_file",
            "errors.previewNotFile",
            Some(&path),
            true,
        ));
    }
    let name = path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| display_path(&path));
    let plan = PreviewPlan::new(&name, metadata.len(), max_bytes);
    let bytes = match plan.read_limit() {
        Some(limit) => {
            let mut bytes = Vec::with_capacity(limit.min(metadata.len() + 1) as usize);
            fs::File::open(&path)
                .map_err(|error| map_io_error(error, Some(&path)))?
                .take(limit)
                .read_to_end(&mut bytes)
                .map_err(|error| map_io_error(error, Some(&path)))?;
            bytes
        }
        None => Vec::new(),
    };
    Ok(plan.finish(display_path(&path), name, bytes))
}

/// 미리보기 판정(로컬·원격 공통): 확장자로 이미지·텍스트·미지원을 정하고, 읽을 앞부분 길이와 결과 생성 규칙을 담음.
pub(crate) struct PreviewPlan {
    kind: PreviewKind,
    size_bytes: u64,
    mime_type: Option<&'static str>,
}

enum PreviewKind {
    Image(&'static str),
    TooLarge,
    Text(u64),
    Unsupported(u64),
}

impl PreviewPlan {
    pub(crate) fn new(name: &str, size_bytes: u64, max_bytes: Option<u64>) -> Self {
        let extension = std::path::Path::new(name)
            .extension()
            .map(|value| value.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        let mime_type = preview_mime_type(&extension);
        let kind = if let Some(mime) = preview_image_mime_type(&extension) {
            if size_bytes > IMAGE_PREVIEW_LIMIT { PreviewKind::TooLarge } else { PreviewKind::Image(mime) }
        } else if preview_text_mime_type(&extension).is_some() {
            PreviewKind::Text(max_bytes.unwrap_or(DEFAULT_TEXT_PREVIEW_LIMIT).clamp(1, MAX_TEXT_PREVIEW_LIMIT))
        } else {
            PreviewKind::Unsupported(max_bytes.unwrap_or(DEFAULT_TEXT_PREVIEW_LIMIT))
        };
        Self { kind, size_bytes, mime_type }
    }

    /// 읽을 앞부분 최대 길이. 텍스트는 잘림 판정을 위해 한도보다 1바이트 더 읽음, 미지원·너무 큰 이미지는 읽지 않음.
    pub(crate) fn read_limit(&self) -> Option<u64> {
        match self.kind {
            PreviewKind::Image(_) => Some(IMAGE_PREVIEW_LIMIT),
            PreviewKind::Text(limit) => Some(limit + 1),
            PreviewKind::TooLarge | PreviewKind::Unsupported(_) => None,
        }
    }

    pub(crate) fn finish(self, path: String, name: String, mut bytes: Vec<u8>) -> FilePreview {
        let mime_type = self.mime_type.map(str::to_string);
        let size_bytes = self.size_bytes;
        let preview = |kind: &str, text: Option<String>, data_url: Option<String>, truncated: bool, limit_bytes: u64| FilePreview {
            path: path.clone(),
            name: name.clone(),
            kind: kind.to_string(),
            mime_type: mime_type.clone(),
            size_bytes,
            text,
            data_url,
            truncated,
            limit_bytes,
        };
        match self.kind {
            PreviewKind::TooLarge => preview("tooLarge", None, None, false, IMAGE_PREVIEW_LIMIT),
            PreviewKind::Image(mime) => FilePreview {
                mime_type: Some(mime.to_string()),
                ..preview("image", None, Some(format!("data:{mime};base64,{}", encode_base64(&bytes))), false, IMAGE_PREVIEW_LIMIT)
            },
            PreviewKind::Text(limit) => {
                let truncated = bytes.len() as u64 > limit;
                bytes.truncate(limit as usize);
                if bytes.iter().take(8 * 1024).any(|byte| *byte == 0) {
                    return preview("unsupported", None, None, false, limit);
                }
                preview("text", Some(String::from_utf8_lossy(&bytes).into_owned()), None, truncated, limit)
            }
            PreviewKind::Unsupported(limit) => preview("unsupported", None, None, false, limit),
        }
    }
}

fn preview_image_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        _ => None,
    }
}

fn preview_text_mime_type(extension: &str) -> Option<&'static str> {
    match extension {
        "txt" | "log" => Some("text/plain"),
        "md" | "markdown" => Some("text/markdown"),
        "json" => Some("application/json"),
        "yaml" | "yml" => Some("application/yaml"),
        "toml" => Some("application/toml"),
        "xml" => Some("application/xml"),
        "csv" => Some("text/csv"),
        "rs" | "ts" | "tsx" | "js" | "jsx" | "css" | "html" | "htm" | "sh" | "zsh" | "bash"
        | "py" | "java" | "kt" | "c" | "h" | "cpp" | "hpp" | "sql" => Some("text/plain"),
        _ => None,
    }
}

fn preview_mime_type(extension: &str) -> Option<&'static str> {
    preview_image_mime_type(extension).or_else(|| preview_text_mime_type(extension))
}

fn encode_base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut encoded = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let first = chunk[0];
        let second = *chunk.get(1).unwrap_or(&0);
        let third = *chunk.get(2).unwrap_or(&0);
        encoded.push(TABLE[(first >> 2) as usize] as char);
        encoded.push(TABLE[(((first & 0x03) << 4) | (second >> 4)) as usize] as char);
        encoded.push(if chunk.len() > 1 {
            TABLE[(((second & 0x0f) << 2) | (third >> 6)) as usize] as char
        } else {
            '='
        });
        encoded.push(if chunk.len() > 2 {
            TABLE[(third & 0x3f) as usize] as char
        } else {
            '='
        });
    }
    encoded
}

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
    let size_bytes = metadata.len();
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let mime_type = preview_mime_type(&extension).map(str::to_string);

    if preview_image_mime_type(&extension).is_some() {
        if size_bytes > IMAGE_PREVIEW_LIMIT {
            return Ok(FilePreview {
                path: display_path(&path),
                name,
                kind: "tooLarge".to_string(),
                mime_type,
                size_bytes,
                text: None,
                data_url: None,
                truncated: false,
                limit_bytes: IMAGE_PREVIEW_LIMIT,
            });
        }
        let bytes = fs::read(&path).map_err(|error| map_io_error(error, Some(&path)))?;
        let mime = preview_image_mime_type(&extension).unwrap_or("application/octet-stream");
        return Ok(FilePreview {
            path: display_path(&path),
            name,
            kind: "image".to_string(),
            mime_type: Some(mime.to_string()),
            size_bytes,
            text: None,
            data_url: Some(format!("data:{mime};base64,{}", encode_base64(&bytes))),
            truncated: false,
            limit_bytes: IMAGE_PREVIEW_LIMIT,
        });
    }

    if preview_text_mime_type(&extension).is_some() {
        let limit = max_bytes
            .unwrap_or(DEFAULT_TEXT_PREVIEW_LIMIT)
            .clamp(1, MAX_TEXT_PREVIEW_LIMIT);
        let mut bytes = Vec::with_capacity((limit.min(size_bytes) + 1) as usize);
        fs::File::open(&path)
            .map_err(|error| map_io_error(error, Some(&path)))?
            .take(limit + 1)
            .read_to_end(&mut bytes)
            .map_err(|error| map_io_error(error, Some(&path)))?;
        let truncated = bytes.len() as u64 > limit;
        bytes.truncate(limit as usize);
        if bytes.iter().take(8 * 1024).any(|byte| *byte == 0) {
            return Ok(FilePreview {
                path: display_path(&path),
                name,
                kind: "unsupported".to_string(),
                mime_type,
                size_bytes,
                text: None,
                data_url: None,
                truncated: false,
                limit_bytes: limit,
            });
        }
        return Ok(FilePreview {
            path: display_path(&path),
            name,
            kind: "text".to_string(),
            mime_type,
            size_bytes,
            text: Some(String::from_utf8_lossy(&bytes).into_owned()),
            data_url: None,
            truncated,
            limit_bytes: limit,
        });
    }

    Ok(FilePreview {
        path: display_path(&path),
        name,
        kind: "unsupported".to_string(),
        mime_type,
        size_bytes,
        text: None,
        data_url: None,
        truncated: false,
        limit_bytes: max_bytes.unwrap_or(DEFAULT_TEXT_PREVIEW_LIMIT),
    })
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

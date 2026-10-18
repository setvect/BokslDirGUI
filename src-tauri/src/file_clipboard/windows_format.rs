//! Bounded CF_HDROP wire format, independent of Windows handles and filesystem state.
use super::ClipboardIntent;
use crate::contracts::{AppError, CommandResult};

pub(super) const MAX_BYTES: usize = 16 * 1024 * 1024;
const HEADER_SIZE: usize = 20; // DROPFILES: DWORD, POINT, BOOL, BOOL (both architectures).

pub(super) fn invalid() -> AppError {
    AppError::new(
        "invalid_clipboard",
        "errors.fileClipboardInvalid",
        None,
        true,
    )
}

pub(super) fn encode(paths: &[String]) -> CommandResult<Vec<u8>> {
    if paths.is_empty() {
        return Err(invalid());
    }
    let mut bytes = vec![0; HEADER_SIZE];
    bytes[..4].copy_from_slice(&(HEADER_SIZE as u32).to_le_bytes());
    bytes[16..20].copy_from_slice(&1u32.to_le_bytes());
    for path in paths {
        if path.is_empty() || path.contains('\0') {
            return Err(invalid());
        }
        for unit in path.encode_utf16().chain(Some(0)) {
            if bytes.len() + 4 > MAX_BYTES {
                return Err(invalid());
            }
            bytes.extend_from_slice(&unit.to_le_bytes());
        }
    }
    bytes.extend_from_slice(&[0, 0]);
    Ok(bytes)
}

pub(super) fn decode(
    bytes: &[u8],
    decode_ansi: impl Fn(&[u8]) -> CommandResult<String>,
) -> CommandResult<Vec<String>> {
    if bytes.len() < HEADER_SIZE || bytes.len() > MAX_BYTES {
        return Err(invalid());
    }
    let offset = u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize;
    if offset < HEADER_SIZE || offset >= bytes.len() {
        return Err(invalid());
    }
    let wide = u32::from_le_bytes(bytes[16..20].try_into().unwrap()) != 0;
    let data = &bytes[offset..];
    let mut paths = Vec::new();
    if wide {
        if offset % 2 != 0 {
            return Err(invalid());
        }
        // GlobalSize may include allocation padding; only parse through the double terminator.
        let units: Vec<u16> = data
            .chunks_exact(2)
            .map(|b| u16::from_le_bytes([b[0], b[1]]))
            .collect();
        let mut rest = units.as_slice();
        loop {
            let end = rest.iter().position(|u| *u == 0).ok_or_else(invalid)?;
            if end == 0 {
                if paths.is_empty() && rest.get(1) != Some(&0) {
                    return Err(invalid());
                }
                return Ok(paths);
            }
            paths.push(String::from_utf16(&rest[..end]).map_err(|_| invalid())?);
            rest = &rest[end + 1..];
        }
    } else {
        let mut rest = data;
        loop {
            let end = rest.iter().position(|u| *u == 0).ok_or_else(invalid)?;
            if end == 0 {
                if paths.is_empty() && rest.get(1) != Some(&0) {
                    return Err(invalid());
                }
                return Ok(paths);
            }
            paths.push(decode_ansi(&rest[..end])?);
            rest = &rest[end + 1..];
        }
    }
}

pub(super) fn intent(effect: Option<&[u8]>) -> CommandResult<ClipboardIntent> {
    match effect {
        None => Ok(ClipboardIntent::Copy),
        Some(bytes) if bytes.len() >= 4 => match u32::from_le_bytes(bytes[..4].try_into().unwrap())
        {
            2 => Ok(ClipboardIntent::Move), // Only explicit DROPEFFECT_MOVE authorizes moving.
            value if value & 1 != 0 || value == 0 => Ok(ClipboardIntent::Copy),
            _ => Err(invalid()), // Link-only clipboard semantics are not a copy/move request.
        },
        _ => Err(invalid()),
    }
}

#[cfg(test)]
mod tests {
    use super::{decode, encode, intent, ClipboardIntent, HEADER_SIZE};
    #[test]
    fn unicode_paths_round_trip_without_normalizing_names_or_links() {
        let paths = vec![
            r"C:\한글 space # %\📁.txt".into(),
            r"\\server\share\folder".into(),
            r"\\?\C:\long\link".into(),
        ];
        let mut bytes = encode(&paths).unwrap();
        bytes.extend_from_slice(&[0xa5; 7]);
        assert_eq!(decode(&bytes, |_| panic!("not ANSI")).unwrap(), paths);
    }
    #[test]
    fn ansi_paths_use_the_supplied_code_page_decoder() {
        let mut bytes = vec![0u8; HEADER_SIZE];
        bytes[..4].copy_from_slice(&20u32.to_le_bytes());
        bytes.extend_from_slice(b"C:\\a\0D:\\b\0\0");
        assert_eq!(
            decode(&bytes, |s| Ok(String::from_utf8(s.to_vec()).unwrap())).unwrap(),
            vec![r"C:\a", r"D:\b"]
        );
    }
    #[test]
    fn rejects_invalid_offsets_unterminated_names_and_surrogates() {
        let bytes = encode(&[r"C:\a".into()]).unwrap();
        for length in 0..bytes.len() {
            assert!(
                decode(&bytes[..length], |_| unreachable!()).is_err(),
                "length {length}"
            );
        }
        for offset in [0u32, 19, 21, u32::MAX] {
            let mut value = bytes.clone();
            value[..4].copy_from_slice(&offset.to_le_bytes());
            assert!(decode(&value, |_| unreachable!()).is_err());
        }
        let mut value = bytes;
        value[20..22].copy_from_slice(&0xd800u16.to_le_bytes());
        assert!(decode(&value, |_| unreachable!()).is_err());
        assert!(encode(&["a\0b".into()]).is_err());
        assert!(encode(&[]).is_err());
    }
    #[test]
    fn move_requires_an_explicit_effect_and_link_only_is_rejected() {
        assert_eq!(intent(None).unwrap(), ClipboardIntent::Copy);
        assert_eq!(
            intent(Some(&2u32.to_le_bytes())).unwrap(),
            ClipboardIntent::Move
        );
        assert_eq!(
            intent(Some(&3u32.to_le_bytes())).unwrap(),
            ClipboardIntent::Copy
        );
        assert!(intent(Some(&4u32.to_le_bytes())).is_err());
        assert!(intent(Some(&[2])).is_err());
    }
}

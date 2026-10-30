//! 원격 패널 경로 `sftp://사용자@호스트:포트/절대/경로` 해석과 생성.
//! 사용자 이름의 `@`·`:`·`/`·`%`와 경로의 `%`만 퍼센트 인코딩, 나머지(공백·한글)는 그대로 표시.
use crate::contracts::{AppError, CommandResult};

const SCHEME: &str = "sftp://";
pub(crate) const DEFAULT_PORT: u16 = 22;

/// 연결 식별: 같은 사용자·호스트·포트는 같은 연결을 공유.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub(crate) struct RemoteLocation {
    pub(crate) user: String,
    pub(crate) host: String,
    pub(crate) port: u16,
}

impl RemoteLocation {
    /// 연결 창 입력 검증: 빈 값·공백·경로 구분자 포함 호스트 거부, IPv6 대괄호 제거.
    pub(crate) fn new(user: &str, host: &str, port: u16) -> CommandResult<Self> {
        let host = host.trim();
        let host = host.strip_prefix('[').and_then(|rest| rest.strip_suffix(']')).unwrap_or(host);
        let label = format!("{user}@{host}:{port}");
        let host_valid = !host.is_empty()
            && !host.chars().any(|ch| ch.is_whitespace() || matches!(ch, '/' | '\\' | '@' | '[' | ']' | '\0'))
            && (!host.contains(':') || host.parse::<std::net::Ipv6Addr>().is_ok());
        if user.is_empty() || user.contains('\0') || !host_valid || port == 0 {
            return Err(invalid(&label));
        }
        let location = Self { user: user.to_string(), host: host.to_string(), port };
        // URL로 다시 읽어 같은 위치가 되는지 확인(콜론이 섞인 호스트 이름 등 거부)
        match RemotePath::parse(&location.url("/")) {
            Ok(parsed) if parsed.location == location => Ok(location),
            _ => Err(invalid(&label)),
        }
    }

    pub(crate) fn url(&self, path: &str) -> String {
        let host = if self.host.contains(':') { format!("[{}]", self.host) } else { self.host.clone() };
        let port = if self.port == DEFAULT_PORT { String::new() } else { format!(":{}", self.port) };
        format!("{SCHEME}{}@{host}{port}{}", encode(&self.user, "@:/%"), encode(path, "%"))
    }
}

/// 원격 절대 경로. `path`는 항상 `/`로 시작, `.`·`..` 정리, 끝 `/` 없음(루트 제외).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct RemotePath {
    pub(crate) location: RemoteLocation,
    pub(crate) path: String,
}

pub(crate) fn is_remote_path(text: &str) -> bool {
    text.len() >= SCHEME.len() && text[..SCHEME.len()].eq_ignore_ascii_case(SCHEME)
}

impl RemotePath {
    pub(crate) fn parse(text: &str) -> CommandResult<Self> {
        if !is_remote_path(text) || text.contains('\0') {
            return Err(invalid(text));
        }
        let rest = &text[SCHEME.len()..];
        let (authority, raw_path) = match rest.find('/') {
            Some(index) => (&rest[..index], &rest[index..]),
            None => (rest, "/"),
        };
        let (user, host_port) = authority.rsplit_once('@').ok_or_else(|| invalid(text))?;
        let user = decode(user).ok_or_else(|| invalid(text))?;
        let (host, port) = split_host_port(host_port).ok_or_else(|| invalid(text))?;
        if user.is_empty() || host.is_empty() {
            return Err(invalid(text));
        }
        let path = normalize(&decode(raw_path).ok_or_else(|| invalid(text))?);
        Ok(Self { location: RemoteLocation { user, host, port }, path })
    }

    pub(crate) fn new(location: RemoteLocation, path: &str) -> Self {
        Self { location, path: normalize(path) }
    }

    pub(crate) fn url(&self) -> String {
        self.location.url(&self.path)
    }

    pub(crate) fn join(&self, name: &str) -> Self {
        Self::new(self.location.clone(), &format!("{}/{}", self.path.trim_end_matches('/'), name))
    }

    pub(crate) fn parent(&self) -> Option<Self> {
        if self.path == "/" {
            return None;
        }
        let parent = match self.path.rfind('/') {
            Some(0) | None => "/",
            Some(index) => &self.path[..index],
        };
        Some(Self::new(self.location.clone(), parent))
    }

    pub(crate) fn file_name(&self) -> Option<&str> {
        (self.path != "/").then(|| self.path.rsplit('/').next().unwrap_or(""))
    }

    /// `~`·`~/…`는 원격 홈, 상대 경로는 이 경로 기준 해석(FR-36.4).
    pub(crate) fn resolve(&self, input: &str, home: &str) -> Self {
        let joined = if input == "~" {
            home.to_string()
        } else if let Some(rest) = input.strip_prefix("~/") {
            format!("{}/{rest}", home.trim_end_matches('/'))
        } else if input.starts_with('/') {
            input.to_string()
        } else {
            format!("{}/{input}", self.path.trim_end_matches('/'))
        };
        Self::new(self.location.clone(), &joined)
    }
}

fn split_host_port(text: &str) -> Option<(String, u16)> {
    if let Some(rest) = text.strip_prefix('[') {
        let (host, after) = rest.split_once(']')?;
        let port = match after.strip_prefix(':') {
            Some(port) => port.parse().ok().filter(|port| *port > 0)?,
            None if after.is_empty() => DEFAULT_PORT,
            None => return None,
        };
        return Some((host.to_string(), port));
    }
    match text.rsplit_once(':') {
        Some((host, port)) if !host.contains(':') => Some((host.to_string(), port.parse().ok().filter(|port| *port > 0)?)),
        Some(_) => None,
        None => Some((text.to_string(), DEFAULT_PORT)),
    }
}

fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            name => parts.push(name),
        }
    }
    format!("/{}", parts.join("/"))
}

fn encode(text: &str, reserved: &str) -> String {
    let mut encoded = String::with_capacity(text.len());
    for ch in text.chars() {
        if reserved.contains(ch) {
            encoded.push_str(&format!("%{:02X}", ch as u32));
        } else {
            encoded.push(ch);
        }
    }
    encoded
}

fn decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut decoded = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = text.get(index + 1..index + 3)?;
            decoded.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            decoded.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(decoded).ok()
}

fn invalid(text: &str) -> AppError {
    AppError::new("invalid_path", "errors.invalidRemotePath", None, true).with_detail("path", text)
}

#[cfg(test)]
mod tests {
    use super::{is_remote_path, RemoteLocation, RemotePath};

    fn location(user: &str, host: &str, port: u16) -> RemoteLocation {
        RemoteLocation { user: user.into(), host: host.into(), port }
    }

    #[test]
    fn parses_users_hosts_ports_and_decoded_paths() {
        let path = RemotePath::parse("sftp://boksl@example.com/home/boksl/한글 폴더").unwrap();
        assert_eq!(path.location, location("boksl", "example.com", 22));
        assert_eq!(path.path, "/home/boksl/한글 폴더");
        let ipv6 = RemotePath::parse("SFTP://a%40b@[::1]:2222").unwrap();
        assert_eq!(ipv6.location, location("a@b", "::1", 2222));
        assert_eq!(ipv6.path, "/");
        let percent = RemotePath::parse("sftp://u@h/x/100%25 done/./../y").unwrap();
        assert_eq!(percent.path, "/x/y");
        for invalid in ["sftp://host/path", "sftp://@host/", "sftp://u@:22/", "sftp://u@h:0/", "sftp://u@h/%zz", "/local", "sftp://u@a:b:c/"] {
            assert!(RemotePath::parse(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn formats_urls_that_parse_back_to_the_same_location() {
        let path = RemotePath::new(location("a@b:c", "::1", 2222), "/x/100% 한글");
        assert_eq!(path.url(), "sftp://a%40b%3Ac@[::1]:2222/x/100%25 한글");
        assert_eq!(RemotePath::parse(&path.url()).unwrap(), path);
        assert_eq!(RemotePath::new(location("u", "h", 22), "/").url(), "sftp://u@h/");
        assert!(is_remote_path("sftp://u@h/") && is_remote_path("SFTP://u@h") && !is_remote_path("sftp:/u"));
    }

    #[test]
    fn validates_connection_dialog_locations() {
        assert_eq!(RemoteLocation::new("a@b", " example.com ", 2222).unwrap(), location("a@b", "example.com", 2222));
        assert_eq!(RemoteLocation::new("u", "[::1]", 22).unwrap(), location("u", "::1", 22));
        for (user, host, port) in [("", "h", 22), ("u", "", 22), ("u", "h", 0), ("u", "a b", 22), ("u", "h/x", 22), ("u", "a:b", 22)] {
            assert!(RemoteLocation::new(user, host, port).is_err(), "{user}@{host}:{port}");
        }
    }

    #[test]
    fn joins_parents_names_and_resolves_home_and_relative_input() {
        let base = RemotePath::parse("sftp://u@h/srv/data").unwrap();
        assert_eq!(base.join("새 폴더").path, "/srv/data/새 폴더");
        assert_eq!(base.parent().unwrap().path, "/srv");
        assert_eq!(base.file_name(), Some("data"));
        assert!(RemotePath::parse("sftp://u@h/").unwrap().parent().is_none());
        assert_eq!(base.resolve("~", "/home/u").path, "/home/u");
        assert_eq!(base.resolve("~/docs", "/home/u/").path, "/home/u/docs");
        assert_eq!(base.resolve("../logs", "/home/u").path, "/srv/logs");
        assert_eq!(base.resolve("/etc", "/home/u").path, "/etc");
        assert_eq!(base.resolve("../../../..", "/home/u").path, "/");
    }
}

//! `~/.ssh/config` 가져오기(FR-34.9): 와일드카드가 없는 Host 별칭마다 HostName·User·Port·IdentityFile을
//! OpenSSH처럼 처음 나온 값 우선으로 적용. 지원하지 않는 설정·Match·Include는 경고로 보고.
use crate::contracts::{CommandResult, SshConfigEntry, SshConfigImport};
use crate::filesystem::map_io_error;
use std::collections::BTreeSet;

const SUPPORTED: [&str; 4] = ["hostname", "user", "port", "identityfile"];

struct Block {
    patterns: Vec<String>,
    directives: Vec<(String, String)>,
}

pub(crate) fn import_user_config() -> CommandResult<SshConfigImport> {
    let path = crate::platform::home_dir()?.join(".ssh").join("config");
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(SshConfigImport { entries: Vec::new(), warnings: Vec::new() });
        }
        Err(error) => return Err(map_io_error(error, Some(&path))),
    };
    let user = std::env::var("USER").or_else(|_| std::env::var("USERNAME")).unwrap_or_default();
    Ok(parse(&text, &user))
}

pub(crate) fn parse(text: &str, default_user: &str) -> SshConfigImport {
    // 첫 Host 앞의 설정은 모든 호스트에 적용
    let mut blocks = vec![Block { patterns: vec!["*".to_string()], directives: Vec::new() }];
    let mut warnings = BTreeSet::new();
    let mut aliases: Vec<String> = Vec::new();
    let mut in_match = false;
    for (index, raw) in text.lines().enumerate() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (keyword, value) = split_directive(line);
        match keyword.to_ascii_lowercase().as_str() {
            "host" => {
                in_match = false;
                let patterns: Vec<String> = value.split_whitespace().map(unquote).collect();
                for pattern in &patterns {
                    let concrete = !pattern.contains(['*', '?', '!']);
                    if concrete && !aliases.contains(pattern) {
                        aliases.push(pattern.clone());
                    }
                }
                blocks.push(Block { patterns, directives: Vec::new() });
            }
            "match" => {
                in_match = true;
                warnings.insert(format!("Match (line {})", index + 1));
            }
            _ if in_match => {}
            "include" => {
                warnings.insert(format!("Include {value}"));
            }
            lower if SUPPORTED.contains(&lower) => {
                if let Some(block) = blocks.last_mut() {
                    block.directives.push((lower.to_string(), unquote(value)));
                }
            }
            _ => {
                warnings.insert(keyword.to_string());
            }
        }
    }
    let mut entries = Vec::new();
    for alias in aliases {
        let (mut host, mut user, mut port, mut key_path) = (None, None, None, None);
        for block in blocks.iter().filter(|block| block_matches(&block.patterns, &alias)) {
            for (keyword, value) in &block.directives {
                match keyword.as_str() {
                    "hostname" if host.is_none() => host = Some(value.replace("%h", &alias)),
                    "user" if user.is_none() => user = Some(value.clone()),
                    "port" if port.is_none() => match value.parse::<u16>() {
                        Ok(number) if number > 0 => port = Some(number),
                        _ => {
                            warnings.insert(format!("Port {value} ({alias})"));
                        }
                    },
                    "identityfile" if key_path.is_none() => key_path = Some(value.clone()),
                    _ => {}
                }
            }
        }
        let user = user.unwrap_or_else(|| default_user.to_string());
        let host = host.unwrap_or_else(|| alias.clone());
        if user.is_empty() || host.is_empty() || host.contains(char::is_whitespace) {
            warnings.insert(format!("User/HostName ({alias})"));
            continue;
        }
        entries.push(SshConfigEntry { alias, host, port: port.unwrap_or(super::path::DEFAULT_PORT), user, key_path });
    }
    SshConfigImport { entries, warnings: warnings.into_iter().collect() }
}

/// `Keyword value`, `Keyword=value`, `Keyword = value` 형식.
fn split_directive(line: &str) -> (&str, &str) {
    let end = line.find(|ch: char| ch.is_whitespace() || ch == '=').unwrap_or(line.len());
    let (keyword, rest) = line.split_at(end);
    let rest = rest.trim_start();
    let rest = rest.strip_prefix('=').unwrap_or(rest).trim();
    (keyword, rest)
}

fn unquote(text: &str) -> String {
    let text = text.trim();
    text.strip_prefix('"').and_then(|inner| inner.strip_suffix('"')).unwrap_or(text).to_string()
}

/// 부정 패턴(`!…`)에 맞으면 제외, 그 밖은 하나라도 맞으면 적용.
fn block_matches(patterns: &[String], alias: &str) -> bool {
    let negated = patterns.iter().filter_map(|pattern| pattern.strip_prefix('!')).any(|pattern| glob(pattern, alias));
    !negated && patterns.iter().filter(|pattern| !pattern.starts_with('!')).any(|pattern| glob(pattern, alias))
}

fn glob(pattern: &str, text: &str) -> bool {
    fn matches(pattern: &[char], text: &[char]) -> bool {
        match pattern.split_first() {
            None => text.is_empty(),
            Some(('*', rest)) => (0..=text.len()).any(|skip| matches(rest, &text[skip..])),
            Some(('?', rest)) => !text.is_empty() && matches(rest, &text[1..]),
            Some((ch, rest)) => text.first().is_some_and(|first| first.eq_ignore_ascii_case(ch)) && matches(rest, &text[1..]),
        }
    }
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    matches(&pattern, &text)
}

#[cfg(test)]
mod tests {
    use super::parse;

    #[test]
    fn imports_concrete_hosts_with_first_value_wins_and_reports_unsupported_settings() {
        let config = r#"
# 전역
IdentitiesOnly yes
Host web prod-db
    HostName %h.example.com
    Port 2222
    IdentityFile ~/.ssh/web_ed25519
    ProxyJump bastion
Host web
    User webuser
    Port 22
Host *.internal !secret.internal
    User internal
Host db.internal secret.internal
Include ~/.ssh/extra
Host *
    User fallback
    IdentityFile "~/.ssh/id_ed25519"
    ServerAliveInterval=30
Match host foo
    User ignored
Host broken
    Port abc
"#;
        let imported = parse(config, "local");
        let summary: Vec<(String, String, u16, String, Option<String>)> = imported
            .entries
            .iter()
            .map(|entry| (entry.alias.clone(), entry.host.clone(), entry.port, entry.user.clone(), entry.key_path.clone()))
            .collect();
        assert_eq!(summary, vec![
            ("web".into(), "web.example.com".into(), 2222, "webuser".into(), Some("~/.ssh/web_ed25519".into())),
            ("prod-db".into(), "prod-db.example.com".into(), 2222, "fallback".into(), Some("~/.ssh/web_ed25519".into())),
            ("db.internal".into(), "db.internal".into(), 22, "internal".into(), Some("~/.ssh/id_ed25519".into())),
            ("secret.internal".into(), "secret.internal".into(), 22, "fallback".into(), Some("~/.ssh/id_ed25519".into())),
            ("broken".into(), "broken".into(), 22, "fallback".into(), Some("~/.ssh/id_ed25519".into())),
        ]);
        for expected in ["IdentitiesOnly", "ProxyJump", "ServerAliveInterval", "Include ~/.ssh/extra", "Port abc (broken)"] {
            assert!(imported.warnings.iter().any(|warning| warning == expected), "{expected}: {:?}", imported.warnings);
        }
        assert!(imported.warnings.iter().any(|warning| warning.starts_with("Match")));
    }

    #[test]
    fn uses_the_local_user_and_skips_hosts_without_a_user() {
        let imported = parse("Host a\n  HostName a.example.com\nHost b\n  User=\"b user\"\n", "boksl");
        assert_eq!(imported.entries[0].user, "boksl");
        assert_eq!(imported.entries[1].user, "b user");
        let without_user = parse("Host a\n", "");
        assert!(without_user.entries.is_empty());
        assert_eq!(without_user.warnings, vec!["User/HostName (a)".to_string()]);
    }
}

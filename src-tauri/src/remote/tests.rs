//! 원격 연결 통합 시험: 127.0.0.1 테스트 SFTP 서버에 실제 SSH로 연결.
use super::connection::{
    self, ConnectOptions, ConnectionListener, KnownHostsPaths, RemoteConnection, RemoteCredential,
};
use super::path::RemoteLocation;
use super::test_server::{random_ed25519_key, TestServerOptions, TestSftpServer};
use crate::contracts::{
    AppError, RemoteAuthMethod, RemoteConnectRequest, RemoteConnectionState, RemoteSettings,
};
use crate::test_util::TempDir;
use russh::keys::ssh_key::{self, rand_core};
use russh::keys::PublicKey;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

type Events = Arc<Mutex<Vec<(String, RemoteConnectionState, Option<String>)>>>;

fn known_hosts(dir: &TempDir) -> KnownHostsPaths {
    KnownHostsPaths { app: dir.path().join("known_hosts"), user: None }
}

fn options(port: u16, credential: RemoteCredential, dir: &TempDir, listener: Option<ConnectionListener>) -> ConnectOptions {
    ConnectOptions {
        location: RemoteLocation::new("tester", "127.0.0.1", port).unwrap(),
        credential,
        connect_timeout: Duration::from_secs(10),
        keepalive: Duration::from_secs(30),
        known_hosts: known_hosts(dir),
        listener,
    }
}

fn trust(server: &TestSftpServer, dir: &TempDir) {
    let path = dir.path().join("known_hosts");
    russh::keys::known_hosts::learn_known_hosts_path("127.0.0.1", server.port(), &server.host_public_key(), path)
        .unwrap();
}

fn connect(options: ConnectOptions) -> Result<Arc<RemoteConnection>, AppError> {
    super::block_on(connection::connect(options))
}

fn password(text: &str) -> RemoteCredential {
    RemoteCredential::Password(text.to_string())
}

fn detail(error: &AppError, key: &str) -> String {
    error.details.as_ref().and_then(|details| details.get(key)).cloned().unwrap_or_default()
}

fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(ssh_key::HashAlg::Sha256).to_string()
}

fn recorder() -> (ConnectionListener, Events) {
    let events: Events = Arc::default();
    let sink = Arc::clone(&events);
    let listener: ConnectionListener = Arc::new(move |changed| {
        let code = changed.error.as_ref().map(|error| error.code.clone());
        sink.lock().unwrap().push((changed.session_id.clone(), changed.state, code));
    });
    (listener, events)
}

/// 키 암호화 시험용 결정적 난수. 암호학적 강도 불필요.
struct TestRng(u64);

impl rand_core::TryRng for TestRng {
    type Error = std::convert::Infallible;

    fn try_next_u32(&mut self) -> Result<u32, Self::Error> {
        Ok(self.try_next_u64()? as u32)
    }

    fn try_next_u64(&mut self) -> Result<u64, Self::Error> {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        Ok(self.0 >> 11)
    }

    fn try_fill_bytes(&mut self, dst: &mut [u8]) -> Result<(), Self::Error> {
        for byte in dst {
            *byte = self.try_next_u64()? as u8;
        }
        Ok(())
    }
}

impl rand_core::TryCryptoRng for TestRng {}

#[test]
fn unknown_host_key_needs_the_shown_fingerprint_before_password_login() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-unknown-host");
    let error = connect(options(server.port(), password("pw"), &dir, None)).unwrap_err();
    assert_eq!(error.code, "host_key_unknown");
    let expected = fingerprint(&server.host_public_key());
    assert_eq!(detail(&error, "fingerprint"), expected);
    assert_eq!(detail(&error, "algorithm"), "ssh-ed25519");
    assert_eq!(error.path.as_deref(), Some(format!("sftp://tester@127.0.0.1:{}/", server.port()).as_str()));

    let paths = known_hosts(&dir);
    let refused = connection::trust_host_key("127.0.0.1", server.port(), "SHA256:different", &paths).unwrap_err();
    assert_eq!(refused.code, "host_key_not_pending");
    assert!(!paths.app.exists());
    connection::trust_host_key("127.0.0.1", server.port(), &expected, &paths).unwrap();
    let recorded = std::fs::read_to_string(&paths.app).unwrap();
    assert!(recorded.starts_with(&format!("[127.0.0.1]:{} ssh-ed25519 ", server.port())), "{recorded}");

    let connected = connect(options(server.port(), password("pw"), &dir, None)).unwrap();
    let session = connected.session();
    assert_eq!(session.session_id, format!("sftp://tester@127.0.0.1:{}/", server.port()));
    assert_eq!((session.home.as_str(), session.home_url.as_str()), ("/", session.session_id.as_str()));
    assert_eq!(session.host_key_fingerprint, expected);
    let reused = connect(options(server.port(), password("pw"), &dir, None)).unwrap();
    assert!(Arc::ptr_eq(&connected, &reused));
    assert!(connection::sessions().contains(&session));
    assert!(super::block_on(connection::disconnect(&connected.location)));
}

#[test]
fn changed_host_key_blocks_login_and_reports_both_fingerprints() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-changed-host");
    let recorded = PublicKey::from(random_ed25519_key().public_key().key_data().clone());
    let path = dir.path().join("known_hosts");
    russh::keys::known_hosts::learn_known_hosts_path("127.0.0.1", server.port(), &recorded, &path).unwrap();
    let error = connect(options(server.port(), password("pw"), &dir, None)).unwrap_err();
    assert_eq!(error.code, "host_key_changed");
    assert_eq!(detail(&error, "fingerprint"), fingerprint(&server.host_public_key()));
    assert_eq!(detail(&error, "recordedFingerprint"), fingerprint(&recorded));
    // 변경된 키는 확인 대기 목록에 올리지 않아 신뢰 기록으로 덮어쓸 수 없음
    let refused = connection::trust_host_key("127.0.0.1", server.port(), &fingerprint(&server.host_public_key()), &known_hosts(&dir));
    assert_eq!(refused.unwrap_err().code, "host_key_not_pending");
}

#[test]
fn user_known_hosts_is_read_but_never_written() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-user-known-hosts");
    let user_file = dir.path().join("user_known_hosts");
    russh::keys::known_hosts::learn_known_hosts_path("127.0.0.1", server.port(), &server.host_public_key(), &user_file)
        .unwrap();
    let before = std::fs::read(&user_file).unwrap();
    let paths = KnownHostsPaths { app: dir.path().join("app_known_hosts"), user: Some(user_file.clone()) };
    let mut connect_options = options(server.port(), password("pw"), &dir, None);
    connect_options.known_hosts = paths.clone();
    let connected = connect(connect_options).unwrap();
    assert_eq!(std::fs::read(&user_file).unwrap(), before);
    assert!(!paths.app.exists());
    super::block_on(connection::disconnect(&connected.location));
}

#[test]
fn rejected_passwords_never_reach_errors_or_debug_output() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-password");
    trust(&server, &dir);
    let secret = "wrong-secret-4821";
    let error = connect(options(server.port(), password(secret), &dir, None)).unwrap_err();
    assert_eq!(error.code, "remote_auth_failed");
    assert_eq!(detail(&error, "allowedMethods"), "password");
    assert!(!serde_json::to_string(&error).unwrap().contains(secret));
    let debug = format!("{:?}", password(secret));
    assert!(debug.contains("password") && !debug.contains(secret), "{debug}");
    assert!(connection::connection(&RemoteLocation::new("tester", "127.0.0.1", server.port()).unwrap()).is_err());
}

#[test]
fn encrypted_private_keys_need_the_right_passphrase() {
    let key = random_ed25519_key();
    let server = TestSftpServer::start(TestServerOptions {
        password: None,
        authorized_key: Some(PublicKey::from(key.public_key().key_data().clone())),
        ..Default::default()
    });
    let dir = TempDir::new("remote-public-key");
    trust(&server, &dir);
    let key_path = dir.path().join("id_test");
    let encrypted = key.encrypt(&mut TestRng(7), "key-pass").unwrap();
    std::fs::write(&key_path, encrypted.to_openssh(ssh_key::LineEnding::LF).unwrap().as_bytes()).unwrap();
    let key_file = |passphrase: Option<&str>| RemoteCredential::KeyFile {
        path: key_path.to_string_lossy().into_owned(),
        passphrase: passphrase.map(str::to_string),
    };
    let required = connect(options(server.port(), key_file(None), &dir, None)).unwrap_err();
    assert_eq!(required.code, "remote_key_passphrase_required");
    let invalid = connect(options(server.port(), key_file(Some("wrong-pass")), &dir, None)).unwrap_err();
    assert_eq!(invalid.code, "remote_key_passphrase_invalid");
    assert!(!serde_json::to_string(&invalid).unwrap().contains("wrong-pass"));
    let missing = RemoteCredential::KeyFile { path: dir.path().join("absent").to_string_lossy().into_owned(), passphrase: None };
    assert_eq!(connect(options(server.port(), missing, &dir, None)).unwrap_err().code, "remote_key_unreadable");
    let connected = connect(options(server.port(), key_file(Some("key-pass")), &dir, None)).unwrap();
    super::block_on(connection::disconnect(&connected.location));
}

#[test]
fn keyboard_interactive_prompts_continue_with_the_same_connection() {
    let server = TestSftpServer::start(TestServerOptions {
        password: None,
        keyboard_interactive_code: Some("246810".into()),
        ..Default::default()
    });
    let dir = TempDir::new("remote-keyboard");
    trust(&server, &dir);
    let prompt = connect(options(server.port(), RemoteCredential::KeyboardInteractive, &dir, None)).unwrap_err();
    assert_eq!(prompt.code, "remote_auth_prompts");
    let prompts: serde_json::Value = serde_json::from_str(&detail(&prompt, "prompts")).unwrap();
    assert_eq!(prompts, serde_json::json!([{ "prompt": "Verification code: ", "echo": false }]));
    let challenge = detail(&prompt, "challengeId");

    let rejected = super::block_on(connection::respond(&challenge, vec!["000000".into()])).unwrap_err();
    assert_eq!(rejected.code, "remote_auth_failed");
    assert!(!serde_json::to_string(&rejected).unwrap().contains("000000"));
    let reused = super::block_on(connection::respond(&challenge, vec!["246810".into()])).unwrap_err();
    assert_eq!(reused.code, "remote_auth_challenge_expired");

    let cancelled = connect(options(server.port(), RemoteCredential::KeyboardInteractive, &dir, None)).unwrap_err();
    assert!(super::block_on(connection::cancel_challenge(&detail(&cancelled, "challengeId"))));
    assert!(!super::block_on(connection::cancel_challenge(&detail(&cancelled, "challengeId"))));

    let prompt = connect(options(server.port(), RemoteCredential::KeyboardInteractive, &dir, None)).unwrap_err();
    let connected = super::block_on(connection::respond(&detail(&prompt, "challengeId"), vec!["246810".into()])).unwrap();
    assert_eq!(connected.home, "/");
    super::block_on(connection::disconnect(&connected.location));

    // 암호 방식을 keyboard-interactive로만 받는 서버에는 첫 숨김 질문에 입력한 암호로 응답
    let connected = connect(options(server.port(), password("246810"), &dir, None)).unwrap();
    super::block_on(connection::disconnect(&connected.location));
}

#[test]
fn connection_changes_are_reported_for_connect_disconnect_and_loss() {
    let (listener, events) = recorder();
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-events");
    trust(&server, &dir);
    let session_id = format!("sftp://tester@127.0.0.1:{}/", server.port());
    let connected = connect(options(server.port(), password("pw"), &dir, Some(Arc::clone(&listener)))).unwrap();
    let location = connected.location.clone();
    assert!(super::block_on(connection::disconnect(&location)));
    assert!(!super::block_on(connection::disconnect(&location)));
    assert_eq!(connection::connection(&location).unwrap_err().code, "remote_not_connected");

    connect(options(server.port(), password("pw"), &dir, Some(listener))).unwrap();
    drop(server);
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && events.lock().unwrap().len() < 4 {
        std::thread::sleep(Duration::from_millis(20));
    }
    let expected = vec![
        (session_id.clone(), RemoteConnectionState::Connected, None),
        (session_id.clone(), RemoteConnectionState::Disconnected, None),
        (session_id.clone(), RemoteConnectionState::Connected, None),
        (session_id, RemoteConnectionState::Lost, Some("remote_connection_lost".to_string())),
    ];
    assert_eq!(*events.lock().unwrap(), expected);
    assert_eq!(connection::connection(&location).unwrap_err().code, "remote_not_connected");
}

#[test]
fn network_failures_are_reported_by_stage() {
    let dir = TempDir::new("remote-network");
    let closed_port = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
    let refused = connect(options(closed_port, password("pw"), &dir, None)).unwrap_err();
    assert_eq!(refused.code, "remote_connection_refused");

    let mut unknown = options(22, password("pw"), &dir, None);
    unknown.location = RemoteLocation::new("tester", "boksldir-test.invalid", 22).unwrap();
    assert_eq!(connect(unknown).unwrap_err().code, "remote_host_not_found");

    // SSH가 아닌 서버와 응답 없는 서버
    let not_ssh = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let not_ssh_port = not_ssh.local_addr().unwrap().port();
    let silent = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let silent_port = silent.local_addr().unwrap().port();
    let servers = std::thread::spawn(move || {
        use std::io::Write;
        let (mut stream, _) = not_ssh.accept().unwrap();
        let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\n");
        drop(stream);
        let (held, _) = silent.accept().unwrap();
        std::thread::sleep(Duration::from_secs(2));
        drop(held);
    });
    let failed = connect(options(not_ssh_port, password("pw"), &dir, None)).unwrap_err();
    assert_eq!(failed.code, "remote_connect_failed");
    let mut slow = options(silent_port, password("pw"), &dir, None);
    slow.connect_timeout = Duration::from_millis(400);
    assert_eq!(connect(slow).unwrap_err().code, "remote_timeout");
    servers.join().unwrap();
}

#[test]
fn connect_requests_map_to_validated_options_without_keeping_empty_secrets() {
    let request = |auth_method, key_path: Option<&str>| RemoteConnectRequest {
        host: "[::1]".into(),
        port: 2222,
        user: "boksl".into(),
        auth_method,
        password: Some("pw".into()),
        key_path: key_path.map(str::to_string),
        passphrase: Some(String::new()),
    };
    let settings = RemoteSettings { keepalive_seconds: 45, connect_timeout_seconds: 9, ..Default::default() };
    let paths = KnownHostsPaths { app: "known_hosts".into(), user: None };
    let options = ConnectOptions::from_request(request(RemoteAuthMethod::PublicKey, Some("~/.ssh/id")), &settings, paths.clone(), None).unwrap();
    assert_eq!(options.location, RemoteLocation::new("boksl", "::1", 2222).unwrap());
    assert_eq!((options.connect_timeout, options.keepalive), (Duration::from_secs(9), Duration::from_secs(45)));
    assert!(matches!(options.credential, RemoteCredential::KeyFile { ref path, passphrase: None } if path == "~/.ssh/id"));
    let missing_key = ConnectOptions::from_request(request(RemoteAuthMethod::PublicKey, Some(" ")), &settings, paths.clone(), None);
    assert_eq!(missing_key.err().unwrap().code, "remote_key_unreadable");
    let mut invalid = request(RemoteAuthMethod::Password, None);
    invalid.host = "a b".into();
    assert_eq!(ConnectOptions::from_request(invalid, &settings, paths, None).err().unwrap().code, "invalid_path");
}

fn connected(server: &TestSftpServer, dir: &TempDir) -> Arc<RemoteConnection> {
    trust(server, dir);
    connect(options(server.port(), password("pw"), dir, None)).unwrap()
}

fn root_url(server: &TestSftpServer) -> String {
    format!("sftp://tester@127.0.0.1:{}/", server.port())
}

fn list(url: &str, show_hidden: bool, filter: Option<&str>) -> Result<crate::contracts::DirectoryListing, AppError> {
    super::block_on(super::listing::list_dir(
        crate::contracts::PanelId::Left,
        url,
        show_hidden,
        crate::contracts::SortSpec::default(),
        filter.map(str::to_string),
    ))
}

fn names(listing: &crate::contracts::DirectoryListing) -> Vec<&str> {
    listing.entries.iter().map(|entry| entry.name.as_str()).collect()
}

#[test]
fn remote_listing_converts_entries_with_urls_kinds_and_hidden_filter() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-list");
    std::fs::create_dir(server.root().join("docs")).unwrap();
    std::fs::write(server.root().join("a.txt"), b"hello").unwrap();
    std::fs::write(server.root().join(".hidden"), b"").unwrap();
    std::fs::write(server.root().join("한글 파일.md"), b"x").unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);

    let listing = list(&root, false, None).unwrap();
    assert_eq!(listing.path, root);
    assert_eq!(names(&listing), ["docs", "a.txt", "한글 파일.md"]);
    let file = &listing.entries[1];
    assert_eq!(file.path, format!("{root}a.txt"));
    assert_eq!((file.kind.clone(), file.size_bytes), (crate::contracts::EntryKind::File, Some(5)));
    assert!(file.modified_at.is_some() && file.owner.is_some());
    assert_eq!(listing.entries[0].size_bytes, None);
    assert_eq!(listing.entries[2].path, format!("{root}한글 파일.md"));
    assert_eq!((listing.total_entries, listing.truncated), (None, None));

    assert!(names(&list(&root, true, None).unwrap()).contains(&".hidden"));
    assert_eq!(names(&list(&root, false, Some(" A.T ")).unwrap()), ["a.txt"]);

    let inner = list(&format!("{root}docs"), false, None).unwrap();
    assert_eq!(inner.entries.len(), 1);
    let parent = &inner.entries[0];
    assert!(parent.is_virtual && parent.name == ".." && parent.path == root);
    super::block_on(connection::disconnect(&connection.location));
}

#[cfg(unix)]
#[test]
fn remote_listing_reports_permissions_executables_and_link_targets() {
    use std::os::unix::fs::{symlink, PermissionsExt};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-list-unix");
    std::fs::create_dir(server.root().join("docs")).unwrap();
    std::fs::write(server.root().join("run.sh"), b"#!/bin/sh\n").unwrap();
    std::fs::set_permissions(server.root().join("run.sh"), std::fs::Permissions::from_mode(0o750)).unwrap();
    symlink(server.root().join("docs"), server.root().join("docs-link")).unwrap();
    symlink(server.root().join("absent"), server.root().join("dangling")).unwrap();
    let connection = connected(&server, &dir);
    let listing = list(&root_url(&server), false, None).unwrap();
    let entry = |name: &str| listing.entries.iter().find(|entry| entry.name == name).unwrap();
    assert_eq!(entry("run.sh").kind, crate::contracts::EntryKind::Executable);
    assert_eq!(entry("run.sh").permissions.as_deref(), Some("-rwxr-x---"));
    assert_eq!(entry("docs").permissions.as_deref().map(|text| &text[..1]), Some("d"));
    assert_eq!(entry("docs-link").kind, crate::contracts::EntryKind::Symlink);
    assert_eq!(entry("docs-link").symlink_target_is_directory, Some(true));
    assert_eq!(entry("dangling").symlink_target_is_directory, None);

    let linked = list(&format!("{}docs-link", root_url(&server)), false, None).unwrap();
    assert_eq!(names(&linked), [".."]);
    let info = super::block_on(super::listing::metadata(&format!("{}docs-link", root_url(&server)))).unwrap();
    assert_eq!((info.entry.kind, info.entry.symlink_target_is_directory), (crate::contracts::EntryKind::Symlink, Some(true)));
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn remote_navigation_resolves_home_relative_absolute_and_parent_input() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-goto");
    std::fs::create_dir_all(server.root().join("docs/sub")).unwrap();
    std::fs::write(server.root().join("docs/file.txt"), b"").unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let goto = |input: &str, base: &str| {
        super::block_on(super::listing::goto_path(crate::contracts::PanelId::Right, input, Some(base)))
    };
    let sub = format!("{root}docs/sub");
    assert_eq!(goto("docs/sub", &root).unwrap().path, sub);
    assert_eq!(goto("..", &sub).unwrap().path, format!("{root}docs"));
    assert_eq!(goto("~", &sub).unwrap().path, root);
    assert_eq!(goto("/docs", &sub).unwrap().path, format!("{root}docs"));
    assert_eq!(goto(&format!(" {sub} "), &root).unwrap().path, sub);
    let missing = goto("missing", &root).unwrap_err();
    assert_eq!((missing.code.as_str(), missing.path.as_deref()), ("not_found", Some(format!("{root}missing").as_str())));
    assert_eq!(goto("docs/file.txt", &root).unwrap_err().code, "not_directory");
    let info = super::block_on(super::listing::metadata(&format!("{root}docs/file.txt"))).unwrap();
    assert_eq!((info.absolute_path, info.extension.as_deref()), (format!("{root}docs/file.txt"), Some("txt")));
    super::block_on(connection::disconnect(&connection.location));
    assert_eq!(goto("docs", &root).unwrap_err().code, "remote_not_connected");
}

#[test]
fn remote_listing_skips_unsafe_names_batches_and_marks_truncation() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-list-names");
    for index in 0..155 {
        std::fs::write(server.root().join(format!("f{index:03}")), b"").unwrap();
    }
    server.faults().inject_readdir_names(vec!["../escape".into(), "a/b".into(), ".".into(), "..".into(), String::new(), "ok-name".into()]);
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let listing = list(&root, true, None).unwrap();
    assert_eq!(listing.entries.len(), 156);
    assert!(listing.entries.iter().all(|entry| !entry.name.contains('/') && entry.name != ".." && !entry.name.is_empty()));
    assert!(names(&listing).contains(&"ok-name"));

    let limited = super::block_on(super::listing::list_dir_limited(
        crate::contracts::PanelId::Left,
        &root,
        false,
        crate::contracts::SortSpec::default(),
        None,
        10,
    ))
    .unwrap();
    assert_eq!((limited.entries.len(), limited.total_entries, limited.truncated), (10, Some(156), Some(true)));
    assert_eq!(limited.entries[0].name, "f000");
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn remote_listing_reports_denied_folders_with_remote_paths() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-list-denied");
    std::fs::create_dir(server.root().join("locked")).unwrap();
    server.faults().deny_path_prefix("/locked".into());
    let connection = connected(&server, &dir);
    let error = list(&format!("{}locked", root_url(&server)), false, None).unwrap_err();
    assert_eq!(error.code, "permission_denied");
    assert_eq!(error.path.as_deref(), Some(format!("{}locked", root_url(&server)).as_str()));
    super::block_on(connection::disconnect(&connection.location));
}

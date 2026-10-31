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
        recipe: None,
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

/// 클라이언트 연결 하나를 서버로 중계. 알림을 받으면 클라이언트 쪽을 RST로 끊어 서버 프로세스가 죽은 상황을 재현.
fn start_resetting_proxy(target: u16) -> (u16, Arc<tokio::sync::Notify>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    listener.set_nonblocking(true).unwrap();
    let port = listener.local_addr().unwrap().port();
    let reset = Arc::new(tokio::sync::Notify::new());
    let signal = Arc::clone(&reset);
    super::runtime().spawn(async move {
        let listener = tokio::net::TcpListener::from_std(listener).unwrap();
        let (mut client, _) = listener.accept().await.unwrap();
        let mut server = tokio::net::TcpStream::connect(("127.0.0.1", target)).await.unwrap();
        let reset = tokio::select! {
            _ = tokio::io::copy_bidirectional(&mut client, &mut server) => false,
            _ = signal.notified() => true,
        };
        if reset {
            // 대기 시간 0의 SO_LINGER: 닫을 때 FIN 대신 RST
            #[allow(deprecated)]
            let _ = client.set_linger(Some(Duration::ZERO));
        }
    });
    (port, reset)
}

#[test]
fn server_side_reset_is_reported_as_lost_without_a_request() {
    // 서버 프로세스가 죽어 RST로 끊긴 연결도 요청 없이 끊김 알림(FR-34.7). 위 시험은 정상 종료(FIN)만 확인
    let (listener, events) = recorder();
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-reset");
    let (port, reset) = start_resetting_proxy(server.port());
    russh::keys::known_hosts::learn_known_hosts_path("127.0.0.1", port, &server.host_public_key(), dir.path().join("known_hosts"))
        .unwrap();
    let location = connect(options(port, password("pw"), &dir, Some(listener))).unwrap().location.clone();

    reset.notify_one();
    let deadline = Instant::now() + Duration::from_secs(10);
    while Instant::now() < deadline && events.lock().unwrap().len() < 2 {
        std::thread::sleep(Duration::from_millis(20));
    }
    let session_id = format!("sftp://tester@127.0.0.1:{port}/");
    assert_eq!(*events.lock().unwrap(), vec![
        (session_id.clone(), RemoteConnectionState::Connected, None),
        (session_id, RemoteConnectionState::Lost, Some("remote_connection_lost".to_string())),
    ]);
    assert_eq!(connection::connection(&location).unwrap_err().code, "remote_not_connected");
    assert!(connection::sessions().iter().all(|session| session.port != port));
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
        site_id: None,
        save_secret: false,
    };
    let settings = RemoteSettings { keepalive_seconds: 45, connect_timeout_seconds: 9, ..Default::default() };
    let paths = KnownHostsPaths { app: "known_hosts".into(), user: None };
    let store = super::credentials::MemorySecretStore::default();
    let (options, pending) = ConnectOptions::from_request(request(RemoteAuthMethod::PublicKey, Some("~/.ssh/id")), &settings, paths.clone(), None, &store).unwrap();
    assert_eq!(options.location, RemoteLocation::new("boksl", "::1", 2222).unwrap());
    assert_eq!((options.connect_timeout, options.keepalive), (Duration::from_secs(9), Duration::from_secs(45)));
    assert!(matches!(options.credential, RemoteCredential::KeyFile { ref path, passphrase: None } if path == "~/.ssh/id"));
    assert!(pending.is_none());
    let missing_key = ConnectOptions::from_request(request(RemoteAuthMethod::PublicKey, Some(" ")), &settings, paths.clone(), None, &store);
    assert_eq!(missing_key.err().unwrap().code, "remote_key_unreadable");
    let mut invalid = request(RemoteAuthMethod::Password, None);
    invalid.host = "a b".into();
    assert_eq!(ConnectOptions::from_request(invalid, &settings, paths, None, &store).err().unwrap().code, "invalid_path");
}

#[test]
fn site_secrets_are_saved_only_on_request_and_reused_when_not_typed() {
    use super::credentials::{account, MemorySecretStore, SecretKind, SecretStore};
    let store = MemorySecretStore::default();
    let paths = KnownHostsPaths { app: "known_hosts".into(), user: None };
    let settings = RemoteSettings::default();
    let request = |password: Option<&str>, save_secret| RemoteConnectRequest {
        host: "example.com".into(),
        port: 22,
        user: "boksl".into(),
        auth_method: RemoteAuthMethod::Password,
        password: password.map(str::to_string),
        key_path: None,
        passphrase: None,
        site_id: Some("site-1".into()),
        save_secret,
    };
    let (_, unsaved) = ConnectOptions::from_request(request(Some("typed"), false), &settings, paths.clone(), None, &store).unwrap();
    assert!(unsaved.is_none());
    let (_, pending) = ConnectOptions::from_request(request(Some("typed"), true), &settings, paths.clone(), None, &store).unwrap();
    let pending = pending.unwrap();
    assert_eq!(format!("{pending:?}"), "PendingSecret(Password)");
    pending.store(&store).unwrap();
    assert_eq!(store.get(&account("site-1", SecretKind::Password)).unwrap().as_deref(), Some("typed"));
    let (options, again) = ConnectOptions::from_request(request(None, true), &settings, paths, None, &store).unwrap();
    assert!(again.is_none());
    assert!(matches!(options.credential, RemoteCredential::Password(ref secret) if secret == "typed"));
}

#[test]
fn lost_connections_reconnect_once_with_saved_credentials_but_not_after_disconnect() {
    use super::credentials::{account, store, SecretKind};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-reconnect");
    trust(&server, &dir);
    std::fs::create_dir(server.root().join("docs")).unwrap();
    let site_id = format!("site-reconnect-{}", server.port());
    store().set(&account(&site_id, SecretKind::Password), "pw").unwrap();
    let request = RemoteConnectRequest {
        host: "127.0.0.1".into(),
        port: server.port(),
        user: "tester".into(),
        auth_method: RemoteAuthMethod::Password,
        password: None,
        key_path: None,
        passphrase: None,
        site_id: Some(site_id.clone()),
        save_secret: false,
    };
    let (options, _) = ConnectOptions::from_request(request, &RemoteSettings::default(), known_hosts(&dir), None, store()).unwrap();
    let first = connect(options).unwrap();
    let location = first.location.clone();
    // 서버 쪽 끊김: 읽기 요청에서 서버가 TCP 연결을 끊음
    std::fs::write(server.root().join("docs/a.txt"), b"abc").unwrap();
    server.faults().set_disconnect_after_bytes(1);
    assert!(super::block_on(first.sftp.read("/docs/a.txt")).is_err());
    drop(first);
    let deadline = Instant::now() + Duration::from_secs(5);
    while connection::connection(&location).is_ok() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    assert!(connection::connection(&location).is_err());
    server.faults().reset();
    let listing = list(&format!("{}docs", root_url(&server)), false, None).unwrap();
    assert_eq!(names(&listing), ["..", "a.txt"]);
    assert!(connection::connection(&location).is_ok());

    super::block_on(connection::disconnect(&location));
    assert_eq!(list(&root_url(&server), false, None).unwrap_err().code, "remote_not_connected");
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

fn summary_codes(summary: &crate::contracts::OperationSummary) -> Vec<&str> {
    summary.errors.iter().map(|error| error.code.as_str()).collect()
}

#[test]
fn remote_create_and_rename_follow_local_name_rules_without_overwrite() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-mutation");
    std::fs::write(server.root().join("a.txt"), b"a").unwrap();
    std::fs::write(server.root().join("keep.txt"), b"keep").unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let create = |name: &str| super::block_on(super::ops::create_dir(&root, name));
    let rename = |path: &str, name: &str| super::block_on(super::ops::rename_entry(&format!("{root}{path}"), name));

    let created = create(" 새 폴더 ").unwrap();
    assert_eq!((created.name.as_str(), created.path.clone()), ("새 폴더", format!("{root}새 폴더")));
    assert!(server.root().join("새 폴더").is_dir());
    assert_eq!(create("새 폴더").unwrap_err().code, "already_exists");
    for invalid in ["", " ", ".", "..", "a/b", r"a\b"] {
        assert_eq!(create(invalid).unwrap_err().code, "invalid_name", "{invalid:?}");
    }

    assert_eq!(rename("a.txt", "keep.txt").unwrap_err().code, "already_exists");
    assert_eq!(std::fs::read(server.root().join("keep.txt")).unwrap(), b"keep");
    let renamed = rename("a.txt", "b.txt").unwrap();
    assert_eq!(renamed.path, format!("{root}b.txt"));
    // 대소문자만 바꾸는 이름 변경: 대소문자 무시 파일 시스템에서도 임시 이름을 거쳐 성공
    assert_eq!(rename("b.txt", "B.txt").unwrap().name, "B.txt");
    let names: Vec<String> = std::fs::read_dir(server.root()).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).collect();
    assert!(names.contains(&"B.txt".to_string()) && !names.iter().any(|name| name.starts_with(".boksldir-rename")), "{names:?}");
    assert_eq!(super::block_on(super::ops::rename_entry(&root, "x")).unwrap_err().code, "invalid_path");
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn remote_permanent_delete_removes_trees_and_protects_root_and_home() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-delete");
    std::fs::create_dir_all(server.root().join("tree/sub")).unwrap();
    std::fs::write(server.root().join("tree/a.txt"), b"12345").unwrap();
    std::fs::write(server.root().join("tree/sub/b.txt"), b"678").unwrap();
    std::fs::write(server.root().join("single.txt"), b"x").unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let delete = |targets: Vec<String>, mode| {
        crate::operation::start_delete(None, targets, mode, Some("PERMANENT_DELETE"))
    };
    assert_eq!(delete(vec![format!("{root}tree")], crate::contracts::DeleteMode::Trash).unwrap_err().code, "unsupported");
    assert_eq!(delete(vec![root.clone()], crate::contracts::DeleteMode::Permanent).unwrap_err().message_key, "errors.protectedPath");
    let mixed = delete(vec![format!("{root}tree"), "sftp://other@127.0.0.1:1/x".into()], crate::contracts::DeleteMode::Permanent);
    assert_eq!(mixed.unwrap_err().message_key, "errors.remoteMixedLocations");
    let unconfirmed = crate::operation::start_delete(None, vec![format!("{root}tree")], crate::contracts::DeleteMode::Permanent, None);
    assert_eq!(unconfirmed.unwrap_err().code, "confirmation_required");

    let summary = crate::operation::run_remote_delete(None, "op-remote-delete-test", &[format!("{root}tree"), format!("{root}tree/sub"), format!("{root}single.txt")]);
    assert_eq!(summary.state, crate::contracts::OperationState::Completed, "{:?}", summary.errors);
    assert_eq!((summary.completed_files, summary.failed_files), (5, 0));
    assert!(!server.root().join("tree").exists() && !server.root().join("single.txt").exists());

    std::fs::create_dir(server.root().join("locked")).unwrap();
    std::fs::write(server.root().join("locked/in.txt"), b"").unwrap();
    server.faults().deny_path_prefix("/locked/in.txt".into());
    let denied = crate::operation::run_remote_delete(None, "op-remote-delete-denied", &[format!("{root}locked")]);
    assert_eq!(denied.state, crate::contracts::OperationState::Failed);
    assert_eq!(summary_codes(&denied), ["permission_denied"]);
    assert!(server.root().join("locked/in.txt").exists());
    super::block_on(connection::disconnect(&connection.location));
}

#[cfg(unix)]
#[test]
fn remote_permanent_delete_removes_links_without_following_them() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-delete-links");
    let outside = TempDir::new("remote-delete-outside");
    std::fs::write(outside.path().join("precious.txt"), b"keep").unwrap();
    std::fs::create_dir(server.root().join("tree")).unwrap();
    std::os::unix::fs::symlink(outside.path(), server.root().join("tree/outside-link")).unwrap();
    let connection = connected(&server, &dir);
    let summary = crate::operation::run_remote_delete(None, "op-remote-delete-link", &[format!("{}tree", root_url(&server))]);
    assert_eq!(summary.state, crate::contracts::OperationState::Completed, "{:?}", summary.errors);
    assert_eq!(std::fs::read(outside.path().join("precious.txt")).unwrap(), b"keep");
    super::block_on(connection::disconnect(&connection.location));
}

#[cfg(unix)]
#[test]
fn remote_chmod_applies_selected_items_or_recursive_scope_without_touching_links() {
    use std::os::unix::fs::PermissionsExt;
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-chmod");
    std::fs::create_dir_all(server.root().join("tree/sub")).unwrap();
    std::fs::write(server.root().join("tree/f.txt"), b"").unwrap();
    std::fs::write(server.root().join("target.txt"), b"").unwrap();
    std::fs::set_permissions(server.root().join("target.txt"), std::fs::Permissions::from_mode(0o644)).unwrap();
    std::os::unix::fs::symlink(server.root().join("target.txt"), server.root().join("tree/link")).unwrap();
    for path in ["tree", "tree/sub"] {
        std::fs::set_permissions(server.root().join(path), std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    std::fs::set_permissions(server.root().join("tree/f.txt"), std::fs::Permissions::from_mode(0o644)).unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let mode = |path: &str| std::fs::symlink_metadata(server.root().join(path)).unwrap().permissions().mode() & 0o7777;
    let chmod = |mode: u32, recursive: bool, scope| crate::operation::run_remote_chmod(None, "op-remote-chmod-test", &[format!("{root}tree")], mode, recursive, scope);

    let only_selected = chmod(0o750, false, crate::contracts::ChmodScope::All);
    assert_eq!((only_selected.completed_files, mode("tree"), mode("tree/sub")), (1, 0o750, 0o755));
    let directories = chmod(0o700, true, crate::contracts::ChmodScope::Directories);
    assert_eq!(directories.state, crate::contracts::OperationState::Completed, "{:?}", directories.errors);
    assert_eq!((mode("tree"), mode("tree/sub"), mode("tree/f.txt")), (0o700, 0o700, 0o644));
    let files = chmod(0o600, true, crate::contracts::ChmodScope::Files);
    assert_eq!((mode("tree"), mode("tree/f.txt"), mode("target.txt")), (0o700, 0o600, 0o644));
    assert_eq!(files.completed_files, 1);
    let invalid = crate::operation::start_remote_chmod(None, vec![format!("{root}tree")], 0o10000, false, crate::contracts::ChmodScope::All);
    assert_eq!(invalid.unwrap_err().code, "invalid_mode");
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn remote_bulk_rename_previews_conflicts_and_applies_only_unchanged_sources() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-bulk-rename");
    for name in ["a.txt", "b.txt", "new-b.txt", "c.txt"] {
        std::fs::write(server.root().join(name), name.as_bytes()).unwrap();
    }
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let rules = crate::contracts::RenameRules {
        find: String::new(),
        replacement: String::new(),
        prefix: "new-".into(),
        numbering: false,
        start: 1,
        padding: 0,
        preserve_extension: true,
    };
    let sources = |names: &[&str]| names.iter().map(|name| format!("{root}{name}")).collect::<Vec<_>>();
    let rows = super::block_on(super::bulk_rename::preview(sources(&["a.txt", "b.txt"]), rules.clone())).unwrap();
    assert_eq!(rows[0].item.new_name, "new-a.txt");
    assert!(rows[0].changed && rows[0].error.is_none());
    assert_eq!(rows[1].error.as_ref().map(|error| error.code.as_str()), Some("already_exists"));

    let rows = super::block_on(super::bulk_rename::preview(sources(&["a.txt", "c.txt"]), rules)).unwrap();
    let items: Vec<_> = rows.iter().map(|row| row.item.clone()).collect();
    std::fs::write(server.root().join("c.txt"), b"changed after preview").unwrap();
    let stale = crate::operation::start_bulk_rename(None, items.clone());
    assert_eq!(stale.unwrap_err().code, "source_changed");
    crate::operation::start_bulk_rename(None, items[..1].to_vec()).unwrap();
    assert!(server.root().join("new-a.txt").is_file() && !server.root().join("a.txt").exists());
    super::block_on(connection::disconnect(&connection.location));
}

fn transfer(kind: crate::contracts::OperationKind, sources: &[String], target: &str, policy: crate::contracts::ConflictDecision) -> crate::contracts::OperationSummary {
    crate::operation::run_remote_transfer(None, "op-remote-transfer-test", kind, sources, target, policy, crate::contracts::RemoteLinkPolicy::Preserve)
}

fn mtime(path: &std::path::Path) -> u64 {
    std::fs::metadata(path).unwrap().modified().unwrap().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs()
}

fn leftovers(dir: &std::path::Path) -> Vec<String> {
    std::fs::read_dir(dir).unwrap().map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned()).filter(|name| name.contains(".boksldir-")).collect()
}

fn sample_bytes(length: usize) -> Vec<u8> {
    (0..length).map(|index| (index * 31 % 251) as u8).collect()
}

#[test]
fn uploads_and_downloads_folders_through_temporary_names_and_keep_modified_times() {
    use crate::contracts::{ConflictDecision, OperationKind, OperationState};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-transfer");
    let local = TempDir::new("remote-transfer-local");
    std::fs::create_dir_all(local.path().join("tree/한글 폴더")).unwrap();
    std::fs::write(local.path().join("tree/big.bin"), sample_bytes(700_000)).unwrap();
    std::fs::write(local.path().join("tree/한글 폴더/note.txt"), b"note").unwrap();
    let old = std::time::UNIX_EPOCH + std::time::Duration::from_secs(1_600_000_000);
    std::fs::File::options().write(true).open(local.path().join("tree/big.bin")).unwrap().set_modified(old).unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);

    let upload = transfer(OperationKind::Copy, &[display(&local.path().join("tree"))], &root, ConflictDecision::Skip);
    assert_eq!(upload.state, OperationState::Completed, "{:?}", upload.errors);
    assert_eq!(upload.completed_files, 4);
    assert_eq!(std::fs::read(server.root().join("tree/big.bin")).unwrap(), sample_bytes(700_000));
    assert_eq!(std::fs::read(server.root().join("tree/한글 폴더/note.txt")).unwrap(), b"note");
    assert_eq!(mtime(&server.root().join("tree/big.bin")), 1_600_000_000);
    assert!(leftovers(server.root()).is_empty());

    let back = TempDir::new("remote-transfer-back");
    let download = transfer(OperationKind::Copy, &[format!("{root}tree")], &display(back.path()), ConflictDecision::Skip);
    assert_eq!(download.state, OperationState::Completed, "{:?}", download.errors);
    assert_eq!(std::fs::read(back.path().join("tree/big.bin")).unwrap(), sample_bytes(700_000));
    assert_eq!(mtime(&back.path().join("tree/big.bin")), 1_600_000_000);
    assert!(leftovers(back.path()).is_empty());

    let into_self = transfer(OperationKind::Copy, &[format!("{root}tree")], &format!("{root}tree/한글 폴더"), ConflictDecision::Skip);
    assert_eq!(into_self.errors[0].message_key, "errors.copyIntoSelf");
    super::block_on(connection::disconnect(&connection.location));
}

fn display(path: &std::path::Path) -> String {
    crate::path_text::display_path(path)
}

#[test]
fn transfer_conflicts_skip_or_replace_and_moves_remove_sources_only_after_success() {
    use crate::contracts::{ConflictDecision, OperationKind, OperationState};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-transfer-conflict");
    let local = TempDir::new("remote-transfer-conflict-local");
    std::fs::write(local.path().join("a.txt"), b"new").unwrap();
    std::fs::write(server.root().join("a.txt"), b"old").unwrap();
    std::fs::create_dir(server.root().join("dest")).unwrap();
    std::fs::create_dir(server.root().join("src")).unwrap();
    std::fs::write(server.root().join("src/moved.txt"), b"moved").unwrap();
    std::fs::write(server.root().join("dest/moved.txt"), b"existing").unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let source = display(&local.path().join("a.txt"));

    let skipped = transfer(OperationKind::Copy, std::slice::from_ref(&source), &root, ConflictDecision::Skip);
    assert_eq!((skipped.skipped_files, std::fs::read(server.root().join("a.txt")).unwrap()), (1, b"old".to_vec()));
    let replaced = transfer(OperationKind::Copy, std::slice::from_ref(&source), &root, ConflictDecision::Overwrite);
    assert_eq!(replaced.state, OperationState::Completed, "{:?}", replaced.errors);
    assert_eq!(std::fs::read(server.root().join("a.txt")).unwrap(), b"new");
    assert!(leftovers(server.root()).is_empty());

    // 같은 서버 안 이동은 이름 변경, 충돌하면 선택에 따름
    let same_server_skip = transfer(OperationKind::Move, &[format!("{root}src/moved.txt")], &format!("{root}dest"), ConflictDecision::Skip);
    assert_eq!(same_server_skip.skipped_files, 1);
    let same_server = transfer(OperationKind::Move, &[format!("{root}src/moved.txt")], &format!("{root}dest"), ConflictDecision::Overwrite);
    assert_eq!(same_server.state, OperationState::Completed, "{:?}", same_server.errors);
    assert_eq!(std::fs::read(server.root().join("dest/moved.txt")).unwrap(), b"moved");
    assert!(!server.root().join("src/moved.txt").exists() && leftovers(&server.root().join("dest")).is_empty());

    // 다른 끝점으로 이동: 대상에 쓰지 못하면 원본 보존
    server.faults().deny_path_prefix("/locked".into());
    std::fs::create_dir(server.root().join("locked")).unwrap();
    let failed_move = transfer(OperationKind::Move, std::slice::from_ref(&source), &format!("{root}locked"), ConflictDecision::Skip);
    assert_eq!(failed_move.state, OperationState::Failed);
    assert!(local.path().join("a.txt").exists());
    let moved = transfer(OperationKind::Move, std::slice::from_ref(&source), &format!("{root}dest"), ConflictDecision::Skip);
    assert_eq!(moved.state, OperationState::Completed, "{:?}", moved.errors);
    assert!(!local.path().join("a.txt").exists() && server.root().join("dest/a.txt").is_file());
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn interrupted_uploads_leave_only_temporary_files_and_resume_on_retry() {
    use crate::contracts::{ConflictDecision, OperationKind, OperationState};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-transfer-resume");
    let local = TempDir::new("remote-transfer-resume-local");
    std::fs::write(local.path().join("big.bin"), sample_bytes(1_500_000)).unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let source = display(&local.path().join("big.bin"));

    server.faults().set_disconnect_after_bytes(600_000);
    let interrupted = transfer(OperationKind::Copy, std::slice::from_ref(&source), &root, ConflictDecision::Skip);
    assert_eq!(interrupted.state, OperationState::Failed);
    assert!(!server.root().join("big.bin").exists());
    let partial = leftovers(server.root());
    assert_eq!(partial.len(), 1, "{partial:?}");
    let kept = std::fs::metadata(server.root().join(&partial[0])).unwrap().len();
    assert!(kept > 0 && kept < 1_500_000, "{kept}");

    server.faults().reset();
    drop(connection);
    let deadline = Instant::now() + Duration::from_secs(5);
    while connection::connection(&RemoteLocation::new("tester", "127.0.0.1", server.port()).unwrap()).is_ok() && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(20));
    }
    let connection = connect(options(server.port(), password("pw"), &dir, None)).unwrap();
    let resumed = transfer(OperationKind::Copy, std::slice::from_ref(&source), &root, ConflictDecision::Skip);
    assert_eq!(resumed.state, OperationState::Completed, "{:?}", resumed.errors);
    assert_eq!(std::fs::read(server.root().join("big.bin")).unwrap(), sample_bytes(1_500_000));
    assert!(leftovers(server.root()).is_empty());

    // 내용이 원본과 다른 임시본(빈 구간)은 이어받지 않고 처음부터 다시 받음
    std::fs::remove_file(server.root().join("big.bin")).unwrap();
    let mut damaged = sample_bytes(900_000);
    damaged[300_000..600_000].fill(0);
    std::fs::write(server.root().join(&partial[0]), damaged).unwrap();
    let restarted = transfer(OperationKind::Copy, std::slice::from_ref(&source), &root, ConflictDecision::Skip);
    assert_eq!(restarted.state, OperationState::Completed, "{:?}", restarted.errors);
    assert_eq!(std::fs::read(server.root().join("big.bin")).unwrap(), sample_bytes(1_500_000));
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn cancelled_downloads_remove_temporary_files() {
    use crate::contracts::{ConflictDecision, OperationKind, OperationState, RemoteLinkPolicy};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-transfer-cancel");
    let local = TempDir::new("remote-transfer-cancel-local");
    std::fs::write(server.root().join("slow.bin"), sample_bytes(2_000_000)).unwrap();
    let connection = connected(&server, &dir);
    server.faults().set_delay_ms(15);
    let operation_id = "op-remote-transfer-cancel";
    let watched = local.path().to_path_buf();
    let canceller = std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(10);
        while leftovers(&watched).is_empty() && Instant::now() < deadline {
            std::thread::sleep(Duration::from_millis(5));
        }
        crate::operation::cancel_operation(operation_id.to_string()).unwrap();
    });
    let summary = crate::operation::run_remote_transfer_registered_for_test(
        operation_id,
        OperationKind::Copy,
        &[format!("{}slow.bin", root_url(&server))],
        &display(local.path()),
        ConflictDecision::Skip,
        RemoteLinkPolicy::Preserve,
    );
    canceller.join().unwrap();
    assert_eq!(summary.state, OperationState::Cancelled);
    assert!(leftovers(local.path()).is_empty() && !local.path().join("slow.bin").exists());
    server.faults().reset();
    super::block_on(connection::disconnect(&connection.location));
}

#[cfg(unix)]
#[test]
fn link_policies_preserve_follow_or_skip_links_and_reject_loops() {
    use crate::contracts::{ConflictDecision, OperationKind, OperationState, RemoteLinkPolicy};
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-transfer-links");
    let local = TempDir::new("remote-transfer-links-local");
    std::fs::create_dir_all(local.path().join("tree/data")).unwrap();
    std::fs::write(local.path().join("tree/data/file.txt"), b"data").unwrap();
    std::os::unix::fs::symlink("data/file.txt", local.path().join("tree/link.txt")).unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let run = |policy, target: &str| {
        std::fs::create_dir(server.root().join(target)).unwrap();
        crate::operation::run_remote_transfer(None, "op-remote-links", OperationKind::Copy, &[display(&local.path().join("tree"))], &format!("{root}{target}"), ConflictDecision::Skip, policy)
    };
    let preserved = run(RemoteLinkPolicy::Preserve, "preserve");
    assert_eq!(preserved.state, OperationState::Completed, "{:?}", preserved.errors);
    assert_eq!(std::fs::read_link(server.root().join("preserve/tree/link.txt")).unwrap(), std::path::Path::new("data/file.txt"));
    let followed = run(RemoteLinkPolicy::Follow, "follow");
    assert_eq!(followed.state, OperationState::Completed, "{:?}", followed.errors);
    assert!(!std::fs::symlink_metadata(server.root().join("follow/tree/link.txt")).unwrap().file_type().is_symlink());
    assert_eq!(std::fs::read(server.root().join("follow/tree/link.txt")).unwrap(), b"data");
    let skipped = run(RemoteLinkPolicy::Skip, "skip");
    assert_eq!((skipped.state, skipped.skipped_files), (OperationState::Completed, 1));
    assert!(!server.root().join("skip/tree/link.txt").exists());

    std::os::unix::fs::symlink(local.path().join("tree"), local.path().join("tree/data/loop")).unwrap();
    let looped = run(RemoteLinkPolicy::Follow, "loop");
    assert_eq!(looped.errors[0].message_key, "errors.remoteLinkLoop");
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn remote_quick_view_uses_local_preview_rules_on_the_downloaded_prefix() {
    let server = TestSftpServer::start(TestServerOptions::default());
    let dir = TempDir::new("remote-preview");
    std::fs::write(server.root().join("notes.txt"), "가나다라마바사".repeat(10)).unwrap();
    std::fs::write(server.root().join("binary.txt"), [b'a', 0, b'b']).unwrap();
    std::fs::write(server.root().join("tool.bin"), [0u8; 16]).unwrap();
    std::fs::write(server.root().join("pixel.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::create_dir(server.root().join("folder")).unwrap();
    let connection = connected(&server, &dir);
    let root = root_url(&server);
    let preview = |name: &str, max: Option<u64>| super::block_on(super::listing::preview(&format!("{root}{name}"), max));

    let text = preview("notes.txt", Some(12)).unwrap();
    assert_eq!((text.kind.as_str(), text.truncated, text.limit_bytes), ("text", true, 12));
    assert_eq!(text.text.as_deref(), Some("가나다라"));
    assert_eq!(text.path, format!("{root}notes.txt"));
    assert_eq!(preview("binary.txt", None).unwrap().kind, "unsupported");
    assert_eq!(preview("tool.bin", None).unwrap().kind, "unsupported");
    let image = preview("pixel.png", None).unwrap();
    assert_eq!((image.kind.as_str(), image.mime_type.as_deref()), ("image", Some("image/png")));
    assert!(image.data_url.unwrap().starts_with("data:image/png;base64,"));
    assert_eq!(preview("folder", None).unwrap_err().code, "not_file");
    super::block_on(connection::disconnect(&connection.location));
}

#[test]
fn remote_open_downloads_land_in_unique_app_temp_folders_cleared_at_exit() {
    let first = super::new_open_dir().unwrap();
    let second = super::new_open_dir().unwrap();
    assert_ne!(first, second);
    assert_eq!(first.parent(), second.parent());
    assert!(first.parent().unwrap().ends_with("BokslDirGUI-remote-open"));
    std::fs::write(first.join("opened.txt"), b"x").unwrap();
    super::clear_open_temp();
    assert!(!first.exists() && !second.exists());
}

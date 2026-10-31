//! SSH 연결과 SFTP 세션: 위치(사용자·호스트·포트)마다 연결 하나, 호스트 키 확인, 인증 방식별 로그인.
//! 비밀값(암호·키 암호·질문 응답)은 연결 요청 동안 메모리에만 두고 출력·직렬화·오류 상세에 남기지 않음.
use super::credentials::{account, SecretKind, SecretStore};
use super::path::RemoteLocation;
use crate::contracts::{
    AppError, CommandResult, RemoteAuthMethod, RemoteConnectRequest, RemoteConnectionChanged,
    RemoteConnectionState, RemoteSession, RemoteSettings,
};
use russh::client::{self, Handle, KeyboardInteractiveAuthResponse};
use russh::keys::{self, ssh_key, PrivateKeyWithHashAlg};
use russh::{MethodKind, MethodSet};
use russh_sftp::client::{RawSftpSession, SftpSession};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

pub(crate) const REMOTE_CONNECTION_CHANGED_EVENT: &str = "remote_connection_changed";
/// keyboard-interactive 질문에 답할 수 있는 시간. OpenSSH 로그인 유예 시간(기본 120초) 안쪽.
const CHALLENGE_LIFETIME: Duration = Duration::from_secs(110);
/// 질문이 끝없이 이어지는 서버 방지.
const MAX_PROMPT_ROUNDS: usize = 8;
const SFTP_REQUEST_TIMEOUT_SECONDS: u64 = 30;
const KEEPALIVE_MAX: usize = 3;

pub(crate) type ConnectionListener = Arc<dyn Fn(&RemoteConnectionChanged) + Send + Sync>;

/// 인증 비밀값. `Debug`는 내용 없이 종류만 표시.
pub(crate) enum RemoteCredential {
    Password(String),
    KeyFile { path: String, passphrase: Option<String> },
    /// 개인 키 경로를 비운 공개 키 인증: OpenSSH처럼 기본 개인 키를 차례로 시도
    DefaultKeyFiles { paths: Vec<PathBuf>, passphrase: Option<String> },
    Agent,
    KeyboardInteractive,
}

/// 경로를 비웠을 때 시도할 개인 키 이름(OpenSSH 기본 순서). 하드웨어 보안 키(`_sk`)와 지원이 끝난 DSA는 제외.
const DEFAULT_IDENTITY_FILES: [&str; 3] = ["id_rsa", "id_ecdsa", "id_ed25519"];

/// `ssh_dir` 안의 기본 개인 키 중 실제로 있는 파일(OpenSSH 기본 순서).
pub(crate) fn identity_files_in(ssh_dir: &Path) -> Vec<PathBuf> {
    DEFAULT_IDENTITY_FILES.iter().map(|name| ssh_dir.join(name)).filter(|path| path.is_file()).collect()
}

/// 공개 키 인증 자격: 경로가 있으면 그 파일만, 비웠으면 `~/.ssh`의 기본 개인 키 목록.
fn key_file_credential(path: Option<String>, passphrase: Option<String>) -> RemoteCredential {
    match path {
        Some(path) => RemoteCredential::KeyFile { path, passphrase },
        None => RemoteCredential::DefaultKeyFiles {
            paths: crate::platform::home_dir().map(|home| identity_files_in(&home.join(".ssh"))).unwrap_or_default(),
            passphrase,
        },
    }
}

impl std::fmt::Debug for RemoteCredential {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let kind = match self {
            Self::Password(_) => "password",
            Self::KeyFile { .. } => "keyFile",
            Self::DefaultKeyFiles { .. } => "defaultKeyFiles",
            Self::Agent => "agent",
            Self::KeyboardInteractive => "keyboardInteractive",
        };
        write!(formatter, "RemoteCredential({kind})")
    }
}

/// 신뢰 기록: 앱 전용 파일에 기록, 사용자 `~/.ssh/known_hosts`는 읽기만(FR-35.9).
#[derive(Debug, Clone)]
pub(crate) struct KnownHostsPaths {
    pub(crate) app: PathBuf,
    pub(crate) user: Option<PathBuf>,
}

impl KnownHostsPaths {
    pub(crate) fn standard() -> CommandResult<Self> {
        Ok(Self {
            app: crate::platform::config_dir()?.join("BokslDirGUI").join("known_hosts"),
            user: crate::platform::home_dir().ok().map(|home| home.join(".ssh").join("known_hosts")),
        })
    }
}

pub(crate) struct ConnectOptions {
    pub(crate) location: RemoteLocation,
    pub(crate) credential: RemoteCredential,
    pub(crate) connect_timeout: Duration,
    pub(crate) keepalive: Duration,
    pub(crate) known_hosts: KnownHostsPaths,
    pub(crate) listener: Option<ConnectionListener>,
    /// 끊긴 뒤 자동 재연결 방법(FR-34.8). 없으면 재연결하지 않음.
    pub(crate) recipe: Option<ReconnectRecipe>,
}

/// 끊긴 뒤 다시 연결할 방법. 비밀값은 담지 않고 필요할 때 자격 증명 저장소에서 다시 읽음.
#[derive(Clone)]
pub(crate) struct ReconnectRecipe {
    pub(crate) site_id: Option<String>,
    pub(crate) auth_method: RemoteAuthMethod,
    pub(crate) key_path: Option<String>,
    pub(crate) connect_timeout: Duration,
    pub(crate) keepalive: Duration,
    pub(crate) known_hosts: KnownHostsPaths,
    pub(crate) listener: Option<ConnectionListener>,
}

impl ReconnectRecipe {
    /// 사용자 입력 없이 만들 수 있는 인증 정보: 에이전트, 저장된 암호, 키 파일·기본 키(저장된 키 암호 포함). 그 밖은 없음.
    fn credential(&self, store: &dyn SecretStore) -> Option<RemoteCredential> {
        let saved = |kind| self.site_id.as_deref().and_then(|id| store.get(&account(id, kind)).ok().flatten());
        match self.auth_method {
            RemoteAuthMethod::Agent => Some(RemoteCredential::Agent),
            RemoteAuthMethod::Password => saved(SecretKind::Password).map(RemoteCredential::Password),
            RemoteAuthMethod::PublicKey => Some(key_file_credential(self.key_path.clone(), saved(SecretKind::Passphrase))),
            RemoteAuthMethod::KeyboardInteractive => None,
        }
    }
}

/// 연결 성공 뒤 저장할 비밀값(사용자가 저장을 선택한 경우). `Debug`는 내용 없이 종류만 표시.
pub(crate) struct PendingSecret {
    site_id: String,
    kind: SecretKind,
    secret: String,
}

impl std::fmt::Debug for PendingSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "PendingSecret({:?})", self.kind)
    }
}

impl PendingSecret {
    pub(crate) fn store(self, store: &dyn SecretStore) -> CommandResult<()> {
        store.set(&account(&self.site_id, self.kind), &self.secret)
    }
}

impl ConnectOptions {
    /// 연결 창 요청을 연결 옵션으로 변환. 비밀값을 입력하지 않았고 사이트에 저장된 값이 있으면 저장소에서 읽음.
    pub(crate) fn from_request(
        request: RemoteConnectRequest,
        settings: &RemoteSettings,
        known_hosts: KnownHostsPaths,
        listener: Option<ConnectionListener>,
        store: &dyn SecretStore,
    ) -> CommandResult<(Self, Option<PendingSecret>)> {
        let location = RemoteLocation::new(&request.user, &request.host, request.port)?;
        let site_id = request.site_id.filter(|id| !id.trim().is_empty());
        let saved = |kind| site_id.as_deref().and_then(|id| store.get(&account(id, kind)).ok().flatten());
        let pending = |typed: &Option<String>, kind| match (typed, &site_id) {
            (Some(secret), Some(id)) if request.save_secret => {
                Some(PendingSecret { site_id: id.clone(), kind, secret: secret.clone() })
            }
            _ => None,
        };
        let key_path = request.key_path.filter(|path| !path.trim().is_empty());
        let (credential, pending) = match request.auth_method {
            RemoteAuthMethod::Password => {
                let typed = request.password.filter(|password| !password.is_empty());
                let pending = pending(&typed, SecretKind::Password);
                (RemoteCredential::Password(typed.or_else(|| saved(SecretKind::Password)).unwrap_or_default()), pending)
            }
            RemoteAuthMethod::PublicKey => {
                let typed = request.passphrase.filter(|passphrase| !passphrase.is_empty());
                let pending = pending(&typed, SecretKind::Passphrase);
                (key_file_credential(key_path.clone(), typed.or_else(|| saved(SecretKind::Passphrase))), pending)
            }
            RemoteAuthMethod::Agent => (RemoteCredential::Agent, None),
            RemoteAuthMethod::KeyboardInteractive => (RemoteCredential::KeyboardInteractive, None),
        };
        let connect_timeout = Duration::from_secs(settings.connect_timeout_seconds.into());
        let keepalive = Duration::from_secs(settings.keepalive_seconds.into());
        let recipe = ReconnectRecipe {
            site_id,
            auth_method: request.auth_method,
            key_path,
            connect_timeout,
            keepalive,
            known_hosts: known_hosts.clone(),
            listener: listener.clone(),
        };
        Ok((Self { location, credential, connect_timeout, keepalive, known_hosts, listener, recipe: Some(recipe) }, pending))
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HostKeyInfo {
    pub(crate) algorithm: String,
    pub(crate) fingerprint: String,
}

impl HostKeyInfo {
    fn of(key: &ssh_key::PublicKey) -> Self {
        Self {
            algorithm: key.algorithm().as_str().to_string(),
            fingerprint: key.fingerprint(ssh_key::HashAlg::Sha256).to_string(),
        }
    }
}

enum HostKeyVerdict {
    Trusted(HostKeyInfo),
    Unknown(HostKeyInfo, ssh_key::PublicKey),
    Changed { presented: HostKeyInfo, recorded: HostKeyInfo },
}

/// 기록 파일 전체에서 같은 키가 하나라도 있으면 신뢰, 같은 알고리즘의 다른 키만 있으면 변경으로 판정.
fn verify_host_key(location: &RemoteLocation, key: &ssh_key::PublicKey, paths: &KnownHostsPaths) -> HostKeyVerdict {
    let mut changed = None;
    for path in std::iter::once(&paths.app).chain(paths.user.iter()) {
        // 읽을 수 없는 기록 파일은 신뢰 근거가 아니므로 건너뜀
        let Ok(recorded_keys) = keys::known_hosts::known_host_keys_path(&location.host, location.port, path) else {
            continue;
        };
        for (_, recorded) in recorded_keys {
            if recorded.key_data() == key.key_data() {
                return HostKeyVerdict::Trusted(HostKeyInfo::of(key));
            }
            if recorded.algorithm() == key.algorithm() && changed.is_none() {
                changed = Some(HostKeyInfo::of(&recorded));
            }
        }
    }
    match changed {
        Some(recorded) => HostKeyVerdict::Changed { presented: HostKeyInfo::of(key), recorded },
        None => HostKeyVerdict::Unknown(HostKeyInfo::of(key), key.clone()),
    }
}

struct ClientHandler {
    id: u64,
    location: RemoteLocation,
    known_hosts: KnownHostsPaths,
    verdict: Arc<Mutex<Option<HostKeyVerdict>>>,
    listener: Option<ConnectionListener>,
}

impl client::Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(&mut self, server_key: &keys::PublicKeyOrCertificate) -> Result<bool, Self::Error> {
        let verdict = verify_host_key(&self.location, &server_key.public_key(), &self.known_hosts);
        let trusted = matches!(verdict, HostKeyVerdict::Trusted(_));
        *lock(&self.verdict) = Some(verdict);
        Ok(trusted)
    }

    /// 등록된 연결이 앱 요청 없이 끝나면 끊김 알림. 앱이 끊은 연결은 이미 등록 해제되어 알림 없음.
    async fn disconnected(&mut self, reason: client::DisconnectReason<Self::Error>) -> Result<(), Self::Error> {
        if unregister(&self.location, self.id) {
            notify(
                self.listener.as_ref(),
                &self.location,
                RemoteConnectionState::Lost,
                Some(remote_error("remote_connection_lost", "errors.remoteConnectionLost", &self.location)),
            );
        }
        match reason {
            client::DisconnectReason::ReceivedDisconnect(_) => Ok(()),
            client::DisconnectReason::Error(error) => Err(error),
        }
    }
}

/// 연결된 원격 위치. 파일 요청은 `sftp`, 목록 설명(소유자 이름)·확장 요청은 별도 채널의 `raw` 사용.
pub(crate) struct RemoteConnection {
    id: u64,
    pub(crate) location: RemoteLocation,
    pub(crate) home: String,
    pub(crate) host_key: HostKeyInfo,
    pub(crate) sftp: SftpSession,
    pub(crate) raw: RawSftpSession,
    handle: Handle<ClientHandler>,
    listener: Option<ConnectionListener>,
}

impl std::fmt::Debug for RemoteConnection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(formatter, "RemoteConnection({})", session_id(&self.location))
    }
}

impl RemoteConnection {
    pub(crate) fn is_closed(&self) -> bool {
        self.handle.is_closed()
    }

    pub(crate) fn session(&self) -> RemoteSession {
        RemoteSession {
            session_id: session_id(&self.location),
            user: self.location.user.clone(),
            host: self.location.host.clone(),
            port: self.location.port,
            home: self.home.clone(),
            home_url: self.location.url(&self.home),
            host_key_algorithm: self.host_key.algorithm.clone(),
            host_key_fingerprint: self.host_key.fingerprint.clone(),
            secret_stored: false,
        }
    }
}

/// 세션 식별자: 원격 루트 URL(`sftp://사용자@호스트:포트/`), 프런트엔드 `remoteLocationKey`와 같은 값.
pub(crate) fn session_id(location: &RemoteLocation) -> String {
    location.url("/")
}

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn registry() -> &'static Mutex<HashMap<RemoteLocation, Arc<RemoteConnection>>> {
    static CONNECTIONS: OnceLock<Mutex<HashMap<RemoteLocation, Arc<RemoteConnection>>>> = OnceLock::new();
    CONNECTIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 위치별 자동 재연결 방법. 앱이 연결을 해제하면 지움.
fn recipes() -> &'static Mutex<HashMap<RemoteLocation, ReconnectRecipe>> {
    static RECIPES: OnceLock<Mutex<HashMap<RemoteLocation, ReconnectRecipe>>> = OnceLock::new();
    RECIPES.get_or_init(|| Mutex::new(HashMap::new()))
}

/// 신뢰 확인을 기다리는 호스트 키. 사용자가 본 지문과 같은 키만 기록.
fn pending_host_keys() -> &'static Mutex<HashMap<(String, u16), ssh_key::PublicKey>> {
    static PENDING: OnceLock<Mutex<HashMap<(String, u16), ssh_key::PublicKey>>> = OnceLock::new();
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

struct PendingChallenge {
    session: Authenticating,
    prompt_count: usize,
    expires_at: Instant,
}

fn pending_challenges() -> &'static Mutex<HashMap<String, PendingChallenge>> {
    static CHALLENGES: OnceLock<Mutex<HashMap<String, PendingChallenge>>> = OnceLock::new();
    CHALLENGES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn unregister(location: &RemoteLocation, id: u64) -> bool {
    let mut connections = lock(registry());
    if connections.get(location).is_some_and(|connection| connection.id == id) {
        connections.remove(location);
        return true;
    }
    false
}

fn notify(
    listener: Option<&ConnectionListener>,
    location: &RemoteLocation,
    state: RemoteConnectionState,
    error: Option<AppError>,
) {
    if let Some(listener) = listener {
        listener(&RemoteConnectionChanged { session_id: session_id(location), state, error });
    }
}

/// 연결된 위치 조회. 없거나 끊겼으면 `remote_not_connected`.
pub(crate) fn connection(location: &RemoteLocation) -> CommandResult<Arc<RemoteConnection>> {
    match lock(registry()).get(location) {
        Some(connection) if !connection.is_closed() => Ok(Arc::clone(connection)),
        _ => Err(not_connected(location)),
    }
}

/// 연결 조회, 끊겼으면 저장된 방법으로 한 번 다시 연결(FR-34.8). 사용자 입력이 필요하면 `remote_not_connected`.
pub(crate) async fn ensure(location: &RemoteLocation) -> CommandResult<Arc<RemoteConnection>> {
    if let Ok(existing) = connection(location) {
        return Ok(existing);
    }
    let Some(recipe) = lock(recipes()).get(location).cloned() else {
        return Err(not_connected(location));
    };
    // 키체인 접근은 사용자 허용 창으로 오래 걸릴 수 있어 작업 스레드에서 읽음
    let reader = recipe.clone();
    let credential = tokio::task::spawn_blocking(move || reader.credential(super::credentials::store()))
        .await
        .ok()
        .flatten()
        .ok_or_else(|| not_connected(location))?;
    connect(ConnectOptions {
        location: location.clone(),
        credential,
        connect_timeout: recipe.connect_timeout,
        keepalive: recipe.keepalive,
        known_hosts: recipe.known_hosts.clone(),
        listener: recipe.listener.clone(),
        recipe: Some(recipe),
    })
    .await
}

pub(crate) fn sessions() -> Vec<RemoteSession> {
    let mut sessions: Vec<RemoteSession> = lock(registry())
        .values()
        .filter(|connection| !connection.is_closed())
        .map(|connection| connection.session())
        .collect();
    sessions.sort_by(|left, right| left.session_id.cmp(&right.session_id));
    sessions
}

/// 연결 창의 연결: 연결 뒤 사용자가 저장을 선택한 비밀값 저장(FR-35.2).
/// 이미 연결된 위치는 기존 연결을 재사용해 입력한 비밀값으로 인증하지 않으므로, 확인되지 않은 값은 저장하지 않음.
pub(crate) async fn connect_saving_secret(
    options: ConnectOptions,
    pending: Option<PendingSecret>,
    store: &'static dyn SecretStore,
) -> CommandResult<RemoteSession> {
    let reused = connection(&options.location).is_ok();
    let mut session = connect(options).await?.session();
    if let Some(pending) = pending.filter(|_| !reused) {
        // 키체인 쓰기는 사용자 허용 창으로 오래 걸릴 수 있어 작업 스레드에서 실행
        session.secret_stored = tokio::task::spawn_blocking(move || pending.store(store).is_ok()).await.unwrap_or(false);
    }
    Ok(session)
}

/// 같은 위치가 이미 연결되어 있으면 그 연결 재사용. 처음 보는 호스트 키·변경된 호스트 키·추가 질문은 오류로 반환.
pub(crate) async fn connect(options: ConnectOptions) -> CommandResult<Arc<RemoteConnection>> {
    if let Ok(existing) = connection(&options.location) {
        return Ok(existing);
    }
    let ConnectOptions { location, credential, connect_timeout, keepalive, known_hosts, listener, recipe } = options;
    let deadline = tokio::time::Instant::now() + connect_timeout;
    let stream = tokio::time::timeout_at(deadline, open_tcp(&location))
        .await
        .map_err(|_| timed_out(&location))??;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let verdict = Arc::new(Mutex::new(None));
    let handler = ClientHandler {
        id,
        location: location.clone(),
        known_hosts,
        verdict: Arc::clone(&verdict),
        listener: listener.clone(),
    };
    let config = Arc::new(client::Config {
        keepalive_interval: Some(keepalive),
        keepalive_max: KEEPALIVE_MAX,
        nodelay: true,
        ..Default::default()
    });
    let handle = match tokio::time::timeout_at(deadline, client::connect_stream(config, stream, handler)).await {
        Err(_) => return Err(timed_out(&location)),
        Ok(Err(error)) => return Err(handshake_error(&location, &verdict, &error)),
        Ok(Ok(handle)) => handle,
    };
    let verdict = lock(&verdict).take();
    let Some(HostKeyVerdict::Trusted(host_key)) = verdict else {
        abandon(&handle).await;
        return Err(connect_failed(&location, "host key was not verified"));
    };
    let mut session = Authenticating { id, location, host_key, handle, listener, timeout: connect_timeout, recipe };
    let outcome = match tokio::time::timeout_at(deadline, session.authenticate(credential)).await {
        Ok(outcome) => outcome,
        Err(_) => Err(timed_out(&session.location)),
    };
    session.conclude(outcome, deadline).await
}

/// 대기 중인 질문 꺼내기. 시간이 지난 질문은 함께 정리(연결은 Drop으로 닫힘).
fn take_challenge(challenge_id: &str) -> Option<PendingChallenge> {
    let mut challenges = lock(pending_challenges());
    let now = Instant::now();
    challenges.retain(|_, challenge| challenge.expires_at > now);
    challenges.remove(challenge_id)
}

/// keyboard-interactive 질문 응답으로 인증 계속.
pub(crate) async fn respond(challenge_id: &str, responses: Vec<String>) -> CommandResult<Arc<RemoteConnection>> {
    let pending = take_challenge(challenge_id);
    let Some(PendingChallenge { mut session, prompt_count, .. }) = pending else {
        return Err(AppError::new("remote_auth_challenge_expired", "errors.remoteAuthChallengeExpired", None, true));
    };
    if responses.len() != prompt_count {
        abandon(&session.handle).await;
        return Err(auth_failed(&session.location, None));
    }
    let deadline = tokio::time::Instant::now() + session.timeout;
    let outcome = match tokio::time::timeout_at(deadline, session.respond(responses)).await {
        Ok(outcome) => outcome,
        Err(_) => Err(timed_out(&session.location)),
    };
    session.conclude(outcome, deadline).await
}

/// 질문 창 취소: 인증 중인 연결 종료.
pub(crate) async fn cancel_challenge(challenge_id: &str) -> bool {
    match take_challenge(challenge_id) {
        Some(pending) => {
            abandon(&pending.session.handle).await;
            true
        }
        None => false,
    }
}

/// 사용자가 확인한 지문과 대기 중인 키가 같을 때만 앱 전용 기록 파일에 추가.
pub(crate) fn trust_host_key(host: &str, port: u16, fingerprint: &str, paths: &KnownHostsPaths) -> CommandResult<()> {
    let mut pending = lock(pending_host_keys());
    let key_id = (host.to_string(), port);
    let Some(key) = pending.get(&key_id).filter(|key| HostKeyInfo::of(key).fingerprint == fingerprint).cloned() else {
        return Err(AppError::new("host_key_not_pending", "errors.remoteHostKeyNotPending", None, true));
    };
    record_host_key(&paths.app, host, port, &key)
        .map_err(|error| crate::filesystem::map_io_error(error, Some(&paths.app)))?;
    pending.remove(&key_id);
    Ok(())
}

/// OpenSSH known_hosts 한 줄 추가: 기본 포트는 호스트만, 그 밖은 `[호스트]:포트`.
fn record_host_key(path: &Path, host: &str, port: u16, key: &ssh_key::PublicKey) -> std::io::Result<()> {
    use std::io::Write;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let existing = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(error),
    };
    let host_port = if port == super::path::DEFAULT_PORT { host.to_string() } else { format!("[{host}]:{port}") };
    let key_text = key.to_openssh().map_err(std::io::Error::other)?;
    let separator = if existing.is_empty() || existing.ends_with(b"\n") { "" } else { "\n" };
    let mut file = std::fs::OpenOptions::new().create(true).append(true).open(path)?;
    writeln!(file, "{separator}{host_port} {key_text}")
}

/// 앱 요청 연결 해제. 연결되어 있었으면 `disconnected` 알림.
pub(crate) async fn disconnect(location: &RemoteLocation) -> bool {
    lock(recipes()).remove(location);
    let removed = lock(registry()).remove(location);
    let Some(connection) = removed else {
        return false;
    };
    let _ = connection.sftp.close().await;
    let _ = connection.raw.close_session();
    abandon(&connection.handle).await;
    notify(connection.listener.as_ref(), location, RemoteConnectionState::Disconnected, None);
    true
}

async fn abandon(handle: &Handle<ClientHandler>) {
    let _ = handle.disconnect(russh::Disconnect::ByApplication, "", "en").await;
}

enum AuthOutcome {
    Accepted,
    Rejected(Option<MethodSet>),
    Prompts { instructions: String, prompts: Vec<(String, bool)> },
}

/// 호스트 키 확인 뒤 인증 중인 연결. 추가 질문 응답을 기다리는 동안 대기 목록에 보관.
struct Authenticating {
    id: u64,
    location: RemoteLocation,
    host_key: HostKeyInfo,
    handle: Handle<ClientHandler>,
    listener: Option<ConnectionListener>,
    timeout: Duration,
    recipe: Option<ReconnectRecipe>,
}

impl Authenticating {
    async fn authenticate(&mut self, credential: RemoteCredential) -> CommandResult<AuthOutcome> {
        let user = self.location.user.clone();
        match credential {
            RemoteCredential::Password(password) => {
                let result = self
                    .handle
                    .authenticate_password(user.clone(), password.clone())
                    .await
                    .map_err(|error| self.transport_error(&error))?;
                match result {
                    client::AuthResult::Success => Ok(AuthOutcome::Accepted),
                    // 암호를 keyboard-interactive로만 받는 서버: 첫 숨김 질문 하나에 같은 암호로 응답
                    client::AuthResult::Failure { remaining_methods, .. }
                        if remaining_methods.contains(&MethodKind::KeyboardInteractive) =>
                    {
                        let reply = self
                            .handle
                            .authenticate_keyboard_interactive_start(user, None)
                            .await
                            .map_err(|error| self.transport_error(&error))?;
                        self.answer(reply, Some(password)).await
                    }
                    client::AuthResult::Failure { remaining_methods, .. } => {
                        Ok(AuthOutcome::Rejected(Some(remaining_methods)))
                    }
                }
            }
            RemoteCredential::KeyFile { path, passphrase } => {
                let key = load_key(&path, passphrase.as_deref())?;
                let hash = self.rsa_hash(key.algorithm().is_rsa()).await;
                let result = self
                    .handle
                    .authenticate_publickey(user, PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                    .await
                    .map_err(|error| self.transport_error(&error))?;
                Ok(match result {
                    client::AuthResult::Success => AuthOutcome::Accepted,
                    client::AuthResult::Failure { remaining_methods, .. } => AuthOutcome::Rejected(Some(remaining_methods)),
                })
            }
            RemoteCredential::DefaultKeyFiles { paths, passphrase } => {
                self.authenticate_with_default_keys(&paths, passphrase.as_deref()).await
            }
            RemoteCredential::Agent => self.authenticate_with_agent().await,
            RemoteCredential::KeyboardInteractive => {
                let reply = self
                    .handle
                    .authenticate_keyboard_interactive_start(user, None)
                    .await
                    .map_err(|error| self.transport_error(&error))?;
                self.answer(reply, None).await
            }
        }
    }

    /// RSA 키 서명 해시: 서버가 알려 준 최선값, 알려 주지 않으면 SHA-256.
    async fn rsa_hash(&self, is_rsa: bool) -> Option<ssh_key::HashAlg> {
        if !is_rsa {
            return None;
        }
        match self.handle.best_supported_rsa_hash().await {
            Ok(Some(hash)) => hash,
            _ => Some(ssh_key::HashAlg::Sha256),
        }
    }

    /// 기본 개인 키를 차례로 시도(OpenSSH와 같은 순서). 읽지 못하거나 키 암호가 맞지 않는 키는 건너뜀.
    /// 서버에 보낸 키가 하나도 없으면 키 암호 필요를 우선해 그 키의 오류를 알림.
    async fn authenticate_with_default_keys(&mut self, paths: &[PathBuf], passphrase: Option<&str>) -> CommandResult<AuthOutcome> {
        let mut remaining = None;
        let mut offered = false;
        let mut load_error: Option<AppError> = None;
        for path in paths {
            let key = match load_key(&path.to_string_lossy(), passphrase) {
                Ok(key) => key,
                Err(error) => {
                    // 첫 오류를 보관하되 키 암호가 필요한 키가 나오면 그 안내를 우선
                    if load_error
                        .as_ref()
                        .is_none_or(|first| error.code == "remote_key_passphrase_required" && first.code != error.code)
                    {
                        load_error = Some(error);
                    }
                    continue;
                }
            };
            offered = true;
            let hash = self.rsa_hash(key.algorithm().is_rsa()).await;
            match self
                .handle
                .authenticate_publickey(self.location.user.clone(), PrivateKeyWithHashAlg::new(Arc::new(key), hash))
                .await
                .map_err(|error| self.transport_error(&error))?
            {
                client::AuthResult::Success => return Ok(AuthOutcome::Accepted),
                client::AuthResult::Failure { remaining_methods, .. } => remaining = Some(remaining_methods),
            }
        }
        if offered {
            return Ok(AuthOutcome::Rejected(remaining));
        }
        Err(load_error.unwrap_or_else(|| AppError::new("remote_key_not_found", "errors.remoteKeyNotFound", None, true)))
    }

    async fn authenticate_with_agent(&mut self) -> CommandResult<AuthOutcome> {
        let unavailable = || AppError::new("remote_agent_unavailable", "errors.remoteAgentUnavailable", None, true);
        #[cfg(unix)]
        let mut agent = keys::agent::client::AgentClient::connect_env().await.map_err(|_| unavailable())?;
        #[cfg(windows)]
        let mut agent = keys::agent::client::AgentClient::connect_named_pipe(r"\\.\pipe\openssh-ssh-agent")
            .await
            .map_err(|_| unavailable())?;
        let identities = agent.request_identities().await.map_err(|_| unavailable())?;
        let mut remaining = None;
        for identity in identities {
            let keys::agent::AgentIdentity::PublicKey { key, .. } = identity else {
                continue;
            };
            let hash = self.rsa_hash(key.algorithm().is_rsa()).await;
            match self
                .handle
                .authenticate_publickey_with(self.location.user.clone(), key, hash, &mut agent)
                .await
            {
                Ok(client::AuthResult::Success) => return Ok(AuthOutcome::Accepted),
                Ok(client::AuthResult::Failure { remaining_methods, .. }) => remaining = Some(remaining_methods),
                // 에이전트가 서명을 거부한 키는 건너뛰고 다음 키 시도
                Err(_) if !self.handle.is_closed() => {}
                Err(_) => return Err(remote_error("remote_connection_lost", "errors.remoteConnectionLost", &self.location)),
            }
        }
        Ok(AuthOutcome::Rejected(remaining))
    }

    /// 빈 질문 묶음은 바로 응답. 암호 인증에서 넘어온 경우 첫 숨김 질문 하나에만 암호 사용, 나머지는 사용자에게 질문.
    async fn answer(&mut self, mut reply: KeyboardInteractiveAuthResponse, mut password: Option<String>) -> CommandResult<AuthOutcome> {
        for _ in 0..MAX_PROMPT_ROUNDS {
            match reply {
                KeyboardInteractiveAuthResponse::Success => return Ok(AuthOutcome::Accepted),
                KeyboardInteractiveAuthResponse::Failure { remaining_methods, .. } => {
                    return Ok(AuthOutcome::Rejected(Some(remaining_methods)));
                }
                KeyboardInteractiveAuthResponse::InfoRequest { instructions, prompts, .. } => {
                    let answers = match prompts.as_slice() {
                        [] => Vec::new(),
                        [prompt] if !prompt.echo && password.is_some() => password.take().into_iter().collect(),
                        _ => {
                            let prompts = prompts.into_iter().map(|prompt| (prompt.prompt, prompt.echo)).collect();
                            return Ok(AuthOutcome::Prompts { instructions, prompts });
                        }
                    };
                    reply = self
                        .handle
                        .authenticate_keyboard_interactive_respond(answers)
                        .await
                        .map_err(|error| self.transport_error(&error))?;
                }
            }
        }
        Ok(AuthOutcome::Rejected(None))
    }

    async fn respond(&mut self, responses: Vec<String>) -> CommandResult<AuthOutcome> {
        let reply = self
            .handle
            .authenticate_keyboard_interactive_respond(responses)
            .await
            .map_err(|error| self.transport_error(&error))?;
        self.answer(reply, None).await
    }

    async fn conclude(self, outcome: CommandResult<AuthOutcome>, deadline: tokio::time::Instant) -> CommandResult<Arc<RemoteConnection>> {
        match outcome {
            Ok(AuthOutcome::Accepted) => {
                let location = self.location.clone();
                match tokio::time::timeout_at(deadline, self.finish()).await {
                    Ok(result) => result,
                    Err(_) => Err(timed_out(&location)),
                }
            }
            Ok(AuthOutcome::Prompts { instructions, prompts }) => Err(self.park(instructions, prompts)),
            Ok(AuthOutcome::Rejected(methods)) => {
                abandon(&self.handle).await;
                Err(auth_failed(&self.location, methods.as_ref()))
            }
            Err(error) => {
                abandon(&self.handle).await;
                Err(error)
            }
        }
    }

    fn transport_error(&self, error: &russh::Error) -> AppError {
        if self.handle.is_closed() {
            return remote_error("remote_connection_lost", "errors.remoteConnectionLost", &self.location);
        }
        connect_failed(&self.location, &error.to_string())
    }

    /// 질문을 대기 목록에 두고 질문 내용과 식별자를 오류 상세로 반환. 응답 값은 보관하지 않음.
    fn park(self, instructions: String, prompts: Vec<(String, bool)>) -> AppError {
        let challenge_id = format!("kbd-{}-{}", self.id, NEXT_ID.fetch_add(1, Ordering::Relaxed));
        let prompt_list: Vec<serde_json::Value> = prompts
            .iter()
            .map(|(prompt, echo)| serde_json::json!({ "prompt": prompt, "echo": echo }))
            .collect();
        let error = remote_error("remote_auth_prompts", "errors.remoteAuthPrompts", &self.location)
            .with_detail("challengeId", &challenge_id)
            .with_detail("instructions", instructions)
            .with_detail("prompts", serde_json::Value::Array(prompt_list).to_string());
        lock(pending_challenges()).insert(
            challenge_id,
            PendingChallenge { session: self, prompt_count: prompts.len(), expires_at: Instant::now() + CHALLENGE_LIFETIME },
        );
        error
    }

    async fn finish(self) -> CommandResult<Arc<RemoteConnection>> {
        let sftp = match open_sftp_channel(&self.handle, &self.location).await {
            Ok(sftp) => sftp,
            Err(error) => {
                abandon(&self.handle).await;
                return Err(error);
            }
        };
        let home = match sftp.canonicalize(".").await {
            Ok(home) if home.starts_with('/') => home,
            // 홈을 절대 경로로 알려 주지 않는 서버는 루트에서 시작
            Ok(_) => "/".to_string(),
            Err(error) => {
                abandon(&self.handle).await;
                return Err(sftp_error(&self.location, "/", &error));
            }
        };
        let raw = match open_raw_channel(&self.handle, &self.location).await {
            Ok(opened) => opened,
            Err(error) => {
                abandon(&self.handle).await;
                return Err(error);
            }
        };
        let Self { id, location, host_key, handle, listener, recipe, .. } = self;
        let connection = Arc::new(RemoteConnection {
            id,
            location: location.clone(),
            home,
            host_key,
            sftp,
            raw,
            handle,
            listener,
        });
        let existing = {
            let mut connections = lock(registry());
            match connections.get(&location) {
                Some(existing) if !existing.is_closed() => Some(Arc::clone(existing)),
                _ => {
                    connections.insert(location.clone(), Arc::clone(&connection));
                    None
                }
            }
        };
        // 동시에 들어온 같은 위치 연결은 먼저 등록된 연결 사용
        if let Some(existing) = existing {
            abandon(&connection.handle).await;
            return Ok(existing);
        }
        if let Some(recipe) = recipe {
            lock(recipes()).insert(location.clone(), recipe);
        }
        notify(connection.listener.as_ref(), &location, RemoteConnectionState::Connected, None);
        Ok(connection)
    }
}

async fn open_tcp(location: &RemoteLocation) -> CommandResult<tokio::net::TcpStream> {
    let addresses: Vec<std::net::SocketAddr> = match tokio::net::lookup_host((location.host.as_str(), location.port)).await {
        Ok(addresses) => addresses.collect(),
        Err(_) => Vec::new(),
    };
    if addresses.is_empty() {
        return Err(remote_error("remote_host_not_found", "errors.remoteHostNotFound", location));
    }
    let mut last_error = None;
    for address in addresses {
        match tokio::net::TcpStream::connect(address).await {
            Ok(stream) => return Ok(stream),
            Err(error) => last_error = Some(error),
        }
    }
    Err(match last_error.map(|error| error.kind()) {
        Some(std::io::ErrorKind::ConnectionRefused) => {
            remote_error("remote_connection_refused", "errors.remoteConnectionRefused", location)
        }
        Some(std::io::ErrorKind::TimedOut) => timed_out(location),
        Some(kind) => connect_failed(location, &format!("{kind:?}")),
        None => connect_failed(location, "no address"),
    })
}

fn load_key(path: &str, passphrase: Option<&str>) -> CommandResult<keys::PrivateKey> {
    let expanded = expand_home(path);
    let key_error = |code: &str, message_key: &str| AppError::new(code, message_key, Some(&expanded), true);
    keys::load_secret_key(&expanded, passphrase).map_err(|error| match error {
        keys::Error::KeyIsEncrypted => key_error("remote_key_passphrase_required", "errors.remoteKeyPassphraseRequired"),
        keys::Error::IO(_) => key_error("remote_key_unreadable", "errors.remoteKeyUnreadable"),
        // 개인 키 자리에 공개 키(.pub)를 넣은 흔한 실수: 짝이 되는 개인 키를 안내
        _ if expanded.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("pub")) => {
            key_error("remote_public_key_given", "errors.remotePublicKeyGiven")
        }
        // 키 암호를 넣었는데 해독하지 못한 경우는 키 암호 오류로 안내
        _ if passphrase.is_some() => key_error("remote_key_passphrase_invalid", "errors.remoteKeyPassphraseInvalid"),
        _ => key_error("remote_key_unreadable", "errors.remoteKeyUnreadable"),
    })
}

/// 키 경로의 `~/`를 로컬 홈으로 확장.
pub(crate) fn expand_home(path: &str) -> PathBuf {
    match path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
        Some(rest) => crate::platform::home_dir()
            .map(|home| home.join(rest))
            .unwrap_or_else(|_| PathBuf::from(path)),
        None => PathBuf::from(path),
    }
}

async fn open_sftp_channel(handle: &Handle<ClientHandler>, location: &RemoteLocation) -> CommandResult<SftpSession> {
    let channel = handle.channel_open_session().await.map_err(|_| not_connected(location))?;
    channel
        .request_subsystem(true, "sftp")
        .await
        .map_err(|_| remote_error("remote_sftp_unavailable", "errors.remoteSftpUnavailable", location))?;
    let sftp = SftpSession::new(channel.into_stream())
        .await
        .map_err(|_| remote_error("remote_sftp_unavailable", "errors.remoteSftpUnavailable", location))?;
    sftp.set_timeout(SFTP_REQUEST_TIMEOUT_SECONDS);
    Ok(sftp)
}

/// 원시 SFTP 채널: READDIR 목록 설명(소유자 이름)과 확장 요청용.
async fn open_raw_channel(handle: &Handle<ClientHandler>, location: &RemoteLocation) -> CommandResult<RawSftpSession> {
    let unavailable = || remote_error("remote_sftp_unavailable", "errors.remoteSftpUnavailable", location);
    let channel = handle.channel_open_session().await.map_err(|_| not_connected(location))?;
    channel.request_subsystem(true, "sftp").await.map_err(|_| unavailable())?;
    let raw = RawSftpSession::new(channel.into_stream());
    raw.set_timeout(SFTP_REQUEST_TIMEOUT_SECONDS);
    raw.init().await.map_err(|_| unavailable())?;
    Ok(raw)
}

fn handshake_error(location: &RemoteLocation, verdict: &Mutex<Option<HostKeyVerdict>>, error: &russh::Error) -> AppError {
    match lock(verdict).take() {
        Some(HostKeyVerdict::Unknown(info, key)) => {
            lock(pending_host_keys()).insert((location.host.clone(), location.port), key);
            remote_error("host_key_unknown", "errors.remoteHostKeyUnknown", location)
                .with_detail("algorithm", info.algorithm)
                .with_detail("fingerprint", info.fingerprint)
                .with_detail("hostName", &location.host)
                .with_detail("port", location.port.to_string())
        }
        Some(HostKeyVerdict::Changed { presented, recorded }) => {
            remote_error("host_key_changed", "errors.remoteHostKeyChanged", location)
                .with_detail("algorithm", presented.algorithm)
                .with_detail("fingerprint", presented.fingerprint)
                .with_detail("recordedFingerprint", recorded.fingerprint)
        }
        _ => connect_failed(location, &error.to_string()),
    }
}

/// 원격 오류: `path`에 연결 위치 URL을 넣어 어느 서버의 오류인지 표시.
pub(crate) fn remote_error(code: &str, message_key: &str, location: &RemoteLocation) -> AppError {
    AppError::new(code, message_key, Some(Path::new(&session_id(location))), true)
}

pub(crate) fn not_connected(location: &RemoteLocation) -> AppError {
    remote_error("remote_not_connected", "errors.remoteNotConnected", location)
}

fn timed_out(location: &RemoteLocation) -> AppError {
    remote_error("remote_timeout", "errors.remoteTimeout", location)
}

fn connect_failed(location: &RemoteLocation, reason: &str) -> AppError {
    remote_error("remote_connect_failed", "errors.remoteConnectFailed", location).with_detail("reason", reason)
}

fn auth_failed(location: &RemoteLocation, methods: Option<&MethodSet>) -> AppError {
    let error = remote_error("remote_auth_failed", "errors.remoteAuthFailed", location);
    match methods {
        Some(methods) if !methods.is_empty() => {
            let names: Vec<&str> = methods.iter().map(<&str>::from).collect();
            error.with_detail("allowedMethods", names.join(","))
        }
        _ => error,
    }
}

/// SFTP 상태 코드를 앱 오류로 변환. 경로는 원격 URL로 표시.
pub(crate) fn sftp_error(location: &RemoteLocation, path: &str, error: &russh_sftp::client::error::Error) -> AppError {
    use russh_sftp::client::error::Error as SftpError;
    use russh_sftp::protocol::StatusCode;
    let (code, key) = match error {
        SftpError::Status(status) => match status.status_code {
            StatusCode::NoSuchFile => ("not_found", "errors.notFound"),
            StatusCode::PermissionDenied => ("permission_denied", "errors.permissionDenied"),
            StatusCode::OpUnsupported => ("unsupported", "errors.remoteOperationUnsupported"),
            StatusCode::NoConnection | StatusCode::ConnectionLost => {
                ("remote_connection_lost", "errors.remoteConnectionLost")
            }
            _ => ("remote_failed", "errors.remoteOperationFailed"),
        },
        SftpError::Timeout => ("remote_timeout", "errors.remoteTimeout"),
        _ => ("remote_failed", "errors.remoteOperationFailed"),
    };
    let app_error = AppError::new(code, key, Some(Path::new(&location.url(path))), true);
    match error {
        SftpError::Status(status) if !status.error_message.is_empty() => {
            app_error.with_detail("serverMessage", status.error_message.chars().take(200).collect::<String>())
        }
        _ => app_error,
    }
}

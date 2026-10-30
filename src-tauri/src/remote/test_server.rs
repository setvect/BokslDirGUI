//! 테스트 전용 SFTP 서버: 임시 디렉터리를 "/"로 보여 주는 OpenSSH 유사 동작과 장애 주입.
//!
//! - 동기 생성 `TestSftpServer::start`, 서버 전용 다중 스레드 tokio 런타임에서 실행
//! - 경로: POSIX 절대 경로, 상대 경로는 "/" 기준, ".."는 루트에서 멈춤
//! - SSH_FXP_RENAME은 기존 대상에서 실패, 덮어쓰기는 `posix-rename@openssh.com`(VERSION 미광고)
//! - SSH_FXP_SYMLINK 인자 순서: OpenSSH와 같은 (대상, 링크 경로), Windows 미지원
//! - `Faults`: 응답 지연·전송량 기준 TCP 끊기·쓰기 실패·경로 거부·악성 목록 이름 주입
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::future::Future;
use std::hash::{BuildHasher, Hasher};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::net::{Shutdown, SocketAddr, TcpStream as StdTcpStream};
use std::path::{Path, PathBuf, MAIN_SEPARATOR};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering::SeqCst};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use russh::keys::ssh_key::private::Ed25519Keypair;
use russh::keys::{PrivateKey, PublicKey};
use russh::server::{
    Auth, ChannelOpenHandle, Msg, PublicKeyOffer, Response, Session, VerifiedPublicKey,
};
use russh::{Channel, ChannelId, MethodKind, MethodSet};
use russh_sftp::protocol::{
    Attrs, Data, File, FileAttributes, Handle, Name, OpenFlags, Packet, Status, StatusCode, Version,
};
use russh_sftp::server::StatusReply;
use tokio::runtime::Runtime;

use crate::test_util::TempDir;

/// OpenSSH와 같은 READ 응답 최대 크기.
const MAX_READ: u32 = 256 * 1024 - 1024;
/// OpenSSH와 같은 READDIR 응답당 최대 항목 수.
const READDIR_BATCH: usize = 100;

/// 서버 동작 중 바꾸는 장애 주입 설정. 바이트 한도 0은 꺼짐.
#[derive(Default)]
pub(crate) struct Faults {
    delay_ms: AtomicU64,
    disconnect_after: AtomicU64,
    fail_writes_after: AtomicU64,
    transferred: AtomicU64,
    written: AtomicU64,
    denied: Mutex<Vec<String>>,
    injected: Mutex<Vec<String>>,
}

impl Faults {
    /// 모든 SFTP 응답 전 지연.
    pub(crate) fn set_delay_ms(&self, ms: u64) {
        self.delay_ms.store(ms, SeqCst);
    }

    /// 서버 전체 READ+WRITE 누적 바이트가 한도를 넘는 요청에서 그 연결의 TCP 강제 종료(응답 미전달).
    /// 넘은 뒤에는 `reset`·재설정 전까지 모든 연결의 READ/WRITE에서 반복. 호출 시 누적값 초기화.
    pub(crate) fn set_disconnect_after_bytes(&self, bytes: u64) {
        self.transferred.store(0, SeqCst);
        self.disconnect_after.store(bytes, SeqCst);
    }

    /// WRITE 누적 바이트가 한도를 넘는 요청부터 Failure(디스크 가득 참, 그 요청 내용은 미기록).
    /// 한 번 넘으면 `reset`·재설정 전까지 모든 WRITE 실패. 호출 시 누적값 초기화.
    pub(crate) fn set_fail_writes_after_bytes(&self, bytes: u64) {
        self.written.store(0, SeqCst);
        self.fail_writes_after.store(bytes, SeqCst);
    }

    /// 이 SFTP 경로와 하위 경로의 모든 작업을 PermissionDenied로 거부. 호출마다 누적.
    pub(crate) fn deny_path_prefix(&self, prefix: String) {
        lock(&self.denied).push(join_sftp(&normalize(&prefix)));
    }

    /// 모든 디렉터리 목록 끝에 크기 0 일반 파일로 덧붙일 이름. 호출마다 교체.
    pub(crate) fn inject_readdir_names(&self, names: Vec<String>) {
        *lock(&self.injected) = names;
    }

    /// 모든 장애 해제와 누적값 초기화.
    pub(crate) fn reset(&self) {
        for value in [
            &self.delay_ms,
            &self.disconnect_after,
            &self.fail_writes_after,
            &self.transferred,
            &self.written,
        ] {
            value.store(0, SeqCst);
        }
        lock(&self.denied).clear();
        lock(&self.injected).clear();
    }

    fn check(&self, path: &str) -> Result<(), StatusReply> {
        let denied = lock(&self.denied).iter().any(|prefix| {
            prefix == "/"
                || path == prefix
                || path
                    .strip_prefix(prefix.as_str())
                    .is_some_and(|rest| rest.starts_with('/'))
        });
        if denied {
            return Err(StatusCode::PermissionDenied.with_message("denied by test fault"));
        }
        Ok(())
    }

    /// 전송량 누적 후 끊기 한도 초과 여부.
    fn exceeds_disconnect(&self, bytes: u64) -> bool {
        let total = self.transferred.fetch_add(bytes, SeqCst) + bytes;
        let limit = self.disconnect_after.load(SeqCst);
        limit > 0 && total > limit
    }

    /// 쓰기 한도 안이면 누적 후 true. 넘으면 가득 찬 상태로 고정.
    fn reserve_write(&self, bytes: u64) -> bool {
        let limit = self.fail_writes_after.load(SeqCst);
        if limit > 0 && self.written.load(SeqCst).saturating_add(bytes) > limit {
            self.written.store(u64::MAX, SeqCst);
            return false;
        }
        self.written.fetch_add(bytes, SeqCst);
        true
    }
}

/// 테스트 서버 설정. 설정된 인증 방식만 광고.
#[derive(Clone)]
pub(crate) struct TestServerOptions {
    pub(crate) user: String,
    pub(crate) password: Option<String>,
    pub(crate) authorized_key: Option<PublicKey>,
    /// 설정 시 "Verification code: " 프롬프트 하나(입력 숨김)로 이 값만 허용.
    pub(crate) keyboard_interactive_code: Option<String>,
    /// 없으면 새 Ed25519 키.
    pub(crate) host_key: Option<PrivateKey>,
    /// 없으면 임의 포트.
    pub(crate) port: Option<u16>,
}

impl Default for TestServerOptions {
    fn default() -> Self {
        Self {
            user: "tester".into(),
            password: Some("pw".into()),
            authorized_key: None,
            keyboard_interactive_code: None,
            host_key: None,
            port: None,
        }
    }
}

/// 127.0.0.1의 테스트 SFTP 서버. Drop 시 런타임 종료 후 루트 삭제.
pub(crate) struct TestSftpServer {
    runtime: Option<Runtime>,
    addr: SocketAddr,
    host_public_key: PublicKey,
    faults: Arc<Faults>,
    root: TempDir,
}

impl TestSftpServer {
    /// 포트를 바로 열고 서버 시작. 비동기 문맥에서도 호출 가능, 실패 시 패닉.
    pub(crate) fn start(options: TestServerOptions) -> Self {
        let root = TempDir::new("sftp-server");
        let host_key = options.host_key.unwrap_or_else(random_ed25519_key);
        let host_public_key = PublicKey::from(host_key.public_key().key_data().clone());
        let listener = std::net::TcpListener::bind(("127.0.0.1", options.port.unwrap_or(0)))
            .expect("test SFTP server should bind");
        listener
            .set_nonblocking(true)
            .expect("listener should become non-blocking");
        let addr = listener
            .local_addr()
            .expect("listener should have an address");

        let mut methods = MethodSet::empty();
        if options.password.is_some() {
            methods.push(MethodKind::Password);
        }
        if options.authorized_key.is_some() {
            methods.push(MethodKind::PublicKey);
        }
        if options.keyboard_interactive_code.is_some() {
            methods.push(MethodKind::KeyboardInteractive);
        }
        let config = Arc::new(russh::server::Config {
            methods: methods.clone(),
            auth_rejection_time: Duration::from_millis(10),
            auth_rejection_time_initial: Some(Duration::ZERO),
            keys: vec![host_key],
            ..Default::default()
        });
        let faults = Arc::new(Faults::default());
        let shared = Arc::new(Shared {
            root: root.path().to_path_buf(),
            user: options.user,
            password: options.password,
            authorized_key: options.authorized_key,
            code: options.keyboard_interactive_code,
            methods,
            faults: faults.clone(),
        });
        let runtime = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .expect("test SFTP runtime should start");
        runtime.spawn(accept_loop(listener, config, shared));
        Self {
            runtime: Some(runtime),
            addr,
            host_public_key,
            faults,
            root,
        }
    }

    pub(crate) fn addr(&self) -> SocketAddr {
        self.addr
    }

    pub(crate) fn port(&self) -> u16 {
        self.addr.port()
    }

    /// "/"에 대응하는 실제 디렉터리.
    pub(crate) fn root(&self) -> &Path {
        self.root.path()
    }

    /// 주석 없는 호스트 공개 키. 클라이언트 `check_server_key`가 받는 값과 동일.
    pub(crate) fn host_public_key(&self) -> PublicKey {
        self.host_public_key.clone()
    }

    pub(crate) fn faults(&self) -> &Faults {
        &self.faults
    }

    /// 서버 런타임에서 테스트 클라이언트 코드 실행. 비동기 문맥 밖에서만 호출.
    pub(crate) fn block_on<F: Future>(&self, future: F) -> F::Output {
        self.runtime
            .as_ref()
            .expect("test SFTP runtime should be running")
            .block_on(future)
    }
}

impl Drop for TestSftpServer {
    fn drop(&mut self) {
        let Some(runtime) = self.runtime.take() else {
            return;
        };
        // 비동기 문맥에서는 대기 없이 종료, 그 밖에서는 열린 파일 정리까지 잠시 대기
        if tokio::runtime::Handle::try_current().is_ok() {
            runtime.shutdown_background();
        } else {
            runtime.shutdown_timeout(Duration::from_secs(2));
        }
    }
}

/// 테스트용 Ed25519 키. 시드는 표준 해시 난수(암호학적 강도 불필요).
pub(crate) fn random_ed25519_key() -> PrivateKey {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let state = std::collections::hash_map::RandomState::new();
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let mut seed = [0u8; 32];
    for chunk in seed.chunks_mut(8) {
        let mut hasher = state.build_hasher();
        hasher.write_u64(COUNTER.fetch_add(1, SeqCst));
        hasher.write_u128(nanos);
        chunk.copy_from_slice(&hasher.finish().to_le_bytes());
    }
    Ed25519Keypair::from_seed(&seed).into()
}

/// 연결이 공유하는 서버 상태.
struct Shared {
    root: PathBuf,
    user: String,
    password: Option<String>,
    authorized_key: Option<PublicKey>,
    code: Option<String>,
    methods: MethodSet,
    faults: Arc<Faults>,
}

/// 연결마다 SSH 세션 실행. 끊기 장애용 TCP 복제본 보관.
async fn accept_loop(
    listener: std::net::TcpListener,
    config: Arc<russh::server::Config>,
    shared: Arc<Shared>,
) {
    let listener = tokio::net::TcpListener::from_std(listener).expect("listener should register");
    loop {
        let Ok((tcp, _)) = listener.accept().await else {
            tokio::time::sleep(Duration::from_millis(10)).await;
            continue;
        };
        let (config, shared) = (config.clone(), shared.clone());
        tokio::spawn(async move {
            let _ = tcp.set_nodelay(true);
            let Ok(std_tcp) = tcp.into_std() else { return };
            let Ok(killer) = std_tcp.try_clone() else {
                return;
            };
            let Ok(tcp) = tokio::net::TcpStream::from_std(std_tcp) else {
                return;
            };
            let handler = SshHandler {
                shared,
                killer: Arc::new(killer),
                dropped: Arc::default(),
                channels: HashMap::new(),
            };
            if let Ok(session) = russh::server::run_stream(config, tcp, handler).await {
                let _ = session.await;
            }
        });
    }
}

/// 연결별 SSH 처리: 인증과 sftp 하위 시스템.
struct SshHandler {
    shared: Arc<Shared>,
    killer: Arc<StdTcpStream>,
    /// 끊기 장애로 끊은 연결: 이미 받은 요청도 더 처리하지 않음(실제 끊김과 같게).
    dropped: Arc<AtomicBool>,
    channels: HashMap<ChannelId, Channel<Msg>>,
}

impl SshHandler {
    fn verdict(&self, user: &str, accepted: bool) -> Auth {
        if accepted && user == self.shared.user {
            return Auth::Accept;
        }
        // OpenSSH처럼 실패 후에도 설정된 방식 목록 유지
        Auth::Reject {
            proceed_with_methods: Some(self.shared.methods.clone()),
            partial_success: false,
        }
    }

    fn key_accepted(&self, key: &PublicKey) -> bool {
        let allowed = self.shared.authorized_key.as_ref();
        allowed.is_some_and(|allowed| allowed.key_data() == key.key_data())
    }
}

impl russh::server::Handler for SshHandler {
    type Error = russh::Error;

    async fn auth_none(&mut self, user: &str) -> Result<Auth, Self::Error> {
        Ok(self.verdict(user, false))
    }

    async fn auth_password(&mut self, user: &str, password: &str) -> Result<Auth, Self::Error> {
        Ok(self.verdict(user, self.shared.password.as_deref() == Some(password)))
    }

    async fn auth_publickey_offered(
        &mut self,
        user: &str,
        offer: PublicKeyOffer<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(self.verdict(user, self.key_accepted(offer.public_key)))
    }

    async fn auth_publickey(
        &mut self,
        user: &str,
        key: VerifiedPublicKey<'_>,
    ) -> Result<Auth, Self::Error> {
        Ok(self.verdict(user, self.key_accepted(key.public_key)))
    }

    async fn auth_keyboard_interactive<'a>(
        &'a mut self,
        user: &str,
        _submethods: &str,
        response: Option<Response<'a>>,
    ) -> Result<Auth, Self::Error> {
        let Some(code) = self.shared.code.as_deref() else {
            return Ok(self.verdict(user, false));
        };
        let Some(mut response) = response else {
            return Ok(Auth::Partial {
                name: Cow::Borrowed(""),
                instructions: Cow::Borrowed(""),
                prompts: Cow::Owned(vec![(Cow::Borrowed("Verification code: "), false)]),
            });
        };
        let accepted = response
            .next()
            .is_some_and(|answer| &answer[..] == code.as_bytes());
        Ok(self.verdict(user, accepted))
    }

    async fn channel_open_session(
        &mut self,
        channel: Channel<Msg>,
        reply: ChannelOpenHandle,
        _session: &mut Session,
    ) -> Result<(), Self::Error> {
        self.channels.insert(channel.id(), channel);
        reply.accept().await;
        Ok(())
    }

    async fn subsystem_request(
        &mut self,
        channel_id: ChannelId,
        name: &str,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        match self.channels.remove(&channel_id) {
            Some(channel) if name == "sftp" => {
                session.channel_success(channel_id)?;
                let sftp = SftpHandler {
                    shared: self.shared.clone(),
                    killer: self.killer.clone(),
                    dropped: self.dropped.clone(),
                    handles: HashMap::new(),
                    next_handle: 0,
                };
                russh_sftp::server::run(channel.into_stream(), sftp).await;
            }
            _ => session.channel_failure(channel_id)?,
        }
        Ok(())
    }

    async fn channel_eof(
        &mut self,
        channel: ChannelId,
        session: &mut Session,
    ) -> Result<(), Self::Error> {
        session.close(channel)
    }
}

/// 열린 핸들. 파일이면 `file`, 디렉터리면 남은 목록 `entries`.
struct OpenHandle {
    path: String,
    real: PathBuf,
    file: Option<fs::File>,
    entries: VecDeque<File>,
}

/// sftp 채널별 처리. 요청은 russh-sftp가 순서대로 하나씩 전달.
struct SftpHandler {
    shared: Arc<Shared>,
    killer: Arc<StdTcpStream>,
    dropped: Arc<AtomicBool>,
    handles: HashMap<String, OpenHandle>,
    next_handle: u64,
}

impl SftpHandler {
    /// 지연 장애 적용.
    async fn pause(&self) {
        let ms = self.shared.faults.delay_ms.load(SeqCst);
        if ms > 0 {
            tokio::time::sleep(Duration::from_millis(ms)).await;
        }
    }

    /// SFTP 경로 → (정규 경로, 루트 안 실제 경로). 거부 접두사 검사 없음.
    fn map(&self, path: &str) -> Result<(String, PathBuf), StatusReply> {
        let parts = normalize(path);
        let mut real = self.shared.root.clone();
        for part in &parts {
            // Windows 드라이브·구분자·끝 점·공백은 루트 탈출·별칭 위험이라 거부
            if cfg!(windows) && (part.contains(['\\', ':']) || part.ends_with(['.', ' '])) {
                return Err(failure("invalid path component"));
            }
            real.push(part);
        }
        Ok((join_sftp(&parts), real))
    }

    /// `map` 후 거부 접두사 검사.
    fn resolve(&self, path: &str) -> Result<(String, PathBuf), StatusReply> {
        let (path, real) = self.map(path)?;
        self.shared.faults.check(&path)?;
        Ok((path, real))
    }

    /// 열린 핸들 조회와 거부 접두사 검사.
    fn lookup(&mut self, handle: &str) -> Result<&mut OpenHandle, StatusReply> {
        let open = self
            .handles
            .get_mut(handle)
            .ok_or_else(|| failure("invalid handle"))?;
        self.shared.faults.check(&open.path)?;
        Ok(open)
    }

    fn insert(
        &mut self,
        path: String,
        real: PathBuf,
        file: Option<fs::File>,
        entries: VecDeque<File>,
    ) -> String {
        self.next_handle += 1;
        let handle = self.next_handle.to_string();
        let open = OpenHandle {
            path,
            real,
            file,
            entries,
        };
        self.handles.insert(handle.clone(), open);
        handle
    }

    /// 끊기 장애: 누적 전송량이 한도를 넘으면 TCP 양방향 종료.
    fn transfer(&self, bytes: usize) -> Result<(), StatusReply> {
        if self.dropped.load(SeqCst) || self.shared.faults.exceeds_disconnect(bytes as u64) {
            self.dropped.store(true, SeqCst);
            let _ = self.killer.shutdown(Shutdown::Both);
            return Err(failure("connection dropped by test fault"));
        }
        Ok(())
    }

    /// 이름 변경. `overwrite`가 아니면 OpenSSH SSH_FXP_RENAME처럼 기존 대상에서 실패.
    fn rename_paths(&self, old: &str, new: &str, overwrite: bool) -> Result<(), StatusReply> {
        let (old, old_real) = self.resolve(old)?;
        let (new, new_real) = self.resolve(new)?;
        if old == "/" || new == "/" {
            return Err(failure("cannot rename root"));
        }
        fs::symlink_metadata(&old_real).map_err(io_err)?;
        if !overwrite && fs::symlink_metadata(&new_real).is_ok() {
            return Err(failure("target exists"));
        }
        fs::rename(old_real, new_real).map_err(io_err)
    }

    /// 링크 대상 → SFTP 표기. 루트 안 경로는 "/" 기준 절대 경로, 그 밖은 그대로.
    fn sftp_target(&self, target: &Path) -> String {
        match target.strip_prefix(&self.shared.root) {
            Ok(rest) => format!("/{}", rest.to_string_lossy().replace(MAIN_SEPARATOR, "/")),
            Err(_) => target.to_string_lossy().into_owned(),
        }
    }
}

impl russh_sftp::server::Handler for SftpHandler {
    type Error = StatusReply;

    fn unimplemented(&self) -> StatusReply {
        StatusCode::OpUnsupported.into()
    }

    async fn init(
        &mut self,
        _version: u32,
        _extensions: HashMap<String, String>,
    ) -> Result<Version, StatusReply> {
        self.pause().await;
        Ok(Version::new())
    }

    async fn open(
        &mut self,
        id: u32,
        filename: String,
        pflags: OpenFlags,
        attrs: FileAttributes,
    ) -> Result<Handle, StatusReply> {
        self.pause().await;
        let (path, real) = self.resolve(&filename)?;
        if real.is_dir() {
            return Err(failure("is a directory"));
        }
        let mut options = fs::OpenOptions::new();
        options
            .read(pflags.contains(OpenFlags::READ))
            .write(pflags.intersects(OpenFlags::WRITE | OpenFlags::APPEND))
            .append(pflags.contains(OpenFlags::APPEND))
            .truncate(pflags.contains(OpenFlags::TRUNCATE));
        if pflags.contains(OpenFlags::CREATE | OpenFlags::EXCLUDE) {
            options.create_new(true);
        } else if pflags.contains(OpenFlags::CREATE) {
            options.create(true);
        }
        #[cfg(unix)]
        if let Some(mode) = attrs.permissions {
            std::os::unix::fs::OpenOptionsExt::mode(&mut options, mode & 0o7777);
        }
        #[cfg(not(unix))]
        let _ = attrs;
        let file = options.open(&real).map_err(io_err)?;
        let handle = self.insert(path, real, Some(file), VecDeque::new());
        Ok(Handle { id, handle })
    }

    async fn close(&mut self, id: u32, handle: String) -> Result<Status, StatusReply> {
        self.pause().await;
        self.handles
            .remove(&handle)
            .ok_or_else(|| failure("invalid handle"))?;
        Ok(ok(id))
    }

    async fn read(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        len: u32,
    ) -> Result<Data, StatusReply> {
        self.pause().await;
        let open = self.lookup(&handle)?;
        let file = open.file.as_mut().ok_or_else(|| failure("not a file"))?;
        file.seek(SeekFrom::Start(offset)).map_err(io_err)?;
        let mut data = Vec::new();
        file.take(u64::from(len.min(MAX_READ)))
            .read_to_end(&mut data)
            .map_err(io_err)?;
        if data.is_empty() {
            return Err(StatusCode::Eof.into());
        }
        self.transfer(data.len())?;
        Ok(Data { id, data })
    }

    async fn write(
        &mut self,
        id: u32,
        handle: String,
        offset: u64,
        data: Vec<u8>,
    ) -> Result<Status, StatusReply> {
        self.pause().await;
        self.transfer(data.len())?;
        if !self.shared.faults.reserve_write(data.len() as u64) {
            return Err(failure("no space left on device (test fault)"));
        }
        let open = self.lookup(&handle)?;
        let file = open.file.as_mut().ok_or_else(|| failure("not a file"))?;
        file.seek(SeekFrom::Start(offset)).map_err(io_err)?;
        file.write_all(&data).map_err(io_err)?;
        Ok(ok(id))
    }

    async fn lstat(&mut self, id: u32, path: String) -> Result<Attrs, StatusReply> {
        self.pause().await;
        attrs_reply(id, fs::symlink_metadata(self.resolve(&path)?.1))
    }

    async fn fstat(&mut self, id: u32, handle: String) -> Result<Attrs, StatusReply> {
        self.pause().await;
        let open = self.lookup(&handle)?;
        let meta = match &open.file {
            Some(file) => file.metadata(),
            None => fs::metadata(&open.real),
        };
        attrs_reply(id, meta)
    }

    async fn setstat(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusReply> {
        self.pause().await;
        done(id, set_attrs(&self.resolve(&path)?.1, &attrs))
    }

    async fn fsetstat(
        &mut self,
        id: u32,
        handle: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusReply> {
        self.pause().await;
        let real = self.lookup(&handle)?.real.clone();
        done(id, set_attrs(&real, &attrs))
    }

    async fn opendir(&mut self, id: u32, path: String) -> Result<Handle, StatusReply> {
        self.pause().await;
        let (path, real) = self.resolve(&path)?;
        let mut listed = Vec::new();
        for entry in fs::read_dir(&real).map_err(io_err)? {
            let entry = entry.map_err(io_err)?;
            if let Ok(meta) = entry.metadata() {
                let name = entry.file_name().to_string_lossy().into_owned();
                listed.push(File::new(name, attrs_of(&meta)));
            }
        }
        listed.sort_by(|a, b| a.filename.cmp(&b.filename));
        // OpenSSH처럼 "."·".."도 전달. 루트의 ".."는 루트 자신
        let parent = self.map(&format!("{path}/.."))?.1;
        let mut entries = VecDeque::from([
            File::new(".", attrs_of(&fs::metadata(&real).map_err(io_err)?)),
            File::new("..", attrs_of(&fs::metadata(parent).map_err(io_err)?)),
        ]);
        entries.extend(listed);
        let fake = FileAttributes {
            size: Some(0),
            permissions: Some(0o100644),
            atime: Some(0),
            mtime: Some(0),
            ..Default::default()
        };
        let injected = lock(&self.shared.faults.injected).clone();
        entries.extend(
            injected
                .into_iter()
                .map(|name| File::new(name, fake.clone())),
        );
        let handle = self.insert(path, real, None, entries);
        Ok(Handle { id, handle })
    }

    async fn readdir(&mut self, id: u32, handle: String) -> Result<Name, StatusReply> {
        self.pause().await;
        let open = self.lookup(&handle)?;
        if open.file.is_some() {
            return Err(failure("not a directory"));
        }
        if open.entries.is_empty() {
            return Err(StatusCode::Eof.into());
        }
        let count = open.entries.len().min(READDIR_BATCH);
        let files = open.entries.drain(..count).collect();
        Ok(Name { id, files })
    }

    async fn remove(&mut self, id: u32, filename: String) -> Result<Status, StatusReply> {
        self.pause().await;
        done(id, fs::remove_file(self.resolve(&filename)?.1))
    }

    async fn mkdir(
        &mut self,
        id: u32,
        path: String,
        attrs: FileAttributes,
    ) -> Result<Status, StatusReply> {
        self.pause().await;
        let (_, real) = self.resolve(&path)?;
        #[cfg(unix)]
        let created = {
            use std::os::unix::fs::DirBuilderExt;
            let mode = attrs.permissions.map_or(0o777, |mode| mode & 0o7777);
            fs::DirBuilder::new().mode(mode).create(&real)
        };
        #[cfg(not(unix))]
        let created = {
            let _ = attrs;
            fs::create_dir(&real)
        };
        done(id, created)
    }

    async fn rmdir(&mut self, id: u32, path: String) -> Result<Status, StatusReply> {
        self.pause().await;
        let (path, real) = self.resolve(&path)?;
        if path == "/" {
            return Err(failure("cannot remove root"));
        }
        done(id, fs::remove_dir(real))
    }

    async fn realpath(&mut self, id: u32, path: String) -> Result<Name, StatusReply> {
        self.pause().await;
        Ok(name_reply(id, self.resolve(&path)?.0))
    }

    async fn stat(&mut self, id: u32, path: String) -> Result<Attrs, StatusReply> {
        self.pause().await;
        attrs_reply(id, fs::metadata(self.resolve(&path)?.1))
    }

    async fn rename(
        &mut self,
        id: u32,
        oldpath: String,
        newpath: String,
    ) -> Result<Status, StatusReply> {
        self.pause().await;
        self.rename_paths(&oldpath, &newpath, false)
            .map(|()| ok(id))
    }

    async fn readlink(&mut self, id: u32, path: String) -> Result<Name, StatusReply> {
        self.pause().await;
        let target = fs::read_link(self.resolve(&path)?.1).map_err(io_err)?;
        Ok(name_reply(id, self.sftp_target(&target)))
    }

    async fn symlink(
        &mut self,
        id: u32,
        linkpath: String,
        targetpath: String,
    ) -> Result<Status, StatusReply> {
        self.pause().await;
        // OpenSSH 호환: 첫 문자열이 링크 대상, 둘째가 새 링크 경로
        let (target, link) = (linkpath, targetpath);
        let (_, real_link) = self.resolve(&link)?;
        #[cfg(unix)]
        {
            // 절대 대상은 루트 안 실제 경로로, 상대 대상은 그대로 저장
            let target = if target.starts_with('/') {
                self.map(&target)?.1
            } else {
                PathBuf::from(target)
            };
            done(id, std::os::unix::fs::symlink(target, real_link))
        }
        #[cfg(not(unix))]
        {
            let _ = (id, target, real_link);
            Err(StatusCode::OpUnsupported.into())
        }
    }

    async fn extended(
        &mut self,
        id: u32,
        request: String,
        data: Vec<u8>,
    ) -> Result<Packet, StatusReply> {
        self.pause().await;
        if request != "posix-rename@openssh.com" {
            return Err(StatusCode::OpUnsupported.into());
        }
        let mut rest = data.as_slice();
        let (Some(old), Some(new)) = (take_string(&mut rest), take_string(&mut rest)) else {
            return Err(StatusCode::BadMessage.into());
        };
        self.rename_paths(&old, &new, true).map(|()| ok(id).into())
    }
}

/// "."·".." 정리. ".."는 루트에서 멈추고 상대 경로는 "/" 기준.
fn normalize(path: &str) -> Vec<&str> {
    let mut parts = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            part => parts.push(part),
        }
    }
    parts
}

fn join_sftp(parts: &[&str]) -> String {
    format!("/{}", parts.join("/"))
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

fn ok(id: u32) -> Status {
    Status {
        id,
        status_code: StatusCode::Ok,
        error_message: "Ok".into(),
        language_tag: "en-US".into(),
    }
}

/// 단일 이름 응답(REALPATH·READLINK).
fn name_reply(id: u32, name: String) -> Name {
    Name {
        id,
        files: vec![File::dummy(name)],
    }
}

fn attrs_reply(id: u32, meta: io::Result<fs::Metadata>) -> Result<Attrs, StatusReply> {
    let meta = meta.map_err(io_err)?;
    Ok(Attrs {
        id,
        attrs: attrs_of(&meta),
    })
}

fn done(id: u32, result: io::Result<()>) -> Result<Status, StatusReply> {
    result.map(|()| ok(id)).map_err(io_err)
}

fn failure(message: &str) -> StatusReply {
    StatusCode::Failure.with_message(message)
}

/// io 오류 → SFTP 상태. NotFound·PermissionDenied 외에는 Failure.
fn io_err(err: io::Error) -> StatusReply {
    let code = match err.kind() {
        io::ErrorKind::NotFound => StatusCode::NoSuchFile,
        io::ErrorKind::PermissionDenied => StatusCode::PermissionDenied,
        _ => StatusCode::Failure,
    };
    code.with_message(err.to_string())
}

/// 확장 요청 본문의 SSH 문자열 하나.
fn take_string(data: &mut &[u8]) -> Option<String> {
    let (len, rest) = data.split_first_chunk::<4>()?;
    let len = u32::from_be_bytes(*len) as usize;
    if rest.len() < len {
        return None;
    }
    let (value, rest) = rest.split_at(len);
    *data = rest;
    Some(String::from_utf8_lossy(value).into_owned())
}

/// 메타데이터 → SFTP 속성(유형 비트 포함). Windows는 유형별 권한 합성.
fn attrs_of(meta: &fs::Metadata) -> FileAttributes {
    let secs = |time: io::Result<SystemTime>| {
        let since = time.ok()?.duration_since(UNIX_EPOCH).ok()?;
        Some(since.as_secs() as u32)
    };
    #[cfg(unix)]
    let (uid, gid, permissions) = {
        use std::os::unix::fs::MetadataExt;
        (Some(meta.uid()), Some(meta.gid()), meta.mode())
    };
    #[cfg(not(unix))]
    let (uid, gid, permissions) = {
        let permissions = if meta.file_type().is_symlink() {
            0o120777
        } else if meta.is_dir() {
            0o040755
        } else if meta.permissions().readonly() {
            0o100444
        } else {
            0o100644
        };
        (None, None, permissions)
    };
    FileAttributes {
        size: Some(meta.len()),
        uid,
        user: None,
        gid,
        group: None,
        permissions: Some(permissions),
        atime: secs(meta.accessed()),
        mtime: secs(meta.modified()),
    }
}

/// SETSTAT 적용: 크기·시각·권한 순. Windows는 권한 무시.
fn set_attrs(real: &Path, attrs: &FileAttributes) -> io::Result<()> {
    if let Some(size) = attrs.size {
        fs::OpenOptions::new()
            .write(true)
            .open(real)?
            .set_len(size)?;
    }
    if attrs.atime.is_some() || attrs.mtime.is_some() {
        let at = |secs: u32| UNIX_EPOCH + Duration::from_secs(secs.into());
        let mut times = fs::FileTimes::new();
        if let Some(atime) = attrs.atime {
            times = times.set_accessed(at(atime));
        }
        if let Some(mtime) = attrs.mtime {
            times = times.set_modified(at(mtime));
        }
        open_for_times(real)?.set_times(times)?;
    }
    #[cfg(unix)]
    if let Some(mode) = attrs.permissions {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(real, fs::Permissions::from_mode(mode & 0o7777))?;
    }
    Ok(())
}

#[cfg(unix)]
fn open_for_times(real: &Path) -> io::Result<fs::File> {
    fs::File::open(real)
}

/// FILE_WRITE_ATTRIBUTES 권한, 디렉터리도 열도록 FILE_FLAG_BACKUP_SEMANTICS.
#[cfg(windows)]
fn open_for_times(real: &Path) -> io::Result<fs::File> {
    use std::os::windows::fs::OpenOptionsExt;
    fs::OpenOptions::new()
        .access_mode(0x0100)
        .custom_flags(0x0200_0000)
        .open(real)
}

mod tests {
    use super::{
        fs, lock, random_ed25519_key, Arc, Duration, FileAttributes, MethodKind, MethodSet, Mutex, OpenFlags,
        Packet, PublicKey, StatusCode, TestServerOptions, TestSftpServer, READDIR_BATCH,
    };
    use russh::client::{self, AuthResult, KeyboardInteractiveAuthResponse};
    use russh::keys::{PrivateKeyWithHashAlg, PublicKeyOrCertificate};
    use russh::ChannelStream;
    use russh_sftp::client::error::Error as SftpError;
    use russh_sftp::client::{RawSftpSession, SftpSession};
    use std::time::Instant;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    type SeenKey = Arc<Mutex<Option<PublicKey>>>;

    /// 받은 호스트 키를 기록하고 신뢰하는 클라이언트.
    struct Client(SeenKey);

    impl client::Handler for Client {
        type Error = russh::Error;

        async fn check_server_key(
            &mut self,
            key: &PublicKeyOrCertificate,
        ) -> Result<bool, Self::Error> {
            if let PublicKeyOrCertificate::PublicKey { key, .. } = key {
                *lock(&self.0) = Some(key.clone());
            }
            Ok(true)
        }
    }

    async fn connect(server: &TestSftpServer) -> (client::Handle<Client>, SeenKey) {
        let seen = SeenKey::default();
        let config = Arc::new(client::Config {
            nodelay: true,
            ..Default::default()
        });
        let handle = client::connect(config, server.addr(), Client(seen.clone()))
            .await
            .expect("ssh connect");
        (handle, seen)
    }

    async fn sftp_stream(handle: &client::Handle<Client>) -> ChannelStream<client::Msg> {
        let channel = handle
            .channel_open_session()
            .await
            .expect("session channel");
        channel
            .request_subsystem(true, "sftp")
            .await
            .expect("sftp subsystem");
        channel.into_stream()
    }

    async fn login(server: &TestSftpServer) -> (client::Handle<Client>, SftpSession) {
        let (mut handle, _) = connect(server).await;
        let auth = handle.authenticate_password("tester", "pw").await.unwrap();
        assert!(auth.success());
        let sftp = SftpSession::new(sftp_stream(&handle).await)
            .await
            .expect("sftp init");
        (handle, sftp)
    }

    async fn raw_session(handle: &client::Handle<Client>) -> RawSftpSession {
        let raw = RawSftpSession::new(sftp_stream(handle).await);
        raw.init().await.expect("sftp init");
        raw
    }

    /// "."·".."를 뺀 디렉터리 항목 이름.
    async fn list(sftp: &SftpSession, path: &str) -> Vec<String> {
        let entries = sftp.read_dir(path).await.unwrap();
        entries.map(|entry| entry.file_name()).collect()
    }

    /// 실패 결과의 SFTP 상태 코드.
    fn code<T>(result: Result<T, SftpError>) -> StatusCode {
        match result {
            Err(SftpError::Status(status)) => status.status_code,
            Err(other) => panic!("expected SFTP status, got {other}"),
            Ok(_) => panic!("expected SFTP failure"),
        }
    }

    #[test]
    fn password_login_rejects_wrong_credentials() {
        let server = TestSftpServer::start(TestServerOptions::default());
        server.block_on(async {
            let (mut handle, _) = connect(&server).await;
            let wrong = handle
                .authenticate_password("tester", "wrong")
                .await
                .unwrap();
            let only_password = MethodSet::from(&[MethodKind::Password][..]);
            assert_eq!(
                wrong,
                AuthResult::Failure {
                    remaining_methods: only_password,
                    partial_success: false
                }
            );
            let intruder = handle
                .authenticate_password("intruder", "pw")
                .await
                .unwrap();
            assert!(!intruder.success());
            let accepted = handle.authenticate_password("tester", "pw").await.unwrap();
            assert!(accepted.success());

            let sftp = SftpSession::new(sftp_stream(&handle).await).await.unwrap();
            for (input, expected) in [(".", "/"), ("", "/"), ("../a/./b/../c", "/a/c")] {
                assert_eq!(sftp.canonicalize(input).await.unwrap(), expected);
            }
        });
    }

    #[test]
    fn publickey_and_keyboard_interactive_login() {
        let client_key = random_ed25519_key();
        let server = TestSftpServer::start(TestServerOptions {
            password: None,
            authorized_key: Some(client_key.public_key().clone()),
            keyboard_interactive_code: Some("424242".into()),
            ..Default::default()
        });
        server.block_on(async {
            let (mut handle, _) = connect(&server).await;
            let password = handle.authenticate_password("tester", "pw").await.unwrap();
            assert!(!password.success());
            let stranger = PrivateKeyWithHashAlg::new(Arc::new(random_ed25519_key()), None);
            let stranger = handle
                .authenticate_publickey("tester", stranger)
                .await
                .unwrap();
            assert!(!stranger.success());
            let key = PrivateKeyWithHashAlg::new(Arc::new(client_key), None);
            let accepted = handle.authenticate_publickey("tester", key).await.unwrap();
            assert!(accepted.success());

            let (mut handle, _) = connect(&server).await;
            for (answer, success) in [("000000", false), ("424242", true)] {
                let prompt = handle
                    .authenticate_keyboard_interactive_start("tester", None::<String>)
                    .await
                    .unwrap();
                match prompt {
                    KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                        assert_eq!(prompts.len(), 1);
                        assert_eq!(prompts[0].prompt, "Verification code: ");
                        assert!(!prompts[0].echo);
                    }
                    other => panic!("expected prompt, got {other:?}"),
                }
                let result = handle
                    .authenticate_keyboard_interactive_respond(vec![answer.into()])
                    .await
                    .unwrap();
                let accepted = matches!(result, KeyboardInteractiveAuthResponse::Success);
                assert_eq!(accepted, success);
            }
        });
    }

    #[test]
    fn file_and_directory_operations_follow_openssh() {
        let server = TestSftpServer::start(TestServerOptions::default());
        let docs = server.root().join("docs");
        server.block_on(async {
            let (handle, sftp) = login(&server).await;
            sftp.create_dir("/docs").await.unwrap();
            let mut file = sftp.create("/docs/a.txt").await.unwrap();
            file.write_all(b"hello").await.unwrap();
            file.shutdown().await.unwrap();
            assert_eq!(sftp.read("/docs/a.txt").await.unwrap(), b"hello");
            assert_eq!(fs::read(docs.join("a.txt")).unwrap(), b"hello");
            let flags = OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE;
            let exclusive = sftp.open_with_flags("/docs/a.txt", flags).await;
            assert_eq!(code(exclusive), StatusCode::Failure);

            sftp.rename("/docs/a.txt", "/docs/b.txt").await.unwrap();
            fs::write(docs.join("c.txt"), b"c").unwrap();
            let onto_existing = sftp.rename("/docs/b.txt", "/docs/c.txt").await;
            assert_eq!(code(onto_existing), StatusCode::Failure);
            let times = FileAttributes {
                atime: Some(1_000_000_000),
                mtime: Some(1_000_000_000),
                ..Default::default()
            };
            sftp.set_metadata("/docs/b.txt", times).await.unwrap();
            let meta = sftp.metadata("/docs/b.txt").await.unwrap();
            assert_eq!((meta.size, meta.mtime), (Some(5), Some(1_000_000_000)));
            assert!(meta.is_regular() && !meta.is_dir());

            // posix-rename@openssh.com은 기존 대상 덮어쓰기
            let mut body = Vec::new();
            for path in ["/docs/b.txt", "/docs/c.txt"] {
                body.extend((path.len() as u32).to_be_bytes());
                body.extend(path.as_bytes());
            }
            let raw = raw_session(&handle).await;
            let reply = raw.extended("posix-rename@openssh.com", body).await;
            assert!(
                matches!(reply, Ok(Packet::Status(status)) if status.status_code == StatusCode::Ok)
            );
            assert_eq!(sftp.read("/docs/c.txt").await.unwrap(), b"hello");

            sftp.remove_file("/docs/c.txt").await.unwrap();
            sftp.remove_dir("/docs").await.unwrap();
            assert_eq!(code(sftp.metadata("/docs").await), StatusCode::NoSuchFile);
            assert!(!docs.exists());
        });
    }

    #[test]
    fn readdir_sends_dot_entries_batches_and_injected_names() {
        let server = TestSftpServer::start(TestServerOptions::default());
        let many = server.root().join("many");
        fs::create_dir(&many).unwrap();
        for index in 0..150 {
            fs::write(many.join(format!("f{index:03}")), b"").unwrap();
        }
        let malicious = vec!["../evil".to_string(), "/abs".into(), "a/b".into()];
        server.faults().inject_readdir_names(malicious.clone());
        server.block_on(async {
            let (handle, sftp) = login(&server).await;
            let raw = raw_session(&handle).await;
            let dir = raw.opendir("/many").await.unwrap().handle;
            let (mut names, mut batches) = (Vec::new(), 0);
            while let Ok(batch) = raw.readdir(dir.as_str()).await {
                assert!(batch.files.len() <= READDIR_BATCH);
                names.extend(batch.files.into_iter().map(|file| file.filename));
                batches += 1;
            }
            assert_eq!(code(raw.readdir(dir.as_str()).await), StatusCode::Eof);
            raw.close(dir).await.unwrap();
            assert_eq!((names.len(), batches), (2 + 150 + 3, 2));
            assert_eq!(names[..2], [".", ".."]);
            assert_eq!(names[152..], malicious[..]);

            assert!(list(&sftp, "/").await.contains(&"../evil".to_string()));
            server.faults().reset();
            assert_eq!(list(&sftp, "/").await, ["many"]);
        });
    }

    #[test]
    fn denied_prefix_returns_permission_denied() {
        let server = TestSftpServer::start(TestServerOptions::default());
        fs::create_dir(server.root().join("locked")).unwrap();
        fs::write(server.root().join("locked").join("x.txt"), b"x").unwrap();
        fs::write(server.root().join("lockedx.txt"), b"x").unwrap();
        server.faults().deny_path_prefix("/locked".into());
        server.block_on(async {
            let (_handle, sftp) = login(&server).await;
            let results = [
                sftp.metadata("/locked/x.txt").await.map(drop),
                sftp.metadata("/x/../locked").await.map(drop),
                sftp.create_dir("/locked/new").await,
                sftp.read_dir("/locked").await.map(drop),
                sftp.remove_file("/locked/x.txt").await,
            ];
            for result in results {
                assert_eq!(code(result), StatusCode::PermissionDenied);
            }
            assert!(sftp.metadata("/lockedx.txt").await.is_ok());
        });
    }

    #[test]
    fn disconnect_after_bytes_aborts_large_read() {
        let server = TestSftpServer::start(TestServerOptions::default());
        let content: Vec<u8> = (0..2 * 1024 * 1024u32).map(|i| (i % 251) as u8).collect();
        fs::write(server.root().join("big.bin"), &content).unwrap();
        server.faults().set_disconnect_after_bytes(512 * 1024);
        server.block_on(async {
            let (handle, sftp) = login(&server).await;
            let mut file = sftp.open("/big.bin").await.unwrap();
            let mut received = Vec::new();
            assert!(file.read_to_end(&mut received).await.is_err());
            assert!(!received.is_empty() && received.len() < content.len());
            // SFTP 오류가 아니라 SSH 연결 자체가 끊김
            for _ in 0..100 {
                if handle.is_closed() {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
            assert!(handle.is_closed());
            server.faults().reset();
            let (_handle, sftp) = login(&server).await;
            assert_eq!(sftp.read("/big.bin").await.unwrap(), content);
        });
    }

    #[test]
    fn write_limit_and_delay_faults() {
        let server = TestSftpServer::start(TestServerOptions::default());
        server.faults().set_fail_writes_after_bytes(64 * 1024);
        server.block_on(async {
            let (_handle, sftp) = login(&server).await;
            let mut file = sftp.create("/full.bin").await.unwrap();
            let payload = vec![7u8; 256 * 1024];
            let written = async {
                file.write_all(&payload).await?;
                file.shutdown().await
            };
            assert!(written.await.is_err());
            let size = fs::metadata(server.root().join("full.bin")).unwrap().len();
            assert!(size <= 64 * 1024);
            // 한 번 가득 차면 작은 쓰기도 실패
            let mut small = sftp.create("/small.bin").await.unwrap();
            let still_full = async {
                small.write_all(b"x").await?;
                small.shutdown().await
            };
            assert!(still_full.await.is_err());

            server.faults().set_delay_ms(120);
            let started = Instant::now();
            sftp.metadata("/").await.unwrap();
            assert!(started.elapsed() >= Duration::from_millis(120));
        });
    }

    #[test]
    fn host_key_and_fixed_port_match_client_view() {
        let host_key = random_ed25519_key();
        let port = std::net::TcpListener::bind("127.0.0.1:0")
            .and_then(|probe| probe.local_addr())
            .unwrap()
            .port();
        let server = TestSftpServer::start(TestServerOptions {
            host_key: Some(host_key.clone()),
            port: Some(port),
            ..Default::default()
        });
        assert_eq!(server.port(), port);
        let expected = host_key.public_key().key_data();
        assert_eq!(server.host_public_key().key_data(), expected);
        server.block_on(async {
            let (_handle, seen) = connect(&server).await;
            assert_eq!(lock(&seen).clone(), Some(server.host_public_key()));
        });
        let other = TestSftpServer::start(TestServerOptions::default());
        assert_ne!(other.host_public_key(), server.host_public_key());
    }

    #[cfg(unix)]
    #[test]
    fn symlink_uses_openssh_argument_order_and_setstat_mode() {
        let server = TestSftpServer::start(TestServerOptions::default());
        fs::create_dir(server.root().join("dir")).unwrap();
        server.block_on(async {
            let (_handle, sftp) = login(&server).await;
            // OpenSSH 순서: (대상, 링크)
            sftp.symlink("/dir", "/link").await.unwrap();
            assert_eq!(sftp.read_link("/link").await.unwrap(), "/dir");
            assert!(sftp.symlink_metadata("/link").await.unwrap().is_symlink());
            assert!(sftp.metadata("/link").await.unwrap().is_dir());
            let mode = FileAttributes {
                permissions: Some(0o700),
                ..Default::default()
            };
            sftp.set_metadata("/dir", mode).await.unwrap();
            let meta = sftp.metadata("/dir").await.unwrap();
            assert_eq!(meta.permissions, Some(0o040700));
        });
    }
}

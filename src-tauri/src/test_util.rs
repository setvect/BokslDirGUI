//! 테스트 공용 도구: 고유 임시 디렉터리와 실패해도 복원되는 프로세스 환경 잠금.
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};

/// 테스트가 바꾸는 프로세스 환경 변수. 새 키를 바꾸는 테스트를 추가하면 여기에도 추가.
const TEST_ENV_KEYS: [&str; 5] = [
    "PATH",
    "BOKSLDIRGUI_TRASH_DIR",
    "BOKSLDIRGUI_SETTINGS_PATH",
    "BOKSLDIRGUI_EXTERNAL_DRY_RUN",
    "BOKSLDIRGUI_TEST_7ZIP",
];

static ENV_MUTEX: Mutex<()> = Mutex::new(());
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// 환경을 바꾸는 테스트를 직렬화하고, 끝나면(실패 포함) 잠금 시점의 값으로 되돌림.
pub(crate) struct EnvLock {
    saved: Vec<(&'static str, Option<OsString>)>,
    _guard: MutexGuard<'static, ()>,
}

/// 앞선 테스트가 잠금을 쥔 채 실패해 오염돼도 계속 사용.
pub(crate) fn lock_env() -> EnvLock {
    let guard = ENV_MUTEX.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    EnvLock {
        saved: TEST_ENV_KEYS
            .iter()
            .map(|key| (*key, std::env::var_os(key)))
            .collect(),
        _guard: guard,
    }
}

impl Drop for EnvLock {
    fn drop(&mut self) {
        for (key, value) in self.saved.drain(..) {
            match value {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}

/// 테스트가 끝나면(실패 포함) 지워지는 고유 임시 디렉터리.
pub(crate) struct TempDir(PathBuf);

impl TempDir {
    pub(crate) fn new(label: &str) -> Self {
        let root = std::env::temp_dir().join(format!(
            "boksldir-{label}-{}-{}",
            std::process::id(),
            TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).expect("test temp dir should be created");
        Self(root)
    }

    pub(crate) fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

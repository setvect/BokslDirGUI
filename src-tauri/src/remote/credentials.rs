//! 원격 사이트 비밀값 보관(FR-35.1·35.2·35.6): OS 자격 증명 저장소(macOS 키체인·Windows 자격 증명 관리자).
//! 설정 파일에는 저장 여부(`savedSecret`)만 기록하고, 오류 상세에는 비밀값·계정 문자열을 넣지 않음.
use crate::contracts::{AppError, CommandResult};

// 시험 빌드는 메모리 저장소만 쓰므로 OS 저장소 전용 항목은 사용되지 않음
#[cfg_attr(test, allow(dead_code))]
pub(crate) const SERVICE: &str = "BokslDirGUI";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum SecretKind {
    Password,
    Passphrase,
}

pub(crate) fn account(site_id: &str, kind: SecretKind) -> String {
    let kind = match kind {
        SecretKind::Password => "password",
        SecretKind::Passphrase => "passphrase",
    };
    format!("sftp:{site_id}:{kind}")
}

pub(crate) trait SecretStore: Send + Sync {
    fn set(&self, account: &str, secret: &str) -> CommandResult<()>;
    fn get(&self, account: &str) -> CommandResult<Option<String>>;
    fn delete(&self, account: &str) -> CommandResult<()>;
}

#[cfg_attr(test, allow(dead_code))]
fn store_error(error: &impl std::fmt::Display) -> AppError {
    AppError::new("credential_store_failed", "errors.remoteCredentialStoreFailed", None, true)
        .with_detail("reason", error.to_string().chars().take(200).collect::<String>())
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) struct OsSecretStore;

impl SecretStore for OsSecretStore {
    fn set(&self, account: &str, secret: &str) -> CommandResult<()> {
        keyring::Entry::new(SERVICE, account)
            .and_then(|entry| entry.set_password(secret))
            .map_err(|error| store_error(&error))
    }

    fn get(&self, account: &str) -> CommandResult<Option<String>> {
        match keyring::Entry::new(SERVICE, account).and_then(|entry| entry.get_password()) {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(store_error(&error)),
        }
    }

    fn delete(&self, account: &str) -> CommandResult<()> {
        match keyring::Entry::new(SERVICE, account).and_then(|entry| entry.delete_credential()) {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(store_error(&error)),
        }
    }
}

/// 시험용 메모리 저장소. 시험 빌드의 `store()`는 실제 키체인 대신 이것을 사용.
#[cfg(test)]
#[derive(Default)]
pub(crate) struct MemorySecretStore(std::sync::Mutex<std::collections::HashMap<String, String>>);

#[cfg(test)]
impl SecretStore for MemorySecretStore {
    fn set(&self, account: &str, secret: &str) -> CommandResult<()> {
        self.0.lock().unwrap().insert(account.to_string(), secret.to_string());
        Ok(())
    }

    fn get(&self, account: &str) -> CommandResult<Option<String>> {
        Ok(self.0.lock().unwrap().get(account).cloned())
    }

    fn delete(&self, account: &str) -> CommandResult<()> {
        self.0.lock().unwrap().remove(account);
        Ok(())
    }
}

#[cfg(not(test))]
pub(crate) fn store() -> &'static dyn SecretStore {
    &OsSecretStore
}

#[cfg(test)]
pub(crate) fn store() -> &'static dyn SecretStore {
    static MEMORY: std::sync::OnceLock<MemorySecretStore> = std::sync::OnceLock::new();
    MEMORY.get_or_init(MemorySecretStore::default)
}

/// 사이트의 저장된 비밀값 모두 삭제(사이트 삭제·자격 증명만 삭제).
pub(crate) fn forget(site_id: &str) -> CommandResult<()> {
    let store = store();
    store.delete(&account(site_id, SecretKind::Password))?;
    store.delete(&account(site_id, SecretKind::Passphrase))
}

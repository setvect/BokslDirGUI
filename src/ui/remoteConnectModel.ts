// 원격 연결 창의 입력 모델과 오류 해석. React·Tauri 의존 없음
import { DEFAULT_SFTP_PORT, parseRemotePath, remoteUrl } from '../domain/remotePath';
import type { AppError, RemoteAuthMethod, RemoteConnectRequest, RemoteSession, RemoteSite } from '../domain/types';

export const DEFAULT_KEY_PATH = '~/.ssh/id_ed25519';

// 연결 창 입력. 비밀값(암호·키 암호)은 별도 보관하고 여기에 두지 않음
export interface RemoteConnectDraft {
  siteId: string | null;
  name: string;
  host: string;
  port: number;
  user: string;
  authMethod: RemoteAuthMethod;
  keyPath: string;
  startPath: string;
  saveSite: boolean;
  // 연결에 성공하면 입력한 암호·키 암호를 자격 증명 저장소에 저장
  saveSecret: boolean;
  // 사이트에 저장된 비밀값이 있음(입력란을 비우면 저장된 값 사용)
  hasSavedSecret: boolean;
}

export interface RemoteSecrets {
  password?: string;
  passphrase?: string;
}

export const emptyDraft = (): RemoteConnectDraft => ({
  siteId: null, name: '', host: '', port: DEFAULT_SFTP_PORT, user: '', authMethod: 'password', keyPath: DEFAULT_KEY_PATH, startPath: '', saveSite: false,
  saveSecret: false, hasSavedSecret: false,
});

export const draftFromSite = (site: RemoteSite): RemoteConnectDraft => ({
  siteId: site.id, name: site.name, host: site.host, port: site.port, user: site.user, authMethod: site.authMethod,
  keyPath: site.keyPath ?? DEFAULT_KEY_PATH, startPath: site.startPath ?? '', saveSite: true,
  saveSecret: site.savedSecret, hasSavedSecret: site.savedSecret,
});

// `sftp://` 주소로 연결할 때: 주소의 사용자·호스트·포트와 일치하는 사이트가 있으면 그 설정 사용
export const draftFromUrl = (url: string, sites: readonly RemoteSite[]): RemoteConnectDraft | null => {
  const remote = parseRemotePath(url);
  if (!remote) return null;
  const site = sites.find((candidate) => candidate.user === remote.user && candidate.host === remote.host && candidate.port === remote.port);
  return site ? draftFromSite(site) : { ...emptyDraft(), host: remote.host, port: remote.port, user: remote.user };
};

export const validateDraft = (draft: RemoteConnectDraft): 'hostRequired' | 'userRequired' | 'portInvalid' | 'keyRequired' | 'nameRequired' | null => {
  if (!draft.host.trim()) return 'hostRequired';
  if (!draft.user) return 'userRequired';
  if (!Number.isInteger(draft.port) || draft.port < 1 || draft.port > 65535) return 'portInvalid';
  if (draft.authMethod === 'publicKey' && !draft.keyPath.trim()) return 'keyRequired';
  if (draft.saveSite && !draft.name.trim()) return 'nameRequired';
  return null;
};

// 비밀값을 쓰는 방식(암호·키 파일)만 저장 대상
export const usesSecret = (method: RemoteAuthMethod) => method === 'password' || method === 'publicKey';

export const connectRequestOf = (draft: RemoteConnectDraft, secrets: RemoteSecrets): RemoteConnectRequest => ({
  ...(draft.siteId ? { siteId: draft.siteId } : {}),
  ...(draft.siteId && draft.saveSite && draft.saveSecret && usesSecret(draft.authMethod) ? { saveSecret: true } : {}),
  host: draft.host.trim(),
  port: draft.port,
  user: draft.user,
  authMethod: draft.authMethod,
  ...(draft.authMethod === 'password' && secrets.password !== undefined ? { password: secrets.password } : {}),
  ...(draft.authMethod === 'publicKey' ? { keyPath: draft.keyPath.trim(), ...(secrets.passphrase ? { passphrase: secrets.passphrase } : {}) } : {}),
});

export const siteFromDraft = (draft: RemoteConnectDraft, id: string, savedSecret: boolean): RemoteSite => ({
  id,
  name: draft.name.trim(),
  host: draft.host.trim(),
  port: draft.port,
  user: draft.user,
  authMethod: draft.authMethod,
  ...(draft.authMethod === 'publicKey' && draft.keyPath.trim() ? { keyPath: draft.keyPath.trim() } : {}),
  ...(draft.startPath.trim() ? { startPath: draft.startPath.trim() } : {}),
  savedSecret,
});

// 연결 뒤 열 위치: 요청한 주소, 시작 경로(`~`·상대 경로는 홈 기준), 홈 순
export const startUrlFor = (session: RemoteSession, startPath: string, targetUrl: string | null) => {
  if (targetUrl) return targetUrl;
  const start = startPath.trim();
  if (!start || start === '~') return session.homeUrl;
  const absolute = start.startsWith('/') ? start
    : start.startsWith('~/') ? `${session.home.replace(/\/+$/, '')}/${start.slice(2)}`
      : `${session.home.replace(/\/+$/, '')}/${start}`;
  return remoteUrl(session, absolute);
};

export interface HostKeyQuestion {
  host: string;
  port: number;
  algorithm: string;
  fingerprint: string;
}

export interface AuthPrompts {
  challengeId: string;
  instructions: string;
  prompts: Array<{ prompt: string; echo: boolean }>;
}

const detail = (error: AppError, key: string) => {
  const value = error.details?.[key];
  return typeof value === 'string' ? value : '';
};

export const hostKeyQuestionOf = (error: AppError, draft: RemoteConnectDraft): HostKeyQuestion | null =>
  error.code === 'host_key_unknown'
    ? { host: detail(error, 'hostName') || draft.host.trim(), port: Number(detail(error, 'port')) || draft.port, algorithm: detail(error, 'algorithm'), fingerprint: detail(error, 'fingerprint') }
    : null;

export const authPromptsOf = (error: AppError): AuthPrompts | null => {
  if (error.code !== 'remote_auth_prompts') return null;
  try {
    const prompts = JSON.parse(detail(error, 'prompts')) as unknown;
    if (!Array.isArray(prompts)) return null;
    return {
      challengeId: detail(error, 'challengeId'),
      instructions: detail(error, 'instructions'),
      prompts: prompts.map((prompt) => ({ prompt: String((prompt as { prompt?: unknown }).prompt ?? ''), echo: Boolean((prompt as { echo?: unknown }).echo) })),
    };
  } catch {
    return null;
  }
};

export const changedHostKeyOf = (error: AppError) =>
  error.code === 'host_key_changed'
    ? { algorithm: detail(error, 'algorithm'), fingerprint: detail(error, 'fingerprint'), recordedFingerprint: detail(error, 'recordedFingerprint') }
    : null;

export const newSiteId = () => `site-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

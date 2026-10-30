import { DEFAULT_SFTP_PORT, parseRemotePath, remoteLocationKey } from '../domain/remotePath';
import type { RemoteConnectionChanged, RemoteConnectionState, RemoteSession, RemoteSite } from '../domain/types';

// 연결 등록부의 화면 상태. 연결 결과로 받은 세션 정보는 끊김 뒤에도 재연결 안내에 사용
export interface RemoteSessionEntry {
  session: RemoteSession | null;
  state: Exclude<RemoteConnectionState, 'disconnected'>;
}

export type RemoteSessionMap = Readonly<Record<string, RemoteSessionEntry>>;

export type RemotePanelState = 'connected' | 'lost' | 'disconnected';

export interface RemotePanelStatus {
  sessionId: string;
  siteName: string | null;
  address: string;
  state: RemotePanelState;
}

export const recordRemoteSession = (current: RemoteSessionMap, session: RemoteSession): RemoteSessionMap => ({
  ...current,
  [session.sessionId]: { session, state: 'connected' },
});

export const mergeRemoteSessions = (current: RemoteSessionMap, sessions: RemoteSession[]): RemoteSessionMap =>
  sessions.reduce(recordRemoteSession, current);

// 앱 요청 해제는 등록부에서 제거, 끊김은 세션 정보를 남긴 채 상태만 변경
export const applyRemoteConnectionChange = (current: RemoteSessionMap, event: RemoteConnectionChanged): RemoteSessionMap => {
  const { [event.sessionId]: existing, ...rest } = current;
  if (event.state === 'disconnected') return rest;
  return { ...rest, [event.sessionId]: { session: existing?.session ?? null, state: event.state } };
};

// 표시용 주소: 기본 포트는 생략, IPv6는 대괄호
export const remoteAddressOf = (user: string, host: string, port: number) => {
  const shownHost = host.includes(':') ? `[${host}]` : host;
  return `${user}@${shownHost}${port === DEFAULT_SFTP_PORT ? '' : `:${port}`}`;
};

// 패널 경로의 원격 연결 표시(FR-34.5). 저장된 사이트와 사용자·호스트·포트가 같으면 사이트 이름 사용
export const remoteStatusForPath = (path: string, sessions: RemoteSessionMap, sites: readonly RemoteSite[]): RemotePanelStatus | null => {
  const remote = parseRemotePath(path);
  if (!remote) return null;
  const sessionId = remoteLocationKey(remote);
  const site = sites.find((candidate) => candidate.user === remote.user && candidate.host === remote.host && candidate.port === remote.port);
  return {
    sessionId,
    siteName: site?.name ?? null,
    address: remoteAddressOf(remote.user, remote.host, remote.port),
    state: sessions[sessionId]?.state ?? 'disconnected',
  };
};

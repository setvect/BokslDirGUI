import { useCallback, useEffect, useState } from 'react';
import type { RemoteSession } from '../domain/types';
import type { RemoteSessionClient } from '../tauri/commanderClients';
import { applyRemoteConnectionChange, mergeRemoteSessions, recordRemoteSession, type RemoteSessionMap } from './remoteSessionState';

// 원격 연결 상태 구독: 시작 시 연결 목록을 읽고 이후 `remote_connection_changed` 이벤트로 갱신
export const useRemoteSessions = (client: RemoteSessionClient | undefined, enabled: boolean) => {
  const [sessions, setSessions] = useState<RemoteSessionMap>({});
  useEffect(() => {
    if (!client || !enabled) return undefined;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    void client.listenRemoteConnectionChanges((event) => {
      setSessions((current) => applyRemoteConnectionChange(current, event));
    }).then((cleanup) => {
      if (disposed) cleanup();
      else unlisten = cleanup;
    }).catch(() => undefined);
    void client.remoteSessions().then((result) => {
      if (!disposed && result.ok) setSessions((current) => mergeRemoteSessions(current, result.data));
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [client, enabled]);
  const recordSession = useCallback((session: RemoteSession) => setSessions((current) => recordRemoteSession(current, session)), []);
  return { sessions, recordSession };
};

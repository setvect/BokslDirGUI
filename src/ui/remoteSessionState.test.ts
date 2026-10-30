import { describe, expect, it } from 'vitest';
import type { RemoteSession, RemoteSite } from '../domain/types';
import { applyRemoteConnectionChange, mergeRemoteSessions, remoteStatusForPath } from './remoteSessionState';

const session: RemoteSession = {
  sessionId: 'sftp://boksl@example.com:2222/',
  user: 'boksl',
  host: 'example.com',
  port: 2222,
  home: '/home/boksl',
  homeUrl: 'sftp://boksl@example.com:2222/home/boksl',
  hostKeyAlgorithm: 'ssh-ed25519',
  hostKeyFingerprint: 'SHA256:fixture',
};

const site: RemoteSite = { id: 'site-1', name: '배포 서버', host: 'example.com', port: 2222, user: 'boksl', authMethod: 'password', savedSecret: false };

describe('remote session state', () => {
  it('keeps session details through loss and forgets app-requested disconnects', () => {
    const connected = mergeRemoteSessions({}, [session]);
    expect(connected[session.sessionId]).toEqual({ session, state: 'connected' });
    const lost = applyRemoteConnectionChange(connected, { sessionId: session.sessionId, state: 'lost', error: null });
    expect(lost[session.sessionId]).toEqual({ session, state: 'lost' });
    const reconnected = applyRemoteConnectionChange(lost, { sessionId: session.sessionId, state: 'connected', error: null });
    expect(reconnected[session.sessionId]).toEqual({ session, state: 'connected' });
    expect(applyRemoteConnectionChange(reconnected, { sessionId: session.sessionId, state: 'disconnected', error: null })).toEqual({});
    expect(applyRemoteConnectionChange({}, { sessionId: 'sftp://u@h/', state: 'connected', error: null })['sftp://u@h/']).toEqual({ session: null, state: 'connected' });
  });

  it('describes remote panel paths by site name, address and state', () => {
    const sessions = mergeRemoteSessions({}, [session]);
    expect(remoteStatusForPath('sftp://boksl@example.com:2222/srv/한글', sessions, [site])).toEqual({
      sessionId: session.sessionId,
      siteName: '배포 서버',
      address: 'boksl@example.com:2222',
      state: 'connected',
    });
    expect(remoteStatusForPath('sftp://u@[::1]:2200/', {}, [site])).toEqual({
      sessionId: 'sftp://u@[::1]:2200/',
      siteName: null,
      address: 'u@[::1]:2200',
      state: 'disconnected',
    });
    expect(remoteStatusForPath('sftp://u@example.com/x', {}, [])?.address).toBe('u@example.com');
    expect(remoteStatusForPath('/Users/boksl', sessions, [site])).toBeNull();
  });
});

import { describe, expect, it } from 'vitest';
import type { AppError, RemoteSession, RemoteSite } from '../domain/types';
import { authPromptsOf, changedHostKeyOf, connectRequestOf, draftFromUrl, emptyDraft, hostKeyQuestionOf, siteFromDraft, startUrlFor, validateDraft } from './remoteConnectModel';

const site: RemoteSite = { id: 'site-1', name: '배포', host: 'example.com', port: 2222, user: 'boksl', authMethod: 'publicKey', keyPath: '~/.ssh/deploy', startPath: '/srv', savedSecret: false };
const session: RemoteSession = { sessionId: 'sftp://boksl@example.com:2222/', user: 'boksl', host: 'example.com', port: 2222, home: '/home/boksl', homeUrl: 'sftp://boksl@example.com:2222/home/boksl', hostKeyAlgorithm: 'ssh-ed25519', hostKeyFingerprint: 'SHA256:x' };
const error = (code: string, details: Record<string, string>): AppError => ({ code, messageKey: `errors.${code}`, path: null, details, recoverable: true });

describe('remote connect model', () => {
  it('prefills connections from saved sites or typed sftp addresses', () => {
    expect(draftFromUrl('sftp://boksl@example.com:2222/var/log', [site])).toMatchObject({ siteId: 'site-1', keyPath: '~/.ssh/deploy', saveSite: true });
    expect(draftFromUrl('sftp://other@example.com/x', [site])).toMatchObject({ siteId: null, user: 'other', host: 'example.com', port: 22, authMethod: 'password' });
    expect(draftFromUrl('/local/path', [site])).toBeNull();
  });

  it('validates required fields and sends only the secret of the chosen method', () => {
    expect(validateDraft({ ...emptyDraft(), user: 'u' })).toBe('hostRequired');
    expect(validateDraft({ ...emptyDraft(), host: 'h', user: 'u', port: 70000 })).toBe('portInvalid');
    expect(validateDraft({ ...emptyDraft(), host: 'h', user: 'u', saveSite: true })).toBe('nameRequired');
    expect(validateDraft({ ...emptyDraft(), host: 'h', user: 'u', authMethod: 'publicKey', keyPath: ' ' })).toBe('keyRequired');
    const draft = { ...emptyDraft(), host: ' example.com ', user: 'boksl', port: 2222 };
    expect(connectRequestOf(draft, { password: 'pw', passphrase: 'pp' })).toEqual({ host: 'example.com', port: 2222, user: 'boksl', authMethod: 'password', password: 'pw' });
    expect(connectRequestOf({ ...draft, authMethod: 'publicKey', keyPath: '~/.ssh/id' }, { password: 'pw', passphrase: '' }))
      .toEqual({ host: 'example.com', port: 2222, user: 'boksl', authMethod: 'publicKey', keyPath: '~/.ssh/id' });
    expect(connectRequestOf({ ...draft, authMethod: 'agent' }, { password: 'pw' })).toEqual({ host: 'example.com', port: 2222, user: 'boksl', authMethod: 'agent' });
    const saved = siteFromDraft({ ...draft, name: ' 운영 ', authMethod: 'agent', startPath: '' }, 'site-2', false);
    expect(saved).toEqual({ id: 'site-2', name: '운영', host: 'example.com', port: 2222, user: 'boksl', authMethod: 'agent', savedSecret: false });
    expect(JSON.stringify(saved)).not.toContain('pw');
  });

  it('opens the requested address, the start path under the remote home, or the home', () => {
    expect(startUrlFor(session, '', null)).toBe(session.homeUrl);
    expect(startUrlFor(session, '~/logs', null)).toBe('sftp://boksl@example.com:2222/home/boksl/logs');
    expect(startUrlFor(session, 'www', null)).toBe('sftp://boksl@example.com:2222/home/boksl/www');
    expect(startUrlFor(session, '/srv/한글', null)).toBe('sftp://boksl@example.com:2222/srv/한글');
    expect(startUrlFor(session, '/srv', 'sftp://boksl@example.com:2222/tmp')).toBe('sftp://boksl@example.com:2222/tmp');
  });

  it('reads host key, changed key and prompt details from backend errors', () => {
    expect(hostKeyQuestionOf(error('host_key_unknown', { hostName: '::1', port: '2200', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:a' }), emptyDraft()))
      .toEqual({ host: '::1', port: 2200, algorithm: 'ssh-ed25519', fingerprint: 'SHA256:a' });
    expect(changedHostKeyOf(error('host_key_changed', { algorithm: 'ssh-rsa', fingerprint: 'SHA256:new', recordedFingerprint: 'SHA256:old' })))
      .toEqual({ algorithm: 'ssh-rsa', fingerprint: 'SHA256:new', recordedFingerprint: 'SHA256:old' });
    expect(authPromptsOf(error('remote_auth_prompts', { challengeId: 'kbd-1', instructions: '', prompts: '[{"prompt":"Code: ","echo":false}]' })))
      .toEqual({ challengeId: 'kbd-1', instructions: '', prompts: [{ prompt: 'Code: ', echo: false }] });
    expect(authPromptsOf(error('remote_auth_prompts', { prompts: 'not json' }))).toBeNull();
    expect(hostKeyQuestionOf(error('remote_auth_failed', {}), emptyDraft())).toBeNull();
  });
});

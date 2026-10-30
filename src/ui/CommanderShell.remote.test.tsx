// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry, Settings } from '../domain/types';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { useOperationStore } from '../operations/operationStore';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing } from './panelState';
import { mutationClientStub, operationClientStub, remoteClientStub, settingsFixture } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { focusedRowText, rowByText } from './testing/commanderTestSupport';

const REMOTE_DIR = 'sftp://boksl@example.com:2222/srv';

const remoteEntry = (name: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path: `${REMOTE_DIR}/${name}`, name, kind: 'file', sizeBytes: 3, modifiedAt: null, createdAt: null,
  permissions: '-rw-r--r--', owner: 'boksl', group: 'staff', isHidden: false, isVirtual: false, ...overrides,
});

const renderRemotePanel = (operationClient = operationClientStub(), remoteClient = remoteClientStub()) => {
  const listing = createDirectoryListing('right', REMOTE_DIR, [
    remoteEntry('remote.txt'),
    remoteEntry('logs', { kind: 'directory', sizeBytes: null, permissions: 'drwxr-xr-x' }),
  ]);
  const dataSource = createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: listing });
  return render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub()} operationClient={operationClient}
    remoteClient={remoteClient} initialFocusIndex={{ left: 3, right: 0 }} initialSelectedPaths={{ left: [], right: [] }} />);
};

describe('CommanderShell remote panels', () => {
  it('routes delete in a remote panel to the typed permanent delete confirmation', async () => {
    const user = userEvent.setup();
    const operationClient = operationClientStub({
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-remote-delete', kind: 'delete' as const, state: 'queued' as const } })),
    });
    const { container } = renderRemotePanel(operationClient);
    await waitFor(() => expect(focusedRowText(container)).toContain('remote.txt'));

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '영구 삭제' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '휴지통으로 이동' })).toBeNull();
    await user.type(screen.getByLabelText('영구 삭제 확인 문구'), 'remote.txt');
    await user.click(screen.getByRole('button', { name: '영구 삭제' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [`${REMOTE_DIR}/remote.txt`], mode: 'permanent', confirmToken: 'PERMANENT_DELETE',
    }));
  });

  it('offers permission changes instead of local-only actions and starts chmod with the chosen mode', async () => {
    const user = userEvent.setup();
    const startRemoteChmod = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-remote-chmod', kind: 'chmod' as const, state: 'queued' as const } }));
    const { container } = renderRemotePanel(operationClientStub({ startRemoteChmod }));
    await waitFor(() => expect(rowByText(container, 'remote.txt')).not.toBeNull());

    fireEvent.contextMenu(rowByText(container, 'remote.txt')!);
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /기본 앱으로 열기/ })).toBeTruthy();
    expect(within(menu).queryByRole('menuitem', { name: /Finder|탐색기|파일 위치/ })).toBeNull();
    expect(within(menu).queryByRole('menuitem', { name: /압축/ })).toBeNull();
    await user.click(within(menu).getByRole('menuitem', { name: /권한 변경/ }));

    const dialog = await screen.findByRole('dialog', { name: '권한 변경' });
    const octal = within(dialog).getByLabelText('8진수 권한') as HTMLInputElement;
    expect(octal.value).toBe('644');
    expect(within(dialog).getByLabelText('하위 항목에도 적용')).toHaveProperty('disabled', true);
    await user.click(within(dialog).getByLabelText('그룹 쓰기'));
    expect(octal.value).toBe('664');
    await user.clear(octal);
    expect(within(dialog).getByRole('button', { name: '적용' })).toHaveProperty('disabled', true);
    await user.type(octal, '9750');
    expect(octal.value).toBe('750');
    await user.click(within(dialog).getByRole('button', { name: '적용' }));

    await waitFor(() => expect(startRemoteChmod).toHaveBeenCalledWith({
      targets: [`${REMOTE_DIR}/remote.txt`], mode: 0o750, recursive: false, scope: 'all',
    }));
  });
  it('downloads with the existing copy key and uploads from a local panel into the remote panel', async () => {
    const user = userEvent.setup();
    const started = { ok: true as const, data: { operationId: 'op-remote-copy', kind: 'copy' as const, state: 'queued' as const } };
    const operationClient = operationClientStub({ startCopy: vi.fn(async () => started) });
    const { container } = renderRemotePanel(operationClient);
    await waitFor(() => expect(focusedRowText(container)).toContain('remote.txt'));

    await user.keyboard('y');
    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [`${REMOTE_DIR}/remote.txt`], targetDir: SAMPLE_LISTINGS.left.path, policy: 'skip',
    }));
    useOperationStore.setState({ dialog: null, progress: null, summary: null, lastError: null, activeOperationController: null });

    await user.keyboard('{Tab}');
    await user.keyboard('y');
    await waitFor(() => expect(operationClient.startCopy).toHaveBeenLastCalledWith({
      sources: [`${SAMPLE_LISTINGS.left.path}/Architecture.md`], targetDir: REMOTE_DIR, policy: 'skip',
    }));
  });
  it('adds a site, trusts the shown host key, connects and opens the remote home in the active panel', async () => {
    const user = userEvent.setup();
    const session = { sessionId: 'sftp://boksl@example.com:2222/', user: 'boksl', host: 'example.com', port: 2222, home: '/home/boksl', homeUrl: 'sftp://boksl@example.com:2222/home/boksl', hostKeyAlgorithm: 'ssh-ed25519', hostKeyFingerprint: 'SHA256:fixture', secretStored: false };
    const hostKeyError = { code: 'host_key_unknown', messageKey: 'errors.remoteHostKeyUnknown', path: session.sessionId, recoverable: true,
      details: { hostName: 'example.com', port: '2222', algorithm: 'ssh-ed25519', fingerprint: 'SHA256:fixture' } };
    const remoteConnect = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: hostKeyError })
      .mockResolvedValueOnce({ ok: true as const, data: session });
    const remoteTrustHostKey = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const saveSettings = vi.fn(async (input: { patch: Partial<Settings> }) => ({ ok: true as const, data: settingsFixture(input.patch) }));
    const dataSource = createFixturePanelDataSource();
    dataSource.gotoPath = vi.fn(async (input) => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path, []) }));
    const { container } = render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub({ saveSettings, loadSettings: vi.fn(async () => ({ ok: true as const, data: settingsFixture() })) })}
      operationClient={operationClientStub()} remoteClient={remoteClientStub({ remoteConnect, remoteTrustHostKey })} />);

    await user.keyboard('gr');
    const sites = await screen.findByRole('dialog', { name: '사이트 목록' });
    await user.click(within(sites).getByRole('button', { name: '새 사이트' }));
    const form = await screen.findByRole('dialog', { name: '원격 연결' });
    await user.type(within(form).getByLabelText('호스트'), 'example.com');
    const port = within(form).getByLabelText('포트');
    await user.clear(port);
    await user.type(port, '2222');
    await user.type(within(form).getByLabelText('사용자'), 'boksl');
    await user.type(within(form).getByLabelText('암호'), 'secret-pw');
    await user.type(within(form).getByLabelText('사이트 이름'), '배포 서버');
    await user.click(within(form).getByRole('button', { name: '연결' }));

    const hostKey = await screen.findByRole('dialog', { name: '호스트 키 확인' });
    expect(within(hostKey).getByText('SHA256:fixture')).toBeTruthy();
    expect(document.activeElement?.textContent).toBe('취소');
    await user.click(within(hostKey).getByRole('button', { name: '신뢰하고 연결' }));

    await waitFor(() => expect(remoteTrustHostKey).toHaveBeenCalledWith({ host: 'example.com', port: 2222, fingerprint: 'SHA256:fixture' }));
    await waitFor(() => expect(remoteConnect).toHaveBeenCalledTimes(2));
    expect(remoteConnect).toHaveBeenLastCalledWith({ request: { siteId: expect.any(String), host: 'example.com', port: 2222, user: 'boksl', authMethod: 'password', password: 'secret-pw' } });
    await waitFor(() => expect(dataSource.gotoPath).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right', path: session.homeUrl })));
    const savedPatch = saveSettings.mock.calls.map(([input]) => JSON.stringify(input.patch)).find((patch) => patch.includes('배포 서버'));
    expect(savedPatch).toBeTruthy();
    expect(savedPatch).not.toContain('secret-pw');
    expect(container.querySelector('.file-panel.is-active .path-input')?.textContent).toBe(session.homeUrl);
  });

  it('answers keyboard-interactive prompts and cancels pending challenges', async () => {
    const user = userEvent.setup();
    const promptsError = { code: 'remote_auth_prompts', messageKey: 'errors.remoteAuthPrompts', path: null, recoverable: true,
      details: { challengeId: 'kbd-7', instructions: '', prompts: '[{"prompt":"Verification code: ","echo":false}]' } };
    const remoteConnect = vi.fn(async () => ({ ok: false as const, error: promptsError }));
    const remoteAuthRespond = vi.fn(async () => ({ ok: false as const, error: { code: 'remote_auth_failed', messageKey: 'errors.remoteAuthFailed', path: null, details: null, recoverable: true } }));
    const remoteAuthCancel = vi.fn(async () => ({ ok: true as const, data: true }));
    renderRemotePanel(operationClientStub(), remoteClientStub({ remoteConnect, remoteAuthRespond, remoteAuthCancel }));

    await user.keyboard('gr');
    await user.click(within(await screen.findByRole('dialog', { name: '사이트 목록' })).getByRole('button', { name: '새 사이트' }));
    const form = await screen.findByRole('dialog', { name: '원격 연결' });
    await user.type(within(form).getByLabelText('호스트'), 'otp.example.com');
    await user.type(within(form).getByLabelText('사용자'), 'boksl');
    await user.selectOptions(within(form).getByLabelText('인증 방식'), 'keyboardInteractive');
    await user.click(within(form).getByLabelText('사이트로 저장'));
    await user.click(within(form).getByRole('button', { name: '연결' }));

    const prompts = await screen.findByRole('dialog', { name: '추가 인증' });
    await user.type(within(prompts).getByLabelText('Verification code:'), '123456');
    await user.click(within(prompts).getByRole('button', { name: '확인' }));
    await waitFor(() => expect(remoteAuthRespond).toHaveBeenCalledWith({ challengeId: 'kbd-7', responses: ['123456'] }));
    const failed = await screen.findByRole('dialog', { name: '원격 연결' });
    expect(within(failed).getByRole('alert').textContent).toContain('인증에 실패');

    await user.click(within(failed).getByRole('button', { name: '연결' }));
    await user.click(within(await screen.findByRole('dialog', { name: '추가 인증' })).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(remoteAuthCancel).toHaveBeenCalledWith({ challengeId: 'kbd-7' }));
  });

  it('disconnects a connected remote panel back to a local folder and offers reconnect when lost', async () => {
    const user = userEvent.setup();
    const session = { sessionId: 'sftp://boksl@example.com:2222/', user: 'boksl', host: 'example.com', port: 2222, home: '/home/boksl', homeUrl: 'sftp://boksl@example.com:2222/home/boksl', hostKeyAlgorithm: 'ssh-ed25519', hostKeyFingerprint: 'SHA256:x', secretStored: false };
    const remoteDisconnect = vi.fn(async () => ({ ok: true as const, data: true }));
    const remoteClient = remoteClientStub({ remoteDisconnect, remoteSessions: vi.fn(async () => ({ ok: true as const, data: [session] })) });
    const operationClient = operationClientStub();
    const listing = createDirectoryListing('right', REMOTE_DIR, [remoteEntry('remote.txt')]);
    const dataSource = createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: listing });
    dataSource.gotoPath = vi.fn(async (input) => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path, []) }));
    dataSource.listLocations = vi.fn(async () => ({ ok: true as const, data: { home: '/Users/boksl', roots: ['/'], recent: [], bookmarks: [] } }));
    const { container } = render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub()} operationClient={operationClient}
      remoteClient={remoteClient} initialFocusIndex={{ left: 3, right: 0 }} initialSelectedPaths={{ left: [], right: [] }} />);
    await waitFor(() => expect(container.querySelector('.remote-chip')?.textContent).toBe('SFTP 연결됨'));

    await user.keyboard('gd');
    await waitFor(() => expect(remoteDisconnect).toHaveBeenCalledWith({ sessionId: session.sessionId }));
    await waitFor(() => expect(dataSource.gotoPath).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right', path: '/Users/boksl' })));
  });

  it('opens the connection form for an unconnected sftp address typed in go to path', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    dataSource.gotoPath = vi.fn(async (input) => ({ ok: false as const, error: { code: 'remote_not_connected', messageKey: 'errors.remoteNotConnected', path: 'sftp://deploy@files.example.com:2200/', details: null, recoverable: true } }));
    render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub()} operationClient={operationClientStub()} remoteClient={remoteClientStub()} />);

    await user.keyboard('gp');
    const input = screen.getByRole('textbox', { name: '경로' });
    await user.clear(input);
    await user.type(input, 'sftp://deploy@files.example.com:2200/var/www');
    await user.click(screen.getByRole('button', { name: '이동' }));

    const form = await screen.findByRole('dialog', { name: '원격 연결' });
    expect((within(form).getByLabelText('호스트') as HTMLInputElement).value).toBe('files.example.com');
    expect((within(form).getByLabelText('포트') as HTMLInputElement).value).toBe('2200');
    expect((within(form).getByLabelText('사용자') as HTMLInputElement).value).toBe('deploy');
    expect(screen.queryByRole('dialog', { name: '경로 이동' })).toBeNull();
  });
  it('stores the typed password only when asked and marks the saved site', async () => {
    const user = userEvent.setup();
    const site = { id: 'site-pw', name: '운영', host: 'example.com', port: 22, user: 'boksl', authMethod: 'password' as const, savedSecret: false };
    const session = { sessionId: 'sftp://boksl@example.com/', user: 'boksl', host: 'example.com', port: 22, home: '/home/boksl', homeUrl: 'sftp://boksl@example.com/home/boksl', hostKeyAlgorithm: 'ssh-ed25519', hostKeyFingerprint: 'SHA256:x', secretStored: true };
    const remoteConnect = vi.fn(async () => ({ ok: true as const, data: session }));
    const saveSettings = vi.fn(async (input: { patch: Partial<Settings> }) => ({ ok: true as const, data: settingsFixture(input.patch) }));
    const settings = settingsFixture({ remote: { sites: [site], keepaliveSeconds: 30, connectTimeoutSeconds: 15, linkPolicy: 'preserve' } });
    const dataSource = createFixturePanelDataSource();
    dataSource.gotoPath = vi.fn(async (input) => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path, []) }));
    render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub({ saveSettings, loadSettings: vi.fn(async () => ({ ok: true as const, data: settings })) })}
      operationClient={operationClientStub()} remoteClient={remoteClientStub({ remoteConnect })} />);

    await user.keyboard('gr');
    await user.click(within(await screen.findByRole('dialog', { name: '사이트 목록' })).getByRole('button', { name: '연결' }));
    const form = await screen.findByRole('dialog', { name: '원격 연결' });
    await user.type(within(form).getByLabelText('암호'), 'typed-secret');
    await user.click(within(form).getByLabelText('암호·키 암호를 OS 자격 증명 저장소에 저장'));
    await user.click(within(form).getByRole('button', { name: '연결' }));

    await waitFor(() => expect(remoteConnect).toHaveBeenCalledWith({ request: {
      siteId: 'site-pw', saveSecret: true, host: 'example.com', port: 22, user: 'boksl', authMethod: 'password', password: 'typed-secret',
    } }));
    await waitFor(() => expect(saveSettings.mock.calls.some(([input]) => input.patch.remote?.sites?.[0]?.savedSecret === true)).toBe(true));
    expect(saveSettings.mock.calls.every(([input]) => !JSON.stringify(input.patch).includes('typed-secret'))).toBe(true);
  });

  it('forgets saved passwords, imports ssh config hosts and lists sites in locations', async () => {
    const user = userEvent.setup();
    const site = { id: 'site-saved', name: '배포', host: 'deploy.example.com', port: 22, user: 'boksl', authMethod: 'password' as const, savedSecret: true };
    const remoteForgetSecret = vi.fn(async () => ({ ok: true as const, data: undefined }));
    const remoteImportSshConfig = vi.fn(async () => ({ ok: true as const, data: {
      entries: [{ alias: 'web', host: 'web.example.com', port: 2222, user: 'www', keyPath: '~/.ssh/web' }, { alias: 'dup', host: 'deploy.example.com', port: 22, user: 'boksl' }],
      warnings: ['ProxyJump'],
    } }));
    const saveSettings = vi.fn(async (input: { patch: Partial<Settings> }) => ({ ok: true as const, data: settingsFixture(input.patch) }));
    const settings = settingsFixture({ remote: { sites: [site], keepaliveSeconds: 30, connectTimeoutSeconds: 15, linkPolicy: 'preserve' } });
    const { container } = render(<CommanderShell dataSource={createFixturePanelDataSource()} mutationClient={mutationClientStub({ saveSettings, loadSettings: vi.fn(async () => ({ ok: true as const, data: settings })) })}
      operationClient={operationClientStub()} remoteClient={remoteClientStub({ remoteForgetSecret, remoteImportSshConfig })} />);

    await user.keyboard('gr');
    const sites = await screen.findByRole('dialog', { name: '사이트 목록' });
    await user.click(within(sites).getByRole('button', { name: '저장된 암호 삭제' }));
    await waitFor(() => expect(remoteForgetSecret).toHaveBeenCalledWith({ siteId: 'site-saved' }));
    await waitFor(() => expect(saveSettings.mock.calls.some(([input]) => input.patch.remote?.sites?.[0]?.savedSecret === false)).toBe(true));

    await user.click(within(sites).getByRole('button', { name: 'SSH 설정 가져오기' }));
    await waitFor(() => expect(within(sites).getByText('web')).toBeTruthy());
    expect(within(sites).getAllByRole('option')).toHaveLength(2);
    expect(container.textContent).toContain('지원하지 않는 설정: ProxyJump');
    await user.click(within(sites).getByRole('button', { name: '닫기' }));

    await user.keyboard('gm');
    const locations = await screen.findByRole('dialog', { name: /위치/ });
    await user.click(within(locations).getByText('SFTP · 배포'));
    const form = await screen.findByRole('dialog', { name: '원격 연결' });
    expect((within(form).getByLabelText('호스트') as HTMLInputElement).value).toBe('deploy.example.com');
  });

  it('reconnects saved agent sites while restoring remote tabs at startup', async () => {
    const site = { id: 'site-agent', name: '에이전트', host: 'agent.example.com', port: 22, user: 'boksl', authMethod: 'agent' as const, savedSecret: false };
    const remotePath = 'sftp://boksl@agent.example.com/srv';
    const session = { sessionId: 'sftp://boksl@agent.example.com/', user: 'boksl', host: 'agent.example.com', port: 22, home: '/home/boksl', homeUrl: 'sftp://boksl@agent.example.com/home/boksl', hostKeyAlgorithm: 'ssh-ed25519', hostKeyFingerprint: 'SHA256:x', secretStored: false };
    let connected = false;
    const remoteConnect = vi.fn(async () => { connected = true; return { ok: true as const, data: session }; });
    const tab = (path: string) => ({ path, sort: { field: 'name' as const, direction: 'asc' as const, directoriesFirst: true }, filter: null, showHidden: false, historyBack: [], historyForward: [] });
    const settings = settingsFixture({
      remote: { sites: [site], keepaliveSeconds: 30, connectTimeoutSeconds: 15, linkPolicy: 'preserve' },
      session: { leftPath: null, rightPath: null, activePanel: 'right', tabs: { left: { items: [tab(SAMPLE_LISTINGS.left.path)], activeIndex: 0 }, right: { items: [tab(remotePath)], activeIndex: 0 } } },
    });
    const fixture = createFixturePanelDataSource();
    const listDir = fixture.listDir.bind(fixture);
    const dataSource = { ...fixture, loadInitialOnMount: true };
    dataSource.listDir = vi.fn(async (input) => input.path !== remotePath ? listDir(input)
      : connected ? { ok: true as const, data: createDirectoryListing(input.panelId, remotePath, [remoteEntry('restored.txt')]) }
        : { ok: false as const, error: { code: 'remote_not_connected', messageKey: 'errors.remoteNotConnected', path: session.sessionId, details: null, recoverable: true } });
    const { container } = render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub({ loadSettings: vi.fn(async () => ({ ok: true as const, data: settings })), saveSettings: vi.fn(async () => ({ ok: true as const, data: settings })) })}
      operationClient={operationClientStub()} remoteClient={remoteClientStub({ remoteConnect })} />);

    await waitFor(() => expect(remoteConnect).toHaveBeenCalledWith({ request: { siteId: 'site-agent', host: 'agent.example.com', port: 22, user: 'boksl', authMethod: 'agent' } }));
    await waitFor(() => expect(container.querySelector('.file-panel.is-active .path-input')?.textContent).toBe(remotePath));
    expect(rowByText(container, 'restored.txt')).not.toBeNull();
  });
  it('opens remote files only after the download to the app temp folder completes', async () => {
    const user = userEvent.setup();
    const startCopy = vi.fn()
      .mockResolvedValueOnce({ ok: true as const, data: { operationId: 'op-remote-open', kind: 'copy' as const, state: 'queued' as const } })
      .mockResolvedValueOnce({ ok: true as const, data: { operationId: 'op-remote-open-2', kind: 'copy' as const, state: 'queued' as const } });
    const openDefault = vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: null } }));
    const remoteOpenDir = vi.fn().mockResolvedValueOnce({ ok: true as const, data: '/tmp/BokslDirGUI-remote-open/1' })
      .mockResolvedValueOnce({ ok: true as const, data: '/tmp/BokslDirGUI-remote-open/2' });
    const listing = createDirectoryListing('right', REMOTE_DIR, [remoteEntry('remote.txt')]);
    const { container } = render(<CommanderShell dataSource={createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: listing })}
      mutationClient={mutationClientStub({ openDefault, remoteOpenDir })} operationClient={operationClientStub({ startCopy })}
      remoteClient={remoteClientStub()} initialFocusIndex={{ left: 3, right: 0 }} initialSelectedPaths={{ left: [], right: [] }} />);
    await waitFor(() => expect(focusedRowText(container)).toContain('remote.txt'));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(startCopy).toHaveBeenCalledWith({ sources: [`${REMOTE_DIR}/remote.txt`], targetDir: '/tmp/BokslDirGUI-remote-open/1', policy: 'overwrite' }));
    expect(openDefault).not.toHaveBeenCalled();
    act(() => useOperationStore.getState().applyOperationSummary({ operationId: 'op-remote-open', kind: 'copy', state: 'completed', completedFiles: 1, failedFiles: 0, skippedFiles: 0, errors: [] }));
    await waitFor(() => expect(openDefault).toHaveBeenCalledWith({ path: '/tmp/BokslDirGUI-remote-open/1/remote.txt' }));

    useOperationStore.setState({ dialog: null, progress: null, summary: null, lastError: null, activeOperationController: null });
    await user.keyboard('o');
    await waitFor(() => expect(startCopy).toHaveBeenCalledTimes(2));
    act(() => useOperationStore.getState().applyOperationSummary({ operationId: 'op-remote-open-2', kind: 'copy', state: 'cancelled', completedFiles: 0, failedFiles: 0, skippedFiles: 0, errors: [] }));
    await act(async () => {});
    expect(openDefault).toHaveBeenCalledTimes(1);
  });

  it('previews remote files and keeps remote clipboard items inside the app', async () => {
    const user = userEvent.setup();
    const previewFile = vi.fn(async () => ({ ok: true as const, data: { path: `${REMOTE_DIR}/remote.txt`, name: 'remote.txt', kind: 'text' as const, mimeType: 'text/plain', sizeBytes: 3, text: 'abc', dataUrl: null, truncated: false, limitBytes: 262144 } }));
    const writeFileClipboard = vi.fn(async () => ({ ok: true as const, data: 1 }));
    const startCopy = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-remote-paste', kind: 'copy' as const, state: 'queued' as const } }));
    const listing = createDirectoryListing('right', REMOTE_DIR, [remoteEntry('remote.txt')]);
    const { container } = render(<CommanderShell dataSource={createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: listing })}
      mutationClient={mutationClientStub({ previewFile, writeFileClipboard })} operationClient={operationClientStub({ startCopy })}
      remoteClient={remoteClientStub()} initialFocusIndex={{ left: 3, right: 0 }} initialSelectedPaths={{ left: [], right: [] }} />);
    await waitFor(() => expect(focusedRowText(container)).toContain('remote.txt'));

    await user.keyboard('{F3}');
    await waitFor(() => expect(previewFile).toHaveBeenCalledWith(expect.objectContaining({ path: `${REMOTE_DIR}/remote.txt` })));
    expect(await screen.findByText('abc')).toBeTruthy();
    await user.keyboard('{Escape}');

    await user.keyboard('{Control>}c{/Control}');
    await user.keyboard('{Tab}');
    await user.keyboard('{Control>}v{/Control}');
    await waitFor(() => expect(startCopy).toHaveBeenCalledWith({ sources: [`${REMOTE_DIR}/remote.txt`], targetDir: SAMPLE_LISTINGS.left.path, policy: 'skip' }));
    expect(writeFileClipboard).not.toHaveBeenCalled();
  });
});

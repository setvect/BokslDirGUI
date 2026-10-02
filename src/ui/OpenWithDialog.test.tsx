// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OpenWithApp } from '../domain/types';
import type { TauriResult } from '../tauri/client';
import { tauriClient } from '../tauri/client';
import { OpenWithDialog } from './OpenWithDialog';
import './testing/commanderTestSetup';
import { renderCommander, testEntry } from './testing/commanderTestSupport';

const apps: OpenWithApp[] = [
  { name: 'Xcode', path: '/Applications/Xcode.app', isDefault: true },
  { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app', isDefault: false },
];
const entry = testEntry('/tmp', '한글 data $(name).json');
const success = { ok: true as const, data: { ok: true, messageKey: null } };
const failure = { ok: false as const, error: { code: 'external_failed', messageKey: 'errors.externalCommandFailed', path: entry.path, recoverable: true, details: null } };
const clientForTest = () => ({
  ...tauriClient,
  listOpenWithApps: vi.fn(async (_input: { path: string }): Promise<TauriResult<OpenWithApp[]>> => ({ ok: true, data: apps })),
  openWithApp: vi.fn(async () => success),
});
afterEach(() => vi.restoreAllMocks());

describe('Open With', () => {
  it('opens the right-clicked file with the chosen application and restores shell focus', async () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Macintosh');
    const user = userEvent.setup();
    const client = clientForTest();
    const { container } = renderCommander(undefined, client);
    const target = screen.getByText('Architecture.md').closest('.file-row')!;
    expect(target).toBeTruthy();
    fireEvent.contextMenu(target);
    const openWithItem = await screen.findByRole('menuitem', { name: '다음으로 열기…' });
    expect(openWithItem.querySelector('kbd')).toBeNull();
    expect(screen.queryByRole('menuitem', { name: /터미널 편집기로 열기/ })).toBeNull();
    expect(screen.getByRole('menuitem', { name: '파일 위치 열기' }).querySelector('kbd')).toBeNull();
    expect(screen.getByRole('menuitem', { name: /^열기\s*Enter/ }).querySelector('kbd')?.textContent).toBe('Enter');
    await user.click(openWithItem);
    expect(await screen.findByRole('button', { name: /Xcode \(기본\)/ })).toBeTruthy();
    expect(client.listOpenWithApps.mock.calls[0][0]).toEqual(expect.objectContaining({ path: expect.stringMatching(/Architecture\.md$/) }));
    await user.type(screen.getByRole('textbox', { name: '앱 검색' }), 'visual');
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(client.openWithApp).toHaveBeenCalledWith({
      path: client.listOpenWithApps.mock.calls[0][0].path,
      applicationPath: apps[1].path,
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '다음으로 열기' })).toBeNull());
    expect(document.activeElement).toBe(container.querySelector('.commander-shell'));
  });

  it('reports a lookup failure and reloads without changing the target', async () => {
    const client = clientForTest();
    client.listOpenWithApps.mockResolvedValueOnce(failure);
    render(<OpenWithDialog entry={entry} language="ko" client={client} onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: '다시 불러오기' }));
    expect(await screen.findByRole('button', { name: /Visual Studio Code/ })).toBeTruthy();
    expect(client.listOpenWithApps).toHaveBeenLastCalledWith({ path: entry.path });
    expect(client.openWithApp).not.toHaveBeenCalled();
  });

  it('keeps the dialog open on launch failure and prevents duplicate launch requests', async () => {
    let resolve!: (result: typeof failure) => void;
    const client = { ...clientForTest(), openWithApp: vi.fn(() => new Promise<typeof failure>((done) => { resolve = done; })) };
    const close = vi.fn();
    render(<OpenWithDialog entry={entry} language="ko" client={client} onClose={close} />);
    const button = await screen.findByRole('button', { name: /Visual Studio Code/ });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(client.openWithApp).toHaveBeenCalledTimes(1);
    expect(client.openWithApp).toHaveBeenCalledWith({ path: entry.path, applicationPath: apps[1].path });
    await act(async () => resolve(failure));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(close).not.toHaveBeenCalled();
  });

  it('ignores a pending launch result after the dialog is closed', async () => {
    let resolve!: (result: typeof success) => void;
    const client = { ...clientForTest(), openWithApp: vi.fn(() => new Promise<typeof success>((done) => { resolve = done; })) };
    const close = vi.fn();
    const view = render(<OpenWithDialog entry={entry} language="ko" client={client} onClose={close} />);
    await userEvent.click(await screen.findByRole('button', { name: /Visual Studio Code/ }));
    view.unmount();
    await act(async () => resolve(success));
    expect(close).not.toHaveBeenCalled();
  });
});

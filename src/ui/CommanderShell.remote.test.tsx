// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { FileEntry } from '../domain/types';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing } from './panelState';
import { mutationClientStub, operationClientStub, remoteClientStub } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { focusedRowText, rowByText } from './testing/commanderTestSupport';

const REMOTE_DIR = 'sftp://boksl@example.com:2222/srv';

const remoteEntry = (name: string, overrides: Partial<FileEntry> = {}): FileEntry => ({
  path: `${REMOTE_DIR}/${name}`, name, kind: 'file', sizeBytes: 3, modifiedAt: null, createdAt: null,
  permissions: '-rw-r--r--', owner: 'boksl', group: 'staff', isHidden: false, isVirtual: false, ...overrides,
});

const renderRemotePanel = (operationClient = operationClientStub()) => {
  const listing = createDirectoryListing('right', REMOTE_DIR, [
    remoteEntry('remote.txt'),
    remoteEntry('logs', { kind: 'directory', sizeBytes: null, permissions: 'drwxr-xr-x' }),
  ]);
  const dataSource = createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: listing });
  return render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub()} operationClient={operationClient}
    remoteClient={remoteClientStub()} initialFocusIndex={{ right: 0 }} initialSelectedPaths={{ left: [], right: [] }} />);
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
    expect(within(menu).queryByRole('menuitem', { name: /기본 앱으로 열기/ })).toBeNull();
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
});

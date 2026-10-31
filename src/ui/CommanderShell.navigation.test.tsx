// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DirectoryChanged, RemoteConnectionChanged } from '../domain/types';
import { useOperationStore } from '../operations/operationStore';
import type { ListDirInput } from '../tauri/client';
import { INITIAL_FOCUS_INDEX, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import type { PanelDataSource } from './panelDataSource';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing, DEFAULT_SORT } from './panelState';
import { mutationClientStub, operationClientStub, remoteClientStub, settingsFixture } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { activePanelLabel, emptyListings, focusedRow, focusedRowText, mockedPanelDataSource, renderCommander, rowByText, testEntry } from './testing/commanderTestSupport';

describe('CommanderShell navigation', () => {

  it('watches real panel directories and refreshes only for the current watch version', async () => {
    const dataSource = createFixturePanelDataSource();
    let notify: ((event: DirectoryChanged) => void) | null = null;
    dataSource.watchPath = vi.fn(async (input) => ({ ok: true as const, data: { ...input, version: input.panelId === 'left' ? 11 : 12 } }));
    dataSource.unwatchPath = vi.fn(async () => ({ ok: true as const, data: undefined }));
    dataSource.listenDirectoryChanges = vi.fn(async (handler) => { notify = handler; return () => undefined; });
    const listDir = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await waitFor(() => expect(dataSource.watchPath).toHaveBeenCalledWith({ panelId: 'right', path: SAMPLE_LISTINGS.right.path }));
    await waitFor(() => expect(notify).not.toBeNull());
    await act(async () => {});
    listDir.mockClear();
    act(() => notify!({ panelId: 'right', path: SAMPLE_LISTINGS.right.path, version: 11 }));
    expect(listDir).not.toHaveBeenCalled();
    act(() => notify!({ panelId: 'right', path: SAMPLE_LISTINGS.right.path, version: 12 }));
    await waitFor(() => expect(listDir).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right', path: SAMPLE_LISTINGS.right.path })));
  });

  it('does not watch remote panels and shows their connection state in the header', async () => {
    const remotePath = 'sftp://boksl@example.com:2222/srv';
    const dataSource = createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: createDirectoryListing('right', remotePath, [testEntry(remotePath, 'remote.txt')]) });
    dataSource.watchPath = vi.fn(async (input) => ({ ok: true as const, data: { ...input, version: 1 } }));
    dataSource.unwatchPath = vi.fn(async () => ({ ok: true as const, data: undefined }));
    dataSource.listenDirectoryChanges = vi.fn(async () => () => undefined);
    let changed: ((event: RemoteConnectionChanged) => void) | null = null;
    const session = { sessionId: 'sftp://boksl@example.com:2222/', user: 'boksl', host: 'example.com', port: 2222, home: '/home/boksl', homeUrl: 'sftp://boksl@example.com:2222/home/boksl', hostKeyAlgorithm: 'ssh-ed25519', hostKeyFingerprint: 'SHA256:x', secretStored: false };
    const remoteClient = remoteClientStub({
      remoteSessions: vi.fn(async () => ({ ok: true as const, data: [session] })),
      listenRemoteConnectionChanges: vi.fn(async (handler: (event: RemoteConnectionChanged) => void) => { changed = handler; return () => undefined; }),
    });
    const { container } = render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub()} operationClient={operationClientStub()} remoteClient={remoteClient} />);

    await waitFor(() => expect(dataSource.watchPath).toHaveBeenCalledWith({ panelId: 'left', path: SAMPLE_LISTINGS.left.path }));
    expect(dataSource.watchPath).not.toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right' }));
    await waitFor(() => expect(container.querySelector('.remote-chip')?.textContent).toBe('SFTP 연결됨'));
    act(() => changed!({ sessionId: session.sessionId, state: 'lost', error: null }));
    expect(container.querySelector('.remote-chip')?.textContent).toBe('SFTP 연결 끊김');
    expect(container.querySelector('.remote-chip')?.className).toContain('is-lost');
    act(() => changed!({ sessionId: session.sessionId, state: 'disconnected', error: null }));
    expect(container.querySelector('.remote-chip')?.textContent).toBe('SFTP 연결 안 됨');
    expect(container.querySelectorAll('.remote-chip')).toHaveLength(1);
  });

  it('passes the active real directory as the base for home and relative path input', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    dataSource.gotoPath = vi.fn(async (input) => ({ ok: true as const, data: createDirectoryListing(input.panelId, `${input.base}/${input.path}`, []) }));
    renderCommander(dataSource);

    await user.keyboard('gp');
    const input = screen.getByRole('textbox', { name: '경로' });
    await user.clear(input);
    await user.type(input, '../문서 폴더');
    await user.click(screen.getByRole('button', { name: '이동' }));

    await waitFor(() => expect(dataSource.gotoPath).toHaveBeenCalledWith({ panelId: 'right', path: '../문서 폴더', base: SAMPLE_LISTINGS.right.path }));
  });

  it('keeps an invalid path in the prompt and leaves the panel listing unchanged until a valid path succeeds', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const previousPath = SAMPLE_LISTINGS.right.path;
    dataSource.gotoPath = vi.fn(async (input) => input.path === '/missing/directory'
      ? { ok: false as const, error: { code: 'not_found', messageKey: 'errors.notFound', path: input.path, details: null, recoverable: true } }
      : { ok: true as const, data: createDirectoryListing(input.panelId, input.path, [testEntry(input.path, 'arrived.txt')]) });
    const { container } = renderCommander(dataSource);

    await user.keyboard('gp');
    const input = screen.getByRole('textbox', { name: '경로' });
    await user.clear(input);
    await user.click(screen.getByRole('button', { name: '이동' }));
    expect(screen.getByRole('alert').textContent).toBe('경로를 입력하세요.');
    await user.type(input, '/missing/directory');
    expect(screen.queryByRole('alert')).toBeNull();
    await user.click(screen.getByRole('button', { name: '이동' }));

    const dialog = await screen.findByRole('dialog', { name: '경로 이동' });
    expect(within(dialog).getByRole('alert').textContent).toBe('파일이나 폴더를 찾을 수 없습니다.');
    expect(input).toHaveProperty('value', '/missing/directory');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(activePanelLabel(container)).toContain(previousPath);
    expect(container.querySelector('.file-panel.is-active .file-table-message')).toBeNull();
    expect(container.querySelector('.file-panel.is-active .path-input')?.textContent).toBe(previousPath);

    await user.clear(input);
    await user.type(input, '/tmp/valid-directory');
    expect(within(dialog).queryByRole('alert')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: '이동' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '경로 이동' })).toBeNull());
    expect(activePanelLabel(container)).toContain('/tmp/valid-directory');
    expect(screen.getByText('arrived.txt')).toBeTruthy();
  });

  it.each(['keyboard', 'View menu'])('closes the Go To Path prompt opened from the %s with one Escape and keeps row keys working', async (openedFrom) => {
    const user = userEvent.setup();
    const { container } = renderCommander(createFixturePanelDataSource());

    if (openedFrom === 'keyboard') {
      await user.keyboard('gp');
    } else {
      await user.click(screen.getByRole('button', { name: '이동(G)' }));
      await user.click(within(await screen.findByRole('menu', { name: '이동(G) menu' })).getByRole('menuitem', { name: /^경로 이동/ }));
    }
    expect(await screen.findByRole('dialog', { name: '경로 이동' })).toBeTruthy();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '경로 이동' })).toBeNull());
    const focusedBefore = focusedRowText(container);
    await user.keyboard('{ArrowDown}');
    expect(focusedRowText(container)).not.toBe(focusedBefore);
  });

  it('keeps the current rows visible when opening a directory fails', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    dataSource.listDir = vi.fn(async (input) => ({
      ok: false as const,
      error: { code: 'not_found', messageKey: 'errors.notFound', path: input.path, details: null, recoverable: true },
    }));
    const { container } = renderCommander(dataSource);
    const previousPath = SAMPLE_LISTINGS.right.path;
    const focusedBefore = focusedRowText(container);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('목록 읽기 실패'));
    expect(activePanelLabel(container)).toContain(previousPath);
    expect(focusedRowText(container)).toBe(focusedBefore);
    expect(container.querySelector('.file-panel.is-active .file-table-message')).toBeNull();
  });

  it('restores the previous filter when loading a filtered listing fails', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    dataSource.listDir = vi.fn(async (input) => ({
      ok: false as const,
      error: { code: 'not_found', messageKey: 'errors.notFound', path: input.path, details: null, recoverable: true },
    }));
    const { container } = renderCommander(dataSource);
    const focusedBefore = focusedRowText(container);

    await user.keyboard('/');
    await user.type(screen.getByRole('textbox', { name: '필터 패턴' }), 'missing');
    await user.click(screen.getByRole('button', { name: '필터 적용' }));

    await waitFor(() => expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('목록 읽기 실패'));
    expect(container.querySelector('.file-panel.is-active .filter-chip')).toBeNull();
    expect(container.querySelector('.file-panel.is-active .panel-filter-status')).toBeNull();
    expect(focusedRowText(container)).toBe(focusedBefore);
  });

  it('ignores a pending path result after the prompt is cancelled', async () => {
    const user = userEvent.setup();
    let finish!: (result: Awaited<ReturnType<PanelDataSource['gotoPath']>>) => void;
    const dataSource = createFixturePanelDataSource();
    dataSource.gotoPath = vi.fn(() => new Promise<Awaited<ReturnType<PanelDataSource['gotoPath']>>>((resolve) => { finish = resolve; }));
    const { container } = renderCommander(dataSource);
    const previousPath = SAMPLE_LISTINGS.right.path;

    await user.keyboard('gp');
    const input = screen.getByRole('textbox', { name: '경로' });
    await user.clear(input);
    await user.type(input, '/tmp/late-directory');
    await user.click(screen.getByRole('button', { name: '이동' }));
    expect(screen.getByRole('button', { name: '이동' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '경로 이동' })).toBeNull();

    await act(async () => { finish({ ok: true, data: createDirectoryListing('right', '/tmp/late-directory') }); });
    expect(activePanelLabel(container)).toContain(previousPath);
    expect(container.querySelector('.file-panel.is-active .path-input')?.textContent).toBe(previousPath);
  });

  it('virtualizes a 10,000-entry directory while preserving End-key navigation', async () => {
    const entries = Array.from({ length: 10_000 }, (_, index) =>
      testEntry('/large', `entry-${String(index).padStart(5, '0')}.txt`),
    );
    const dataSource = createFixturePanelDataSource({
      left: createDirectoryListing('left', '/empty', []),
      right: createDirectoryListing('right', '/large', entries),
    });
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [] }}
      />,
    );
    const shell = screen.getByRole('application', { name: '복슬Dir file commander shell' });
    const activeTable = container.querySelector<HTMLElement>('.file-panel.is-active [role="table"]');

    expect(activeTable?.getAttribute('aria-rowcount')).toBe('10000');
    expect(container.querySelectorAll('.file-panel.is-active .file-row').length).toBeLessThan(100);

    shell.focus();
    fireEvent.keyDown(document, { key: 'End' });

    await waitFor(() => expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-9999'));
    expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('entry-09999.txt');
    expect(container.querySelectorAll('.file-panel.is-active .file-row').length).toBeLessThan(100);
  });

  it('opens the focused entry with Enter using the commander action path', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const { container } = renderCommander(dataSource);

    await user.keyboard('{Enter}');

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('generic-array-6de08afde610f112');
    await waitFor(() => expect(focusedRowText(container)).toContain('README.md'));
    expect(
      screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant'),
    ).toBe('commander-row-right-1');
    expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path,
      showHidden: false,
      filter: null,
    }));
  });

  it('focuses the directory exited from when Enter opens the virtual parent row', async () => {
    const user = userEvent.setup();
    const parentPath = SAMPLE_LISTINGS.right.entries[0].path;
    const childPath = SAMPLE_LISTINGS.right.path;
    const parentListing = createDirectoryListing(
      'right',
      parentPath,
      [
        {
          path: '/demo/BokslDir/target',
          name: '..',
          kind: 'directory' as const,
          sizeBytes: null,
          modifiedAt: null,
          createdAt: null,
          permissions: null,
          owner: null,
          group: null,
          isHidden: false,
          isVirtual: true,
        },
        {
          ...testEntry(parentPath, 'build'),
          kind: 'directory' as const,
          sizeBytes: null,
          permissions: 'drwxr-xr-x',
        },
        {
          ...testEntry(parentPath, 'deps'),
          kind: 'directory' as const,
          sizeBytes: null,
          permissions: 'drwxr-xr-x',
        },
      ],
      DEFAULT_SORT,
      null,
      12,
    );
    const dataSource = createFixturePanelDataSource(SAMPLE_LISTINGS, { [parentPath]: parentListing });
    const { container } = renderCommander(dataSource);

    await user.keyboard('gg');
    expect(focusedRowText(container)).toContain('..');

    await user.keyboard('{Enter}');

    await waitFor(() => expect(activePanelLabel(container)).toContain(parentPath));
    expect(focusedRowText(container)).toContain('build');
    expect(screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-1');
    expect(focusedRow(container)?.className).not.toContain('is-selected');
    expect(focusedRow(container)?.textContent).not.toContain('deps');
    expect(childPath).toBe(`${parentPath}/build`);
  });

  it('opens directory rows by double-click and lets virtual parent rows navigate only', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const childRow = rowByText(container, 'generic-array-6de08afde610f112');

    if (!childRow) {
      throw new Error('child directory row is required');
    }
    await user.dblClick(childRow);
    expect(await screen.findByText('README.md')).toBeTruthy();

    const parentRow = rowByText(container, '..');
    if (!parentRow) {
      throw new Error('virtual parent row is required');
    }
    await user.dblClick(parentRow);
    await waitFor(() => expect(activePanelLabel(container)).toContain(SAMPLE_LISTINGS.right.path));
  });

  it.each(['double-click', 'Enter'] as const)('opens a directory symlink inside the active panel with %s', async (method) => {
    const user = userEvent.setup();
    const link = {
      ...testEntry('/tmp/home', 'IdeaProjects'),
      kind: 'symlink' as const,
      symlinkTargetIsDirectory: true,
      sizeBytes: null,
    };
    const initial = {
      left: SAMPLE_LISTINGS.left,
      right: createDirectoryListing('right', '/tmp/home', [link]),
    };
    const targetListing = createDirectoryListing('right', '/tmp/projects', [testEntry('/tmp/projects', 'inside.txt')]);
    const dataSource = createFixturePanelDataSource(initial);
    const listDir = dataSource.listDir;
    dataSource.listDir = vi.fn(async (input) => input.path === link.path
      ? { ok: true as const, data: targetListing }
      : listDir(input));
    const openDefault = vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } }));
    const { container } = renderCommander(dataSource, mutationClientStub({ openDefault }));
    const linkRow = rowByText(container, 'IdeaProjects');
    if (!linkRow) throw new Error('directory link row is required');

    if (method === 'double-click') {
      await user.dblClick(linkRow);
    } else {
      await user.click(linkRow);
      await user.keyboard('{Enter}');
    }

    await waitFor(() => expect(activePanelLabel(container)).toContain('/tmp/projects'));
    expect(screen.getByText('inside.txt')).toBeTruthy();
    expect(dataSource.listDir).toHaveBeenCalledWith(expect.objectContaining({ path: link.path, panelId: 'right' }));
    expect(openDefault).not.toHaveBeenCalled();
  });

  it('opens a file symlink with its default app', async () => {
    const user = userEvent.setup();
    const link = {
      ...testEntry('/tmp/home', 'document-link'),
      kind: 'symlink' as const,
      symlinkTargetIsDirectory: false,
      sizeBytes: null,
    };
    const initial = {
      left: SAMPLE_LISTINGS.left,
      right: createDirectoryListing('right', '/tmp/home', [link]),
    };
    const dataSource = createFixturePanelDataSource(initial);
    const openDefault = vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } }));
    const { container } = renderCommander(dataSource, mutationClientStub({ openDefault }));
    const linkRow = rowByText(container, 'document-link');
    if (!linkRow) throw new Error('file link row is required');

    await user.dblClick(linkRow);

    await waitFor(() => expect(openDefault).toHaveBeenCalledWith({ path: link.path }));
    expect(activePanelLabel(container)).toContain('/tmp/home');
  });

  it('keeps per-panel history and parent navigation on the listDir path', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('{Enter}');
    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('generic-array-6de08afde610f112');

    fireEvent.keyDown(document, { key: 'ArrowLeft', altKey: true });
    await waitFor(() => expect(activePanelLabel(document.body)).toContain(SAMPLE_LISTINGS.right.path));

    fireEvent.keyDown(document, { key: 'ArrowRight', altKey: true });
    await waitFor(() => expect(activePanelLabel(document.body)).toContain('generic-array-6de08afde610f112'));

    fireEvent.keyDown(document, { key: 'Backspace' });
    await waitFor(() => expect(activePanelLabel(document.body)).toContain(SAMPLE_LISTINGS.right.path));
    expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ path: SAMPLE_LISTINGS.right.path }));
  });

  it('applies typed filters and preserves them through refresh until clear', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('/');
    const input = await screen.findByLabelText('필터 패턴');
    await user.type(input, 'generic');
    await user.click(screen.getByRole('button', { name: '필터 적용' }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'generic' })));
    expect(screen.getAllByText('필터: generic').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.filter-chip')?.textContent).toContain('필터 generic');
    expect(document.querySelector('.filter-match')?.textContent?.toLowerCase()).toBe('generic');

    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'generic' })));

    await user.keyboard('/');
    await user.click(await screen.findByRole('button', { name: '필터 해제' }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: null })));
    expect(screen.queryByText('필터: generic')).toBeNull();
  });

  it('keeps filter indicators in sync from panel state while listDir is pending', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const pending: Array<{
      input: ListDirInput;
      resolve(result: Awaited<ReturnType<PanelDataSource['listDir']>>): void;
    }> = [];
    vi.spyOn(dataSource, 'listDir').mockImplementation((input) => new Promise((resolve) => {
      pending.push({ input, resolve });
    }));
    renderCommander(dataSource);

    await user.keyboard('/');
    await user.type(await screen.findByLabelText('필터 패턴'), 'generic');
    await user.click(screen.getByRole('button', { name: '필터 적용' }));

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.getAllByText('필터: generic').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.filter-chip')?.textContent).toContain('필터 generic');

    act(() => pending[0].resolve({
      ok: true,
      data: createDirectoryListing('right', SAMPLE_LISTINGS.right.path, [
        testEntry(SAMPLE_LISTINGS.right.path, 'generic-match.txt'),
      ], pending[0].input.sort, pending[0].input.filter, 14),
    }));
    await waitFor(() => expect(rowByText(document.body, 'generic-match.txt')).not.toBeNull());
  });

  it('passes sort, hidden, and refresh state through listDir', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('ss');
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      sort: expect.objectContaining({ field: 'size', direction: 'asc' }),
    })));

    await user.keyboard('sr');
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      sort: expect.objectContaining({ field: 'size', direction: 'desc' }),
    })));

    await user.keyboard('.');
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ showHidden: true })));

    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: SAMPLE_LISTINGS.right.path,
      showHidden: true,
      sort: expect.objectContaining({ field: 'size', direction: 'desc' }),
    })));
  });

  it('ignores stale async navigation results that resolve after a newer request', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const pending: Array<{
      input: ListDirInput;
      resolve(result: Awaited<ReturnType<PanelDataSource['listDir']>>): void;
    }> = [];
    vi.spyOn(dataSource, 'listDir').mockImplementation((input) => new Promise((resolve) => {
      pending.push({ input, resolve });
    }));
    renderCommander(dataSource);

    await user.keyboard('{Enter}');
    await waitFor(() => expect(pending).toHaveLength(1));

    fireEvent.keyDown(document, { key: 'Backspace' });
    await waitFor(() => expect(pending).toHaveLength(2));

    act(() => pending[0].resolve({
      ok: true,
      data: createDirectoryListing('right', pending[0].input.path, [testEntry(pending[0].input.path, 'stale-child.txt')], pending[0].input.sort, pending[0].input.filter, 10),
    }));
    await waitFor(() => expect(screen.queryByText('stale-child.txt')).toBeNull());

    act(() => pending[1].resolve({
      ok: true,
      data: createDirectoryListing('right', pending[1].input.path, [testEntry(pending[1].input.path, 'fresh-parent.txt')], pending[1].input.sort, pending[1].input.filter, 11),
    }));
    expect(await screen.findByText('fresh-parent.txt')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain(pending[1].input.path);
  });

  it('swaps complete left and right panel navigation states with ts', async () => {
    const user = userEvent.setup();
    renderCommander(createFixturePanelDataSource());
    const leftPath = SAMPLE_LISTINGS.left.path;
    const rightPath = SAMPLE_LISTINGS.right.path;

    await user.keyboard('ts');

    expect(screen.getByRole('region', { name: `left panel ${rightPath}` })).toBeTruthy();
    expect(screen.getByRole('region', { name: `right panel ${leftPath}` })).toBeTruthy();
  });

  it('uses h and l aliases for parent navigation and directory entry', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('l');
    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('generic-array-6de08afde610f112');

    await user.keyboard('h');
    await waitFor(() => expect(activePanelLabel(document.body)).toContain(SAMPLE_LISTINGS.right.path));
    expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    }));
  });

  it('ignores stale async location palette results', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const pending: Array<(result: Awaited<ReturnType<PanelDataSource['listLocations']>>) => void> = [];
    vi.spyOn(dataSource, 'listLocations').mockImplementation(() => new Promise((resolve) => {
      pending.push(resolve);
    }));
    renderCommander(dataSource);

    await user.keyboard('gm');
    await waitFor(() => expect(pending).toHaveLength(1));

    await user.keyboard('gm');
    await waitFor(() => expect(pending).toHaveLength(2));

    act(() => pending[0]({
      ok: true,
      data: { home: '/stale', roots: ['/stale-root'], recent: ['/stale-recent'], bookmarks: [] },
    }));
    expect(screen.queryByRole('dialog', { name: '위치 목록' })).toBeNull();

    act(() => pending[1]({
      ok: true,
      data: { home: '/fresh', roots: ['/fresh-root'], recent: ['/fresh-recent'], bookmarks: [] },
    }));

    const locationsDialog = await screen.findByRole('dialog', { name: '위치 목록' });
    expect(within(locationsDialog).getByText('/fresh')).toBeTruthy();
    expect(within(locationsDialog).queryByText('/stale')).toBeNull();
  });

  it('restores saved session panel paths and persists later navigation paths', async () => {
    const loadSettings = vi.fn(async () => ({
      ok: true as const,
      data: settingsFixture({ session: { leftPath: '/saved/left', rightPath: '/saved-right', activePanel: 'left' as const } }),
    }));
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: settingsFixture({ session: patch.session ?? { leftPath: '/saved/left', rightPath: '/saved-right', activePanel: 'left' as const } }),
    }));
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: true,
      initial: emptyListings('/boot-left', '/boot-right'),
    });

    render(<CommanderShell dataSource={dataSource} mutationClient={mutationClientStub({ loadSettings, saveSettings })} />);

    await waitFor(() => expect(dataSource.listDir).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'left', path: '/saved/left' })));
    expect(dataSource.listDir).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right', path: '/saved-right' }));
    expect(dataSource.loadInitialListings).not.toHaveBeenCalled();
    expect(await screen.findAllByText('child.txt')).toHaveLength(2);
    expect(activePanelLabel(document.body)).toContain('left panel');

    await userEvent.setup().keyboard('h');
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({
        session: expect.objectContaining({ activePanel: 'left', leftPath: '/saved' }),
      }),
    }));
  });

  describe('review: navigation and persistence races', () => {
    it('loads initial listings under StrictMode effect replay', async () => {
      const dataSource = mockedPanelDataSource({
        loadInitialOnMount: true,
        initial: emptyListings('/boot-left', '/boot-right'),
        loadResult: {
          left: createDirectoryListing('left', '/real-left', [testEntry('/real-left', 'strict-left.txt')]),
          right: createDirectoryListing('right', '/real-right', [testEntry('/real-right', 'strict-right.txt')]),
        },
      });
      render(<StrictMode><CommanderShell dataSource={dataSource} mutationClient={mutationClientStub()} /></StrictMode>);
      expect(await screen.findByText('strict-left.txt')).toBeTruthy();
      expect(await screen.findByText('strict-right.txt')).toBeTruthy();
    });

    it('refreshes current paths after copy without switching the active panel or stealing input focus', async () => {
      const dataSource = createFixturePanelDataSource();
      const listDir = vi.spyOn(dataSource, 'listDir');
      const operationClient = operationClientStub({
        startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'review-path', kind: 'copy' as const, state: 'queued' as const } })),
      });
      const { container } = renderCommander(dataSource, mutationClientStub(), operationClient);
      await userEvent.setup().keyboard('y');
      await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalled());
      await userEvent.setup().keyboard('h');
      await waitFor(() => expect(listDir).toHaveBeenCalled());
      const currentRightPath = listDir.mock.calls.at(-1)![0].path;
      expect(currentRightPath).not.toBe(SAMPLE_LISTINGS.right.path);
      listDir.mockClear();
      const input = document.createElement('input');
      document.body.append(input);
      input.focus();
      const activeBefore = activePanelLabel(container);
      act(() => useOperationStore.getState().applyOperationSummary({
        operationId: 'review-path', kind: 'copy', state: 'completed',
        completedFiles: 1, failedFiles: 0, errors: []
      }));
      await waitFor(() => expect(listDir).toHaveBeenCalledTimes(2));
      expect(listDir).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right', path: currentRightPath }));
      expect(activePanelLabel(container)).toBe(activeBefore);
      expect(document.activeElement).toBe(input);
      input.remove();
    });

    it('serializes settings saves and keeps newer optimistic zoom while an old save finishes', async () => {
      type Settings = import('../domain/types').Settings;
      const pending: Array<{ patch: Partial<Settings>; resolve: (value: { ok: true; data: Settings }) => void }> = [];
      const saveSettings = vi.fn(({ patch }: { patch: Partial<Settings> }) => new Promise<{ ok: true; data: Settings }>((resolve) => {
        pending.push({ patch, resolve });
      }));
      const { container } = renderCommander(createFixturePanelDataSource(), mutationClientStub({ saveSettings }));
      fireEvent.keyDown(document, { key: '=', metaKey: true });
      await waitFor(() => expect(pending).toHaveLength(1));
      fireEvent.keyDown(document, { key: '=', metaKey: true });
      expect(saveSettings).toHaveBeenCalledTimes(1);
      const settings = settingsFixture({ view: { zoomStep: 1, density: 'compact', showIcons: true } });
      await act(async () => pending[0].resolve({ ok: true, data: settings }));
      await waitFor(() => expect(pending).toHaveLength(2));
      expect(pending[1].patch.view?.zoomStep).toBe(2);
      expect(container.querySelector('.commander-shell')?.getAttribute('style')).toContain('1.25');
      await act(async () => pending[1].resolve({ ok: true, data: { ...settings, view: { ...settings.view, zoomStep: 2 } } }));
    });
  });

  describe('review: independent tabs and large listings', () => {
    it('restores a tab selection and closes the active tab instead of the last one', async () => {
      const user = userEvent.setup();
      const { container } = renderCommander(createFixturePanelDataSource(), mutationClientStub());
      const originalPath = activePanelLabel(container);
      const originalSelected = container.querySelectorAll('.file-panel.is-active .file-row[aria-selected="true"]').length;
      await user.keyboard('tn');
      await user.keyboard('h');
      await waitFor(() => expect(activePanelLabel(container)).not.toBe(originalPath));
      const secondPath = activePanelLabel(container);
      await user.keyboard('tt');
      const firstTab = await screen.findByRole('button', { name: /^1\./ });
      await user.click(firstTab);
      expect(activePanelLabel(container)).toBe(originalPath);
      expect(container.querySelectorAll('.file-panel.is-active .file-row[aria-selected="true"]')).toHaveLength(originalSelected);
      await user.keyboard('tx');
      expect(activePanelLabel(container)).toBe(secondPath);
      await user.keyboard('tx');
      expect(activePanelLabel(container)).toBe(secondPath);
    });

  });
});

it('ignores a pending listing response after its tab has been closed', async () => {
  const user = userEvent.setup();
  const dataSource = createFixturePanelDataSource();
  const pending: Array<{ input: ListDirInput; resolve(result: Awaited<ReturnType<PanelDataSource['listDir']>>): void }> = [];
  vi.spyOn(dataSource, 'listDir').mockImplementation((input) => new Promise((resolve) => pending.push({ input, resolve })));
  const { container } = renderCommander(dataSource);
  const originalPath = activePanelLabel(container);
  const originalFocus = focusedRowText(container);
  await user.keyboard('tn');
  await user.keyboard('{Enter}');
  expect(pending).toHaveLength(1);
  await user.keyboard('tx');
  expect(activePanelLabel(container)).toBe(originalPath);
  await act(async () => pending[0].resolve({
    ok: true,
    data: createDirectoryListing('right', pending[0].input.path, [testEntry(pending[0].input.path, 'closed-tab-response.txt')]),
  }));
  expect(screen.queryByText('closed-tab-response.txt')).toBeNull();
  expect(activePanelLabel(container)).toBe(originalPath);
  expect(focusedRowText(container)).toBe(originalFocus);
});

// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FileEntry, PanelId, Settings } from '../domain/types';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource, type PanelDataSource } from './panelDataSource';
import { createDirectoryListing, parentPathOf } from './panelState';
import { mutationClientStub, operationClientStub, settingsFixture } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { testEntry } from './testing/fileEntryFixture';

// 디스크 흉내: 폴더마다 하위 폴더(숨김 포함)
const FOLDERS: Record<string, string[]> = {
  '/': ['/work'],
  '/work': ['/work/.git', '/work/app', '/work/docs'],
  '/work/.git': [],
  '/work/app': ['/work/app/src'],
  '/work/app/src': [],
  '/work/docs': [],
  'sftp://me@host/': ['sftp://me@host/home'],
  'sftp://me@host/home': ['sftp://me@host/home/me'],
  'sftp://me@host/home/me': [],
};

const nameOf = (path: string) => path.split('/').filter(Boolean).at(-1) ?? path;
const folder = (path: string): FileEntry => ({
  ...testEntry(parentPathOf(path), nameOf(path)),
  path,
  kind: 'directory',
  sizeBytes: null,
  permissions: 'drwxr-xr-x',
  isHidden: nameOf(path).startsWith('.'),
});
// 패널 목록은 숨김 폴더 없이(숨김 파일 꺼짐)
const listingOf = (panelId: PanelId, path: string, folders = FOLDERS) => createDirectoryListing(panelId, path, [
  ...(path === '/' ? [] : [{ ...folder(parentPathOf(path)), name: '..', isVirtual: true }]),
  ...(folders[path] ?? []).filter((child) => !nameOf(child).startsWith('.')).map(folder),
  { ...testEntry(path === '/' ? '' : path, 'README.md') },
]);

const panelOf = (panelId: PanelId) => document.querySelector<HTMLElement>(`.file-panel[data-panel-id="${panelId}"]`)!;
const treeOf = (panelId: PanelId) => panelOf(panelId).querySelector<HTMLElement>('.folder-tree');
const treeRows = (panelId: PanelId) => [...panelOf(panelId).querySelectorAll<HTMLElement>('.folder-tree-row')];
const treeLines = (panelId: PanelId) => treeRows(panelId)
  .map((row) => `${'  '.repeat(Number(row.getAttribute('aria-level')) - 1)}${row.querySelector('.folder-tree-name')?.textContent}`);
const treeRow = (panelId: PanelId, name: string) =>
  treeRows(panelId).find((row) => row.querySelector('.folder-tree-name')?.textContent === name) ?? null;
const panelPath = (panelId: PanelId) => panelOf(panelId).querySelector('.path-input')?.textContent;

const setup = ({ treeVisible = { left: true, right: false }, leftPath = '/work/app', roots = ['/'], folders = FOLDERS }: {
  treeVisible?: Record<PanelId, boolean>;
  leftPath?: string;
  // 위치 목록의 맨 위 항목(macOS는 `/`와 `/Volumes/…` 볼륨)
  roots?: string[];
  folders?: Record<string, string[]>;
} = {}) => {
  const listings = { left: listingOf('left', leftPath, folders), right: listingOf('right', '/work/docs', folders) };
  const overrides = Object.fromEntries(Object.keys(folders).map((path) => [path, listingOf('left', path, folders)]));
  const listSubdirs = vi.fn(async ({ path }: { path: string }) => ({
    ok: true as const,
    data: { path, entries: (folders[path] ?? []).map(folder) },
  }));
  const listLocations = vi.fn(async () => ({ ok: true as const, data: { home: '/work', roots, recent: [], bookmarks: [] } }));
  const dataSource: PanelDataSource = { ...createFixturePanelDataSource(listings, overrides), listSubdirs, listLocations };
  const readListing = dataSource.listDir.bind(dataSource);
  const listDir = vi.spyOn(dataSource, 'listDir');
  const settings = settingsFixture({
    layout: {
      singlePanel: false,
      ratio: '50:50',
      folderTree: { left: { visible: treeVisible.left, width: 220 }, right: { visible: treeVisible.right, width: 220 } },
    },
    session: { leftPath: null, rightPath: null, activePanel: 'left' },
  });
  // 백엔드처럼 저장된 설정에 패치를 누적(세션 저장 등 다른 패치가 트리 설정을 되돌리지 않음)
  let stored = settings;
  const saveSettings = vi.fn(async ({ patch }: { patch: Partial<Settings> }) => {
    stored = { ...stored, ...patch, layout: { ...stored.layout, ...patch.layout } };
    return { ok: true as const, data: stored };
  });
  const loadSettings = vi.fn(async () => ({ ok: true as const, data: settings }));
  const operationClient = operationClientStub({
    startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'tree-copy', kind: 'copy' as const, state: 'queued' as const } })),
    startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'tree-move', kind: 'move' as const, state: 'queued' as const } })),
  });
  render(
    <CommanderShell
      dataSource={dataSource}
      mutationClient={mutationClientStub({ loadSettings, saveSettings })}
      operationClient={operationClient}
      initialFocusIndex={{ left: 2, right: 1 }}
      initialSelectedPaths={{ left: [], right: [] }}
      runtimeBackendAvailable
    />,
  );
  // 시작 때 읽는 설정이 반영된 뒤 조작(실제 앱도 설정을 먼저 읽음)
  const settingsLoaded = () => act(async () => {
    await loadSettings.mock.results[0]?.value;
  });
  return { listSubdirs, listDir, readListing, saveSettings, operationClient, settingsLoaded };
};

describe('CommanderShell folder tree (FR-42)', () => {
  const originalElementFromPoint = document.elementFromPoint;
  afterEach(() => {
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
  });

  it('shows each panel tree independently from its path bar button and t r, and saves visibility', async () => {
    const user = userEvent.setup();
    const { saveSettings, settingsLoaded } = setup({ treeVisible: { left: false, right: false } });
    await settingsLoaded();
    expect(treeOf('left')).toBeNull();

    await user.click(within(panelOf('right')).getByRole('button', { name: '폴더 트리' }));
    await waitFor(() => expect(treeOf('right')).not.toBeNull());
    expect(treeOf('left')).toBeNull();
    expect(within(panelOf('right')).getByRole('button', { name: '폴더 트리' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('폴더 트리 · 오른쪽 · 켜짐')).toBeTruthy();
    expect(saveSettings).toHaveBeenLastCalledWith({ patch: { layout: expect.objectContaining({
      folderTree: { left: { visible: false, width: 220 }, right: { visible: true, width: 220 } },
    }) } });

    fireEvent.mouseDown(panelOf('left'));
    await user.keyboard('tr');
    await waitFor(() => expect(treeOf('left')).not.toBeNull());
    await user.keyboard('tr');
    await waitFor(() => expect(treeOf('left')).toBeNull());
    expect(treeOf('right')).not.toBeNull();
  });

  it('reveals the panel folder, reads only the expanded ancestors and fills the current folder from the panel listing', async () => {
    const user = userEvent.setup();
    const { listSubdirs } = setup();
    await waitFor(() => expect(treeLines('left')).toEqual(['/', '  work', '    app', '    docs']));
    expect(listSubdirs.mock.calls.map(([input]) => input.path).sort()).toEqual(['/', '/work']);
    const app = treeRow('left', 'app')!;
    expect(app.getAttribute('aria-selected')).toBe('true');
    // 현재 폴더의 하위 폴더(src)는 패널 목록에서 채워 펼칠 수 있음
    expect(app.getAttribute('aria-expanded')).toBe('false');

    // 숨김 파일을 켜면 읽어 둔 숨김 폴더 표시
    await user.keyboard('.');
    await waitFor(() => expect(treeLines('left')).toEqual(['/', '  work', '    .git', '    app', '    docs']));
  });

  it('moves in the tree with the keyboard, follows the cursor after a pause and gives the keyboard back to the list', async () => {
    const user = userEvent.setup();
    const { listDir } = setup();
    await waitFor(() => expect(treeRow('left', 'docs')).toBeTruthy());

    await user.keyboard('gt');
    expect(treeOf('left')!.className).toContain('is-focused');
    expect(panelOf('left').className).toContain('is-tree-focused');
    const shell = document.querySelector('.commander-shell')!;
    expect(document.getElementById(shell.getAttribute('aria-activedescendant')!)?.textContent).toContain('app');

    await user.keyboard('{ArrowDown}');
    expect(treeRow('left', 'docs')!.className).toContain('is-cursor');
    await waitFor(() => expect(panelPath('left')).toBe('/work/docs'));

    // 연달아 움직이면 멈춘 폴더만 읽음
    listDir.mockClear();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    await waitFor(() => expect(panelPath('left')).toBe('/work'));
    expect(listDir.mock.calls.map(([input]) => input.path)).toEqual(['/work']);

    // ← 접기, → 펼치기, 펼친 폴더에서 → 는 첫 하위 폴더
    await user.keyboard('{ArrowLeft}');
    expect(treeLines('left')).toEqual(['/', '  work']);
    await user.keyboard('{ArrowRight}{ArrowRight}');
    await waitFor(() => expect(treeRow('left', 'app')!.className).toContain('is-cursor'));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(panelPath('left')).toBe('/work/app'));
    expect(treeOf('left')!.className).not.toContain('is-focused');

    // Tab은 그대로 좌우 패널 전환, 트리 키보드는 해제
    await user.keyboard('gt');
    expect(treeOf('left')!.className).toContain('is-focused');
    await user.keyboard('{Tab}');
    expect(panelOf('right').className).toContain('is-active');
    expect(treeOf('left')!.className).not.toContain('is-focused');
  });

  it('targets the tree folder with file shortcuts and context menus, keeping top folders navigation-only', async () => {
    const user = userEvent.setup();
    setup();
    await waitFor(() => expect(treeRow('left', 'docs')).toBeTruthy());

    await user.keyboard('gt{ArrowDown}d');
    const dialog = await screen.findByRole('dialog', { name: '휴지통으로 이동' });
    expect(dialog.textContent).toContain('docs');
    expect(dialog.textContent).not.toContain('README.md');
    await user.click(within(dialog).getByRole('button', { name: '취소' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '휴지통으로 이동' })).toBeNull());

    // 트리에는 다중 선택이 없어 선택 키는 안내만
    await user.keyboard(' ');
    expect(await screen.findByText('선택 · 지금은 사용할 수 없습니다.')).toBeTruthy();
    expect(panelOf('left').querySelector('.file-row.is-selected')).toBeNull();

    // 맨 위 항목: 키보드 삭제는 거부, 우클릭 메뉴는 이동만
    await user.keyboard('{Home}d');
    expect(await screen.findByText('삭제 · 지금은 사용할 수 없습니다.')).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: '휴지통으로 이동' })).toBeNull();
    fireEvent.contextMenu(treeRow('left', '/')!);
    const rootItems = (await screen.findAllByRole('menuitem')).map((item) => item.querySelector('span')?.textContent);
    expect(rootItems).toEqual(['열기', '반대 패널에서 열기']);
    await user.keyboard('{Escape}');

    fireEvent.contextMenu(treeRow('left', 'work')!);
    await user.click(await screen.findByRole('menuitem', { name: /^반대 패널에서 열기/ }));
    await waitFor(() => expect(panelPath('right')).toBe('/work'));
  });

  it('moves the panel up to the nearest existing folder when its folder disappeared', async () => {
    const user = userEvent.setup();
    const { listDir, readListing } = setup();
    await waitFor(() => expect(treeRow('left', 'app')?.getAttribute('aria-selected')).toBe('true'));
    listDir.mockImplementation(async (input) => (input.path === '/work/app'
      ? { ok: false as const, error: { code: 'not_found', messageKey: 'errors.notFound', path: input.path, details: null, recoverable: true } }
      : readListing(input)));

    await user.keyboard('{Meta>}r{/Meta}');
    await waitFor(() => expect(panelPath('left')).toBe('/work'));
    expect(await screen.findByText('폴더가 없어져 상위 폴더로 이동 · /work')).toBeTruthy();
    await waitFor(() => expect(treeRow('left', 'work')?.getAttribute('aria-selected')).toBe('true'));
  });

  it('lists a volume once at the top instead of again inside its parent folder', async () => {
    const user = userEvent.setup();
    setup({
      leftPath: '/Volumes/ssd/work',
      roots: ['/', '/Volumes/ssd'],
      folders: {
        '/': ['/Volumes', '/work'],
        '/Volumes': ['/Volumes/ssd'],
        '/Volumes/ssd': ['/Volumes/ssd/work'],
        '/Volumes/ssd/work': [],
        '/work': [],
        '/work/docs': [],
      },
    });
    // 위치 목록을 읽기 전 임시로 `/`·Volumes를 펼치지 않음
    await waitFor(() => expect(treeLines('left')).toEqual(['/', 'ssd', '  work']));

    await user.click(treeRow('left', '/')!.querySelector('.folder-tree-toggle')!);
    await waitFor(() => expect(treeRow('left', 'Volumes')).toBeTruthy());
    await user.click(treeRow('left', 'Volumes')!.querySelector('.folder-tree-toggle')!);
    await waitFor(() => expect(treeRow('left', 'Volumes')!.getAttribute('aria-expanded')).toBeNull());
    expect(treeLines('left')).toEqual(['/', '  Volumes', '  work', 'ssd', '  work']);
    const paths = treeRows('left').map((row) => row.dataset.treePath);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('shows a remote panel tree from the server root and dims it while not connected', async () => {
    const { listSubdirs } = setup({ leftPath: 'sftp://me@host/home/me' });
    await waitFor(() => expect(treeLines('left')).toEqual(['me@host', '  home', '    me']));
    expect(listSubdirs.mock.calls.map(([input]) => input.path).sort()).toEqual(['sftp://me@host/', 'sftp://me@host/home']);
    expect(treeOf('left')!.className).toContain('is-disconnected');
    expect(treeRow('left', 'me')!.getAttribute('aria-selected')).toBe('true');
  });

  it('drops list entries onto a tree folder and blocks dropping a folder into itself', async () => {
    const { operationClient } = setup();
    await waitFor(() => expect(treeRow('left', 'docs')).toBeTruthy());
    const readme = [...panelOf('left').querySelectorAll<HTMLElement>('.file-row')].find((row) => row.textContent?.includes('README.md'))!;
    const docs = treeRow('left', 'docs')!;
    const work = treeRow('left', 'work')!;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn((_x: number, y: number) => (y === 260 ? docs.lastElementChild : y === 270 ? work : panelOf('left'))),
    });

    // 트리 폴더를 끌어 자기 자신에 놓으면 차단
    fireEvent.pointerDown(work, { pointerId: 10, button: 0, clientX: 100, clientY: 270 });
    fireEvent.pointerMove(window, { pointerId: 10, buttons: 1, clientX: 110, clientY: 270 });
    expect(panelOf('left').className).toContain('is-drop-blocked');
    fireEvent.pointerUp(window, { pointerId: 10, button: 0, clientX: 110, clientY: 270 });
    expect(operationClient.startCopy).not.toHaveBeenCalled();

    // 목록 항목을 트리 폴더에 놓으면 그 폴더로 복사
    fireEvent.pointerDown(readme, { pointerId: 9, button: 0, clientX: 300, clientY: 200 });
    fireEvent.pointerMove(window, { pointerId: 9, buttons: 1, clientX: 100, clientY: 260 });
    expect(docs.className).toContain('is-drop-target');
    expect(panelOf('left').className).toContain('is-drop-copy');
    fireEvent.pointerUp(window, { pointerId: 9, button: 0, clientX: 100, clientY: 260 });
    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: ['/work/app/README.md'], targetDir: '/work/docs', policy: 'skip',
    }));
  });
});

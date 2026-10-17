// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppError, PanelId } from '../domain/types';
import type { ListDirInput } from '../tauri/client';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import type { PanelDataSource } from './panelDataSource';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing, DEFAULT_SORT } from './panelState';
import './testing/commanderTestSetup';
import { activePanelLabel, emptyListings, mockedPanelDataSource, renderCommander, rowByText, testEntry } from './testing/commanderTestSupport';

describe('CommanderShell rendering', () => {

  it('renders a TUI-faithful dual-panel commander canvas', () => {
    const { container } = renderCommander();

    expect(screen.queryByText('[복슬Dir]')).toBeNull();
    expect(screen.getByRole('button', { name: '파일(F)' })).toBeTruthy();
    expect(screen.getByLabelText('dual file panels')).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('Architecture.md')).toBeTruthy();
    expect(screen.getByText('generic-array-7534a23a150ae5e7')).toBeTruthy();
    expect(container.querySelector('.file-panel.is-active')).not.toBeNull();
    expect(container.querySelector('.persistent-sidebar')).toBeNull();
    expect(container.querySelector('.persistent-inspector')).toBeNull();
    expect(container.querySelector('.large-toolbar')).toBeNull();
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('복사');
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('패널');
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('필터');
    expect(container.querySelector<HTMLElement>('.file-table')?.style.getPropertyValue('--file-grid-template')).toContain('minmax(0, 1fr)');
  });

  it('keeps text selection started in the navigation path inside that path', () => {
    const { container } = renderCommander();
    const panel = container.querySelector<HTMLElement>('.file-panel.is-active');
    const path = panel?.querySelector<HTMLElement>('.path-input');
    const table = panel?.querySelector<HTMLElement>('.file-table');
    const pathText = path?.lastChild;
    const selection = window.getSelection();
    if (!panel || !path || !table || !pathText || !selection) throw new Error('path selection fixture is required');

    try {
      selection.setBaseAndExtent(pathText, 2, table, 1);
      document.dispatchEvent(new Event('selectionchange'));

      expect(selection.anchorNode).toBe(pathText);
      expect(selection.anchorOffset).toBe(2);
      expect(selection.focusNode).toBe(pathText);
      expect(selection.focusOffset).toBe(pathText.textContent?.length);

      selection.setBaseAndExtent(pathText, 2, panel, 3);
      document.dispatchEvent(new Event('selectionchange'));
      expect(selection.focusNode).toBe(pathText);
      expect(selection.focusOffset).toBe(pathText.textContent?.length);

      selection.setBaseAndExtent(pathText, 2, pathText, 5);
      document.dispatchEvent(new Event('selectionchange'));
      expect(selection.focusNode).toBe(pathText);
      expect(selection.focusOffset).toBe(5);
    } finally {
      selection.removeAllRanges();
    }
  });

  it('stops a backward path selection at the beginning of the path', () => {
    const { container } = renderCommander();
    const panel = container.querySelector<HTMLElement>('.file-panel.is-active');
    const pathText = panel?.querySelector('.path-input')?.firstChild;
    const headerText = panel?.querySelector('.path-controls > button')?.firstChild;
    const selection = window.getSelection();
    if (!pathText || !headerText || !selection) throw new Error('path selection fixture is required');

    try {
      selection.setBaseAndExtent(pathText, 4, headerText, 0);
      document.dispatchEvent(new Event('selectionchange'));

      expect(selection.anchorNode).toBe(pathText);
      expect(selection.anchorOffset).toBe(4);
      expect(selection.focusNode).toBe(pathText);
      expect(selection.focusOffset).toBe(0);
    } finally {
      selection.removeAllRanges();
    }
  });

  it('applies file-type color classes to whole rows instead of only file names', () => {
    const { container } = renderCommander();
    const rows = [...container.querySelectorAll<HTMLElement>('.file-row')];
    const fileRow = rows.find((row) => row.textContent?.includes('Architecture.md'));
    const directoryRow = rows.find((row) => row.textContent?.includes('images'));

    expect(fileRow?.className).toContain('entry-row-kind-file');
    expect(directoryRow?.className).toContain('entry-row-kind-directory');
    expect(container.querySelector('.entry-kind-file')).toBeNull();
  });

  it('shows row tooltip details and uses middle ellipsis DOM for long names', async () => {
    const longEntry = {
      ...testEntry(SAMPLE_LISTINGS.right.path, 'very-long-project-configuration-file.generated.json'),
      modifiedAt: new Date(2026, 1, 18, 11, 42).toISOString(),
      createdAt: new Date(2026, 1, 17, 10, 15).toISOString(),
    };
    const dataSource = createFixturePanelDataSource({
      left: SAMPLE_LISTINGS.left,
      right: createDirectoryListing('right', SAMPLE_LISTINGS.right.path, [longEntry], DEFAULT_SORT, null, 1),
    });
    const { container } = renderCommander(dataSource, undefined, undefined);
    const row = rowByText(container, 'very-long-project-configuration-file.generated.json');

    expect(row?.getAttribute('title')).toContain('이름: very-long-project-configuration-file.generated.json');
    expect(row?.getAttribute('title')).toContain(`경로: ${longEntry.path}`);
    expect(row?.getAttribute('title')).toContain('수정: 2026-02-18 11:42');
    expect(row?.getAttribute('aria-label')).toBe('very-long-project-configuration-file.generated.json, 파일, 1 B');
    expect(row?.getAttribute('aria-description')).toContain('권한: -rw-r--r--');
    expect(row?.querySelector('.middle-ellipsis-start')).toBeTruthy();
    expect(row?.querySelector('.middle-ellipsis-end')?.textContent).toMatch(/\.json$/);
  });

  it('prevents browser scrolling for commander movement keys', () => {
    renderCommander();

    expect(fireEvent.keyDown(document, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'PageDown' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: ' ' })).toBe(false);
  });

  it('reports a broken directory link without launching Finder', async () => {
    const user = userEvent.setup();
    const link = {
      ...testEntry('/tmp/home', 'broken-link'),
      kind: 'symlink' as const,
      symlinkTargetIsDirectory: null,
      sizeBytes: null,
    };
    const initial = {
      left: SAMPLE_LISTINGS.left,
      right: createDirectoryListing('right', '/tmp/home', [link]),
    };
    const dataSource = createFixturePanelDataSource(initial);
    const listDir = dataSource.listDir;
    dataSource.listDir = vi.fn(async (input) => input.path === link.path
      ? {
        ok: false as const,
        error: { code: 'not_found', messageKey: 'errors.notFound', path: link.path, details: null, recoverable: true },
      }
      : listDir(input));
    const openDefault = vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } }));
    const { container } = renderCommander(dataSource, { createDir: vi.fn(), renameEntry: vi.fn(), openDefault });
    const linkRow = rowByText(container, 'broken-link');
    if (!linkRow) throw new Error('broken link row is required');

    await user.dblClick(linkRow);

    await waitFor(() => expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('목록 읽기 실패'));
    expect(activePanelLabel(container)).toContain('/tmp/home');
    expect(openDefault).not.toHaveBeenCalled();
  });

  it('opens a bounded text quick view with F3 without invoking the file', async () => {
    const user = userEvent.setup();
    const file = testEntry('/tmp/source', 'README.md');
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp/target', []),
        right: createDirectoryListing('right', '/tmp/source', [file, testEntry('/tmp/source', 'next.md')]),
      },
    });
    const previewFile = vi.fn(async () => ({
      ok: true as const,
      data: {
        path: file.path,
        name: file.name,
        kind: 'text' as const,
        mimeType: 'text/markdown',
        sizeBytes: 1024,
        text: '# BokslDirGUI\npreview text',
        dataUrl: null,
        truncated: true,
        limitBytes: 256 * 1024,
      },
    }));
    const getMetadata = vi.fn(async () => ({ ok: true as const, data: {
      ...file, absolutePath: file.path, extension: 'md', mimeType: 'text/markdown', readonly: false, directoryStats: null,
    } }));
    render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), previewFile, getMetadata }}
        initialFocusIndex={{ right: 0 }}
      />,
    );

    await user.keyboard('{F3}');

    const dialog = await screen.findByRole('dialog', { name: '빠른 보기' });
    const scrollArea = within(dialog).getByRole('region', { name: '빠른 보기: README.md' });
    expect(scrollArea.textContent).toBe('# BokslDirGUI\npreview text');
    await waitFor(() => expect(document.activeElement).toBe(scrollArea));
    scrollArea.style.lineHeight = '24px';
    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
    });
    const focusedPath = document.querySelector('.commander-shell')?.getAttribute('aria-activedescendant');
    expect(fireEvent.keyDown(scrollArea, { key: 'ArrowDown' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(24);
    expect(fireEvent.keyDown(scrollArea, { key: 'PageDown' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(200);
    expect(fireEvent.keyDown(scrollArea, { key: 'ArrowUp' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(176);
    expect(fireEvent.keyDown(scrollArea, { key: 'PageUp' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(0);
    expect(fireEvent.keyDown(scrollArea, { key: 'End' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(600);
    expect(fireEvent.keyDown(scrollArea, { key: 'Home' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(0);
    expect(document.querySelector('.commander-shell')?.getAttribute('aria-activedescendant')).toBe(focusedPath);
    expect(screen.getByText('파일 앞부분만 표시합니다.')).toBeTruthy();
    expect(previewFile).toHaveBeenCalledWith({ path: file.path });
    await user.keyboard('i');
    const info = await screen.findByRole('complementary', { name: '파일 정보' });
    await waitFor(() => expect(within(info).getByText(file.path)).toBeTruthy());
    expect(getMetadata).toHaveBeenCalledWith({ path: file.path });
    expect(document.querySelector('.commander-shell')?.getAttribute('aria-activedescendant')).toBe(focusedPath);
    await user.keyboard('i');
    expect(screen.queryByRole('complementary')).toBeNull();
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog', { name: '빠른 보기' })).toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('next.md');
  });

  it('opens the active panel path in the opposite panel with tp', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('tp');

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: SAMPLE_LISTINGS.right.path,
    })));
  });

  it('compares both visible directories and marks same, different, and one-sided entries with tc', async () => {
    const user = userEvent.setup();
    const commonLeft = testEntry('/left', 'common.txt');
    const commonRight = { ...commonLeft, path: '/right/common.txt' };
    const changedLeft = { ...testEntry('/left', 'changed.txt'), sizeBytes: 10 };
    const changedRight = { ...changedLeft, path: '/right/changed.txt', sizeBytes: 20 };
    const dataSource = createFixturePanelDataSource({
      left: createDirectoryListing('left', '/left', [commonLeft, changedLeft, testEntry('/left', 'only-left.txt')]),
      right: createDirectoryListing('right', '/right', [commonRight, changedRight, testEntry('/right', 'only-right.txt')]),
    });
    renderCommander(dataSource);

    await user.keyboard('tc');

    expect(screen.getByText('폴더 비교 · 동일 1 · 다름 1 · 왼쪽만 1 · 오른쪽만 1')).toBeTruthy();
    expect(document.querySelectorAll('[data-compare-state="same"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-compare-state="different"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-compare-state="left-only"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-compare-state="right-only"]')).toHaveLength(1);
  });

  it('keeps browser preview Quit from calling the Tauri window API', async () => {
    const appController = { quit: vi.fn(async () => undefined) };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        runtimeBackendAvailable={false}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true })).toBe(false);

    expect(appController.quit).not.toHaveBeenCalled();
    expect(await screen.findByText(/브라우저 미리보기에서는 앱 종료를 실행할 수 없습니다/)).toBeTruthy();
  });

  it('imports external dropped files only when the OS path is exposed', async () => {
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-external-import', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), undefined, operationClient);
    const leftPanel = container.querySelector<HTMLElement>('.file-panel[aria-label^="left panel"]');
    if (!leftPanel) {
      throw new Error('left panel is required');
    }

    const blockedFile = new File(['blocked'], 'blocked.txt', { type: 'text/plain' });
    fireEvent.drop(leftPanel, { dataTransfer: { files: [blockedFile] } });
    expect(await screen.findByText('외부 드롭은 OS 파일 경로가 확인될 때만 가져올 수 있습니다.')).toBeTruthy();
    expect(operationClient.startCopy).not.toHaveBeenCalled();

    const externalFile = new File(['hello'], 'incoming.txt', { type: 'text/plain', lastModified: 1_700_000_000_000 });
    Object.defineProperty(externalFile, 'path', { value: '/tmp/incoming.txt' });
    fireEvent.drop(leftPanel, { dataTransfer: { files: [externalFile] } });

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: ['/tmp/incoming.txt'],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('loads initial listings through a mocked Tauri-backed provider', async () => {
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: true,
      initial: emptyListings('/boot-left', '/boot-right'),
      loadResult: {
        left: createDirectoryListing('left', '/real-left', [testEntry('/real-left', 'real-left-file.txt')], DEFAULT_SORT, null, 2),
        right: createDirectoryListing('right', '/real-right', [testEntry('/real-right', 'real-right-file.txt')], DEFAULT_SORT, null, 2),
      },
    });

    render(<CommanderShell dataSource={dataSource} />);

    expect(await screen.findByText('real-left-file.txt')).toBeTruthy();
    expect(screen.getByText('real-right-file.txt')).toBeTruthy();
    expect(dataSource.loadInitialListings).toHaveBeenCalledOnce();
  });

  it('keeps initial bootstrap errors isolated per panel', async () => {
    const rightError: AppError = {
      code: 'permission_denied',
      messageKey: 'errors.permissionDenied',
      path: '/blocked-right',
      details: null,
      recoverable: true,
    };
    const dataSource: PanelDataSource = {
      initialListings: emptyListings('/boot-left', '/boot-right'),
      loadInitialOnMount: true,
      loadInitialListings: vi.fn(async () => ({
        left: { ok: true as const, data: createDirectoryListing('left', '/real-left', [testEntry('/real-left', 'left-ok.txt')]) },
        right: { ok: false as const, error: rightError },
      })),
      listDir: vi.fn(async (input: ListDirInput) => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path, [testEntry(input.path, 'child.txt')], input.sort, input.filter) })),
      gotoPath: vi.fn(async (input: { panelId: PanelId; path: string }) => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path) })),
      listLocations: vi.fn(async () => ({
        ok: true as const,
        data: { home: '/home/mock', roots: ['/'], recent: ['/home/mock'], bookmarks: [] },
      })),
    };

    render(<CommanderShell dataSource={dataSource} />);

    expect(await screen.findByText('left-ok.txt')).toBeTruthy();
    expect(screen.getByText('오류: 권한이 거부되었습니다. · /blocked-right')).toBeTruthy();
  });

  it('renders mocked listDir error and empty states inside the panel', async () => {
    const errorSource = mockedPanelDataSource({
      loadInitialOnMount: true,
      initial: emptyListings('/boot-left', '/boot-right'),
      loadError: {
        code: 'permission_denied',
        messageKey: 'errors.permissionDenied',
        path: '/blocked',
        details: null,
        recoverable: true,
      },
    });
    const { unmount } = render(<CommanderShell dataSource={errorSource} />);
    expect((await screen.findAllByText('오류: 권한이 거부되었습니다. · /blocked')).length).toBeGreaterThan(0);
    unmount();

    const emptySource = mockedPanelDataSource({
      loadInitialOnMount: true,
      initial: emptyListings('/empty-left', '/empty-right'),
      loadResult: emptyListings('/empty-left', '/empty-right'),
    });
    render(<CommanderShell dataSource={emptySource} />);
    expect((await screen.findAllByText('빈 디렉터리')).length).toBeGreaterThan(0);
  });
});

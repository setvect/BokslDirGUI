// @vitest-environment jsdom
import { act, cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type ComponentProps } from 'react';
import { ACTIONS, ACTION_BY_ID, actionVisibleOnPlatform } from '../actions/registry';
import { useOperationStore } from '../operations/operationStore';
import { CommanderShell, columnLayoutForPanelWidth, hotkeyStripActionsForWidth, splitMiddleEllipsisParts, zoomPercentForStep, zoomScaleForStep } from './CommanderShell';
import type { AppError, DirectoryListing, PanelId } from '../domain/types';
import type { ListDirInput } from '../tauri/client';
import type { PanelDataSource } from './panelDataSource';
import { createFixturePanelDataSource } from './panelDataSource';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { createDirectoryListing, DEFAULT_SORT } from './panelState';
import { commanderKeyboardOwners, useCommanderKeyboardOwner } from './keyboardOwnership';

afterEach(() => {
  vi.useRealTimers();
  useOperationStore.setState({
    dialog: null,
    progress: null,
    conflictPrompt: null,
    summary: null,
    lastError: null,
    lastConflictDecision: null,
    applyAllConflictDecision: null,
    activeOperationController: null,
  });
  cleanup();
});

const commanderElement = (
  dataSource: PanelDataSource = createFixturePanelDataSource(),
  mutationClient?: ComponentProps<typeof CommanderShell>['mutationClient'],
  operationClient?: ComponentProps<typeof CommanderShell>['operationClient'],
  runtimeBackendAvailable = true,
) => (
  <CommanderShell
    dataSource={dataSource}
    mutationClient={mutationClient}
    operationClient={operationClient}
    runtimeBackendAvailable={runtimeBackendAvailable}
    initialFocusIndex={INITIAL_FOCUS_INDEX}
    initialSelectedPaths={INITIAL_SELECTED_PATHS}
  />
);

const renderCommander = (
  dataSource: PanelDataSource = createFixturePanelDataSource(),
  mutationClient?: ComponentProps<typeof CommanderShell>['mutationClient'],
  operationClient?: ComponentProps<typeof CommanderShell>['operationClient'],
  runtimeBackendAvailable = true,
) => render(commanderElement(dataSource, mutationClient, operationClient, runtimeBackendAvailable));

describe('CommanderShell', () => {
  it('renders a TUI-faithful dual-panel commander canvas', () => {
    const { container } = renderCommander();

    expect(screen.getByText('[복슬Dir]')).toBeTruthy();
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

  it('shows more hotkey hints as horizontal space grows', () => {
    const narrow = hotkeyStripActionsForWidth(520, 1).map((action) => action.id);
    const wide = hotkeyStripActionsForWidth(1600, 1).map((action) => action.id);
    const zoomed = hotkeyStripActionsForWidth(1600, 1.5).map((action) => action.id);

    expect(narrow).toEqual([
      'panel.switchActive',
      'nav.enter',
      'selection.toggle',
      'file.copy',
      'file.move',
      'file.mkdir',
    ]);
    expect(wide.length).toBeGreaterThan(narrow.length);
    expect(wide).toContain('filter.start');
    expect(wide).toContain('nav.refresh');
    expect(zoomed.length).toBeLessThan(wide.length);
  });


  it('uses the TUI width-based metadata column policy', () => {
    expect(columnLayoutForPanelWidth(29 * 8)).toMatchObject({ showModified: false, showSize: false });
    expect(columnLayoutForPanelWidth(40 * 8)).toMatchObject({ showModified: false, showSize: false });
    expect(columnLayoutForPanelWidth(48 * 8)).toMatchObject({ showModified: true, showSize: false, dateFormat: 'short' });
    expect(columnLayoutForPanelWidth(61 * 8)).toMatchObject({ showSize: true, showPermissions: false, dateFormat: 'short' });
    expect(columnLayoutForPanelWidth(87 * 8)).toMatchObject({ showSize: true, showPermissions: false, showCreated: false });
    expect(columnLayoutForPanelWidth(100 * 8)).toMatchObject({ showPermissions: true, showCreated: false, dateFormat: 'long' });
    expect(columnLayoutForPanelWidth(135 * 8)).toMatchObject({ showPermissions: true, showCreated: true, showOwner: false });
    expect(columnLayoutForPanelWidth(170 * 8)).toMatchObject({ showCreated: true, showOwner: true });
    expect(columnLayoutForPanelWidth(70 * 8, 1)).toMatchObject({ showSize: true, showPermissions: false });
    expect(columnLayoutForPanelWidth(70 * 8, 1.5)).toMatchObject({ showPermissions: false });
    expect(columnLayoutForPanelWidth(100 * 8).gridTemplateColumns).toContain('calc(');
    expect(columnLayoutForPanelWidth(100 * 8).gridTemplateColumns).toContain('var(--cell-padding-x)');

    const longOwnerEntry = {
      ...testEntry(SAMPLE_LISTINGS.right.path, 'long-owner.txt'),
      owner: 'very-long-local-account-name',
      group: 'staff',
      createdAt: '2026-02-17T10:15:00+09:00',
      modifiedAt: '2026-02-18T11:42:00+09:00',
    };
    const longPermissionEntry = {
      ...testEntry(SAMPLE_LISTINGS.right.path, 'long-permission.txt'),
      permissions: 'drwxrwxrwx+ extended-acl',
      modifiedAt: '2026-02-18T11:42:00+09:00',
    };
    expect(columnLayoutForPanelWidth(170 * 8, 1, [longOwnerEntry])).toMatchObject({ showOwner: false });
    expect(columnLayoutForPanelWidth(100 * 8, 1, [longPermissionEntry])).toMatchObject({ showPermissions: false });
  });

  it('uses predictable preset zoom scales and keeps filename suffixes for middle ellipsis', () => {
    expect(zoomScaleForStep(-3)).toBe(0.75);
    expect(zoomScaleForStep(0)).toBe(1);
    expect(zoomScaleForStep(1)).toBe(1.1);
    expect(zoomScaleForStep(2)).toBe(1.25);
    expect(zoomScaleForStep(3)).toBe(1.5);
    expect(zoomScaleForStep(99)).toBe(2);
    expect(zoomPercentForStep(1)).toBe(110);
    expect(zoomPercentForStep(2)).toBe(125);
    expect(zoomPercentForStep(3)).toBe(150);

    expect(splitMiddleEllipsisParts('short.txt')).toEqual({ start: 'short.txt', end: null });
    expect(splitMiddleEllipsisParts('very-long-project-configuration-file.generated.json')).toMatchObject({
      end: expect.stringMatching(/\.json$/),
    });
    const unicodeName = `파일-${'👩‍💻-'.repeat(12)}설정.config.json`;
    const unicodeSplit = splitMiddleEllipsisParts(unicodeName);
    expect(`${unicodeSplit.start}${unicodeSplit.end ?? ''}`).toBe(unicodeName);
    expect(unicodeSplit.end).toMatch(/\.json$/);
    expect(unicodeSplit.start).not.toMatch(/\u200d$/u);
    expect(unicodeSplit.end ?? '').not.toMatch(/^\u200d/u);

    const originalSegmenter = Intl.Segmenter;
    try {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: undefined });
      const fallbackName = `emoji-${'👨‍👩‍👧‍👦-'.repeat(8)}cafe\u0301-report.txt`;
      const fallbackSplit = splitMiddleEllipsisParts(fallbackName);
      expect(`${fallbackSplit.start}${fallbackSplit.end ?? ''}`).toBe(fallbackName);
      expect(fallbackSplit.start).not.toMatch(/\u200d$/u);
      expect(fallbackSplit.end ?? '').not.toMatch(/^\u200d/u);
      expect(fallbackSplit.end).toMatch(/\.txt$/);
    } finally {
      Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: originalSegmenter });
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
      modifiedAt: '2026-02-18T11:42:00+09:00',
      createdAt: '2026-02-17T10:15:00+09:00',
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

  it('keeps boundary filenames and metadata distinguishable through accessible row details', () => {
    const edgeEntries = [
      testEntry('/edge', '한글-English-123-📦.txt'),
      testEntry('/edge', 'cafe\u0301-조합형'),
      testEntry('/edge', 'README'),
      testEntry('/edge', 'archive.backup.2026.07.tar.gz'),
      { ...testEntry('/edge', '.숨김파일'), isHidden: true },
      { ...testEntry('/edge', 'report-final.txt'), permissions: '-r--r--r--' },
      testEntry('/edge', 'report-finaI.txt'),
    ];
    const dataSource = createFixturePanelDataSource({
      left: createDirectoryListing('left', '/empty', []),
      right: createDirectoryListing('right', '/edge', edgeEntries),
    });
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [] }}
      />,
    );

    for (const entry of edgeEntries) {
      const row = [...container.querySelectorAll<HTMLElement>('.file-panel.is-active .file-row')]
        .find((candidate) => candidate.getAttribute('title')?.includes(`이름: ${entry.name}`));
      expect(row, entry.name).toBeTruthy();
      expect(row?.getAttribute('aria-label')).toContain(entry.name);
      expect(row?.getAttribute('aria-description')).toContain(`경로: ${entry.path}`);
      expect(row?.getAttribute('aria-description')).toContain(`권한: ${entry.permissions}`);
    }
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
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });
    const activeTable = container.querySelector<HTMLElement>('.file-panel.is-active [role="table"]');

    expect(activeTable?.getAttribute('aria-rowcount')).toBe('10000');
    expect(container.querySelectorAll('.file-panel.is-active .file-row').length).toBeLessThan(100);

    shell.focus();
    fireEvent.keyDown(document, { key: 'End' });

    await waitFor(() => expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-9999'));
    expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('entry-09999.txt');
    expect(container.querySelectorAll('.file-panel.is-active .file-row').length).toBeLessThan(100);
  });

  it('uses Tab as active-panel switching instead of DOM focus traversal', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });

    shell.focus();
    expect(activePanelLabel(container)).toContain('right panel');

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('left panel');
    expect(document.activeElement).toBe(shell);
    expect(screen.queryByText('Action preview')).toBeNull();
    expect(container.querySelector('.transient-overlay')).toBeNull();
  });

  it('uses the global status strip for focused-item context instead of repeating panel counts', () => {
    renderCommander();

    const status = screen.getByLabelText('활성 패널 상태');
    expect(status.textContent).toContain('generic-array-6de08afde610f112');
    expect(status.textContent).toContain('폴더');
    expect(status.textContent).not.toContain('파일,');
    expect(status.textContent).not.toContain('선택');
  });

  it('keeps the document keydown listener stable across rerenders', async () => {
    const addSpy = vi.spyOn(document, 'addEventListener');
    const removeSpy = vi.spyOn(document, 'removeEventListener');

    try {
      const dataSource = createFixturePanelDataSource();
      const { container, rerender } = renderCommander(dataSource);
      const keydownAddsAfterMount = addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
      const keydownRemovesAfterMount = removeSpy.mock.calls.filter(([type]) => type === 'keydown').length;

      expect(activePanelLabel(container)).toContain('right panel');
      rerender(commanderElement(dataSource));
      fireEvent.keyDown(document, { key: 'Tab' });

      expect(activePanelLabel(container)).toContain('left panel');
      expect(addSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(keydownAddsAfterMount);
      expect(removeSpy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(keydownRemovesAfterMount);
    } finally {
      addSpy.mockRestore();
      removeSpy.mockRestore();
    }
  });

  it('moves the focused file row with arrow and boundary keys', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    expect(focusedRowText(container)).toContain('generic-array-6de08afde610f112');

    await user.keyboard('{ArrowDown}');
    expect(focusedRowText(container)).toContain('generic-array-7534a23a150ae5e7');

    await user.keyboard('{ArrowUp}');
    expect(focusedRowText(container)).toContain('generic-array-6de08afde610f112');

    await user.keyboard('{Home}');
    expect(
      screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant'),
    ).toBe('commander-row-right-0');

    await user.keyboard('{End}');
    expect(
      screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant'),
    ).toBe('commander-row-right-32');
  });

  it('prevents browser scrolling for commander movement keys', () => {
    renderCommander();

    expect(fireEvent.keyDown(document, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'PageDown' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: ' ' })).toBe(false);
  });

  it('toggles focused-row selection with Space and moves down like the TUI', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    const originalFocusedRow = focusedRow(container);
    expect(originalFocusedRow?.textContent).toContain('generic-array-6de08afde610f112');
    expect(originalFocusedRow?.className).toContain('is-selected');

    await user.keyboard('{Space}');

    expect(originalFocusedRow?.className).not.toContain('is-selected');
    expect(focusedRowText(container)).toContain('generic-array-7534a23a150ae5e7');
  });

  it('moves down from virtual parent rows without selecting them when Space is pressed', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    await user.keyboard('gg');
    expect(focusedRowText(container)).toContain('..');

    await user.keyboard('{Space}');

    expect(focusedRowText(container)).not.toContain('..');
    expect(rowByText(container, '..')?.className).not.toContain('is-selected');
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
      screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant'),
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
    expect(screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-1');
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
    const { container } = renderCommander(dataSource, { createDir: vi.fn(), renameEntry: vi.fn(), openDefault });
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
    const { container } = renderCommander(dataSource, { createDir: vi.fn(), renameEntry: vi.fn(), openDefault });
    const linkRow = rowByText(container, 'document-link');
    if (!linkRow) throw new Error('file link row is required');

    await user.dblClick(linkRow);

    await waitFor(() => expect(openDefault).toHaveBeenCalledWith({ path: link.path }));
    expect(activePanelLabel(container)).toContain('/tmp/home');
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

  it('dispatches the copy shortcut directly to the operation client without a preflight dialog', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-shortcut', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(screen.queryByText('Copy to opposite panel')).toBeNull();
    expect(screen.queryByLabelText('Operation status')).toBeNull();
    expect(await screen.findByLabelText('Operation status', {}, { timeout: 1000 })).toBeTruthy();
  });

  it('copies the focused source with Cmd+C and pastes into the active panel with Cmd+V', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-clipboard-copy', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('{Meta>}c{/Meta}');
    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(screen.getByText(/복사 준비 · 대상 폴더에서 ⌘V/)).toBeTruthy();
    await user.keyboard('{Tab}');
    await user.keyboard('{Meta>}v{/Meta}');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('uses Finder-style Cmd+C then Option+Cmd+V to move with confirmation', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-mac-paste-move', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('{Meta>}c{/Meta}');
    await user.keyboard('{Tab}');
    await user.keyboard('{Alt>}{Meta>}v{/Meta}{/Alt}');

    expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
    expect(operationClient.startMove).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: '이동' }));
    await waitFor(() => expect(operationClient.startMove).toHaveBeenCalledWith({
      sources: [SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();
  });

  it('uses Windows-style Ctrl+X then Ctrl+V and clears the cut list after a complete move', async () => {
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0)');
    try {
      const user = userEvent.setup();
      const operationClient = {
        startCopy: vi.fn(),
        startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-win-paste-move', kind: 'move' as const, state: 'queued' as const } })),
        startDelete: vi.fn(),
        cancelOperation: vi.fn(),
        resolveConflict: vi.fn(),
      };
      renderCommander(createFixturePanelDataSource(), undefined, operationClient);

      await user.keyboard('{Control>}x{/Control}');
      expect(screen.getByText(/이동 준비 · 대상 폴더에서 Ctrl\+V/)).toBeTruthy();
      await user.keyboard('{Tab}');
      await user.keyboard('{Control>}v{/Control}');

      expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
      await user.click(screen.getByRole('button', { name: '이동' }));
      await waitFor(() => expect(operationClient.startMove).toHaveBeenCalledWith({
        sources: [SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path],
        targetDir: SAMPLE_LISTINGS.left.path,
        policy: 'skip',
      }));
      act(() => useOperationStore.getState().applyOperationSummary({
        operationId: 'op-win-paste-move',
        kind: 'move',
        state: 'completed',
        completedFiles: 1,
        failedFiles: 0,
        skippedFiles: 0,
        errors: [],
      }));
      act(() => useOperationStore.getState().clearSummary());
      await user.keyboard('{Control>}v{/Control}');
      expect(operationClient.startMove).toHaveBeenCalledTimes(1);
    } finally {
      userAgent.mockRestore();
    }
  });

  it('does not start a self-copy when pasting into the source folder', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('{Meta>}c{/Meta}');
    await user.keyboard('{Meta>}v{/Meta}');

    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(screen.getByText(/같은 폴더에 붙여넣을 수 없습니다/)).toBeTruthy();
  });

  it('disables real file mutation shortcuts in plain browser preview mode', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient, false);

    expect(screen.getByText(/미리보기 모드입니다/)).toBeTruthy();

    await user.keyboard('y');
    await user.keyboard('d');

    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(operationClient.startDelete).not.toHaveBeenCalled();
    expect(await screen.findByText(/현재 컨텍스트에서는 사용할 수 없습니다/)).toBeTruthy();
  });

  it('blocks file-operation shortcuts while another operation is in flight', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    useOperationStore.setState({
      progress: {
        operationId: 'op-busy',
        kind: 'copy',
        state: 'running',
        totalFiles: 1,
        completedFiles: 0,
        totalBytes: null,
        completedBytes: 0,
        currentPath: SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right]?.path ?? null,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
    });
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('y');

    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(await screen.findByText(/현재 컨텍스트에서는 사용할 수 없습니다/)).toBeTruthy();
  });

  it('requires explicit confirmation before a move reaches the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-move-confirmed', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('x');

    expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
    expect(operationClient.startMove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '이동' }));

    await waitFor(() => expect(operationClient.startMove).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('moves operation dialog button focus with arrow keys', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-trash-arrow-nav', kind: 'trash' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '휴지통으로 이동' })).toBeTruthy();

    const cancelButton = screen.getByRole('button', { name: '취소' });
    const confirmButton = screen.getByRole('button', { name: '휴지통으로 이동' });
    await waitFor(() => expect(document.activeElement).toBe(cancelButton));

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(confirmButton);

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cancelButton);

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(confirmButton);
  });

  it('uses the focused row as the file-operation source when nothing is explicitly selected', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-focused-copy', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(screen.queryByText('Copy to opposite panel')).toBeNull();
  });

  it('clears source selection after a fully successful copy summary', async () => {
    const user = userEvent.setup();
    const selectedPaths = SAMPLE_LISTINGS.right.entries.slice(8, 11).map((entry) => entry.path);
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-clear-selection', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: selectedPaths }}
      />,
    );

    expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(3);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: selectedPaths,
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-clear-selection',
      kind: 'copy',
      state: 'completed',
      completedFiles: 3,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(0));
  });

  it('keeps source selection when a copy summary reports skipped items', async () => {
    const user = userEvent.setup();
    const selectedPaths = SAMPLE_LISTINGS.right.entries.slice(8, 11).map((entry) => entry.path);
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-skipped-selection', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: selectedPaths }}
      />,
    );

    await user.keyboard('y');
    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalled());

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-skipped-selection',
      kind: 'copy',
      state: 'completed',
      completedFiles: 0,
      failedFiles: 0,
      skippedFiles: 3,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(3));
  });

  it('copies selected entries from an archive virtual directory by extracting only those entries', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveFile = `${archivePath}:/BokslAsset/eslint.config.js`;
    const leftPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', leftPath, []),
        right: createDirectoryListing('right', `${archivePath}:/BokslAsset`, [{
          ...testEntry(`${archivePath}:/BokslAsset`, 'eslint.config.js'),
          path: archiveFile,
          sizeBytes: 737,
          modifiedAt: '2026-06-28T12:33:00',
        }]),
      },
    });
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: { archivePath, encrypted: false, totalEntries: 0, truncated: false, entries: [] },
      })),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-copy', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={mutationClient}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [archiveFile] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: leftPath,
      policy: 'skip',
      entries: ['BokslAsset/eslint.config.js'],
      stripPrefix: 'BokslAsset',
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-copy',
      kind: 'archiveExtract',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(0));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: leftPath,
    })));
    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath,
      password: undefined,
      limit: 50_000,
    }));

  });

  it('asks for an encrypted archive password before copying a member and cancels without starting', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/secret.zip';
    const archiveEntry = { ...testEntry('/tmp', 'secret.zip'), path: archivePath, kind: 'archive' as const };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp/target', []),
        right: createDirectoryListing('right', '/tmp', [archiveEntry]),
      },
    });
    const archiveList = vi.fn(async () => ({
      ok: true as const,
      data: {
        archivePath,
        encrypted: true,
        totalEntries: 1,
        truncated: false,
        entries: [{ ...testEntry(archivePath, 'secret.txt'), path: `${archivePath}!secret.txt` }],
      },
    }));
    const archiveExtract = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'encrypted-archive-copy', kind: 'archiveExtract' as const, state: 'queued' as const },
    }));
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract,
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList }}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
      />,
    );

    await user.keyboard('{Enter}');
    await waitFor(() => expect(rowByText(container, 'secret.txt')).not.toBeNull());
    await user.keyboard('y');
    expect(await screen.findByRole('dialog', { name: '압축 파일 암호' })).toBeTruthy();
    expect(archiveExtract).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '압축 파일 암호' })).toBeNull();
    expect(archiveExtract).not.toHaveBeenCalled();

    await user.keyboard('y');
    const passwordInput = await screen.findByLabelText('암호');
    expect(passwordInput.getAttribute('type')).toBe('password');
    await user.type(passwordInput, 'secret');
    expect(screen.queryByText('secret')).toBeNull();
    await user.click(screen.getByRole('button', { name: '복사' }));

    await waitFor(() => expect(archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: '/tmp/target',
      password: 'secret',
      policy: 'skip',
      entries: ['secret.txt'],
      stripPrefix: '',
    }));
  });

  it('copies a selected archive directory to the opposite normal panel', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveDirectory = `${archivePath}:/BokslAsset/docs`;
    const leftPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', leftPath, []),
        right: createDirectoryListing('right', `${archivePath}:/BokslAsset`, [{
          ...testEntry(`${archivePath}:/BokslAsset`, 'docs'),
          path: archiveDirectory,
          kind: 'directory',
          sizeBytes: null,
        }]),
      },
    });
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-directory-copy', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [archiveDirectory] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: leftPath,
      policy: 'skip',
      entries: ['BokslAsset/docs'],
      stripPrefix: 'BokslAsset',
    }));
  });

  it('copies multiple selected archive entries in one extract operation', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const currentArchivePath = `${archivePath}:/BokslAsset`;
    const archiveDirectory = `${currentArchivePath}/docs`;
    const archiveFile = `${currentArchivePath}/README.md`;
    const leftPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', leftPath, []),
        right: createDirectoryListing('right', currentArchivePath, [
          {
            ...testEntry(currentArchivePath, 'docs'),
            path: archiveDirectory,
            kind: 'directory',
            sizeBytes: null,
          },
          {
            ...testEntry(currentArchivePath, 'README.md'),
            path: archiveFile,
          },
        ]),
      },
    });
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-multi-copy', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [archiveDirectory, archiveFile] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: leftPath,
      policy: 'skip',
      entries: ['BokslAsset/docs', 'BokslAsset/README.md'],
      stripPrefix: 'BokslAsset',
    }));
  });

  it('copies normal entries into an archive virtual directory through archive_add', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveTarget = `${archivePath}:/BokslAsset`;
    const sourcePath = '/tmp/source';
    const sourceFile = `${sourcePath}/README.md`;
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', archiveTarget, []),
        right: createDirectoryListing('right', sourcePath, [{
          ...testEntry(sourcePath, 'README.md'),
          path: sourceFile,
          sizeBytes: 2048,
        }]),
      },
    });
    vi.mocked(dataSource.listDir).mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(input.panelId, input.path, input.path === sourcePath ? [{
        ...testEntry(sourcePath, 'README.md'),
        path: sourceFile,
      }] : [], input.sort, input.filter, 4),
    }));
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: {
          archivePath,
          encrypted: false,
          entries: [],
          totalEntries: 0,
          truncated: false,
        },
      })),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveAdd: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-add', kind: 'archiveAdd' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={mutationClient}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [sourceFile] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveAdd).toHaveBeenCalledWith({
      sources: [sourceFile],
      archivePath,
      targetInnerDir: 'BokslAsset',
      policy: 'skip',
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-add',
      kind: 'archiveAdd',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(0));
    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath,
      password: undefined,
      limit: 50_000,
    }));
  });

  it('refreshes the archive target and keeps selection after a cancelled archive_add', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveTarget = `${archivePath}:/BokslAsset`;
    const sourcePath = '/tmp/source';
    const sourceFile = `${sourcePath}/README.md`;
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', archiveTarget, []),
        right: createDirectoryListing('right', sourcePath, [{
          ...testEntry(sourcePath, 'README.md'),
          path: sourceFile,
        }]),
      },
    });
    vi.mocked(dataSource.listDir).mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(input.panelId, input.path, input.path === sourcePath ? [{
        ...testEntry(sourcePath, 'README.md'),
        path: sourceFile,
      }] : [], input.sort, input.filter, 4),
    }));
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: { archivePath, encrypted: false, totalEntries: 0, truncated: false, entries: [] },
      })),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveAdd: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-add-cancelled', kind: 'archiveAdd' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={mutationClient}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [sourceFile] }}
      />,
    );

    await user.keyboard('y');
    await waitFor(() => expect(operationClient.archiveAdd).toHaveBeenCalled());

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-add-cancelled',
      kind: 'archiveAdd',
      state: 'cancelled',
      completedFiles: 1,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath,
      password: undefined,
      limit: 50_000,
    }));
    expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(1);
  });

  it('refreshes both panels when a partially completed copy is cancelled', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-cancelled', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(dataSource, undefined, operationClient);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-cancelled',
      kind: 'copy',
      state: 'cancelled',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: SAMPLE_LISTINGS.left.path,
    })));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
  });

  it('uses the focused concrete row for delete and refreshes panels after the backend summary', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-trash-focused', kind: 'trash' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '휴지통으로 이동' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [expect.stringContaining('generic-array-6de08afde610f112')],
      mode: 'trash',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-trash-focused',
      kind: 'trash',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: SAMPLE_LISTINGS.left.path,
    })));
  });

  it('dismisses stale delete dialogs and refreshes the source panel when the backend reports not_found before start', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const stalePath = SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path;
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'not_found',
          messageKey: 'errors.notFound',
          path: stalePath,
          details: {},
          recoverable: true,
        },
      })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '휴지통으로 이동' })).toBeTruthy();
    expect(screen.getAllByText(stalePath).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [stalePath],
      mode: 'trash',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '휴지통으로 이동' })).toBeNull());
    expect(screen.queryByText(/not_found: errors.notFound/)).toBeNull();
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText(/삭제 대상이 이미 없습니다/)).toBeTruthy();
  });

  it('blocks delete on the virtual parent row before it reaches the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={{ left: 0, right: 0 }}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');

    expect(operationClient.startDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('휴지통으로 이동')).toBeNull();
    expect(await screen.findByText(/현재 컨텍스트에서는 사용할 수 없습니다/)).toBeTruthy();
  });

  it('requires typed confirmation before permanent delete reaches the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-permanent-ui', kind: 'delete' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('{Shift>}d{/Shift}');
    expect(await screen.findByRole('dialog', { name: '영구 삭제' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '영구 삭제' })).toHaveProperty('disabled', true);
    expect(screen.queryByText(/PERMANENT_DELETE/)).toBeNull();
    expect(screen.getByText(/계속하려면 “generic-array-6de08afde610f112”를 입력하세요/)).toBeTruthy();

    await user.type(screen.getByLabelText('영구 삭제 확인 문구'), 'generic-array-6de08afde610f112');
    await user.click(screen.getByRole('button', { name: '영구 삭제' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [expect.stringContaining('generic-array-6de08afde610f112')],
      mode: 'permanent',
      confirmToken: 'PERMANENT_DELETE',
    }));
  });



  it('starts connected long-running copy through the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-ui', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-move-ui', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-delete-ui', kind: 'delete' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-ui', state: 'cancelling' as const } })),
      resolveConflict: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-ui', decision: 'skip' as const } })),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(screen.queryByText('Copy to opposite panel')).toBeNull();
    expect(screen.queryByLabelText('Operation status')).toBeNull();
    expect(await screen.findByLabelText('Operation status', {}, { timeout: 1000 })).toBeTruthy();
    expect(useOperationStore.getState().progress).toMatchObject({ operationId: 'op-copy-ui', kind: 'copy' });
  });

  it('creates a directory through the connected atomic command path and refreshes focus', async () => {
    const user = userEvent.setup();
    const created = { ...testEntry(SAMPLE_LISTINGS.right.path, 'New Folder'), kind: 'directory' as const };
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir').mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(
        input.panelId,
        input.path,
        [created, testEntry(input.path, 'sibling.txt')],
        input.sort,
        input.filter,
        7,
      ),
    }));
    const mutationClient = {
      createDir: vi.fn(async () => ({ ok: true as const, data: created })),
      renameEntry: vi.fn(async () => ({ ok: true as const, data: created })),
    };
    const { container } = renderCommander(dataSource, mutationClient);

    await user.keyboard('a');
    const input = await screen.findByLabelText('새 폴더 이름');
    await user.type(input, 'New Folder');
    await user.click(screen.getByRole('button', { name: '새 폴더 만들기' }));

    await waitFor(() => expect(mutationClient.createDir).toHaveBeenCalledWith({
      parent: SAMPLE_LISTINGS.right.path,
      name: 'New Folder',
    }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText('New Folder')).toBeTruthy();
    expect(focusedRowText(container)).toContain('New Folder');
  });

  it('renames the focused entry through the connected atomic command path and keeps row focus', async () => {
    const user = userEvent.setup();
    const renamed = { ...testEntry(SAMPLE_LISTINGS.right.path, '한글-이름-📦') };
    const original = SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right];
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir').mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(
        input.panelId,
        input.path,
        [renamed, testEntry(input.path, 'other.txt')],
        input.sort,
        input.filter,
        8,
      ),
    }));
    const mutationClient = {
      createDir: vi.fn(async () => ({ ok: true as const, data: renamed })),
      renameEntry: vi.fn(async () => ({ ok: true as const, data: renamed })),
    };
    const { container } = renderCommander(dataSource, mutationClient);

    await user.keyboard('{F2}');
    const input = await screen.findByLabelText('새 이름');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '한글-이름-📦' } });
    fireEvent.compositionEnd(input, { data: '한글-이름-📦' });
    await user.click(screen.getByRole('button', { name: '이름 변경' }));

    await waitFor(() => expect(mutationClient.renameEntry).toHaveBeenCalledWith({
      path: original.path,
      newName: '한글-이름-📦',
    }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText('한글-이름-📦')).toBeTruthy();
    expect(focusedRowText(container)).toContain('한글-이름-📦');
  });

  it('opens properties and enters archives as virtual directories', async () => {
    const user = userEvent.setup();
    const archiveEntry = SAMPLE_LISTINGS.left.entries.find((entry) => entry.name === 'release-bundle.zip');
    if (!archiveEntry) {
      throw new Error('archive fixture is required');
    }
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      getMetadata: vi.fn(async () => ({
        ok: true as const,
        data: {
          ...SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right],
          absolutePath: SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path,
          extension: null,
          mimeType: null,
          readonly: false,
          directoryStats: null,
        },
      })),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: {
          archivePath: archiveEntry.path,
          encrypted: false,
          totalEntries: 1,
          truncated: false,
          entries: [{
            ...testEntry(archiveEntry.path, 'inside.txt'),
            path: `${archiveEntry.path}!inside.txt`,
            sizeBytes: 2048,
            modifiedAt: '2026-07-02T23:30:28',
          }],
        },
      })),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClient);

    await user.keyboard('i');
    expect(await screen.findByRole('dialog', { name: '파일 정보' })).toBeTruthy();
    await waitFor(() => expect(mutationClient.getMetadata).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: '정보 보기' })).toBeNull();
    expect(screen.queryByText(/absolutePath/)).toBeNull();
    expect(screen.getByText(/Architecture.md/)).toBeTruthy();
    useOperationStore.getState().closeDialog();

    await user.keyboard('{Tab}');
    const archiveRow = rowByText(container, 'release-bundle.zip');
    if (!archiveRow) {
      throw new Error('archive row is required');
    }
    fireEvent.doubleClick(archiveRow);

    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath: archiveEntry.path,
      password: undefined,
      limit: 50_000,
    }));
    await waitFor(() => expect(rowByText(container, 'inside.txt')).not.toBeNull());
    expect(rowByText(container, 'inside.txt')?.textContent).toContain('2.0 KB');
    expect(rowByText(container, 'inside.txt')?.textContent).toContain('07-02 23:30');
    expect(screen.queryByRole('dialog', { name: /압축/ })).toBeNull();
  });

  it('shows archive virtual directories as read-only and reports truncated listings', () => {
    const archiveListing = {
      ...createDirectoryListing('left', '/tmp/large.zip:/', []),
      totalEntries: 80_000,
      truncated: true,
    };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: archiveListing,
        right: createDirectoryListing('right', '/tmp/target', []),
      },
    });

    render(<CommanderShell dataSource={dataSource} />);

    expect(screen.getByText('압축 내부 읽기 전용')).toBeTruthy();
    const partial = screen.getByText('일부만 표시됨');
    expect(partial.getAttribute('title')).toBe('0/80000');
  });

  it('requests a masked password and retries encrypted archive listing without exposing the secret', async () => {
    const user = userEvent.setup();
    const archiveEntry = {
      ...testEntry('/tmp', 'encrypted.7z'),
      path: '/tmp/encrypted.7z',
      kind: 'archive' as const,
    };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp', [archiveEntry]),
        right: createDirectoryListing('right', '/tmp/target', []),
      },
    });
    const archiveList = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: 'password_required',
          messageKey: 'errors.archivePasswordRequired',
          path: archiveEntry.path,
          details: {},
          recoverable: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          archivePath: archiveEntry.path,
          encrypted: true,
          totalEntries: 1,
          truncated: false,
          entries: [{
            ...testEntry(archiveEntry.path, 'secret.txt'),
            path: `${archiveEntry.path}!secret.txt`,
          }],
        },
      });
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList }}
        initialFocusIndex={{ left: 0 }}
      />,
    );

    await user.keyboard('{Tab}');
    await waitFor(() => expect(rowByText(container, 'encrypted.7z')).not.toBeNull());
    fireEvent.doubleClick(rowByText(container, 'encrypted.7z')!);

    const passwordInput = await screen.findByLabelText('암호');
    expect(passwordInput.getAttribute('type')).toBe('password');
    await user.type(passwordInput, 'top-secret');
    expect(screen.queryByText('top-secret')).toBeNull();
    await user.click(screen.getByRole('button', { name: '열기' }));

    await waitFor(() => expect(archiveList).toHaveBeenLastCalledWith({
      archivePath: archiveEntry.path,
      password: 'top-secret',
      limit: 50_000,
    }));
    await waitFor(() => expect(rowByText(container, 'secret.txt')).not.toBeNull());
    expect(screen.queryByRole('dialog', { name: '압축 파일 암호' })).toBeNull();
  });

  it('navigates archive folders with Enter and returns to the archive root with Backspace', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/navigation.zip';
    const archiveEntry = {
      ...testEntry('/tmp', 'navigation.zip'),
      path: archivePath,
      kind: 'archive' as const,
    };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp', [archiveEntry]),
        right: createDirectoryListing('right', '/tmp/target', []),
      },
    });
    let modifiedAt = '2026-09-25T12:00:00Z';
    const getMetadata = vi.fn(async () => ({
      ok: true as const,
      data: {
        ...archiveEntry,
        modifiedAt,
        absolutePath: archivePath,
        extension: 'zip',
        mimeType: 'application/zip',
        readonly: false,
        directoryStats: null,
      },
    }));
    const archiveList = vi.fn(async () => ({
      ok: true as const,
      data: {
        archivePath,
        encrypted: false,
        totalEntries: 2,
        truncated: false,
        entries: [
          { ...testEntry(archivePath, 'folder'), path: `${archivePath}!folder/`, kind: 'directory' as const },
          { ...testEntry(archivePath, 'nested.txt'), path: `${archivePath}!folder/nested.txt` },
        ],
      },
    }));
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList, getMetadata }}
        initialFocusIndex={{ left: 0 }}
      />,
    );

    await user.keyboard('{Tab}{Enter}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/`));
    await waitFor(() => expect(focusedRowText(container)).toContain('folder'));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/folder`));
    expect(rowByText(container, 'nested.txt')).not.toBeNull();

    await user.keyboard('{Backspace}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/`));
    expect(activePanelLabel(container)).not.toContain(`${archivePath}:/folder`);
    expect(archiveList).toHaveBeenCalledTimes(1);

    modifiedAt = '2026-09-25T12:00:01Z';
    await user.keyboard('{Enter}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/folder`));
    expect(archiveList).toHaveBeenCalledTimes(2);

    await user.keyboard('{Control>}r{/Control}');
    await waitFor(() => expect(archiveList).toHaveBeenCalledTimes(3));
  });

  it('selects multiple archive entries with Space and copies them to the normal panel', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/multi.zip';
    const archiveEntry = {
      ...testEntry('/tmp', 'multi.zip'),
      path: archivePath,
      kind: 'archive' as const,
    };
    const targetPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp', [archiveEntry]),
        right: createDirectoryListing('right', targetPath, []),
      },
    });
    const archiveList = vi.fn(async () => ({
      ok: true as const,
      data: {
        archivePath,
        encrypted: false,
        totalEntries: 2,
        truncated: false,
        entries: [
          { ...testEntry(archivePath, 'one.txt'), path: `${archivePath}!one.txt` },
          { ...testEntry(archivePath, 'two.txt'), path: `${archivePath}!two.txt` },
        ],
      },
    }));
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'archive-space-copy', kind: 'archiveExtract' as const, state: 'queued' as const },
      })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList }}
        operationClient={operationClient}
        initialFocusIndex={{ left: 0 }}
      />,
    );

    await user.keyboard('{Tab}{Enter}');
    await waitFor(() => expect(rowByText(container, 'one.txt')).not.toBeNull());
    await user.keyboard('{Space}{Space}y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: targetPath,
      policy: 'skip',
      entries: ['one.txt', 'two.txt'],
      stripPrefix: '',
      password: undefined,
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();
  });

  it('opens files through default app and configured external editor command paths', async () => {
    const user = userEvent.setup();
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      loadSettings: vi.fn(async () => ({
        ok: true as const,
        data: {
          schemaVersion: 1,
          theme: 'dark' as const,
          language: 'ko' as const,
          sizeFormat: 'binary' as const,
          external: { editorId: 'vim', shellCommand: { enabled: false } },
          bookmarks: [],
          layout: { singlePanel: false, ratio: '50:50' as const },
          session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
          view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
        },
      })),
      openDefault: vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } })),
      openExternalEditor: vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } })),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClient);
    await screen.findByText('Architecture.md');
    await user.keyboard('{Tab}');
    const fileRow = rowByText(container, 'Architecture.md');
    if (!fileRow) {
      throw new Error('file row is required');
    }

    await waitFor(() => expect(mutationClient.loadSettings).toHaveBeenCalled());
    await user.click(fileRow);
    await user.keyboard('o');
    expect(await screen.findByRole('dialog', { name: '기본 앱으로 열기' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '기본 앱으로 열기' }));
    await waitFor(() => expect(mutationClient.openDefault).toHaveBeenCalledWith({
      path: expect.stringContaining('Architecture.md'),
    }));
    useOperationStore.getState().closeDialog();

    await user.keyboard('e');
    expect(await screen.findByRole('dialog', { name: '터미널 편집기로 열기' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '편집기로 열기' }));
    await waitFor(() => expect(mutationClient.openExternalEditor).toHaveBeenCalledWith({
      path: expect.stringContaining('Architecture.md'),
      editorId: 'vim',
    }));
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
    render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), previewFile }}
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
    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog', { name: '빠른 보기' })).toBeNull();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('next.md');
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

  it('previews and then runs shell commands only after an enabled policy returns a confirm token', async () => {
    const user = userEvent.setup();
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      loadSettings: vi.fn(async () => ({
        ok: true as const,
        data: {
          schemaVersion: 1,
          theme: 'dark' as const,
          language: 'ko' as const,
          sizeFormat: 'binary' as const,
          external: { editorId: null, shellCommand: { enabled: true } },
          bookmarks: [],
          layout: { singlePanel: false, ratio: '50:50' as const },
          session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
          view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
        },
      })),
      prepareShellCommand: vi.fn(async () => ({
        ok: true as const,
        data: {
          confirmToken: 'confirm-shell-token',
          expiresAt: '2026-06-17T23:00:00+09:00',
          fingerprint: 'shell-fingerprint',
          requiresConfirmation: true as const,
          policy: { enabled: true, reasonKey: null },
        },
      })),
      runShellCommand: vi.fn(async () => ({
        ok: true as const,
        data: {
          exitCode: 0,
          stdout: 'hello\n',
          stderr: '',
          timedOut: false,
        },
      })),
    };
    renderCommander(createFixturePanelDataSource(), mutationClient);

    await waitFor(() => expect(mutationClient.loadSettings).toHaveBeenCalled());
    await user.keyboard(':');
    const input = await screen.findByLabelText('실행할 명령');
    await user.type(input, 'echo hello');
    await user.click(screen.getByRole('button', { name: '실행 확인' }));

    await waitFor(() => expect(mutationClient.prepareShellCommand).toHaveBeenCalledWith({
      workingDir: SAMPLE_LISTINGS.right.path,
      command: 'echo',
      args: ['hello'],
    }));
    expect(screen.queryByText(/shell-fingerprint/)).toBeNull();
    expect(screen.getAllByText(/실행 전 확인이 완료되었습니다/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '확인 후 실행' }));
    await waitFor(() => expect(mutationClient.runShellCommand).toHaveBeenCalledWith({
      workingDir: SAMPLE_LISTINGS.right.path,
      command: 'echo',
      args: ['hello'],
      confirmToken: 'confirm-shell-token',
    }));
    expect(screen.getByText(/hello/)).toBeTruthy();
  });

  it('starts archive creation through the connected operation client in the source panel directory', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveCreate: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-create', kind: 'archiveCreate' as const, state: 'queued' as const } })),
      archiveExtract: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('zc');
    expect(await screen.findByRole('dialog', { name: '압축 생성' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '압축 생성' }));

    await waitFor(() => expect(operationClient.archiveCreate).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetArchive: `${SAMPLE_LISTINGS.right.path}/generic-array-6de08afde610f112.zip`,
      format: 'zip',
    }));
  });

  it('numbers a new archive against names in the source panel directory', async () => {
    const user = userEvent.setup();
    const archiveName = 'generic-array-6de08afde610f112.zip';
    const rightListing = {
      ...SAMPLE_LISTINGS.right,
      entries: [...SAMPLE_LISTINGS.right.entries, testEntry(SAMPLE_LISTINGS.right.path, archiveName)],
    };
    const dataSource = createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: rightListing });
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveCreate: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-numbered', kind: 'archiveCreate' as const, state: 'queued' as const } })),
      archiveExtract: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(dataSource, undefined, operationClient);

    await user.keyboard('zc');
    expect(await screen.findByRole('dialog', { name: '압축 생성' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '압축 생성' }));

    await waitFor(() => expect(operationClient.archiveCreate).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetArchive: `${SAMPLE_LISTINGS.right.path}/generic-array-6de08afde610f112 (2).zip`,
      format: 'zip',
    }));
  });

  it('uses auto-extract to derive a target folder from the archive name and refresh panels', async () => {
    const user = userEvent.setup();
    const archiveEntry = SAMPLE_LISTINGS.left.entries.find((entry) => entry.name === 'release-bundle.zip');
    if (!archiveEntry) {
      throw new Error('archive fixture is required');
    }
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveCreate: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-extract-auto', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={{ left: 4, right: INITIAL_FOCUS_INDEX.right }}
        initialSelectedPaths={{ left: [archiveEntry.path], right: [] }}
      />,
    );

    await user.keyboard('{Tab}');
    await user.keyboard('za');
    expect(await screen.findByRole('dialog', { name: '압축 해제' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '압축 해제' }));

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath: expect.stringContaining('release-bundle.zip'),
      targetDir: `${SAMPLE_LISTINGS.right.path}/release-bundle`,
      policy: 'skip',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-extract-auto',
      kind: 'archiveExtract',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: SAMPLE_LISTINGS.left.path,
    })));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
  });

  it('persists bookmark/layout settings and opens registry-derived shortcut help', async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async ({ patch }: { patch: object }) => ({
      ok: true as const,
      data: {
        schemaVersion: 1,
        theme: 'dark' as const,
        language: 'ko' as const,
        sizeFormat: 'binary' as const,
        external: { editorId: null, shellCommand: { enabled: false } },
        bookmarks: [],
        layout: { singlePanel: false, ratio: '50:50' as const },
        session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
        view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
        ...patch,
      },
    }));
    renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn(), saveSettings });

    await user.keyboard('tba');
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({
        bookmarks: expect.arrayContaining([expect.objectContaining({ path: SAMPLE_LISTINGS.right.path })]),
      }),
    }));

    await user.click(screen.getByRole('button', { name: '보기(V)' }));
    await user.click(await screen.findByText('레이아웃 전환'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ layout: expect.objectContaining({ singlePanel: true }) }),
    }));

    await user.click(screen.getByRole('button', { name: '설정(S)' }));
    await user.click(await screen.findByText('아이콘 전환'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ view: expect.objectContaining({ showIcons: false }) }),
    }));
    expect(document.querySelector('.entry-icon')).toBeNull();

    await user.click(screen.getByRole('button', { name: '도움말(H)' }));
    await user.click(await screen.findByText('단축키 도움말'));
    const shortcutTitle = await screen.findByText('키보드 단축키');
    const shortcutDialog = shortcutTitle.closest<HTMLElement>('[role="dialog"]');
    if (!shortcutDialog) {
      throw new Error('shortcut dialog is required');
    }
    expect(within(shortcutDialog).getByText('복사')).toBeTruthy();
    expect(within(shortcutDialog).getByText('반대 패널로 복사')).toBeTruthy();
    expect(within(shortcutDialog).getByText('y/F5')).toBeTruthy();
    expect(within(shortcutDialog).getByText('Shift+D/Shift+Delete')).toBeTruthy();
    expect(within(shortcutDialog).getByText('Ctrl+B/tb+a')).toBeTruthy();
    expect(within(shortcutDialog).queryByText('file.copy')).toBeNull();
  });

  it('groups every shortcut and scrolls the help dialog without moving a file row', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.click(screen.getByRole('button', { name: '도움말(H)' }));
    await user.click(await screen.findByText('단축키 도움말'));

    const dialog = await screen.findByRole('dialog', { name: '키보드 단축키' });
    const scrollArea = within(dialog).getByRole('region', { name: '단축키 목록' });
    expect(document.activeElement).toBe(scrollArea);
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(
      ACTIONS.filter((action) => actionVisibleOnPlatform(action) && (action.shortcutLabel || action.keyboardBindings?.length)).length,
    );
    expect(within(dialog).getByRole('heading', { name: '이동' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: '파일' })).toBeTruthy();
    expect([...dialog.querySelectorAll('.shortcut-help-column')].map((column) =>
      column.querySelector('h3')?.textContent,
    )).toEqual(['이동', '패널', '파일', '보기']);

    Object.defineProperties(scrollArea, {
      clientHeight: { configurable: true, value: 200 },
      scrollHeight: { configurable: true, value: 600 },
    });
    const focusedPath = document.querySelector('.commander-shell')?.getAttribute('aria-activedescendant');
    expect(fireEvent.keyDown(scrollArea, { key: 'ArrowDown' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(28);
    expect(fireEvent.keyDown(scrollArea, { key: 'PageDown' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(200);
    expect(fireEvent.keyDown(scrollArea, { key: 'ArrowUp' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(172);
    expect(fireEvent.keyDown(scrollArea, { key: 'PageUp' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(0);
    expect(fireEvent.keyDown(scrollArea, { key: 'End' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(600);
    expect(fireEvent.keyDown(scrollArea, { key: 'Home' })).toBe(false);
    expect(scrollArea.scrollTop).toBe(0);
    expect(document.querySelector('.commander-shell')?.getAttribute('aria-activedescendant')).toBe(focusedPath);
  });

  it('renames a bookmark with an explicit localized name instead of an internal suffix', async () => {
    const user = userEvent.setup();
    const initialBookmark = {
      id: 'bookmark-existing',
      label: '기존 이름',
      path: SAMPLE_LISTINGS.right.path,
    };
    const baseSettings = {
      schemaVersion: 1,
      theme: 'dark' as const,
      language: 'ko' as const,
      sizeFormat: 'binary' as const,
      external: { editorId: null, shellCommand: { enabled: false } },
      bookmarks: [initialBookmark],
      layout: { singlePanel: false, ratio: '50:50' as const },
      session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
      view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
    };
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: { ...baseSettings, ...patch },
    }));
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      loadSettings: vi.fn(async () => ({ ok: true as const, data: baseSettings })),
      saveSettings,
    };
    renderCommander(createFixturePanelDataSource(), mutationClient);

    await waitFor(() => expect(mutationClient.loadSettings).toHaveBeenCalled());
    await user.click(screen.getByRole('button', { name: '이동(G)' }));
    const goMenu = await screen.findByRole('menu', { name: '이동(G) menu' });
    const bookmarkTrigger = within(goMenu).getAllByRole('menuitem')
      .find((item) => item.getAttribute('aria-haspopup') === 'menu' && item.textContent?.includes('북마크'));
    if (!bookmarkTrigger) {
      throw new Error('bookmark submenu trigger is required');
    }
    fireEvent.mouseEnter(bookmarkTrigger);
    const bookmarkMenu = await screen.findByRole('menu', { name: '북마크 submenu' });
    await user.click(within(bookmarkMenu).getByRole('menuitem', { name: '이름 변경' }));

    const input = await screen.findByLabelText('북마크 이름');
    await user.clear(input);
    await user.type(input, '프로젝트 📦');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: {
        bookmarks: [{
          ...initialBookmark,
          label: '프로젝트 📦',
        }],
      },
    }));
    expect(screen.getByLabelText('활성 패널 상태').textContent).toContain('북마크 이름 변경: 프로젝트 📦');
    expect(document.body.textContent).not.toContain('renamed');
  });

  it('uses an explicit Cmd+Q/File Quit policy instead of a bare q shortcut', async () => {
    const appController = { quit: vi.fn(async () => undefined) };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ' })).toBe(true);
    expect(appController.quit).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(true);
    expect(appController.quit).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true })).toBe(false);
    await waitFor(() => expect(appController.quit).toHaveBeenCalledOnce());
  });

  it('shows the macOS quit shortcut label as Cmd+Q in the File menu', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('{F9}{ArrowDown}');

    const fileMenu = await screen.findByRole('menu', { name: '파일(F) menu' });
    expect(within(fileMenu).getByText('Cmd+Q')).toBeTruthy();
    expect(within(fileMenu).queryByText('Ctrl+Q')).toBeNull();
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

  it('blocks Quit while a file operation is in flight', async () => {
    const appController = { quit: vi.fn(async () => undefined) };
    useOperationStore.setState({
      progress: {
        operationId: 'op-copy-active',
        kind: 'copy',
        state: 'running',
        totalFiles: 2,
        completedFiles: 1,
        totalBytes: null,
        completedBytes: 0,
        currentPath: '/tmp/source.txt',
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
    });

    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true })).toBe(false);

    expect(appController.quit).not.toHaveBeenCalled();
    expect(await screen.findByText(/종료 차단/)).toBeTruthy();
  });

  it('starts panel-to-panel drag copy through the operation client', async () => {
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-dnd-copy', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-dnd-move', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), undefined, operationClient);
    const sourceRow = rowByText(container, 'generic-array-7534a23a150ae5e7');
    const leftPanel = container.querySelector<HTMLElement>('.file-panel[aria-label^="left panel"]');
    const rightPanel = container.querySelector<HTMLElement>('.file-panel[aria-label^="right panel"]');
    if (!sourceRow || !leftPanel || !rightPanel) {
      throw new Error('drag source row and both panels are required');
    }

    fireEvent.dragStart(sourceRow, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.dragOver(rightPanel, { dataTransfer: { files: [] } });
    expect(within(rightPanel).getByText('이 위치에는 놓을 수 없음')).toBeTruthy();
    expect(rightPanel.className).toContain('is-drop-blocked');

    const moveDragOver = createEvent.dragOver(leftPanel, { dataTransfer: { files: [] } });
    Object.defineProperty(moveDragOver, 'shiftKey', { value: true });
    fireEvent(leftPanel, moveDragOver);
    expect(within(leftPanel).getByText('여기로 이동')).toBeTruthy();
    expect(leftPanel.className).toContain('is-drop-move');

    fireEvent.drop(leftPanel, { dataTransfer: { files: [] } });
    expect(within(leftPanel).queryByRole('status')).toBeNull();

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-7534a23a150ae5e7')],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('hands selected paths to a native drag session so dragging continues outside the window', async () => {
    let finishNativeDrag: ((completion: {
      result: 'Dropped' | 'Cancelled';
      clientPosition: { x: number; y: number } | null;
    }) => void) | null = null;
    const nativeFileDragClient = {
      start: vi.fn(async (
        _paths: string[],
        _mode: 'copy' | 'move',
        onResult: NonNullable<typeof finishNativeDrag>,
      ) => {
        finishNativeDrag = onResult;
      }),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn() }}
        runtimeBackendAvailable
        nativeFileDragClient={nativeFileDragClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );
    const sourceRow = rowByText(container, 'generic-array-7534a23a150ae5e7');
    if (!sourceRow) {
      throw new Error('native drag source row is required');
    }
    const dragStart = createEvent.dragStart(sourceRow, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent(sourceRow, dragStart);

    expect(dragStart.defaultPrevented).toBe(true);
    await waitFor(() => expect(nativeFileDragClient.start).toHaveBeenCalledWith(
      [expect.stringContaining('generic-array-7534a23a150ae5e7')],
      'copy',
      expect.any(Function),
    ));
    expect(await screen.findByText('외부 드래그 시작 · 1개 항목')).toBeTruthy();

    act(() => finishNativeDrag?.({ result: 'Dropped', clientPosition: null }));
    expect(await screen.findByText('외부 드래그 완료 · 1개 항목')).toBeTruthy();
  });

  it('restores HTML panel dragging after a native drag startup failure', async () => {
    const nativeFileDragClient = {
      start: vi.fn(async () => {
        throw new Error('native drag unavailable');
      }),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn() }}
        runtimeBackendAvailable
        nativeFileDragClient={nativeFileDragClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );
    const sourceRow = rowByText(container, 'generic-array-7534a23a150ae5e7');
    const leftPanel = container.querySelector<HTMLElement>('.file-panel[data-panel-id="left"]');
    if (!sourceRow || !leftPanel) {
      throw new Error('native drag fallback fixtures are required');
    }

    const failedDragStart = createEvent.dragStart(sourceRow, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent(sourceRow, failedDragStart);
    expect(failedDragStart.defaultPrevented).toBe(true);
    expect(await screen.findByText(/외부 드래그 실패:.*native drag unavailable/)).toBeTruthy();

    const fallbackDragStart = createEvent.dragStart(sourceRow, {
      dataTransfer: { setData: vi.fn(), effectAllowed: '' },
    });
    fireEvent(sourceRow, fallbackDragStart);
    expect(fallbackDragStart.defaultPrevented).toBe(false);
    fireEvent.dragOver(leftPanel, { dataTransfer: { files: [], types: [] } });
    expect(leftPanel.className).toContain('is-drop-copy');
  });

  it('treats a cancelled native drag released over the opposite panel as an internal copy', async () => {
    let finishNativeDrag: ((completion: {
      result: 'Dropped' | 'Cancelled';
      clientPosition: { x: number; y: number } | null;
    }) => void) | null = null;
    let draggedPaths: string[] = [];
    const nativeFileDragClient = {
      start: vi.fn(async (
        paths: string[],
        _mode: 'copy' | 'move',
        onResult: NonNullable<typeof finishNativeDrag>,
      ) => {
        draggedPaths = paths;
        finishNativeDrag = onResult;
      }),
    };
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-native-panel-copy', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn() }}
        operationClient={operationClient}
        runtimeBackendAvailable
        nativeFileDragClient={nativeFileDragClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );
    const sourceRow = rowByText(container, 'generic-array-7534a23a150ae5e7');
    const leftPanel = container.querySelector<HTMLElement>('.file-panel[data-panel-id="left"]');
    if (!sourceRow || !leftPanel) {
      throw new Error('native cursor drop fixtures are required');
    }
    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => leftPanel),
    });

    try {
      fireEvent.dragStart(sourceRow, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
      await waitFor(() => expect(nativeFileDragClient.start).toHaveBeenCalledOnce());
      act(() => finishNativeDrag?.({ result: 'Cancelled', clientPosition: { x: 40, y: 80 } }));

      await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
        sources: draggedPaths,
        targetDir: SAMPLE_LISTINGS.left.path,
        policy: 'skip',
      }));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      });
    }
  });

  it('keeps Shift move semantics when a native drag is dropped onto the other BokslDirGUI panel', async () => {
    let nativeDropHandler: ((event:
      | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
      | { type: 'over'; position: { x: number; y: number } }
      | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
      | { type: 'leave' }
    ) => void) | null = null;
    let draggedPaths: string[] = [];
    const nativeFileDropClient = {
      listen: vi.fn(async (handler: NonNullable<typeof nativeDropHandler>) => {
        nativeDropHandler = handler;
        return vi.fn();
      }),
    };
    const nativeFileDragClient = {
      start: vi.fn(async (paths: string[]) => {
        draggedPaths = paths;
      }),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-native-panel-move', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container, unmount } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn() }}
        operationClient={operationClient}
        runtimeBackendAvailable
        nativeFileDropClient={nativeFileDropClient}
        nativeFileDragClient={nativeFileDragClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );
    await waitFor(() => expect(nativeFileDropClient.listen).toHaveBeenCalledOnce());
    const sourceRow = rowByText(container, 'generic-array-7534a23a150ae5e7');
    const leftPanel = container.querySelector<HTMLElement>('.file-panel[data-panel-id="left"]');
    if (!sourceRow || !leftPanel || !nativeDropHandler) {
      throw new Error('native panel drag fixtures are required');
    }
    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => leftPanel),
    });

    try {
      const dragStart = createEvent.dragStart(sourceRow, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
      Object.defineProperty(dragStart, 'shiftKey', { value: true });
      fireEvent(sourceRow, dragStart);
      await waitFor(() => expect(nativeFileDragClient.start).toHaveBeenCalledOnce());
      act(() => nativeDropHandler?.({ type: 'enter', paths: draggedPaths, position: { x: 40, y: 80 } }));
      expect(leftPanel.className).toContain('is-drop-move');
      act(() => nativeDropHandler?.({ type: 'drop', paths: draggedPaths, position: { x: 40, y: 80 } }));

      expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
      expect(operationClient.startMove).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '이동' }));
      await waitFor(() => expect(operationClient.startMove).toHaveBeenCalledWith({
        sources: draggedPaths,
        targetDir: SAMPLE_LISTINGS.left.path,
        policy: 'skip',
      }));
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      });
      unmount();
    }
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

  it('copies Finder files with exact whitespace in paths into the panel under the native Tauri drop position', async () => {
    let nativeDropHandler: ((event:
      | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
      | { type: 'over'; position: { x: number; y: number } }
      | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
      | { type: 'leave' }
    ) => void) | null = null;
    const unlisten = vi.fn();
    const nativeFileDropClient = {
      listen: vi.fn(async (handler: NonNullable<typeof nativeDropHandler>) => {
        nativeDropHandler = handler;
        return unlisten;
      }),
    };
    const incomingPath = '/tmp/incoming.txt ';
    const getMetadata = vi.fn(async () => ({
      ok: true as const,
      data: {
        ...testEntry('/tmp', 'incoming.txt'),
        absolutePath: incomingPath,
        extension: 'txt',
        mimeType: 'text/plain',
        readonly: false,
        directoryStats: null,
      },
    }));
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-native-drop', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container, unmount } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), getMetadata }}
        operationClient={operationClient}
        runtimeBackendAvailable
        nativeFileDropClient={nativeFileDropClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );
    await waitFor(() => expect(nativeFileDropClient.listen).toHaveBeenCalledOnce());
    const leftPanel = container.querySelector<HTMLElement>('.file-panel[data-panel-id="left"]');
    if (!leftPanel || !nativeDropHandler) {
      throw new Error('native drop listener and left panel are required');
    }
    const previousElementFromPoint = document.elementFromPoint;
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: vi.fn(() => leftPanel),
    });

    try {
      act(() => nativeDropHandler?.({ type: 'enter', paths: [incomingPath], position: { x: 40, y: 80 } }));
      expect(leftPanel.className).toContain('is-drop-import');

      act(() => nativeDropHandler?.({ type: 'drop', paths: [incomingPath], position: { x: 40, y: 80 } }));
      await waitFor(() => expect(getMetadata).toHaveBeenCalledWith({ path: incomingPath }));
      await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
        sources: [incomingPath],
        targetDir: SAMPLE_LISTINGS.left.path,
        policy: 'skip',
      }));
      expect(leftPanel.className).not.toContain('is-drop-import');
    } finally {
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: previousElementFromPoint,
      });
      unmount();
    }
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it('dispatches registry sequence shortcuts without web text focus', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('gp');

    expect(await screen.findByLabelText('경로')).toBeTruthy();
  });

  it('supports TUI vim-style movement and range selection shortcuts', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    expect(focusedRowText(container)).toContain('generic-array-6de08afde610f112');

    await user.keyboard('j');
    expect(focusedRowText(container)).toContain('generic-array-7534a23a150ae5e7');

    await user.keyboard('k');
    expect(focusedRowText(container)).toContain('generic-array-6de08afde610f112');

    fireEvent.keyDown(document, { key: 'ㅓ', code: 'KeyJ' });
    expect(focusedRowText(container)).toContain('generic-array-7534a23a150ae5e7');

    fireEvent.keyDown(document, { key: 'ㅏ', code: 'KeyK' });
    expect(focusedRowText(container)).toContain('generic-array-6de08afde610f112');

    fireEvent.keyDown(document, { key: 'ㅕ', code: 'KeyU', ctrlKey: true });
    expect(screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-0');

    fireEvent.keyDown(document, { key: 'ㅇ', code: 'KeyD', ctrlKey: true });
    expect(screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-12');

    fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true });
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length).toBeGreaterThanOrEqual(2);

    await user.keyboard('gg');
    expect(screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-0');

    fireEvent.keyDown(document, { key: 'G', shiftKey: true });
    expect(screen.getByRole('application', { name: 'BokslDirGUI file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-32');
  });

  it('extends selection with shifted page and boundary movement keys', async () => {
    const { container } = renderCommander();
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });

    fireEvent.keyDown(document, { key: 'PageDown', shiftKey: true });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-21');
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length).toBeGreaterThanOrEqual(11);

    fireEvent.keyDown(document, { key: 'PageUp', shiftKey: true });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-9');
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length).toBeGreaterThanOrEqual(1);

    fireEvent.keyDown(document, { key: 'End', shiftKey: true });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-32');
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length).toBeGreaterThanOrEqual(10);

    fireEvent.keyDown(document, { key: 'Home', shiftKey: true });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-0');
    expect(rowByText(container, '..')?.className).not.toContain('is-selected');
  });

  it('applies selection all, invert, and clear shortcuts without browser defaults', () => {
    const { container } = renderCommander();

    expect(fireEvent.keyDown(document, { key: 'a', code: 'KeyA', ctrlKey: true })).toBe(false);
    const afterSelectAll = [...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length;
    expect(afterSelectAll).toBeGreaterThan(20);
    expect(rowByText(container, '..')?.className).not.toContain('is-selected');

    expect(fireEvent.keyDown(document, { key: 'v', code: 'KeyV' })).toBe(false);
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')]).toHaveLength(0);

    expect(fireEvent.keyDown(document, { key: 'u', code: 'KeyU' })).toBe(false);
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')]).toHaveLength(0);
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

  it('opens path, location, tab, history, bookmark, help search, and about overlays', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('gp');
    const pathInput = await screen.findByLabelText('경로');
    expect(screen.getByText('경로 이동 · 오른쪽')).toBeTruthy();
    expect(screen.queryByText('경로 이동 · RIGHT')).toBeNull();
    await user.clear(pathInput);
    await user.type(pathInput, '/tmp/navigation-target');
    await user.click(screen.getByRole('button', { name: '이동' }));
    expect(await screen.findByText('README.md')).toBeTruthy();

    await user.keyboard('gm');
    expect(await screen.findByRole('dialog', { name: '위치 목록' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tn');
    await user.keyboard('tt');
    const tabDialog = await screen.findByRole('dialog', { name: '오른쪽 탭' });
    expect(within(tabDialog).queryByText(SAMPLE_LISTINGS.right.path)).toBeNull();
    expect(within(tabDialog).getAllByText('/tmp/navigation-target')).toHaveLength(2);
    expect(within(tabDialog).getByText('활성 탭')).toBeTruthy();
    expect(within(tabDialog).queryByText('active tab')).toBeNull();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tx');
    await user.keyboard('tt');
    const closedTabDialog = await screen.findByRole('dialog', { name: '오른쪽 탭' });
    expect(within(closedTabDialog).queryByText(SAMPLE_LISTINGS.right.path)).toBeNull();
    expect(within(closedTabDialog).getByText('/tmp/navigation-target')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('th');
    const historyDialog = await screen.findByRole('dialog', { name: '오른쪽 히스토리' });
    expect(within(historyDialog).getByText('현재')).toBeTruthy();
    expect(within(historyDialog).queryByText('current')).toBeNull();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tba');
    await user.keyboard('tb');
    expect(await screen.findByRole('dialog', { name: '북마크' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.click(screen.getByRole('button', { name: '도움말(H)' }));
    await user.click(await screen.findByText('검색'));
    const helpSearchInput = await screen.findByLabelText('도움말 검색어');
    await user.type(helpSearchInput, '정렬');
    const helpSearchDialog = screen.getByRole('dialog', { name: '기능 검색' });
    expect(within(helpSearchDialog).getByText('보기 › 정렬 › 이름')).toBeTruthy();
    expect(within(helpSearchDialog).getAllByText('없음').length).toBeGreaterThan(0);
    expect(within(helpSearchDialog).queryByText('·')).toBeNull();
    expect(screen.queryByText('action registry')).toBeNull();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.click(screen.getByRole('button', { name: '도움말(H)' }));
    await user.click(await screen.findByRole('menuitem', { name: /^정보/ }));
    expect(await screen.findByRole('dialog', { name: 'BokslDirGUI' })).toBeTruthy();
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

  it('dispatches longer overlapping sequence shortcuts before the shorter timeout action', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('tba');

    await waitFor(() => {
      expect(screen.queryByText('Bookmarks · UI state')).toBeNull();
    });
    expect(screen.queryByText('Bookmarks · UI state')).toBeNull();
  });

  it('does not dispatch a pending sequence timeout after a keyboard owner appears', async () => {
    vi.useFakeTimers();
    renderCommander();
    const copyAction = ACTION_BY_ID.get('file.copy');

    if (!copyAction) {
      throw new Error('file.copy action is required');
    }

    fireEvent.keyDown(document, { key: 't' });
    fireEvent.keyDown(document, { key: 'b' });

    act(() => {
      useOperationStore.getState().openDialog({
        action: copyAction,
        panelId: 'right',
        sources: [SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right]],
        targetDir: SAMPLE_LISTINGS.left.path,
        workingDir: SAMPLE_LISTINGS.right.path,
      });
    });

    expect(screen.getByRole('dialog', { name: '복사' })).toBeTruthy();

    act(() => {
      vi.advanceTimersByTime(901);
    });

    expect(screen.queryByText('Bookmarks · UI state')).toBeNull();
  });

  it('does not capture shortcuts while typing in editable fields', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const input = document.createElement('input');
    document.body.append(input);

    input.focus();
    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
    input.remove();
  });

  it('does not capture commander Tab while an operation dialog owns focus', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    await user.keyboard('a');
    expect(await screen.findByText('새 폴더')).toBeTruthy();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('registers explicit keyboard owners for modal and menu surfaces', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('a');
    expect(await screen.findByText('새 폴더')).toBeTruthy();
    await waitFor(() => expect(commanderKeyboardOwners()).toContain('operation-dialog'));

    useOperationStore.getState().closeDialog();
    await waitFor(() => expect(commanderKeyboardOwners()).not.toContain('operation-dialog'));

    await user.click(screen.getByRole('button', { name: '파일(F)' }));
    await waitFor(() => expect(commanderKeyboardOwners()).toContain('menu-popover'));
  });

  it('focuses only the top menu bar with F9 and opens the focused menu on Down', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('{F9}');

    const fileTrigger = screen.getByRole('button', { name: '파일(F)' });
    expect(fileTrigger.getAttribute('data-state')).toBe('focused');
    expect(fileTrigger.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('menu', { name: '파일(F) menu' })).toBeNull();
    expect(commanderKeyboardOwners()).not.toContain('menu-popover');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '편집(E)' }).getAttribute('data-state')).toBe('focused');
    expect(screen.queryByRole('menu', { name: '편집(E) menu' })).toBeNull();

    await user.keyboard('{ArrowDown}');
    const fileMenu = await screen.findByRole('menu', { name: '편집(E) menu' });
    expect(within(fileMenu).getAllByRole('menuitem')[0].className).toContain('is-focused');
    expect(commanderKeyboardOwners()).toContain('menu-popover');

    await user.keyboard('{F9}');
    expect(screen.queryByRole('menu', { name: '편집(E) menu' })).toBeNull();
  });

  it('moves to the next top menu with ArrowRight instead of jumping to the first submenu', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('{F9}v');
    expect(screen.getByRole('button', { name: '보기(V)' }).getAttribute('data-state')).toBe('focused');
    expect(screen.queryByRole('menu', { name: '보기(V) menu' })).toBeNull();

    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('menu', { name: '보기(V) menu' })).toBeTruthy();

    await user.keyboard('{ArrowRight}');

    expect(await screen.findByRole('menu', { name: '이동(G) menu' })).toBeTruthy();
    expect(screen.queryByRole('menu', { name: '정렬 submenu' })).toBeNull();
  });

  it('supports top-menu accelerator letters after F9', async () => {
    const user = userEvent.setup();
    const appController = { quit: vi.fn(async () => undefined) };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    await user.keyboard('{F9}v');
    expect(screen.getByRole('button', { name: '보기(V)' }).getAttribute('data-state')).toBe('focused');
    expect(screen.queryByRole('menu', { name: '보기(V) menu' })).toBeNull();

    await user.keyboard('s');
    expect(screen.getByRole('button', { name: '설정(S)' }).getAttribute('data-state')).toBe('focused');
    expect(screen.queryByRole('menu', { name: '설정(S) menu' })).toBeNull();

    await user.keyboard('{ArrowDown}');
    expect(await screen.findByRole('menu', { name: '설정(S) menu' })).toBeTruthy();

    await user.keyboard('f');
    expect(await screen.findByRole('menu', { name: '파일(F) menu' })).toBeTruthy();

    await user.keyboard('q');
    await waitFor(() => expect(appController.quit).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu', { name: '파일(F) menu' })).toBeNull();
  });

  it('keeps Cmd+Q available while the top menu bar is focused', async () => {
    const user = userEvent.setup();
    const appController = { quit: vi.fn(async () => undefined) };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    await user.keyboard('{F9}');

    expect(screen.getByRole('button', { name: '파일(F)' }).getAttribute('data-state')).toBe('focused');
    expect(screen.queryByRole('menu', { name: '파일(F) menu' })).toBeNull();

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(false);
    expect(appController.quit).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true })).toBe(false);

    await waitFor(() => expect(appController.quit).toHaveBeenCalledOnce());
  });

  it('keeps Cmd+Q available while a top menu popover owns keyboard focus', async () => {
    const user = userEvent.setup();
    const appController = { quit: vi.fn(async () => undefined) };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    await user.keyboard('{F9}{ArrowDown}');

    expect(await screen.findByRole('menu', { name: '파일(F) menu' })).toBeTruthy();
    await waitFor(() => expect(commanderKeyboardOwners()).toEqual(['menu-popover']));

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(false);
    expect(appController.quit).not.toHaveBeenCalled();

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true })).toBe(false);

    await waitFor(() => expect(appController.quit).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu', { name: '파일(F) menu' })).toBeNull();
  });

  it('supports submenu keyboard navigation from the F9 menu', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('{F9}');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '편집(E)' }).getAttribute('data-state')).toBe('focused');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: '보기(V)' }).getAttribute('data-state')).toBe('focused');
    expect(screen.queryByRole('menu', { name: '보기(V) menu' })).toBeNull();
    await user.keyboard('{ArrowDown}');
    const viewMenu = await screen.findByRole('menu', { name: '보기(V) menu' });
    const sortIndex = within(viewMenu).getAllByRole('menuitem')
      .findIndex((item) => item.textContent?.includes('정렬'));
    expect(sortIndex).toBeGreaterThanOrEqual(0);
    for (let index = 0; index < sortIndex; index += 1) {
      await user.keyboard('{ArrowDown}');
    }
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menu', { name: '정렬 submenu' })).toBeTruthy();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      sort: expect.objectContaining({ field: 'name', direction: 'asc' }),
    })));
    expect(screen.queryByRole('menu', { name: '보기(V) menu' })).toBeNull();
  });

  it('keeps same-type keyboard owners registered until all mounts unmount', async () => {
    const { rerender, unmount } = render(
      <>
        <KeyboardOwnerProbe label="first" />
        <KeyboardOwnerProbe label="second" />
      </>,
    );

    await waitFor(() => expect(commanderKeyboardOwners()).toEqual(['menu-popover']));

    rerender(<KeyboardOwnerProbe label="first" />);
    await waitFor(() => expect(commanderKeyboardOwners()).toEqual(['menu-popover']));

    unmount();
    await waitFor(() => expect(commanderKeyboardOwners()).toEqual([]));
  });

  it('does not capture commander Tab while a menu popover owns focus', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    await user.click(screen.getByRole('button', { name: '파일(F)' }));
    expect(document.querySelector('.menu-popover')).not.toBeNull();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('does not capture Space from focused native buttons inside the shell', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const refreshButton = screen.getByLabelText('오른쪽 탐색 컨트롤').querySelectorAll('button')[3];

    if (!refreshButton) {
      throw new Error('refresh button is required');
    }
    refreshButton.focus();
    await user.keyboard('{Space}');

    expect(focusedRow(container)?.className).toContain('is-selected');
  });

  it('returns keyboard ownership to the commander after non-modal path button clicks', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const refreshButton = screen.getByLabelText('오른쪽 탐색 컨트롤').querySelectorAll('button')[3];

    if (!refreshButton) {
      throw new Error('refresh button is required');
    }
    await user.click(refreshButton);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('application', { name: 'BokslDirGUI file commander shell' })));

    await user.keyboard('{Space}');
    expect(focusedRowText(container)).toContain('generic-array-7534a23a150ae5e7');
  });

  it('scales font, density variables, and persists zoom settings with Cmd/Ctrl +/-/0', async () => {
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: {
        schemaVersion: 1,
        theme: 'dark' as const,
        language: 'ko' as const,
        sizeFormat: 'binary' as const,
        external: { editorId: null, shellCommand: { enabled: false } },
        bookmarks: [],
        layout: { singlePanel: false, ratio: '50:50' as const },
        session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
        view: { zoomStep: patch.view?.zoomStep ?? 0, density: 'compact' as const, showIcons: patch.view?.showIcons ?? true },
      },
    }));
    renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn(), saveSettings });
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });
    const beforeRowHeight = shell.style.getPropertyValue('--row-height');

    fireEvent.keyDown(document, { key: '=', metaKey: true });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ view: expect.objectContaining({ zoomStep: 1 }) }),
    }));

    expect(shell.style.getPropertyValue('--row-height')).not.toBe(beforeRowHeight);
    expect(shell.style.getPropertyValue('--commander-font-size')).not.toBe('16px');
    expect(await screen.findByText('화면 배율 · 110%')).toBeTruthy();

    fireEvent.keyDown(document, { key: '0', metaKey: true });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ view: expect.objectContaining({ zoomStep: 0 }) }),
    }));
    expect(await screen.findByText('화면 배율 · 100%')).toBeTruthy();
  });

  it('opens the right-clicked row from the context menu instead of the previous focused row', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const contextTarget = rowByText(container, 'getrandom-24ce5e891f8ae242');

    if (!contextTarget) {
      throw new Error('context-menu target row is required');
    }
    fireEvent.contextMenu(contextTarget);
    await user.click(await screen.findByRole('menuitem', { name: /^열기/ }));

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('getrandom-24ce5e891f8ae242');
  });


  it('opens the focused row context menu from keyboard menu keys', async () => {
    const user = userEvent.setup();
    renderCommander();

    fireEvent.keyDown(document, { key: 'F10', shiftKey: true });
    await user.click(await screen.findByRole('menuitem', { name: /^열기/ }));

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('generic-array-6de08afde610f112');
  });

  it('opens a blank-area context menu for panel-scope actions', async () => {
    const user = userEvent.setup();
    const createDir = vi.fn(async () => ({
      ok: true as const,
      data: { ...SAMPLE_LISTINGS.right.entries[0], path: `${SAMPLE_LISTINGS.right.path}/New Folder`, name: 'New Folder', kind: 'directory' as const },
    }));
    const { container } = renderCommander(createFixturePanelDataSource(), { createDir, renameEntry: vi.fn() });
    const blankArea = container.querySelector<HTMLElement>('.file-panel.is-active .file-table-scroll');

    if (!blankArea) {
      throw new Error('blank panel area is required');
    }
    fireEvent.contextMenu(blankArea);
    expect(await screen.findByRole('menuitem', { name: /새 폴더/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /새로고침/ })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: /새 폴더/ }));

    expect(await screen.findByText('새 폴더')).toBeTruthy();
    expect(screen.getByLabelText('새 폴더 이름')).toBeTruthy();
  });


  it('applies direct Settings menu actions visibly and persists them', async () => {
    const user = userEvent.setup();
    let savedSettings: import('../domain/types').Settings = {
      schemaVersion: 1,
      theme: 'dark' as const,
      language: 'ko' as const,
      sizeFormat: 'binary' as const,
      external: { editorId: null, shellCommand: { enabled: false } },
      bookmarks: [],
      layout: { singlePanel: false, ratio: '50:50' as const },
      session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
      view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
    };
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => {
      savedSettings = { ...savedSettings, ...patch };
      return { ok: true as const, data: savedSettings };
    });
    renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn(), saveSettings });
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });

    await user.click(screen.getByRole('button', { name: '설정(S)' }));
    const toggleIconsItem = await screen.findByRole('menuitem', { name: /아이콘 전환/ });
    expect(toggleIconsItem.getAttribute('data-checked')).toBe('true');
    expect(toggleIconsItem.querySelector('.menu-checkmark-inline')?.textContent).toBe('✓');
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /테마/ }));
    await user.click(await screen.findByRole('menuitem', { name: /라이트/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { theme: 'light' } }));
    expect(shell.getAttribute('data-theme')).toBe('light');
    expect(document.body.dataset.theme).toBe('light');

    await user.click(screen.getByRole('button', { name: '설정(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /테마/ }));
    await user.click(await screen.findByRole('menuitem', { name: /고대비/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { theme: 'highContrast' } }));
    expect(shell.getAttribute('data-theme')).toBe('highContrast');
    expect(document.body.dataset.theme).toBe('highContrast');

    await user.click(screen.getByRole('button', { name: '설정(S)' }));
    const languageSubmenu = await screen.findByRole('menuitem', { name: /언어/ });
    expect(languageSubmenu.querySelector('.menu-checkmark')).toBeNull();
    fireEvent.mouseEnter(languageSubmenu);
    expect((await screen.findByRole('menuitem', { name: /한국어/ })).getAttribute('data-checked')).toBe('true');
    expect((await screen.findByRole('menuitem', { name: /영어/ })).getAttribute('data-checked')).toBe('false');
    await user.click(await screen.findByRole('menuitem', { name: /영어/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { language: 'en' } }));
    expect(shell.getAttribute('data-language')).toBe('en');

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    const englishLanguageSubmenu = await screen.findByRole('menuitem', { name: /Language/ });
    expect(englishLanguageSubmenu.querySelector('.menu-checkmark')).toBeNull();
    fireEvent.mouseEnter(englishLanguageSubmenu);
    expect((await screen.findByRole('menuitem', { name: /^English$/ })).getAttribute('data-checked')).toBe('true');
    expect((await screen.findByRole('menuitem', { name: /^Korean$/ })).getAttribute('data-checked')).toBe('false');
    await user.keyboard('{Escape}');

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /Default Editor/ }));
    await user.click(await screen.findByRole('menuitem', { name: /vim/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: { external: { editorId: 'vim', shellCommand: { enabled: false } } },
    }));
    expect(await screen.findByText('Default editor · vim')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /File Size Format/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Bytes/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { sizeFormat: 'decimal' } }));
    expect(shell.getAttribute('data-size-format')).toBe('decimal');
    expect(screen.getByText('23100 B')).toBeTruthy();
  });

  it('restores saved session panel paths and persists later navigation paths', async () => {
    const loadSettings = vi.fn(async () => ({
      ok: true as const,
      data: {
        schemaVersion: 1,
        theme: 'dark' as const,
        language: 'ko' as const,
        sizeFormat: 'binary' as const,
        external: { editorId: null, shellCommand: { enabled: false } },
        bookmarks: [],
        layout: { singlePanel: false, ratio: '50:50' as const },
        session: { leftPath: '/saved/left', rightPath: '/saved-right', activePanel: 'left' as const },
        view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
      },
    }));
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: {
        schemaVersion: 1,
        theme: 'dark' as const,
        language: 'ko' as const,
        sizeFormat: 'binary' as const,
        external: { editorId: null, shellCommand: { enabled: false } },
        bookmarks: [],
        layout: { singlePanel: false, ratio: '50:50' as const },
        session: patch.session ?? { leftPath: '/saved/left', rightPath: '/saved-right', activePanel: 'left' as const },
        view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
      },
    }));
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: true,
      initial: emptyListings('/boot-left', '/boot-right'),
    });

    render(<CommanderShell dataSource={dataSource} mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), loadSettings, saveSettings }} />);

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

  it('reports settings save failures instead of pretending persistence succeeded', async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'save_failed', messageKey: 'errors.settingsSaveFailed', path: null, details: {}, retryable: true, recoverable: true },
    }));
    renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn(), saveSettings });

    await user.click(screen.getByRole('button', { name: '설정(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /테마/ }));
    await user.click(await screen.findByRole('menuitem', { name: /라이트/ }));

    expect(await screen.findByText('설정 저장 실패: 설정 저장에 실패했습니다.')).toBeTruthy();
  });

  it('keeps browser preview settings local instead of invoking unavailable Tauri settings commands', async () => {
    const loadSettings = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'io_error', messageKey: 'errors.tauriInvokeFailed', path: null, details: {}, retryable: true, recoverable: true },
    }));
    const saveSettings = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'io_error', messageKey: 'errors.tauriInvokeFailed', path: null, details: {}, retryable: true, recoverable: true },
    }));
    render(<CommanderShell
      dataSource={createFixturePanelDataSource()}
      mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), loadSettings, saveSettings }}
      runtimeBackendAvailable={false}
    />);

    expect(await screen.findByText('미리보기 모드입니다. 실제 복사/삭제/이동 같은 파일 작업은 데스크톱 앱에서만 동작합니다.')).toBeTruthy();
    expect(loadSettings).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: '=', metaKey: true });

    expect(await screen.findByText('화면 배율 · 110%')).toBeTruthy();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByText(/설정 읽기 실패|설정 저장 실패/)).toBeNull();
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

const activePanelLabel = (container: HTMLElement) =>
  container.querySelector('.file-panel.is-active')?.getAttribute('aria-label') ?? '';

const focusedRow = (container: HTMLElement) => container.querySelector('.file-panel.is-active .file-row.is-focused');

const focusedRowText = (container: HTMLElement) => focusedRow(container)?.textContent ?? '';

const rowByText = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll<HTMLElement>('.file-panel.is-active .file-row')]
    .find((row) => row.textContent?.includes(text)) ?? null;


interface MockedPanelDataSourceOptions {
  initial: Record<'left' | 'right', DirectoryListing>;
  loadInitialOnMount: boolean;
  loadResult?: Record<'left' | 'right', DirectoryListing>;
  loadError?: AppError;
}

const mockedPanelDataSource = ({
  initial,
  loadInitialOnMount,
  loadResult = initial,
  loadError,
}: MockedPanelDataSourceOptions): PanelDataSource => ({
  initialListings: initial,
  loadInitialOnMount,
  loadInitialListings: vi.fn(async () => loadError
    ? ({ left: { ok: false as const, error: loadError }, right: { ok: false as const, error: loadError } })
    : ({ left: { ok: true as const, data: loadResult.left }, right: { ok: true as const, data: loadResult.right } })),
  listDir: vi.fn(async (input) => ({
    ok: true as const,
    data: createDirectoryListing(input.panelId, input.path, [testEntry(input.path, 'child.txt')], input.sort, input.filter, 3),
  })),
  gotoPath: vi.fn(async (input) => ({
    ok: true as const,
    data: createDirectoryListing(input.panelId, input.path, [testEntry(input.path, 'goto-child.txt')], DEFAULT_SORT, null, 3),
  })),
  listLocations: vi.fn(async () => ({
    ok: true as const,
    data: { home: loadResult.right.path, roots: [loadResult.left.path], recent: [loadResult.right.path], bookmarks: [] },
  })),
});

const emptyListings = (leftPath: string, rightPath: string): Record<'left' | 'right', DirectoryListing> => ({
  left: createDirectoryListing('left', leftPath, []),
  right: createDirectoryListing('right', rightPath, []),
});

const testEntry = (parent: string, name: string) => ({
  path: `${parent}/${name}`,
  name,
  kind: 'file' as const,
  sizeBytes: 1,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  owner: 'boksl',
  group: 'staff',
  isHidden: false,
  isVirtual: false,
});

function KeyboardOwnerProbe({ label }: { label: string }) {
  useCommanderKeyboardOwner('menu-popover');
  return <div>{label}</div>;
}


describe('review: navigation and persistence races', () => {
  it('loads initial listings under StrictMode effect replay', async () => {
    const dataSource = mockedPanelDataSource({ loadInitialOnMount: true,
      initial: emptyListings('/boot-left', '/boot-right'),
      loadResult: {
        left: createDirectoryListing('left', '/real-left', [testEntry('/real-left', 'strict-left.txt')]),
        right: createDirectoryListing('right', '/real-right', [testEntry('/real-right', 'strict-right.txt')]),
      },
    });
    render(<StrictMode><CommanderShell dataSource={dataSource} mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn() }} /></StrictMode>);
    expect(await screen.findByText('strict-left.txt')).toBeTruthy();
    expect(await screen.findByText('strict-right.txt')).toBeTruthy();
  });

  it('refreshes current paths after copy without switching the active panel or stealing input focus', async () => {
    const dataSource = createFixturePanelDataSource();
    const listDir = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'review-path', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(), startDelete: vi.fn(), cancelOperation: vi.fn(), resolveConflict: vi.fn(),
    };
    const { container } = renderCommander(dataSource, { createDir: vi.fn(), renameEntry: vi.fn() }, operationClient);
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
    act(() => useOperationStore.getState().applyOperationSummary({ operationId: 'review-path', kind: 'copy', state: 'completed',
      completedFiles: 1, failedFiles: 0, errors: [] }));
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
    const { container } = renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn(), saveSettings });
    fireEvent.keyDown(document, { key: '=', metaKey: true });
    await waitFor(() => expect(pending).toHaveLength(1));
    fireEvent.keyDown(document, { key: '=', metaKey: true });
    expect(saveSettings).toHaveBeenCalledTimes(1);
    const settings: Settings = { schemaVersion: 1, theme: 'dark', language: 'ko', sizeFormat: 'binary',
      external: { editorId: null, shellCommand: { enabled: false } }, bookmarks: [],
      layout: { singlePanel: false, ratio: '50:50' }, session: { leftPath: null, rightPath: null, activePanel: 'right' },
      view: { zoomStep: 1, density: 'compact', showIcons: true } };
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
    const { container } = renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn() });
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

  it('handles the maximum archive listing size without spreading entries into function arguments', () => {
    const entries = Array.from({ length: 200_000 }, () => testEntry('/large', 'same.txt'));
    expect(columnLayoutForPanelWidth(170 * 8, 1, entries).gridTemplateColumns).toContain('minmax');
  });
});

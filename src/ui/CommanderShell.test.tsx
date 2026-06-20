// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ACTION_BY_ID } from '../actions/registry';
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
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('Copy');
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('Panel');
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('Filter');
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
    expect(row?.getAttribute('aria-label')).toBe('very-long-project-configuration-file.generated.json, file, 1 B');
    expect(row?.getAttribute('aria-description')).toContain('권한: -rw-r--r--');
    expect(row?.querySelector('.middle-ellipsis-start')).toBeTruthy();
    expect(row?.querySelector('.middle-ellipsis-end')?.textContent).toMatch(/\.json$/);
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
    renderCommander(dataSource);

    await user.keyboard('{Enter}');

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('generic-array-6de08afde610f112');
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
    const input = await screen.findByLabelText('Filter pattern');
    await user.type(input, 'generic');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'generic' })));
    expect(screen.getAllByText('Filter: generic').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.filter-chip')?.textContent).toContain('FILTER generic');
    expect(document.querySelector('.filter-match')?.textContent?.toLowerCase()).toBe('generic');

    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'generic' })));

    await user.keyboard('/');
    await user.click(await screen.findByRole('button', { name: 'Clear filter' }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: null })));
    expect(screen.queryByText('Filter: generic')).toBeNull();
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
    await user.type(await screen.findByLabelText('Filter pattern'), 'generic');
    await user.click(screen.getByRole('button', { name: 'Apply filter' }));

    await waitFor(() => expect(pending).toHaveLength(1));
    expect(screen.getAllByText('Filter: generic').length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector('.filter-chip')?.textContent).toContain('FILTER generic');

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

    expect(screen.getByText(/브라우저 미리보기 모드입니다/)).toBeTruthy();

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

    expect(await screen.findByText('Move to opposite panel')).toBeTruthy();
    expect(operationClient.startMove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(operationClient.startMove).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
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
    expect(await screen.findByText('Delete')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));

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
    expect(await screen.findByText('Delete')).toBeTruthy();
    expect(screen.getByText('Delete target')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [stalePath],
      mode: 'trash',
    }));
    await waitFor(() => expect(screen.queryByText('Delete')).toBeNull());
    expect(screen.queryByText(/not_found: errors.notFound/)).toBeNull();
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText(/Delete 대상이 이미 없습니다/)).toBeTruthy();
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
    expect(screen.queryByText('Delete')).toBeNull();
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
    expect(await screen.findByText('Permanent Delete')).toBeTruthy();
    expect(screen.getByRole('button', { name: '영구 삭제 확인' })).toHaveProperty('disabled', true);

    await user.type(screen.getByLabelText('영구 삭제 확인 문구(PERMANENT_DELETE)'), 'PERMANENT_DELETE');
    await user.click(screen.getByRole('button', { name: '영구 삭제 확인' }));

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
    await user.click(screen.getByRole('button', { name: '확인' }));

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
    const renamed = { ...testEntry(SAMPLE_LISTINGS.right.path, 'renamed-entry') };
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
    await user.clear(input);
    await user.type(input, 'renamed-entry');
    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(mutationClient.renameEntry).toHaveBeenCalledWith({
      path: original.path,
      newName: 'renamed-entry',
    }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText('renamed-entry')).toBeTruthy();
    expect(focusedRowText(container)).toContain('renamed-entry');
  });

  it('opens properties and archive previews through mocked Tauri atomic clients', async () => {
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
        },
      })),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: {
          archivePath: archiveEntry.path,
          encrypted: false,
          entries: [testEntry(archiveEntry.path, 'inside.txt')],
        },
      })),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClient);

    await user.keyboard('i');
    expect(await screen.findByText('Properties')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(mutationClient.getMetadata).toHaveBeenCalledOnce());
    expect(screen.getByText(/absolutePath/)).toBeTruthy();
    useOperationStore.getState().closeDialog();

    await user.keyboard('{Tab}');
    const archiveRow = rowByText(container, 'release-bundle.zip');
    if (!archiveRow) {
      throw new Error('archive row is required');
    }
    fireEvent.contextMenu(archiveRow);
    await user.click(await screen.findByText('Preview'));
    await user.click(await screen.findByRole('button', { name: '확인' }));

    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({ archivePath: archiveEntry.path }));
    expect(screen.getByText(/inside.txt/)).toBeTruthy();
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
    expect(await screen.findByText('Open with Default App')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(mutationClient.openDefault).toHaveBeenCalledWith({
      path: expect.stringContaining('Architecture.md'),
    }));
    useOperationStore.getState().closeDialog();

    await user.keyboard('e');
    expect(await screen.findByText('Open Terminal Editor')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));
    await waitFor(() => expect(mutationClient.openExternalEditor).toHaveBeenCalledWith({
      path: expect.stringContaining('Architecture.md'),
      editorId: 'vim',
    }));
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
    const input = await screen.findByLabelText('실행할 명령(command arg1 arg2)');
    await user.type(input, 'echo hello');
    await user.click(screen.getByRole('button', { name: 'Preview disabled' }));

    await waitFor(() => expect(mutationClient.prepareShellCommand).toHaveBeenCalledWith({
      workingDir: SAMPLE_LISTINGS.right.path,
      command: 'echo',
      args: ['hello'],
    }));
    expect(screen.getAllByText(/shell-fingerprint/).length).toBeGreaterThan(0);

    await user.click(screen.getByRole('button', { name: '확인 후 실행' }));
    await waitFor(() => expect(mutationClient.runShellCommand).toHaveBeenCalledWith({
      workingDir: SAMPLE_LISTINGS.right.path,
      command: 'echo',
      args: ['hello'],
      confirmToken: 'confirm-shell-token',
    }));
    expect(screen.getByText(/hello/)).toBeTruthy();
  });

  it('starts archive creation through the connected operation client with the opposite panel target', async () => {
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
    expect(await screen.findByText('Create Archive')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(operationClient.archiveCreate).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetArchive: expect.stringMatching(new RegExp(`^${SAMPLE_LISTINGS.left.path}/archive-\\d+\\.zip$`)),
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
    expect(await screen.findByText('Extract Archive')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));

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

    await user.click(screen.getByRole('button', { name: 'View(V)' }));
    await user.click(await screen.findByText('Toggle Layout'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ layout: expect.objectContaining({ singlePanel: true }) }),
    }));

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    await user.click(await screen.findByText('Toggle Icons'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ view: expect.objectContaining({ showIcons: false }) }),
    }));
    expect(document.querySelector('.entry-icon')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Help(H)' }));
    await user.click(await screen.findByText('Keyboard Help'));
    expect(await screen.findByText('Keyboard Shortcuts')).toBeTruthy();
    expect(screen.getByText('file.copy')).toBeTruthy();
  });

  it('uses an explicit Ctrl+Q/File Quit policy instead of a bare q shortcut', async () => {
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

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(false);
    await waitFor(() => expect(appController.quit).toHaveBeenCalledOnce());
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

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(false);

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

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', ctrlKey: true })).toBe(false);

    expect(appController.quit).not.toHaveBeenCalled();
    expect(await screen.findByText(/Quit 차단/)).toBeTruthy();
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
    if (!sourceRow || !leftPanel) {
      throw new Error('drag source row and left panel are required');
    }

    fireEvent.dragStart(sourceRow, { dataTransfer: { setData: vi.fn(), effectAllowed: '' } });
    fireEvent.drop(leftPanel, { dataTransfer: { files: [] } });

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-7534a23a150ae5e7')],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
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
    expect(await screen.findByText('External drop은 OS 파일 경로가 확인될 때만 import 대상으로 허용합니다.')).toBeTruthy();
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

  it('dispatches registry sequence shortcuts without web text focus', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('gp');

    expect(await screen.findByLabelText('Path')).toBeTruthy();
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
    const pathInput = await screen.findByLabelText('Path');
    await user.clear(pathInput);
    await user.type(pathInput, '/tmp/navigation-target');
    await user.click(screen.getByRole('button', { name: '이동' }));
    expect(await screen.findByText('README.md')).toBeTruthy();

    await user.keyboard('gm');
    expect(await screen.findByRole('dialog', { name: 'Locations' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tn');
    await user.keyboard('tt');
    const tabDialog = await screen.findByRole('dialog', { name: 'RIGHT Tabs' });
    expect(within(tabDialog).getByText(SAMPLE_LISTINGS.right.path)).toBeTruthy();
    expect(within(tabDialog).getByText('/tmp/navigation-target')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tx');
    await user.keyboard('tt');
    const closedTabDialog = await screen.findByRole('dialog', { name: 'RIGHT Tabs' });
    expect(within(closedTabDialog).getByText(SAMPLE_LISTINGS.right.path)).toBeTruthy();
    expect(within(closedTabDialog).queryByText('/tmp/navigation-target')).toBeNull();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('th');
    expect(await screen.findByRole('dialog', { name: 'RIGHT History' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tba');
    await user.keyboard('tb');
    expect(await screen.findByRole('dialog', { name: 'Bookmarks' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.click(screen.getByRole('button', { name: 'Help(H)' }));
    await user.click(await screen.findByText('Search'));
    expect(await screen.findByLabelText('Help search query')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.click(screen.getByRole('button', { name: 'Help(H)' }));
    await user.click(await screen.findByText('About'));
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
    expect(screen.queryByRole('dialog', { name: 'Locations' })).toBeNull();

    act(() => pending[1]({
      ok: true,
      data: { home: '/fresh', roots: ['/fresh-root'], recent: ['/fresh-recent'], bookmarks: [] },
    }));

    const locationsDialog = await screen.findByRole('dialog', { name: 'Locations' });
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

    expect(screen.getByText('Copy to opposite panel')).toBeTruthy();

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
    expect(await screen.findByText('Create Directory')).toBeTruthy();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('registers explicit keyboard owners for modal and menu surfaces', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('a');
    expect(await screen.findByText('Create Directory')).toBeTruthy();
    await waitFor(() => expect(commanderKeyboardOwners()).toContain('operation-dialog'));

    useOperationStore.getState().closeDialog();
    await waitFor(() => expect(commanderKeyboardOwners()).not.toContain('operation-dialog'));

    await user.click(screen.getByRole('button', { name: 'File(F)' }));
    await waitFor(() => expect(commanderKeyboardOwners()).toContain('menu-popover'));
  });

  it('opens the top menu with F9 and navigates root menus with the keyboard', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('{F9}');

    const fileMenu = await screen.findByRole('menu', { name: 'File menu' });
    expect(within(fileMenu).getAllByRole('menuitem')[0].textContent).toContain('Open');
    expect(within(fileMenu).getAllByRole('menuitem')[0].className).toContain('is-focused');
    expect(commanderKeyboardOwners()).toContain('menu-popover');

    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menu', { name: 'Edit menu' })).toBeTruthy();

    await user.keyboard('{F9}');
    expect(screen.queryByRole('menu', { name: 'Edit menu' })).toBeNull();
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
    expect(await screen.findByRole('menu', { name: 'View menu' })).toBeTruthy();

    await user.keyboard('s');
    expect(await screen.findByRole('menu', { name: 'Settings menu' })).toBeTruthy();

    await user.keyboard('f');
    expect(await screen.findByRole('menu', { name: 'File menu' })).toBeTruthy();

    await user.keyboard('q');
    await waitFor(() => expect(appController.quit).toHaveBeenCalledOnce());
    expect(screen.queryByRole('menu', { name: 'File menu' })).toBeNull();
  });

  it('supports submenu keyboard navigation from the F9 menu', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    renderCommander(dataSource);

    await user.keyboard('{F9}');
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menu', { name: 'Edit menu' })).toBeTruthy();
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menu', { name: 'View menu' })).toBeTruthy();

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowRight}');
    expect(await screen.findByRole('menu', { name: 'Sort submenu' })).toBeTruthy();

    await user.keyboard('{Enter}');
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      sort: expect.objectContaining({ field: 'name', direction: 'asc' }),
    })));
    expect(screen.queryByRole('menu', { name: 'View menu' })).toBeNull();
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

    await user.click(screen.getByRole('button', { name: 'File(F)' }));
    expect(document.querySelector('.menu-popover')).not.toBeNull();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('does not capture Space from focused native buttons inside the shell', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const refreshButton = screen.getByLabelText('right navigation controls').querySelectorAll('button')[3];

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
    const refreshButton = screen.getByLabelText('right navigation controls').querySelectorAll('button')[3];

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
    expect(await screen.findByText('Zoom · 110%')).toBeTruthy();

    fireEvent.keyDown(document, { key: '0', metaKey: true });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ view: expect.objectContaining({ zoomStep: 0 }) }),
    }));
    expect(await screen.findByText('Zoom · 100%')).toBeTruthy();
  });

  it('opens the right-clicked row from the context menu instead of the previous focused row', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const contextTarget = rowByText(container, 'getrandom-24ce5e891f8ae242');

    if (!contextTarget) {
      throw new Error('context-menu target row is required');
    }
    fireEvent.contextMenu(contextTarget);
    await user.click(await screen.findByRole('menuitem', { name: /Open/ }));

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('getrandom-24ce5e891f8ae242');
  });


  it('opens the focused row context menu from keyboard menu keys', async () => {
    const user = userEvent.setup();
    renderCommander();

    fireEvent.keyDown(document, { key: 'F10', shiftKey: true });
    await user.click(await screen.findByRole('menuitem', { name: /Open/ }));

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
    expect(await screen.findByRole('menuitem', { name: /New Folder/ })).toBeTruthy();
    expect(screen.getByRole('menuitem', { name: /Refresh/ })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: /New Folder/ }));

    expect(await screen.findByText('Create Directory')).toBeTruthy();
    expect(screen.getByLabelText('새 폴더 이름')).toBeTruthy();
  });


  it('applies direct Settings menu actions visibly and persists them', async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: {
        schemaVersion: 1,
        theme: patch.theme ?? 'dark' as const,
        language: patch.language ?? 'ko' as const,
        sizeFormat: patch.sizeFormat ?? 'binary' as const,
        external: patch.external ?? { editorId: null, shellCommand: { enabled: false } },
        bookmarks: [],
        layout: { singlePanel: false, ratio: '50:50' as const },
        session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
        view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
      },
    }));
    renderCommander(createFixturePanelDataSource(), { createDir: vi.fn(), renameEntry: vi.fn(), saveSettings });
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /Theme/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Light/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { theme: 'light' } }));
    expect(shell.getAttribute('data-theme')).toBe('light');

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /Language/ }));
    await user.click(await screen.findByRole('menuitem', { name: /English/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { language: 'en' } }));
    expect(shell.getAttribute('data-language')).toBe('en');

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

    await user.click(screen.getByRole('button', { name: 'Settings(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /Theme/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Light/ }));

    expect(await screen.findByText('설정 저장 실패: errors.settingsSaveFailed')).toBeTruthy();
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

    expect(await screen.findByText('브라우저 미리보기 모드입니다. 실제 복사/삭제/이동 같은 파일 작업은 Tauri 앱에서만 동작합니다. `npm run tauri:dev`로 실행하세요.')).toBeTruthy();
    expect(loadSettings).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: '=', metaKey: true });

    expect(await screen.findByText('Zoom · 110%')).toBeTruthy();
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
    expect(screen.getByText('Error: errors.permissionDenied')).toBeTruthy();
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
    expect((await screen.findAllByText('Error: errors.permissionDenied')).length).toBeGreaterThan(0);
    unmount();

    const emptySource = mockedPanelDataSource({
      loadInitialOnMount: true,
      initial: emptyListings('/empty-left', '/empty-right'),
      loadResult: emptyListings('/empty-left', '/empty-right'),
    });
    render(<CommanderShell dataSource={emptySource} />);
    expect((await screen.findAllByText('Empty directory')).length).toBeGreaterThan(0);
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

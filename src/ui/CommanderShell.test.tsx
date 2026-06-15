// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ACTION_BY_ID } from '../actions/registry';
import { useOperationStore } from '../operations/operationStore';
import { CommanderShell, columnLayoutForPanelWidth } from './CommanderShell';
import type { AppError, DirectoryListing, PanelId } from '../domain/types';
import type { ListDirInput } from '../tauri/client';
import type { PanelDataSource } from './panelDataSource';
import { createFixturePanelDataSource } from './panelDataSource';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { createDirectoryListing, DEFAULT_SORT } from './panelState';
import { commanderKeyboardOwners, useCommanderKeyboardOwner } from './keyboardOwnership';

afterEach(() => {
  vi.useRealTimers();
  useOperationStore.getState().closeDialog();
  cleanup();
});

const commanderElement = (
  dataSource: PanelDataSource = createFixturePanelDataSource(),
  mutationClient?: ComponentProps<typeof CommanderShell>['mutationClient'],
  operationClient?: ComponentProps<typeof CommanderShell>['operationClient'],
) => (
  <CommanderShell
    dataSource={dataSource}
    mutationClient={mutationClient}
    operationClient={operationClient}
    initialFocusIndex={INITIAL_FOCUS_INDEX}
    initialSelectedPaths={INITIAL_SELECTED_PATHS}
  />
);

const renderCommander = (
  dataSource: PanelDataSource = createFixturePanelDataSource(),
  mutationClient?: ComponentProps<typeof CommanderShell>['mutationClient'],
  operationClient?: ComponentProps<typeof CommanderShell>['operationClient'],
) => render(commanderElement(dataSource, mutationClient, operationClient));

describe('CommanderShell', () => {
  it('renders a TUI-faithful dual-panel commander canvas', () => {
    const { container } = renderCommander();

    expect(screen.getByText('[복슬Dir]')).toBeTruthy();
    expect(screen.getByLabelText('dual file panels')).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('Architecture.md')).toBeTruthy();
    expect(screen.getByText('generic-array-7534a23a150ae5e7')).toBeTruthy();
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('Copy');
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('PermDel');

    expect(container.querySelector('.file-panel.is-active')).not.toBeNull();
    expect(container.querySelector('.persistent-sidebar')).toBeNull();
    expect(container.querySelector('.persistent-inspector')).toBeNull();
    expect(container.querySelector('.large-toolbar')).toBeNull();
  });


  it('uses the TUI width-based metadata column policy', () => {
    expect(columnLayoutForPanelWidth(44 * 8)).toMatchObject({ showSize: false, dateFormat: 'short' });
    expect(columnLayoutForPanelWidth(45 * 8)).toMatchObject({ showSize: true, showPermissions: false, dateFormat: 'short' });
    expect(columnLayoutForPanelWidth(70 * 8)).toMatchObject({ showPermissions: true, showCreated: false, dateFormat: 'long' });
    expect(columnLayoutForPanelWidth(100 * 8)).toMatchObject({ showPermissions: true, showCreated: true, showOwner: false });
    expect(columnLayoutForPanelWidth(120 * 8)).toMatchObject({ showCreated: true, showOwner: true });
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

  it('dispatches registry single-key shortcuts through operation dialogs', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('y');

    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();
    expect(screen.getByText('file.copy')).toBeTruthy();
  });

  it('uses the focused row as the file-operation source when nothing is explicitly selected', async () => {
    const user = userEvent.setup();
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('y');

    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();
    const dialog = screen.getByText('Copy to opposite panel').closest('.operation-dialog');
    if (!dialog) {
      throw new Error('operation dialog is required');
    }
    expect(within(dialog as HTMLElement).getByText('generic-array-6de08afde610f112')).toBeTruthy();
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
    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '확인' }));

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
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
        view: { zoomStep: 0, density: 'compact' as const },
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
    await user.click(await screen.findByText('Single-Dual Panel'));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ layout: expect.objectContaining({ singlePanel: true }) }),
    }));

    await user.click(screen.getByRole('button', { name: 'Help(H)' }));
    await user.click(await screen.findByText('Shortcuts'));
    expect(await screen.findByText('Keyboard Shortcuts')).toBeTruthy();
    expect(screen.getByText('file.copy')).toBeTruthy();
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
    await waitFor(() => expect(screen.getByText('Copy to opposite panel')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '확인' }));

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
    await waitFor(() => expect(screen.getByText('Copy to opposite panel')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: '확인' }));

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

  it('opens path, location, tab, history, bookmark, help search, and about overlays', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('gm');
    expect(await screen.findByRole('dialog', { name: 'Locations' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '닫기' }));

    await user.keyboard('tn');
    await user.keyboard('tt');
    const tabDialog = await screen.findByRole('dialog', { name: 'RIGHT Tabs' });
    expect(within(tabDialog).getAllByText(SAMPLE_LISTINGS.right.path)).toHaveLength(2);
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

    await user.keyboard('y');
    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('registers explicit keyboard owners for modal and menu surfaces', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('y');
    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();
    await waitFor(() => expect(commanderKeyboardOwners()).toContain('operation-dialog'));

    useOperationStore.getState().closeDialog();
    await waitFor(() => expect(commanderKeyboardOwners()).not.toContain('operation-dialog'));

    await user.click(screen.getByRole('button', { name: 'File(F)' }));
    await waitFor(() => expect(commanderKeyboardOwners()).toContain('menu-popover'));
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
        view: { zoomStep: patch.view?.zoomStep ?? 0, density: 'compact' as const },
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

    fireEvent.keyDown(document, { key: '0', metaKey: true });
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: expect.objectContaining({ view: expect.objectContaining({ zoomStep: 0 }) }),
    }));
  });

  it('opens the right-clicked row from the context menu instead of the previous focused row', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const contextTarget = rowByText(container, 'getrandom-24ce5e891f8ae242');

    if (!contextTarget) {
      throw new Error('context-menu target row is required');
    }
    fireEvent.contextMenu(contextTarget);
    await user.click(await screen.findByText('Open'));

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('getrandom-24ce5e891f8ae242');
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

// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import { ACTION_BY_ID } from '../actions/registry';
import { useOperationStore } from '../operations/operationStore';
import { CommanderShell } from './CommanderShell';
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

  it('uses Tab as active-panel switching instead of DOM focus traversal', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const shell = screen.getByRole('application', { name: 'BokslDirGUI file commander shell' });

    shell.focus();
    expect(activePanelLabel(container)).toContain('right panel');

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('left panel');
    expect(document.activeElement).toBe(shell);
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

  it('toggles focused-row selection with Space', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    expect(focusedRow(container)?.className).toContain('is-selected');

    await user.keyboard('{Space}');

    expect(focusedRow(container)?.className).not.toContain('is-selected');
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

    fireEvent.keyDown(document, { key: 'r', ctrlKey: true });
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: 'generic' })));

    await user.keyboard('/');
    await user.click(await screen.findByRole('button', { name: 'Clear filter' }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({ filter: null })));
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

  it('dispatches registry sequence shortcuts without web text focus', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('gp');

    expect(screen.getByText(/Path · goto_path/)).toBeTruthy();
  });

  it('dispatches longer overlapping sequence shortcuts before the shorter timeout action', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('tba');

    expect(screen.getByText('Add · save_settings')).toBeTruthy();
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

    await user.click(screen.getByRole('button', { name: 'File' }));
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

    await user.click(screen.getByRole('button', { name: 'File' }));
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
  isHidden: false,
  isVirtual: false,
});

function KeyboardOwnerProbe({ label }: { label: string }) {
  useCommanderKeyboardOwner('menu-popover');
  return <div>{label}</div>;
}

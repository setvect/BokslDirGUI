// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import { useOperationStore } from '../operations/operationStore';
import { CommanderShell } from './CommanderShell';
import { INITIAL_FOCUS_INDEX, SAMPLE_LISTINGS } from './commanderFixture';
import { commanderKeyboardOwners, useCommanderKeyboardOwner } from './keyboardOwnership';

afterEach(() => {
  vi.useRealTimers();
  useOperationStore.getState().closeDialog();
  cleanup();
});

describe('CommanderShell', () => {
  it('renders a TUI-faithful dual-panel commander canvas', () => {
    const { container } = render(<CommanderShell />);

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
    const { container } = render(<CommanderShell />);
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
      const { container, rerender } = render(<CommanderShell />);
      const keydownAddsAfterMount = addSpy.mock.calls.filter(([type]) => type === 'keydown').length;
      const keydownRemovesAfterMount = removeSpy.mock.calls.filter(([type]) => type === 'keydown').length;

      expect(activePanelLabel(container)).toContain('right panel');
      rerender(<CommanderShell />);
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
    const { container } = render(<CommanderShell />);

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
    render(<CommanderShell />);

    expect(fireEvent.keyDown(document, { key: 'ArrowDown' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: 'PageDown' })).toBe(false);
    expect(fireEvent.keyDown(document, { key: ' ' })).toBe(false);
  });

  it('toggles focused-row selection with Space', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommanderShell />);

    expect(focusedRow(container)?.className).toContain('is-selected');

    await user.keyboard('{Space}');

    expect(focusedRow(container)?.className).not.toContain('is-selected');
  });

  it('opens the focused entry with Enter using the commander action path', async () => {
    const user = userEvent.setup();
    render(<CommanderShell />);

    await user.keyboard('{Enter}');

    expect(screen.getByText(/디렉터리 진입 예정: generic-array-6de08afde610f112/)).toBeTruthy();
  });

  it('dispatches registry single-key shortcuts through operation dialogs', async () => {
    const user = userEvent.setup();
    render(<CommanderShell />);

    await user.keyboard('y');

    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();
    expect(screen.getByText('file.copy')).toBeTruthy();
  });

  it('dispatches registry sequence shortcuts without web text focus', async () => {
    const user = userEvent.setup();
    render(<CommanderShell />);

    await user.keyboard('gp');

    expect(screen.getByText('Path · goto_path')).toBeTruthy();
  });

  it('dispatches longer overlapping sequence shortcuts before the shorter timeout action', async () => {
    const user = userEvent.setup();
    render(<CommanderShell />);

    await user.keyboard('tba');

    expect(screen.getByText('Add · save_settings')).toBeTruthy();
    expect(screen.queryByText('Bookmarks · UI state')).toBeNull();
  });

  it('does not dispatch a pending sequence timeout after a keyboard owner appears', async () => {
    vi.useFakeTimers();
    render(<CommanderShell />);
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
    const { container } = render(<CommanderShell />);
    const input = document.createElement('input');
    document.body.append(input);

    input.focus();
    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
    input.remove();
  });

  it('does not capture commander Tab while an operation dialog owns focus', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommanderShell />);

    await user.keyboard('y');
    expect(await screen.findByText('Copy to opposite panel')).toBeTruthy();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('registers explicit keyboard owners for modal and menu surfaces', async () => {
    const user = userEvent.setup();
    render(<CommanderShell />);

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
    const { container } = render(<CommanderShell />);

    await user.click(screen.getByRole('button', { name: 'File' }));
    expect(document.querySelector('.menu-popover')).not.toBeNull();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });

  it('does not capture Space from focused native buttons inside the shell', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommanderShell />);
    const pathButton = screen.getByLabelText('right navigation controls').querySelector('button');

    if (!pathButton) {
      throw new Error('path button is required');
    }
    pathButton.focus();
    await user.keyboard('{Space}');

    expect(focusedRow(container)?.className).toContain('is-selected');
  });

  it('opens the right-clicked row from the context menu instead of the previous focused row', async () => {
    const user = userEvent.setup();
    const { container } = render(<CommanderShell />);
    const contextTarget = rowByText(container, 'getrandom-24ce5e891f8ae242');

    if (!contextTarget) {
      throw new Error('context-menu target row is required');
    }
    fireEvent.contextMenu(contextTarget);
    await user.click(await screen.findByText('Open'));

    expect(screen.getByText(/디렉터리 진입 예정: getrandom-24ce5e891f8ae242/)).toBeTruthy();
  });
});

const activePanelLabel = (container: HTMLElement) =>
  container.querySelector('.file-panel.is-active')?.getAttribute('aria-label') ?? '';

const focusedRow = (container: HTMLElement) => container.querySelector('.file-panel.is-active .file-row.is-focused');

const focusedRowText = (container: HTMLElement) => focusedRow(container)?.textContent ?? '';

const rowByText = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll<HTMLElement>('.file-panel.is-active .file-row')]
    .find((row) => row.textContent?.includes(text)) ?? null;

function KeyboardOwnerProbe({ label }: { label: string }) {
  useCommanderKeyboardOwner('menu-popover');
  return <div>{label}</div>;
}

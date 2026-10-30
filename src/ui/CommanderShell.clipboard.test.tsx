// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOperationStore } from '../operations/operationStore';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { commanderKeyboardOwners } from './keyboardOwnership';
import { createFixturePanelDataSource } from './panelDataSource';
import { operationClientStub } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { renderCommander } from './testing/commanderTestSupport';

const selectPathText = (container: HTMLElement, panelId: 'left' | 'right', reverse = false) => {
  const pathText = container.querySelector(`[data-panel-id="${panelId}"] .path-input`)?.firstChild;
  const selection = window.getSelection();
  if (!pathText || !selection) throw new Error('path selection fixture is required');
  const start = 2;
  const end = (pathText.textContent?.length ?? 0) - 2;
  selection.setBaseAndExtent(pathText, reverse ? end : start, pathText, reverse ? start : end);
  return selection;
};

describe('CommanderShell clipboard', () => {
  afterEach(() => window.getSelection()?.removeAllRanges());

  it.each([
    { name: 'Cmd+C', modifier: { metaKey: true }, reverse: false },
    { name: 'Ctrl+C', modifier: { ctrlKey: true }, reverse: true },
  ])('allows native selected-path copying with $name without capturing files', async ({ modifier, reverse }) => {
    const user = userEvent.setup();
    const operationClient = operationClientStub();
    const { container } = renderCommander(createFixturePanelDataSource(), undefined, operationClient);
    const shell = screen.getByRole('application');
    shell.focus();
    const selection = selectPathText(container, 'right', reverse);
    const selectedText = selection.toString();

    expect(fireEvent.keyDown(shell, { key: 'c', code: 'KeyC', ...modifier })).toBe(true);
    expect(selection.toString()).toBe(selectedText);
    expect(screen.queryByText(/복사 준비 · 대상 폴더에서 ⌘V/)).toBeNull();

    selection.removeAllRanges();
    await user.keyboard('{Tab}{Meta>}v{/Meta}');
    expect(operationClient.startCopy).not.toHaveBeenCalled();
  });

  it.each(['collapsed path', 'tab label'])('keeps file-copy shortcuts for a $0 selection', (kind) => {
    const { container } = renderCommander();
    const shell = screen.getByRole('application');
    shell.focus();
    const selection = selectPathText(container, 'right');
    if (kind === 'collapsed path') {
      selection.collapseToStart();
    } else {
      const label = container.querySelector('[data-panel-id="right"] .panel-tabs');
      if (!label) throw new Error('tab label fixture is required');
      const range = document.createRange();
      range.selectNodeContents(label);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    expect(fireEvent.keyDown(shell, { key: 'c', code: 'KeyC', metaKey: true })).toBe(false);
    expect(screen.getByText(/복사 준비 · 대상 폴더에서 ⌘V/)).toBeTruthy();
  });

  it('preserves prepared files when copying selected path text before pasting with Cmd+V', async () => {
    const user = userEvent.setup();
    const operationClient = operationClientStub({
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-clipboard-copy', kind: 'copy' as const, state: 'queued' as const } })),
    });
    const { container } = renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('{Meta>}c{/Meta}');
    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(screen.getByText(/복사 준비 · 대상 폴더에서 ⌘V/)).toBeTruthy();
    await user.keyboard('{Tab}');
    const selection = selectPathText(container, 'left');
    expect(fireEvent.keyDown(screen.getByRole('application'), { key: 'c', code: 'KeyC', metaKey: true })).toBe(true);
    selection.removeAllRanges();
    await user.keyboard('{Meta>}v{/Meta}');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('uses Finder-style Cmd+C then Option+Cmd+V to move with confirmation', async () => {
    const user = userEvent.setup();
    const operationClient = operationClientStub({
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-mac-paste-move', kind: 'move' as const, state: 'queued' as const } })),
    });
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

  it('offers the prepared clipboard in the blank-area context menu like the Edit menu', async () => {
    const user = userEvent.setup();
    const operationClient = operationClientStub({
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-context-paste', kind: 'copy' as const, state: 'queued' as const } })),
    });
    const { container } = renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('{Meta>}c{/Meta}');
    await user.keyboard('{Tab}');
    fireEvent.contextMenu(container.querySelector<HTMLElement>('.file-panel.is-active .file-table-scroll')!);

    expect(await screen.findByRole('menuitem', { name: /^여기로 이동/ })).toBeTruthy();
    await user.click(screen.getByRole('menuitem', { name: /^붙여넣기/ }));
    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('uses Windows-style Ctrl+X then Ctrl+V and clears the cut list after a complete move', async () => {
    const userAgent = vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0)');
    try {
      const user = userEvent.setup();
      const operationClient = operationClientStub({
        startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-win-paste-move', kind: 'move' as const, state: 'queued' as const } })),
      });
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
    const operationClient = operationClientStub();
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('{Meta>}c{/Meta}');
    await user.keyboard('{Meta>}v{/Meta}');

    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(screen.getByText(/같은 폴더에 붙여넣을 수 없습니다/)).toBeTruthy();
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
});

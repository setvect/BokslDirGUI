// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import platformFixtures from '../tauri/fixtures/platform.json';
import { KEY_GUIDE } from '../actions/keyGuide';
import { ACTION_BY_ID, ACTIONS, actionVisibleOnPlatform } from '../actions/registry';
import { useOperationStore } from '../operations/operationStore';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { commanderKeyboardOwners } from './keyboardOwnership';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing } from './panelState';
import { mutationClientStub, operationClientStub } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { activePanelLabel, commanderElement, focusedRow, focusedRowText, KeyboardOwnerProbe, renderCommander, rowByText, testEntry } from './testing/commanderTestSupport';

const measureFileList = (container: HTMLElement, panelId: 'left' | 'right', visibleRows: number) => {
  const shell = container.querySelector<HTMLElement>('.commander-shell')!;
  const rowHeight = () => Number.parseFloat(shell.style.getPropertyValue('--row-height'));
  const list = container.querySelector<HTMLElement>(`[data-panel-id="${panelId}"] .file-table-scroll`)!;
  let height = rowHeight() * visibleRows;
  Object.defineProperties(list, {
    clientHeight: { configurable: true, get: () => height },
    scrollHeight: { configurable: true, get: () => Number.parseFloat(list.querySelector<HTMLElement>('.file-table-virtual-space')?.style.height ?? '0') },
    scrollTo: { configurable: true, value: vi.fn(({ top }: ScrollToOptions) => { list.scrollTop = top ?? 0; }) },
  });
  return { list, rowHeight, resize: (nextHeight: number) => { height = nextHeight; } };
};

describe('CommanderShell keyboard', () => {

  it('uses Tab as active-panel switching instead of DOM focus traversal', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const shell = screen.getByRole('application', { name: '복슬Dir file commander shell' });

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
      screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant'),
    ).toBe('commander-row-right-0');

    await user.keyboard('{End}');
    expect(
      screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant'),
    ).toBe('commander-row-right-32');
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

  it('disables real file mutation shortcuts in plain browser preview mode', async () => {
    const user = userEvent.setup();
    const operationClient = operationClientStub();
    renderCommander(createFixturePanelDataSource(), undefined, operationClient, false);

    expect(screen.getByText(/미리보기 모드입니다/)).toBeTruthy();

    await user.keyboard('y');
    await user.keyboard('d');

    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(operationClient.startDelete).not.toHaveBeenCalled();
    expect(await screen.findByText(/지금은 사용할 수 없습니다/)).toBeTruthy();
  });

  it('groups every shortcut and scrolls the help dialog without moving a file row', async () => {
    const user = userEvent.setup();
    renderCommander(undefined, undefined, undefined, false);

    await user.click(screen.getByRole('button', { name: '도움말(H)' }));
    await user.click(await screen.findByText('단축키 도움말'));

    const dialog = await screen.findByRole('dialog', { name: '단축키 도움말' });
    const scrollArea = within(dialog).getByRole('region', { name: '단축키 목록' });
    expect(document.activeElement).toBe(scrollArea);
    // 레지스트리 단축키와 전용 처리기 키(목록 이동·폴더 트리·창·확대·우클릭 메뉴·끌기·메뉴)를 함께 표시
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(
      ACTIONS.filter((action) => actionVisibleOnPlatform(action) && (action.shortcutLabel || action.keyboardBindings?.length)).length
      + KEY_GUIDE.reduce((count, group) => count + group.entries.length, 0),
    );
    expect(within(dialog).getByRole('heading', { name: '이동' })).toBeTruthy();
    expect(within(dialog).getByRole('heading', { name: '파일' })).toBeTruthy();
    expect([...dialog.querySelectorAll('.shortcut-help-column')].map((column) =>
      [...column.querySelectorAll('h3')].map((heading) => heading.textContent),
    )).toEqual([
      ['이동', '목록 이동'],
      ['패널', '선택', '메뉴', '창·목록'],
      ['파일', '도움말', '화면 확대', '우클릭 메뉴·끌기'],
      ['보기', '압축', '폴더 트리 안'],
    ]);
    const treeGroup = within(dialog).getByRole('heading', { name: '폴더 트리 안' }).closest('section')!;
    expect([...treeGroup.querySelectorAll('.shortcut-help-entry')].map((entry) => entry.textContent)).toEqual([
      '↑/↓/k/j폴더 이동·패널 따라감',
      '→/l펼치기·하위 폴더로',
      '←/h접기·상위 폴더로',
      'PageUp/PageDown한 쪽 이동',
      'Home/End처음·끝',
      'Enter이동하고 목록으로',
      'Esc취소하고 목록으로',
    ]);
    expect(within(dialog).getByText('Cmd+U/Cmd+D')).toBeTruthy();
    expect(within(dialog).getByText('Opt+F/E/V/G/R/A/S/H')).toBeTruthy();

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
    const operationClient = operationClientStub({
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-native-drop', kind: 'copy' as const, state: 'queued' as const } })),
    });
    const { container, unmount } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        mutationClient={mutationClientStub({ getMetadata })}
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
    measureFileList(container, 'right', 14);

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
    expect(screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-0');

    fireEvent.keyDown(document, { key: 'ㅇ', code: 'KeyD', ctrlKey: true });
    expect(screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-13');

    fireEvent.keyDown(document, { key: 'ArrowDown', shiftKey: true });
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length).toBeGreaterThanOrEqual(2);

    await user.keyboard('gg');
    expect(screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-0');

    fireEvent.keyDown(document, { key: 'G', shiftKey: true });
    expect(screen.getByRole('application', { name: '복슬Dir file commander shell' }).getAttribute('aria-activedescendant')).toBe('commander-row-right-32');
  });

  it('moves the cursor and viewport by the visible page with one overlapping row', () => {
    const { container } = renderCommander();
    const { list, rowHeight } = measureFileList(container, 'right', 21);
    const shell = container.querySelector('.commander-shell')!;
    fireEvent.keyDown(document, { key: 'Home' });

    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-20');
    // The cursor stays at the top until the viewport reaches the end of the list.
    expect(list.scrollTop).toBe(12 * rowHeight());

    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-32');
    expect(list.scrollTop).toBe(12 * rowHeight());
    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-32');

    fireEvent.keyDown(document, { key: 'PageUp' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-12');
    fireEvent.keyDown(document, { key: 'PageUp' });
    fireEvent.keyDown(document, { key: 'PageUp' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-0');
    expect(list.scrollTop).toBe(0);
  });

  it('renders the focused row after paging beyond the initial virtual range', async () => {
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.classList.contains('file-table-scroll') ? 504 : 0;
    });
    const widthSpy = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
    const listing = createDirectoryListing('right', '/paging', Array.from({ length: 100 }, (_, i) => testEntry('/paging', `file-${i}.txt`)));
    const source = createFixturePanelDataSource({ left: SAMPLE_LISTINGS.left, right: listing });
    const { container, unmount } = renderCommander(source);
    const { list, rowHeight } = measureFileList(container, 'right', 21);
    const shell = container.querySelector('.commander-shell')!;
    try {
      fireEvent.keyDown(document, { key: 'Home' });
      fireEvent.scroll(list);
      expect(document.getElementById('commander-row-right-40')).toBeNull();
      for (const index of [20, 40, 60]) {
        fireEvent.keyDown(document, { key: 'PageDown' });
        fireEvent.scroll(list);
        await waitFor(() => expect(document.getElementById(`commander-row-right-${index}`)?.getAttribute('aria-current')).toBe('true'));
        expect(shell.getAttribute('aria-activedescendant')).toBe(`commander-row-right-${index}`);
        expect(list.scrollTop).toBe(index * rowHeight());
      }
      fireEvent.keyDown(document, { key: 'PageUp' });
      fireEvent.scroll(list);
      await waitFor(() => expect(document.getElementById('commander-row-right-40')?.getAttribute('aria-current')).toBe('true'));
      expect(list.scrollTop).toBe(40 * rowHeight());
    } finally {
      unmount();
      heightSpy.mockRestore();
      widthSpy.mockRestore();
    }
  });

  it('keeps the cursor at the same viewport position and reads resized height on each page key', () => {
    const { container } = renderCommander();
    const { list, rowHeight, resize } = measureFileList(container, 'right', 8);
    const shell = container.querySelector('.commander-shell')!;
    // Initial focus is row 9, positioned two rows below the viewport top.
    list.scrollTop = 7 * rowHeight();
    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-16');
    expect(list.scrollTop).toBe(14 * rowHeight());

    resize(5.5 * rowHeight());
    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-20');
    expect(list.scrollTop).toBe(18 * rowHeight());
    fireEvent.keyDown(document, { key: 'PageUp' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-16');
    expect(list.scrollTop).toBe(14 * rowHeight());
  });

  it('uses only the active panel viewport and recalculates page size after zoom', () => {
    const { container } = renderCommander();
    const right = measureFileList(container, 'right', 21);
    const left = measureFileList(container, 'left', 5);
    const shell = container.querySelector('.commander-shell')!;
    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Home' });
    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-left-4');
    expect(right.list.scrollTop).toBe(0);
    const leftScrollTop = left.list.scrollTop;

    fireEvent.keyDown(document, { key: 'Tab' });
    fireEvent.keyDown(document, { key: 'Home' });
    fireEvent.keyDown(document, { key: '+', ctrlKey: true });
    const expectedStep = Math.floor(right.list.clientHeight / right.rowHeight()) - 1;
    expect(expectedStep).toBeLessThan(20);
    fireEvent.keyDown(document, { key: 'PageDown' });
    expect(shell.getAttribute('aria-activedescendant')).toBe(`commander-row-right-${expectedStep}`);
    expect(left.list.scrollTop).toBe(leftScrollTop);
  });

  it('extends selection with shifted page and boundary movement keys', async () => {
    const { container } = renderCommander();
    const { list, rowHeight } = measureFileList(container, 'right', 14);
    const shell = screen.getByRole('application', { name: '복슬Dir file commander shell' });

    fireEvent.keyDown(document, { key: 'PageDown', shiftKey: true });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-22');
    expect(list.scrollTop).toBe(13 * rowHeight());
    expect([...container.querySelectorAll('.file-panel.is-active .file-row.is-selected')].length).toBeGreaterThanOrEqual(11);

    fireEvent.keyDown(document, { key: 'PageUp', shiftKey: true });
    expect(shell.getAttribute('aria-activedescendant')).toBe('commander-row-right-9');
    expect(list.scrollTop).toBe(0);
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

  it('opens the bookmark list immediately when tb is pressed', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('tb');

    expect(screen.getByRole('dialog', { name: '북마크' })).toBeTruthy();
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
    const gotoButton = within(screen.getByLabelText('오른쪽 탐색 컨트롤')).getByRole('button', { name: '경로 이동' });
    gotoButton.focus();
    await user.keyboard('{Space}');

    expect(focusedRow(container)?.className).toContain('is-selected');
  });

  it('returns keyboard ownership to the commander after non-modal path button clicks', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();
    const upButton = within(screen.getByLabelText('오른쪽 탐색 컨트롤')).getByRole('button', { name: '상위 폴더' });
    await user.click(upButton);
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('application', { name: '복슬Dir file commander shell' })));

    await user.keyboard('{ArrowDown}');
    const focusedText = focusedRowText(container);
    await user.keyboard('{Space}');
    expect(focusedRowText(container)).toBe(focusedText);
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

  it('opens the context menu of the row focused after moving, not the first focused row', async () => {
    const user = userEvent.setup();
    renderCommander();

    await user.keyboard('{ArrowDown}');
    fireEvent.keyDown(document, { key: 'F10', shiftKey: true });
    await user.click(await screen.findByRole('menuitem', { name: /^열기/ }));

    expect(await screen.findByText('README.md')).toBeTruthy();
    expect(activePanelLabel(document.body)).toContain('generic-array-7534a23a150ae5e7');
  });

  it.each(platformFixtures)('opens the file manager and terminal at the invoked panel on $os', async (platform) => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(platform.os === 'windows' ? 'Windows' : 'Macintosh');
    const user = userEvent.setup();
    const openCurrentInFileManager = vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: null } }));
    const openCurrentInTerminal = vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: null } }));
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClientStub({
      openCurrentInFileManager, openCurrentInTerminal,
      getPlatformInfo: vi.fn(async () => ({ ok: true as const, data: platform })),
    }));
    const activeBlankArea = () => container.querySelector<HTMLElement>('.file-panel.is-active .file-table-scroll')!;

    fireEvent.contextMenu(activeBlankArea());
    await user.click(await screen.findByRole('menuitem', { name: '현재 폴더를 파일 관리자에서 열기' }));
    await waitFor(() => expect(openCurrentInFileManager).toHaveBeenCalledWith({ path: SAMPLE_LISTINGS.right.path }));
    expect(screen.queryByRole('dialog')).toBeNull();

    await user.keyboard('{Tab}');
    fireEvent.contextMenu(activeBlankArea());
    await user.click(await screen.findByRole('menuitem', { name: '현재 폴더에서 터미널 열기' }));
    await waitFor(() => expect(openCurrentInTerminal).toHaveBeenCalledWith({ path: SAMPLE_LISTINGS.left.path }));
  });

  it('opens a blank-area context menu for panel-scope actions', async () => {
    const user = userEvent.setup();
    const createDir = vi.fn(async () => ({
      ok: true as const,
      data: { ...SAMPLE_LISTINGS.right.entries[0], path: `${SAMPLE_LISTINGS.right.path}/New Folder`, name: 'New Folder', kind: 'directory' as const },
    }));
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClientStub({ createDir }));
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
});

it('keeps one effective keyboard subscription through StrictMode replay and releases it on unmount', () => {
  const add = vi.spyOn(document, 'addEventListener');
  const remove = vi.spyOn(document, 'removeEventListener');
  try {
    const dataSource = createFixturePanelDataSource();
    const { container, unmount } = render(<StrictMode>{commanderElement(dataSource)}</StrictMode>);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(activePanelLabel(container)).toContain('left panel');
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(activePanelLabel(container)).toContain('right panel');
    unmount();
    for (const [, listener] of add.mock.calls.filter(([type]) => type === 'keydown')) {
      expect(remove.mock.calls.some(([type, removed]) => type === 'keydown' && removed === listener)).toBe(true);
    }
  } finally {
    add.mockRestore();
    remove.mockRestore();
  }
});

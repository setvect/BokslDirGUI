// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource } from './panelDataSource';
import { mutationClientStub, settingsFixture } from './testing/clientStubs';
import './testing/commanderTestSetup';
import { renderCommander } from './testing/commanderTestSupport';

describe('CommanderShell settings', () => {

  it('persists bookmark/layout settings and opens registry-derived shortcut help', async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async ({ patch }: { patch: object }) => ({
      ok: true as const,
      data: { ...settingsFixture(), ...patch },
    }));
    renderCommander(createFixturePanelDataSource(), mutationClientStub({ saveSettings }));

    await user.keyboard('{Control>}b{/Control}');
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
    expect(within(shortcutDialog).getByText('Ctrl+B')).toBeTruthy();
    expect(within(shortcutDialog).queryByText('file.copy')).toBeNull();
  });

  it('renames a bookmark with an explicit localized name instead of an internal suffix', async () => {
    const user = userEvent.setup();
    const initialBookmark = {
      id: 'bookmark-existing',
      label: '기존 이름',
      path: SAMPLE_LISTINGS.right.path,
    };
    const baseSettings = settingsFixture({ bookmarks: [initialBookmark] });
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: { ...baseSettings, ...patch },
    }));
    const mutationClient = mutationClientStub({
      loadSettings: vi.fn(async () => ({ ok: true as const, data: baseSettings })),
      saveSettings,
    });
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
    expect(within(bookmarkMenu).queryByRole('menuitem', { name: '삭제' })).toBeNull();
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

  it.each(['cancel button', 'Escape'])('closes the bookmark rename prompt with the %s without saving', async (closeWith) => {
    const user = userEvent.setup();
    const baseSettings = settingsFixture({ bookmarks: [{ id: 'bookmark-existing', label: '기존 이름', path: SAMPLE_LISTINGS.right.path }] });
    const mutationClient = mutationClientStub({
      loadSettings: vi.fn(async () => ({ ok: true as const, data: baseSettings })),
      saveSettings: vi.fn(),
    });
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
    await user.click(within(await screen.findByRole('menu', { name: '북마크 submenu' })).getByRole('menuitem', { name: '이름 변경' }));
    expect(await screen.findByLabelText('북마크 이름')).toBeTruthy();

    if (closeWith === 'Escape') {
      await user.keyboard('{Escape}');
    } else {
      await user.click(screen.getByRole('button', { name: '취소' }));
    }

    await waitFor(() => expect(screen.queryByLabelText('북마크 이름')).toBeNull());
    expect(mutationClient.saveSettings).not.toHaveBeenCalled();
  });

  it('deletes bookmarks from the list by ID while keeping the dialog and panel path', async () => {
    const user = userEvent.setup();
    const bookmarks = [
      { id: 'first', label: '첫째', path: '/tmp/bookmark-first' },
      { id: 'second', label: '둘째', path: '/tmp/bookmark-second' },
    ];
    const baseSettings = settingsFixture({ bookmarks });
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: { ...baseSettings, ...patch },
    }));
    const mutationClient = mutationClientStub({
      loadSettings: vi.fn(async () => ({ ok: true as const, data: baseSettings })),
      saveSettings,
    });
    renderCommander(createFixturePanelDataSource(), mutationClient);
    await waitFor(() => expect(mutationClient.loadSettings).toHaveBeenCalled());

    await user.keyboard('tb');
    const dialog = await screen.findByRole('dialog', { name: '북마크' });
    const originalPath = document.querySelector('.file-panel.is-active .path-input')?.textContent;
    await user.click(within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/bookmark-first' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: { bookmarks: [bookmarks[1]] },
    }));
    expect(screen.getByRole('dialog', { name: '북마크' })).toBe(dialog);
    expect(dialog.querySelectorAll('.navigation-path-choice')).toHaveLength(1);
    expect(document.activeElement).toBe(dialog.querySelector('.navigation-path-choice'));
    expect(document.querySelector('.file-panel.is-active .path-input')?.textContent).toBe(originalPath);

    await user.keyboard('{Backspace}');
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({
      patch: { bookmarks: [] },
    }));
    expect(dialog.querySelectorAll('.navigation-path-choice')).toHaveLength(0);
    expect(within(dialog).getByText('표시할 항목이 없습니다.')).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: '닫기' }));
    expect(document.querySelector('.file-panel.is-active .path-input')?.textContent).toBe(originalPath);
  });

  it('restores a bookmark in the open list when deleting it fails to save', async () => {
    const user = userEvent.setup();
    const bookmark = { id: 'keep', label: '보존', path: '/tmp/bookmark-keep' };
    const settings = settingsFixture({ bookmarks: [bookmark] });
    const saveSettings = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'save_failed', messageKey: 'errors.settingsSaveFailed', path: null, details: {}, retryable: true, recoverable: true },
    }));
    const loadSettings = vi.fn(async () => ({ ok: true as const, data: settings }));
    renderCommander(createFixturePanelDataSource(), mutationClientStub({ loadSettings, saveSettings }));
    await waitFor(() => expect(loadSettings).toHaveBeenCalled());
    await user.keyboard('tb');
    const dialog = await screen.findByRole('dialog', { name: '북마크' });
    await user.click(within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/bookmark-keep' }));

    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { bookmarks: [] } }));
    expect(await screen.findByText('설정 저장 실패: 설정 저장에 실패했습니다.')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/bookmark-keep' })).toBeTruthy();
    expect(within(dialog).queryByText('표시할 항목이 없습니다.')).toBeNull();
  });

  it('restores all bookmarks after consecutive delete saves fail', async () => {
    const user = userEvent.setup();
    const bookmarks = [
      { id: 'first', label: '첫째', path: '/tmp/first' },
      { id: 'second', label: '둘째', path: '/tmp/second' },
    ];
    const settings = settingsFixture({ bookmarks });
    const releaseSaves: Array<() => void> = [];
    const saveSettings = vi.fn(async () => {
      await new Promise<void>((resolve) => releaseSaves.push(resolve));
      return {
        ok: false as const,
        error: { code: 'save_failed', messageKey: 'errors.settingsSaveFailed', path: null, details: {}, retryable: true, recoverable: true },
      };
    });
    const loadSettings = vi.fn(async () => ({ ok: true as const, data: settings }));
    renderCommander(createFixturePanelDataSource(), mutationClientStub({ loadSettings, saveSettings }));
    await waitFor(() => expect(loadSettings).toHaveBeenCalled());
    await user.keyboard('tb');
    const dialog = await screen.findByRole('dialog', { name: '북마크' });
    await user.click(within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/first' }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(1));
    await user.click(within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/second' }));
    expect(dialog.querySelectorAll('.navigation-path-choice')).toHaveLength(0);

    releaseSaves[0]();
    await waitFor(() => expect(saveSettings).toHaveBeenCalledTimes(2));
    releaseSaves[1]();
    await waitFor(() => expect(dialog.querySelectorAll('.navigation-path-choice')).toHaveLength(2));
    expect(within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/first' })).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: '북마크 삭제 2: /tmp/second' })).toBeTruthy();
  });

  it('navigates the tab list with arrows and pages, selects with Enter, and closes individual tabs', async () => {
    const user = userEvent.setup();
    renderCommander();

    const goToPath = async (path: string) => {
      await user.keyboard('gp');
      const input = await screen.findByLabelText('경로');
      await user.clear(input);
      await user.type(input, path);
      await user.click(screen.getByRole('button', { name: '이동' }));
    };

    await user.keyboard('tn');
    await goToPath('/tmp/tab-two');
    await user.keyboard('tn');
    await goToPath('/tmp/tab-three');
    await user.keyboard('tt');

    const dialog = await screen.findByRole('dialog', { name: '오른쪽 탭' });
    const choices = [...dialog.querySelectorAll<HTMLButtonElement>('.navigation-tab-choice')];
    expect(choices).toHaveLength(3);
    expect(dialog.querySelectorAll('.navigation-tab-path')).toHaveLength(3);
    expect(dialog.querySelector('code')).toBeNull();
    expect(choices[2].getAttribute('title')).toBe('/tmp/tab-three');
    expect(document.activeElement).toBe(choices[2]);
    const list = dialog.querySelector<HTMLElement>('.navigation-tab-list');
    if (!list) throw new Error('tab list is required');
    Object.defineProperty(list, 'clientHeight', { configurable: true, value: 80 });
    for (const choice of choices) {
      Object.defineProperty(choice, 'offsetHeight', { configurable: true, value: 40 });
    }

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(choices[1]);
    await user.keyboard('{PageUp}');
    expect(document.activeElement).toBe(choices[0]);
    await user.keyboard('{PageDown}');
    expect(document.activeElement).toBe(choices[2]);
    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(choices[1]);
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('dialog', { name: '오른쪽 탭' })).toBeNull();
    expect(document.querySelector('.file-panel.is-active .path-input')?.textContent).toBe('/tmp/tab-two');

    await user.keyboard('tt');
    const reopened = await screen.findByRole('dialog', { name: '오른쪽 탭' });
    expect(reopened.querySelectorAll('.navigation-tab-choice')).toHaveLength(3);
    await user.click(within(reopened).getByRole('button', { name: /탭 닫기 1:/ }));
    expect(reopened.querySelectorAll('.navigation-tab-choice')).toHaveLength(2);
    expect(document.querySelector('.file-panel.is-active .path-input')?.textContent).toBe('/tmp/tab-two');

    await user.keyboard('{Delete}');
    expect(reopened.querySelectorAll('.navigation-tab-choice')).toHaveLength(1);
    expect(document.querySelector('.file-panel.is-active .path-input')?.textContent).toBe('/tmp/tab-three');
    expect(within(reopened).getByRole('button', { name: /탭 닫기 1:/ }).hasAttribute('disabled')).toBe(true);
    await user.keyboard('{Delete}');
    expect(reopened.querySelectorAll('.navigation-tab-choice')).toHaveLength(1);
  });

  it('uses Enter on a tab close button to close that tab without leaving the list', async () => {
    const user = userEvent.setup();
    renderCommander();
    await user.keyboard('tn');
    await user.keyboard('tt');

    const dialog = await screen.findByRole('dialog', { name: '오른쪽 탭' });
    const closeFirstTab = within(dialog).getByRole('button', { name: /탭 닫기 1:/ });
    closeFirstTab.focus();
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: '오른쪽 탭' })).toBe(dialog);
    expect(dialog.querySelectorAll('.navigation-tab-choice')).toHaveLength(1);
    expect(within(dialog).getByRole('button', { name: /탭 닫기 1:/ }).hasAttribute('disabled')).toBe(true);
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

    await user.keyboard('{Control>}b{/Control}');
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
    const aboutDialog = await screen.findByRole('dialog', { name: '복슬Dir 0.1.0' });
    expect(within(aboutDialog).getByRole('img', { name: '복슬Dir 강아지 마스코트' })).toBeTruthy();
    expect(within(aboutDialog).getByText('파일 정리가 한결 가벼워지는 두 칸짜리 파일 관리자예요.')).toBeTruthy();
    expect(within(aboutDialog).queryByText(/^목표:/)).toBeNull();
  });

  it('scales font, density variables, and persists zoom settings with Cmd/Ctrl +/-/0', async () => {
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => ({
      ok: true as const,
      data: settingsFixture({
        view: { zoomStep: patch.view?.zoomStep ?? 0, density: 'compact' as const, showIcons: patch.view?.showIcons ?? true },
      }),
    }));
    renderCommander(createFixturePanelDataSource(), mutationClientStub({ saveSettings }));
    const shell = screen.getByRole('application', { name: '복슬Dir file commander shell' });
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

  it('applies direct Settings menu actions visibly and persists them', async () => {
    const user = userEvent.setup();
    let savedSettings = settingsFixture();
    const saveSettings = vi.fn(async ({ patch }: { patch: Partial<import('../domain/types').Settings> }) => {
      savedSettings = { ...savedSettings, ...patch };
      return { ok: true as const, data: savedSettings };
    });
    renderCommander(createFixturePanelDataSource(), mutationClientStub({ saveSettings }));
    const shell = screen.getByRole('application', { name: '복슬Dir file commander shell' });

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
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /테마/ }));
    await user.click(await screen.findByRole('menuitem', { name: /^Mdir$/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { theme: 'mdir' } }));
    expect(shell.getAttribute('data-theme')).toBe('mdir');
    expect(document.body.dataset.theme).toBe('mdir');
    expect(await screen.findByText('테마 · Mdir')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '설정(S)' }));
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /테마/ }));
    expect((await screen.findByRole('menuitem', { name: /^Mdir$/ })).getAttribute('data-checked')).toBe('true');
    await user.keyboard('{Escape}');

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
    expect(screen.queryByRole('menuitem', { name: /Default Editor/ })).toBeNull();
    fireEvent.mouseEnter(await screen.findByRole('menuitem', { name: /File Size Format/ }));
    await user.click(await screen.findByRole('menuitem', { name: /Bytes/ }));
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ patch: { sizeFormat: 'decimal' } }));
    expect(shell.getAttribute('data-size-format')).toBe('decimal');
    expect(screen.getByText('23100 B')).toBeTruthy();
  });

  it('reports settings save failures instead of pretending persistence succeeded', async () => {
    const user = userEvent.setup();
    const saveSettings = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'save_failed', messageKey: 'errors.settingsSaveFailed', path: null, details: {}, retryable: true, recoverable: true },
    }));
    renderCommander(createFixturePanelDataSource(), mutationClientStub({ saveSettings }));

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
      mutationClient={mutationClientStub({ loadSettings, saveSettings })}
      runtimeBackendAvailable={false}
    />);

    expect(await screen.findByText('미리보기 모드입니다. 실제 복사/삭제/이동 같은 파일 작업은 데스크톱 앱에서만 동작합니다.')).toBeTruthy();
    expect(loadSettings).not.toHaveBeenCalled();

    fireEvent.keyDown(document, { key: '=', metaKey: true });

    expect(await screen.findByText('화면 배율 · 110%')).toBeTruthy();
    expect(saveSettings).not.toHaveBeenCalled();
    expect(screen.queryByText(/설정 읽기 실패|설정 저장 실패/)).toBeNull();
  });
});

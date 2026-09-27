// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NavigationListDialog, type NavigationListState } from './CommanderOverlays';
import './testing/commanderTestSetup';

function renderNavigationList(state: NavigationListState) {
  const onChoose = vi.fn();
  const onCloseTab = vi.fn();
  const onDeleteBookmark = vi.fn();
  render(
    <NavigationListDialog
      language="ko"
      state={state}
      onChoose={onChoose}
      onCloseTab={onCloseTab}
      onDeleteBookmark={onDeleteBookmark}
      onClose={vi.fn()}
    />,
  );
  const dialog = screen.getByRole('dialog', { name: state.title });
  const choices = [...dialog.querySelectorAll<HTMLButtonElement>('.navigation-path-choice')];
  const list = dialog.querySelector<HTMLElement>('.navigation-path-list');
  if (!list) throw new Error('navigation path list is required');
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: 80 });
  for (const choice of choices) {
    Object.defineProperty(choice, 'offsetHeight', { configurable: true, value: 40 });
  }
  return { dialog, choices, onChoose, onCloseTab, onDeleteBookmark };
}

describe('navigation list dialogs', () => {
  it('shows bookmark names and full paths without duplicate columns and selects by keyboard', async () => {
    const user = userEvent.setup();
    const state: NavigationListState = {
      kind: 'bookmarks',
      panelId: 'right',
      title: '북마크',
      items: [
        { id: 'first', label: '프로젝트', path: '/Users/boksl/work/a-long-project-name', group: 'bookmark' },
        { id: 'second', label: '/System', path: '/System', group: 'bookmark' },
        { id: 'third', label: '/Users/boksl/backup', path: '/Users/boksl/backup', group: 'bookmark' },
      ],
    };
    const { dialog, choices, onChoose, onCloseTab, onDeleteBookmark } = renderNavigationList(state);

    expect(dialog.classList.contains('navigation-path-dialog')).toBe(true);
    expect(choices).toHaveLength(3);
    expect(within(choices[0]).getByText('프로젝트')).toBeTruthy();
    expect(within(choices[0]).getByText(state.items[0].path)).toBeTruthy();
    expect(choices[0].title).toBe(state.items[0].path);
    expect(within(choices[1]).getAllByText('/System')).toHaveLength(1);
    expect(dialog.querySelector('code')).toBeNull();
    expect(document.activeElement).toBe(choices[0]);

    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(choices[1]);
    await user.keyboard('{PageDown}');
    expect(document.activeElement).toBe(choices[2]);
    await user.keyboard('{PageUp}');
    expect(document.activeElement).toBe(choices[0]);
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledWith(state.items[0]);
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(onDeleteBookmark).not.toHaveBeenCalled();
  });

  it('deletes the chosen bookmark by button or Delete without navigating', async () => {
    const user = userEvent.setup();
    const state: NavigationListState = {
      kind: 'bookmarks',
      panelId: 'right',
      title: '북마크',
      items: [
        { id: 'first', label: '첫째', path: '/tmp/first', group: 'bookmark' },
        { id: 'second', label: '둘째', path: '/tmp/second', group: 'bookmark' },
      ],
    };
    const { dialog, choices, onChoose, onDeleteBookmark } = renderNavigationList(state);

    const deleteFirst = within(dialog).getByRole('button', { name: '북마크 삭제 1: /tmp/first' });
    deleteFirst.focus();
    await user.keyboard('{Enter}');
    expect(onDeleteBookmark).toHaveBeenCalledWith(state.items[0]);
    expect(onChoose).not.toHaveBeenCalled();

    onDeleteBookmark.mockClear();
    choices[1].focus();
    await user.keyboard('{Delete}');
    expect(onDeleteBookmark).toHaveBeenCalledWith(state.items[1]);
    expect(onChoose).not.toHaveBeenCalled();
  });

  it('starts on the current history entry and chooses another path with arrows and pages', async () => {
    const user = userEvent.setup();
    const state: NavigationListState = {
      kind: 'history',
      panelId: 'right',
      title: '오른쪽 히스토리',
      items: [
        { id: 'back', label: 'old', path: '/Users/boksl/work/old', group: 'back' },
        { id: 'current', label: 'current', path: '/Users/boksl/work/current', group: 'current' },
        { id: 'forward', label: 'next', path: '/Users/boksl/work/next', group: 'forward' },
      ],
    };
    const { dialog, choices, onChoose } = renderNavigationList(state);

    expect(choices).toHaveLength(3);
    expect(within(choices[1]).getByText('현재')).toBeTruthy();
    expect(within(choices[1]).getByText(state.items[1].path)).toBeTruthy();
    expect(choices[1].title).toBe(state.items[1].path);
    expect(dialog.querySelector('code')).toBeNull();
    expect(within(dialog).queryByRole('button', { name: /북마크 삭제/ })).toBeNull();
    expect(document.activeElement).toBe(choices[1]);

    await user.keyboard('{ArrowUp}');
    expect(document.activeElement).toBe(choices[0]);
    await user.keyboard('{PageDown}');
    expect(document.activeElement).toBe(choices[2]);
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledWith(state.items[2]);
  });
});

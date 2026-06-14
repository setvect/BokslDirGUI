import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTION_BY_ID,
  actionForKeyboardShortcut,
  ariaKeyShortcutsFromRegistry,
  isActionAvailable,
  keyboardBindingCollisions,
  labelForAction,
  menuRootLabelFromRegistry,
  matchKeyboardShortcut,
  menuRootsFromRegistry,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
} from './registry';
import { COMMANDS } from '../tauri/client';

const requiredActionIds: ActionId[] = [
  'view.sortName',
  'view.sortSize',
  'view.sortDate',
  'view.sortExt',
  'view.reverseSort',
  'filter.start',
  'filter.clear',
  'view.toggleHidden',
  'selection.invert',
  'selection.clear',
  'layout.toggleSingleDual',
  'layout.ratio50',
  'layout.ratio70Left',
  'layout.ratio70Right',
  'nav.back',
  'nav.forward',
  'nav.top',
  'nav.bottom',
  'tab.list',
  'history.list',
  'bookmark.add',
  'bookmark.list',
  'bookmark.rename',
  'bookmark.delete',
  'settings.theme',
  'settings.language',
  'settings.sizeFormat',
  'archive.preview',
  'external.openEditor',
  'external.runShellCommand',
  'help.search',
  'help.about',
];

describe('action registry', () => {
  it('contains unique action IDs', () => {
    const ids = ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers parity-critical actions from the implementation design', () => {
    for (const id of requiredActionIds) {
      expect(ACTION_BY_ID.has(id)).toBe(true);
    }
  });

  it('routes shell command through preview before execution', () => {
    const action = ACTION_BY_ID.get('external.runShellCommand');
    expect(action?.command).toBe(COMMANDS.prepareShellCommand);
    expect(action?.runPath).toContain('prepare_shell_command');
    expect(action?.runPath).toContain('run_shell_command');
  });

  it('marks irreversible permanent delete distinctly from trash', () => {
    expect(ACTION_BY_ID.get('file.trash')?.dangerLevel).toBe('destructive');
    expect(ACTION_BY_ID.get('file.deletePermanent')?.dangerLevel).toBe('irreversible');
  });

  it('derives menu roots and display labels from the registry', () => {
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Archive', 'Tools', 'Settings', 'Help']);
    expect(menuRootsFromRegistry().map(menuRootLabelFromRegistry)).toEqual([
      'File(F)',
      'Edit(E)',
      'View(V)',
      'Go(G)',
      'Archive(A)',
      'Tools(T)',
      'Settings(S)',
      'Help(H)',
    ]);
    const copy = ACTION_BY_ID.get('file.copy');
    if (!copy) {
      throw new Error('file.copy action is required');
    }
    expect(labelForAction(copy)).toBe('Copy');
    expect(copy.hotkeyLabel).toBe('Copy');
  });

  it('applies contextScopes before action-specific enablement', () => {
    const archivePreview = ACTION_BY_ID.get('archive.preview');
    if (!archivePreview) {
      throw new Error('archive.preview action is required');
    }
    const baseContext: ActionContext = {
      activePanel: 'left',
      focusedEntryKind: 'file',
      selectedCount: 1,
      hasConcreteFocus: true,
      effectiveTargetCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    };

    expect(isActionAvailable(archivePreview, baseContext)).toBe(false);
    expect(isActionAvailable(archivePreview, { ...baseContext, focusedEntryKind: 'archive' })).toBe(true);
  });

  it('derives keyboard shortcut dispatch from explicit keyboardBindings metadata', () => {
    expect(actionForKeyboardShortcut(key('Tab'))?.id).toBe('panel.switchActive');
    expect(actionForKeyboardShortcut(key('Enter'))?.id).toBe('nav.enter');
    expect(actionForKeyboardShortcut(key('h'))?.id).toBe('nav.up');
    expect(actionForKeyboardShortcut(key('y'))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('F5'))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('ㅛ', { code: 'KeyY' }))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('D', { shiftKey: true }))?.id).toBe('file.deletePermanent');
    expect(actionForKeyboardShortcut(key('ㅇ', { code: 'KeyD', shiftKey: true }))?.id).toBe('file.deletePermanent');
    expect(actionForKeyboardShortcut(key('Delete', { shiftKey: true }))?.id).toBe('file.deletePermanent');
    expect(actionForKeyboardShortcut(key('ㅎ', { code: 'KeyG', shiftKey: true }))?.id).toBe('nav.bottom');
    expect(actionForKeyboardShortcut(key('a', { ctrlKey: true }))?.id).toBe('selection.all');
    expect(ACTION_BY_ID.get('archive.preview')?.shortcutLabel).toBe('Enter on archive');
    expect(ACTION_BY_ID.get('archive.preview')?.keyboardBindings).toBeUndefined();
  });

  it('supports sequence shortcuts without parsing display-only shortcut labels', () => {
    const pendingGo = matchKeyboardShortcut(key('g'));
    expect(pendingGo.status).toBe('pending');
    expect(actionForKeyboardShortcut(key('p'), pendingGo.sequence)?.id).toBe('nav.gotoPath');
    expect(actionForKeyboardShortcut(key('g'), pendingGo.sequence)?.id).toBe('nav.top');

    const pendingSort = matchKeyboardShortcut(key('s'));
    expect(pendingSort.status).toBe('pending');
    expect(actionForKeyboardShortcut(key('n'), pendingSort.sequence)?.id).toBe('view.sortName');
  });

  it('derives aria shortcut hints from dispatchable single-key bindings only', () => {
    const ariaShortcuts = ariaKeyShortcutsFromRegistry();
    expect(ariaShortcuts).toContain('Tab');
    expect(ariaShortcuts).toContain('Enter');
    expect(ariaShortcuts).toContain('Control+A');
    expect(ariaShortcuts).not.toContain('Enter on archive');
    expect(ariaShortcuts).not.toContain('g p');
  });

  it('keeps exact keyboard binding collisions out of the registry', () => {
    expect(keyboardBindingCollisions()).toEqual([]);
  });

  it('keeps prefix sequence shortcuts reachable with timeout disambiguation metadata', () => {
    const pendingTab = matchKeyboardShortcut(key('t'));
    expect(pendingTab.status).toBe('pending');

    const pendingBookmark = matchKeyboardShortcut(key('b'), pendingTab.sequence);
    expect(pendingBookmark.status).toBe('pending');
    expect(pendingBookmark.action?.id).toBe('bookmark.list');
    expect(actionForKeyboardShortcut(key('a'), pendingBookmark.sequence)?.id).toBe('bookmark.add');
  });

  it('keeps hotkey strip shortcut formatting behind a registry helper', () => {
    expect(shortcutLabelForAction(ACTION_BY_ID.get('file.copy')!)).toBe('y');
    expect(shortcutLabelForAction(ACTION_BY_ID.get('filter.start')!)).toBe('/');
    expect(shortcutLabelForAction(ACTION_BY_ID.get('archive.preview')!)).toBe('Enter on archive');
  });
});

const key = (
  value: string,
  modifiers: Partial<Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'code'>> = {},
) => ({
  key: value,
  code: modifiers.code ?? '',
  altKey: modifiers.altKey ?? false,
  ctrlKey: modifiers.ctrlKey ?? false,
  metaKey: modifiers.metaKey ?? false,
  shiftKey: modifiers.shiftKey ?? false,
});

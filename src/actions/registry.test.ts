import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTION_BY_ID,
  actionForKeyboardShortcut,
  ariaKeyShortcutsFromRegistry,
  isActionAvailable,
  keyboardBindingCollisions,
  labelForAction,
  menuRootAcceleratorFromRegistry,
  menuRootLabelFromRegistry,
  matchKeyboardShortcut,
  menuRootsFromRegistry,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
} from './registry';
import { COMMANDS } from '../tauri/client';

const requiredActionIds: ActionId[] = [
  'menu.open',
  'view.sortName',
  'view.sortSize',
  'view.sortDate',
  'view.sortExt',
  'view.reverseSort',
  'view.sortAsc',
  'view.sortDesc',
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
  'settings.themeDark',
  'settings.themeLight',
  'settings.themeHighContrast',
  'settings.languageEn',
  'settings.languageKo',
  'settings.editorVi',
  'settings.editorVim',
  'settings.editorNano',
  'settings.editorEmacs',
  'settings.toggleIcons',
  'settings.sizeAuto',
  'settings.sizeBytes',
  'archive.preview',
  'app.quit',
  'external.openDefault',
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

  it('keeps external integration and editor preset menu paths aligned with TUI parity rows', () => {
    expect(ACTION_BY_ID.get('external.openDefault')?.menuPath).toEqual(['File', 'Open Default App']);
    expect(ACTION_BY_ID.get('external.openEditor')?.menuPath).toEqual(['File', 'Open Terminal Editor']);
    expect(ACTION_BY_ID.get('external.runShellCommand')?.menuPath).toEqual(['File', 'Run Shell Command']);
    expect(ACTION_BY_ID.get('app.quit')?.menuPath).toEqual(['File', 'Quit']);
    expect(ACTION_BY_ID.get('nav.gotoPath')?.menuPath).toEqual(['View', 'Go To Path']);
    expect(ACTION_BY_ID.get('nav.locations')?.menuPath).toEqual(['View', 'Mount Points']);
    expect(ACTION_BY_ID.get('history.list')?.menuPath).toEqual(['View', 'History List']);
    expect(ACTION_BY_ID.get('bookmark.add')?.menuPath).toEqual(['View', 'Bookmark Add']);
    expect(ACTION_BY_ID.get('bookmark.list')?.menuPath).toEqual(['View', 'Bookmark List']);
    expect(ACTION_BY_ID.get('layout.toggleSingleDual')?.menuPath).toEqual(['View', 'Toggle Layout']);
    expect(ACTION_BY_ID.get('help.shortcuts')?.menuPath).toEqual(['Help', 'Keyboard Help']);
    expect(ACTION_BY_ID.get('settings.toggleIcons')?.menuPath).toEqual(['Settings', 'Toggle Icons']);
    expect(ACTION_BY_ID.get('settings.editorVi')?.menuPath).toEqual(['Settings', 'Default Editor', 'vi']);
    expect(ACTION_BY_ID.get('settings.editorVim')?.menuPath).toEqual(['Settings', 'Default Editor', 'vim']);
    expect(ACTION_BY_ID.get('settings.editorNano')?.menuPath).toEqual(['Settings', 'Default Editor', 'nano']);
    expect(ACTION_BY_ID.get('settings.editorEmacs')?.menuPath).toEqual(['Settings', 'Default Editor', 'emacs']);
  });

  it('marks irreversible permanent delete distinctly from trash', () => {
    expect(ACTION_BY_ID.get('file.trash')?.dangerLevel).toBe('destructive');
    expect(ACTION_BY_ID.get('file.deletePermanent')?.dangerLevel).toBe('irreversible');
    expect(ACTION_BY_ID.get('file.trash')?.menuPath).toEqual(['File', 'Delete']);
    expect(ACTION_BY_ID.get('file.deletePermanent')?.menuPath).toEqual(['File', 'Permanent Delete']);
    expect(ACTION_BY_ID.get('file.properties')?.menuPath).toEqual(['View', 'File Info']);
  });

  it('derives menu roots and display labels from the registry', () => {
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Archive', 'Settings', 'Help']);
    expect(menuRootsFromRegistry().map((root) => menuRootLabelFromRegistry(root))).toEqual([
      'File(F)',
      'Edit(E)',
      'View(V)',
      'Go(G)',
      'Archive(A)',
      'Settings(S)',
      'Help(H)',
    ]);
    expect(menuRootsFromRegistry().map((root) => menuRootLabelFromRegistry(root, 'ko'))).toEqual([
      '파일(F)',
      '편집(E)',
      '보기(V)',
      '이동(G)',
      '압축(A)',
      '설정(S)',
      '도움말(H)',
    ]);
    expect(menuRootsFromRegistry().map(menuRootAcceleratorFromRegistry)).toEqual(['F', 'E', 'V', 'G', 'A', 'S', 'H']);
    const copy = ACTION_BY_ID.get('file.copy');
    if (!copy) {
      throw new Error('file.copy action is required');
    }
    expect(labelForAction(copy)).toBe('Copy');
    expect(labelForAction(copy, 'ko')).toBe('복사');
    expect(copy.hotkeyLabel).toBe('Copy');
  });

  it('never falls back to raw action IDs for user-facing labels', () => {
    for (const action of ACTIONS) {
      expect(labelForAction(action)).not.toBe(action.id);
      expect(action.hotkeyLabel).not.toBe(action.id);
    }
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
      backendAvailable: true,
    };

    expect(isActionAvailable(archivePreview, baseContext)).toBe(false);
    expect(isActionAvailable(archivePreview, { ...baseContext, focusedEntryKind: 'archive' })).toBe(true);
  });

  it('derives keyboard shortcut dispatch from explicit keyboardBindings metadata', () => {
    expect(actionForKeyboardShortcut(key('Tab'))?.id).toBe('panel.switchActive');
    expect(actionForKeyboardShortcut(key('F9'))?.id).toBe('menu.open');
    expect(actionForKeyboardShortcut(key('Enter'))?.id).toBe('nav.enter');
    expect(actionForKeyboardShortcut(key('h'))?.id).toBe('nav.up');
    expect(actionForKeyboardShortcut(key('y'))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('F5'))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('ㅛ', { code: 'KeyY' }))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('D', { shiftKey: true }))?.id).toBe('file.deletePermanent');
    expect(actionForKeyboardShortcut(key('ㅇ', { code: 'KeyD', shiftKey: true }))?.id).toBe('file.deletePermanent');
    expect(actionForKeyboardShortcut(key('Delete', { shiftKey: true }))?.id).toBe('file.deletePermanent');
    expect(actionForKeyboardShortcut(key('ㅎ', { code: 'KeyG', shiftKey: true }))?.id).toBe('nav.bottom');
    const pendingArchive = matchKeyboardShortcut(key('z'));
    expect(actionForKeyboardShortcut(key('a'), pendingArchive.sequence)?.id).toBe('archive.extractAuto');
    expect(actionForKeyboardShortcut(key('a', { ctrlKey: true }))?.id).toBe('selection.all');
    expect(actionForKeyboardShortcut(key('b', { ctrlKey: true }))?.id).toBe('bookmark.add');
    expect(actionForKeyboardShortcut(key('q', { ctrlKey: true }))).toBeNull();
    expect(actionForKeyboardShortcut(key('q', { metaKey: true }))?.id).toBe('app.quit');
    expect(actionForKeyboardShortcut(key('q'))).toBeNull();
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

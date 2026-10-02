import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../tauri/commands';
import {
  ACTIONS,
  ACTION_BY_ID,
  actionForKeyboardShortcut,
  actionVisibleOnPlatform,
  actionsForMenu,
  ariaKeyShortcutsFromRegistry,
  fileShortcutPlatform,
  isActionAvailable,
  keyboardBindingCollisions,
  labelForAction,
  matchKeyboardShortcut,
  menuRootAcceleratorFromRegistry,
  menuRootLabelFromRegistry,
  menuRootsFromRegistry,
  shortcutHelpLabelForAction,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
} from './registry';

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
  'settings.toggleIcons',
  'settings.sizeAuto',
  'settings.sizeBytes',
  'archive.list',
  'app.quit',
  'external.openDefault',
  'external.openCurrentInFinder',
  'external.openCurrentInTerminal',
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

  it('routes shell command directly to execution', () => {
    const action = ACTION_BY_ID.get('external.runShellCommand');
    expect(action?.command).toBe(COMMANDS.runShellCommand);
    expect(action?.runPath).toContain('run_shell_command');
  });

  it('keeps external integration and editor preset menu paths aligned with TUI parity rows', () => {
    expect(ACTION_BY_ID.get('external.openDefault')?.menuPath).toEqual(['File', 'Open Default App']);
    expect(ACTION_BY_ID.get('external.openCurrentInFinder')?.menuPath).toEqual(['Go', 'Open Current Folder in Finder']);
    expect(ACTION_BY_ID.get('external.openCurrentInTerminal')?.menuPath).toEqual(['Go', 'Open Terminal Here']);
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
  });

  it('does not expose the retired current-path bookmark delete menu', () => {
    expect(ACTION_BY_ID.get('bookmark.delete')?.menuPath).toBeUndefined();
    expect(ACTIONS.some((action) => action.menuPath?.join('/') === 'Go/Bookmark/Delete')).toBe(false);
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
    expect(labelForAction(copy)).toBe('Copy to Other Panel');
    expect(labelForAction(copy, 'ko')).toBe('반대 패널로 복사');
    expect(copy.hotkeyLabel).toBe('Copy');
  });

  it('never falls back to raw action IDs for user-facing labels', () => {
    for (const action of ACTIONS) {
      expect(labelForAction(action)).not.toBe(action.id);
      expect(action.hotkeyLabel).not.toBe(action.id);
    }
  });

  it('offers current-directory app actions only for real macOS directories', () => {
    const context: ActionContext = {
      activePanel: 'right', focusedEntryKind: null, selectedCount: 0,
      hasConcreteFocus: false, effectiveTargetCount: 0, platform: 'mac',
      hasOppositePanel: true, shellCommandEnabled: false, operationBusy: false,
      backendAvailable: true, activePathIsArchive: false,
    };
    for (const id of ['external.openCurrentInFinder', 'external.openCurrentInTerminal']) {
      const action = ACTION_BY_ID.get(id)!;
      expect(action.isEnabled(context)).toBe(true);
      expect(action.isEnabled({ ...context, activePathIsArchive: true })).toBe(false);
      expect(action.isEnabled({ ...context, platform: 'other' })).toBe(false);
      expect(action.isEnabled({ ...context, backendAvailable: false })).toBe(false);
    }
  });

  it('applies contextScopes before action-specific enablement', () => {
    const archiveOpen = ACTION_BY_ID.get('archive.list');
    if (!archiveOpen) {
      throw new Error('archive.open action is required');
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
      activePathIsArchive: false,
    };

    expect(isActionAvailable(archiveOpen, baseContext)).toBe(false);
    expect(isActionAvailable(archiveOpen, { ...baseContext, focusedEntryKind: 'archive' })).toBe(true);
  });

  it('keeps archive virtual directories read-only while allowing copy-out', () => {
    const archiveContext: ActionContext = {
      activePanel: 'left',
      focusedEntryKind: 'file',
      selectedCount: 1,
      hasConcreteFocus: true,
      effectiveTargetCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
      backendAvailable: true,
      activePathIsArchive: true,
    };

    expect(isActionAvailable(ACTION_BY_ID.get('file.copy')!, archiveContext)).toBe(true);
    for (const actionId of ['file.move', 'file.trash', 'file.deletePermanent', 'file.rename', 'file.mkdir'] as const) {
      expect(isActionAvailable(ACTION_BY_ID.get(actionId)!, archiveContext)).toBe(false);
    }
  });

  it('shows Finder move paste on Mac and cut paste on Windows', () => {
    const copy = ACTION_BY_ID.get('file.clipboardCopy')!;
    const cut = ACTION_BY_ID.get('file.clipboardCut')!;
    const paste = ACTION_BY_ID.get('file.clipboardPaste')!;
    const moveHere = ACTION_BY_ID.get('file.clipboardMovePaste')!;

    expect(fileShortcutPlatform('Mozilla/5.0 (Macintosh; Intel Mac OS X)')).toBe('mac');
    expect(fileShortcutPlatform('Mozilla/5.0 (Windows NT 10.0)')).toBe('other');
    expect(shortcutHelpLabelForAction(copy, 'mac')).toBe('Cmd+C');
    expect(shortcutHelpLabelForAction(copy, 'other')).toBe('Ctrl+C');
    expect(shortcutHelpLabelForAction(paste, 'other')).toBe('Ctrl+V');
    expect(actionVisibleOnPlatform(cut, 'mac')).toBe(false);
    expect(actionVisibleOnPlatform(moveHere, 'other')).toBe(false);
    expect(actionsForMenu('Go', 'mac').some((action) => action.id === 'external.openCurrentInFinder')).toBe(true);
    expect(actionsForMenu('Go', 'other').some((action) => action.id === 'external.openCurrentInFinder')).toBe(false);
    expect(actionsForMenu('Go', 'other').some((action) => action.id === 'external.openCurrentInTerminal')).toBe(false);
    expect(actionsForMenu('Edit', 'mac').some((action) => action.id === 'file.clipboardMovePaste')).toBe(true);
    expect(actionsForMenu('Edit', 'other').some((action) => action.id === 'file.clipboardCut')).toBe(true);
  });

  it('derives keyboard shortcut dispatch from explicit keyboardBindings metadata', () => {
    expect(actionForKeyboardShortcut(key('Tab'))?.id).toBe('panel.switchActive');
    expect(actionForKeyboardShortcut(key('F9'))?.id).toBe('menu.open');
    expect(actionForKeyboardShortcut(key('Enter'))?.id).toBe('nav.enter');
    expect(actionForKeyboardShortcut(key('h'))?.id).toBe('nav.up');
    expect(actionForKeyboardShortcut(key('y'))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('F5'))?.id).toBe('file.copy');
    expect(actionForKeyboardShortcut(key('c', { metaKey: true }))?.id).toBe('file.clipboardCopy');
    expect(actionForKeyboardShortcut(key('v', { metaKey: true }))?.id).toBe('file.clipboardPaste');
    expect(actionForKeyboardShortcut(key('v', { metaKey: true, altKey: true }))?.id).toBe('file.clipboardMovePaste');
    expect(actionForKeyboardShortcut(key('c', { ctrlKey: true }))?.id).toBe('file.clipboardCopy');
    expect(actionForKeyboardShortcut(key('x', { ctrlKey: true }))?.id).toBe('file.clipboardCut');
    expect(actionForKeyboardShortcut(key('v', { ctrlKey: true }))?.id).toBe('file.clipboardPaste');
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
    expect(ACTION_BY_ID.get('archive.list')?.shortcutLabel).toBe('Enter on archive');
    expect(ACTION_BY_ID.get('archive.list')?.keyboardBindings).toBeUndefined();
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

  it('opens the bookmark list as soon as the tb sequence is complete', () => {
    const pendingTab = matchKeyboardShortcut(key('t'));
    expect(pendingTab.status).toBe('pending');

    const bookmarkList = matchKeyboardShortcut(key('b'), pendingTab.sequence);
    expect(bookmarkList.status).toBe('matched');
    expect(bookmarkList.action?.id).toBe('bookmark.list');
    expect(ACTION_BY_ID.get('bookmark.add')?.keyboardBindings).toEqual(['Ctrl+B']);
  });

  it('keeps hotkey strip shortcut formatting behind a registry helper', () => {
    expect(shortcutLabelForAction(ACTION_BY_ID.get('file.copy')!)).toBe('y');
    expect(shortcutLabelForAction(ACTION_BY_ID.get('filter.start')!)).toBe('/');
    expect(shortcutLabelForAction(ACTION_BY_ID.get('archive.list')!)).toBe('Enter on archive');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('file.copy')!)).toBe('y/F5');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('file.deletePermanent')!)).toBe('Shift+D/Shift+Delete');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('bookmark.add')!)).toBe('Ctrl+B');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('help.search')!)).toBe('');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('external.openWith')!)).toBe('');
    expect(actionForKeyboardShortcut(key('.'))?.id).toBe('view.toggleHidden');
    expect(actionForKeyboardShortcut(key('e'))).toBeNull();
    expect(ACTIONS.some((action) => action.id === 'external.openEditor' || action.id.startsWith('settings.editor'))).toBe(false);
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

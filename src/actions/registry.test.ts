import { requiredActionIdsFromParity } from '../verification/featureContracts';
import parityMatrix from '../../docs/implementation/tui-parity-matrix.json';
import { describe, expect, it } from 'vitest';
import { COMMANDS } from '../tauri/commands';
import { platformInfoFixture } from '../ui/testing/clientStubs';
import { fileShortcutPlatform } from '../domain/runtimePlatform';
import { ACTION_LABELS, MENU_SEGMENT_LABELS } from '../i18n-resources';
import {
  ACTIONS,
  ACTION_BY_ID,
  MENU_LAYOUT,
  actionForKeyboardShortcut,
  actionVisibleOnPlatform,
  actionsForMenu,
  ariaKeyShortcutsFromRegistry,
  getAction,
  isActionAvailable,
  keyboardBindingCollisions,
  keyboardBindingsForAction,
  labelForAction,
  matchKeyboardShortcut,
  menuItemLabel,
  menuRootAcceleratorFromRegistry,
  menuRootLabelFromRegistry,
  menuRootsFromRegistry,
  menuSegmentLabel,
  shortcutHelpLabelForAction,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
} from './registry';

const requiredActionIds = requiredActionIdsFromParity(parityMatrix);

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
    expect(ACTION_BY_ID.get('external.openCurrentInFileManager')?.menuPath).toEqual(['Go', 'Open Current Folder in File Manager']);
    expect(ACTION_BY_ID.get('external.openCurrentInTerminal')?.menuPath).toEqual(['Go', 'Open Terminal Here']);
    expect(ACTION_BY_ID.get('external.runShellCommand')?.menuPath).toEqual(['File', 'Run Shell Command']);
    expect(ACTION_BY_ID.get('app.quit')?.menuPath).toEqual(['File', 'Quit']);
    // 경로·위치·히스토리·북마크는 이동(G) 메뉴(UX 점검 2026-10-31: 보기 메뉴에서 옮김)
    expect(ACTION_BY_ID.get('nav.gotoPath')?.menuPath).toEqual(['Go', 'Go To Path']);
    expect(ACTION_BY_ID.get('nav.locations')?.menuPath).toEqual(['Go', 'Mount Points']);
    expect(ACTION_BY_ID.get('history.list')?.menuPath).toEqual(['Go', 'History List']);
    expect(ACTION_BY_ID.get('bookmark.add')?.menuPath).toEqual(['Go', 'Bookmark Add']);
    expect(ACTION_BY_ID.get('bookmark.list')?.menuPath).toEqual(['Go', 'Bookmark List']);
    expect(ACTION_BY_ID.get('layout.toggleSingleDual')?.menuPath).toEqual(['View', 'Toggle Layout']);
    expect(ACTION_BY_ID.get('help.shortcuts')?.menuPath).toEqual(['Help', 'Keyboard Help']);
    expect(ACTION_BY_ID.get('settings.toggleIcons')?.menuPath).toEqual(['Settings', 'Show File Icons']);
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

  it('limits local-only actions to local panels and remote-only actions to remote panels', () => {
    const base = { activePanel: 'right' as const, focusedEntryKind: 'file' as const, selectedCount: 0, hasConcreteFocus: true, effectiveTargetCount: 1,
      hasOppositePanel: true, shellCommandEnabled: true, operationBusy: false, backendAvailable: true, activePathIsArchive: false };
    const available = (id: ActionId, activePathIsRemote: boolean) => isActionAvailable(getAction(id), { ...base, activePathIsRemote });
    for (const id of ['external.reveal', 'external.openWith', 'archive.create', 'file.undoTrash', 'external.openCurrentInTerminal', 'external.runShellCommand'] as const) {
      expect(getAction(id).remoteSupport, id).toBe('localOnly');
    }
    expect(available('external.reveal', true)).toBe(false);
    expect(available('external.reveal', false)).toBe(true);
    for (const id of ['external.openDefault', 'file.quickView', 'file.clipboardCopy', 'file.copy', 'file.move'] as const) {
      expect(getAction(id).remoteSupport, id).toBeUndefined();
    }
    expect(available('remote.chmod', true)).toBe(true);
    expect(available('remote.chmod', false)).toBe(false);
    for (const id of ['file.mkdir', 'file.rename', 'file.trash', 'file.deletePermanent', 'file.bulkRename', 'file.properties'] as const) {
      expect(getAction(id).remoteSupport, id).toBeUndefined();
    }
  });

  it('derives menu roots and display labels from the registry', () => {
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Remote', 'Archive', 'Settings', 'Help']);
    expect(menuRootsFromRegistry().map((root) => menuRootLabelFromRegistry(root))).toEqual([
      'File(F)',
      'Edit(E)',
      'View(V)',
      'Go(G)',
      'Remote(R)',
      'Archive(A)',
      'Settings(S)',
      'Help(H)',
    ]);
    expect(menuRootsFromRegistry().map((root) => menuRootLabelFromRegistry(root, 'ko'))).toEqual([
      '파일(F)',
      '편집(E)',
      '보기(V)',
      '이동(G)',
      '원격(R)',
      '압축(A)',
      '설정(S)',
      '도움말(H)',
    ]);
    expect(menuRootsFromRegistry().map(menuRootAcceleratorFromRegistry)).toEqual(['F', 'E', 'V', 'G', 'R', 'A', 'S', 'H']);
    const copy = ACTION_BY_ID.get('file.copy');
    if (!copy) {
      throw new Error('file.copy action is required');
    }
    expect(labelForAction(copy)).toBe('Copy to Other Panel');
    expect(labelForAction(copy, 'ko')).toBe('반대 패널로 복사');
    expect(copy.hotkeyLabel).toBe('Copy');
  });

  it('places every menu action exactly once in its own menu layout group', () => {
    const placed = Object.entries(MENU_LAYOUT).flatMap(([root, groups]) => groups.flat().map((id) => ({ root, id })));
    expect(new Set(placed.map(({ id }) => id)).size).toBe(placed.length);
    for (const { root, id } of placed) expect(getAction(id).menuPath?.[0], id).toBe(root);
    const menuActions = ACTIONS.filter((action) => action.menuPath).map((action) => action.id).sort();
    expect(placed.map(({ id }) => id).sort()).toEqual(menuActions);
  });

  it('translates every menu path segment and names menu items like help and status messages', () => {
    const numeric = /^\d+:\d+$/;
    const missing = [...new Set(ACTIONS.flatMap((action) => action.menuPath ?? []))]
      .filter((segment) => !numeric.test(segment) && !(segment in MENU_SEGMENT_LABELS.ko));
    expect(missing).toEqual([]);
    // 최상위 메뉴 항목 이름 = 도움말·상태 줄·우클릭 메뉴가 쓰는 액션 이름(이름 출처가 둘이라 어긋나지 않게)
    const mismatched = ACTIONS.filter((action) => action.menuPath?.length === 2).flatMap((action) =>
      (['ko', 'en'] as const).flatMap((language) => {
        const menuLabel = menuSegmentLabel(action.menuPath![1], language);
        const actionLabel = labelForAction(action, language);
        return menuLabel === actionLabel ? [] : [`${action.id} (${language}): menu "${menuLabel}" vs action "${actionLabel}"`];
      }));
    expect(mismatched).toEqual([]);
  });

  it('adds the ellipsis only when drawing menus, never inside label tables', () => {
    for (const language of ['ko', 'en'] as const) {
      const labels = [...Object.values(MENU_SEGMENT_LABELS[language]), ...Object.values(ACTION_LABELS[language])];
      expect(labels.filter((label) => label.includes('…'))).toEqual([]);
    }
    expect(menuItemLabel(getAction('file.rename'), '이름 변경')).toBe('이름 변경…');
    expect(menuItemLabel(getAction('file.trash'), '삭제')).toBe('삭제');
  });

  it('ends the File menu with Quit in its own group and moves archive and navigation lists to their menus', () => {
    const file = MENU_LAYOUT.File;
    expect(file.at(-1)).toEqual(['app.quit']);
    expect(actionsForMenu('Archive', 'mac').map((action) => action.id)).toEqual(['archive.list', 'archive.extract', 'archive.extractAuto', 'archive.create']);
    expect(actionsForMenu('Go', 'mac').map((action) => action.id)).toEqual(expect.arrayContaining(['nav.gotoPath', 'nav.locations', 'history.list', 'bookmark.list']));
    expect(actionsForMenu('View', 'mac').map((action) => action.id)).not.toContain('nav.gotoPath');
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
    for (const id of ['external.openCurrentInFileManager', 'external.openCurrentInTerminal']) {
      const action = ACTION_BY_ID.get(id)!;
      expect(isActionAvailable(action, context)).toBe(true);
      expect(isActionAvailable(action, { ...context, activePathIsArchive: true })).toBe(false);
      expect(isActionAvailable(action, { ...context, platform: 'other' })).toBe(false);
      expect(isActionAvailable(action, { ...context, backendAvailable: false })).toBe(false);
    }
  });

  it('keeps a remote connection while a file operation is still running', () => {
    const disconnect = ACTION_BY_ID.get('remote.disconnect')!;
    const context: ActionContext = {
      activePanel: 'left', focusedEntryKind: null, selectedCount: 0,
      hasConcreteFocus: false, effectiveTargetCount: 0,
      hasOppositePanel: true, shellCommandEnabled: false, operationBusy: false,
      backendAvailable: true, activePathIsArchive: false, activePathIsRemote: true, activeRemoteConnected: true,
    };
    expect(isActionAvailable(disconnect, context)).toBe(true);
    // 진행 중인 복사·이동이 이 연결을 쓰고 있을 수 있어 작업이 끝날 때까지 끊기 금지
    expect(isActionAvailable(disconnect, { ...context, operationBusy: true })).toBe(false);
    expect(isActionAvailable(disconnect, { ...context, activeRemoteConnected: false })).toBe(false);
  });

  it('lists blank-area context actions only through the blank context scope', () => {
    expect(ACTIONS.filter((action) => action.contextScopes?.includes('blank')).map((action) => action.id)).toEqual([
      'nav.refresh', 'nav.gotoPath', 'file.clipboardPaste', 'file.clipboardMovePaste', 'file.mkdir',
      'remote.disconnect', 'remote.reconnect', 'remote.info',
      'external.openCurrentInFileManager', 'external.openCurrentInTerminal',
      'view.sortName', 'view.sortSize', 'view.sortDate', 'view.sortExt', 'filter.start', 'filter.clear', 'view.toggleHidden',
    ]);
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
    expect(actionsForMenu('Go', 'mac').some((action) => action.id === 'external.openCurrentInFileManager')).toBe(true);
    expect(actionsForMenu('Go', 'other').some((action) => action.id === 'external.openCurrentInFileManager')).toBe(false);
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
    expect(ACTION_BY_ID.get('archive.list')?.shortcutLabel).toBe('Enter');
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
    expect(keyboardBindingsForAction(ACTION_BY_ID.get('bookmark.add')!, 'mac')).toEqual(['Cmd+B', 'Ctrl+B']);
    expect(keyboardBindingsForAction(ACTION_BY_ID.get('bookmark.add')!, 'other')).toEqual(['Ctrl+B']);
  });

  it('keeps hotkey strip shortcut formatting behind a registry helper', () => {
    expect(shortcutLabelForAction(ACTION_BY_ID.get('file.copy')!)).toBe('y');
    expect(shortcutLabelForAction(ACTION_BY_ID.get('filter.start')!)).toBe('/');
    expect(shortcutLabelForAction(ACTION_BY_ID.get('archive.list')!)).toBe('Enter');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('file.copy')!)).toBe('y/F5');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('file.deletePermanent')!)).toBe('Shift+D/Shift+Delete');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('bookmark.add')!, 'mac')).toBe('Cmd+B');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('bookmark.add')!, 'other')).toBe('Ctrl+B');
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

it('uses backend feature availability even when keyboard presentation is macOS', () => {
  const context: ActionContext = { activePanel: 'left', focusedEntryKind: 'file', selectedCount: 1,
    hasConcreteFocus: true, effectiveTargetCount: 1, platform: 'mac', hasOppositePanel: true,
    shellCommandEnabled: false, operationBusy: false, backendAvailable: true, activePathIsArchive: false,
    trashUndoAvailable: true,
    platformInfo: { os: 'windows', features: { openWith: false, currentFolderManager: false,
      currentFolderTerminal: false, nativeFileClipboard: false, trashUndo: false } } };
  for (const id of ['external.openWith', 'file.undoTrash', 'external.openCurrentInFileManager', 'external.openCurrentInTerminal'] as const) {
    expect(isActionAvailable(ACTION_BY_ID.get(id)!, context)).toBe(false);
  }
  expect(isActionAvailable(ACTION_BY_ID.get('file.copy')!, context)).toBe(true);
});


it('shows supported Windows desktop actions consistently with backend capabilities', () => {
  const platformInfo = platformInfoFixture('windows', { nativeFileClipboard: false, trashUndo: false });
  const go = actionsForMenu('Go', 'other', platformInfo).map(action => action.id);
  expect(go).toContain('external.openCurrentInFileManager');
  expect(go).toContain('external.openCurrentInTerminal');
  expect(actionsForMenu('File', 'other', platformInfo).map(action => action.id)).toContain('external.openWith');
  expect(actionsForMenu('Edit', 'other', platformInfo).map(action => action.id)).not.toContain('file.undoTrash');
  expect(actionVisibleOnPlatform(ACTION_BY_ID.get('external.openWith')!, 'mac', {
    ...platformInfo, features: { ...platformInfo.features, openWith: false },
  })).toBe(false);
});


describe('platform keyboard coverage', () => {
  it.each(['mac', 'other'] as const)('dispatches every registered %s binding without collisions', platform => {
    expect(keyboardBindingCollisions(platform)).toEqual([]);
    for (const action of ACTIONS) {
      for (const binding of keyboardBindingsForAction(action, platform)) {
        let sequence: readonly string[] = [];
        let result: ReturnType<typeof matchKeyboardShortcut> | undefined;
        for (const token of binding.split(' ')) {
          const parts = token.split('+');
          const name = parts.at(-1)!;
          result = matchKeyboardShortcut(key(name === 'Space' ? ' ' : name, {
            ctrlKey: parts.includes('Ctrl'), metaKey: parts.includes('Cmd'),
            altKey: parts.includes('Alt'), shiftKey: parts.includes('Shift'),
          }), sequence, platform);
          sequence = result.sequence;
        }
        expect(result?.action?.id, `${platform}: ${binding}`).toBe(action.id);
      }
    }
  });

  it('keeps Windows labels, accessibility hints and bindings free of Mac-only modifiers', () => {
    for (const action of ACTIONS) {
      expect(keyboardBindingsForAction(action, 'other').join(' ')).not.toMatch(/Cmd|Meta/);
      if (actionVisibleOnPlatform(action, 'other')) {
        expect(shortcutLabelForAction(action, 'other')).not.toMatch(/Cmd|Opt|⌘|⌥/);
        expect(shortcutHelpLabelForAction(action, 'other')).not.toMatch(/Cmd|Opt|⌘|⌥/);
      }
    }
    expect(ariaKeyShortcutsFromRegistry('other')).toContain('Alt+F4');
    expect(ariaKeyShortcutsFromRegistry('other')).not.toContain('Meta');
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('app.quit')!, 'other')).toBe('Alt+F4');
    expect(actionForKeyboardShortcut(key('q', { metaKey: true }), [], 'other')).toBeNull();
    expect(actionForKeyboardShortcut(key('v', { metaKey: true, altKey: true }), [], 'other')).toBeNull();
    expect(actionForKeyboardShortcut(key('F4', { altKey: true }), [], 'mac')).toBeNull();
    expect(shortcutHelpLabelForAction(ACTION_BY_ID.get('app.quit')!, 'mac')).toBe('Cmd+Q');
  });
});

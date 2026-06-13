import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ACTION_BY_ID,
  isActionAvailable,
  labelForAction,
  menuRootsFromRegistry,
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
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    };

    expect(isActionAvailable(archivePreview, baseContext)).toBe(false);
    expect(isActionAvailable(archivePreview, { ...baseContext, focusedEntryKind: 'archive' })).toBe(true);
  });
});

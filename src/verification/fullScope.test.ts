import { describe, expect, it } from 'vitest';
import { ACTIONS, ACTION_BY_ID, isActionAvailable, menuRootsFromRegistry } from '../actions/registry';
import { BACKEND_IMPLEMENTED_COMMANDS, COMMANDS, isBackendImplementedCommand } from '../tauri/client';
import { canTransitionOperation } from '../operations/operationStore';
import { useOperationStore } from '../operations/operationStore';
import { contextMenuActions } from '../ui/CommanderShell';
import { createActionContext } from '../ui/actionContext';
import { SAMPLE_LISTINGS } from '../ui/commanderFixture';
import { I18N_RESOURCES } from '../i18n-resources';

describe('full-scope verification harness', () => {
  it('keeps command-backed actions aligned with known Tauri command names', () => {
    const commandNames = new Set(Object.values(COMMANDS));
    for (const action of ACTIONS) {
      if (action.command) {
        expect(commandNames.has(action.command)).toBe(true);
      }
    }
  });

  it('keeps implemented frontend wrappers aligned with registered backend handlers', () => {
    expect(BACKEND_IMPLEMENTED_COMMANDS).toEqual(Object.values(COMMANDS));
    expect(isBackendImplementedCommand(COMMANDS.listDir)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.createDir)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.renameEntry)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.startDelete)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.archiveCreate)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.prepareShellCommand)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.runShellCommand)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.openDefault)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.saveSettings)).toBe(true);
  });

  it('keeps parity-critical GUI and file-manager actions registered', () => {
    const requiredIds = [
      'nav.back',
      'nav.forward',
      'history.list',
      'bookmark.add',
      'bookmark.list',
      'bookmark.rename',
      'bookmark.delete',
      'layout.toggleSingleDual',
      'layout.ratio50',
      'layout.ratio70Left',
      'layout.ratio70Right',
      'archive.preview',
      'external.runShellCommand',
      'help.search',
      'help.about',
    ] as const;

    for (const id of requiredIds) {
      expect(ACTION_BY_ID.has(id)).toBe(true);
    }
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Archive', 'Tools', 'Settings', 'Help']);
  });

  it('keeps operation-state safety transitions explicit', () => {
    expect(canTransitionOperation('validating', 'scanning')).toBe(true);
    expect(canTransitionOperation('running', 'cancelling')).toBe(true);
    expect(canTransitionOperation('waitingForConflict', 'running')).toBe(true);
    expect(canTransitionOperation('failed', 'running')).toBe(false);
  });

  it('keeps operation history and message resources available for audit and i18n surfaces', () => {
    useOperationStore.setState({ operationHistory: [] });
    useOperationStore.getState().applyOperationSummary({
      operationId: 'scope-history',
      kind: 'archiveCreate',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });

    expect(useOperationStore.getState().operationHistory[0]?.operationId).toBe('scope-history');
    expect(I18N_RESOURCES.ko['errors.archiveFormatUnsupported']).toBeTruthy();
    expect(I18N_RESOURCES.en['errors.shellCommandDisabled']).toBeTruthy();
  });

  it('uses action-registry enablement for context menu actions and blocks virtual targets', () => {
    const virtualParent = SAMPLE_LISTINGS.left.entries[0];
    const context = createActionContext({
      activePanel: 'left',
      focusedEntry: virtualParent,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });

    expect(virtualParent.isVirtual).toBe(true);
    expect(contextMenuActions(virtualParent, context).map((action) => action.id)).toEqual(['nav.enter']);

    const archiveEntry = SAMPLE_LISTINGS.left.entries.find((entry) => entry.name === 'release-bundle.zip');
    const archivePreview = ACTION_BY_ID.get('archive.preview');
    if (!archiveEntry || !archivePreview) {
      throw new Error('archive fixture and preview action are required');
    }
    const archiveContext = createActionContext({
      activePanel: 'left',
      focusedEntry: archiveEntry,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });
    expect(isActionAvailable(archivePreview, context)).toBe(false);
    expect(isActionAvailable(archivePreview, archiveContext)).toBe(true);
    expect(contextMenuActions(archiveEntry, archiveContext).map((action) => action.id)).toEqual(
      expect.arrayContaining(['archive.preview', 'archive.list', 'archive.extract']),
    );
  });
});

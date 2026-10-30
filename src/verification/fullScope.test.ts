import { requiredActionIdsFromParity } from './featureContracts';
import { describe, expect, it } from 'vitest';
import parityMatrix from '../../docs/implementation/tui-parity-matrix.json';
import { ACTIONS, ACTION_BY_ID, isActionAvailable, menuRootsFromRegistry } from '../actions/registry';
import { I18N_RESOURCES } from '../i18n-resources';
import { canTransitionOperation } from '../operations/operationLifecycle';
import { useOperationStore } from '../operations/operationStore';
import { COMMANDS } from '../tauri/commands';
import { createActionContext } from '../ui/actionContext';
import { isArchiveVirtualPath } from '../ui/archiveVirtual';
import { SAMPLE_LISTINGS } from '../ui/commanderFixture';
import { contextMenuActions } from '../ui/menuModel';

describe('full-scope verification harness', () => {
  it('keeps command-backed actions aligned with known Tauri command names', () => {
    const commandNames = new Set(Object.values(COMMANDS));
    for (const action of ACTIONS) {
      if (action.command) {
        expect(commandNames.has(action.command)).toBe(true);
      }
    }
    expect(ACTION_BY_ID.get('archive.create')?.command).toBe(COMMANDS.archiveCreate);
    expect(ACTION_BY_ID.get('external.runShellCommand')?.command).toBe(COMMANDS.runShellCommand);
  });

  it('keeps parity-critical GUI and file-manager actions registered', () => {
    const requiredIds = requiredActionIdsFromParity(parityMatrix);

    for (const id of requiredIds) {
      expect(ACTION_BY_ID.has(id)).toBe(true);
    }
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Remote', 'Archive', 'Settings', 'Help']);
  });

  it('keeps the BokslDir TUI parity matrix as the hard gate for incomplete actions', () => {
    const rowsById = new Map(parityMatrix.tuiActions.map((row) => [row.tuiId, row]));
    const guiOnlyExtensionIds = new Set(parityMatrix.guiOnlyExtensions.map((item) => item.guiActionId));
    const mappedGuiIds = new Set(
      parityMatrix.tuiActions.flatMap((row) =>
        row.guiActionIds.filter((id) => !id.startsWith('__ui_motion.')),
      ),
    );

    expect(parityMatrix.tuiActions).toHaveLength(64);
    expect(rowsById.get('open_menu')).toMatchObject({ implementationStatus: 'implemented', priority: 'P0' });
    expect(rowsById.get('open_menu')?.guiActionIds).toContain('menu.open');
    expect(rowsById.get('copy')).toMatchObject({ implementationStatus: 'implemented', priority: 'P0' });
    expect(rowsById.get('copy')?.guiMenuPaths).toContainEqual(['Edit', 'Copy']);
    expect(rowsById.get('move')).toMatchObject({ implementationStatus: 'implemented', priority: 'P0' });
    expect(rowsById.get('move')?.guiMenuPaths).toContainEqual(['Edit', 'Move']);
    expect(rowsById.get('delete')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('delete')?.guiMenuPaths).toContainEqual(['File', 'Delete']);
    expect(rowsById.get('perm_delete')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('perm_delete')?.guiMenuPaths).toContainEqual(['File', 'Permanent Delete']);
    expect(rowsById.get('file_info')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('file_info')?.guiMenuPaths).toContainEqual(['View', 'File Info']);
    for (const id of ['move_up', 'move_down', 'go_parent', 'enter', 'page_up', 'page_down', 'toggle_sel'] as const) {
      expect(rowsById.get(id)).toMatchObject({ implementationStatus: 'implemented', priority: 'P0' });
    }
    expect(rowsById.get('archive_compress')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('archive_extract')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('archive_extract_auto')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('archive_preview')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('archive_extract_auto')?.guiActionIds).toContain('archive.extractAuto');
    expect(rowsById.get('open_default')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('open_default')?.guiMenuPaths).toContainEqual(['File', 'Open Default App']);
    expect(rowsById.get('open_terminal_editor')).toMatchObject({ implementationStatus: 'excluded', priority: 'P1' });
    expect(rowsById.get('run_shell_command')).toMatchObject({ implementationStatus: 'implemented', priority: 'P1' });
    expect(rowsById.get('run_shell_command')?.guiMenuPaths).toContainEqual(['File', 'Run Shell Command']);
    expect(rowsById.get('editor_preset_vi')).toMatchObject({ implementationStatus: 'excluded', priority: 'P1' });
    expect(rowsById.get('editor_preset_vim')).toMatchObject({ implementationStatus: 'excluded', priority: 'P1' });
    expect(rowsById.get('editor_preset_nano')).toMatchObject({ implementationStatus: 'excluded', priority: 'P1' });
    expect(rowsById.get('editor_preset_emacs')).toMatchObject({ implementationStatus: 'excluded', priority: 'P1' });
    for (const id of ['toggle_layout', 'tab_new', 'tab_close', 'help_keys', 'quit', 'toggle_icons', 'filter_start', 'filter_clear', 'mount_points', 'goto_path', 'tab_list', 'history_list', 'bookmark_add', 'bookmark_list', 'about'] as const) {
      expect(rowsById.get(id)).toMatchObject({ implementationStatus: 'implemented' });
    }

    for (const action of ACTIONS) {
      expect(mappedGuiIds.has(action.id) || guiOnlyExtensionIds.has(action.id)).toBe(true);
    }
  });

  it('keeps operation-state safety transitions explicit', () => {
    expect(canTransitionOperation('validating', 'scanning')).toBe(true);
    expect(canTransitionOperation('running', 'cancelling')).toBe(true);
    expect(canTransitionOperation('waitingForConflict', 'running')).toBe(true);
    expect(canTransitionOperation('failed', 'running')).toBe(false);
  });

  it('keeps operation history available for audit surfaces', () => {
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
  });

  it('translates every message key the Rust backend can return', () => {
    const rustSources = Object.values(import.meta.glob('../../src-tauri/src/**/*.rs', { query: '?raw', import: 'default', eager: true }));
    // 오류 키(errors.*)와 쉘 정책 사유 같은 설정 메시지 키(settings.<영역>.<…>). 파일 이름 "settings.json"은 제외.
    const keys = [...new Set(rustSources.flatMap((source) =>
      [...String(source).matchAll(/"(errors\.[A-Za-z0-9]+|settings\.[A-Za-z]+(?:\.[A-Za-z]+)+)"/g)].map((match) => match[1])))];

    expect(keys.length).toBeGreaterThan(20);
    expect(keys).toContain('settings.external.shellCommand.disabledByDefault');
    for (const language of ['ko', 'en'] as const) {
      expect(keys.filter((key) => !I18N_RESOURCES[language][key]), language).toEqual([]);
    }
  });

  it('recognizes every required archive format as a virtual directory', () => {
    for (const name of [
      'fixture.zip', 'fixture.tar', 'fixture.tar.gz', 'fixture.tgz',
      'fixture.tar.zst', 'fixture.tzst', 'fixture.7z', 'fixture.jar', 'fixture.war',
    ]) {
      expect(isArchiveVirtualPath(`/tmp/${name}:/`), name).toBe(true);
    }
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
    const archiveOpen = ACTION_BY_ID.get('archive.list');
    if (!archiveEntry || !archiveOpen) {
      throw new Error('archive fixture and open action are required');
    }
    const archiveContext = createActionContext({
      activePanel: 'left',
      focusedEntry: archiveEntry,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });
    expect(isActionAvailable(archiveOpen, context)).toBe(false);
    expect(isActionAvailable(archiveOpen, archiveContext)).toBe(true);
    expect(contextMenuActions(archiveEntry, archiveContext).map((action) => action.id)).toEqual(
      expect.arrayContaining(['archive.list', 'archive.extract', 'archive.extractAuto']),
    );

    const archiveVirtualContext = createActionContext({
      activePanel: 'left',
      focusedEntry: { ...archiveEntry, kind: 'file' },
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
      activePathIsArchive: true,
    });
    expect(isActionAvailable(ACTION_BY_ID.get('file.copy')!, archiveVirtualContext)).toBe(true);
    for (const id of ['file.move', 'file.trash', 'file.deletePermanent', 'file.rename'] as const) {
      expect(isActionAvailable(ACTION_BY_ID.get(id)!, archiveVirtualContext)).toBe(false);
    }
  });
});

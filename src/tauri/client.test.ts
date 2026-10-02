import { describe, expect, it } from 'vitest';
import { BACKEND_IMPLEMENTED_COMMANDS, isBackendImplementedCommand, isTauriRuntime, normalizeInvokeError, tauriClient } from './client';
import { COMMANDS } from './commands';

describe('Tauri command names', () => {
  it('keeps shell command preparation and execution as separate backend commands', () => {
    expect(COMMANDS.prepareShellCommand).toBe('prepare_shell_command');
    expect(COMMANDS.runShellCommand).toBe('run_shell_command');
  });

  it('uses canonical command names from the API design', () => {
    expect(Object.values(COMMANDS)).toEqual(
      expect.arrayContaining([
        'list_dir',
        'get_metadata',
        'goto_path',
        'resolve_conflict',
      ]),
    );
  });

  it('declares only currently registered Rust commands as backend implemented', () => {
    expect(BACKEND_IMPLEMENTED_COMMANDS).toEqual([
      'list_dir',
      'get_metadata',
      'preview_file',
      'watch_path',
      'goto_path',
      'list_locations',
      'create_dir',
      'rename_entry',
      'start_copy',
      'start_move',
      'start_delete',
      'cancel_operation',
      'resolve_conflict',
      'archive_list',
      'archive_create',
      'archive_extract',
      'archive_add',
      'open_default',
      'list_open_with_apps',
      'open_with_app',
      'reveal_in_manager',
      'open_current_in_finder',
      'open_current_in_terminal',
      'prepare_shell_command',
      'run_shell_command',
      'load_settings',
      'save_settings',
    ]);
    expect(isBackendImplementedCommand(COMMANDS.listDir)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.createDir)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.renameEntry)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.startCopy)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.startDelete)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.archiveCreate)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.archiveAdd)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.openDefault)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.saveSettings)).toBe(true);
  });

  it('has no remaining frontend wrappers outside the registered backend surface', () => {
    expect(BACKEND_IMPLEMENTED_COMMANDS).toEqual(Object.values(COMMANDS));
  });

  it('normalizes structured and unknown invoke errors to AppError', () => {
    expect(
      normalizeInvokeError(
        { code: 'not_found', messageKey: 'errors.notFound', path: '/missing', details: null, recoverable: true },
        COMMANDS.listDir,
      ),
    ).toMatchObject({ code: 'not_found', messageKey: 'errors.notFound' });

    expect(normalizeInvokeError('boom', COMMANDS.listDir)).toMatchObject({
      code: 'io_error',
      messageKey: 'errors.tauriInvokeFailed',
      recoverable: true,
    });
  });

  it('treats operation event listening as a no-op in plain browser mode', async () => {
    const previousIsTauri = (globalThis as { isTauri?: boolean }).isTauri;
    const previousInternals = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as { isTauri?: boolean }).isTauri;
    delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;

    try {
      expect(isTauriRuntime()).toBe(false);
      const cleanup = await tauriClient.listenOperationEvents({
        error: () => {
          throw new Error('plain browser event subscription must not emit operation errors');
        },
      });

      expect(cleanup()).toBeUndefined();
    } finally {
      if (previousIsTauri === undefined) {
        delete (globalThis as { isTauri?: boolean }).isTauri;
      } else {
        (globalThis as { isTauri?: boolean }).isTauri = previousIsTauri;
      }
      if (previousInternals === undefined) {
        delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      } else {
        (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = previousInternals;
      }
    }
  });

  it('detects Tauri runtime through internal invoke fallback', () => {
    const previousIsTauri = (globalThis as { isTauri?: boolean }).isTauri;
    const previousInternals = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    delete (globalThis as { isTauri?: boolean }).isTauri;
    (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = { invoke: () => undefined };

    try {
      expect(isTauriRuntime()).toBe(true);
    } finally {
      if (previousIsTauri === undefined) {
        delete (globalThis as { isTauri?: boolean }).isTauri;
      } else {
        (globalThis as { isTauri?: boolean }).isTauri = previousIsTauri;
      }
      if (previousInternals === undefined) {
        delete (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      } else {
        (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ = previousInternals;
      }
    }
  });

});

import { describe, expect, it } from 'vitest';
import {
  BACKEND_IMPLEMENTED_COMMANDS,
  COMMANDS,
  isBackendImplementedCommand,
  normalizeInvokeError,
  tauriClient,
  unsupportedCommandError,
} from './client';

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
        'open_external_editor',
        'resolve_conflict',
      ]),
    );
  });

  it('declares only currently registered Rust commands as backend implemented', () => {
    expect(BACKEND_IMPLEMENTED_COMMANDS).toEqual([
      'list_dir',
      'get_metadata',
      'watch_path',
      'goto_path',
      'list_locations',
    ]);
    expect(isBackendImplementedCommand(COMMANDS.listDir)).toBe(true);
    expect(isBackendImplementedCommand(COMMANDS.startCopy)).toBe(false);
  });

  it('returns explicit unsupported results for wrappers whose Rust handlers are not registered yet', async () => {
    const result = await tauriClient.startCopy({
      sources: ['/demo/source.txt'],
      targetDir: '/demo/target',
      policy: 'skip',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual(unsupportedCommandError(COMMANDS.startCopy));
    }
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
});

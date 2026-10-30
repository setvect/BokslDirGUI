import { expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import { buildDialogDraft } from '../operations/dialogDraft';
import type { SafeMutationClient } from '../tauri/commanderClients';
import { tauriClient } from '../tauri/client';
import { longRunningExecutorForAction } from './fileActionExecutors';
import { mutationClientStub } from './testing/clientStubs';

const dialog = () => ({ ...buildDialogDraft('shellCommand', {
  action: ACTION_BY_ID.get('external.runShellCommand')!, panelId: 'left', sources: [],
  workingDir: '/tmp', targetDir: '/tmp',
}), inputValue: 'tool "한글 a" ""' });
const preview = { confirmToken: 'one-shot', fingerprint: 'input', expiresAt: '2099-01-01T00:00:00Z',
  requiresConfirmation: true as const, policy: { enabled: true, reasonKey: null } };

it('does not launch when preparation fails or execution has been disabled', async () => {
  for (const prepared of [
    { ok: false as const, error: { code: 'invalid_command', messageKey: 'errors.invalidShellCommand', path: null, details: null, recoverable: true } },
    { ok: true as const, data: { ...preview, policy: { enabled: false, reasonKey: null } } },
  ]) {
    const run = vi.fn();
    const client: SafeMutationClient = mutationClientStub({ prepareShellCommand: vi.fn(async () => prepared), runShellCommand: run });
    expect((await longRunningExecutorForAction('external.runShellCommand', tauriClient, client)!(dialog())).ok).toBe(false);
    expect(run).not.toHaveBeenCalled();
  }
});

it('executes exactly the confirmed snapshot even if the dialog draft changes during preparation', async () => {
  let finish!: (result: { ok: true; data: typeof preview }) => void;
  const run = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-shell', kind: 'shellCommand' as const, state: 'queued' as const } }));
  const client: SafeMutationClient = mutationClientStub({ runShellCommand: run,
    prepareShellCommand: vi.fn(() => new Promise<{ ok: true; data: typeof preview }>(resolve => { finish = resolve; })) });
  const draft = dialog();
  const result = longRunningExecutorForAction('external.runShellCommand', tauriClient, client)!(draft);
  draft.inputValue = 'different-program';
  draft.targetDir = '/other';
  finish({ ok: true as const, data: preview });
  await result;
  expect(run).toHaveBeenCalledWith({ workingDir: '/tmp', command: 'tool', args: ['한글 a', ''], confirmToken: 'one-shot' });
});


it('does not start a command when cancelled while waiting for its confirmation token', async () => {
  const run = vi.fn();
  const client: SafeMutationClient = mutationClientStub({ runShellCommand: run,
    prepareShellCommand: vi.fn(async () => ({ ok: true as const, data: preview })) });
  const result = await longRunningExecutorForAction('external.runShellCommand', tauriClient, client)!(dialog(), { isCancellationRequested: () => true });
  expect(result).toMatchObject({ ok: false, error: { code: 'operation_cancelled' } });
  expect(run).not.toHaveBeenCalled();
});

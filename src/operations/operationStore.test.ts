import { beforeEach, describe, expect, it } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import type { FileEntry } from '../domain/types';
import { canTransitionOperation, dialogExecutionModeForDialog, dialogKindForAction, useOperationStore } from './operationStore';

const sampleEntry: FileEntry = {
  path: '/tmp/source.txt',
  name: 'source.txt',
  kind: 'file',
  sizeBytes: 10,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  isHidden: false,
  isVirtual: false,
};

const openAction = (actionId: Parameters<typeof ACTION_BY_ID.get>[0]) => {
  const action = ACTION_BY_ID.get(actionId);
  if (!action) {
    throw new Error(`missing action ${actionId}`);
  }
  useOperationStore.getState().openDialog({
    action,
    panelId: 'left',
    sources: [sampleEntry],
    targetDir: '/tmp/target',
    workingDir: '/tmp',
  });
};

describe('operation store', () => {
  beforeEach(() => {
    useOperationStore.setState({
      dialog: null,
      progress: null,
      conflictPrompt: null,
      summary: null,
      lastError: null,
      lastConflictDecision: null,
      applyAllConflictDecision: null,
    });
  });

  it('maps destructive actions to explicit dialog shells', () => {
    expect(dialogKindForAction('file.copy')).toBe('copy');
    expect(dialogKindForAction('file.deletePermanent')).toBe('deletePermanent');
    expect(dialogKindForAction('external.runShellCommand')).toBe('shellCommand');
  });

  it('covers all operation/dialog action requirements', () => {
    const requiredDialogActions = [
      'file.copy',
      'file.move',
      'file.trash',
      'file.deletePermanent',
      'file.rename',
      'file.mkdir',
      'file.properties',
      'archive.preview',
      'archive.create',
      'archive.extract',
      'external.openDefault',
      'external.reveal',
      'external.openEditor',
      'external.runShellCommand',
    ] as const;

    for (const actionId of requiredDialogActions) {
      expect(dialogKindForAction(actionId)).not.toBeNull();
    }
  });

  it('defaults irreversible permanent delete toward cancellation', () => {
    openAction('file.deletePermanent');
    const dialog = useOperationStore.getState().dialog;

    expect(dialog?.dialogKind).toBe('deletePermanent');
    expect(dialog?.dangerLevel).toBe('irreversible');
    expect(dialog?.defaultDecision).toBe('cancel');
    expect(dialog?.backendExecutionStubbed).toBe(true);
    expect(dialog?.backendExecutionStubReasonKey).toBe('operations.backendExecution.stubbedUntilCommandWiring');
  });

  it('confirms copy into a queued stub operation without file I/O', () => {
    openAction('file.copy');
    expect(useOperationStore.getState().dialog?.backendExecutionStubbed).toBe(true);
    useOperationStore.getState().confirmDialog();

    const progress = useOperationStore.getState().progress;
    expect(progress?.kind).toBe('copy');
    expect(progress?.state).toBe('queued');
    expect(progress?.totalFiles).toBe(1);
  });


  it('routes atomic command dialogs separately from long-running operation progress', () => {
    expect(dialogExecutionModeForDialog('createDir')).toBe('atomicCommand');
    expect(dialogExecutionModeForDialog('copy')).toBe('longRunningOperation');

    openAction('file.mkdir');
    useOperationStore.getState().confirmDialog();

    expect(useOperationStore.getState().progress).toBeNull();
    expect(useOperationStore.getState().lastError?.messageKey).toBe('errors.commandNotConnected');
  });

  it('keeps shell command disabled until preview token policy is enabled', () => {
    openAction('external.runShellCommand');
    const dialog = useOperationStore.getState().dialog;
    expect(dialog?.shellPreview?.policy.enabled).toBe(false);

    useOperationStore.getState().confirmDialog();
    expect(useOperationStore.getState().summary).toBeNull();
    expect(useOperationStore.getState().lastError?.messageKey).toBe('errors.shellCommandDisabled');
  });

  it('documents allowed operation state transitions', () => {
    expect(canTransitionOperation('idle', 'validating')).toBe(true);
    expect(canTransitionOperation('running', 'waitingForConflict')).toBe(true);
    expect(canTransitionOperation('completed', 'running')).toBe(false);
  });

  it('preserves apply-all conflict decisions for later conflicts in the same operation', () => {
    openAction('file.copy');
    useOperationStore.getState().confirmDialog();
    const progress = useOperationStore.getState().progress;
    if (!progress) {
      throw new Error('progress is required');
    }

    useOperationStore.setState({
      progress: { ...progress, state: 'waitingForConflict' },
      conflictPrompt: {
        operationId: progress.operationId,
        source: sampleEntry,
        destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
        defaultDecision: 'skip',
        availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
      },
    });

    useOperationStore.getState().resolveConflict('allOverwrite');

    expect(useOperationStore.getState().progress?.state).toBe('running');
    expect(useOperationStore.getState().lastConflictDecision).toBe('allOverwrite');
    expect(useOperationStore.getState().applyAllConflictDecision).toBe('allOverwrite');
  });
});

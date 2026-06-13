import { beforeEach, describe, expect, it, vi } from 'vitest';
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
      operationHistory: [],
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


  it('routes atomic command dialogs separately from long-running operation progress', async () => {
    expect(dialogExecutionModeForDialog('createDir')).toBe('atomicCommand');
    expect(dialogExecutionModeForDialog('copy')).toBe('longRunningOperation');

    openAction('file.mkdir');
    useOperationStore.getState().updateDialogInput('new-folder');
    await useOperationStore.getState().confirmDialog();

    expect(useOperationStore.getState().progress).toBeNull();
    expect(useOperationStore.getState().lastError?.messageKey).toBe('errors.commandNotConnected');
  });

  it('validates safe mutation names before running atomic commands', async () => {
    openAction('file.mkdir');

    useOperationStore.getState().updateDialogInput('nested/folder');
    await useOperationStore.getState().confirmDialog();

    expect(useOperationStore.getState().progress).toBeNull();
    expect(useOperationStore.getState().lastError).toMatchObject({
      code: 'invalid_name',
      messageKey: 'errors.invalidName',
    });
  });

  it('runs connected createDir atomic commands without queuing progress', async () => {
    const action = ACTION_BY_ID.get('file.mkdir');
    if (!action) {
      throw new Error('file.mkdir action is required');
    }
    const created = { ...sampleEntry, path: '/tmp/new-folder', name: 'new-folder', kind: 'directory' as const };
    const atomicExecutor = vi.fn(async () => ({ ok: true as const, data: created }));
    const onAtomicSuccess = vi.fn();
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor,
      onAtomicSuccess,
    });
    useOperationStore.getState().updateDialogInput('new-folder');

    await useOperationStore.getState().confirmDialog();

    expect(atomicExecutor).toHaveBeenCalledOnce();
    expect(onAtomicSuccess).toHaveBeenCalledWith(created, expect.objectContaining({ dialogKind: 'createDir' }));
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().progress).toBeNull();
    expect(useOperationStore.getState().lastError).toBeNull();
  });

  it('prevents duplicate atomic submissions while the first command is pending', async () => {
    const action = ACTION_BY_ID.get('file.mkdir');
    if (!action) {
      throw new Error('file.mkdir action is required');
    }
    const created = { ...sampleEntry, path: '/tmp/new-folder', name: 'new-folder', kind: 'directory' as const };
    let resolveCommand: (value: { ok: true; data: FileEntry }) => void = () => {
      throw new Error('pending command resolver was not initialized');
    };
    const atomicExecutor = vi.fn(() => new Promise<{ ok: true; data: FileEntry }>((resolve) => {
      resolveCommand = resolve;
    }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor,
    });
    useOperationStore.getState().updateDialogInput('new-folder');

    const firstSubmit = useOperationStore.getState().confirmDialog();
    expect(useOperationStore.getState().dialog?.atomicPending).toBe(true);
    await useOperationStore.getState().confirmDialog();

    expect(atomicExecutor).toHaveBeenCalledOnce();
    resolveCommand({ ok: true, data: created });
    await firstSubmit;

    expect(useOperationStore.getState().dialog).toBeNull();
  });

  it('keeps shell command disabled and validates command text before preview', () => {
    openAction('external.runShellCommand');
    const dialog = useOperationStore.getState().dialog;
    expect(dialog?.shellPreview?.policy.enabled).toBe(false);

    useOperationStore.getState().confirmDialog();
    expect(useOperationStore.getState().summary).toBeNull();
    expect(useOperationStore.getState().lastError?.messageKey).toBe('errors.invalidShellCommand');
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

  it('runs connected long-running copy through operation executor instead of preview stub', async () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    const longRunningExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'op-copy-1', kind: 'copy' as const, state: 'queued' as const },
    }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor,
    });

    expect(useOperationStore.getState().dialog?.backendExecutionStubbed).toBe(false);
    await useOperationStore.getState().confirmDialog();

    expect(longRunningExecutor).toHaveBeenCalledOnce();
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-1',
      kind: 'copy',
      state: 'queued',
    });
  });

  it('applies backend operation event stream transitions to progress, conflict, and summary', () => {
    openAction('file.copy');

    useOperationStore.getState().applyOperationProgress({
      operationId: 'op-copy-2',
      kind: 'copy',
      state: 'running',
      totalFiles: 2,
      completedFiles: 1,
      totalBytes: 10,
      completedBytes: 5,
      currentPath: '/tmp/source.txt',
      bytesPerSecond: 5,
      etaSeconds: 1,
      recentErrorCount: 0,
    });
    expect(useOperationStore.getState().progress?.state).toBe('running');

    useOperationStore.getState().applyOperationConflict({
      operationId: 'op-copy-2',
      source: sampleEntry,
      destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
      defaultDecision: 'skip',
      availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
    });
    expect(useOperationStore.getState().progress?.state).toBe('waitingForConflict');
    expect(useOperationStore.getState().conflictPrompt?.operationId).toBe('op-copy-2');

    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-2',
      kind: 'copy',
      state: 'completed',
      completedFiles: 2,
      failedFiles: 0,
      errors: [],
    });

    expect(useOperationStore.getState().summary?.state).toBe('completed');
    expect(useOperationStore.getState().operationHistory[0]).toMatchObject({
      operationId: 'op-copy-2',
      state: 'completed',
    });
    expect(useOperationStore.getState().conflictPrompt).toBeNull();
    expect(useOperationStore.getState().progress?.state).toBe('completed');
  });

  it('keeps a bounded local operation history without duplicate operation ids', () => {
    for (let index = 0; index < 55; index += 1) {
      useOperationStore.setState({ progress: null });
      useOperationStore.getState().applyOperationSummary({
        operationId: `op-history-${index}`,
        kind: 'copy',
        state: 'completed',
        completedFiles: 1,
        failedFiles: 0,
        errors: [],
      });
    }
    useOperationStore.setState({ progress: null });
    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-history-54',
      kind: 'copy',
      state: 'completedWithErrors',
      completedFiles: 1,
      failedFiles: 1,
      errors: [],
    });

    const history = useOperationStore.getState().operationHistory;
    expect(history).toHaveLength(50);
    expect(history[0]).toMatchObject({ operationId: 'op-history-54', state: 'completedWithErrors' });
    expect(history.filter((item) => item.operationId === 'op-history-54')).toHaveLength(1);
  });


  it('requires typed permanent delete confirmation before connected delete execution', async () => {
    const action = ACTION_BY_ID.get('file.deletePermanent');
    if (!action) {
      throw new Error('file.deletePermanent action is required');
    }
    const longRunningExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'op-delete-typed', kind: 'delete' as const, state: 'queued' as const },
    }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor,
    });

    await useOperationStore.getState().confirmDialog();
    expect(longRunningExecutor).not.toHaveBeenCalled();
    expect(useOperationStore.getState().lastError?.messageKey).toBe('errors.confirmationRequired');

    useOperationStore.getState().updateDialogInput('PERMANENT_DELETE');
    await useOperationStore.getState().confirmDialog();

    expect(longRunningExecutor).toHaveBeenCalledOnce();
  });

  it('does not downgrade a fast terminal summary when OperationStarted arrives later', () => {
    openAction('file.copy');

    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-fast-copy',
      kind: 'copy',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });
    useOperationStore.getState().applyOperationStarted({
      operationId: 'op-fast-copy',
      kind: 'copy',
      state: 'queued',
    });

    expect(useOperationStore.getState().progress?.state).toBe('completed');
    expect(useOperationStore.getState().summary?.state).toBe('completed');
  });

  it('ignores stale summaries for a different active operation id', () => {
    useOperationStore.getState().applyOperationProgress({
      operationId: 'op-active',
      kind: 'copy',
      state: 'running',
      totalFiles: 1,
      completedFiles: 0,
      totalBytes: null,
      completedBytes: 0,
      currentPath: sampleEntry.path,
      bytesPerSecond: null,
      etaSeconds: null,
      recentErrorCount: 0,
    });

    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-stale',
      kind: 'copy',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });

    expect(useOperationStore.getState().progress?.operationId).toBe('op-active');
    expect(useOperationStore.getState().summary).toBeNull();
  });


  it('resolves a prompt-first conflict using the prompt operation id', () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    const conflictResolver = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-prompt-first', decision: 'skip' as const } }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      conflictResolver,
    });
    useOperationStore.getState().applyOperationConflict({
      operationId: 'op-prompt-first',
      source: sampleEntry,
      destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
      defaultDecision: 'skip',
      availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
    });

    useOperationStore.getState().resolveConflict('overwrite');

    expect(conflictResolver).toHaveBeenCalledWith('op-prompt-first', 'overwrite');
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-prompt-first',
      state: 'running',
    });
  });


  it('ignores delayed running progress and conflict after terminal summary for same operation', () => {
    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-terminal',
      kind: 'copy',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });

    useOperationStore.getState().applyOperationProgress({
      operationId: 'op-terminal',
      kind: 'copy',
      state: 'running',
      totalFiles: 1,
      completedFiles: 0,
      totalBytes: null,
      completedBytes: 0,
      currentPath: sampleEntry.path,
      bytesPerSecond: null,
      etaSeconds: null,
      recentErrorCount: 0,
    });
    useOperationStore.getState().applyOperationConflict({
      operationId: 'op-terminal',
      source: sampleEntry,
      destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
      defaultDecision: 'skip',
      availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
    });

    expect(useOperationStore.getState().progress?.state).toBe('completed');
    expect(useOperationStore.getState().conflictPrompt).toBeNull();
  });

});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import type { FileEntry } from '../domain/types';
import { dialogExecutionModeForDialog, dialogKindForAction } from './dialogDraft';
import { canTransitionOperation, isOperationInFlight } from './operationLifecycle';
import { useOperationStore } from './operationStore';

const sampleEntry: FileEntry = {
  path: '/tmp/source.txt',
  name: 'source.txt',
  kind: 'file',
  sizeBytes: 10,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  owner: 'boksl',
  group: 'staff',
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
      activeOperationController: null,
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
      'archive.create',
      'archive.extract',
      'archive.extractAuto',
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

  it('validates shell command text before direct execution', () => {
    openAction('external.runShellCommand');
    const dialog = useOperationStore.getState().dialog;
    expect(dialog?.atomicResult).toBeNull();

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

  it('keeps conflict cancellation non-terminal until the backend summary arrives', () => {
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

    useOperationStore.getState().resolveConflict('cancel');

    expect(useOperationStore.getState().progress?.state).toBe('cancelling');
    expect(useOperationStore.getState().summary).toBeNull();
    expect(useOperationStore.getState().operationHistory).toHaveLength(0);

    useOperationStore.getState().applyOperationSummary({
      operationId: progress.operationId,
      kind: 'copy',
      state: 'cancelled',
      completedFiles: progress.completedFiles,
      failedFiles: 0,
      errors: [],
    });

    expect(useOperationStore.getState().summary?.state).toBe('cancelled');
    expect(useOperationStore.getState().operationHistory).toHaveLength(1);
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
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-1',
      kind: 'copy',
      state: 'queued',
    });
  });

  it('lets start-error handlers dismiss stale long-running dialogs', async () => {
    const action = ACTION_BY_ID.get('file.trash');
    if (!action) {
      throw new Error('file.trash action is required');
    }
    const longRunningExecutor = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: 'not_found',
        messageKey: 'errors.notFound',
        path: sampleEntry.path,
        details: {},
        recoverable: true,
      },
    }));
    const onOperationStartError = vi.fn(() => 'dismiss' as const);
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: sampleEntry.path,
      workingDir: '/tmp',
      longRunningExecutor,
      onOperationStartError,
    });

    await useOperationStore.getState().confirmDialog();

    expect(onOperationStartError).toHaveBeenCalledWith(expect.objectContaining({ code: 'not_found' }), expect.objectContaining({
      dialogKind: 'trash',
      sources: [sampleEntry],
    }));
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().lastError).toBeNull();
    expect(useOperationStore.getState().progress).toBeNull();
  });

  it('starts connected copy without opening a preflight dialog', async () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    const longRunningExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'op-copy-direct', kind: 'copy' as const, state: 'queued' as const },
    }));

    await useOperationStore.getState().startLongRunningOperation({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor,
    });

    expect(longRunningExecutor).toHaveBeenCalledWith(expect.objectContaining({
      dialogKind: 'copy',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
    }));
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-direct',
      kind: 'copy',
      state: 'queued',
    });
  });

  it('blocks a second long-running operation while one controller is in flight', async () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    const firstExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'op-copy-active', kind: 'copy' as const, state: 'queued' as const },
    }));
    const secondExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'op-copy-overwrite', kind: 'copy' as const, state: 'queued' as const },
    }));

    await useOperationStore.getState().startLongRunningOperation({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: firstExecutor,
    });

    expect(isOperationInFlight(useOperationStore.getState())).toBe(true);

    await useOperationStore.getState().startLongRunningOperation({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target-2',
      workingDir: '/tmp',
      longRunningExecutor: secondExecutor,
    });

    expect(secondExecutor).not.toHaveBeenCalled();
    expect(useOperationStore.getState().lastError).toMatchObject({
      code: 'operation_busy',
      messageKey: 'errors.operationBusy',
    });
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-copy-active');
  });

  it('clears the active controller when a confirmed long-running dialog fails to start', async () => {
    const action = ACTION_BY_ID.get('file.move');
    if (!action) {
      throw new Error('file.move action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'permission_denied',
          messageKey: 'errors.permissionDenied',
          path: '/tmp/target',
          details: null,
          recoverable: true,
        },
      })),
    });

    await useOperationStore.getState().confirmDialog();

    expect(isOperationInFlight(useOperationStore.getState())).toBe(false);
    expect(useOperationStore.getState().activeOperationController).toBeNull();
    expect(useOperationStore.getState().progress).toBeNull();
    expect(useOperationStore.getState().lastError).toMatchObject({ messageKey: 'errors.permissionDenied' });
  });

  it('accepts real backend progress and summary while direct copy is still bound to a pending id', async () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    let resolveStart!: (value: { ok: true; data: { operationId: string; kind: 'copy'; state: 'queued' } }) => void;
    const startPromise = new Promise<{ ok: true; data: { operationId: string; kind: 'copy'; state: 'queued' } }>((resolve) => {
      resolveStart = resolve;
    });
    const onOperationSummary = vi.fn();

    const operationPromise = useOperationStore.getState().startLongRunningOperation({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(() => startPromise),
      onOperationSummary,
    });

    expect(useOperationStore.getState().progress?.operationId).toMatch(/^pending-copy-/);

    useOperationStore.getState().applyOperationProgress({
      operationId: 'op-copy-fast',
      kind: 'copy',
      state: 'running',
      totalFiles: 1,
      completedFiles: 1,
      totalBytes: 10,
      completedBytes: 10,
      currentPath: sampleEntry.path,
      bytesPerSecond: 10,
      etaSeconds: 0,
      recentErrorCount: 0,
    });

    expect(useOperationStore.getState().progress?.operationId).toBe('op-copy-fast');
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-copy-fast');

    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-fast',
      kind: 'copy',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });

    expect(onOperationSummary).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-copy-fast' }), expect.objectContaining({ dialogKind: 'copy' }));
    expect(useOperationStore.getState().progress).toMatchObject({ operationId: 'op-copy-fast', state: 'completed' });
    expect(useOperationStore.getState().activeOperationController).toBeNull();

    resolveStart({ ok: true, data: { operationId: 'op-copy-fast', kind: 'copy', state: 'queued' } });
    await operationPromise;

    expect(useOperationStore.getState().progress).toMatchObject({ operationId: 'op-copy-fast', state: 'completed' });
  });

  it('defers confirmed-dialog pending-start cancellation until the real backend operation id is known', async () => {
    const action = ACTION_BY_ID.get('file.move');
    if (!action) {
      throw new Error('file.move action is required');
    }
    let resolveStart!: (value: { ok: true; data: { operationId: string; kind: 'move'; state: 'queued' } }) => void;
    const startPromise = new Promise<{ ok: true; data: { operationId: string; kind: 'move'; state: 'queued' } }>((resolve) => {
      resolveStart = resolve;
    });
    const cancelExecutor = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-move-real', state: 'cancelling' as const } }));

    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(() => startPromise),
      cancelExecutor,
    });

    const confirmPromise = useOperationStore.getState().confirmDialog();
    useOperationStore.getState().cancelOperation();

    expect(cancelExecutor).not.toHaveBeenCalled();
    expect(useOperationStore.getState().activeOperationController?.cancelRequestedBeforeStart).toBe(true);

    resolveStart({ ok: true, data: { operationId: 'op-move-real', kind: 'move', state: 'queued' } });
    await confirmPromise;

    expect(cancelExecutor).toHaveBeenCalledWith('op-move-real');
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-move-real',
      kind: 'move',
      state: 'cancelling',
    });
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-move-real');
  });

  it('defers pending-start cancellation until the real backend operation id is known', async () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    let resolveStart!: (value: { ok: true; data: { operationId: string; kind: 'copy'; state: 'queued' } }) => void;
    const startPromise = new Promise<{ ok: true; data: { operationId: string; kind: 'copy'; state: 'queued' } }>((resolve) => {
      resolveStart = resolve;
    });
    const cancelExecutor = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-real', state: 'cancelling' as const } }));

    const operationPromise = useOperationStore.getState().startLongRunningOperation({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(() => startPromise),
      cancelExecutor,
    });

    expect(useOperationStore.getState().progress?.operationId).toMatch(/^pending-copy-/);

    useOperationStore.getState().cancelOperation();

    expect(cancelExecutor).not.toHaveBeenCalled();
    expect(useOperationStore.getState().progress?.state).toBe('cancelling');
    expect(useOperationStore.getState().activeOperationController?.cancelRequestedBeforeStart).toBe(true);

    resolveStart({ ok: true, data: { operationId: 'op-copy-real', kind: 'copy', state: 'queued' } });
    await operationPromise;

    expect(cancelExecutor).toHaveBeenCalledWith('op-copy-real');
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-real',
      kind: 'copy',
      state: 'cancelling',
    });
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-copy-real');
  });

  it('does not synthesize terminal cancellation before a backend summary', () => {
    useOperationStore.setState({
      progress: {
        operationId: 'op-copy-running',
        kind: 'copy',
        state: 'running',
        totalFiles: 2,
        completedFiles: 1,
        totalBytes: null,
        completedBytes: 0,
        currentPath: sampleEntry.path,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
    });

    useOperationStore.getState().cancelOperation();

    expect(useOperationStore.getState().progress?.state).toBe('cancelling');
    expect(useOperationStore.getState().summary).toBeNull();
    expect(useOperationStore.getState().operationHistory).toHaveLength(0);
  });

  it('keeps an active operation controller after a confirmed long-running dialog closes', async () => {
    const action = ACTION_BY_ID.get('file.move');
    if (!action) {
      throw new Error('file.move action is required');
    }
    const onOperationSummary = vi.fn();
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'op-move-dialog', kind: 'move' as const, state: 'queued' as const },
      })),
      onOperationSummary,
    });

    await useOperationStore.getState().confirmDialog();

    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-move-dialog');
    expect(useOperationStore.getState().progress).toMatchObject({ operationId: 'op-move-dialog', state: 'queued' });

    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-move-dialog',
      kind: 'move',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });

    expect(onOperationSummary).toHaveBeenCalledWith(expect.objectContaining({ operationId: 'op-move-dialog' }), expect.objectContaining({ dialogKind: 'move' }));
    expect(useOperationStore.getState().activeOperationController).toBeNull();
  });

  it('preserves an active operation controller when opening an atomic dialog', async () => {
    const copyAction = ACTION_BY_ID.get('file.copy');
    const propertiesAction = ACTION_BY_ID.get('file.properties');
    if (!copyAction || !propertiesAction) {
      throw new Error('copy and properties actions are required');
    }
    const onOperationSummary = vi.fn();
    await useOperationStore.getState().startLongRunningOperation({
      action: copyAction,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'op-copy-with-info', kind: 'copy' as const, state: 'queued' as const },
      })),
      onOperationSummary,
    });

    useOperationStore.getState().openDialog({
      action: propertiesAction,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor: vi.fn(async () => ({ ok: true as const, data: sampleEntry })),
    });

    expect(useOperationStore.getState().dialog?.dialogKind).toBe('properties');
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-copy-with-info');
    expect(useOperationStore.getState().progress?.operationId).toBe('op-copy-with-info');

    useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-with-info',
      kind: 'copy',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    });

    expect(onOperationSummary).toHaveBeenCalledOnce();
  });

  it('preserves in-flight conflict state when confirming an atomic dialog', async () => {
    const copyAction = ACTION_BY_ID.get('file.copy');
    const propertiesAction = ACTION_BY_ID.get('file.properties');
    if (!copyAction || !propertiesAction) {
      throw new Error('copy and properties actions are required');
    }
    const conflictResolver = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-conflict-info', decision: 'overwrite' as const } }));

    await useOperationStore.getState().startLongRunningOperation({
      action: copyAction,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'op-copy-conflict-info', kind: 'copy' as const, state: 'queued' as const },
      })),
      conflictResolver,
    });
    useOperationStore.getState().applyOperationConflict({
      operationId: 'op-copy-conflict-info',
      source: sampleEntry,
      destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
      defaultDecision: 'skip',
      availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
    });

    useOperationStore.getState().openDialog({
      action: propertiesAction,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor: vi.fn(async () => ({ ok: true as const, data: sampleEntry })),
    });
    await vi.waitFor(() => expect(useOperationStore.getState().dialog?.atomicResult).toBe(sampleEntry));

    expect(useOperationStore.getState().dialog).toMatchObject({
      dialogKind: 'properties',
      atomicPending: false,
      atomicResult: sampleEntry,
    });
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-conflict-info',
      state: 'waitingForConflict',
    });
    expect(useOperationStore.getState().conflictPrompt?.operationId).toBe('op-copy-conflict-info');

    useOperationStore.getState().resolveConflict('overwrite');

    expect(conflictResolver).toHaveBeenCalledWith('op-copy-conflict-info', 'overwrite');
  });

  it('clears terminal progress when dismissing the operation summary', () => {
    useOperationStore.setState({
      progress: {
        operationId: 'op-terminal-dismiss',
        kind: 'copy',
        state: 'completed',
        totalFiles: 1,
        completedFiles: 1,
        totalBytes: null,
        completedBytes: 0,
        currentPath: null,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      summary: {
        operationId: 'op-terminal-dismiss',
        kind: 'copy',
        state: 'completed',
        completedFiles: 1,
        failedFiles: 0,
        errors: [],
      },
    });

    useOperationStore.getState().clearSummary();

    expect(useOperationStore.getState().summary).toBeNull();
    expect(useOperationStore.getState().progress).toBeNull();
  });

  it('keeps conflict resolution wired for a direct copy operation without a dialog', async () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    const conflictResolver = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-conflict', decision: 'skip' as const } }));

    await useOperationStore.getState().startLongRunningOperation({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'op-copy-conflict', kind: 'copy' as const, state: 'queued' as const },
      })),
      conflictResolver,
    });

    useOperationStore.getState().applyOperationConflict({
      operationId: 'op-copy-conflict',
      source: sampleEntry,
      destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
      defaultDecision: 'skip',
      availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
    });
    useOperationStore.getState().resolveConflict('overwrite');

    expect(conflictResolver).toHaveBeenCalledWith('op-copy-conflict', 'overwrite');
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-conflict',
      state: 'running',
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

    expect(useOperationStore.getState().dialog?.requiredConfirmationPhrase).toBe('source.txt');

    useOperationStore.getState().updateDialogInput('source.txt');
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

describe('review: delayed operation responses', () => {
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
      activeOperationController: null,
    });
  });

  it('starts properties lookup immediately and ignores an old result after reopening', async () => {
    const completes: Array<(value: { ok: true; data: unknown }) => void> = [];
    const atomicExecutor = vi.fn(() => new Promise<{ ok: true; data: unknown }>((resolve) => {
      completes.push(resolve);
    }));
    const request = {
      action: ACTION_BY_ID.get('file.properties')!, panelId: 'left' as const,
      sources: [sampleEntry], targetDir: '/target', workingDir: '/source', atomicExecutor
    };

    useOperationStore.getState().openDialog(request);
    expect(atomicExecutor).toHaveBeenCalledOnce();
    expect(useOperationStore.getState().dialog?.atomicPending).toBe(true);
    useOperationStore.getState().closeDialog();
    useOperationStore.getState().openDialog(request);
    const newDialog = useOperationStore.getState().dialog;
    expect(atomicExecutor).toHaveBeenCalledTimes(2);

    completes[0]({ ok: true, data: { name: 'old result' } });
    await Promise.resolve();
    expect(useOperationStore.getState().dialog).toBe(newDialog);
    expect(useOperationStore.getState().dialog?.atomicResult).toBeNull();

    completes[1]({ ok: true, data: { name: 'new result' } });
    await vi.waitFor(() => expect(useOperationStore.getState().dialog?.atomicResult).toEqual({ name: 'new result' }));
  });

  it('ignores a start acknowledgement after completion and a new operation', async () => {
    let complete!: (value: { ok: true; data: import('../domain/types').OperationStarted }) => void;
    const request = {
      action: ACTION_BY_ID.get('file.copy')!, panelId: 'left' as const,
      sources: [sampleEntry], targetDir: '/target', workingDir: '/source'
    };
    const first = useOperationStore.getState().startLongRunningOperation({
      ...request,
      longRunningExecutor: () => new Promise((resolve) => { complete = resolve; })
    });
    useOperationStore.getState().applyOperationSummary({
      operationId: 'review-first', kind: 'copy', state: 'completed',
      completedFiles: 1, failedFiles: 0, errors: []
    });
    await useOperationStore.getState().startLongRunningOperation({
      ...request,
      longRunningExecutor: async () => ({ ok: true, data: { operationId: 'review-second', kind: 'copy', state: 'queued' } })
    });
    complete({ ok: true, data: { operationId: 'review-first', kind: 'copy', state: 'queued' } });
    await first;
    expect(useOperationStore.getState().progress?.operationId).toBe('review-second');
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('review-second');
  });

  it('uses the running operation callback while a properties dialog is open', async () => {
    const onOperationSummary = vi.fn();
    await useOperationStore.getState().startLongRunningOperation({
      action: ACTION_BY_ID.get('file.copy')!, panelId: 'left',
      sources: [sampleEntry], targetDir: '/target', workingDir: '/source', onOperationSummary,
      longRunningExecutor: async () => ({ ok: true, data: { operationId: 'review-callback', kind: 'copy', state: 'queued' } })
    });
    openAction('file.properties');
    const properties = useOperationStore.getState().dialog;
    const summary = {
      operationId: 'review-callback', kind: 'copy' as const, state: 'completed' as const,
      completedFiles: 1, failedFiles: 0, errors: []
    };
    useOperationStore.getState().applyOperationSummary(summary);
    useOperationStore.getState().applyOperationSummary(summary);
    expect(onOperationSummary).toHaveBeenCalledOnce();
    expect(onOperationSummary.mock.calls[0][1].dialogKind).toBe('copy');
    expect(useOperationStore.getState().dialog).toBe(properties);
  });
});

it('restores a conflict prompt after a failed resolution request so it can be retried', async () => {
  useOperationStore.setState({
    dialog: null, progress: null, summary: null, conflictPrompt: null,
    activeOperationController: null, operationHistory: [], lastError: null
  });
  const error = { code: 'io_error', messageKey: 'errors.tauriInvokeFailed', path: null, details: null, recoverable: true };
  await useOperationStore.getState().startLongRunningOperation({
    action: ACTION_BY_ID.get('file.copy')!, panelId: 'left',
    sources: [sampleEntry], targetDir: '/target', workingDir: '/source',
    longRunningExecutor: async () => ({ ok: true, data: { operationId: 'review-control-failed', kind: 'copy', state: 'queued' } }),
    conflictResolver: async () => ({ ok: false, error }),
  });
  const prompt = {
    operationId: 'review-control-failed', source: sampleEntry, destination: { ...sampleEntry, path: '/target/source.txt' },
    defaultDecision: 'skip' as const, availableDecisions: ['skip', 'overwrite', 'cancel'] as import('../domain/types').ConflictDecision[]
  };
  useOperationStore.getState().applyOperationConflict(prompt);
  useOperationStore.getState().resolveConflict('overwrite');
  await Promise.resolve();
  expect(useOperationStore.getState().conflictPrompt).toEqual(prompt);
  expect(useOperationStore.getState().progress?.state).toBe('waitingForConflict');
  expect(useOperationStore.getState().lastError).toBe(error);
  expect(useOperationStore.getState().activeOperationController?.operationId).toBe('review-control-failed');
});

import type { StoreApi } from 'zustand';
import type { ConflictPrompt } from '../domain/types';
import { normalizeInvokeError } from '../tauri/client';
import { COMMANDS } from '../tauri/commands';
import { isTerminalState } from './operationLifecycle';
import type { OperationDialogDraft, OperationStoreState } from './operationTypes';

type OperationSet = StoreApi<OperationStoreState>['setState'];
type OperationGet = StoreApi<OperationStoreState>['getState'];

/** Bind the backend ID once, preserving cancellation requested before start completes. */
export async function executeLongRunningDialog(dialog: OperationDialogDraft, set: OperationSet, get: OperationGet, closeDialogAfterStart: boolean) {
  const result = await dialog.longRunningExecutor!(dialog);
  if (get().activeOperationController?.dialog !== dialog) return;
  if (!result.ok) {
    const errorHandling = dialog.onOperationStartError?.(result.error, dialog);
    set((current) => ({
      ...(closeDialogAfterStart ? { dialog: errorHandling === 'dismiss' ? null : current.dialog ? { ...current.dialog, operationPending: false } : null } : {}),
      progress: null,
      conflictPrompt: null,
      activeOperationController: null,
      lastError: errorHandling === 'dismiss' ? null : result.error,
      summary: null,
    }));
    return;
  }
  const pendingController = get().activeOperationController;
  const cancelRequestedBeforeStart = Boolean(pendingController?.cancelRequestedBeforeStart);
  set((current) => ({
    activeOperationController: current.activeOperationController
      ? { ...current.activeOperationController, operationId: result.data.operationId }
      : current.activeOperationController,
  }));
  if (cancelRequestedBeforeStart) {
    observeOperationControl(set, get, pendingController?.cancelExecutor?.(result.data.operationId), result.data.operationId, 'cancelOperation');
    set((current) => ({
      progress: current.progress
        ? { ...current.progress, operationId: result.data.operationId, kind: result.data.kind, state: 'cancelling' }
        : {
          operationId: result.data.operationId,
          kind: result.data.kind,
          state: 'cancelling',
          totalFiles: null,
          completedFiles: 0,
          totalBytes: null,
          completedBytes: 0,
          currentPath: null,
          bytesPerSecond: null,
          etaSeconds: null,
          recentErrorCount: 0,
        },
      ...(closeDialogAfterStart ? { dialog: null } : {}),
    }));
    return;
  }
  get().applyOperationStarted(result.data);
  if (closeDialogAfterStart) set({ dialog: null });
  return;

}
export const observeOperationControl = (
  set: OperationSet, get: OperationGet,
  request: Promise<unknown> | undefined,
  operationId: string,
  command: 'cancelOperation' | 'resolveConflict',
  prompt: ConflictPrompt | null = null,
) => {
  if (!request) return;
  const fail = (error: unknown) => {
    const current = get();
    if (current.progress?.operationId !== operationId || isTerminalState(current.progress.state)) return;
    set({
      lastError: normalizeInvokeError(error, COMMANDS[command]),
      progress: { ...current.progress, state: prompt ? 'waitingForConflict' : 'running' },
      conflictPrompt: prompt ?? current.conflictPrompt,
    });
  };
  void request.then((result) => {
    if (result && typeof result === 'object' && 'ok' in result && result.ok === false && 'error' in result) {
      fail(result.error);
    }
  }).catch(fail);
};

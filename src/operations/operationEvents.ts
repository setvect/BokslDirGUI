import type { StoreApi } from 'zustand';
import { isLongRunningDialog, operationKindForDialog } from './dialogDraft';
import { appendOperationHistory, isPendingAliasForUnboundController, isTerminalState } from './operationLifecycle';
import { observeOperationControl } from './operationRuntime';
import { OperationStoreState } from './operationTypes';

/** Event reducers share the existing store; this creates no additional state container. */
export function createOperationEventActions(set: StoreApi<OperationStoreState>['setState'], get: StoreApi<OperationStoreState>['getState']): Pick<OperationStoreState, 'applyOperationStarted' | 'applyOperationProgress' | 'applyOperationConflict' | 'applyOperationSummary' | 'applyOperationError' | 'resolveConflict' | 'cancelOperation' | 'clearSummary' | 'clearOperationHistory'> {
  return {

    applyOperationStarted: (started) => {
      const currentProgress = get().progress;
      if (get().operationHistory.some((summary) => summary.operationId === started.operationId)) return;
      if (currentProgress?.operationId === started.operationId) {
        set({ lastError: null });
        return;
      }
      set({
        progress: {
          operationId: started.operationId,
          kind: started.kind,
          state: started.state,
          totalFiles: null,
          completedFiles: 0,
          totalBytes: null,
          completedBytes: 0,
          currentPath: null,
          bytesPerSecond: null,
          etaSeconds: null,
          recentErrorCount: 0,
        },
        lastError: null,
      });
    },

    applyOperationProgress: (progress) => {
      if (get().operationHistory.some((entry) => entry.operationId === progress.operationId)) return;
      const current = get().progress;
      const controller = get().activeOperationController;
      if (current && isTerminalState(current.state)) {
        return;
      }
      if (current && current.operationId !== progress.operationId && !isPendingAliasForUnboundController(current, controller)) {
        return;
      }
      set((state) => ({
        progress,
        activeOperationController: state.activeOperationController && !state.activeOperationController.operationId
          ? { ...state.activeOperationController, operationId: progress.operationId }
          : state.activeOperationController,
        lastError: null,
      }));
    },

    applyOperationConflict: (prompt) => {
      if (get().operationHistory.some((entry) => entry.operationId === prompt.operationId)) return;
      const progress = get().progress;
      const controller = get().activeOperationController;
      if (progress && isTerminalState(progress.state)) {
        return;
      }
      if (progress && progress.operationId !== prompt.operationId && !isPendingAliasForUnboundController(progress, controller)) {
        return;
      }
      set((current) => ({
        conflictPrompt: prompt,
        activeOperationController: current.activeOperationController && !current.activeOperationController.operationId
          ? { ...current.activeOperationController, operationId: prompt.operationId }
          : current.activeOperationController,
        progress: current.progress
          ? { ...current.progress, operationId: prompt.operationId, state: 'waitingForConflict' }
          : null,
      }));
    },

    applyOperationSummary: (summary) => {
      if (get().operationHistory.some((entry) => entry.operationId === summary.operationId)) {
        set((current) => ({ operationHistory: appendOperationHistory(current.operationHistory, summary) }));
        return;
      }
      const currentProgress = get().progress;
      const controller = get().activeOperationController;
      if (currentProgress && currentProgress.operationId !== summary.operationId && !isPendingAliasForUnboundController(currentProgress, controller)) {
        return;
      }
      const dialog = get().dialog;
      const summaryDialog = controller?.dialog ?? dialog;
      if (summaryDialog) {
        (controller?.onOperationSummary ?? dialog?.onOperationSummary)?.(summary, summaryDialog);
      }
      set((current) => ({
        summary,
        operationHistory: appendOperationHistory(current.operationHistory, summary),
        conflictPrompt: current.conflictPrompt?.operationId === summary.operationId ? null : current.conflictPrompt,
        progress: current.progress && (current.progress.operationId === summary.operationId || current.progress.operationId.startsWith('pending-'))
          ? { ...current.progress, operationId: summary.operationId, kind: summary.kind, state: summary.state, completedFiles: summary.completedFiles, recentErrorCount: summary.failedFiles }
          : current.progress ?? {
            operationId: summary.operationId,
            kind: summary.kind,
            state: summary.state,
            totalFiles: summary.completedFiles + summary.failedFiles + (summary.skippedFiles ?? 0),
            completedFiles: summary.completedFiles,
            totalBytes: null,
            completedBytes: 0,
            currentPath: null,
            bytesPerSecond: null,
            etaSeconds: null,
            recentErrorCount: summary.failedFiles,
          },
        dialog: current.dialog?.id === controller?.dialog.id
          ? null
          : current.dialog,
        activeOperationController: current.activeOperationController?.operationId === summary.operationId || !current.activeOperationController?.operationId
          ? null
          : current.activeOperationController,
        lastError: summary.errors[0] ?? null,
      }));
    },

    applyOperationError: (error) => {
      set((current) => ({
        lastError: error,
        dialog: current.dialog ? { ...current.dialog, operationPending: false } : null,
        activeOperationController: null,
      }));
    },

    resolveConflict: (decision) => {
      const prompt = get().conflictPrompt;
      const progress = get().progress;
      if (!prompt) {
        return;
      }
      const operationId = prompt.operationId;
      const controller = get().activeOperationController;
      const dialogKind = get().dialog?.dialogKind ?? controller?.dialog.dialogKind;
      const kind = progress?.kind ?? (dialogKind && isLongRunningDialog(dialogKind)
        ? operationKindForDialog(dialogKind)
        : 'copy');
      const completedFiles = progress?.completedFiles ?? 0;
      observeOperationControl(set, get,
        (controller?.conflictResolver ?? get().dialog?.conflictResolver)?.(operationId, decision),
        operationId, 'resolveConflict', prompt,
      );
      if (decision === 'cancel') {
        set({
          progress: progress
            ? { ...progress, state: 'cancelling' }
            : {
              operationId,
              kind,
              state: 'cancelling',
              totalFiles: null,
              completedFiles,
              totalBytes: null,
              completedBytes: 0,
              currentPath: prompt.source.path,
              bytesPerSecond: null,
              etaSeconds: null,
              recentErrorCount: 0,
            },
          summary: null,
          conflictPrompt: null,
          lastConflictDecision: decision,
          applyAllConflictDecision: null,
          activeOperationController: controller ? { ...controller, operationId } : controller,
        });
        return;
      }
      set({
        progress: progress
          ? { ...progress, state: 'running' }
          : {
            operationId,
            kind,
            state: 'running',
            totalFiles: null,
            completedFiles,
            totalBytes: null,
            completedBytes: 0,
            currentPath: prompt.source.path,
            bytesPerSecond: null,
            etaSeconds: null,
            recentErrorCount: 0,
          },
        conflictPrompt: null,
        lastConflictDecision: decision,
        applyAllConflictDecision: decision === 'allOverwrite' || decision === 'allSkip' ? decision : null,
      });
    },

    cancelOperation: () => {
      const progress = get().progress;
      const controller = get().activeOperationController;
      if (!progress) {
        if (controller && !controller.operationId) {
          set({
            dialog: get().dialog ? { ...get().dialog!, operationPending: true } : null,
            conflictPrompt: null,
            activeOperationController: { ...controller, cancelRequestedBeforeStart: true },
          });
          return;
        }
        if (controller?.operationId) {
          observeOperationControl(set, get, controller.cancelExecutor?.(controller.operationId), controller.operationId, 'cancelOperation', get().conflictPrompt);
          set({
            dialog: get().dialog ? { ...get().dialog!, operationPending: false } : null,
            conflictPrompt: null,
            activeOperationController: { ...controller, cancelRequestedBeforeStart: false },
          });
          return;
        }
        set({ dialog: null, conflictPrompt: null });
        return;
      }
      const realOperationId = controller?.operationId ?? (progress.operationId.startsWith('pending-') ? null : progress.operationId);
      if (controller && !realOperationId) {
        set({
          progress: { ...progress, state: 'cancelling' },
          conflictPrompt: null,
          activeOperationController: { ...controller, cancelRequestedBeforeStart: true },
        });
        return;
      }
      observeOperationControl(set, get,
        (controller?.cancelExecutor ?? get().dialog?.cancelExecutor)?.(realOperationId ?? progress.operationId),
        realOperationId ?? progress.operationId, 'cancelOperation', get().conflictPrompt,
      );
      if (controller) {
        set({
          progress: { ...progress, operationId: realOperationId ?? progress.operationId, state: 'cancelling' },
          conflictPrompt: null,
          activeOperationController: realOperationId ? { ...controller, operationId: realOperationId } : controller,
        });
        return;
      }
      set({
        progress: { ...progress, state: 'cancelling' },
        conflictPrompt: null,
        summary: null,
        activeOperationController: null,
      });
    },

    clearSummary: () => set((current) => ({
      summary: null,
      lastError: null,
      progress: current.progress && isTerminalState(current.progress.state) ? null : current.progress,
    })),

    clearOperationHistory: () => set({ operationHistory: [] })
  };
}

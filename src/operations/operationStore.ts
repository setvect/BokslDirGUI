import { create } from 'zustand';
import type { ActionId } from '../actions/registry';
import { buildDialogDraft, dialogKindForAction, isLongRunningDialog, operationKindForDialog, showsValidationWhileTyping, validateDialogInput } from './dialogDraft';
import { createOperationEventActions } from './operationEvents';
import { appError, isOperationInFlight } from './operationLifecycle';
import { executeLongRunningDialog } from './operationRuntime';
import { OperationStoreState } from './operationTypes';

export const useOperationStore = create<OperationStoreState>((set, get) => ({
  dialog: null,
  progress: null,
  conflictPrompt: null,
  summary: null,
  operationHistory: [],
  lastError: null,
  lastConflictDecision: null,
  applyAllConflictDecision: null,
  activeOperationController: null,
  openDialog: (request) => {
    const dialogKind = dialogKindForAction(request.action.id as ActionId);
    if (!dialogKind) {
      return;
    }
    const operationInFlight = isOperationInFlight(get());
    if (isLongRunningDialog(dialogKind) && operationInFlight) {
      set({ lastError: appError('operation_busy', 'errors.operationBusy', request.targetDir ?? request.workingDir, true) });
      return;
    }
    set((current) => ({
      dialog: buildDialogDraft(dialogKind, request),
      progress: operationInFlight ? current.progress : null,
      conflictPrompt: operationInFlight ? current.conflictPrompt : null,
      summary: null,
      lastError: null,
      lastConflictDecision: operationInFlight ? current.lastConflictDecision : null,
      applyAllConflictDecision: operationInFlight ? current.applyAllConflictDecision : null,
      activeOperationController: operationInFlight ? current.activeOperationController : null,
    }));
    if (dialogKind === 'properties') {
      void get().confirmDialog();
    }
  },
  startLongRunningOperation: async (request) => {
    const dialogKind = dialogKindForAction(request.action.id as ActionId);
    if (!dialogKind || !isLongRunningDialog(dialogKind)) {
      return;
    }
    if (isOperationInFlight(get())) {
      set({ lastError: appError('operation_busy', 'errors.operationBusy', request.targetDir ?? request.workingDir, true) });
      return;
    }
    const dialog = buildDialogDraft(dialogKind, request);
    if (dialog.backendExecutionStubbed || !dialog.longRunningExecutor) {
      set({
        lastError: appError('unsupported', 'errors.commandNotConnected', dialog.targetDir, true),
        summary: null,
        progress: null,
        conflictPrompt: null,
      });
      return;
    }
    const validationErrorKey = validateDialogInput(dialog.dialogKind, dialog.inputValue, dialog.requiredConfirmationPhrase);
    if (validationErrorKey) {
      set({
        lastError: appError('confirmation_required', validationErrorKey, dialog.targetDir, true),
        summary: null,
        progress: null,
        conflictPrompt: null,
      });
      return;
    }
    set({
      dialog: null,
      progress: {
        operationId: `pending-${dialog.dialogKind}-${Date.now()}`,
        kind: operationKindForDialog(dialogKind),
        state: 'queued',
        totalFiles: dialog.sources.length || 1,
        completedFiles: 0,
        totalBytes: null,
        completedBytes: 0,
        currentPath: dialog.sources[0]?.path ?? dialog.targetDir,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      conflictPrompt: null,
      summary: null,
      lastError: null,
      activeOperationController: {
        operationId: null,
        dialog,
        cancelExecutor: dialog.cancelExecutor,
        conflictResolver: dialog.conflictResolver,
        onOperationSummary: dialog.onOperationSummary,
        cancelRequestedBeforeStart: false,
      },
    });
    await executeLongRunningDialog(dialog, set, get, false);
  },
  updateDialogInput: (value) => {
    const dialog = get().dialog;
    if (!dialog) {
      return;
    }
    set({
      dialog: {
        ...dialog,
        inputValue: value,
        validationErrorKey: validateDialogInput(dialog.dialogKind, value, dialog.requiredConfirmationPhrase),
        validationShown: dialog.validationShown || showsValidationWhileTyping(dialog.dialogKind, value),
      },
      lastError: null,
    });
  },
  updateDialogSecret: (value) => {
    set((current) => current.dialog ? {
      dialog: { ...current.dialog, secretValue: value },
    } : current);
  },
  confirmDialog: async () => {
    const dialog = get().dialog;
    if (!dialog) {
      return;
    }

    if (dialog.executionMode === 'atomicCommand') {
      if (dialog.atomicPending) {
        return;
      }
      const validationErrorKey = validateDialogInput(dialog.dialogKind, dialog.inputValue, dialog.requiredConfirmationPhrase);
      if (validationErrorKey) {
        set((current) => ({
          dialog: { ...dialog, validationErrorKey, validationShown: true },
          lastError: appError('invalid_name', validationErrorKey, dialog.targetDir, true),
          summary: isOperationInFlight(current) ? current.summary : null,
          progress: isOperationInFlight(current) ? current.progress : null,
          conflictPrompt: isOperationInFlight(current) ? current.conflictPrompt : null,
        }));
        return;
      }
      if (!dialog.atomicExecutor) {
        set((current) => ({
          lastError: appError('unsupported', 'errors.commandNotConnected', dialog.targetDir, true),
          summary: isOperationInFlight(current) ? current.summary : null,
          progress: isOperationInFlight(current) ? current.progress : null,
          conflictPrompt: isOperationInFlight(current) ? current.conflictPrompt : null,
        }));
        return;
      }

      set({
        dialog: { ...dialog, atomicPending: true },
        lastError: null,
      });

      const result = await dialog.atomicExecutor(dialog);
      if (result.ok) dialog.onAtomicSuccess?.(result.data, dialog);
      if (get().dialog?.id !== dialog.id) return;
      if (!result.ok) {
        set((current) => ({
          dialog: current.dialog ? { ...current.dialog, atomicPending: false } : null,
          lastError: result.error,
          summary: isOperationInFlight(current) ? current.summary : null,
          progress: isOperationInFlight(current) ? current.progress : null,
          conflictPrompt: isOperationInFlight(current) ? current.conflictPrompt : null,
        }));
        return;
      }

      if (dialog.dialogKind === 'properties') {
        set((current) => ({
          dialog: current.dialog
            ? { ...current.dialog, atomicPending: false, atomicResult: result.data }
            : null,
          progress: isOperationInFlight(current) ? current.progress : null,
          conflictPrompt: isOperationInFlight(current) ? current.conflictPrompt : null,
          summary: isOperationInFlight(current) ? current.summary : null,
          lastError: null,
        }));
        return;
      }
      set((current) => ({
        dialog: null,
        progress: isOperationInFlight(current) ? current.progress : null,
        conflictPrompt: isOperationInFlight(current) ? current.conflictPrompt : null,
        summary: isOperationInFlight(current) ? current.summary : null,
        lastError: null,
      }));
      return;
    }

    if (!isLongRunningDialog(dialog.dialogKind)) {
      const error = appError(
        'unsupported',
        'errors.commandNotConnected',
        dialog.targetDir,
        true,
      );
      set({
        lastError: error,
        summary: null,
        progress: null,
      });
      return;
    }

    if (dialog.longRunningExecutor) {
      if (dialog.operationPending || isOperationInFlight(get())) {
        return;
      }
      const validationErrorKey = validateDialogInput(dialog.dialogKind, dialog.inputValue, dialog.requiredConfirmationPhrase);
      if (validationErrorKey) {
        set({
          dialog: { ...dialog, validationErrorKey, validationShown: true },
          lastError: appError('confirmation_required', validationErrorKey, dialog.targetDir, true),
          summary: null,
          progress: null,
        });
        return;
      }
      set({ dialog: { ...dialog, operationPending: true }, lastError: null, summary: null });
      set({
        activeOperationController: {
          operationId: null,
          dialog,
          cancelExecutor: dialog.cancelExecutor,
          conflictResolver: dialog.conflictResolver,
          onOperationSummary: dialog.onOperationSummary,
          cancelRequestedBeforeStart: false,
        },
      });
      await executeLongRunningDialog(dialog, set, get, true);
      return;
    }

    const validationErrorKey = validateDialogInput(dialog.dialogKind, dialog.inputValue, dialog.requiredConfirmationPhrase);
    if (validationErrorKey) {
      set({ dialog: { ...dialog, validationErrorKey }, lastError: appError('invalid_command', validationErrorKey, dialog.targetDir, true) });
      return;
    }
    const operationId = `preview-${dialog.dialogKind}-${Date.now()}`;
    const operationKind = operationKindForDialog(dialog.dialogKind);
    set({
      progress: {
        operationId,
        kind: operationKind,
        state: 'queued',
        totalFiles: dialog.sources.length || 1,
        completedFiles: 0,
        totalBytes: null,
        completedBytes: 0,
        currentPath: dialog.sources[0]?.path ?? dialog.targetDir,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      summary: null,
    });
  },
  ...createOperationEventActions(set, get),
  closeDialog: () => set((current) => {
    if (isOperationInFlight(current)) {
      return { dialog: null, lastError: null };
    }
    return { dialog: null, progress: null, conflictPrompt: null, lastError: null, activeOperationController: null };
  }),
}));

export { dialogExecutionModeForDialog, dialogKindForAction } from './dialogDraft';
export { allowedOperationTransitions, canTransitionOperation, isOperationInFlight } from './operationLifecycle';
export type { ActiveOperationController, AtomicCommandExecutor, AtomicCommandSuccessHandler, ConflictResolver, DialogExecutionMode, DialogKind, LongRunningCancelExecutor, LongRunningOperationExecutor, OpenDialogRequest, OperationDialogDraft, OperationStartErrorHandler, OperationStartErrorHandling, OperationStoreState, OperationSummaryHandler } from './operationTypes';

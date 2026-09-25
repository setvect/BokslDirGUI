import { create } from 'zustand';
import { COMMANDS, normalizeInvokeError } from '../tauri/client';
import type {
  AppError,
  ConflictDecision,
  ConflictPrompt,
  FileEntry,
  OperationKind,
  OperationProgress,
  OperationStarted,
  OperationState,
  OperationSummary,
  PanelId,
  ShellCommandPreview,
} from '../domain/types';
import type { ActionId, AppAction, DangerLevel } from '../actions/registry';

export type DialogKind =
  | 'copy'
  | 'move'
  | 'trash'
  | 'deletePermanent'
  | 'rename'
  | 'createDir'
  | 'properties'
  | 'archiveCreate'
  | 'archiveExtract'
  | 'externalOpenDefault'
  | 'externalReveal'
  | 'externalEditor'
  | 'shellCommand';

export type DialogExecutionMode = 'atomicCommand' | 'longRunningOperation' | 'unsupportedPreview';

let nextDialogId = 0;

export interface OperationDialogDraft {
  id: number;
  dialogKind: DialogKind;
  executionMode: DialogExecutionMode;
  panelId: PanelId;
  sources: FileEntry[];
  targetDir: string | null;
  dangerLevel: DangerLevel;
  defaultDecision: ConflictDecision;
  backendExecutionStubbed: boolean;
  backendExecutionStubReasonKey: string | null;
  shellPreview: ShellCommandPreview | null;
  atomicResult: unknown | null;
  inputValue: string;
  secretValue: string;
  requiredConfirmationPhrase: string | null;
  validationErrorKey: string | null;
  atomicPending: boolean;
  operationPending: boolean;
  atomicExecutor: AtomicCommandExecutor | null;
  longRunningExecutor: LongRunningOperationExecutor | null;
  cancelExecutor: LongRunningCancelExecutor | null;
  conflictResolver: ConflictResolver | null;
  onAtomicSuccess: AtomicCommandSuccessHandler | null;
  onOperationSummary: OperationSummaryHandler | null;
  onOperationStartError: OperationStartErrorHandler | null;
}

export type AtomicCommandExecutor = (
  dialog: OperationDialogDraft,
) => Promise<{ ok: true; data: unknown } | { ok: false; error: AppError }>;

export type AtomicCommandSuccessHandler = (entry: unknown, dialog: OperationDialogDraft) => void;

export type LongRunningOperationExecutor = (
  dialog: OperationDialogDraft,
) => Promise<{ ok: true; data: OperationStarted } | { ok: false; error: AppError }>;

export type LongRunningCancelExecutor = (operationId: string) => Promise<unknown>;
export type ConflictResolver = (operationId: string, decision: ConflictDecision) => Promise<unknown>;
export type OperationSummaryHandler = (summary: OperationSummary, dialog: OperationDialogDraft) => void;
export type OperationStartErrorHandling = 'dismiss' | 'keep' | void;
export type OperationStartErrorHandler = (
  error: AppError,
  dialog: OperationDialogDraft,
) => OperationStartErrorHandling;

export interface OpenDialogRequest {
  action: AppAction;
  panelId: PanelId;
  sources: FileEntry[];
  targetDir: string | null;
  workingDir: string;
  atomicExecutor?: AtomicCommandExecutor;
  longRunningExecutor?: LongRunningOperationExecutor;
  cancelExecutor?: LongRunningCancelExecutor;
  conflictResolver?: ConflictResolver;
  onAtomicSuccess?: AtomicCommandSuccessHandler;
  onOperationSummary?: OperationSummaryHandler;
  onOperationStartError?: OperationStartErrorHandler;
}

export interface ActiveOperationController {
  operationId: string | null;
  dialog: OperationDialogDraft;
  cancelExecutor: LongRunningCancelExecutor | null;
  conflictResolver: ConflictResolver | null;
  onOperationSummary: OperationSummaryHandler | null;
  cancelRequestedBeforeStart: boolean;
}

export interface OperationStoreState {
  dialog: OperationDialogDraft | null;
  progress: OperationProgress | null;
  conflictPrompt: ConflictPrompt | null;
  summary: OperationSummary | null;
  operationHistory: OperationSummary[];
  lastError: AppError | null;
  lastConflictDecision: ConflictDecision | null;
  applyAllConflictDecision: Extract<ConflictDecision, 'allOverwrite' | 'allSkip'> | null;
  activeOperationController: ActiveOperationController | null;
  openDialog(request: OpenDialogRequest): void;
  startLongRunningOperation(request: OpenDialogRequest): Promise<void>;
  updateDialogInput(value: string): void;
  updateDialogSecret(value: string): void;
  confirmDialog(): Promise<void>;
  applyOperationStarted(started: OperationStarted): void;
  applyOperationProgress(progress: OperationProgress): void;
  applyOperationConflict(prompt: ConflictPrompt): void;
  applyOperationSummary(summary: OperationSummary): void;
  applyOperationError(error: AppError): void;
  resolveConflict(decision: ConflictDecision): void;
  cancelOperation(): void;
  closeDialog(): void;
  clearSummary(): void;
  clearOperationHistory(): void;
}

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
    const result = await dialog.longRunningExecutor(dialog);
    if (get().activeOperationController?.dialog !== dialog) return;
    if (!result.ok) {
      const errorHandling = dialog.onOperationStartError?.(result.error, dialog);
      set({
        lastError: errorHandling === 'dismiss' ? null : result.error,
        progress: null,
        conflictPrompt: null,
        summary: null,
        activeOperationController: null,
      });
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
      observeOperationControl(pendingController?.cancelExecutor?.(result.data.operationId), result.data.operationId, 'cancelOperation');
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
      }));
      return;
    }
    get().applyOperationStarted(result.data);
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
        ...(dialog.dialogKind === 'shellCommand'
          ? {
              shellPreview: disabledShellPreview(dialog.targetDir ?? ''),
              atomicResult: null,
            }
          : null),
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
          dialog: { ...dialog, validationErrorKey },
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

      const shellPreviewResult = isShellCommandPreviewResult(result.data) ? result.data : null;
      if (dialog.dialogKind === 'shellCommand' && shellPreviewResult) {
        set((current) => ({
          dialog: current.dialog
            ? {
                ...current.dialog,
                atomicPending: false,
                shellPreview: shellPreviewResult,
                atomicResult: shellPreviewResult,
              }
            : null,
          progress: isOperationInFlight(current) ? current.progress : null,
          conflictPrompt: isOperationInFlight(current) ? current.conflictPrompt : null,
          summary: isOperationInFlight(current) ? current.summary : null,
          lastError: null,
        }));
        return;
      }
      if (dialog.dialogKind === 'properties' || dialog.dialogKind === 'shellCommand') {
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
        dialog.dialogKind === 'shellCommand'
          ? 'errors.shellCommandDisabled'
          : 'errors.commandNotConnected',
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
          dialog: { ...dialog, validationErrorKey },
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
      const result = await dialog.longRunningExecutor(dialog);
      if (get().activeOperationController?.dialog !== dialog) return;
      if (!result.ok) {
        const errorHandling = dialog.onOperationStartError?.(result.error, dialog);
        set((current) => ({
          dialog: errorHandling === 'dismiss'
            ? null
            : current.dialog
              ? { ...current.dialog, operationPending: false }
              : null,
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
        observeOperationControl(pendingController?.cancelExecutor?.(result.data.operationId), result.data.operationId, 'cancelOperation');
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
          dialog: null,
        }));
        return;
      }
      get().applyOperationStarted(result.data);
      set({ dialog: null });
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
    observeOperationControl(
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
        observeOperationControl(controller.cancelExecutor?.(controller.operationId), controller.operationId, 'cancelOperation', get().conflictPrompt);
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
    observeOperationControl(
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
  closeDialog: () => set((current) => {
    if (isOperationInFlight(current)) {
      return { dialog: null, lastError: null };
    }
    return { dialog: null, progress: null, conflictPrompt: null, lastError: null, activeOperationController: null };
  }),
  clearSummary: () => set((current) => ({
    summary: null,
    lastError: null,
    progress: current.progress && isTerminalState(current.progress.state) ? null : current.progress,
  })),
  clearOperationHistory: () => set({ operationHistory: [] }),
}));

const observeOperationControl = (
  request: Promise<unknown> | undefined,
  operationId: string,
  command: 'cancelOperation' | 'resolveConflict',
  prompt: ConflictPrompt | null = null,
) => {
  if (!request) return;
  const fail = (error: unknown) => {
    const current = useOperationStore.getState();
    if (current.progress?.operationId !== operationId || isTerminalState(current.progress.state)) return;
    useOperationStore.setState({
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

export const dialogKindForAction = (actionId: ActionId): DialogKind | null => {
  const mapping: Partial<Record<ActionId, DialogKind>> = {
    'file.copy': 'copy',
    'file.move': 'move',
    'file.trash': 'trash',
    'file.deletePermanent': 'deletePermanent',
    'file.rename': 'rename',
    'file.mkdir': 'createDir',
    'file.properties': 'properties',
    'archive.extract': 'archiveExtract',
    'archive.extractAuto': 'archiveExtract',
    'archive.create': 'archiveCreate',
    'external.openDefault': 'externalOpenDefault',
    'external.reveal': 'externalReveal',
    'external.openEditor': 'externalEditor',
    'external.runShellCommand': 'shellCommand',
  };
  return mapping[actionId] ?? null;
};

const buildDialogDraft = (dialogKind: DialogKind, request: OpenDialogRequest): OperationDialogDraft => {
  const isPermanentDelete = dialogKind === 'deletePermanent';
  const isShell = dialogKind === 'shellCommand';
  const backendExecutionStubbed = isBackendExecutionStubbed(dialogKind, request);
  const inputValue = initialInputValueForDialog(dialogKind, request);
  const requiredConfirmationPhrase = requiredConfirmationPhraseForDialog(dialogKind, request);
  return {
    id: ++nextDialogId,
    dialogKind,
    executionMode: dialogExecutionModeForDialog(dialogKind),
    panelId: request.panelId,
    sources: request.sources,
    targetDir: targetForDialog(dialogKind, request),
    dangerLevel: request.action.dangerLevel,
    defaultDecision: isPermanentDelete ? 'cancel' : 'skip',
    backendExecutionStubbed,
    backendExecutionStubReasonKey: backendExecutionStubbed
      ? 'operations.backendExecution.stubbedUntilCommandWiring'
      : null,
    shellPreview: isShell ? disabledShellPreview(request.workingDir) : null,
    atomicResult: null,
    inputValue,
    secretValue: '',
    requiredConfirmationPhrase,
    validationErrorKey: validateDialogInput(dialogKind, inputValue, requiredConfirmationPhrase),
    atomicPending: false,
    operationPending: false,
    atomicExecutor: request.atomicExecutor ?? null,
    longRunningExecutor: request.longRunningExecutor ?? null,
    cancelExecutor: request.cancelExecutor ?? null,
    conflictResolver: request.conflictResolver ?? null,
    onAtomicSuccess: request.onAtomicSuccess ?? null,
    onOperationSummary: request.onOperationSummary ?? null,
    onOperationStartError: request.onOperationStartError ?? null,
  };
};

const targetForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind === 'copy' || dialogKind === 'move' || dialogKind === 'archiveCreate' || dialogKind === 'archiveExtract') {
    return request.targetDir;
  }
  if (dialogKind === 'createDir' || dialogKind === 'shellCommand') {
    return request.workingDir;
  }
  return request.sources[0]?.path ?? request.workingDir;
};

type LongRunningDialogKind =
  | 'copy'
  | 'move'
  | 'trash'
  | 'deletePermanent'
  | 'archiveCreate'
  | 'archiveExtract';

type AtomicCommandDialogKind =
  | 'rename'
  | 'createDir'
  | 'properties'
  | 'externalOpenDefault'
  | 'externalReveal'
  | 'externalEditor'
  | 'shellCommand';

const LONG_RUNNING_DIALOGS: readonly LongRunningDialogKind[] = [
  'copy',
  'move',
  'trash',
  'deletePermanent',
  'archiveCreate',
  'archiveExtract',
];

const ATOMIC_COMMAND_DIALOGS: readonly AtomicCommandDialogKind[] = [
  'rename',
  'createDir',
  'properties',
  'externalOpenDefault',
  'externalReveal',
  'externalEditor',
  'shellCommand',
];

const isLongRunningDialog = (dialogKind: DialogKind): dialogKind is LongRunningDialogKind =>
  LONG_RUNNING_DIALOGS.includes(dialogKind as LongRunningDialogKind);

const isAtomicCommandDialog = (dialogKind: DialogKind): dialogKind is AtomicCommandDialogKind =>
  ATOMIC_COMMAND_DIALOGS.includes(dialogKind as AtomicCommandDialogKind);

export const dialogExecutionModeForDialog = (dialogKind: DialogKind): DialogExecutionMode => {
  if (isLongRunningDialog(dialogKind)) {
    return 'longRunningOperation';
  }
  if (isAtomicCommandDialog(dialogKind)) {
    return 'atomicCommand';
  }
  return 'unsupportedPreview';
};

const CONNECTABLE_SAFE_MUTATIONS: readonly DialogKind[] = ['createDir', 'rename'];
const CONNECTABLE_LONG_RUNNING_OPERATIONS: readonly DialogKind[] = ['copy', 'move', 'trash', 'deletePermanent', 'archiveCreate', 'archiveExtract'];

const isBackendExecutionStubbed = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (CONNECTABLE_LONG_RUNNING_OPERATIONS.includes(dialogKind)) {
    return !request.longRunningExecutor;
  }
  if (isLongRunningDialog(dialogKind)) {
    return true;
  }
  if (CONNECTABLE_SAFE_MUTATIONS.includes(dialogKind)) {
    return !request.atomicExecutor;
  }
  return dialogExecutionModeForDialog(dialogKind) === 'atomicCommand' && !request.atomicExecutor;
};

const initialInputValueForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind === 'rename') {
    return request.sources[0]?.name ?? '';
  }
  if (dialogKind === 'archiveCreate') {
    return `archive-${Date.now()}.zip`;
  }
  return '';
};

const requiredConfirmationPhraseForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind !== 'deletePermanent') {
    return null;
  }
  if (request.sources.length === 1 && request.sources[0]?.name) {
    return request.sources[0].name;
  }
  return `DELETE ${request.sources.length}`;
};

const validateDialogInput = (dialogKind: DialogKind, value: string, requiredConfirmationPhrase: string | null) => {
  const trimmed = value.trim();
  if (dialogKind === 'deletePermanent') {
    return requiredConfirmationPhrase && trimmed === requiredConfirmationPhrase ? null : 'errors.confirmationRequired';
  }
  if (dialogKind === 'archiveCreate') {
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
      return 'errors.invalidName';
    }
    if (!archiveCreateNameIsSupported(trimmed)) {
      return 'errors.archiveFormatUnsupported';
    }
    return null;
  }
  if (dialogKind === 'shellCommand') {
    return trimmed ? null : 'errors.invalidShellCommand';
  }
  if (dialogKind !== 'createDir' && dialogKind !== 'rename') {
    return null;
  }
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return 'errors.invalidName';
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return 'errors.invalidName';
  }
  return null;
};

const archiveCreateNameIsSupported = (name: string) => [
  '.zip', '.jar', '.war', '.tar', '.tar.gz', '.tgz', '.tar.zst', '.tzst', '.7z',
].some((suffix) => name.toLowerCase().endsWith(suffix));

const isTerminalState = (state: OperationState) =>
  state === 'completed' || state === 'completedWithErrors' || state === 'failed' || state === 'cancelled';

const isPendingOperationId = (operationId: string) => operationId.startsWith('pending-');

const isPendingAliasForUnboundController = (
  progress: OperationProgress,
  controller: ActiveOperationController | null,
) => isPendingOperationId(progress.operationId) && Boolean(controller) && !controller?.operationId;

export const isOperationInFlight = (state: Pick<OperationStoreState, 'progress' | 'activeOperationController'>) =>
  Boolean(state.activeOperationController) || Boolean(state.progress && !isTerminalState(state.progress.state));

const MAX_OPERATION_HISTORY = 50;

const appendOperationHistory = (history: OperationSummary[], summary: OperationSummary) => [
  summary,
  ...history.filter((item) => item.operationId !== summary.operationId),
].slice(0, MAX_OPERATION_HISTORY);

const operationKindForDialog = (dialogKind: LongRunningDialogKind): OperationKind => {
  const mapping: Record<LongRunningDialogKind, OperationKind> = {
    copy: 'copy',
    move: 'move',
    trash: 'trash',
    deletePermanent: 'delete',
    archiveCreate: 'archiveCreate',
    archiveExtract: 'archiveExtract',
  };
  return mapping[dialogKind];
};

const disabledShellPreview = (workingDir: string): ShellCommandPreview => ({
  confirmToken: 'disabled',
  expiresAt: new Date(0).toISOString(),
  fingerprint: `disabled:${workingDir}`,
  requiresConfirmation: true,
  policy: {
    enabled: false,
    reasonKey: 'settings.external.shellCommand.disabledByDefault',
  },
});

const isShellCommandPreviewResult = (value: unknown): value is ShellCommandPreview => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<ShellCommandPreview>;
  return typeof candidate.confirmToken === 'string'
    && typeof candidate.fingerprint === 'string'
    && Boolean(candidate.policy);
};

const appError = (code: string, messageKey: string, path: string | null, recoverable: boolean): AppError => ({
  code,
  messageKey,
  path,
  details: null,
  recoverable,
});

export const allowedOperationTransitions: Record<OperationState, OperationState[]> = {
  idle: ['validating'],
  validating: ['scanning', 'failed', 'cancelled'],
  scanning: ['queued', 'failed', 'cancelled'],
  queued: ['running', 'cancelled'],
  running: ['waitingForConflict', 'completed', 'completedWithErrors', 'failed', 'cancelling'],
  waitingForConflict: ['running', 'cancelled', 'cancelling'],
  cancelling: ['cancelled', 'completedWithErrors'],
  completed: [],
  completedWithErrors: [],
  failed: [],
  cancelled: [],
};

export const canTransitionOperation = (from: OperationState, to: OperationState) =>
  allowedOperationTransitions[from].includes(to);

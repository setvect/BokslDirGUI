import { create } from 'zustand';
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
  | 'archivePreview'
  | 'archiveCreate'
  | 'archiveExtract'
  | 'externalOpenDefault'
  | 'externalReveal'
  | 'externalEditor'
  | 'shellCommand';

export type DialogExecutionMode = 'atomicCommand' | 'longRunningOperation' | 'unsupportedPreview';

export interface OperationDialogDraft {
  dialogKind: DialogKind;
  executionMode: DialogExecutionMode;
  actionId: ActionId;
  title: string;
  description: string;
  panelId: PanelId;
  sources: FileEntry[];
  targetDir: string | null;
  dangerLevel: DangerLevel;
  defaultDecision: ConflictDecision;
  primaryLabel: string;
  cancelLabel: string;
  commandPath: string;
  backendExecutionStubbed: boolean;
  backendExecutionStubReasonKey: string | null;
  shellPreview: ShellCommandPreview | null;
  atomicResult: unknown | null;
  inputLabel: string | null;
  inputValue: string;
  validationErrorKey: string | null;
  atomicPending: boolean;
  operationPending: boolean;
  atomicExecutor: AtomicCommandExecutor | null;
  longRunningExecutor: LongRunningOperationExecutor | null;
  cancelExecutor: LongRunningCancelExecutor | null;
  conflictResolver: ConflictResolver | null;
  onAtomicSuccess: AtomicCommandSuccessHandler | null;
  onOperationSummary: OperationSummaryHandler | null;
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
  openDialog(request: OpenDialogRequest): void;
  updateDialogInput(value: string): void;
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
  openDialog: (request) => {
    const dialogKind = dialogKindForAction(request.action.id as ActionId);
    if (!dialogKind) {
      return;
    }
    set({
      dialog: buildDialogDraft(dialogKind, request),
      progress: null,
      conflictPrompt: null,
      summary: null,
      lastError: null,
      lastConflictDecision: null,
      applyAllConflictDecision: null,
    });
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
        validationErrorKey: validateDialogInput(dialog.dialogKind, value),
      },
      lastError: null,
    });
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
      const validationErrorKey = validateDialogInput(dialog.dialogKind, dialog.inputValue);
      if (validationErrorKey) {
        set({
          dialog: { ...dialog, validationErrorKey },
          lastError: appError('invalid_name', validationErrorKey, dialog.targetDir, true),
          summary: null,
          progress: null,
        });
        return;
      }
      if (!dialog.atomicExecutor) {
        set({
          lastError: appError('unsupported', 'errors.commandNotConnected', dialog.targetDir, true),
          summary: null,
          progress: null,
        });
        return;
      }

      set({
        dialog: { ...dialog, atomicPending: true },
        lastError: null,
      });

      const result = await dialog.atomicExecutor(dialog);
      if (!result.ok) {
        set((current) => ({
          dialog: current.dialog ? { ...current.dialog, atomicPending: false } : null,
          lastError: result.error,
          summary: null,
          progress: null,
        }));
        return;
      }

      dialog.onAtomicSuccess?.(result.data, dialog);
      const shellPreviewResult = isShellCommandPreviewResult(result.data) ? result.data : null;
      if (dialog.dialogKind === 'shellCommand' && shellPreviewResult) {
        set((current) => ({
          dialog: current.dialog
            ? {
                ...current.dialog,
                atomicPending: false,
                shellPreview: shellPreviewResult,
                atomicResult: shellPreviewResult,
                primaryLabel: shellPreviewResult.policy.enabled ? '확인 후 실행' : 'Preview disabled',
              }
            : null,
          progress: null,
          conflictPrompt: null,
          summary: null,
          lastError: null,
        }));
        return;
      }
      if (dialog.dialogKind === 'properties' || dialog.dialogKind === 'archivePreview' || dialog.dialogKind === 'shellCommand') {
        set((current) => ({
          dialog: current.dialog
            ? { ...current.dialog, atomicPending: false, atomicResult: result.data }
            : null,
          progress: null,
          conflictPrompt: null,
          summary: null,
          lastError: null,
        }));
        return;
      }
      set({
        dialog: null,
        progress: null,
        conflictPrompt: null,
        summary: null,
        lastError: null,
      });
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
      if (dialog.operationPending) {
        return;
      }
      const validationErrorKey = validateDialogInput(dialog.dialogKind, dialog.inputValue);
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
      const result = await dialog.longRunningExecutor(dialog);
      if (!result.ok) {
        set((current) => ({
          dialog: current.dialog ? { ...current.dialog, operationPending: false } : null,
          lastError: result.error,
          summary: null,
        }));
        return;
      }
      get().applyOperationStarted(result.data);
      set((current) => ({
        dialog: current.dialog ? { ...current.dialog, operationPending: false } : null,
      }));
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
    if (currentProgress?.operationId === started.operationId && isTerminalState(currentProgress.state)) {
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
    const current = get().progress;
    if (current && (current.operationId !== progress.operationId || isTerminalState(current.state))) {
      return;
    }
    set({ progress, lastError: null });
  },
  applyOperationConflict: (prompt) => {
    const progress = get().progress;
    if (progress && (progress.operationId !== prompt.operationId || isTerminalState(progress.state))) {
      return;
    }
    set((current) => ({
      conflictPrompt: prompt,
      progress: current.progress
        ? { ...current.progress, operationId: prompt.operationId, state: 'waitingForConflict' }
        : null,
    }));
  },
  applyOperationSummary: (summary) => {
    const currentProgress = get().progress;
    if (currentProgress && currentProgress.operationId !== summary.operationId) {
      return;
    }
    const dialog = get().dialog;
    dialog?.onOperationSummary?.(summary, dialog);
    set((current) => ({
      summary,
      operationHistory: appendOperationHistory(current.operationHistory, summary),
      conflictPrompt: current.conflictPrompt?.operationId === summary.operationId ? null : current.conflictPrompt,
      progress: current.progress && current.progress.operationId === summary.operationId
        ? { ...current.progress, state: summary.state, completedFiles: summary.completedFiles, recentErrorCount: summary.failedFiles }
        : current.progress ?? {
          operationId: summary.operationId,
          kind: summary.kind,
          state: summary.state,
          totalFiles: summary.completedFiles + summary.failedFiles,
          completedFiles: summary.completedFiles,
          totalBytes: null,
          completedBytes: 0,
          currentPath: null,
          bytesPerSecond: null,
          etaSeconds: null,
          recentErrorCount: summary.failedFiles,
        },
      dialog: current.dialog ? { ...current.dialog, operationPending: false } : null,
      lastError: summary.errors[0] ?? null,
    }));
  },
  applyOperationError: (error) => {
    set((current) => ({
      lastError: error,
      dialog: current.dialog ? { ...current.dialog, operationPending: false } : null,
    }));
  },
  resolveConflict: (decision) => {
    const prompt = get().conflictPrompt;
    const progress = get().progress;
    if (!prompt) {
      return;
    }
    const operationId = prompt.operationId;
    const dialogKind = get().dialog?.dialogKind;
    const kind = progress?.kind ?? (dialogKind && isLongRunningDialog(dialogKind)
      ? operationKindForDialog(dialogKind)
      : 'copy');
    const completedFiles = progress?.completedFiles ?? 0;
    void get().dialog?.conflictResolver?.(operationId, decision);
    if (decision === 'cancel') {
      set({
        progress: progress
          ? { ...progress, state: 'cancelled' }
          : {
            operationId,
            kind,
            state: 'cancelled',
            totalFiles: null,
            completedFiles,
            totalBytes: null,
            completedBytes: 0,
            currentPath: prompt.source.path,
            bytesPerSecond: null,
            etaSeconds: null,
            recentErrorCount: 0,
          },
      summary: {
        operationId,
        kind,
        state: 'cancelled',
        completedFiles,
        failedFiles: 0,
        errors: [],
      },
      operationHistory: appendOperationHistory(get().operationHistory, {
        operationId,
        kind,
        state: 'cancelled',
        completedFiles,
        failedFiles: 0,
        errors: [],
      }),
      conflictPrompt: null,
      lastConflictDecision: decision,
      applyAllConflictDecision: null,
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
    if (!progress) {
      set({ dialog: null, conflictPrompt: null });
      return;
    }
    void get().dialog?.cancelExecutor?.(progress.operationId);
    set({
      progress: { ...progress, state: 'cancelling' },
      conflictPrompt: null,
      summary: {
        operationId: progress.operationId,
        kind: progress.kind,
        state: 'cancelled',
        completedFiles: progress.completedFiles,
        failedFiles: 0,
        errors: [],
      },
      operationHistory: appendOperationHistory(get().operationHistory, {
        operationId: progress.operationId,
        kind: progress.kind,
        state: 'cancelled',
        completedFiles: progress.completedFiles,
        failedFiles: 0,
        errors: [],
      }),
    });
  },
  closeDialog: () => set({ dialog: null, progress: null, conflictPrompt: null, lastError: null }),
  clearSummary: () => set({ summary: null, lastError: null }),
  clearOperationHistory: () => set({ operationHistory: [] }),
}));

export const dialogKindForAction = (actionId: ActionId): DialogKind | null => {
  const mapping: Partial<Record<ActionId, DialogKind>> = {
    'file.copy': 'copy',
    'file.move': 'move',
    'file.trash': 'trash',
    'file.deletePermanent': 'deletePermanent',
    'file.rename': 'rename',
    'file.mkdir': 'createDir',
    'file.properties': 'properties',
    'archive.preview': 'archivePreview',
    'archive.list': 'archivePreview',
    'archive.extract': 'archiveExtract',
    'archive.create': 'archiveCreate',
    'external.openDefault': 'externalOpenDefault',
    'external.reveal': 'externalReveal',
    'external.openEditor': 'externalEditor',
    'external.runShellCommand': 'shellCommand',
  };
  return mapping[actionId] ?? null;
};

const buildDialogDraft = (dialogKind: DialogKind, request: OpenDialogRequest): OperationDialogDraft => {
  const title = titleForDialog(dialogKind);
  const isPermanentDelete = dialogKind === 'deletePermanent';
  const isShell = dialogKind === 'shellCommand';
  const backendExecutionStubbed = isBackendExecutionStubbed(dialogKind, request);
  const inputValue = initialInputValueForDialog(dialogKind, request);
  return {
    dialogKind,
    executionMode: dialogExecutionModeForDialog(dialogKind),
    actionId: request.action.id as ActionId,
    title,
    description: descriptionForDialog(dialogKind, request),
    panelId: request.panelId,
    sources: request.sources,
    targetDir: targetForDialog(dialogKind, request),
    dangerLevel: request.action.dangerLevel,
    defaultDecision: isPermanentDelete ? 'cancel' : 'skip',
    primaryLabel: isPermanentDelete ? '영구 삭제 확인' : isShell ? 'Preview disabled' : '확인',
    cancelLabel: isPermanentDelete ? '취소(기본)' : '취소',
    commandPath: request.action.runPath,
    backendExecutionStubbed,
    backendExecutionStubReasonKey: backendExecutionStubbed
      ? 'operations.backendExecution.stubbedUntilCommandWiring'
      : null,
    shellPreview: isShell ? disabledShellPreview(request.workingDir) : null,
    atomicResult: null,
    inputLabel: inputLabelForDialog(dialogKind),
    inputValue,
    validationErrorKey: validateDialogInput(dialogKind, inputValue),
    atomicPending: false,
    operationPending: false,
    atomicExecutor: request.atomicExecutor ?? null,
    longRunningExecutor: request.longRunningExecutor ?? null,
    cancelExecutor: request.cancelExecutor ?? null,
    conflictResolver: request.conflictResolver ?? null,
    onAtomicSuccess: request.onAtomicSuccess ?? null,
    onOperationSummary: request.onOperationSummary ?? null,
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

const titleForDialog = (dialogKind: DialogKind) => {
  const titles: Record<DialogKind, string> = {
    copy: 'Copy to opposite panel',
    move: 'Move to opposite panel',
    trash: 'Move to Trash',
    deletePermanent: 'Permanent Delete',
    rename: 'Rename Entry',
    createDir: 'Create Directory',
    properties: 'Properties',
    archivePreview: 'Archive Preview',
    archiveCreate: 'Create Archive',
    archiveExtract: 'Extract Archive',
    externalOpenDefault: 'Open with Default App',
    externalReveal: 'Reveal in File Manager',
    externalEditor: 'Open in External Editor',
    shellCommand: 'Run Shell Command',
  };
  return titles[dialogKind];
};

const descriptionForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  const count = request.sources.length;
  switch (dialogKind) {
    case 'copy':
      return `${count}개 항목을 반대 패널로 복사합니다. 충돌 정책과 진행률은 operation event로 추적합니다.`;
    case 'move':
      return `${count}개 항목 이동은 destructive 작업입니다. 같은 파일시스템은 rename fast-path를 우선합니다.`;
    case 'trash':
      return `${count}개 항목을 휴지통으로 보내기 전에 확인합니다. 자동 영구 삭제 전환은 금지됩니다.`;
    case 'deletePermanent':
      return `${count}개 항목 영구 삭제는 되돌릴 수 없습니다. 기본 동작은 취소입니다.`;
    case 'rename':
      return '새 이름 입력과 중복/권한 검증을 위한 다이얼로그 셸입니다.';
    case 'createDir':
      return '현재 패널 경로에 새 폴더 이름을 입력하는 다이얼로그 셸입니다.';
    case 'archivePreview':
      return '압축 파일 목록 미리보기 shell입니다. 7z는 fixture gate 통과 전 완료로 보지 않습니다.';
    case 'archiveCreate':
      return `${count}개 항목 압축 생성 shell입니다. password는 로그/이벤트에 남기지 않습니다.`;
    case 'archiveExtract':
      return '압축 해제 target은 Rust에서 normalize하고 zip-slip을 차단해야 합니다.';
    case 'externalOpenDefault':
    case 'externalReveal':
    case 'externalEditor':
      return '외부 앱 실행은 명시 확인과 실패 메시지 표시를 거친 뒤 command boundary에 연결됩니다.';
    case 'shellCommand':
      return 'Shell command는 기본 비활성입니다. prepare_shell_command preview/confirmToken 경계를 통과해야 실행됩니다.';
    case 'properties':
      return '선택 항목의 metadata/properties를 표시하는 shell입니다.';
  }
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
  | 'archivePreview'
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
  'archivePreview',
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

const inputLabelForDialog = (dialogKind: DialogKind) => {
  if (dialogKind === 'createDir') {
    return '새 폴더 이름';
  }
  if (dialogKind === 'rename') {
    return '새 이름';
  }
  if (dialogKind === 'deletePermanent') {
    return '영구 삭제 확인 문구(PERMANENT_DELETE)';
  }
  if (dialogKind === 'archiveCreate') {
    return '압축 파일 이름(.zip 또는 .7z)';
  }
  if (dialogKind === 'shellCommand') {
    return '실행할 명령(command arg1 arg2)';
  }
  return null;
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

const validateDialogInput = (dialogKind: DialogKind, value: string) => {
  const trimmed = value.trim();
  if (dialogKind === 'deletePermanent') {
    return trimmed === 'PERMANENT_DELETE' ? null : 'errors.confirmationRequired';
  }
  if (dialogKind === 'archiveCreate') {
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
      return 'errors.invalidName';
    }
    if (!trimmed.endsWith('.zip') && !trimmed.endsWith('.7z')) {
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

const isTerminalState = (state: OperationState) =>
  state === 'completed' || state === 'completedWithErrors' || state === 'failed' || state === 'cancelled';

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

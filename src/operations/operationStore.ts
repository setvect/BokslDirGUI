import { create } from 'zustand';
import type {
  AppError,
  ConflictDecision,
  ConflictPrompt,
  FileEntry,
  OperationKind,
  OperationProgress,
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
  inputLabel: string | null;
  inputValue: string;
  validationErrorKey: string | null;
  atomicPending: boolean;
  atomicExecutor: AtomicCommandExecutor | null;
  onAtomicSuccess: AtomicCommandSuccessHandler | null;
}

export type AtomicCommandExecutor = (
  dialog: OperationDialogDraft,
) => Promise<{ ok: true; data: FileEntry } | { ok: false; error: AppError }>;

export type AtomicCommandSuccessHandler = (entry: FileEntry, dialog: OperationDialogDraft) => void;

export interface OpenDialogRequest {
  action: AppAction;
  panelId: PanelId;
  sources: FileEntry[];
  targetDir: string | null;
  workingDir: string;
  atomicExecutor?: AtomicCommandExecutor;
  onAtomicSuccess?: AtomicCommandSuccessHandler;
}

export interface OperationStoreState {
  dialog: OperationDialogDraft | null;
  progress: OperationProgress | null;
  conflictPrompt: ConflictPrompt | null;
  summary: OperationSummary | null;
  lastError: AppError | null;
  lastConflictDecision: ConflictDecision | null;
  applyAllConflictDecision: Extract<ConflictDecision, 'allOverwrite' | 'allSkip'> | null;
  openDialog(request: OpenDialogRequest): void;
  updateDialogInput(value: string): void;
  confirmDialog(): Promise<void>;
  resolveConflict(decision: ConflictDecision): void;
  cancelOperation(): void;
  closeDialog(): void;
  clearSummary(): void;
}

export const useOperationStore = create<OperationStoreState>((set, get) => ({
  dialog: null,
  progress: null,
  conflictPrompt: null,
  summary: null,
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
  resolveConflict: (decision) => {
    const prompt = get().conflictPrompt;
    const progress = get().progress;
    if (!prompt || !progress) {
      return;
    }
    if (decision === 'cancel') {
      set({
        progress: { ...progress, state: 'cancelled' },
        summary: {
          operationId: progress.operationId,
          kind: progress.kind,
          state: 'cancelled',
          completedFiles: progress.completedFiles,
          failedFiles: 0,
          errors: [],
        },
        conflictPrompt: null,
        lastConflictDecision: decision,
        applyAllConflictDecision: null,
      });
      return;
    }
    set({
      progress: { ...progress, state: 'running' },
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
    set({
      progress: { ...progress, state: 'cancelled' },
      conflictPrompt: null,
      summary: {
        operationId: progress.operationId,
        kind: progress.kind,
        state: 'cancelled',
        completedFiles: progress.completedFiles,
        failedFiles: 0,
        errors: [],
      },
    });
  },
  closeDialog: () => set({ dialog: null, progress: null, conflictPrompt: null, lastError: null }),
  clearSummary: () => set({ summary: null, lastError: null }),
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
    inputLabel: inputLabelForDialog(dialogKind),
    inputValue,
    validationErrorKey: validateDialogInput(dialogKind, inputValue),
    atomicPending: false,
    atomicExecutor: request.atomicExecutor ?? null,
    onAtomicSuccess: request.onAtomicSuccess ?? null,
  };
};

const targetForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind === 'copy' || dialogKind === 'move' || dialogKind === 'archiveExtract') {
    return request.targetDir;
  }
  if (dialogKind === 'createDir') {
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
      return `${count}개 항목을 반대 패널로 복사할 준비를 합니다. 실제 I/O 실행은 아직 stub입니다.`;
    case 'move':
      return `${count}개 항목 이동은 destructive 작업입니다. Rust validation 연결 전까지 실행하지 않습니다.`;
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
  | 'externalEditor';

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

const isBackendExecutionStubbed = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (isLongRunningDialog(dialogKind)) {
    return true;
  }
  if (CONNECTABLE_SAFE_MUTATIONS.includes(dialogKind)) {
    return !request.atomicExecutor;
  }
  return dialogExecutionModeForDialog(dialogKind) === 'atomicCommand';
};

const inputLabelForDialog = (dialogKind: DialogKind) => {
  if (dialogKind === 'createDir') {
    return '새 폴더 이름';
  }
  if (dialogKind === 'rename') {
    return '새 이름';
  }
  return null;
};

const initialInputValueForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind === 'rename') {
    return request.sources[0]?.name ?? '';
  }
  return '';
};

const validateDialogInput = (dialogKind: DialogKind, value: string) => {
  if (dialogKind !== 'createDir' && dialogKind !== 'rename') {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return 'errors.invalidName';
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return 'errors.invalidName';
  }
  return null;
};

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

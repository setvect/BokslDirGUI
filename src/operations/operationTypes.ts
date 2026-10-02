import type { AppAction, DangerLevel } from '../actions/registry';
import type {
  AppError,
  ConflictDecision,
  ConflictPrompt,
  FileEntry,
  OperationProgress,
  OperationStarted,
  OperationSummary,
  PanelId
} from '../domain/types';

import type { DialogKind, DialogExecutionMode } from './dialogDefinitions';
export type { DialogKind, DialogExecutionMode, LongRunningDialogKind, AtomicCommandDialogKind } from './dialogDefinitions';

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
  targetEntries?: FileEntry[];
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

import { invoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ActionResult,
  AppError,
  ArchiveListing,
  CancelAck,
  ConflictAck,
  ConflictDecision,
  ConflictPrompt,
  DirectoryListing,
  FileEntry,
  FileMetadata,
  FilePreview,
  LocationList,
  OperationProgress,
  OperationStarted,
  OperationSummary,
  Settings,
  ShellCommandPreview,
  ShellCommandResult,
  SortSpec,
  WatchAck,
} from '../domain/types';
import { COMMANDS, TauriCommandName } from './commands';

export type TauriResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: AppError };

export interface ListDirInput {
  panelId: 'left' | 'right';
  path: string;
  showHidden: boolean;
  sort: SortSpec;
  filter: string | null;
}

export interface StartFileOperationInput {
  sources: string[];
  targetDir: string;
  policy: ConflictDecision;
}

export interface DeleteOperationInput {
  targets: string[];
  mode: 'trash' | 'permanent';
  confirmToken?: string;
}

export interface OperationEventHandlers {
  progress?(progress: OperationProgress): void;
  conflict?(prompt: ConflictPrompt): void;
  summary?(summary: OperationSummary): void;
  error?(error: AppError): void;
}

type TauriRuntimeGlobal = typeof globalThis & {
  isTauri?: boolean;
  __TAURI_INTERNALS__?: { invoke?: unknown };
};

export const isTauriRuntime = () => {
  const runtimeGlobal = globalThis as TauriRuntimeGlobal;
  return isTauri() || typeof runtimeGlobal.__TAURI_INTERNALS__?.invoke === 'function';
};

export const BACKEND_IMPLEMENTED_COMMANDS = [
  COMMANDS.listDir,
  COMMANDS.getMetadata,
  COMMANDS.previewFile,
  COMMANDS.watchPath,
  COMMANDS.gotoPath,
  COMMANDS.listLocations,
  COMMANDS.createDir,
  COMMANDS.renameEntry,
  COMMANDS.startCopy,
  COMMANDS.startMove,
  COMMANDS.startDelete,
  COMMANDS.cancelOperation,
  COMMANDS.resolveConflict,
  COMMANDS.archiveList,
  COMMANDS.archiveCreate,
  COMMANDS.archiveExtract,
  COMMANDS.archiveAdd,
  COMMANDS.openDefault,
  COMMANDS.revealInManager,
  COMMANDS.openExternalEditor,
  COMMANDS.prepareShellCommand,
  COMMANDS.runShellCommand,
  COMMANDS.loadSettings,
  COMMANDS.saveSettings,
] as const satisfies readonly TauriCommandName[];

const implementedCommandSet = new Set<TauriCommandName>(BACKEND_IMPLEMENTED_COMMANDS);

export const isBackendImplementedCommand = (command: TauriCommandName) =>
  implementedCommandSet.has(command);

export const unsupportedCommandError = (command: TauriCommandName): AppError => ({
  code: 'unsupported',
  messageKey: 'errors.commandNotImplemented',
  path: null,
  details: { command },
  recoverable: true,
});

export const normalizeInvokeError = (error: unknown, command: TauriCommandName): AppError => {
  if (isAppError(error)) {
    return error;
  }

  if (typeof error === 'string') {
    return {
      code: 'io_error',
      messageKey: 'errors.tauriInvokeFailed',
      path: null,
      details: { command, message: error },
      recoverable: true,
    };
  }

  if (error && typeof error === 'object') {
    return {
      code: 'io_error',
      messageKey: 'errors.tauriInvokeFailed',
      path: null,
      details: { command, raw: JSON.stringify(error) },
      recoverable: true,
    };
  }

  return {
    code: 'io_error',
    messageKey: 'errors.tauriInvokeFailed',
    path: null,
    details: { command, raw: String(error) },
    recoverable: true,
  };
};

const isAppError = (value: unknown): value is AppError => {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as Partial<AppError>;
  return (
    typeof candidate.code === 'string' &&
    typeof candidate.messageKey === 'string' &&
    typeof candidate.recoverable === 'boolean'
  );
};

const invokeCommand = async <T>(command: TauriCommandName, args?: object): Promise<TauriResult<T>> => {
  if (!isBackendImplementedCommand(command)) {
    return { ok: false, error: unsupportedCommandError(command) };
  }

  try {
    const data = await invoke<T>(command, args as InvokeArgs | undefined);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: normalizeInvokeError(error, command) };
  }
};

export const tauriClient = {
  listDir: (input: ListDirInput) => invokeCommand<DirectoryListing>(COMMANDS.listDir, input),
  getMetadata: (input: { path: string }) => invokeCommand<FileMetadata>(COMMANDS.getMetadata, input),
  previewFile: (input: { path: string; maxBytes?: number }) => invokeCommand<FilePreview>(COMMANDS.previewFile, input),
  watchPath: (input: { panelId: 'left' | 'right'; path: string }) => invokeCommand<WatchAck>(COMMANDS.watchPath, input),
  gotoPath: (input: { panelId: 'left' | 'right'; path: string }) => invokeCommand<DirectoryListing>(COMMANDS.gotoPath, input),
  listLocations: () => invokeCommand<LocationList>(COMMANDS.listLocations),
  createDir: (input: { parent: string; name: string }) => invokeCommand<FileEntry>(COMMANDS.createDir, input),
  renameEntry: (input: { path: string; newName: string }) => invokeCommand<FileEntry>(COMMANDS.renameEntry, input),
  startCopy: (input: StartFileOperationInput) => invokeCommand<OperationStarted>(COMMANDS.startCopy, input),
  startMove: (input: StartFileOperationInput) => invokeCommand<OperationStarted>(COMMANDS.startMove, input),
  startDelete: (input: DeleteOperationInput) =>
    invokeCommand<OperationStarted>(COMMANDS.startDelete, input),
  cancelOperation: (input: { operationId: string }) => invokeCommand<CancelAck>(COMMANDS.cancelOperation, input),
  resolveConflict: (input: { operationId: string; decision: ConflictDecision }) =>
    invokeCommand<ConflictAck>(COMMANDS.resolveConflict, input),
  archiveList: (input: { archivePath: string; password?: string; limit?: number }) =>
    invokeCommand<ArchiveListing>(COMMANDS.archiveList, input),
  archiveCreate: (input: { sources: string[]; targetArchive: string; format: string; password?: string }) =>
    invokeCommand<OperationStarted>(COMMANDS.archiveCreate, input),
  archiveExtract: (input: { archivePath: string; targetDir: string; password?: string; policy: ConflictDecision; entries?: string[]; stripPrefix?: string }) =>
    invokeCommand<OperationStarted>(COMMANDS.archiveExtract, input),
  archiveAdd: (input: { sources: string[]; archivePath: string; targetInnerDir: string; policy: ConflictDecision }) =>
    invokeCommand<OperationStarted>(COMMANDS.archiveAdd, input),
  openDefault: (input: { path: string }) => invokeCommand<ActionResult>(COMMANDS.openDefault, input),
  revealInManager: (input: { path: string }) => invokeCommand<ActionResult>(COMMANDS.revealInManager, input),
  openExternalEditor: (input: { path: string; editorId?: string }) =>
    invokeCommand<ActionResult>(COMMANDS.openExternalEditor, input),
  prepareShellCommand: (input: { workingDir: string; command: string; args?: string[] }) =>
    invokeCommand<ShellCommandPreview>(COMMANDS.prepareShellCommand, input),
  runShellCommand: (input: { workingDir: string; command: string; args?: string[]; confirmToken: string }) =>
    invokeCommand<ShellCommandResult>(COMMANDS.runShellCommand, input),
  loadSettings: () => invokeCommand<Settings>(COMMANDS.loadSettings),
  saveSettings: (input: { patch: Partial<Settings> }) => invokeCommand<Settings>(COMMANDS.saveSettings, input),
  listenOperationEvents: async (handlers: OperationEventHandlers) => {
    if (!isTauriRuntime()) {
      return () => { };
    }
    const unlisten: Array<() => void> = [];
    try {
      unlisten.push(await listen<OperationProgress>('operation_progress', (event) => handlers.progress?.(event.payload)));
      unlisten.push(await listen<ConflictPrompt>('operation_conflict', (event) => handlers.conflict?.(event.payload)));
      unlisten.push(await listen<OperationSummary>('operation_summary', (event) => handlers.summary?.(event.payload)));
      unlisten.push(await listen<AppError>('operation_error', (event) => handlers.error?.(event.payload)));
    } catch (error) {
      for (const cleanup of unlisten.splice(0)) {
        cleanup();
      }
      throw error;
    }
    return () => {
      for (const cleanup of unlisten) {
        cleanup();
      }
    };
  },
};

export { COMMANDS } from './commands';
export type { TauriCommandName } from './commands';

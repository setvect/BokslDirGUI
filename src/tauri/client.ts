import { invoke, isTauri, type InvokeArgs } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  ActionResult,
  PlatformInfo,
  TrashUndoPreview,
  NativeFileClipboard,
  RenameRules, RenameItem, RenamePreview,
  OpenWithApp,
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
  SortSpec,
  WatchAck,
} from '../domain/types';
import { COMMANDS, EVENTS, TauriCommandName } from './commands';

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
}

type TauriRuntimeGlobal = typeof globalThis & {
  isTauri?: boolean;
  __TAURI_INTERNALS__?: { invoke?: unknown };
};

export const isTauriRuntime = () => {
  const runtimeGlobal = globalThis as TauriRuntimeGlobal;
  return isTauri() || typeof runtimeGlobal.__TAURI_INTERNALS__?.invoke === 'function';
};

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

export const isAppError = (value: unknown): value is AppError => {
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
  try {
    const data = await invoke<T>(command, args as InvokeArgs | undefined);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: normalizeInvokeError(error, command) };
  }
};

export const tauriClient = {
  getPlatformInfo: () => invokeCommand<PlatformInfo>(COMMANDS.getPlatformInfo),
  previewTrashUndo: () => invokeCommand<TrashUndoPreview | null>(COMMANDS.previewTrashUndo),
  startTrashUndo: (input: { id: string }) => invokeCommand<OperationStarted>(COMMANDS.startTrashUndo, input),
  previewBulkRename: (input: { sources: string[]; rules: RenameRules }) => invokeCommand<RenamePreview[]>(COMMANDS.previewBulkRename, input),
  startBulkRename: (input: { items: RenameItem[] }) => invokeCommand<OperationStarted>(COMMANDS.startBulkRename, input),
  readFileClipboard: (input: { resolve: boolean }) => invokeCommand<NativeFileClipboard>(COMMANDS.readFileClipboard, input),
  writeFileClipboard: (input: { paths: string[]; intent: 'copy' | 'move' }) => invokeCommand<number>(COMMANDS.writeFileClipboard, input),
  clearFileClipboard: (input: { changeCount: number }) => invokeCommand<void>(COMMANDS.clearFileClipboard, input),
  listDir: (input: ListDirInput) => invokeCommand<DirectoryListing>(COMMANDS.listDir, input),
  getMetadata: (input: { path: string }) => invokeCommand<FileMetadata>(COMMANDS.getMetadata, input),
  previewFile: (input: { path: string; maxBytes?: number }) => invokeCommand<FilePreview>(COMMANDS.previewFile, input),
  watchPath: (input: { panelId: 'left' | 'right'; path: string }) => invokeCommand<WatchAck>(COMMANDS.watchPath, input),
  gotoPath: (input: { panelId: 'left' | 'right'; path: string; base?: string }) => invokeCommand<DirectoryListing>(COMMANDS.gotoPath, input),
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
  listOpenWithApps: (input: { path: string }) => invokeCommand<OpenWithApp[]>(COMMANDS.listOpenWithApps, input),
  openWithApp: (input: { path: string; applicationId: string }) => invokeCommand<ActionResult>(COMMANDS.openWithApp, input),
  revealInManager: (input: { path: string }) => invokeCommand<ActionResult>(COMMANDS.revealInManager, input),
  openCurrentInFileManager: (input: { path: string }) => invokeCommand<ActionResult>(COMMANDS.openCurrentInFileManager, input),
  openCurrentInTerminal: (input: { path: string }) => invokeCommand<ActionResult>(COMMANDS.openCurrentInTerminal, input),
  prepareShellCommand: (input: { workingDir: string; command: string; args?: string[] }) =>
    invokeCommand<ShellCommandPreview>(COMMANDS.prepareShellCommand, input),
  runShellCommand: (input: { workingDir: string; command: string; args?: string[]; confirmToken: string }) =>
    invokeCommand<OperationStarted>(COMMANDS.runShellCommand, input),
  loadSettings: () => invokeCommand<Settings>(COMMANDS.loadSettings),
  saveSettings: (input: { patch: Partial<Settings> }) => invokeCommand<Settings>(COMMANDS.saveSettings, input),
  listenOperationEvents: async (handlers: OperationEventHandlers) => {
    if (!isTauriRuntime()) {
      return () => { };
    }
    const unlisten: Array<() => void> = [];
    try {
      unlisten.push(await listen<OperationProgress>(EVENTS.operationProgress, (event) => handlers.progress?.(event.payload)));
      unlisten.push(await listen<ConflictPrompt>(EVENTS.operationConflict, (event) => handlers.conflict?.(event.payload)));
      unlisten.push(await listen<OperationSummary>(EVENTS.operationSummary, (event) => handlers.summary?.(event.payload)));
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

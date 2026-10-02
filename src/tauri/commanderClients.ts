import { startDrag, type DragResult as NativeDragResult } from '@crabnebula/tauri-plugin-drag';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { Settings } from '../domain/types';
import { tauriClient } from './client';

const NATIVE_FILE_DROP_EVENT = 'boksldir://native-file-drop';
export type NativeFileDragMode = 'copy' | 'move';
export type NativeFileDropEvent =
  | { type: 'enter'; paths: string[]; position: { x: number; y: number } }
  | { type: 'over'; position: { x: number; y: number } }
  | { type: 'drop'; paths: string[]; position: { x: number; y: number } }
  | { type: 'leave' };

interface NativeFileDragCompletion {
  result: NativeDragResult;
}

export interface NativeFileDragClient {
  start(paths: string[], mode: NativeFileDragMode, preview: string, onResult: (completion: NativeFileDragCompletion) => void): Promise<void>;
}

export interface NativeFileDropClient {
  listen(handler: (event: NativeFileDropEvent) => void): Promise<() => void>;
}

export interface AppController {
  quit(): Promise<void>;
}

export const DEFAULT_APP_CONTROLLER: AppController = {
  quit: () => getCurrentWindow().close(),
};

export const TAURI_NATIVE_FILE_DROP_CLIENT: NativeFileDropClient = {
  listen: (handler) => listen<NativeFileDropEvent>(NATIVE_FILE_DROP_EVENT, (event) => handler(event.payload)),
};

export const TAURI_NATIVE_FILE_DRAG_CLIENT: NativeFileDragClient = {
  start: (paths, mode, preview, onResult) => startDrag({
    item: paths,
    icon: preview,
    mode,
  }, ({ result }) => onResult({ result })),
};

export interface SafeMutationClient {
  createDir(input: { parent: string; name: string }): ReturnType<typeof tauriClient.createDir>;
  renameEntry(input: { path: string; newName: string }): ReturnType<typeof tauriClient.renameEntry>;
  getMetadata?(input: { path: string }): ReturnType<typeof tauriClient.getMetadata>;
  previewFile?(input: { path: string; maxBytes?: number }): ReturnType<typeof tauriClient.previewFile>;
  archiveList?(input: { archivePath: string; password?: string; limit?: number }): ReturnType<typeof tauriClient.archiveList>;
  listOpenWithApps?(input: { path: string }): ReturnType<typeof tauriClient.listOpenWithApps>;
  openWithApp?(input: { path: string; applicationPath: string }): ReturnType<typeof tauriClient.openWithApp>;
  openDefault?(input: { path: string }): ReturnType<typeof tauriClient.openDefault>;
  revealInManager?(input: { path: string }): ReturnType<typeof tauriClient.revealInManager>;
  openCurrentInFinder?(input: { path: string }): ReturnType<typeof tauriClient.openCurrentInFinder>;
  openCurrentInTerminal?(input: { path: string }): ReturnType<typeof tauriClient.openCurrentInTerminal>;
  openExternalEditor?(input: { path: string; editorId?: string }): ReturnType<typeof tauriClient.openExternalEditor>;
  prepareShellCommand?(input: { workingDir: string; command: string; args?: string[] }): ReturnType<typeof tauriClient.prepareShellCommand>;
  runShellCommand?(input: { workingDir: string; command: string; args?: string[]; confirmToken?: string }): ReturnType<typeof tauriClient.runShellCommand>;
  loadSettings?(): ReturnType<typeof tauriClient.loadSettings>;
  saveSettings?(input: { patch: Partial<Settings> }): ReturnType<typeof tauriClient.saveSettings>;
}

export interface LongRunningOperationClient {
  startCopy(input: { sources: string[]; targetDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.startCopy>;
  startMove(input: { sources: string[]; targetDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.startMove>;
  startDelete(input: { targets: string[]; mode: 'trash' | 'permanent'; confirmToken?: string }): ReturnType<typeof tauriClient.startDelete>;
  archiveCreate?(input: { sources: string[]; targetArchive: string; format: string; password?: string }): ReturnType<typeof tauriClient.archiveCreate>;
  archiveExtract?(input: { archivePath: string; targetDir: string; password?: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel'; entries?: string[]; stripPrefix?: string }): ReturnType<typeof tauriClient.archiveExtract>;
  archiveAdd?(input: { sources: string[]; archivePath: string; targetInnerDir: string; policy: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.archiveAdd>;
  cancelOperation(input: { operationId: string }): ReturnType<typeof tauriClient.cancelOperation>;
  resolveConflict(input: { operationId: string; decision: 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel' }): ReturnType<typeof tauriClient.resolveConflict>;
}

export const showNativeDropOverlay = () => invoke<void>('show_drop_overlay');

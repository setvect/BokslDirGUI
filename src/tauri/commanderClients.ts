import { startDrag, type DragResult as NativeDragResult } from '@crabnebula/tauri-plugin-drag';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isWindowsRuntime } from '../domain/runtimePlatform';
import { tauriClient } from './client';
import { EVENTS } from './commands';

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
  listen: (handler) => listen<NativeFileDropEvent>(EVENTS.nativeFileDrop, (event) => handler(event.payload)),
};

export const TAURI_NATIVE_FILE_DRAG_CLIENT: NativeFileDragClient = {
  start: async (paths, mode, preview, onResult) => {
    const items = isWindowsRuntime()
      ? await invoke<string[]>('prepare_native_file_drag', { paths }) : paths;
    await startDrag({ item: items, icon: preview, mode }, ({ result }) => onResult({ result }));
  },
};

// 실제 tauriClient 메서드 타입에서 파생. 입력 필드가 바뀌면 가짜 구현과 호출부도 컴파일 오류로 확인.
type TauriClient = typeof tauriClient;

export type SafeMutationClient = Pick<TauriClient, 'createDir' | 'renameEntry'> & Partial<Pick<TauriClient,
  | 'getPlatformInfo' | 'previewTrashUndo' | 'previewBulkRename' | 'readFileClipboard' | 'writeFileClipboard' | 'clearFileClipboard'
  | 'getMetadata' | 'previewFile' | 'archiveList' | 'listOpenWithApps' | 'openWithApp' | 'openDefault' | 'revealInManager'
  | 'openCurrentInFileManager' | 'openCurrentInTerminal' | 'prepareShellCommand' | 'runShellCommand' | 'loadSettings' | 'saveSettings'
>>;

export type LongRunningOperationClient = Pick<TauriClient, 'startCopy' | 'startMove' | 'startDelete' | 'cancelOperation' | 'resolveConflict'>
  & Partial<Pick<TauriClient, 'startTrashUndo' | 'startBulkRename' | 'archiveCreate' | 'archiveExtract' | 'archiveAdd' | 'startRemoteChmod'>>;

export type RemoteSessionClient = Pick<TauriClient,
  | 'remoteConnect' | 'remoteAuthRespond' | 'remoteAuthCancel' | 'remoteTrustHostKey' | 'remoteDisconnect' | 'remoteSessions'
  | 'listenRemoteConnectionChanges'
>;

export const showNativeDropOverlay = () => invoke<void>('show_drop_overlay');

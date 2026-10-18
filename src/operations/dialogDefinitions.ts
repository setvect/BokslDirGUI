// 실행 모드와 작업 종류의 단일 정의. UI·store·Tauri에 의존하지 않음.
export const DIALOG_DEFINITIONS = {
  undoTrash: { executionMode: 'longRunningOperation', operationKind: 'restoreTrash' },
  copy: { executionMode: 'longRunningOperation', operationKind: 'copy' },
  move: { executionMode: 'longRunningOperation', operationKind: 'move' },
  trash: { executionMode: 'longRunningOperation', operationKind: 'trash' },
  deletePermanent: { executionMode: 'longRunningOperation', operationKind: 'delete' },
  bulkRename: { executionMode: 'longRunningOperation', operationKind: 'rename' },
  rename: { executionMode: 'atomicCommand' },
  createDir: { executionMode: 'atomicCommand' },
  properties: { executionMode: 'atomicCommand' },
  archiveCreate: { executionMode: 'longRunningOperation', operationKind: 'archiveCreate' },
  archiveExtract: { executionMode: 'longRunningOperation', operationKind: 'archiveExtract' },
  externalOpenDefault: { executionMode: 'atomicCommand' },
  externalReveal: { executionMode: 'atomicCommand' },
  shellCommand: { executionMode: 'longRunningOperation', operationKind: 'shellCommand' },
} as const;

export type DialogKind = keyof typeof DIALOG_DEFINITIONS;
type KindForMode<M extends string> = {
  [K in DialogKind]: (typeof DIALOG_DEFINITIONS)[K]['executionMode'] extends M ? K : never;
}[DialogKind];
export type AtomicCommandDialogKind = KindForMode<'atomicCommand'>;
export type LongRunningDialogKind = KindForMode<'longRunningOperation'>;
export type DialogExecutionMode = (typeof DIALOG_DEFINITIONS)[DialogKind]['executionMode'] | 'unsupportedPreview';

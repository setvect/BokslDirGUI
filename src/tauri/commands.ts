

export const COMMANDS = {
  getPlatformInfo: 'get_platform_info',
  previewTrashUndo: 'preview_trash_undo',
  startTrashUndo: 'start_trash_undo',
  previewBulkRename: 'preview_bulk_rename',
  startBulkRename: 'start_bulk_rename',
  readFileClipboard: 'read_file_clipboard',
  writeFileClipboard: 'write_file_clipboard',
  clearFileClipboard: 'clear_file_clipboard',
  listDir: 'list_dir',
  getMetadata: 'get_metadata',
  previewFile: 'preview_file',
  watchPath: 'watch_path',
  gotoPath: 'goto_path',
  listLocations: 'list_locations',
  createDir: 'create_dir',
  renameEntry: 'rename_entry',
  startCopy: 'start_copy',
  startMove: 'start_move',
  startDelete: 'start_delete',
  cancelOperation: 'cancel_operation',
  resolveConflict: 'resolve_conflict',
  archiveList: 'archive_list',
  archiveCreate: 'archive_create',
  archiveExtract: 'archive_extract',
  archiveAdd: 'archive_add',
  openDefault: 'open_default',
  listOpenWithApps: 'list_open_with_apps',
  openWithApp: 'open_with_app',
  revealInManager: 'reveal_in_manager',
  openCurrentInFileManager: 'open_current_in_file_manager',
  openCurrentInTerminal: 'open_current_in_terminal',
  prepareShellCommand: 'prepare_shell_command',
  runShellCommand: 'run_shell_command',
  loadSettings: 'load_settings',
  saveSettings: 'save_settings',
} as const;

export type TauriCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

// Rust 이벤트 상수와 같은 이름. 대조는 contract.test.ts 담당.
export const EVENTS = {
  operationProgress: 'operation_progress',
  operationConflict: 'operation_conflict',
  operationSummary: 'operation_summary',
  nativeFileDrop: 'boksldir://native-file-drop',
} as const;

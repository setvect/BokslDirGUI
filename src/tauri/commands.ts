

export const COMMANDS = {
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
  revealInManager: 'reveal_in_manager',
  openExternalEditor: 'open_external_editor',
  prepareShellCommand: 'prepare_shell_command',
  runShellCommand: 'run_shell_command',
  loadSettings: 'load_settings',
  saveSettings: 'save_settings',
} as const;

export type TauriCommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

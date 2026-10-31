import type { DialogKind } from '../operations/dialogDefinitions';
import type { SettingAction } from './settingActions';
import { fileShortcutPlatform, platformSupports, type FileShortcutPlatform, type PlatformFeature } from '../domain/runtimePlatform';
import type { PanelId, PlatformInfo } from '../domain/types';
import { ACTION_LABELS, ACTION_RESULT_LABELS, HOTKEY_LABELS, MENU_SEGMENT_LABELS, type SupportedLanguage } from '../i18n-resources';
import { COMMANDS, type TauriCommandName } from '../tauri/commands';

export type ActionCategory = 'navigation' | 'selection' | 'file' | 'archive' | 'view' | 'panel' | 'settings' | 'help';
export type DangerLevel = 'none' | 'safe' | 'destructive' | 'irreversible';
export type ContextScope = 'file' | 'directory' | 'archive' | 'blank' | 'selection';

export interface ActionContext {
  activePanel: PanelId;
  focusedEntryKind: ContextScope | null;
  selectedCount: number;
  hasConcreteFocus: boolean;
  effectiveTargetCount: number;
  clipboardCount?: number;
  trashUndoAvailable?: boolean;
  clipboardMode?: 'copy' | 'move' | null;
  clipboardCanMove?: boolean;
  platform?: FileShortcutPlatform;
  platformInfo?: PlatformInfo;
  hasOppositePanel: boolean;
  shellCommandEnabled: boolean;
  operationBusy: boolean;
  backendAvailable: boolean;
  activePathIsArchive: boolean;
  /** 활성 패널이 원격(`sftp://`) 경로 */
  activePathIsRemote?: boolean;
  /** 활성 원격 패널의 연결이 살아 있음 */
  activeRemoteConnected?: boolean;
  /** 파일 작업(복사·이동·삭제 등)이 진행 중. 패널 목록 읽기는 제외(`operationBusy`와 달리) */
  fileOperationRunning?: boolean;
}

/** 원격 패널 지원 여부: `localOnly`는 원격 패널에서 비활성, `remoteOnly`는 원격 패널에서만 활성 */
export type RemoteSupport = 'localOnly' | 'remoteOnly';

export interface AppAction {
  id: string;
  category: ActionCategory;
  displayLabel: string;
  hotkeyLabel: string;
  shortcutLabel?: string;
  keyboardBindings?: readonly string[];
  menuPath?: string[];
  contextScopes?: ContextScope[];
  dangerLevel: DangerLevel;
  command?: TauriCommandName;
  runPath: string;
  requiresConcreteSources?: boolean;
  dialogKind?: DialogKind;
  setting?: SettingAction;
  /** 백엔드 PlatformInfo 기능이 있을 때만 표시·실행 */
  platformFeature?: PlatformFeature;
  /** 원격 패널 지원 여부, 없으면 로컬·원격 모두 지원 */
  remoteSupport?: RemoteSupport;
  /** 표시·실행할 단축키 플랫폼, 없으면 모든 플랫폼 */
  shortcutPlatforms?: readonly FileShortcutPlatform[];
  /** macOS 외 플랫폼(Windows·Linux)의 단축키 표기와 실행 키 */
  windowsShortcut?: { label: string; bindings: readonly string[] };
  /** 실행 전에 이름·경로·확인 문구·목록 선택 등을 더 받는 항목: 메뉴에서만 이름 뒤에 `…` 표시 */
  menuEllipsis?: boolean;
  isEnabled(context: ActionContext): boolean;
}

export const platformAllowsAction = (id: string, info?: PlatformInfo) => {
  const feature = ACTION_BY_ID.get(id)?.platformFeature;
  return !feature || !info || info.features[feature];
};

const always = () => true;
const hasFocus = (context: ActionContext) => context.focusedEntryKind !== null;
const hasConcreteFocus = (context: ActionContext) => context.hasConcreteFocus;
const hasEffectiveTarget = (context: ActionContext) => context.effectiveTargetCount > 0;
const canMutate = (context: ActionContext) => context.backendAvailable && !context.operationBusy;
const canMutateFilesystem = (context: ActionContext) => canMutate(context) && !context.activePathIsArchive;
const canInvokeBackend = (context: ActionContext) => context.backendAvailable && !context.operationBusy;

type ActionDefinition = Omit<AppAction, 'displayLabel' | 'hotkeyLabel' | 'isEnabled'> & {
  displayLabel?: string;
  hotkeyLabel?: string;
  isEnabled?: AppAction['isEnabled'];
};

const userFacingActionLabel = (definition: ActionDefinition) => {
  const label = definition.displayLabel ?? definition.menuPath?.at(-1);
  if (!label) {
    throw new Error(`Missing user-facing label for action: ${definition.id}`);
  }
  return label;
};

const action = <T extends ActionDefinition>(definition: T): T & AppAction => {
  const displayLabel = userFacingActionLabel(definition);
  return {
    ...definition,
    displayLabel,
    hotkeyLabel: definition.hotkeyLabel ?? displayLabel,
    isEnabled: definition.isEnabled ?? always,
  };
};

export const ACTIONS = [
  action({ id: 'menu.open', category: 'navigation', displayLabel: 'Menu', hotkeyLabel: 'Menu', shortcutLabel: 'F9', keyboardBindings: ['F9'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'panel.switchActive', category: 'panel', displayLabel: 'Switch Panel', hotkeyLabel: 'Panel', shortcutLabel: 'Tab', keyboardBindings: ['Tab'], menuPath: ['View'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'panel.swapPaths', category: 'panel', displayLabel: 'Swap Panel Paths', shortcutLabel: 'ts', keyboardBindings: ['t s'], menuPath: ['View', 'Swap Panel Paths'], dangerLevel: 'none', runPath: 'UI state', isEnabled: (c) => c.hasOppositePanel && !c.operationBusy }),
  action({ id: 'panel.copyPathToOther', category: 'panel', displayLabel: 'Copy Path to Other Panel', shortcutLabel: 'tp', keyboardBindings: ['t p'], menuPath: ['View', 'Copy Path to Other Panel'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'UI state + list_dir', isEnabled: (c) => c.hasOppositePanel && !c.operationBusy }),
  action({ id: 'panel.compareDirectories', category: 'panel', displayLabel: 'Compare Directories', shortcutLabel: 'tc', keyboardBindings: ['t c'], menuPath: ['View', 'Compare Directories'], dangerLevel: 'none', runPath: 'UI state', isEnabled: (c) => c.hasOppositePanel && !c.operationBusy }),
  action({ id: 'nav.enter', category: 'navigation', displayLabel: 'Open', shortcutLabel: 'Enter/l', keyboardBindings: ['Enter', 'l'], menuPath: ['File', 'Open'], contextScopes: ['file', 'directory', 'archive'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir/open_default', isEnabled: hasFocus }),
  action({ id: 'external.openWith', remoteSupport: 'localOnly', requiresConcreteSources: true, category: 'file', displayLabel: 'Open With', menuEllipsis: true, menuPath: ['File', 'Open With'], contextScopes: ['file', 'archive'], platformFeature: 'openWith', dangerLevel: 'safe', command: COMMANDS.listOpenWithApps, runPath: 'list_open_with_apps/open_with_app', isEnabled: (c) => c.effectiveTargetCount === 1 && (c.focusedEntryKind === 'file' || c.focusedEntryKind === 'archive') && !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'nav.up', category: 'navigation', shortcutLabel: 'Backspace/h', keyboardBindings: ['Backspace', 'h'], menuPath: ['Go', 'Up'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.back', category: 'navigation', shortcutLabel: 'Alt+Left', keyboardBindings: ['Alt+ArrowLeft'], menuPath: ['Go', 'Back'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.forward', category: 'navigation', shortcutLabel: 'Alt+Right', keyboardBindings: ['Alt+ArrowRight'], menuPath: ['Go', 'Forward'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.refresh', category: 'navigation', shortcutLabel: 'Cmd+R', keyboardBindings: ['Cmd+R', 'Ctrl+R'], windowsShortcut: { label: 'Ctrl+R', bindings: ['Ctrl+R'] }, menuPath: ['View', 'Refresh'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.gotoPath', category: 'navigation', shortcutLabel: 'gp', keyboardBindings: ['g p'], menuEllipsis: true, menuPath: ['Go', 'Go To Path'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.gotoPath, runPath: 'goto_path' }),
  action({ id: 'nav.locations', category: 'navigation', shortcutLabel: 'gm', keyboardBindings: ['g m'], menuEllipsis: true, menuPath: ['Go', 'Mount Points'], dangerLevel: 'safe', command: COMMANDS.listLocations, runPath: 'list_locations' }),
  action({ id: 'nav.top', category: 'navigation', displayLabel: 'Go Top', shortcutLabel: 'gg', keyboardBindings: ['g g'], menuPath: ['Go', 'Top'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'nav.bottom', category: 'navigation', displayLabel: 'Go Bottom', shortcutLabel: 'G', keyboardBindings: ['Shift+G'], menuPath: ['Go', 'Bottom'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'tab.new', category: 'panel', shortcutLabel: 'tn', keyboardBindings: ['t n'], menuPath: ['View', 'New Tab'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'tab.close', category: 'panel', shortcutLabel: 'tx', keyboardBindings: ['t x'], menuPath: ['View', 'Close Tab'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'tab.list', category: 'panel', shortcutLabel: 'tt', keyboardBindings: ['t t'], menuEllipsis: true, menuPath: ['View', 'Tab List'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'selection.toggle', category: 'selection', hotkeyLabel: 'Sel', shortcutLabel: 'Space', keyboardBindings: ['Space'], menuPath: ['Edit', 'Select'], dangerLevel: 'none', runPath: 'UI state', isEnabled: hasFocus }),
  action({ id: 'selection.all', category: 'selection', hotkeyLabel: 'SelAll', shortcutLabel: 'Cmd+A', keyboardBindings: ['Cmd+A', 'Ctrl+A'], windowsShortcut: { label: 'Ctrl+A', bindings: ['Ctrl+A'] }, menuPath: ['Edit', 'Select All'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'file.undoTrash', remoteSupport: 'localOnly', dialogKind: 'undoTrash', category: 'file', displayLabel: 'Undo Move to Trash', shortcutLabel: 'Cmd+Z', keyboardBindings: ['Cmd+Z', 'Ctrl+Z'], windowsShortcut: { label: 'Ctrl+Z', bindings: ['Ctrl+Z'] }, menuPath: ['Edit', 'Undo Move to Trash'], dangerLevel: 'safe', command: COMMANDS.startTrashUndo, runPath: 'preview_trash_undo/start_trash_undo', platformFeature: 'trashUndo', isEnabled: (c) => c.trashUndoAvailable === true && canInvokeBackend(c) }),
  action({ id: 'file.clipboardCopy', requiresConcreteSources: true, category: 'file', displayLabel: 'Copy', shortcutLabel: 'Cmd+C', keyboardBindings: ['Cmd+C', 'Ctrl+C'], windowsShortcut: { label: 'Ctrl+C', bindings: ['Ctrl+C'] }, menuPath: ['Edit', 'Copy'], contextScopes: ['selection'], dangerLevel: 'safe', runPath: 'macOS/Windows write_file_clipboard / UI clipboard state', isEnabled: hasEffectiveTarget }),
  action({ id: 'file.clipboardCut', requiresConcreteSources: true, category: 'file', displayLabel: 'Cut', shortcutLabel: 'Ctrl+X', keyboardBindings: ['Ctrl+X'], menuPath: ['Edit', 'Cut'], contextScopes: ['selection'], shortcutPlatforms: ['other'], dangerLevel: 'safe', runPath: 'Windows write_file_clipboard / UI clipboard state', isEnabled: (c) => hasEffectiveTarget(c) && !c.activePathIsArchive && c.backendAvailable }),
  action({ id: 'file.clipboardPaste', category: 'file', displayLabel: 'Paste', shortcutLabel: 'Cmd+V', keyboardBindings: ['Cmd+V', 'Ctrl+V'], windowsShortcut: { label: 'Ctrl+V', bindings: ['Ctrl+V'] }, menuPath: ['Edit', 'Paste'], contextScopes: ['blank'], dangerLevel: 'safe', runPath: 'start_copy/start_move/archive_extract/archive_add', isEnabled: (c) => (c.clipboardCount ?? 0) > 0 && (c.clipboardMode !== 'move' || c.clipboardCanMove === true) && canMutate(c) }),
  action({ id: 'file.clipboardMovePaste', category: 'file', displayLabel: 'Move Here', shortcutLabel: 'Opt+Cmd+V', keyboardBindings: ['Alt+Cmd+V'], menuPath: ['Edit', 'Move Here'], contextScopes: ['blank'], shortcutPlatforms: ['mac'], dangerLevel: 'destructive', command: COMMANDS.startMove, runPath: 'start_move via confirmation dialog', isEnabled: (c) => (c.clipboardCount ?? 0) > 0 && c.clipboardCanMove === true && canMutate(c) }),
  action({ id: 'file.copy', requiresConcreteSources: true, dialogKind: 'copy', category: 'file', displayLabel: 'Copy', shortcutLabel: 'y/F5', keyboardBindings: ['y', 'F5'], menuPath: ['Edit', 'Copy to Other Panel'], contextScopes: ['selection'], dangerLevel: 'safe', command: COMMANDS.startCopy, runPath: 'start_copy', isEnabled: (c) => hasEffectiveTarget(c) && c.hasOppositePanel && canMutate(c) }),
  action({ id: 'file.move', requiresConcreteSources: true, dialogKind: 'move', category: 'file', displayLabel: 'Move', shortcutLabel: 'x/F6', keyboardBindings: ['x', 'F6'], menuPath: ['Edit', 'Move to Other Panel'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startMove, runPath: 'start_move', isEnabled: (c) => hasEffectiveTarget(c) && c.hasOppositePanel && canMutateFilesystem(c) }),
  action({ id: 'file.trash', requiresConcreteSources: true, dialogKind: 'trash', category: 'file', displayLabel: 'Delete', hotkeyLabel: 'Del', shortcutLabel: 'd', keyboardBindings: ['d'], menuPath: ['File', 'Delete'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startDelete, runPath: 'start_delete trash', isEnabled: (c) => hasEffectiveTarget(c) && canMutateFilesystem(c) }),
  action({ id: 'file.deletePermanent', requiresConcreteSources: true, dialogKind: 'deletePermanent', category: 'file', displayLabel: 'Permanent Delete', hotkeyLabel: 'PermDel', shortcutLabel: 'Shift+D/Shift+Delete', keyboardBindings: ['Shift+D', 'Shift+Delete'], menuEllipsis: true, menuPath: ['File', 'Permanent Delete'], contextScopes: ['selection'], dangerLevel: 'irreversible', command: COMMANDS.startDelete, runPath: 'start_delete permanent', isEnabled: (c) => hasEffectiveTarget(c) && canMutateFilesystem(c) }),
  action({ id: 'file.mkdir', dialogKind: 'createDir', category: 'file', displayLabel: 'New Folder', hotkeyLabel: 'MkDir', shortcutLabel: 'a/F7', keyboardBindings: ['a', 'F7'], menuEllipsis: true, menuPath: ['File', 'New Folder'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.createDir, runPath: 'create_dir', isEnabled: canMutateFilesystem }),
  action({ id: 'file.rename', requiresConcreteSources: true, dialogKind: 'rename', category: 'file', displayLabel: 'Rename', hotkeyLabel: 'Ren', shortcutLabel: 'r/F2', keyboardBindings: ['r', 'F2'], menuEllipsis: true, menuPath: ['File', 'Rename'], contextScopes: ['file', 'directory'], dangerLevel: 'destructive', command: COMMANDS.renameEntry, runPath: 'rename_entry', isEnabled: (c) => hasConcreteFocus(c) && c.selectedCount <= 1 && canMutateFilesystem(c) }),
  action({ id: 'file.bulkRename', requiresConcreteSources: true, dialogKind: 'bulkRename', category: 'file', displayLabel: 'Bulk Rename', menuEllipsis: true, menuPath: ['File', 'Bulk Rename'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startBulkRename, runPath: 'preview_bulk_rename/start_bulk_rename', isEnabled: (c) => c.effectiveTargetCount > 0 && canMutateFilesystem(c) }),
  action({ id: 'remote.sites', category: 'navigation', displayLabel: 'Sites', shortcutLabel: 'gr', keyboardBindings: ['g r'], menuEllipsis: true, menuPath: ['Remote', 'Sites'], dangerLevel: 'none', command: COMMANDS.remoteConnect, runPath: 'site list → remote_connect', isEnabled: canInvokeBackend }),
  action({ id: 'remote.connect', category: 'navigation', displayLabel: 'New Connection', menuEllipsis: true, menuPath: ['Remote', 'New Connection'], dangerLevel: 'none', command: COMMANDS.remoteConnect, runPath: 'remote_connect', isEnabled: canInvokeBackend }),
  action({ id: 'remote.disconnect', remoteSupport: 'remoteOnly', category: 'navigation', displayLabel: 'Disconnect', shortcutLabel: 'gd', keyboardBindings: ['g d'], menuPath: ['Remote', 'Disconnect'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.remoteDisconnect, runPath: 'remote_disconnect', isEnabled: (c) => Boolean(c.activeRemoteConnected) && c.backendAvailable && !c.fileOperationRunning }),
  action({ id: 'remote.reconnect', remoteSupport: 'remoteOnly', category: 'navigation', displayLabel: 'Reconnect', menuPath: ['Remote', 'Reconnect'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.remoteConnect, runPath: 'remote_connect', isEnabled: (c) => !c.activeRemoteConnected && canInvokeBackend(c) }),
  action({ id: 'remote.info', remoteSupport: 'remoteOnly', category: 'navigation', displayLabel: 'Connection Info', menuPath: ['Remote', 'Connection Info'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.remoteSessions, runPath: 'remote_sessions' }),
  action({ id: 'remote.chmod', remoteSupport: 'remoteOnly', requiresConcreteSources: true, dialogKind: 'remoteChmod', category: 'file', displayLabel: 'Change Permissions', menuEllipsis: true, menuPath: ['Remote', 'Change Permissions'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startRemoteChmod, runPath: 'start_remote_chmod', isEnabled: (c) => hasEffectiveTarget(c) && canMutate(c) }),
  action({ id: 'app.quit', category: 'file', displayLabel: 'Quit', shortcutLabel: 'Cmd+Q', keyboardBindings: ['Cmd+Q'], windowsShortcut: { label: 'Alt+F4', bindings: ['Alt+F4'] }, menuPath: ['File', 'Quit'], dangerLevel: 'none', runPath: 'getCurrentWindow().close via explicit menu/platform quit shortcut' }),
  action({ id: 'file.properties', requiresConcreteSources: true, dialogKind: 'properties', category: 'file', displayLabel: 'File Info', hotkeyLabel: 'Info', shortcutLabel: 'i', keyboardBindings: ['i'], menuPath: ['View', 'File Info'], contextScopes: ['file', 'directory'], dangerLevel: 'safe', command: COMMANDS.getMetadata, runPath: 'get_metadata', isEnabled: (c) => hasConcreteFocus(c) && canInvokeBackend(c) }),
  action({ id: 'file.quickView', requiresConcreteSources: true, category: 'file', displayLabel: 'Quick View', hotkeyLabel: 'View', shortcutLabel: 'F3', keyboardBindings: ['F3'], menuPath: ['View', 'Quick View'], contextScopes: ['file', 'archive'], dangerLevel: 'safe', command: COMMANDS.previewFile, runPath: 'preview_file', isEnabled: (c) => hasConcreteFocus(c) && !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'archive.list', remoteSupport: 'localOnly', requiresConcreteSources: true, category: 'archive', shortcutLabel: 'Enter', menuPath: ['Archive', 'Open Archive'], contextScopes: ['archive'], dangerLevel: 'safe', command: COMMANDS.archiveList, runPath: 'archive_list virtual-directory', isEnabled: (c) => hasFocus(c) && canInvokeBackend(c) }),
  action({ id: 'archive.extract', remoteSupport: 'localOnly', requiresConcreteSources: true, dialogKind: 'archiveExtract', category: 'archive', displayLabel: 'Archive Extract', shortcutLabel: 'zx', keyboardBindings: ['z x'], menuEllipsis: true, menuPath: ['Archive', 'Archive Extract'], contextScopes: ['archive'], dangerLevel: 'destructive', command: COMMANDS.archiveExtract, runPath: 'archive_extract', isEnabled: (c) => hasFocus(c) && canMutate(c) }),
  action({ id: 'archive.extractAuto', remoteSupport: 'localOnly', requiresConcreteSources: true, dialogKind: 'archiveExtract', category: 'archive', displayLabel: 'Archive Extract Auto', shortcutLabel: 'za', keyboardBindings: ['z a'], menuPath: ['Archive', 'Archive Extract Auto'], contextScopes: ['archive'], dangerLevel: 'destructive', command: COMMANDS.archiveExtract, runPath: 'archive_extract auto', isEnabled: (c) => hasFocus(c) && canMutate(c) }),
  action({ id: 'archive.create', remoteSupport: 'localOnly', requiresConcreteSources: true, dialogKind: 'archiveCreate', category: 'archive', displayLabel: 'Archive Compress', hotkeyLabel: 'Archive', shortcutLabel: 'zc', keyboardBindings: ['z c'], menuEllipsis: true, menuPath: ['Archive', 'Archive Compress'], contextScopes: ['selection'], dangerLevel: 'safe', command: COMMANDS.archiveCreate, runPath: 'archive_create', isEnabled: (c) => hasEffectiveTarget(c) && canMutate(c) }),
  action({ id: 'external.openDefault', requiresConcreteSources: true, dialogKind: 'externalOpenDefault', category: 'file', displayLabel: 'Open Default App', shortcutLabel: 'o', keyboardBindings: ['o'], menuPath: ['File', 'Open Default App'], contextScopes: ['file'], dangerLevel: 'safe', command: COMMANDS.openDefault, runPath: 'open_default', isEnabled: (c) => hasFocus(c) && canInvokeBackend(c) }),
  action({ id: 'external.reveal', remoteSupport: 'localOnly', requiresConcreteSources: true, dialogKind: 'externalReveal', category: 'file', displayLabel: 'Reveal', menuPath: ['File', 'Reveal'], contextScopes: ['file', 'directory'], dangerLevel: 'safe', command: COMMANDS.revealInManager, runPath: 'reveal_in_manager', isEnabled: (c) => hasConcreteFocus(c) && canInvokeBackend(c) }),
  action({ id: 'external.openCurrentInFileManager', remoteSupport: 'localOnly', category: 'navigation', displayLabel: 'Open Current Folder in File Manager', menuPath: ['Go', 'Open Current Folder in File Manager'], contextScopes: ['blank'], platformFeature: 'currentFolderManager', dangerLevel: 'safe', command: COMMANDS.openCurrentInFileManager, runPath: 'open_current_in_file_manager', isEnabled: (c) => !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'external.openCurrentInTerminal', remoteSupport: 'localOnly', category: 'navigation', displayLabel: 'Open Terminal Here', menuPath: ['Go', 'Open Terminal Here'], contextScopes: ['blank'], platformFeature: 'currentFolderTerminal', dangerLevel: 'safe', command: COMMANDS.openCurrentInTerminal, runPath: 'open_current_in_terminal', isEnabled: (c) => !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'view.sortName', category: 'view', shortcutLabel: 'sn', keyboardBindings: ['s n'], menuPath: ['View', 'Sort', 'Name'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortSize', category: 'view', shortcutLabel: 'ss', keyboardBindings: ['s s'], menuPath: ['View', 'Sort', 'Size'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortDate', category: 'view', shortcutLabel: 'sd', keyboardBindings: ['s d'], menuPath: ['View', 'Sort', 'Modified Date'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortExt', category: 'view', shortcutLabel: 'se', keyboardBindings: ['s e'], menuPath: ['View', 'Sort', 'Extension'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.reverseSort', category: 'view', shortcutLabel: 'sr', keyboardBindings: ['s r'], menuPath: ['View', 'Sort', 'Reverse'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortAsc', category: 'view', menuPath: ['View', 'Sort', 'Ascending'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortDesc', category: 'view', menuPath: ['View', 'Sort', 'Descending'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'filter.start', category: 'view', displayLabel: 'Filter', shortcutLabel: '/', keyboardBindings: ['/'], menuEllipsis: true, menuPath: ['View', 'Filter'], contextScopes: ['blank'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'filter.clear', category: 'view', menuPath: ['View', 'Clear Filter'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.toggleHidden', category: 'view', shortcutLabel: '.', keyboardBindings: ['.'], menuPath: ['View', 'Hidden Files'], contextScopes: ['blank'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'selection.invert', category: 'selection', hotkeyLabel: 'InvSel', shortcutLabel: 'v', keyboardBindings: ['v'], menuPath: ['Edit', 'Invert Selection'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'selection.clear', category: 'selection', hotkeyLabel: 'Desel', shortcutLabel: 'u', keyboardBindings: ['u'], menuPath: ['Edit', 'Clear Selection'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.toggleSingleDual', category: 'view', shortcutLabel: 'Ctrl+W', keyboardBindings: ['Ctrl+W'], menuPath: ['View', 'Toggle Layout'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio50', category: 'view', menuPath: ['View', 'Panel Ratio', '50:50'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio70Left', category: 'view', menuPath: ['View', 'Panel Ratio', '70:30'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio70Right', category: 'view', menuPath: ['View', 'Panel Ratio', '30:70'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'history.list', category: 'navigation', shortcutLabel: 'th', keyboardBindings: ['t h'], menuEllipsis: true, menuPath: ['Go', 'History List'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'bookmark.add', category: 'navigation', shortcutLabel: 'Cmd+B', keyboardBindings: ['Cmd+B', 'Ctrl+B'], windowsShortcut: { label: 'Ctrl+B', bindings: ['Ctrl+B'] }, menuPath: ['Go', 'Bookmark Add'], dangerLevel: 'safe', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'bookmark.list', category: 'navigation', shortcutLabel: 'tb', keyboardBindings: ['t b'], menuEllipsis: true, menuPath: ['Go', 'Bookmark List'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'bookmark.rename', category: 'navigation', displayLabel: 'Rename Bookmark', menuEllipsis: true, menuPath: ['Go', 'Bookmark Rename'], dangerLevel: 'safe', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'bookmark.delete', category: 'navigation', displayLabel: 'Delete Bookmark', dangerLevel: 'destructive', command: COMMANDS.saveSettings, runPath: 'bookmark list → save_settings' }),
  action({ id: 'settings.themeDark', setting: { kind: 'theme', value: 'dark' }, category: 'settings', menuPath: ['Settings', 'Theme', 'Dark'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.themeLight', setting: { kind: 'theme', value: 'light' }, category: 'settings', menuPath: ['Settings', 'Theme', 'Light'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.themeHighContrast', setting: { kind: 'theme', value: 'highContrast' }, category: 'settings', menuPath: ['Settings', 'Theme', 'High Contrast'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.themeMdir', setting: { kind: 'theme', value: 'mdir' }, category: 'settings', menuPath: ['Settings', 'Theme', 'Mdir'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.languageEn', setting: { kind: 'language', value: 'en' }, category: 'settings', menuPath: ['Settings', 'Language', 'English'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.languageKo', setting: { kind: 'language', value: 'ko' }, category: 'settings', menuPath: ['Settings', 'Language', 'Korean'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.toggleIcons', setting: { kind: 'showIcons' }, category: 'settings', displayLabel: 'Show File Icons', menuPath: ['Settings', 'Show File Icons'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.sizeAuto', setting: { kind: 'sizeFormat', value: 'binary' }, category: 'settings', menuPath: ['Settings', 'File Size Format', 'Auto'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.sizeBytes', setting: { kind: 'sizeFormat', value: 'decimal' }, category: 'settings', menuPath: ['Settings', 'File Size Format', 'Bytes'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.remoteLinksPreserve', setting: { kind: 'remoteLinkPolicy', value: 'preserve' }, category: 'settings', menuPath: ['Settings', 'Remote Links', 'Preserve Links'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.remoteLinksFollow', setting: { kind: 'remoteLinkPolicy', value: 'follow' }, category: 'settings', menuPath: ['Settings', 'Remote Links', 'Copy Link Targets'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.remoteLinksSkip', setting: { kind: 'remoteLinkPolicy', value: 'skip' }, category: 'settings', menuPath: ['Settings', 'Remote Links', 'Skip Links'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'external.runShellCommand', remoteSupport: 'localOnly', dialogKind: 'shellCommand', category: 'file', displayLabel: 'Shell Command', shortcutLabel: ':', keyboardBindings: [':'], menuEllipsis: true, menuPath: ['File', 'Run Shell Command'], dangerLevel: 'destructive', command: COMMANDS.runShellCommand, runPath: 'ShellCommandDialog → prepare_shell_command → run_shell_command', isEnabled: (c) => c.shellCommandEnabled && canMutate(c) }),
  action({ id: 'help.shortcuts', category: 'help', displayLabel: 'Keyboard Help', hotkeyLabel: 'Keys', shortcutLabel: '?', keyboardBindings: ['?'], menuPath: ['Help', 'Keyboard Help'], dangerLevel: 'none', runPath: 'dialog' }),
  action({ id: 'help.search', category: 'help', menuEllipsis: true, menuPath: ['Help', 'Search Commands'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'help.about', category: 'help', menuPath: ['Help', 'About BokslDir'], dangerLevel: 'none', runPath: 'dialog' }),
] as const satisfies readonly AppAction[];

export type ActionId = (typeof ACTIONS)[number]['id'];

export const ACTION_BY_ID: ReadonlyMap<ActionId, AppAction> = new Map(ACTIONS.map((item) => [item.id, item]));

export const getAction = (id: ActionId) => {
  const found = ACTION_BY_ID.get(id);
  if (!found) {
    throw new Error(`Unknown action: ${id}`);
  }
  return found;
};

const HOTKEY_STRIP_ACTION_IDS: readonly ActionId[] = [
  'panel.switchActive',
  'nav.enter',
  'selection.toggle',
  'file.copy',
  'file.move',
  'file.mkdir',
  'file.trash',
  'file.rename',
  'filter.start',
  'help.shortcuts',
  'file.properties',
  'file.quickView',
  'nav.refresh',
  'nav.up',
  'selection.invert',
  'selection.all',
  'selection.clear',
  'view.toggleHidden',
  'view.sortName',
  'view.sortDate',
  'archive.create',
  'archive.extract',
  'archive.extractAuto',
  'file.deletePermanent',
  'external.openDefault',
  'tab.new',
  'tab.close',
  'tab.list',
  'bookmark.list',
  'history.list',
  'layout.toggleSingleDual',
  'external.runShellCommand',
];

export const hotkeyStripActionsFromRegistry = () => HOTKEY_STRIP_ACTION_IDS.map(getAction);

const MENU_ROOT_DEFINITIONS = [
  { root: 'File', accelerator: 'F' },
  { root: 'Edit', accelerator: 'E' },
  { root: 'View', accelerator: 'V' },
  { root: 'Go', accelerator: 'G' },
  { root: 'Remote', accelerator: 'R' },
  { root: 'Archive', accelerator: 'A' },
  { root: 'Tools', accelerator: 'T' },
  { root: 'Settings', accelerator: 'S' },
  { root: 'Help', accelerator: 'H' },
] as const;
const MENU_ROOT_ORDER = MENU_ROOT_DEFINITIONS.map(({ root }) => root);
const MENU_ROOT_ORDER_SET = new Set<string>(MENU_ROOT_ORDER);
const MENU_ROOT_ACCELERATORS: ReadonlyMap<string, string> = new Map(MENU_ROOT_DEFINITIONS.map(({ root, accelerator }) => [root, accelerator]));

export const menuRootsFromRegistry = () => {
  const roots = new Set(ACTIONS.map((item) => item.menuPath?.[0]).filter((root): root is string => Boolean(root)));
  return [
    ...MENU_ROOT_ORDER.filter((root) => roots.has(root)),
    ...[...roots].filter((root) => !MENU_ROOT_ORDER_SET.has(root)),
  ];
};

export const actionMatchesContextScope = (action: AppAction, context: ActionContext) => {
  if (!action.contextScopes?.length) {
    return true;
  }
  return action.contextScopes.some((scope) => {
    if (scope === 'selection') {
      return context.effectiveTargetCount > 0;
    }
    if (scope === 'blank') {
      return true;
    }
    return context.focusedEntryKind === scope;
  });
};

export const actionAllowedForLocation = (action: AppAction, context: Pick<ActionContext, 'activePathIsRemote'>) =>
  action.remoteSupport === 'localOnly' ? !context.activePathIsRemote
    : action.remoteSupport === 'remoteOnly' ? Boolean(context.activePathIsRemote) : true;

export const isActionAvailable = (action: AppAction, context: ActionContext) =>
  actionVisibleOnPlatform(action, context.platform, context.platformInfo)
  && actionAllowedForLocation(action, context)
  && action.isEnabled(context) && actionMatchesContextScope(action, context);

export const menuSegmentLabel = (segment: string, language: SupportedLanguage = 'en') =>
  MENU_SEGMENT_LABELS[language][segment] ?? segment;

export const menuPathSegmentsForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  action.menuPath?.map((segment) => menuSegmentLabel(segment, language));

export const labelForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  ACTION_LABELS[language][action.id] ?? menuSegmentLabel(action.displayLabel, language);

/** 완료 문장에 쓰는 동작 이름("새 폴더 완료" 대신 "폴더 만들기 완료") */
export const resultLabelForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  ACTION_RESULT_LABELS[language][action.id] ?? labelForAction(action, language);

export const hotkeyLabelForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  HOTKEY_LABELS[language][action.id] ?? action.hotkeyLabel;

export const actionVisibleOnPlatform = (action: AppAction, platform = fileShortcutPlatform(), info?: PlatformInfo) =>
  (!action.shortcutPlatforms || action.shortcutPlatforms.includes(platform))
  && (!action.platformFeature || platformSupports(action.platformFeature, info, platform));

/**
 * 메뉴별 표시 순서와 묶음(묶음 사이 구분선). 액션 정의 순서는 도움말·문서에 쓰이므로 메뉴 배치는 여기서만 정함.
 * 메뉴 경로가 있는 액션은 모두 자기 메뉴의 묶음에 한 번씩 들어감(registry 시험으로 확인).
 */
export const MENU_LAYOUT: Readonly<Record<string, readonly (readonly ActionId[])[]>> = {
  File: [
    ['nav.enter', 'external.openDefault', 'external.openWith', 'external.reveal'],
    ['file.mkdir', 'file.rename', 'file.bulkRename'],
    ['file.trash', 'file.deletePermanent'],
    ['external.runShellCommand'],
    ['app.quit'],
  ],
  Edit: [
    ['file.undoTrash'],
    ['file.clipboardCut', 'file.clipboardCopy', 'file.clipboardPaste', 'file.clipboardMovePaste'],
    ['file.copy', 'file.move'],
    ['selection.toggle', 'selection.all', 'selection.invert', 'selection.clear'],
  ],
  View: [
    ['panel.switchActive', 'panel.swapPaths', 'panel.copyPathToOther', 'panel.compareDirectories'],
    ['tab.new', 'tab.close', 'tab.list'],
    ['view.sortName', 'view.sortSize', 'view.sortDate', 'view.sortExt', 'view.reverseSort', 'view.sortAsc', 'view.sortDesc', 'filter.start', 'filter.clear', 'view.toggleHidden'],
    ['file.properties', 'file.quickView'],
    ['layout.toggleSingleDual', 'layout.ratio50', 'layout.ratio70Left', 'layout.ratio70Right'],
    ['nav.refresh'],
  ],
  Go: [
    ['nav.up', 'nav.back', 'nav.forward', 'nav.top', 'nav.bottom'],
    ['nav.gotoPath', 'nav.locations', 'history.list'],
    ['bookmark.add', 'bookmark.list', 'bookmark.rename'],
    ['external.openCurrentInFileManager', 'external.openCurrentInTerminal'],
  ],
  Remote: [
    ['remote.sites', 'remote.connect'],
    ['remote.info', 'remote.reconnect', 'remote.disconnect'],
    ['remote.chmod'],
  ],
  Archive: [
    ['archive.list'],
    ['archive.extract', 'archive.extractAuto', 'archive.create'],
  ],
  Settings: [
    [
      'settings.themeDark', 'settings.themeLight', 'settings.themeHighContrast', 'settings.themeMdir',
      'settings.languageEn', 'settings.languageKo', 'settings.sizeAuto', 'settings.sizeBytes',
      'settings.remoteLinksPreserve', 'settings.remoteLinksFollow', 'settings.remoteLinksSkip',
    ],
    ['settings.toggleIcons'],
  ],
  Help: [
    ['help.shortcuts', 'help.search'],
    ['help.about'],
  ],
};

const MENU_GROUP_BY_ACTION: ReadonlyMap<string, number> = new Map(
  Object.values(MENU_LAYOUT).flatMap((groups) => groups.flatMap((group, index) => group.map((id) => [id, index] as const))),
);

/** 메뉴 안 묶음 번호. 번호가 바뀌는 자리에 구분선 */
export const menuGroupIndexForAction = (action: AppAction) => MENU_GROUP_BY_ACTION.get(action.id) ?? Number.MAX_SAFE_INTEGER;

export const actionsForMenu = (menuRoot: string, platform = fileShortcutPlatform(), info?: PlatformInfo) => {
  const ordered = (MENU_LAYOUT[menuRoot] ?? []).flat().map((id) => getAction(id));
  // 배치 표에 없는 메뉴 액션은 끝에(registry 시험이 누락을 막음)
  const unplaced = ACTIONS.filter((item) => item.menuPath?.[0] === menuRoot && !MENU_GROUP_BY_ACTION.has(item.id));
  return [...ordered, ...unplaced].filter((item) => item.menuPath?.[0] === menuRoot && actionVisibleOnPlatform(item, platform, info));
};

/** 메뉴 항목 이름: 입력을 더 받는 항목만 `…`를 붙임(상태 줄·도움말 이름에는 붙이지 않음) */
export const menuItemLabel = (action: AppAction, label: string) => (action.menuEllipsis ? `${label}…` : label);

export const menuRootLabelFromRegistry = (root: string, language: SupportedLanguage = 'en') => {
  const accelerator = MENU_ROOT_ACCELERATORS.get(root);
  const label = menuSegmentLabel(root, language);
  return accelerator ? `${label}(${accelerator})` : label;
};

export const menuRootAcceleratorFromRegistry = (root: string) =>
  MENU_ROOT_ACCELERATORS.get(root) ?? null;

// 플랫폼별 표기와 실행 키는 액션의 windowsShortcut 한곳에서 함께 결정.
export const keyboardBindingsForAction = (action: AppAction, platform = fileShortcutPlatform()): readonly string[] => {
  if (platform === 'other') {
    return action.windowsShortcut?.bindings
      ?? (action.keyboardBindings ?? []).filter(binding => !binding.includes('Cmd+'));
  }
  return action.keyboardBindings ?? [];
};

const platformShortcutLabel = (action: AppAction, platform = fileShortcutPlatform()) => {
  if (platform === 'other') {
    if (action.shortcutPlatforms && !action.shortcutPlatforms.includes('other')) return '';
    return action.windowsShortcut?.label ?? action.shortcutLabel;
  }
  return action.shortcutLabel;
};

export const shortcutLabelForAction = (action: AppAction, platform = fileShortcutPlatform()) => {
  const label = platformShortcutLabel(action, platform);
  return label
    ? (label === '/' ? '/' : label.split('/')[0])
    : keyboardBindingsForAction(action, platform)[0]?.replace(/\s+/g, '') ?? '·';
};

export const shortcutHelpLabelForAction = (action: AppAction, platform = fileShortcutPlatform()) =>
  platformShortcutLabel(action, platform)
  ?? keyboardBindingsForAction(action, platform).map((binding) => binding.replace(/\s+/g, '')).join('/')
  ?? '';

export type KeyboardShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'
>;

export type KeyboardShortcutMatch =
  | { status: 'matched'; action: AppAction; sequence: readonly string[] }
  | { status: 'pending'; action: AppAction | null; sequence: readonly string[] }
  | { status: 'none'; action: null; sequence: readonly string[] };

export const matchKeyboardShortcut = (
  event: KeyboardShortcutEvent,
  previousSequence: readonly string[] = [],
  platform = fileShortcutPlatform(),
): KeyboardShortcutMatch => {
  const keyToken = eventToBindingToken(event);
  const withPrevious = matchKeyboardSequence([...previousSequence, keyToken], platform);
  if (withPrevious.status !== 'none') {
    return withPrevious;
  }
  if (previousSequence.length > 0) {
    return matchKeyboardSequence([keyToken], platform);
  }
  return { status: 'none', action: null, sequence: [] };
};

export const actionForKeyboardShortcut = (
  event: KeyboardShortcutEvent,
  previousSequence: readonly string[] = [],
  platform = fileShortcutPlatform(),
) => {
  const match = matchKeyboardShortcut(event, previousSequence, platform);
  return match.status === 'matched' ? match.action : null;
};

export const ariaKeyShortcutsFromRegistry = (platform = fileShortcutPlatform()) =>
  [...new Set(ACTIONS.flatMap((action) => keyboardBindingsForAction(action, platform)).filter((binding) => !binding.includes(' ')))]
    .map(toAriaKeyShortcut)
    .join(' ');

export const keyboardBindingCollisions = (platform = fileShortcutPlatform()) => {
  const bindingsByToken = new Map<string, AppAction[]>();
  for (const action of ACTIONS) {
    for (const binding of keyboardBindingsForAction(action, platform)) {
      const normalized = bindingToTokens(binding).join(' ');
      bindingsByToken.set(normalized, [...(bindingsByToken.get(normalized) ?? []), action]);
    }
  }
  return [...bindingsByToken.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([binding, actions]) => ({ binding, actionIds: actions.map((action) => action.id) }));
};

const matchKeyboardSequence = (sequence: readonly string[], platform: FileShortcutPlatform): KeyboardShortcutMatch => {
  const normalizedSequence = sequence.map(normalizeBindingToken);
  const exact = ACTIONS.find((action) =>
    keyboardBindingsForAction(action, platform).some((binding) => bindingToTokens(binding).every((token, index) =>
      token === normalizedSequence[index],
    ) && bindingToTokens(binding).length === normalizedSequence.length),
  );
  const hasLongerCandidate = ACTIONS.some((action) =>
    keyboardBindingsForAction(action, platform).some((binding) => {
      const tokens = bindingToTokens(binding);
      return tokens.length > normalizedSequence.length && normalizedSequence.every((token, index) => token === tokens[index]);
    }),
  );

  if (hasLongerCandidate) {
    return { status: 'pending', action: exact ?? null, sequence: normalizedSequence };
  }
  if (exact) {
    return { status: 'matched', action: exact, sequence: normalizedSequence };
  }
  return { status: 'none', action: null, sequence: [] };
};

const bindingToTokens = (binding: string) =>
  binding.split(/\s+/).map(normalizeBindingToken).filter(Boolean);

const eventToBindingToken = (event: KeyboardShortcutEvent) => {
  const physicalKey = keyForPhysicalShortcut(event);
  const key = normalizeEventKey(physicalKey);
  const modifiers = [
    event.altKey ? 'Alt' : null,
    event.ctrlKey ? 'Ctrl' : null,
    event.metaKey ? 'Cmd' : null,
    event.shiftKey && shouldKeepShiftModifier(physicalKey) ? 'Shift' : null,
  ].filter(Boolean);
  return [...modifiers, key].join('+');
};

const keyForPhysicalShortcut = (event: KeyboardShortcutEvent) => {
  const code = typeof event.code === 'string' ? event.code : '';
  if (event.key.length === 1 && /^Key[A-Z]$/.test(code)) {
    return code.slice(3);
  }
  return event.key;
};

const shouldKeepShiftModifier = (key: string) => key.length > 1 || /^[A-Z]$/.test(key);

const normalizeEventKey = (key: string) => {
  const aliases: Record<string, string> = {
    ' ': 'Space',
    Spacebar: 'Space',
    Left: 'ArrowLeft',
    Right: 'ArrowRight',
    Up: 'ArrowUp',
    Down: 'ArrowDown',
    Del: 'Delete',
    Esc: 'Escape',
  };
  return aliases[key] ?? (key.length === 1 && /^[a-z]$/i.test(key) ? key.toUpperCase() : key);
};

const normalizeBindingToken = (token: string) =>
  token
    .split('+')
    .map((part) => {
      const normalized = normalizeEventKey(part.trim());
      return normalized.length === 1 && /^[a-z]$/i.test(normalized) ? normalized.toUpperCase() : normalized;
    })
    .join('+');

const toAriaKeyShortcut = (binding: string) =>
  binding
    .split('+')
    .map((part) => {
      if (part === 'Ctrl') {
        return 'Control';
      }
      if (part === 'Cmd') {
        return 'Meta';
      }
      return part;
    })
    .join('+');

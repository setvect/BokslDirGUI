import type { PanelId } from '../domain/types';
import { COMMANDS, type TauriCommandName } from '../tauri/client';

export type ActionCategory = 'navigation' | 'selection' | 'file' | 'archive' | 'view' | 'panel' | 'settings' | 'help';
export type DangerLevel = 'none' | 'safe' | 'destructive' | 'irreversible';
export type ContextScope = 'file' | 'directory' | 'archive' | 'blank' | 'selection';

export interface ActionContext {
  activePanel: PanelId;
  focusedEntryKind: ContextScope | null;
  selectedCount: number;
  hasOppositePanel: boolean;
  shellCommandEnabled: boolean;
  operationBusy: boolean;
}

export interface AppAction {
  id: string;
  category: ActionCategory;
  labelKey: string;
  descriptionKey: string;
  displayLabel: string;
  hotkeyLabel: string;
  defaultShortcut?: string;
  menuPath?: string[];
  contextScopes?: ContextScope[];
  dangerLevel: DangerLevel;
  command?: TauriCommandName;
  runPath: string;
  isEnabled(context: ActionContext): boolean;
}

const always = () => true;
const hasFocus = (context: ActionContext) => context.focusedEntryKind !== null;
const hasSelection = (context: ActionContext) => context.selectedCount > 0;
const canMutate = (context: ActionContext) => !context.operationBusy;

type ActionDefinition = Omit<AppAction, 'labelKey' | 'descriptionKey' | 'displayLabel' | 'hotkeyLabel' | 'isEnabled'> & {
  displayLabel?: string;
  hotkeyLabel?: string;
  isEnabled?: AppAction['isEnabled'];
};

const action = <T extends ActionDefinition>(definition: T): T & AppAction => ({
  ...definition,
  labelKey: `actions.${definition.id}.label`,
  descriptionKey: `actions.${definition.id}.description`,
  displayLabel: definition.displayLabel ?? definition.menuPath?.at(-1) ?? definition.id,
  hotkeyLabel: definition.hotkeyLabel ?? definition.displayLabel ?? definition.menuPath?.at(-1) ?? definition.id,
  isEnabled: definition.isEnabled ?? always,
});

export const ACTIONS = [
  action({ id: 'panel.switchActive', category: 'panel', defaultShortcut: 'Tab', menuPath: ['View'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'nav.enter', category: 'navigation', displayLabel: 'Open', defaultShortcut: 'Enter/l', menuPath: ['File', 'Open'], contextScopes: ['file', 'directory', 'archive'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir/open_default', isEnabled: hasFocus }),
  action({ id: 'nav.up', category: 'navigation', defaultShortcut: 'Backspace/h', menuPath: ['Go', 'Up'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.back', category: 'navigation', defaultShortcut: 'Alt+Left', menuPath: ['Go', 'Back'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.forward', category: 'navigation', defaultShortcut: 'Alt+Right', menuPath: ['Go', 'Forward'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.refresh', category: 'navigation', defaultShortcut: 'Ctrl+R', menuPath: ['View', 'Refresh'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.gotoPath', category: 'navigation', defaultShortcut: 'gp', menuPath: ['Go', 'Path'], dangerLevel: 'safe', command: COMMANDS.gotoPath, runPath: 'goto_path' }),
  action({ id: 'nav.locations', category: 'navigation', defaultShortcut: 'gm', menuPath: ['Go', 'Locations'], dangerLevel: 'safe', command: COMMANDS.listLocations, runPath: 'list_locations' }),
  action({ id: 'tab.new', category: 'panel', defaultShortcut: 'tn', menuPath: ['View', 'New Tab'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'tab.close', category: 'panel', defaultShortcut: 'tx', menuPath: ['View', 'Close Tab'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'selection.toggle', category: 'selection', hotkeyLabel: 'Sel', defaultShortcut: 'Space', menuPath: ['Edit', 'Select'], dangerLevel: 'none', runPath: 'UI state', isEnabled: hasFocus }),
  action({ id: 'selection.all', category: 'selection', hotkeyLabel: 'SelAll', defaultShortcut: 'Ctrl+A', menuPath: ['Edit', 'Select All'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'file.copy', category: 'file', displayLabel: 'Copy', defaultShortcut: 'y/F5', menuPath: ['File', 'Copy'], contextScopes: ['selection'], dangerLevel: 'safe', command: COMMANDS.startCopy, runPath: 'start_copy', isEnabled: (c) => hasSelection(c) && c.hasOppositePanel && canMutate(c) }),
  action({ id: 'file.move', category: 'file', displayLabel: 'Move', defaultShortcut: 'x/F6', menuPath: ['File', 'Move'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startMove, runPath: 'start_move', isEnabled: (c) => hasSelection(c) && c.hasOppositePanel && canMutate(c) }),
  action({ id: 'file.trash', category: 'file', hotkeyLabel: 'Del', defaultShortcut: 'd', menuPath: ['File', 'Move to Trash'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startDelete, runPath: 'start_delete trash', isEnabled: (c) => hasSelection(c) && canMutate(c) }),
  action({ id: 'file.deletePermanent', category: 'file', displayLabel: 'Permanent Delete', hotkeyLabel: 'PermDel', defaultShortcut: 'D/Shift+Delete', menuPath: ['File', 'Delete Permanently'], contextScopes: ['selection'], dangerLevel: 'irreversible', command: COMMANDS.startDelete, runPath: 'start_delete permanent', isEnabled: (c) => hasSelection(c) && canMutate(c) }),
  action({ id: 'file.mkdir', category: 'file', displayLabel: 'New Folder', hotkeyLabel: 'MkDir', defaultShortcut: 'a/F7', menuPath: ['File', 'New Folder'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.createDir, runPath: 'create_dir', isEnabled: canMutate }),
  action({ id: 'file.rename', category: 'file', displayLabel: 'Rename', hotkeyLabel: 'Ren', defaultShortcut: 'r/F2', menuPath: ['File', 'Rename'], contextScopes: ['file', 'directory'], dangerLevel: 'destructive', command: COMMANDS.renameEntry, runPath: 'rename_entry', isEnabled: (c) => c.selectedCount === 1 && canMutate(c) }),
  action({ id: 'file.properties', category: 'file', displayLabel: 'Properties', hotkeyLabel: 'Info', defaultShortcut: 'i', menuPath: ['File', 'Properties'], contextScopes: ['file', 'directory'], dangerLevel: 'safe', command: COMMANDS.getMetadata, runPath: 'get_metadata', isEnabled: hasFocus }),
  action({ id: 'archive.preview', category: 'archive', displayLabel: 'Preview', defaultShortcut: 'Enter on archive', menuPath: ['Archive', 'Preview'], contextScopes: ['archive'], dangerLevel: 'safe', command: COMMANDS.archiveList, runPath: 'archive_list', isEnabled: hasFocus }),
  action({ id: 'archive.list', category: 'archive', defaultShortcut: 'Enter on archive', menuPath: ['Archive', 'Open Archive'], contextScopes: ['archive'], dangerLevel: 'safe', command: COMMANDS.archiveList, runPath: 'archive_list', isEnabled: hasFocus }),
  action({ id: 'archive.extract', category: 'archive', displayLabel: 'Extract', defaultShortcut: 'zx', menuPath: ['Archive', 'Extract'], contextScopes: ['archive'], dangerLevel: 'destructive', command: COMMANDS.archiveExtract, runPath: 'archive_extract', isEnabled: (c) => hasFocus(c) && canMutate(c) }),
  action({ id: 'archive.create', category: 'archive', displayLabel: 'Create Archive', hotkeyLabel: 'Archive', defaultShortcut: 'zc', menuPath: ['Archive', 'Create'], contextScopes: ['selection'], dangerLevel: 'safe', command: COMMANDS.archiveCreate, runPath: 'archive_create', isEnabled: (c) => hasSelection(c) && canMutate(c) }),
  action({ id: 'external.openDefault', category: 'file', displayLabel: 'Open Default', defaultShortcut: 'o', menuPath: ['File', 'Open Default'], contextScopes: ['file'], dangerLevel: 'safe', command: COMMANDS.openDefault, runPath: 'open_default', isEnabled: hasFocus }),
  action({ id: 'external.reveal', category: 'file', displayLabel: 'Reveal', menuPath: ['File', 'Reveal'], contextScopes: ['file', 'directory'], dangerLevel: 'safe', command: COMMANDS.revealInManager, runPath: 'reveal_in_manager', isEnabled: hasFocus }),
  action({ id: 'external.openEditor', category: 'file', displayLabel: 'Open Editor', defaultShortcut: 'e', menuPath: ['File', 'Open in External Editor'], contextScopes: ['file'], dangerLevel: 'safe', command: COMMANDS.openExternalEditor, runPath: 'open_external_editor', isEnabled: hasFocus }),
  action({ id: 'view.sortName', category: 'view', defaultShortcut: 'sn', menuPath: ['View', 'Sort', 'Name'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortSize', category: 'view', defaultShortcut: 'ss', menuPath: ['View', 'Sort', 'Size'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortDate', category: 'view', defaultShortcut: 'sd', menuPath: ['View', 'Sort', 'Modified Date'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortExt', category: 'view', defaultShortcut: 'se', menuPath: ['View', 'Sort', 'Extension'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.reverseSort', category: 'view', defaultShortcut: 'sr', menuPath: ['View', 'Sort', 'Reverse'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'filter.start', category: 'view', displayLabel: 'Filter', defaultShortcut: '/', menuPath: ['View', 'Filter'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'filter.clear', category: 'view', defaultShortcut: 'Esc in filter', menuPath: ['View', 'Clear Filter'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.toggleHidden', category: 'view', defaultShortcut: '.', menuPath: ['View', 'Hidden Files'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'selection.invert', category: 'selection', hotkeyLabel: 'InvSel', defaultShortcut: 'v', menuPath: ['Edit', 'Invert Selection'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'selection.clear', category: 'selection', hotkeyLabel: 'Desel', defaultShortcut: 'u', menuPath: ['Edit', 'Clear Selection'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.toggleSingleDual', category: 'view', menuPath: ['View', 'Single-Dual Panel'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio50', category: 'view', menuPath: ['View', 'Panel Ratio', '50:50'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio70Left', category: 'view', menuPath: ['View', 'Panel Ratio', '70:30'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio70Right', category: 'view', menuPath: ['View', 'Panel Ratio', '30:70'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'history.list', category: 'navigation', defaultShortcut: 'th', menuPath: ['Go', 'History'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'bookmark.add', category: 'navigation', defaultShortcut: 'tb+a', menuPath: ['Go', 'Bookmark', 'Add'], dangerLevel: 'safe', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'bookmark.list', category: 'navigation', defaultShortcut: 'tb', menuPath: ['Go', 'Bookmarks'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'bookmark.rename', category: 'navigation', menuPath: ['Go', 'Bookmark', 'Rename'], dangerLevel: 'safe', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'bookmark.delete', category: 'navigation', menuPath: ['Go', 'Bookmark', 'Delete'], dangerLevel: 'destructive', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.theme', category: 'settings', menuPath: ['Settings', 'Theme'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.language', category: 'settings', menuPath: ['Settings', 'Language'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.sizeFormat', category: 'settings', menuPath: ['Settings', 'File Size Format'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'external.runShellCommand', category: 'file', displayLabel: 'Shell Command', defaultShortcut: ':', menuPath: ['Tools', 'Run Shell Command'], dangerLevel: 'destructive', command: COMMANDS.prepareShellCommand, runPath: 'ShellCommandDialog → prepare_shell_command → run_shell_command', isEnabled: (c) => c.shellCommandEnabled && canMutate(c) }),
  action({ id: 'help.shortcuts', category: 'help', displayLabel: 'Shortcuts', hotkeyLabel: 'Keys', defaultShortcut: '?', menuPath: ['Help', 'Shortcuts'], dangerLevel: 'none', runPath: 'dialog' }),
  action({ id: 'help.search', category: 'help', menuPath: ['Help', 'Search'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'help.about', category: 'help', menuPath: ['Help', 'About'], dangerLevel: 'none', runPath: 'dialog' }),
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
  'file.copy',
  'file.move',
  'file.trash',
  'file.mkdir',
  'file.rename',
  'file.properties',
  'help.shortcuts',
  'filter.start',
  'selection.toggle',
  'selection.invert',
  'selection.all',
  'selection.clear',
  'file.deletePermanent',
];

export const hotkeyStripActionsFromRegistry = () => HOTKEY_STRIP_ACTION_IDS.map(getAction);

const MENU_ROOT_ORDER = ['File', 'Edit', 'View', 'Go', 'Archive', 'Tools', 'Settings', 'Help'];

export const menuRootsFromRegistry = () => {
  const roots = new Set(ACTIONS.map((item) => item.menuPath?.[0]).filter((root): root is string => Boolean(root)));
  return [
    ...MENU_ROOT_ORDER.filter((root) => roots.has(root)),
    ...[...roots].filter((root) => !MENU_ROOT_ORDER.includes(root)),
  ];
};

export const actionMatchesContextScope = (action: AppAction, context: ActionContext) => {
  if (!action.contextScopes?.length) {
    return true;
  }
  return action.contextScopes.some((scope) => {
    if (scope === 'selection') {
      return context.selectedCount > 0;
    }
    if (scope === 'blank') {
      return true;
    }
    return context.focusedEntryKind === scope;
  });
};

export const isActionAvailable = (action: AppAction, context: ActionContext) =>
  action.isEnabled(context) && actionMatchesContextScope(action, context);

export const labelForAction = (action: AppAction) => action.displayLabel;

export const actionsForMenu = (menuRoot: string) =>
  ACTIONS.filter((item) => item.menuPath?.[0] === menuRoot);

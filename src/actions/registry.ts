import type { PanelId } from '../domain/types';
import { ACTION_LABELS, HOTKEY_LABELS, MENU_SEGMENT_LABELS, type SupportedLanguage } from '../i18n-resources';
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
  clipboardMode?: 'copy' | 'move' | null;
  clipboardCanMove?: boolean;
  platform?: 'mac' | 'other';
  hasOppositePanel: boolean;
  shellCommandEnabled: boolean;
  operationBusy: boolean;
  backendAvailable: boolean;
  activePathIsArchive: boolean;
}

export interface AppAction {
  id: string;
  category: ActionCategory;
  labelKey: string;
  descriptionKey: string;
  displayLabel: string;
  hotkeyLabel: string;
  shortcutLabel?: string;
  keyboardBindings?: readonly string[];
  menuPath?: string[];
  contextScopes?: ContextScope[];
  dangerLevel: DangerLevel;
  command?: TauriCommandName;
  runPath: string;
  isEnabled(context: ActionContext): boolean;
}

const always = () => true;
const hasFocus = (context: ActionContext) => context.focusedEntryKind !== null;
const hasConcreteFocus = (context: ActionContext) => context.hasConcreteFocus;
const hasEffectiveTarget = (context: ActionContext) => context.effectiveTargetCount > 0;
const canMutate = (context: ActionContext) => context.backendAvailable && !context.operationBusy;
const canMutateFilesystem = (context: ActionContext) => canMutate(context) && !context.activePathIsArchive;
const canInvokeBackend = (context: ActionContext) => context.backendAvailable && !context.operationBusy;

type ActionDefinition = Omit<AppAction, 'labelKey' | 'descriptionKey' | 'displayLabel' | 'hotkeyLabel' | 'isEnabled'> & {
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
    labelKey: `actions.${definition.id}.label`,
    descriptionKey: `actions.${definition.id}.description`,
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
  action({ id: 'nav.up', category: 'navigation', shortcutLabel: 'Backspace/h', keyboardBindings: ['Backspace', 'h'], menuPath: ['Go', 'Up'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.back', category: 'navigation', shortcutLabel: 'Alt+Left', keyboardBindings: ['Alt+ArrowLeft'], menuPath: ['Go', 'Back'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.forward', category: 'navigation', shortcutLabel: 'Alt+Right', keyboardBindings: ['Alt+ArrowRight'], menuPath: ['Go', 'Forward'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.refresh', category: 'navigation', shortcutLabel: 'Ctrl+R', keyboardBindings: ['Ctrl+R'], menuPath: ['View', 'Refresh'], dangerLevel: 'safe', command: COMMANDS.listDir, runPath: 'list_dir' }),
  action({ id: 'nav.gotoPath', category: 'navigation', shortcutLabel: 'gp', keyboardBindings: ['g p'], menuPath: ['View', 'Go To Path'], dangerLevel: 'safe', command: COMMANDS.gotoPath, runPath: 'goto_path' }),
  action({ id: 'nav.locations', category: 'navigation', shortcutLabel: 'gm', keyboardBindings: ['g m'], menuPath: ['View', 'Mount Points'], dangerLevel: 'safe', command: COMMANDS.listLocations, runPath: 'list_locations' }),
  action({ id: 'nav.top', category: 'navigation', displayLabel: 'Go Top', shortcutLabel: 'gg', keyboardBindings: ['g g'], menuPath: ['Go', 'Top'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'nav.bottom', category: 'navigation', displayLabel: 'Go Bottom', shortcutLabel: 'G', keyboardBindings: ['Shift+G'], menuPath: ['Go', 'Bottom'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'tab.new', category: 'panel', shortcutLabel: 'tn', keyboardBindings: ['t n'], menuPath: ['View', 'New Tab'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'tab.close', category: 'panel', shortcutLabel: 'tx', keyboardBindings: ['t x'], menuPath: ['View', 'Close Tab'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'tab.list', category: 'panel', shortcutLabel: 'tt', keyboardBindings: ['t t'], menuPath: ['View', 'Tab List'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'selection.toggle', category: 'selection', hotkeyLabel: 'Sel', shortcutLabel: 'Space', keyboardBindings: ['Space'], menuPath: ['Edit', 'Select'], dangerLevel: 'none', runPath: 'UI state', isEnabled: hasFocus }),
  action({ id: 'selection.all', category: 'selection', hotkeyLabel: 'SelAll', shortcutLabel: 'Ctrl+A', keyboardBindings: ['Ctrl+A'], menuPath: ['Edit', 'Select All'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'file.clipboardCopy', category: 'file', displayLabel: 'Copy', shortcutLabel: 'Cmd+C', keyboardBindings: ['Cmd+C', 'Ctrl+C'], menuPath: ['Edit', 'Copy'], contextScopes: ['selection'], dangerLevel: 'safe', runPath: 'UI clipboard state', isEnabled: hasEffectiveTarget }),
  action({ id: 'file.clipboardCut', category: 'file', displayLabel: 'Cut', shortcutLabel: 'Ctrl+X', keyboardBindings: ['Ctrl+X'], menuPath: ['Edit', 'Cut'], contextScopes: ['selection'], dangerLevel: 'safe', runPath: 'UI clipboard state', isEnabled: (c) => c.platform === 'other' && hasEffectiveTarget(c) && !c.activePathIsArchive && c.backendAvailable }),
  action({ id: 'file.clipboardPaste', category: 'file', displayLabel: 'Paste', shortcutLabel: 'Cmd+V', keyboardBindings: ['Cmd+V', 'Ctrl+V'], menuPath: ['Edit', 'Paste'], contextScopes: ['blank'], dangerLevel: 'safe', runPath: 'start_copy/start_move/archive_extract/archive_add', isEnabled: (c) => (c.clipboardCount ?? 0) > 0 && (c.clipboardMode !== 'move' || c.clipboardCanMove === true) && canMutate(c) }),
  action({ id: 'file.clipboardMovePaste', category: 'file', displayLabel: 'Move Here', shortcutLabel: 'Opt+Cmd+V', keyboardBindings: ['Alt+Cmd+V'], menuPath: ['Edit', 'Move Here'], contextScopes: ['blank'], dangerLevel: 'destructive', command: COMMANDS.startMove, runPath: 'start_move via confirmation dialog', isEnabled: (c) => c.platform === 'mac' && (c.clipboardCount ?? 0) > 0 && c.clipboardCanMove === true && canMutate(c) }),
  action({ id: 'file.copy', category: 'file', displayLabel: 'Copy', shortcutLabel: 'y/F5', keyboardBindings: ['y', 'F5'], menuPath: ['Edit', 'Copy to Other Panel'], contextScopes: ['selection'], dangerLevel: 'safe', command: COMMANDS.startCopy, runPath: 'start_copy', isEnabled: (c) => hasEffectiveTarget(c) && c.hasOppositePanel && canMutate(c) }),
  action({ id: 'file.move', category: 'file', displayLabel: 'Move', shortcutLabel: 'x/F6', keyboardBindings: ['x', 'F6'], menuPath: ['Edit', 'Move'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startMove, runPath: 'start_move', isEnabled: (c) => hasEffectiveTarget(c) && c.hasOppositePanel && canMutateFilesystem(c) }),
  action({ id: 'file.trash', category: 'file', displayLabel: 'Delete', hotkeyLabel: 'Del', shortcutLabel: 'd', keyboardBindings: ['d'], menuPath: ['File', 'Delete'], contextScopes: ['selection'], dangerLevel: 'destructive', command: COMMANDS.startDelete, runPath: 'start_delete trash', isEnabled: (c) => hasEffectiveTarget(c) && canMutateFilesystem(c) }),
  action({ id: 'file.deletePermanent', category: 'file', displayLabel: 'Permanent Delete', hotkeyLabel: 'PermDel', shortcutLabel: 'Shift+D/Shift+Delete', keyboardBindings: ['Shift+D', 'Shift+Delete'], menuPath: ['File', 'Permanent Delete'], contextScopes: ['selection'], dangerLevel: 'irreversible', command: COMMANDS.startDelete, runPath: 'start_delete permanent', isEnabled: (c) => hasEffectiveTarget(c) && canMutateFilesystem(c) }),
  action({ id: 'file.mkdir', category: 'file', displayLabel: 'New Folder', hotkeyLabel: 'MkDir', shortcutLabel: 'a/F7', keyboardBindings: ['a', 'F7'], menuPath: ['File', 'New Folder'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.createDir, runPath: 'create_dir', isEnabled: canMutateFilesystem }),
  action({ id: 'file.rename', category: 'file', displayLabel: 'Rename', hotkeyLabel: 'Ren', shortcutLabel: 'r/F2', keyboardBindings: ['r', 'F2'], menuPath: ['File', 'Rename'], contextScopes: ['file', 'directory'], dangerLevel: 'destructive', command: COMMANDS.renameEntry, runPath: 'rename_entry', isEnabled: (c) => hasConcreteFocus(c) && c.selectedCount <= 1 && canMutateFilesystem(c) }),
  action({ id: 'app.quit', category: 'file', displayLabel: 'Quit', shortcutLabel: 'Cmd+Q', keyboardBindings: ['Cmd+Q'], menuPath: ['File', 'Quit'], dangerLevel: 'none', runPath: 'getCurrentWindow().close safety-gated by explicit menu/Cmd+Q' }),
  action({ id: 'file.properties', category: 'file', displayLabel: 'File Info', hotkeyLabel: 'Info', shortcutLabel: 'i', keyboardBindings: ['i'], menuPath: ['View', 'File Info'], contextScopes: ['file', 'directory'], dangerLevel: 'safe', command: COMMANDS.getMetadata, runPath: 'get_metadata', isEnabled: (c) => hasConcreteFocus(c) && canInvokeBackend(c) }),
  action({ id: 'file.quickView', category: 'file', displayLabel: 'Quick View', hotkeyLabel: 'View', shortcutLabel: 'F3', keyboardBindings: ['F3'], menuPath: ['View', 'Quick View'], contextScopes: ['file', 'archive'], dangerLevel: 'safe', command: COMMANDS.previewFile, runPath: 'preview_file', isEnabled: (c) => hasConcreteFocus(c) && !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'archive.list', category: 'archive', shortcutLabel: 'Enter on archive', menuPath: ['Archive', 'Open Archive'], contextScopes: ['archive'], dangerLevel: 'safe', command: COMMANDS.archiveList, runPath: 'archive_list virtual-directory', isEnabled: (c) => hasFocus(c) && canInvokeBackend(c) }),
  action({ id: 'archive.extract', category: 'archive', displayLabel: 'Archive Extract', shortcutLabel: 'zx', keyboardBindings: ['z x'], menuPath: ['File', 'Archive Extract'], contextScopes: ['archive'], dangerLevel: 'destructive', command: COMMANDS.archiveExtract, runPath: 'archive_extract', isEnabled: (c) => hasFocus(c) && canMutate(c) }),
  action({ id: 'archive.extractAuto', category: 'archive', displayLabel: 'Archive Extract Auto', shortcutLabel: 'za', keyboardBindings: ['z a'], menuPath: ['File', 'Archive Extract Auto'], contextScopes: ['archive'], dangerLevel: 'destructive', command: COMMANDS.archiveExtract, runPath: 'archive_extract auto', isEnabled: (c) => hasFocus(c) && canMutate(c) }),
  action({ id: 'archive.create', category: 'archive', displayLabel: 'Archive Compress', hotkeyLabel: 'Archive', shortcutLabel: 'zc', keyboardBindings: ['z c'], menuPath: ['File', 'Archive Compress'], contextScopes: ['selection'], dangerLevel: 'safe', command: COMMANDS.archiveCreate, runPath: 'archive_create', isEnabled: (c) => hasEffectiveTarget(c) && canMutate(c) }),
  action({ id: 'external.openDefault', category: 'file', displayLabel: 'Open Default App', shortcutLabel: 'o', keyboardBindings: ['o'], menuPath: ['File', 'Open Default App'], contextScopes: ['file'], dangerLevel: 'safe', command: COMMANDS.openDefault, runPath: 'open_default', isEnabled: (c) => hasFocus(c) && canInvokeBackend(c) }),
  action({ id: 'external.reveal', category: 'file', displayLabel: 'Reveal', menuPath: ['File', 'Reveal'], contextScopes: ['file', 'directory'], dangerLevel: 'safe', command: COMMANDS.revealInManager, runPath: 'reveal_in_manager', isEnabled: (c) => hasConcreteFocus(c) && canInvokeBackend(c) }),
  action({ id: 'external.openCurrentInFinder', category: 'navigation', displayLabel: 'Open Current Folder in Finder', menuPath: ['Go', 'Open Current Folder in Finder'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.openCurrentInFinder, runPath: 'open_current_in_finder', isEnabled: (c) => c.platform === 'mac' && !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'external.openCurrentInTerminal', category: 'navigation', displayLabel: 'Open Terminal Here', menuPath: ['Go', 'Open Terminal Here'], contextScopes: ['blank'], dangerLevel: 'safe', command: COMMANDS.openCurrentInTerminal, runPath: 'open_current_in_terminal', isEnabled: (c) => c.platform === 'mac' && !c.activePathIsArchive && canInvokeBackend(c) }),
  action({ id: 'external.openEditor', category: 'file', displayLabel: 'Open Terminal Editor', shortcutLabel: 'e', keyboardBindings: ['e'], menuPath: ['File', 'Open Terminal Editor'], contextScopes: ['file'], dangerLevel: 'safe', command: COMMANDS.openExternalEditor, runPath: 'open_external_editor', isEnabled: (c) => hasFocus(c) && canInvokeBackend(c) }),
  action({ id: 'view.sortName', category: 'view', shortcutLabel: 'sn', keyboardBindings: ['s n'], menuPath: ['View', 'Sort', 'Name'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortSize', category: 'view', shortcutLabel: 'ss', keyboardBindings: ['s s'], menuPath: ['View', 'Sort', 'Size'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortDate', category: 'view', shortcutLabel: 'sd', keyboardBindings: ['s d'], menuPath: ['View', 'Sort', 'Modified Date'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortExt', category: 'view', shortcutLabel: 'se', keyboardBindings: ['s e'], menuPath: ['View', 'Sort', 'Extension'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.reverseSort', category: 'view', shortcutLabel: 'sr', keyboardBindings: ['s r'], menuPath: ['View', 'Sort', 'Reverse'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortAsc', category: 'view', menuPath: ['View', 'Sort', 'Ascending'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.sortDesc', category: 'view', menuPath: ['View', 'Sort', 'Descending'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'filter.start', category: 'view', displayLabel: 'Filter', shortcutLabel: '/', keyboardBindings: ['/'], menuPath: ['View', 'Filter'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'filter.clear', category: 'view', shortcutLabel: 'Esc in filter', menuPath: ['View', 'Clear Filter'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'view.toggleHidden', category: 'view', shortcutLabel: '.', keyboardBindings: ['.'], menuPath: ['View', 'Hidden Files'], dangerLevel: 'none', command: COMMANDS.listDir, runPath: 'UI state + list_dir' }),
  action({ id: 'selection.invert', category: 'selection', hotkeyLabel: 'InvSel', shortcutLabel: 'v', keyboardBindings: ['v'], menuPath: ['Edit', 'Invert Selection'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'selection.clear', category: 'selection', hotkeyLabel: 'Desel', shortcutLabel: 'u', keyboardBindings: ['u'], menuPath: ['Edit', 'Clear Selection'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.toggleSingleDual', category: 'view', shortcutLabel: 'Ctrl+W', keyboardBindings: ['Ctrl+W'], menuPath: ['View', 'Toggle Layout'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio50', category: 'view', menuPath: ['View', 'Panel Ratio', '50:50'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio70Left', category: 'view', menuPath: ['View', 'Panel Ratio', '70:30'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'layout.ratio70Right', category: 'view', menuPath: ['View', 'Panel Ratio', '30:70'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'history.list', category: 'navigation', shortcutLabel: 'th', keyboardBindings: ['t h'], menuPath: ['View', 'History List'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'bookmark.add', category: 'navigation', shortcutLabel: 'Ctrl+B', keyboardBindings: ['Ctrl+B'], menuPath: ['View', 'Bookmark Add'], dangerLevel: 'safe', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'bookmark.list', category: 'navigation', shortcutLabel: 'tb', keyboardBindings: ['t b'], menuPath: ['View', 'Bookmark List'], dangerLevel: 'none', runPath: 'UI state' }),
  action({ id: 'bookmark.rename', category: 'navigation', menuPath: ['Go', 'Bookmark', 'Rename'], dangerLevel: 'safe', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'bookmark.delete', category: 'navigation', displayLabel: 'Delete Bookmark', dangerLevel: 'destructive', command: COMMANDS.saveSettings, runPath: 'bookmark list → save_settings' }),
  action({ id: 'settings.themeDark', category: 'settings', menuPath: ['Settings', 'Theme', 'Dark'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.themeLight', category: 'settings', menuPath: ['Settings', 'Theme', 'Light'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.themeHighContrast', category: 'settings', menuPath: ['Settings', 'Theme', 'High Contrast'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.languageEn', category: 'settings', menuPath: ['Settings', 'Language', 'English'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.languageKo', category: 'settings', menuPath: ['Settings', 'Language', 'Korean'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.editorVi', category: 'settings', menuPath: ['Settings', 'Default Editor', 'vi'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.editorVim', category: 'settings', menuPath: ['Settings', 'Default Editor', 'vim'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.editorNano', category: 'settings', menuPath: ['Settings', 'Default Editor', 'nano'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.editorEmacs', category: 'settings', menuPath: ['Settings', 'Default Editor', 'emacs'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.toggleIcons', category: 'settings', displayLabel: 'Toggle Icons', menuPath: ['Settings', 'Toggle Icons'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.sizeAuto', category: 'settings', menuPath: ['Settings', 'File Size Format', 'Auto'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'settings.sizeBytes', category: 'settings', menuPath: ['Settings', 'File Size Format', 'Bytes'], dangerLevel: 'none', command: COMMANDS.saveSettings, runPath: 'save_settings' }),
  action({ id: 'external.runShellCommand', category: 'file', displayLabel: 'Shell Command', shortcutLabel: ':', keyboardBindings: [':'], menuPath: ['File', 'Run Shell Command'], dangerLevel: 'destructive', command: COMMANDS.runShellCommand, runPath: 'ShellCommandDialog → run_shell_command', isEnabled: (c) => c.shellCommandEnabled && canMutate(c) }),
  action({ id: 'help.shortcuts', category: 'help', displayLabel: 'Keyboard Help', hotkeyLabel: 'Keys', shortcutLabel: '?', keyboardBindings: ['?'], menuPath: ['Help', 'Keyboard Help'], dangerLevel: 'none', runPath: 'dialog' }),
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
  'external.openEditor',
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

export const isActionAvailable = (action: AppAction, context: ActionContext) =>
  action.isEnabled(context) && actionMatchesContextScope(action, context);

export const menuSegmentLabel = (segment: string, language: SupportedLanguage = 'en') =>
  MENU_SEGMENT_LABELS[language][segment] ?? segment;

export const menuPathSegmentsForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  action.menuPath?.map((segment) => menuSegmentLabel(segment, language));

export const labelForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  ACTION_LABELS[language][action.id] ?? menuSegmentLabel(action.displayLabel, language);

export const hotkeyLabelForAction = (action: AppAction, language: SupportedLanguage = 'en') =>
  HOTKEY_LABELS[language][action.id] ?? action.hotkeyLabel;

export type FileShortcutPlatform = 'mac' | 'other';

export const fileShortcutPlatform = (userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent): FileShortcutPlatform =>
  /Windows|Linux/i.test(userAgent) ? 'other' : 'mac';

export const actionVisibleOnPlatform = (action: AppAction, platform = fileShortcutPlatform()) =>
  platform === 'mac'
    ? action.id !== 'file.clipboardCut'
    : !['file.clipboardMovePaste', 'external.openCurrentInFinder', 'external.openCurrentInTerminal'].includes(action.id);

export const actionsForMenu = (menuRoot: string, platform = fileShortcutPlatform()) =>
  ACTIONS.filter((item) => item.menuPath?.[0] === menuRoot && actionVisibleOnPlatform(item, platform));

export const menuRootLabelFromRegistry = (root: string, language: SupportedLanguage = 'en') => {
  const accelerator = MENU_ROOT_ACCELERATORS.get(root);
  const label = menuSegmentLabel(root, language);
  return accelerator ? `${label}(${accelerator})` : label;
};

export const menuRootAcceleratorFromRegistry = (root: string) =>
  MENU_ROOT_ACCELERATORS.get(root) ?? null;

const platformShortcutLabel = (action: AppAction, platform = fileShortcutPlatform()) => {
  if (platform === 'other') {
    if (action.id === 'file.clipboardCopy') return 'Ctrl+C';
    if (action.id === 'file.clipboardPaste') return 'Ctrl+V';
  }
  return action.shortcutLabel;
};

export const shortcutLabelForAction = (action: AppAction, platform = fileShortcutPlatform()) => {
  const label = platformShortcutLabel(action, platform);
  return label
    ? (label === '/' ? '/' : label.split('/')[0])
    : action.keyboardBindings?.[0]?.replace(/\s+/g, '') ?? '·';
};

export const shortcutHelpLabelForAction = (action: AppAction, platform = fileShortcutPlatform()) =>
  platformShortcutLabel(action, platform)
  ?? action.keyboardBindings?.map((binding) => binding.replace(/\s+/g, '')).join('/')
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
): KeyboardShortcutMatch => {
  const keyToken = eventToBindingToken(event);
  const withPrevious = matchKeyboardSequence([...previousSequence, keyToken]);
  if (withPrevious.status !== 'none') {
    return withPrevious;
  }
  if (previousSequence.length > 0) {
    return matchKeyboardSequence([keyToken]);
  }
  return { status: 'none', action: null, sequence: [] };
};

export const actionForKeyboardShortcut = (
  event: KeyboardShortcutEvent,
  previousSequence: readonly string[] = [],
) => {
  const match = matchKeyboardShortcut(event, previousSequence);
  return match.status === 'matched' ? match.action : null;
};

export const ariaKeyShortcutsFromRegistry = () =>
  [...new Set(ACTIONS.flatMap((action) => action.keyboardBindings ?? []).filter((binding) => !binding.includes(' ')))]
    .map(toAriaKeyShortcut)
    .join(' ');

export const keyboardBindingCollisions = () => {
  const bindingsByToken = new Map<string, AppAction[]>();
  for (const action of ACTIONS) {
    for (const binding of action.keyboardBindings ?? []) {
      const normalized = bindingToTokens(binding).join(' ');
      bindingsByToken.set(normalized, [...(bindingsByToken.get(normalized) ?? []), action]);
    }
  }
  return [...bindingsByToken.entries()]
    .filter(([, actions]) => actions.length > 1)
    .map(([binding, actions]) => ({ binding, actionIds: actions.map((action) => action.id) }));
};

const matchKeyboardSequence = (sequence: readonly string[]): KeyboardShortcutMatch => {
  const normalizedSequence = sequence.map(normalizeBindingToken);
  const exact = ACTIONS.find((action) =>
    action.keyboardBindings?.some((binding) => bindingToTokens(binding).every((token, index) =>
      token === normalizedSequence[index],
    ) && bindingToTokens(binding).length === normalizedSequence.length),
  );
  const hasLongerCandidate = ACTIONS.some((action) =>
    action.keyboardBindings?.some((binding) => {
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

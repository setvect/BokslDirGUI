import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), 'utf8');

const checks = [];
const addCheck = (name, passed, detail) => checks.push({ name, passed, detail });

const packageJson = JSON.parse(read('package.json'));
for (const script of ['typecheck', 'test', 'build', 'check', 'rust:test', 'verify:scope', 'verify']) {
  addCheck(`package script: ${script}`, Boolean(packageJson.scripts?.[script]), packageJson.scripts?.[script] ?? 'missing');
}

const registry = read('src/actions/registry.ts');
const registryActionIds = [...registry.matchAll(/id: '([^']+)'/g)].map((match) => match[1]);
const registryActionIdSet = new Set(registryActionIds);

const parityMatrix = JSON.parse(read('docs/implementation/tui-parity-matrix.json'));
const parityMatrixDoc = read('docs/implementation/tui-parity-matrix.md');
const allowedParityStatuses = new Set(['implemented', 'partial', 'stub', 'planned', 'missing']);
const expectedTuiActionIds = [
  'move_up',
  'move_down',
  'go_parent',
  'enter',
  'go_top',
  'go_bottom',
  'page_up',
  'page_down',
  'toggle_panel',
  'toggle_layout',
  'tab_new',
  'tab_close',
  'copy',
  'move',
  'open_default',
  'open_terminal_editor',
  'run_shell_command',
  'delete',
  'perm_delete',
  'new_dir',
  'rename',
  'file_info',
  'archive_compress',
  'archive_extract',
  'archive_extract_auto',
  'archive_preview',
  'toggle_sel',
  'invert_selection',
  'select_all',
  'deselect',
  'help_keys',
  'refresh',
  'open_menu',
  'quit',
  'theme_dark',
  'theme_light',
  'theme_contrast',
  'language_en',
  'language_ko',
  'toggle_icons',
  'editor_preset_vi',
  'editor_preset_vim',
  'editor_preset_nano',
  'editor_preset_emacs',
  'sort_name',
  'sort_size',
  'sort_date',
  'sort_ext',
  'sort_asc',
  'sort_desc',
  'filter_start',
  'filter_clear',
  'toggle_hidden',
  'mount_points',
  'goto_path',
  'tab_list',
  'history_back',
  'history_forward',
  'history_list',
  'bookmark_add',
  'bookmark_list',
  'size_auto',
  'size_bytes',
  'about',
];
const expectedTuiActionIdSet = new Set(expectedTuiActionIds);
const parityRows = Array.isArray(parityMatrix.tuiActions) ? parityMatrix.tuiActions : [];
const parityRowsById = new Map(parityRows.map((row) => [row.tuiId, row]));
const guiOnlyExtensionIds = new Set((parityMatrix.guiOnlyExtensions ?? []).map((item) => item.guiActionId));
const rowHasMenuPath = (row, ...segments) =>
  row?.tuiMenuPaths?.some((menuPath) => segments.every((segment, index) => menuPath[index] === segment));

addCheck(
  'TUI parity matrix JSON exists with schema version',
  parityMatrix.schemaVersion === 1 && parityMatrix.completionRule?.includes('implemented'),
  'docs/implementation/tui-parity-matrix.json',
);
addCheck(
  'TUI parity matrix markdown documents hard gate',
  parityMatrixDoc.includes('Phase 0 하드 게이트') && parityMatrixDoc.includes('implemented'),
  'docs/implementation/tui-parity-matrix.md',
);
addCheck(
  'TUI parity matrix covers every known BokslDir TUI action exactly once',
  parityRows.length === expectedTuiActionIds.length
    && new Set(parityRows.map((row) => row.tuiId)).size === expectedTuiActionIds.length
    && expectedTuiActionIds.every((id) => parityRowsById.has(id)),
  `${parityRows.length}/${expectedTuiActionIds.length} rows`,
);
addCheck(
  'TUI parity matrix has no unknown TUI action ids',
  parityRows.every((row) => expectedTuiActionIdSet.has(row.tuiId)),
  parityRows.filter((row) => !expectedTuiActionIdSet.has(row.tuiId)).map((row) => row.tuiId).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix statuses are controlled vocabulary',
  parityRows.every((row) => allowedParityStatuses.has(row.implementationStatus)),
  'allowed: implemented, partial, stub, planned, missing',
);
addCheck(
  'TUI parity matrix implemented rows carry evidence',
  parityRows.every((row) => row.implementationStatus !== 'implemented' || row.evidence?.length > 0),
  'implemented rows must not be assertion-only',
);
addCheck(
  'TUI parity matrix missing rows are not mapped to GUI actions',
  parityRows.every((row) => row.implementationStatus !== 'missing' || row.guiActionIds.length === 0),
  'missing means no GUI action is registered yet',
);
const menuActionIds = (parityMatrix.menuRoots ?? []).flatMap((root) => root.actionIds ?? []);
addCheck(
  'TUI parity matrix menu roots cover only known action ids',
  menuActionIds.every((id) => expectedTuiActionIdSet.has(id)),
  menuActionIds.filter((id) => !expectedTuiActionIdSet.has(id)).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix menu action rows include TUI menu paths',
  menuActionIds.every((id) => parityRowsById.get(id)?.tuiMenuPaths?.length > 0),
  menuActionIds.filter((id) => !parityRowsById.get(id)?.tuiMenuPaths?.length).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix records F9 menu as implemented only with keyboard evidence',
  parityRowsById.get('open_menu')?.priority === 'P0'
    && parityRowsById.get('open_menu')?.implementationStatus === 'implemented'
    && parityRowsById.get('open_menu')?.guiActionIds?.includes('menu.open')
    && parityRowsById.get('open_menu')?.tuiKeyboardBindings?.includes('F9')
    && read('src/ui/CommanderShell.tsx').includes('handleTopMenuKeyDown')
    && registry.includes("id: 'menu.open'"),
  'F9 menu may be implemented only when registry and shell keyboard state machine evidence exist',
);
addCheck(
  'TUI parity matrix records copy as implemented only with Edit menu and direct operation evidence',
  (() => {
    const row = parityRowsById.get('copy');
    const source = read('src/ui/CommanderShell.tsx');
    const store = read('src/operations/operationStore.ts');
    return row?.priority === 'P0'
      && row.implementationStatus === 'implemented'
      && rowHasMenuPath(row, 'Edit')
      && row.guiMenuPaths?.some((menuPath) => menuPath[0] === 'Edit')
      && source.includes("if (actionId === 'file.copy')")
      && source.includes('startLongRunningOperation(operationRequest)')
      && store.includes('startLongRunningOperation');
  })(),
  'copy may be implemented only when it is on the TUI Edit menu and starts real operations without a preflight dialog',
);
addCheck(
  'TUI parity matrix records move as implemented only with Edit menu and explicit confirmation evidence',
  (() => {
    const row = parityRowsById.get('move');
    const source = read('src/ui/CommanderShell.tsx');
    const tests = read('src/ui/CommanderShell.test.tsx');
    return row?.priority === 'P0'
      && row.implementationStatus === 'implemented'
      && rowHasMenuPath(row, 'Edit')
      && row.guiMenuPaths?.some((menuPath) => menuPath[0] === 'Edit')
      && source.includes("if (actionId === 'file.copy')")
      && source.includes('openOperationDialog(operationRequest)')
      && tests.includes('requires explicit confirmation before a move reaches the operation client');
  })(),
  'move may be implemented only when it is on the TUI Edit menu and requires explicit confirmation before start_move',
);
addCheck(
  'TUI parity matrix records movement and selection rows as implemented only with keyboard evidence',
  ['move_up', 'move_down', 'go_parent', 'enter', 'page_up', 'page_down', 'toggle_sel', 'select_all', 'invert_selection', 'deselect'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => item.includes('CommanderShell.test.tsx'));
  })
    && read('src/ui/CommanderShell.test.tsx').includes('extends selection with shifted page and boundary movement keys')
    && read('src/ui/CommanderShell.test.tsx').includes('applies selection all, invert, and clear shortcuts'),
  'movement/selection rows may be implemented only after keyboard/default-suppression tests exist',
);
addCheck(
  'TUI parity matrix records settings and direct sort rows as implemented only with direct action evidence',
  ['theme_dark', 'theme_light', 'theme_contrast', 'language_en', 'language_ko', 'size_auto', 'size_bytes', 'sort_asc', 'sort_desc'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => item.includes('CommanderShell.test.tsx'))
      && row.guiActionIds?.every((actionId) => registry.includes(`id: '${actionId}'`));
  }),
  'settings/theme/language/size and direct sort rows require direct menu actions plus runtime tests before completion',
);
addCheck(
  'TUI parity matrix records safe mutation rows as implemented only with confirmation and backend evidence',
  ['delete', 'perm_delete', 'file_info'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => item.includes('CommanderShell.test.tsx'))
      && row.guiActionIds?.every((actionId) => registry.includes(`id: '${actionId}'`));
  })
    && parityRowsById.get('delete')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Delete')
    && parityRowsById.get('perm_delete')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Permanent Delete')
    && parityRowsById.get('file_info')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'View > File Info')
    && read('src/ui/CommanderShell.test.tsx').includes('uses the focused concrete row for delete')
    && read('src/ui/CommanderShell.test.tsx').includes('blocks delete on the virtual parent row')
    && read('src/ui/CommanderShell.test.tsx').includes('requires typed confirmation before permanent delete'),
  'delete/permanent delete/file info require TUI menu paths, effective target fallback, virtual exclusion, confirmation, and metadata tests',
);
addCheck(
  'TUI parity matrix records no known missing TUI actions after parity completion stories',
  parityRows.every((row) => row.implementationStatus !== 'missing'),
  parityRows.filter((row) => row.implementationStatus === 'missing').map((row) => row.tuiId).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix records external/editor/shell rows as implemented only with runtime and menu evidence',
  ['open_default', 'open_terminal_editor', 'run_shell_command', 'editor_preset_vi', 'editor_preset_vim', 'editor_preset_nano', 'editor_preset_emacs'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => item.includes('CommanderShell.test.tsx') || item.includes('registry.test.ts'))
      && row.guiActionIds?.every((actionId) => registry.includes(`id: '${actionId}'`));
  })
    && parityRowsById.get('open_default')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Open Default App')
    && parityRowsById.get('open_terminal_editor')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Open Terminal Editor')
    && parityRowsById.get('run_shell_command')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Run Shell Command')
    && read('src/ui/CommanderShell.tsx').includes('settings.external.editorId')
    && read('src/ui/CommanderShell.test.tsx').includes('opens files through default app and configured external editor command paths')
    && read('src/ui/CommanderShell.test.tsx').includes('previews and then runs shell commands only after an enabled policy returns a confirm token'),
  'external open/editor/shell rows require File menu parity, persisted editor preset, shell preview/confirm/run, and tests',
);
addCheck(
  'TUI parity matrix records archive rows as implemented only with auto-extract and backend evidence',
  ['archive_compress', 'archive_extract', 'archive_extract_auto', 'archive_preview'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => item.includes('CommanderShell.test.tsx'))
      && row.guiActionIds?.every((actionId) => registry.includes(`id: '${actionId}'`));
  })
    && registry.includes("id: 'archive.extractAuto'")
    && read('src/ui/CommanderShell.tsx').includes('archiveAutoExtractFolderName')
    && read('src/ui/CommanderShell.test.tsx').includes('uses auto-extract to derive a target folder')
    && read('src-tauri/src/operation.rs').includes('archive_entry_is_unsafe'),
  'archive rows require create/extract/auto/preview action mappings, target derivation, UI tests, and Rust unsafe-path defense',
);
addCheck(
  'TUI parity matrix records remaining navigation/view/help rows as implemented only with user-scenario evidence',
  ['toggle_layout', 'tab_new', 'tab_close', 'help_keys', 'quit', 'toggle_icons', 'filter_start', 'filter_clear', 'mount_points', 'goto_path', 'tab_list', 'history_list', 'bookmark_add', 'bookmark_list', 'about'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => item.includes('CommanderShell.test.tsx') || item.includes('registry.test.ts'))
      && row.guiActionIds?.every((actionId) => registry.includes(`id: '${actionId}'`));
  })
    && registry.includes("id: 'app.quit'")
    && registry.includes("id: 'settings.toggleIcons'")
    && read('src/ui/CommanderShell.test.tsx').includes('uses an explicit Ctrl+Q/File Quit policy')
    && read('src/ui/CommanderShell.test.tsx').includes('opens path, location, tab, history, bookmark, help search, and about overlays')
    && read('src/ui/CommanderShell.test.tsx').includes('applies typed filters and preserves them through refresh until clear'),
  'remaining rows require real overlay/settings/menu/quit/filter tests before implemented status',
);
const matrixMappedGuiIds = new Set(
  parityRows.flatMap((row) => row.guiActionIds ?? []).filter((id) => !id.startsWith('__ui_motion.')),
);
addCheck(
  'TUI parity matrix maps all non-extension GUI actions',
  registryActionIds.every((id) => matrixMappedGuiIds.has(id) || guiOnlyExtensionIds.has(id)),
  registryActionIds.filter((id) => !matrixMappedGuiIds.has(id) && !guiOnlyExtensionIds.has(id)).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix GUI mappings refer to registered or explicit pseudo actions',
  [...matrixMappedGuiIds].every((id) => registryActionIdSet.has(id)),
  [...matrixMappedGuiIds].filter((id) => !registryActionIdSet.has(id)).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix documents GUI-only extension action ids',
  [...guiOnlyExtensionIds].every((id) => registryActionIdSet.has(id)),
  [...guiOnlyExtensionIds].filter((id) => !registryActionIdSet.has(id)).join(', ') || 'ok',
);

const requiredActionIds = [
  'menu.open',
  'panel.switchActive',
  'nav.enter',
  'nav.up',
  'nav.back',
  'nav.forward',
  'nav.refresh',
  'nav.gotoPath',
  'nav.locations',
  'selection.toggle',
  'selection.all',
  'file.copy',
  'file.move',
  'file.trash',
  'file.deletePermanent',
  'file.mkdir',
  'file.rename',
  'file.properties',
  'app.quit',
  'archive.preview',
  'archive.create',
  'archive.extract',
  'archive.extractAuto',
  'external.openDefault',
  'external.reveal',
  'external.openEditor',
  'external.runShellCommand',
  'view.sortName',
  'view.sortSize',
  'view.sortDate',
  'view.sortExt',
  'view.reverseSort',
  'filter.start',
  'filter.clear',
  'view.toggleHidden',
  'selection.invert',
  'selection.clear',
  'layout.toggleSingleDual',
  'history.list',
  'bookmark.add',
  'bookmark.list',
  'bookmark.rename',
  'bookmark.delete',
  'settings.themeDark',
  'settings.themeLight',
  'settings.themeHighContrast',
  'settings.languageEn',
  'settings.languageKo',
  'settings.editorVi',
  'settings.editorVim',
  'settings.editorNano',
  'settings.editorEmacs',
  'settings.toggleIcons',
  'settings.sizeAuto',
  'settings.sizeBytes',
  'layout.ratio50',
  'layout.ratio70Left',
  'layout.ratio70Right',
  'help.shortcuts',
  'help.search',
  'help.about',
];
for (const actionId of requiredActionIds) {
  addCheck(`action registry includes ${actionId}`, registry.includes(`id: '${actionId}'`), 'docs/implementation/full-scope-test-spec.md §3.6');
}

const domainTypes = read('src/domain/types.ts');
for (const field of ['owner: string | null', 'group: string | null', 'permissions: string | null']) {
  addCheck(`file entry metadata includes ${field}`, domainTypes.includes(field), 'FileEntry metadata DTO must support TUI parity columns');
}
for (const state of ['idle', 'validating', 'scanning', 'queued', 'waitingForConflict', 'running', 'cancelling', 'completed', 'completedWithErrors', 'failed', 'cancelled']) {
  addCheck(`operation state includes ${state}`, domainTypes.includes(`'${state}'`), 'OperationState union');
}
for (const decision of ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel']) {
  addCheck(`conflict decision includes ${decision}`, domainTypes.includes(`'${decision}'`), 'ConflictDecision union');
}

const commanderShell = read('src/ui/CommanderShell.tsx');
const commanderOverlays = read('src/ui/CommanderOverlays.tsx');
for (const selector of ['file-panel', 'hotkey-strip', 'panel-zone', 'bottom-status', 'columnLayoutForPanelWidth', 'entry-row-kind-']) {
  addCheck(`commander shell emits ${selector}`, commanderShell.includes(selector), 'TUI-faithful shell');
}
for (const forbidden of ['persistent-sidebar', 'persistent-inspector', 'large-toolbar', 'Action preview', 'transient-overlay', 'overlay-host']) {
  addCheck(`commander shell avoids ${forbidden}`, !commanderShell.includes(forbidden), 'No dashboard chrome');
}
for (const forbidden of ['MENU_ROOTS', 'ACTION_LABELS']) {
  addCheck(`commander shell avoids local ${forbidden}`, !commanderShell.includes(forbidden), 'Menu/help surface is derived from the action registry');
}
for (const selector of ['menuRootsFromRegistry', 'hotkeyStripActionsFromRegistry', 'isActionAvailable']) {
  addCheck(`commander shell uses registry selector ${selector}`, commanderShell.includes(selector), 'No parallel hardcoded action surface in shell');
}
for (const token of ['showCreated', 'showOwner', 'showPermissions', 'formatOwnerGroup']) {
  addCheck(`commander shell supports responsive metadata token ${token}`, commanderShell.includes(token), 'File metadata columns must follow TUI width-responsive behavior');
}
for (const token of ["document.addEventListener('keydown'", 'handleMovementKey', 'commanderKeyboardIsSuspended', 'aria-keyshortcuts', 'FOCUSABLE_ROW_TAB_INDEX = -1']) {
  addCheck(`commander shell includes keyboard control ${token}`, commanderShell.includes(token), 'Keyboard-first commander control must override web-page defaults');
}
addCheck(
  'commander shell dispatches shortcuts through registry metadata',
  commanderShell.includes('matchKeyboardShortcut') && registry.includes('keyboardBindings'),
  'Keyboard shortcuts must stay derived from the action registry',
);
addCheck(
  'commander shell derives aria shortcuts from registry metadata',
  commanderShell.includes('ariaKeyShortcutsFromRegistry') && registry.includes('ariaKeyShortcutsFromRegistry'),
  'Keyboard a11y hints must stay aligned with dispatchable bindings',
);
addCheck(
  'commander shell delegates hotkey display formatting to registry helper',
  commanderShell.includes('shortcutLabelForAction') && !commanderShell.includes("defaultShortcut?.split('/')"),
  'Hotkey strip must not parse display labels locally',
);
addCheck(
  'commander shell uses panel data-source seam instead of fixture listings',
  commanderShell.includes('PanelDataSource') && !commanderShell.includes('SAMPLE_LISTINGS'),
  'Real listing UI must be provider-backed, not fixture-backed in core rendering',
);
addCheck(
  'commander shell wires panel navigation to listDir state flow',
  commanderShell.includes('listPanel') && commanderShell.includes('historyBack') && commanderShell.includes('showHidden'),
  'Entry open/refresh/history/sort/hidden state must feed list_dir requests',
);
addCheck(
  'commander shell guards stale async panel navigation results',
  commanderShell.includes('navigationRequestRef') && commanderShell.includes('isCurrentPanelRequest'),
  'Older list_dir responses must not overwrite newer panel state',
);
addCheck(
  'commander shell exposes real filter input path',
  commanderShell.includes('FilterPrompt') && commanderOverlays.includes('Filter pattern') && commanderShell.includes("Object.hasOwn(options, 'filter')"),
  'filter.start/filter.clear must send explicit non-null/null filter values to list_dir',
);
addCheck(
  'commander shell wires safe mutation atomic executors',
  commanderShell.includes('atomicExecutorForAction') && commanderShell.includes('mutationClient.createDir') && commanderShell.includes('mutationClient.renameEntry'),
  'create_dir/rename_entry must execute through explicit atomic command adapters',
);
addCheck(
  'commander shell refreshes and focuses after safe mutation',
  commanderShell.includes('focusPath: entry.path') && commanderShell.includes('onAtomicSuccess'),
  'Safe mutation success must refresh the active panel and focus the changed row',
);

addCheck(
  'action registry exposes shortcut collision invariant',
  registry.includes('keyboardBindingCollisions') && registry.includes('hasLongerCandidate'),
  'Keyboard binding collisions and prefix sequences must be explicit',
);

const keyboardOwnership = read('src/ui/keyboardOwnership.ts');
for (const token of ['COMMANDER_SHORTCUTS_DISABLED_SELECTOR', 'commanderShortcutsDisabledProps', 'elementOwnsNativeKeyboardActivation', 'commanderKeyboardIsSuspended']) {
  addCheck(`keyboard ownership helper includes ${token}`, keyboardOwnership.includes(token), 'Commander shortcut ownership marker is centralized');
}

const operationStore = read('src/operations/operationStore.ts');
const operationStoreTest = read('src/operations/operationStore.test.ts');
for (const dialogKind of ['copy', 'move', 'trash', 'deletePermanent', 'rename', 'createDir', 'archiveCreate', 'archiveExtract', 'externalEditor', 'shellCommand']) {
  addCheck(`operation dialog supports ${dialogKind}`, operationStore.includes(`'${dialogKind}'`), 'G005 dialog shell coverage');
}
addCheck('operation store uses backend stub policy boundary', operationStore.includes('backendExecutionStubbed'), 'Stub policy applies to safe and destructive file mutation shells');
addCheck('operation store removed danger-only stub flag', !operationStore.includes('destructiveExecutionStubbed'), 'Stub policy must not hide safe mutation stubs');
addCheck('operation store separates atomic command execution mode', operationStore.includes("'atomicCommand'") && operationStore.includes('dialogExecutionModeForDialog'), 'Atomic commands must not be queued as long-running progress');
addCheck('operation store separates long-running operation execution mode', operationStore.includes("'longRunningOperation'") && operationStore.includes('LONG_RUNNING_DIALOGS'), 'Copy/move/delete/archive jobs keep operation-progress semantics');
addCheck('operation store validates safe mutation names', operationStore.includes('validateDialogInput') && operationStore.includes('errors.invalidName'), 'create_dir/rename_entry dialog names must be validated before Rust command execution');
addCheck('operation store exposes atomic executor seam', operationStore.includes('AtomicCommandExecutor') && operationStore.includes('onAtomicSuccess'), 'Connected atomic commands must use request/response execution, not progress stubs');
addCheck('operation store exposes long-running executor seam', operationStore.includes('LongRunningOperationExecutor') && operationStore.includes('applyOperationProgress') && operationStore.includes('applyOperationSummary'), 'copy/move/delete/trash must consume backend operation events instead of preview-only stubs');
addCheck('operation store preserves active controller when dismissing long-running dialog', operationStore.includes('closeDialog: () => set((current) =>') && operationStore.includes('if (isOperationInFlight(current))'), 'closing a confirmed long-running dialog must not detach summary refresh/cancel/conflict callbacks');
addCheck('operation store guards duplicate atomic submissions', operationStore.includes('atomicPending') && operationStore.includes('if (dialog.atomicPending)'), 'create_dir/rename_entry dialogs must not submit duplicate filesystem requests while pending');
addCheck('operation store guards duplicate long-running submissions', operationStore.includes('operationPending') && operationStore.includes('isOperationInFlight(get())'), 'long-running operation dialogs must not submit duplicate or concurrent filesystem requests while pending');
addCheck('operation store defers pending-start cancellation until real operation id', operationStore.includes('cancelRequestedBeforeStart') && operationStoreTest.includes('defers pending-start cancellation until the real backend operation id is known') && operationStoreTest.includes('defers confirmed-dialog pending-start cancellation until the real backend operation id is known'), 'pending synthetic operation ids must not be sent to backend cancel or detach the active controller');
addCheck('operation store accepts real events while direct start uses pending alias', operationStore.includes('isPendingAliasForUnboundController') && operationStoreTest.includes('accepts real backend progress and summary while direct copy is still bound to a pending id'), 'fast backend events must not be dropped while frontend start promise still has a synthetic pending id');
addCheck('operation store preserves controller across atomic dialogs', operationStoreTest.includes('preserves an active operation controller when opening an atomic dialog'), 'opening properties/info dialogs during active operations must not detach summary/cancel/conflict callbacks');
addCheck('operation store dismisses terminal status surface', operationStore.includes('isTerminalState(current.progress.state) ? null : current.progress') && operationStoreTest.includes('clears terminal progress when dismissing the operation summary'), 'summary dismiss must clear terminal progress so the non-modal status surface can close');
for (const conflictState of ['lastConflictDecision', 'applyAllConflictDecision', 'allOverwrite', 'allSkip']) {
  addCheck(`operation conflict model includes ${conflictState}`, operationStore.includes(conflictState), 'Conflict apply-all decisions are explicit');
}
addCheck(
  'operation store keeps local operation history',
  operationStore.includes('operationHistory') && operationStore.includes('MAX_OPERATION_HISTORY') && operationStore.includes('appendOperationHistory'),
  'destructive and long-running actions need a local audit/history trail',
);

const rustLib = read('src-tauri/src/lib.rs');
const rustOperation = read('src-tauri/src/operation.rs');
const rustBackend = `${rustLib}\n${rustOperation}`;
for (const command of ['list_dir', 'get_metadata', 'watch_path', 'goto_path', 'list_locations', 'create_dir', 'rename_entry', 'start_copy', 'start_move', 'start_delete', 'cancel_operation', 'resolve_conflict', 'archive_list', 'archive_create', 'archive_extract', 'open_default', 'reveal_in_manager', 'open_external_editor', 'prepare_shell_command', 'run_shell_command', 'load_settings', 'save_settings']) {
  addCheck(`rust handler includes ${command}`, rustBackend.includes(command), 'read-only command bridge');
}
addCheck('rust list_dir normalizes filter once', rustBackend.includes('normalized_filter'), 'avoid repeated filter lowercasing in read_dir loop');
addCheck('rust safe mutation validates child names', rustBackend.includes('validate_child_name') && rustLib.includes('already_exists'), 'create_dir/rename_entry must reject invalid names and overwrites');
addCheck('rust rename preserves source entry identity for symlinks', rustBackend.includes('rename_entry_renames_symlink_entry_not_target') && rustBackend.includes('fs::symlink_metadata(&source)'), 'rename_entry must rename the visible entry, not a symlink target');
addCheck('rust rename uses no-replace abstraction', rustBackend.includes('rename_no_replace') && rustBackend.includes('RENAME_EXCL') && rustBackend.includes('RENAME_NOREPLACE'), 'rename_entry overwrite prevention must not depend only on check-then-rename');
addCheck('rust operation service emits progress and summary events', rustBackend.includes('operation_progress') && rustBackend.includes('operation_summary') && rustBackend.includes('operation_conflict'), 'long-running operation state must be observable by the GUI');
addCheck('rust operation service implements copy move delete trash policies', rustBackend.includes('start_copy') && rustBackend.includes('start_move') && rustBackend.includes('DeleteMode::Trash') && rustBackend.includes('PERMANENT_DELETE'), 'copy/move/delete/trash must be real backend commands with safety policies');
addCheck('rust trash does not fall back to permanent delete', rustBackend.includes('errors.trashUnsupported') && rustBackend.includes('trash_directory'), 'trash failure must be recoverable and must not silently remove files permanently');
addCheck('rust archive commands use safe external provider boundary', rustBackend.includes('archive_entry_is_unsafe') && rustBackend.includes('common_source_parent') && rustBackend.includes('errors.archiveProviderUnavailable'), 'archive create/extract/list must avoid unsafe paths and absolute source entries');
addCheck('rust shell command is gated by settings and one-shot token', rustBackend.includes('ShellCommandPolicy') && rustBackend.includes('consume_token') && rustBackend.includes('used = true'), 'shell command must stay disabled by default and require a confirm token');
addCheck('rust settings persist bookmarks and layout', rustBackend.includes('BOKSLDIRGUI_SETTINGS_PATH') && rustBackend.includes('validate_settings') && rustBackend.includes('layout.ratio'), 'settings must persist bookmark/layout GUI state safely');

const tauriDefaultCapability = JSON.parse(read('src-tauri/capabilities/default.json'));
const tauriDefaultPermissions = new Set(tauriDefaultCapability.permissions ?? []);
addCheck(
  'tauri default capability is bound to main window',
  tauriDefaultCapability.identifier === 'default'
    && Array.isArray(tauriDefaultCapability.windows)
    && tauriDefaultCapability.windows.includes('main'),
  'src-tauri/capabilities/default.json',
);
addCheck(
  'tauri default capability grants operation event listen/unlisten',
  tauriDefaultPermissions.has('core:event:default')
    || (tauriDefaultPermissions.has('core:event:allow-listen') && tauriDefaultPermissions.has('core:event:allow-unlisten')),
  'operation_progress/operation_summary listeners require Tauri event ACL permissions',
);
addCheck(
  'tauri default capability grants app quit window close',
  tauriDefaultPermissions.has('core:window:default') || tauriDefaultPermissions.has('core:window:allow-close'),
  'app.quit uses getCurrentWindow().close() and requires the Tauri window close ACL permission',
);

const tauriConf = JSON.parse(read('src-tauri/tauri.conf.json'));
addCheck(
  'tauri config uses explicit CSP',
  typeof tauriConf.app?.security?.csp === 'string' && tauriConf.app.security.csp.length > 0,
  tauriConf.app?.security?.csp ?? 'missing',
);
addCheck(
  'tauri CSP is not disabled',
  tauriConf.app?.security?.csp !== null && tauriConf.app?.security?.csp !== false,
  'final review gate security boundary',
);

const tauriClient = read('src/tauri/client.ts');
for (const token of ['TauriResult', 'BACKEND_IMPLEMENTED_COMMANDS', 'unsupportedCommandError', 'normalizeInvokeError']) {
  addCheck(`tauri client exposes ${token}`, tauriClient.includes(token), 'Frontend wrappers must distinguish unsupported vs failed commands');
}
addCheck('tauri client marks safe mutation handlers implemented', tauriClient.includes('COMMANDS.createDir') && tauriClient.includes('COMMANDS.renameEntry'), 'create_dir/rename_entry frontend capability must match Rust handler registration');
addCheck('tauri client marks long-running operation handlers implemented', tauriClient.includes('COMMANDS.startCopy') && tauriClient.includes('COMMANDS.startMove') && tauriClient.includes('COMMANDS.startDelete') && tauriClient.includes('listenOperationEvents'), 'copy/move/delete/trash frontend capability must match Rust handler registration and event stream');
addCheck('tauri client marks archive/external/shell/settings implemented', tauriClient.includes('COMMANDS.archiveCreate') && tauriClient.includes('COMMANDS.openDefault') && tauriClient.includes('COMMANDS.prepareShellCommand') && tauriClient.includes('COMMANDS.saveSettings'), 'remaining command wrappers must match Rust handler registration');

const panelState = read('src/ui/panelState.ts');
const panelDataSource = read('src/ui/panelDataSource.ts');
for (const token of ['PanelNavigationState', 'historyBack', 'historyForward', 'showHidden', 'loading', 'error']) {
  addCheck(`panel state includes ${token}`, panelState.includes(token), 'Panel state abstraction owns real navigation state');
}
for (const token of ['PanelDataSource', 'PanelInitialLoadResult', 'createTauriPanelDataSource', 'createPreviewPanelDataSource', 'createFixturePanelDataSource', 'listDir', 'loadInitialListings']) {
  addCheck(`panel data source includes ${token}`, panelDataSource.includes(token), 'UI can swap fixture and Tauri-backed listing providers');
}
addCheck('panel data source defaults to strict Tauri startup', panelDataSource.includes('fallbackToInitialOnUnavailable = false'), 'Browser preview fallback must be explicit, not production default');

const commanderFixture = read('src/ui/commanderFixture.ts');
addCheck('commander fixture avoids developer home paths', !commanderFixture.includes('/Users/'), 'Sample data must be portable');
addCheck('commander fixture marks parent rows virtual', commanderFixture.includes('isVirtual: true'), 'Virtual parent entries require operation guardrails');

const actionContext = read('src/ui/actionContext.ts');
for (const token of ['createActionContext', 'filterEnabledActions', 'blocksVirtualEntryTarget', 'actionNeedsConcreteSources']) {
  addCheck(`action context helper includes ${token}`, actionContext.includes(token), 'Context menu and top menu share action enablement');
}

const fullScopeTest = read('src/verification/fullScope.test.ts');
for (const token of ['COMMANDS.archiveCreate', 'COMMANDS.prepareShellCommand', 'contextMenuActions', 'isBackendImplementedCommand', 'archive.preview']) {
  addCheck(`full-scope test covers ${token}`, fullScopeTest.includes(token), 'Semantic verification beyond static smoke');
}

const i18nResources = read('src/i18n-resources.ts');
for (const token of ['I18N_RESOURCES', "'ko'", "'en'", 'errors.archiveFormatUnsupported', 'errors.shellCommandDisabled']) {
  addCheck(`i18n resources include ${token}`, i18nResources.includes(token), 'message keys must have Korean and English resources');
}

const report = {
  generatedAt: new Date().toISOString(),
  passed: checks.every((check) => check.passed),
  total: checks.length,
  failed: checks.filter((check) => !check.passed),
  checks,
};

const reportPath = join(root, 'temp/verification/full-scope-smoke.json');
mkdirSync(dirname(reportPath), { recursive: true });
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

if (!report.passed) {
  console.error(JSON.stringify(report.failed, null, 2));
  process.exit(1);
}

console.log(`full-scope smoke passed (${report.total} checks) -> temp/verification/full-scope-smoke.json`);

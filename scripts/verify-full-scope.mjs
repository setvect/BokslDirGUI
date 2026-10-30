import { loadFeatureMetadata, projectRoot } from './load-feature-metadata.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const root = projectRoot;
const read = (path) => readFileSync(join(root, path), 'utf8');
const hasCommanderTestEvidence = (item) => {
  const file = item.split(':')[0];
  return /^src\/ui\/CommanderShell(?:\.[a-z]+)?\.test\.tsx$/.test(file) && existsSync(join(root, file));
};

const checks = [];
const addCheck = (name, passed, detail) => checks.push({ name, passed, detail });
// 구현 문자열 대신 이름 있는 행동 테스트를 근거로 사용. 리팩토링으로 내부 코드가 바뀌어도 검사 유지.
const hasTest = (file, ...titles) => {
  const source = read(file);
  return titles.every((title) => source.includes(title));
};

const packageJson = JSON.parse(read('package.json'));
for (const script of ['typecheck', 'test', 'build', 'check', 'rust:test', 'verify:scope', 'docs:generate', 'docs:check', 'verify']) {
  addCheck(`package script: ${script}`, Boolean(packageJson.scripts?.[script]), packageJson.scripts?.[script] ?? 'missing');
}

const registry = read('src/actions/registry.ts');
const i18nResources = read('src/i18n-resources.ts');
const metadata = await loadFeatureMetadata();
const { requiredActionIdsFromParity, validateFeatureMetadata, validateRustCommands } = metadata.validation;
const registryActionIds = metadata.actions.map((action) => action.id);
const actionById = new Map(metadata.actions.map((action) => [action.id, action]));
const registryActionIdSet = new Set(registryActionIds);

const parityMatrix = JSON.parse(read('docs/implementation/tui-parity-matrix.json'));
const parityMatrixDoc = read('docs/implementation/tui-parity-matrix.md');
const allowedParityStatuses = new Set(['implemented', 'partial', 'stub', 'planned', 'missing', 'excluded']);
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
const featureErrors = validateFeatureMetadata(metadata.actions, Object.values(metadata.commands), metadata.dialogs, parityMatrix);
addCheck('feature metadata matches independent parity requirements', featureErrors.length === 0, featureErrors.join('; ') || 'ok');
const expectedTuiActionIdSet = new Set(parityRows.map((row) => row.tuiId));
addCheck(
  'TUI parity matrix statuses are controlled vocabulary',
  parityRows.every((row) => allowedParityStatuses.has(row.implementationStatus)),
  'allowed: implemented, partial, stub, planned, missing, excluded',
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
const excludedEditorIds = new Set(['open_terminal_editor', 'editor_preset_vi', 'editor_preset_vim', 'editor_preset_nano', 'editor_preset_emacs']);
addCheck(
  'only explicitly removed editor features are excluded from parity',
  parityRows.filter((row) => row.implementationStatus === 'excluded').length === excludedEditorIds.size
    && parityRows.every((row) => !excludedEditorIds.has(row.tuiId) ? row.implementationStatus !== 'excluded'
      : row.implementationStatus === 'excluded' && row.guiActionIds.length === 0 && row.guiMenuPaths.length === 0
        && row.notes.includes('2026-10-03 사용자 명시 요청'))
    && !registryActionIdSet.has('external.openEditor') && !registryActionIds.some((id) => id.startsWith('settings.editor'))
    && !read('src-tauri/src/lib.rs').includes('commands::open_external_editor'),
  '2026-10-03 사용자 요청에 따른 터미널 편집기 및 설정 제거',
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
    && read('src/ui/menuModel.ts').includes('handleTopMenuKeyDown')
    && registryActionIdSet.has('menu.open'),
  'F9 menu may be implemented only when registry and shell keyboard state machine evidence exist',
);
addCheck(
  'TUI parity matrix records copy as implemented only with Edit menu and direct operation evidence',
  (() => {
    const row = parityRowsById.get('copy');

    return row?.priority === 'P0'
      && row.implementationStatus === 'implemented'
      && rowHasMenuPath(row, 'Edit')
      && row.guiMenuPaths?.some((menuPath) => menuPath[0] === 'Edit')
      && hasTest('src/ui/CommanderShell.operations.test.tsx', 'dispatches the copy shortcut directly to the operation client without a preflight dialog')
      && hasTest('src/operations/operationStore.test.ts', 'starts connected copy without opening a preflight dialog');
  })(),
  'copy may be implemented only when it is on the TUI Edit menu and starts real operations without a preflight dialog',
);
addCheck(
  'TUI parity matrix records move as implemented only with Edit menu and explicit confirmation evidence',
  (() => {
    const row = parityRowsById.get('move');

    return row?.priority === 'P0'
      && row.implementationStatus === 'implemented'
      && rowHasMenuPath(row, 'Edit')
      && row.guiMenuPaths?.some((menuPath) => menuPath[0] === 'Edit')
      && hasTest('src/ui/CommanderShell.operations.test.tsx', 'requires explicit confirmation before a move reaches the operation client');
  })(),
  'move may be implemented only when it is on the TUI Edit menu and requires explicit confirmation before start_move',
);
addCheck(
  'TUI parity matrix records movement and selection rows as implemented only with keyboard evidence',
  ['move_up', 'move_down', 'go_parent', 'enter', 'page_up', 'page_down', 'toggle_sel', 'select_all', 'invert_selection', 'deselect'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => hasCommanderTestEvidence(item));
  })
    && read('src/ui/CommanderShell.keyboard.test.tsx').includes('extends selection with shifted page and boundary movement keys')
    && read('src/ui/CommanderShell.keyboard.test.tsx').includes('applies selection all, invert, and clear shortcuts'),
  'movement/selection rows may be implemented only after keyboard/default-suppression tests exist',
);
addCheck(
  'TUI parity matrix records settings and direct sort rows as implemented only with direct action evidence',
  ['theme_dark', 'theme_light', 'theme_contrast', 'language_en', 'language_ko', 'size_auto', 'size_bytes', 'sort_asc', 'sort_desc'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => hasCommanderTestEvidence(item))
      && row.guiActionIds?.every((actionId) => registryActionIdSet.has(actionId));
  }),
  'settings/theme/language/size and direct sort rows require direct menu actions plus runtime tests before completion',
);
addCheck(
  'TUI parity matrix records safe mutation rows as implemented only with confirmation and backend evidence',
  ['delete', 'perm_delete', 'file_info'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => hasCommanderTestEvidence(item))
      && row.guiActionIds?.every((actionId) => registryActionIdSet.has(actionId));
  })
    && parityRowsById.get('delete')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Delete')
    && parityRowsById.get('perm_delete')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Permanent Delete')
    && parityRowsById.get('file_info')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'View > File Info')
    && read('src/ui/CommanderShell.operations.test.tsx').includes('uses the focused concrete row for delete')
    && read('src/ui/CommanderShell.operations.test.tsx').includes('blocks delete on the virtual parent row')
    && read('src/ui/CommanderShell.operations.test.tsx').includes('requires typed confirmation before permanent delete'),
  'delete/permanent delete/file info require TUI menu paths, effective target fallback, virtual exclusion, confirmation, and metadata tests',
);
addCheck(
  'TUI parity matrix records no known missing TUI actions after parity completion stories',
  parityRows.every((row) => row.implementationStatus !== 'missing'),
  parityRows.filter((row) => row.implementationStatus === 'missing').map((row) => row.tuiId).join(', ') || 'ok',
);
addCheck(
  'TUI parity matrix records external/shell rows as implemented only with runtime and menu evidence',
  ['open_default', 'run_shell_command'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => hasCommanderTestEvidence(item) || item.includes('registry.test.ts'))
      && row.guiActionIds?.every((actionId) => registryActionIdSet.has(actionId));
  })
    && parityRowsById.get('open_default')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Open Default App')
    && parityRowsById.get('run_shell_command')?.guiMenuPaths?.some((menuPath) => menuPath.join(' > ') === 'File > Run Shell Command')
    && read('src/ui/CommanderShell.operations.test.tsx').includes('opens files through the default app and leaves the removed editor shortcut inactive')
    && read('src/ui/CommanderShell.operations.test.tsx').includes('runs an enabled shell command directly from the input dialog'),
  'external open/shell rows require File menu parity, direct shell execution, and tests',
);
addCheck(
  'TUI parity matrix records archive rows as implemented only with virtual-directory and backend evidence',
  ['archive_compress', 'archive_extract', 'archive_extract_auto', 'archive_preview'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => hasCommanderTestEvidence(item))
      && row.guiActionIds?.every((actionId) => registryActionIdSet.has(actionId));
  })
    && parityRowsById.get('archive_preview')?.guiActionIds?.includes('archive.list')
    && registryActionIdSet.has('archive.extractAuto')
    && registryActionIdSet.has('archive.list')
    && read('src/ui/fileActionPlans.ts').includes('archiveAutoExtractFolderName')
    && read('src/ui/archiveVirtual.ts').includes('archiveVirtualRootPath')
    && read('src/ui/CommanderShell.archives.test.tsx').includes('uses auto-extract to derive a target folder')
    && read('src/ui/CommanderShell.archives.test.tsx').includes('enters archives as virtual directories')
    && read('src/ui/archiveVirtual.test.ts').includes('archive.zip:/ paths')
    && read('src-tauri/src/operation/archive_ops.rs').includes('fn archive_entry_is_unsafe'),
  'archive rows require create/extract/auto/open-as-directory action mappings, target derivation, virtual-directory UI tests, and Rust unsafe-path defense',
);
addCheck(
  'TUI parity matrix records remaining navigation/view/help rows as implemented only with user-scenario evidence',
  ['toggle_layout', 'tab_new', 'tab_close', 'help_keys', 'quit', 'toggle_icons', 'filter_start', 'filter_clear', 'mount_points', 'goto_path', 'tab_list', 'history_list', 'bookmark_add', 'bookmark_list', 'about'].every((id) => {
    const row = parityRowsById.get(id);
    return row?.implementationStatus === 'implemented'
      && row.evidence?.some((item) => hasCommanderTestEvidence(item) || item.includes('registry.test.ts'))
      && row.guiActionIds?.every((actionId) => registryActionIdSet.has(actionId));
  })
    && registryActionIdSet.has('app.quit')
    && registryActionIdSet.has('settings.toggleIcons')
    && read('src/ui/CommanderShell.clipboard.test.tsx').includes('uses an explicit Cmd+Q/File Quit policy')
    && read('src/ui/CommanderShell.settings.test.tsx').includes('opens path, location, tab, history, bookmark, help search, and about overlays')
    && read('src/ui/CommanderShell.navigation.test.tsx').includes('applies typed filters and preserves them through refresh until clear'),
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

const requiredActionIds = requiredActionIdsFromParity(parityMatrix);
for (const actionId of requiredActionIds) {
  addCheck(`action registry includes ${actionId}`, registryActionIdSet.has(actionId), 'docs/implementation/full-scope-test-spec.md §3.6');
}
addCheck('bookmark deletion is list-scoped and old menu is absent',
  registryActionIdSet.has('bookmark.delete')
    && actionById.get('bookmark.delete')?.menuPath?.join('/') !== 'Go/Bookmark/Delete'
    && read('src/ui/useNavigationMenus.ts').includes('deleteNavigationBookmark')
    && read('src/ui/CommanderOverlays.tsx').includes('onDeleteBookmark'),
  'bookmark list deletion and settings persistence');

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
const commanderSurfaces = ['src/ui/CommanderShell.tsx', 'src/ui/FilePanel.tsx', 'src/ui/PanelHeader.tsx', 'src/ui/TopMenuBar.tsx', 'src/ui/PanelContextMenus.tsx', 'src/ui/StatusStrips.tsx'].map(read);
for (const selector of ['file-panel', 'hotkey-strip', 'panel-zone', 'bottom-status', 'columnLayoutForPanelWidth', 'entry-row-kind-']) {
  addCheck(`commander shell emits ${selector}`, read(({ 'file-panel': 'src/ui/FilePanel.tsx', 'hotkey-strip': 'src/ui/StatusStrips.tsx', 'bottom-status': 'src/ui/StatusStrips.tsx', 'columnLayoutForPanelWidth': 'src/ui/panelPresentation.ts', 'entry-row-kind-': 'src/ui/FilePanel.tsx' })[selector] ?? 'src/ui/CommanderShell.tsx').includes(selector), 'TUI-faithful shell');
}
for (const forbidden of ['persistent-sidebar', 'persistent-inspector', 'large-toolbar', 'Action preview', 'transient-overlay', 'overlay-host']) {
  addCheck(`commander shell avoids ${forbidden}`, !commanderSurfaces.some((source) => source.includes(forbidden)), 'No dashboard chrome');
}
for (const forbidden of ['MENU_ROOTS', 'ACTION_LABELS']) {
  addCheck(`commander shell avoids local ${forbidden}`, !commanderSurfaces.some((source) => source.includes(forbidden)), 'Menu/help surface is derived from the action registry');
}
for (const selector of ['menuRootsFromRegistry', 'hotkeyStripActionsFromRegistry', 'isActionAvailable']) {
  addCheck(`commander shell uses registry selector ${selector}`, read(({ menuRootsFromRegistry: 'src/ui/TopMenuBar.tsx', hotkeyStripActionsFromRegistry: 'src/ui/hotkeyStripLayout.ts', isActionAvailable: 'src/ui/useCommanderKeyboard.ts' })[selector]).includes(selector), 'No parallel hardcoded action surface in shell');
}
for (const token of ['showCreated', 'showOwner', 'showPermissions', 'formatOwnerGroup']) {
  addCheck(`commander shell supports responsive metadata token ${token}`, read('src/ui/FilePanel.tsx').includes(token), 'File metadata columns must follow TUI width-responsive behavior');
}
for (const token of ["document.addEventListener('keydown'", 'handleMovementKey', 'commanderKeyboardIsSuspended', 'aria-keyshortcuts', 'FOCUSABLE_ROW_TAB_INDEX = -1']) {
  addCheck(`commander shell includes keyboard control ${token}`, read(token === 'FOCUSABLE_ROW_TAB_INDEX = -1' ? 'src/ui/FilePanel.tsx' : token === 'aria-keyshortcuts' ? 'src/ui/CommanderShell.tsx' : 'src/ui/useCommanderKeyboard.ts').includes(token), 'Keyboard-first commander control must override web-page defaults');
}
addCheck(
  'commander shell dispatches shortcuts through registry metadata',
  read('src/ui/useCommanderKeyboard.ts').includes('matchKeyboardShortcut') && registry.includes('keyboardBindings'),
  'Keyboard shortcuts must stay derived from the action registry',
);
addCheck(
  'commander shell derives aria shortcuts from registry metadata',
  commanderShell.includes('ariaKeyShortcutsFromRegistry') && registry.includes('ariaKeyShortcutsFromRegistry'),
  'Keyboard a11y hints must stay aligned with dispatchable bindings',
);
addCheck(
  'commander shell delegates hotkey display formatting to registry helper',
  read('src/ui/StatusStrips.tsx').includes('shortcutLabelForAction') && !read('src/ui/StatusStrips.tsx').includes("defaultShortcut?.split('/')"),
  'Hotkey strip must not parse display labels locally',
);
addCheck(
  'commander shell uses panel data-source seam instead of fixture listings',
  commanderShell.includes('PanelDataSource') && !commanderShell.includes('SAMPLE_LISTINGS') && !read('src/ui/usePanelNavigation.ts').includes('SAMPLE_LISTINGS'),
  'Real listing UI must be provider-backed, not fixture-backed in core rendering',
);
addCheck(
  'commander shell wires panel navigation to listDir state flow',
  hasTest('src/ui/CommanderShell.navigation.test.tsx', 'keeps per-panel history and parent navigation on the listDir path', 'passes sort, hidden, and refresh state through listDir'),
  'Entry open/refresh/history/sort/hidden state must feed list_dir requests',
);
addCheck(
  'commander shell guards stale async panel navigation results',
  hasTest('src/ui/CommanderShell.navigation.test.tsx', 'ignores stale async navigation results that resolve after a newer request'),
  'Older list_dir responses must not overwrite newer panel state',
);
addCheck(
  'commander shell exposes real filter input path',
  commanderShell.includes('FilterPrompt') && (commanderOverlays.includes('Filter pattern') || i18nResources.includes('filterPattern')) && hasTest('src/ui/CommanderShell.navigation.test.tsx', 'applies typed filters and preserves them through refresh until clear'),
  'filter.start/filter.clear must send explicit non-null/null filter values to list_dir',
);
addCheck(
  'commander shell wires safe mutation atomic executors',
  read('src/ui/fileActionExecutors.ts').includes('atomicExecutorForAction') && read('src/ui/fileActionExecutors.ts').includes('mutationClient.createDir') && read('src/ui/fileActionExecutors.ts').includes('mutationClient.renameEntry'),
  'create_dir/rename_entry must execute through explicit atomic command adapters',
);
addCheck(
  'commander shell refreshes and focuses after safe mutation',
  read('src/ui/CommanderShell.operations.test.tsx').includes('creates a directory through the connected atomic command path and refreshes focus')
    && read('src/ui/CommanderShell.operations.test.tsx').includes('renames the focused entry through the connected atomic command path and keeps row focus'),
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
for (const dialogKind of Object.keys(metadata.dialogs)) {
  addCheck(`operation dialog supports ${dialogKind}`, metadata.actions.some((action) => action.dialogKind === dialogKind), 'G005 dialog shell coverage');
}
addCheck('operation store uses backend stub policy boundary', hasTest('src/operations/operationStore.test.ts', 'confirms copy into a queued stub operation without file I/O', 'runs connected long-running copy through operation executor instead of preview stub'), 'Stub policy applies to safe and destructive file mutation shells');
addCheck('operation store removed danger-only stub flag', !operationStore.includes('destructiveExecutionStubbed'), 'Stub policy must not hide safe mutation stubs');
addCheck('operation store separates atomic command execution mode', Object.values(metadata.dialogs).some((definition) => definition.executionMode === 'atomicCommand') && hasTest('src/operations/operationStore.test.ts', 'routes atomic command dialogs separately from long-running operation progress'), 'Atomic commands must not be queued as long-running progress');
addCheck('operation store separates long-running operation execution mode', Object.values(metadata.dialogs).some((definition) => definition.executionMode === 'longRunningOperation') && hasTest('src/operations/operationStore.test.ts', 'runs connected long-running copy through operation executor instead of preview stub'), 'Copy/move/delete/archive jobs keep operation-progress semantics');
addCheck('operation store validates safe mutation names', hasTest('src/operations/operationStore.test.ts', 'validates safe mutation names before running atomic commands'), 'create_dir/rename_entry dialog names must be validated before Rust command execution');
addCheck('operation store exposes atomic executor seam', hasTest('src/operations/operationStore.test.ts', 'runs connected createDir atomic commands without queuing progress'), 'Connected atomic commands must use request/response execution, not progress stubs');
addCheck('operation store exposes long-running executor seam', hasTest('src/operations/operationStore.test.ts', 'applies backend operation event stream transitions to progress, conflict, and summary'), 'copy/move/delete/trash must consume backend operation events instead of preview-only stubs');
addCheck('operation store preserves active controller when dismissing long-running dialog', hasTest('src/operations/operationStore.test.ts', 'keeps an active operation controller after a confirmed long-running dialog closes'), 'closing a confirmed long-running dialog must not detach summary refresh/cancel/conflict callbacks');
addCheck('operation store guards duplicate atomic submissions', hasTest('src/operations/operationStore.test.ts', 'prevents duplicate atomic submissions while the first command is pending'), 'create_dir/rename_entry dialogs must not submit duplicate filesystem requests while pending');
addCheck('operation store guards duplicate long-running submissions', hasTest('src/operations/operationStore.test.ts', 'blocks a second long-running operation while one controller is in flight'), 'long-running operation dialogs must not submit duplicate or concurrent filesystem requests while pending');
addCheck('operation store defers pending-start cancellation until real operation id', operationStoreTest.includes('defers pending-start cancellation until the real backend operation id is known') && operationStoreTest.includes('defers confirmed-dialog pending-start cancellation until the real backend operation id is known'), 'pending synthetic operation ids must not be sent to backend cancel or detach the active controller');
addCheck('operation store accepts real events while direct start uses pending alias', operationStoreTest.includes('accepts real backend progress and summary while direct copy is still bound to a pending id'), 'fast backend events must not be dropped while frontend start promise still has a synthetic pending id');
addCheck('operation store preserves controller across atomic dialogs', operationStoreTest.includes('preserves an active operation controller when opening an atomic dialog'), 'opening properties/info dialogs during active operations must not detach summary/cancel/conflict callbacks');
addCheck('operation store dismisses terminal status surface', operationStoreTest.includes('clears terminal progress when dismissing the operation summary'), 'summary dismiss must clear terminal progress so the non-modal status surface can close');
for (const conflictState of ['lastConflictDecision', 'applyAllConflictDecision', 'allOverwrite', 'allSkip']) {
  addCheck(`operation conflict model includes ${conflictState}`, read('src/operations/operationTypes.ts').includes(conflictState), 'Conflict apply-all decisions are explicit');
}
addCheck(
  'operation store keeps local operation history',
  hasTest('src/operations/operationStore.test.ts', 'keeps a bounded local operation history without duplicate operation ids'),
  'destructive and long-running actions need a local audit/history trail',
);

const rustLib = read('src-tauri/src/lib.rs');

const rustBackend = read('src-tauri/src/commands.rs');

const rustCommandErrors = validateRustCommands(Object.values(metadata.commands), rustLib, rustBackend);
addCheck('frontend commands match Rust registration and implementation', rustCommandErrors.length === 0, rustCommandErrors.join('; ') || 'ok');
addCheck('rust list_dir normalizes filter once', read('src-tauri/src/navigation.rs').includes('normalized_filter'), 'avoid repeated filter lowercasing in read_dir loop');
addCheck('rust safe mutation validates child names', read('src-tauri/src/mutation.rs').includes('validate_child_name') && read('src-tauri/src/mutation.rs').includes('already_exists'), 'create_dir/rename_entry must reject invalid names and overwrites');
addCheck('rust rename preserves source entry identity for symlinks', read('src-tauri/src/tests.rs').includes('rename_entry_renames_symlink_entry_not_target') && read('src-tauri/src/mutation.rs').includes('fs::symlink_metadata(&source)'), 'rename_entry must rename the visible entry, not a symlink target');
addCheck('rust rename uses no-replace abstraction', read('src-tauri/src/mutation.rs').includes('rename_no_replace') && read('src-tauri/src/mutation.rs').includes('RENAME_EXCL') && read('src-tauri/src/mutation.rs').includes('RENAME_NOREPLACE'), 'rename_entry overwrite prevention must not depend only on check-then-rename');
addCheck('rust operation service emits progress and summary events', read('src-tauri/src/operation/runtime.rs').includes('operation_progress') && read('src-tauri/src/operation/runtime.rs').includes('operation_summary') && read('src-tauri/src/operation/runtime.rs').includes('operation_conflict'), 'long-running operation state must be observable by the GUI');
addCheck('rust operation service implements copy move delete trash policies', rustBackend.includes('start_copy') && rustBackend.includes('start_move') && read('src-tauri/src/operation/delete.rs').includes('DeleteMode::Trash') && read('src-tauri/src/operation/runtime.rs').includes('PERMANENT_DELETE'), 'copy/move/delete/trash must be real backend commands with safety policies');
addCheck('rust trash does not fall back to permanent delete', read('src-tauri/src/operation/trash_restore.rs').includes('trash::delete(source)') && read('src-tauri/src/operation/delete.rs').includes('trash_recorder.trash(target)') && !read('src-tauri/src/operation/trash_restore.rs').includes('delete_tree_cancellable') && read('src-tauri/src/tests.rs').includes('start_delete_trash_failure_keeps_source_without_permanent_fallback'), 'trash failure must be recoverable and must not silently remove files permanently');
addCheck('rust archive commands use safe external provider boundary', read('src-tauri/src/operation/archive_ops.rs').includes('archive_entry_is_unsafe') && read('src-tauri/src/operation/archive_ops.rs').includes('common_source_parent') && read('src-tauri/src/commands.rs').includes('start_archive_add') && read('src-tauri/src/archive.rs').includes('errors.archiveProviderUnavailable'), 'archive create/extract/add/list must avoid unsafe paths and absolute source entries');
addCheck(
  'archive virtual directories enforce read-only mutations while preserving copy-out',
  registry.includes('activePathIsArchive')
    && registry.includes('canMutateFilesystem')
    && read('src/ui/FilePanel.tsx').includes('archiveReadOnly')
    && read('src/ui/CommanderShell.archives.test.tsx').includes('shows archive virtual directories as read-only'),
  'archive delete/rename/move/new-folder must be unavailable and the panel must explain the read-only policy',
);
addCheck(
  'archive providers cover every required format',
  hasTest('src/verification/fullScope.test.ts', 'recognizes every required archive format as a virtual directory')
    && hasTest('src-tauri/src/tests.rs', 'archive_required_formats_create_list_and_extract_round_trip'),
  'zip/tar/tar.gz/tgz/tar.zst/tzst/7z/jar/war require create/list/extract evidence',
);
addCheck(
  'archive password UI and backend keep secrets out of summaries',
  commanderShell.includes('ArchivePasswordPrompt')
    && read('src/operations/OperationInputs.tsx').includes('type="password"')
    && read('src-tauri/src/tests.rs').includes('archive_password_round_trip_and_unsafe_entry_guards')
    && read('src-tauri/src/tests.rs').includes('archive_7z_password_and_large_listing_when_provider_is_available')
    && i18nResources.includes('errors.archivePasswordRequired')
    && i18nResources.includes('errors.archivePasswordInvalid'),
  'zip/7z password input must be masked and password values must not appear in operation summaries',
);
addCheck(
  'archive listing is bounded and reports truncation',
  read('src-tauri/src/archive.rs').includes('DEFAULT_ARCHIVE_LIST_LIMIT')
    && read('src-tauri/src/archive.rs').includes('MAX_ARCHIVE_LIST_LIMIT')
    && read('src-tauri/src/tests.rs').includes('archive_listing_limit_reports_truncation')
    && read('src/ui/commanderTypes.ts').includes('ARCHIVE_LIST_LIMIT')
    && read('src/ui/FilePanel.tsx').includes('partialArchive')
    && read('src/ui/CommanderShell.archives.test.tsx').includes('reports truncated listings'),
  'large zip/7z listings must use a bounded response and expose partial-list state',
);
addCheck('rust shell command is gated by settings and one-shot token', read('src-tauri/src/contracts.rs').includes('ShellCommandPolicy') && read('src-tauri/src/shell_command.rs').includes('consume_token') && read('src-tauri/src/shell_command.rs').includes('used = true'), 'shell command must stay disabled by default and require a confirm token');
addCheck('rust settings persist bookmarks and layout', read('src-tauri/src/settings_service.rs').includes('BOKSLDIRGUI_SETTINGS_PATH') && read('src-tauri/src/settings_service.rs').includes('validate_settings') && read('src-tauri/src/settings_service.rs').includes('layout.ratio'), 'settings must persist bookmark/layout GUI state safely');

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
const cargoVersion = read('src-tauri/Cargo.toml').match(/^version = "([^"]+)"/m)?.[1];
const packageLock = JSON.parse(read('package-lock.json'));
addCheck(
  'app version matches npm, Tauri, Rust, and lockfile declarations',
  Boolean(packageJson.version)
    && packageJson.version === tauriConf.version
    && packageJson.version === cargoVersion
    && packageJson.version === packageLock.version
    && packageJson.version === packageLock.packages?.['']?.version,
  `npm=${packageJson.version}, tauri=${tauriConf.version}, rust=${cargoVersion}, lock=${packageLock.version}`,
);
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
for (const token of ['TauriResult', 'normalizeInvokeError']) {
  addCheck(`tauri client exposes ${token}`, tauriClient.includes(token), 'Frontend wrappers must return typed command results and errors');
}
addCheck('tauri client marks safe mutation handlers implemented', tauriClient.includes('COMMANDS.createDir') && tauriClient.includes('COMMANDS.renameEntry'), 'create_dir/rename_entry frontend capability must match Rust handler registration');
addCheck('tauri client marks long-running operation handlers implemented', tauriClient.includes('COMMANDS.startCopy') && tauriClient.includes('COMMANDS.startMove') && tauriClient.includes('COMMANDS.startDelete') && tauriClient.includes('listenOperationEvents'), 'copy/move/delete/trash frontend capability must match Rust handler registration and event stream');
addCheck('tauri client marks archive/external/shell/settings implemented', tauriClient.includes('COMMANDS.archiveCreate') && tauriClient.includes('COMMANDS.archiveAdd') && tauriClient.includes('COMMANDS.openDefault') && tauriClient.includes('COMMANDS.runShellCommand') && tauriClient.includes('COMMANDS.saveSettings'), 'remaining command wrappers must match Rust handler registration');

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
for (const token of ['COMMANDS.archiveCreate', 'COMMANDS.runShellCommand', 'contextMenuActions', 'archive.list']) {
  addCheck(`full-scope test covers ${token}`, fullScopeTest.includes(token), 'Semantic verification beyond static smoke');
}

for (const token of ['I18N_RESOURCES', "'ko'", "'en'"]) {
  addCheck(`i18n resources include ${token}`, i18nResources.includes(token), 'message keys must have Korean and English resources');
}
addCheck('i18n resources translate every Rust message key', hasTest('src/verification/fullScope.test.ts', 'translates every message key the Rust backend can return'), 'Korean and English text for every errors.* and settings.* key the backend returns');
addCheck('frontend event names match Rust event constants', hasTest('src/tauri/contract.test.ts', 'keeps frontend event names identical to the Rust event constants'), 'no subscription to events the backend never emits');
addCheck('bulk rename and trash undo DTOs share the contract fixture', hasTest('src/tauri/contract.test.ts', 'consumes the bulk rename and trash undo contract also checked by Rust') && hasTest('src-tauri/src/contract_tests.rs', 'bulk_rename_and_trash_undo_wire_fields_are_stable'), 'src/tauri/fixtures/contract.json');

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

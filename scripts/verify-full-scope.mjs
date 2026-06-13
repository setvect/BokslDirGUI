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
const requiredActionIds = [
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
  'archive.preview',
  'archive.create',
  'archive.extract',
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
  'settings.theme',
  'settings.language',
  'settings.sizeFormat',
  'help.shortcuts',
  'help.search',
  'help.about',
];
for (const actionId of requiredActionIds) {
  addCheck(`action registry includes ${actionId}`, registry.includes(`id: '${actionId}'`), 'docs/implementation/full-scope-test-spec.md §3.6');
}

const domainTypes = read('src/domain/types.ts');
for (const state of ['idle', 'validating', 'scanning', 'queued', 'waitingForConflict', 'running', 'cancelling', 'completed', 'completedWithErrors', 'failed', 'cancelled']) {
  addCheck(`operation state includes ${state}`, domainTypes.includes(`'${state}'`), 'OperationState union');
}
for (const decision of ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel']) {
  addCheck(`conflict decision includes ${decision}`, domainTypes.includes(`'${decision}'`), 'ConflictDecision union');
}

const commanderShell = read('src/ui/CommanderShell.tsx');
for (const selector of ['file-panel', 'hotkey-strip', 'panel-zone', 'overlay-host']) {
  addCheck(`commander shell emits ${selector}`, commanderShell.includes(selector), 'TUI-faithful shell');
}
for (const forbidden of ['persistent-sidebar', 'persistent-inspector', 'large-toolbar']) {
  addCheck(`commander shell avoids ${forbidden}`, !commanderShell.includes(forbidden), 'No dashboard chrome');
}
for (const forbidden of ['MENU_ROOTS', 'ACTION_LABELS']) {
  addCheck(`commander shell avoids local ${forbidden}`, !commanderShell.includes(forbidden), 'Menu/help surface is derived from the action registry');
}
for (const selector of ['menuRootsFromRegistry', 'hotkeyStripActionsFromRegistry', 'isActionAvailable']) {
  addCheck(`commander shell uses registry selector ${selector}`, commanderShell.includes(selector), 'No parallel hardcoded action surface in shell');
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
  commanderShell.includes('FilterPrompt') && commanderShell.includes('Filter pattern') && commanderShell.includes("Object.hasOwn(options, 'filter')"),
  'filter.start/filter.clear must send explicit non-null/null filter values to list_dir',
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
for (const dialogKind of ['copy', 'move', 'trash', 'deletePermanent', 'rename', 'createDir', 'archiveCreate', 'archiveExtract', 'externalEditor', 'shellCommand']) {
  addCheck(`operation dialog supports ${dialogKind}`, operationStore.includes(`'${dialogKind}'`), 'G005 dialog shell coverage');
}
addCheck('operation store uses backend stub policy boundary', operationStore.includes('backendExecutionStubbed'), 'Stub policy applies to safe and destructive file mutation shells');
addCheck('operation store removed danger-only stub flag', !operationStore.includes('destructiveExecutionStubbed'), 'Stub policy must not hide safe mutation stubs');
addCheck('operation store separates atomic command execution mode', operationStore.includes("'atomicCommand'") && operationStore.includes('dialogExecutionModeForDialog'), 'Atomic commands must not be queued as long-running progress');
addCheck('operation store separates long-running operation execution mode', operationStore.includes("'longRunningOperation'") && operationStore.includes('LONG_RUNNING_DIALOGS'), 'Copy/move/delete/archive jobs keep operation-progress semantics');
for (const conflictState of ['lastConflictDecision', 'applyAllConflictDecision', 'allOverwrite', 'allSkip']) {
  addCheck(`operation conflict model includes ${conflictState}`, operationStore.includes(conflictState), 'Conflict apply-all decisions are explicit');
}

const rustLib = read('src-tauri/src/lib.rs');
for (const command of ['list_dir', 'get_metadata', 'watch_path', 'goto_path', 'list_locations']) {
  addCheck(`rust handler includes ${command}`, rustLib.includes(command), 'read-only command bridge');
}
addCheck('rust list_dir normalizes filter once', rustLib.includes('normalized_filter'), 'avoid repeated filter lowercasing in read_dir loop');

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
for (const token of ['tauriClient.startDelete', 'contextMenuActions', 'isBackendImplementedCommand', 'archive.preview']) {
  addCheck(`full-scope test covers ${token}`, fullScopeTest.includes(token), 'Semantic verification beyond static smoke');
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

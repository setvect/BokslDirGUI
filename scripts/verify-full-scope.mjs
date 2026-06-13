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

const operationStore = read('src/operations/operationStore.ts');
for (const dialogKind of ['copy', 'move', 'trash', 'deletePermanent', 'rename', 'createDir', 'archiveCreate', 'archiveExtract', 'externalEditor', 'shellCommand']) {
  addCheck(`operation dialog supports ${dialogKind}`, operationStore.includes(`'${dialogKind}'`), 'G005 dialog shell coverage');
}
addCheck('operation store uses backend stub policy boundary', operationStore.includes('backendExecutionStubbed'), 'Stub policy applies to safe and destructive file mutation shells');
addCheck('operation store removed danger-only stub flag', !operationStore.includes('destructiveExecutionStubbed'), 'Stub policy must not hide safe mutation stubs');
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

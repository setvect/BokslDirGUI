import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(root, name), 'utf8');
const html = read('index.html');
const css = read('styles.css');
const js = read('app.js');

const checks = [];
function check(name, pass, detail = '') {
  checks.push({ name, pass: Boolean(pass), detail });
}

const count = (needle, haystack) => haystack.split(needle).length - 1;
const rowCount = count('<tr data-kind', html) + count('<tr class="selected"', html);

check('panel-zone exists', html.includes('class="panel-zone"'));
check('exactly two file panels', count('class="file-panel', html) === 2, `found ${count('class="file-panel', html)}`);
check('hotkey strip exists', html.includes('class="hotkey-strip"'));
check('top menu popover exists', html.includes('data-menu-popover'));
check('transient overlay exists', html.includes('data-transient-overlay'));
check('context menu exists', html.includes('class="context-menu"'));
check('operation dialog exists', html.includes('id="operation-dialog"'));
check('no persistent sidebar markup', !html.includes('class="sidebar"'));
check('no persistent inspector markup', !html.includes('class="inspector"'));
check('no large toolbar markup', !html.includes('class="toolbar"'));
check('no role=application overreach', !html.includes('role="application"'));
check('dense row fixture count', rowCount >= 30, `found ${rowCount}`);
check('monospace terminal CSS', css.includes('SFMono-Regular') && css.includes('monospace'));
check('bottom console CSS', css.includes('.bottom-console') && css.includes('.panel-status') && css.includes('.hotkey-strip'));
check('no duplicate global status bar', !html.includes('class="status-bar"'));
check('prototype quarantine banner in app.js', js.includes('PROTOTYPE QUARANTINE'));
check('prototype quarantine section in README', read('README.md').includes('Prototype quarantine'));
check('template safety rule in app.js', js.includes('TEMPLATE SAFETY RULE'));
check('runtime item values use safe aliases', !/\$\{(?:selected|label|state\.currentItem|state\.selectedNames|state\.currentKind)\}/.test(js));

const forbidden = [
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'fetch(',
  'XMLHttpRequest',
  'showOpenFilePicker',
  'showSaveFilePicker',
  'FileSystem',
  'eval(',
  'new Function',
  "from 'node:fs'",
  'require(\'fs\')',
  'require("fs")',
];
for (const token of forbidden) {
  check(`forbidden API absent: ${token}`, !js.includes(token));
}

const syntax = spawnSync(process.execPath, ['--check', join(root, 'app.js')], { encoding: 'utf8' });
check('app.js syntax check', syntax.status === 0, syntax.stderr.trim());

let failed = 0;
for (const item of checks) {
  const prefix = item.pass ? 'PASS' : 'FAIL';
  console.log(`${prefix} ${item.name}${item.detail ? ` (${item.detail})` : ''}`);
  if (!item.pass) failed += 1;
}
if (failed > 0) {
  console.error(`\n${failed} verification check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${checks.length} clickable prototype checks passed.`);

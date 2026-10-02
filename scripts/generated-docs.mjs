import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const cell = (value) => String(value ?? '없음').replaceAll('|', '\\|').replace(/\r?\n/g, '<br>');
const code = (value) => `\`${String(value).replaceAll('`', '&#96;')}\``;
const codes = (values) => values.length ? values.map(code).join(', ') : '없음';
const table = (headers, rows) => [headers, headers.map(() => '---'), ...rows]
  .map((row) => `| ${row.map(cell).join(' | ')} |`).join('\n');
const menuPaths = (paths) => paths.map((path) => path.join(' > ')).join('<br>') || '없음';

// 구현 속성은 레지스트리, 동등성 상태/근거는 독립 요구사항 JSON을 그대로 사용.
export function generatedDocSections(actions, parity) {
  const counts = new Map();
  for (const row of parity.tuiActions) counts.set(row.implementationStatus, (counts.get(row.implementationStatus) ?? 0) + 1);
  const p0Gaps = parity.tuiActions.filter((row) => row.priority === 'P0' && !['implemented', 'excluded'].includes(row.implementationStatus));
  return {
    'docs/implementation/action-registry.md': {
      'action-table': table(['ID', '범주', '표시 단축키', '실제 키 바인딩', '메뉴', '위험도', '실행 경로'], actions.map((action) => [
        code(action.id), action.category, action.shortcutLabel ?? '없음', codes(action.keyboardBindings ?? []),
        menuPaths(action.menuPath ? [action.menuPath] : []), action.dangerLevel, action.runPath,
      ])),
    },
    'docs/implementation/tui-parity-matrix.md': {
      'parity-summary': table(['상태', '개수'], [...counts.entries()]),
      'parity-p0-gaps': `- ${codes(p0Gaps.map((row) => row.tuiId))}`,
      'parity-missing': `- ${codes(parity.tuiActions.filter((row) => row.implementationStatus === 'missing').map((row) => row.tuiId))}`,
      'parity-menu-roots': table(['Root', 'Hotkey', 'TUI action ids'], parity.menuRoots.map((root) => [root.label, root.hotkey, codes(root.actionIds)])),
      'parity-gui-extensions': table(['GUI action', '이유'], parity.guiOnlyExtensions.map((item) => [code(item.guiActionId), item.reason])),
      'parity-mapping': table(['TUI id', 'TUI shortcut', 'TUI menu path', 'GUI action', 'Status', 'Priority', 'Note'], parity.tuiActions.map((row) => [
        code(row.tuiId), row.tuiShortcutDisplay ?? '없음', menuPaths(row.tuiMenuPaths), codes(row.guiActionIds),
        row.implementationStatus, row.priority, row.notes,
      ])),
    },
  };
}

export function replaceGeneratedSections(source, sections) {
  let result = source;
  for (const [name, content] of Object.entries(sections)) {
    const begin = `<!-- BEGIN GENERATED:${name} -->`;
    const end = `<!-- END GENERATED:${name} -->`;
    if (result.split(begin).length !== 2 || result.split(end).length !== 2) {
      throw new Error(`생성 구간 표시 누락 또는 중복: ${name}`);
    }
    const start = result.indexOf(begin) + begin.length;
    const finish = result.indexOf(end);
    if (finish < start || /<!-- (?:BEGIN|END) GENERATED:/.test(result.slice(start, finish))) {
      throw new Error(`생성 구간 순서 또는 중첩 오류: ${name}`);
    }
    result = result.slice(0, start) + '\n' + content + '\n' + result.slice(finish);
  }
  return result;
}

// 전체 문서의 표시 경계를 먼저 검증하고, generate 모드에서 변경된 파일만 저장.
export async function syncGeneratedDocs(root, documents, { check = true } = {}) {
  const pending = [];
  for (const [path, sections] of Object.entries(documents)) {
    const fullPath = join(root, path);
    const source = await readFile(fullPath, 'utf8');
    const generated = replaceGeneratedSections(source, sections);
    if (source !== generated) pending.push({ path, fullPath, generated });
  }
  if (!check) {
    for (const item of pending) await writeFile(item.fullPath, item.generated);
  }
  return pending.map((item) => item.path);
}

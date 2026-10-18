import assert from 'node:assert/strict';
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { generatedDocSections, replaceGeneratedSections, syncGeneratedDocs } from './generated-docs.mjs';
import { test } from 'node:test';
import { loadFeatureMetadata, projectRoot } from './load-feature-metadata.mjs';
import { preparedToolsValid, sha256, toolName, verifyDownload, version } from './archive-tools.mjs';

const metadata = await loadFeatureMetadata();
const { validateRustCommands } = metadata.validation;
const lib = await readFile(new URL('../src-tauri/src/lib.rs', import.meta.url), 'utf8');
const commands = await readFile(new URL('../src-tauri/src/commands.rs', import.meta.url), 'utf8');
const names = Object.values(metadata.commands);

test('압축 도구 다운로드 변조와 지원하지 않는 CPU를 거부', () => {
  const bytes = Buffer.from('official fixture');
  assert.equal(verifyDownload(bytes, { name: 'fixture', sha256: sha256(bytes) }), bytes);
  assert.throws(() => verifyDownload(Buffer.from('modified'), { name: 'fixture', sha256: sha256(bytes) }), /SHA-256/);
  assert.equal(toolName('win32', 'x64'), '7za.exe');
  assert.equal(toolName('darwin', 'arm64'), '7zz');
  assert.throws(() => toolName('win32', 'arm64'), /미지원/);
});

test('준비된 압축 도구의 손상·구버전·다른 플랫폼 리소스를 재사용하지 않음', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'archive-tool-test-'));
  try {
    const files = {};
    for (const name of ['7za.exe', 'License.txt', 'NOTICE.txt']) {
      const bytes = Buffer.from(name);
      await writeFile(join(directory, name), bytes);
      files[name] = sha256(bytes);
    }
    const manifest = { version, platform: 'win32', arch: 'x64', files };
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    assert.equal(await preparedToolsValid(directory, 'win32', 'x64'), true);
    assert.equal(await preparedToolsValid(directory, 'darwin', 'arm64'), false);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify({ ...manifest, version: 'old' }));
    assert.equal(await preparedToolsValid(directory, 'win32', 'x64'), false);
    await writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
    await writeFile(join(directory, '7za.exe'), 'modified');
    assert.equal(await preparedToolsValid(directory, 'win32', 'x64'), false);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('프론트 명령을 실제 Rust 등록과 구현에 대조', () => {
  assert.deepEqual(validateRustCommands(names, lib, commands), []);
});
test('프론트 목록이 같아도 Rust 등록 누락은 실패', () => {
  assert.ok(validateRustCommands(names, lib.replace('commands::open_default,', ''), commands)
    .some((error) => error.includes('미등록 명령: open_default')));
});
test('등록만 남고 Tauri 구현이 없으면 실패', () => {
  assert.ok(validateRustCommands(names, lib, commands.replace('fn open_default(', 'fn removed_default('))
    .some((error) => error.includes('구현 없음: open_default')));
});
test('미분류 네이티브 명령과 중복 등록은 실패', () => {
  assert.ok(validateRustCommands(names.filter((name) => name !== 'open_default'), lib, commands)
    .some((error) => error.includes('분류되지 않은 Rust 명령: open_default')));
  assert.ok(validateRustCommands(names, lib.replace('commands::open_default,', 'commands::open_default, commands::open_default,'), commands)
    .some((error) => error.includes('중복 Rust')));
});

const parity = JSON.parse(await readFile(new URL('../docs/implementation/tui-parity-matrix.json', import.meta.url), 'utf8'));
const { validateFeatureMetadata } = metadata.validation;
const validateActions = (actions) => validateFeatureMetadata(actions, names, metadata.dialogs, parity);

test('독립 요구사항과 실제 액션·다이얼로그 계약 일치', () => {
  assert.deepEqual(validateActions(metadata.actions), []);
});
test('구현에서 필수 액션을 제거해도 요구사항은 남아 누락 검출', () => {
  assert.ok(validateActions(metadata.actions.filter((action) => action.id !== 'file.copy'))
    .includes('필수 액션 누락: file.copy'));
});
test('잘못된 다이얼로그 연결과 연결 해제 검출', () => {
  const replaced = (kind) => metadata.actions.map((action) => action.id === 'file.copy' ? { ...action, dialogKind: kind } : action);
  assert.ok(validateActions(replaced('unknown')).includes('알 수 없는 다이얼로그: file.copy → unknown'));
  assert.ok(validateActions(replaced('rename')).includes('연결 액션이 없는 다이얼로그: copy'));
  assert.ok(validateActions(replaced(undefined)).includes('연결 액션이 없는 다이얼로그: copy'));
});
test('제외된 항목을 구현 완료 요구로 재사용하지 않음', () => {
  const fixture = structuredClone(parity);
  fixture.tuiActions.find((row) => row.tuiId === 'open_terminal_editor').guiActionIds = ['file.copy'];
  assert.ok(validateFeatureMetadata(metadata.actions, names, metadata.dialogs, fixture)
    .includes('제외된 요구사항에 GUI 매핑 존재: open_terminal_editor'));
});
test('문서 표는 실행 코드의 존재로 동등성 상태를 승격하지 않음', () => {
  const fixture = structuredClone(parity);
  fixture.tuiActions.find((row) => row.tuiId === 'copy').implementationStatus = 'partial';
  const sections = generatedDocSections(metadata.actions, fixture)['docs/implementation/tui-parity-matrix.md'];
  assert.match(sections['parity-mapping'], /`file.copy` \| partial \| P0/);
  assert.match(sections['parity-p0-gaps'], /`copy`/);
  assert.match(sections['parity-summary'], /excluded \| 5/);
  assert.match(sections['parity-mapping'], /2026-10-03/);
});
test('생성 경계 밖 수동 설명·과거 기록 보존과 반복 생성의 동일성', () => {
  const original = '설명\n<!-- BEGIN GENERATED:test -->\n이전 표\n<!-- END GENERATED:test -->\n과거 검증: 실패\n';
  const sections = { test: '| 새 표 |' };
  const result = replaceGeneratedSections(original, sections);
  assert.equal(result, original.replace('이전 표', '| 새 표 |'));
  assert.equal(replaceGeneratedSections(result, sections), result);
});
test('Windows 줄바꿈을 유지하며 동일 내용은 불일치로 보고하지 않음', () => {
  const source = '설명\r\n<!-- BEGIN GENERATED:test -->\r\n| 표 |\r\n| 값 |\r\n<!-- END GENERATED:test -->\r\n과거 기록\r\n';
  assert.equal(replaceGeneratedSections(source, { test: '| 표 |\n| 값 |' }), source);
  const updated = replaceGeneratedSections(source, { test: '| 표 |\n| 새 값 |' });
  assert.equal(updated, source.replace('| 값 |', '| 새 값 |'));
  assert.equal(replaceGeneratedSections(updated, { test: '| 표 |\n| 새 값 |' }), updated);
});
test('생성 경계 누락·중복·역순·중첩은 덮어쓰기 대신 실패', () => {
  const begin = '<!-- BEGIN GENERATED:test -->';
  const end = '<!-- END GENERATED:test -->';
  for (const fixture of ['', begin, begin + begin + end, end + begin,
    begin + '<!-- BEGIN GENERATED:other -->' + end]) {
    assert.throws(() => replaceGeneratedSections(fixture, { test: '표' }), /생성 구간/);
  }
});
test('검사 모드는 불일치를 보고하되 파일 내용·수정 시각 유지', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'boksldir-doc-check-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'fixture.md');
  const source = '수동 설명\n<!-- BEGIN GENERATED:test -->\n오래된 표\n<!-- END GENERATED:test -->\n';
  const docs = { 'fixture.md': { test: '최신 표' } };
  await writeFile(path, source);
  const before = await stat(path, { bigint: true });
  assert.deepEqual(await syncGeneratedDocs(root, docs, { check: true }), ['fixture.md']);
  assert.equal(await readFile(path, 'utf8'), source);
  assert.equal((await stat(path, { bigint: true })).mtimeNs, before.mtimeNs);
  assert.deepEqual(await syncGeneratedDocs(root, docs, { check: false }), ['fixture.md']);
  const generated = await readFile(path, 'utf8');
  const generatedStat = await stat(path, { bigint: true });
  assert.deepEqual(await syncGeneratedDocs(root, docs, { check: false }), []);
  assert.deepEqual(await syncGeneratedDocs(root, docs, { check: true }), []);
  assert.equal(await readFile(path, 'utf8'), generated);
  assert.equal((await stat(path, { bigint: true })).mtimeNs, generatedStat.mtimeNs);
});

test('docs:check CLI는 시험용 문서 불일치에 실패하고 파일을 수정하지 않음', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'boksldir-doc-cli-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'docs/implementation'), { recursive: true });
  for (const path of ['scripts/generate-docs.mjs', 'scripts/generated-docs.mjs', 'scripts/load-feature-metadata.mjs',
    'docs/implementation/tui-parity-matrix.json', 'docs/implementation/tui-parity-matrix.md', 'docs/implementation/action-registry.md']) {
    await copyFile(join(projectRoot, path), join(root, path));
  }
  await symlink(join(projectRoot, 'src'), join(root, 'src'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(join(projectRoot, 'node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const path = join(root, 'docs/implementation/action-registry.md');
  const original = await readFile(path, 'utf8');
  const stale = original.replace('<!-- BEGIN GENERATED:action-table -->', '<!-- BEGIN GENERATED:action-table -->\n오래된 내용');
  await writeFile(path, stale);
  const before = await stat(path, { bigint: true });
  const run = spawnSync(process.execPath, ['scripts/generate-docs.mjs', '--check'], { cwd: root, encoding: 'utf8' });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /생성 문서 불일치/);
  assert.equal(await readFile(path, 'utf8'), stale);
  assert.equal((await stat(path, { bigint: true })).mtimeNs, before.mtimeNs);
});

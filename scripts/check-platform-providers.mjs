import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparedToolsValid, toolName, version } from './archive-tools.mjs';

// 도구 존재 검사는 포맷별 실행 검증을 대체하지 않음.
const root = fileURLToPath(new URL('..', import.meta.url));
const toolDirectory = join(root, 'src-tauri/resources/archive-tools');
const tool = join(toolDirectory, toolName(process.platform, process.arch));
const intact = await preparedToolsValid(toolDirectory, process.platform, process.arch);
const probe = intact ? spawnSync(tool, ['i'], { encoding: 'utf8', timeout: 10000, windowsHide: true }) : null;
const toolReady = probe?.status === 0 && probe.stdout.includes(version);
const zipUsesSevenZip = process.platform === 'win32' || process.env.BOKSLDIRGUI_TEST_WINDOWS_ARCHIVES;
const groups = zipUsesSevenZip ? [] : [['zip'], ['unzip'], ['zipinfo'], ['tar']];
const providers = groups.map(names => {
  const found = names.find(name => !spawnSync(name, ['--help'], { stdio: 'ignore', timeout: 10000 }).error);
  return { names, found: found ?? null };
});
providers.push({ names: [`bundled 7-Zip ${version}`], found: toolReady ? tool : null });
const report = { os: process.platform, complete: providers.every(item => item.found), providers,
  builtInFormats: ['tar', 'tar.gz', 'tgz', 'tar.zst', 'tzst'],
  note: '도구 탐색 결과만 포함. 실제 압축 기능·Windows 지원 완료와 구분.' };
const directory = join(root, 'temp/verification');
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'platform-providers.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
if (!report.complete && !process.argv.includes('--report-only')) process.exitCode = 1;

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generatedDocSections, syncGeneratedDocs } from './generated-docs.mjs';
import { loadFeatureMetadata, projectRoot } from './load-feature-metadata.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new Error('사용법: node scripts/generate-docs.mjs [--check]');
}
const check = args.includes('--check');
const metadata = await loadFeatureMetadata();
const parity = JSON.parse(await readFile(join(projectRoot, 'docs/implementation/tui-parity-matrix.json'), 'utf8'));
const errors = metadata.validation.validateFeatureMetadata(metadata.actions, Object.values(metadata.commands), metadata.dialogs, parity);
if (errors.length) throw new Error(errors.join('\n'));
const changed = await syncGeneratedDocs(projectRoot, generatedDocSections(metadata.actions, parity), { check });
if (check && changed.length) {
  console.error(`생성 문서 불일치: ${changed.join(', ')}\nnpm run docs:generate 실행 필요`);
  process.exitCode = 1;
} else {
  console.log(check ? '생성 문서 정합성 확인 완료' : `생성 문서 갱신: ${changed.length}개`);
}

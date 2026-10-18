import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { assets, preparedToolsValid, release, sha256, toolName, verifyDownload, version } from './archive-tools.mjs';

const platform = process.platform;
const arch = process.arch;
const binary = toolName(platform, arch);
const destination = fileURLToPath(new URL('../src-tauri/resources/archive-tools/', import.meta.url));
if (await preparedToolsValid(destination, platform, arch)) {
  console.log(`압축 도구 ${version} 확인 완료 (${platform}/${arch})`);
} else {
  const temporary = await mkdtemp(join(tmpdir(), 'boksldir-archive-tools-'));
  try {
    const download = async asset => {
      const response = await fetch(release + asset.name, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error(`압축 도구 다운로드 실패: ${response.status}`);
      const bytes = verifyDownload(Buffer.from(await response.arrayBuffer()), asset);
      const path = join(temporary, asset.name);
      await writeFile(path, bytes);
      return path;
    };
    const extract = (program, args) => {
      const result = spawnSync(program, args, { cwd: temporary, encoding: 'utf8', timeout: 120000, windowsHide: true });
      if (result.error || result.status !== 0) throw new Error(`압축 도구 준비 실패: ${result.error ?? result.stderr}`);
    };
    if (platform === 'win32') {
      const archive = await download(assets.windows);
      const bootstrap = await download(assets.bootstrap);
      extract(bootstrap, ['e', '-y', archive, 'x64/7za.exe', 'License.txt', `-o${temporary}`]);
    } else {
      const archive = await download(platform === 'darwin' ? assets.mac : assets[`linux_${arch}`]);
      extract('/usr/bin/tar', ['-xf', archive, '-C', temporary, '7zz', 'License.txt']);
      await chmod(join(temporary, binary), 0o755);
    }
    const notice = `7-Zip ${version}\nCopyright (C) 1999-2026 Igor Pavlov\nUnmodified standalone executable distributed under the accompanying License.txt.\nCorresponding source: ${release}7z2604-src.tar.xz\nProject: https://www.7-zip.org/\n`;
    await writeFile(join(temporary, 'NOTICE.txt'), notice);
    const names = [binary, 'License.txt', 'NOTICE.txt'];
    const files = Object.fromEntries(await Promise.all(names.map(async name => [name, sha256(await readFile(join(temporary, name)))])));
    const staging = fileURLToPath(new URL('../src-tauri/resources/archive-tools.preparing/', import.meta.url));
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });
    for (const name of names) await copyFile(join(temporary, name), join(staging, name));
    await writeFile(join(staging, 'manifest.json'), JSON.stringify({ version, platform, arch, files }, null, 2) + '\n');
    await rm(destination, { recursive: true, force: true });
    await rename(staging, destination);
    console.log(`압축 도구 ${version} 준비 완료 (${platform}/${arch})`);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

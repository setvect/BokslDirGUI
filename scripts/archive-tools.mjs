import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const version = '26.04';
export const release = `https://github.com/ip7z/7zip/releases/download/${version}/`;
export const assets = {
  mac: { name: '7z2604-mac.tar.xz', sha256: 'bee04358cbcbc7106273cee0e8d72916db2696c48067a3538c34d8cd6fd16578' },
  windows: { name: '7z2604-extra.7z', sha256: 'dc4b11d3399db18b063630137145f5585d8f7ac847bf3639bd1185d7d1f7cee0' },
  bootstrap: { name: '7zr.exe', sha256: '256feca8e274e5da655e2a284fabafd9f554365eb164862089dacd4e8276d282' },
};
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function verifyDownload(bytes, asset) {
  if (sha256(bytes) !== asset.sha256) throw new Error(`압축 도구 SHA-256 불일치: ${asset.name}`);
  return bytes;
}
export function toolName(platform, arch) {
  if (platform === 'darwin' && ['arm64', 'x64'].includes(arch)) return '7zz';
  if (platform === 'win32' && arch === 'x64') return '7za.exe';
  throw new Error(`압축 도구 배포 미지원 대상: ${platform}/${arch}`);
}
export async function preparedToolsValid(directory, platform, arch) {
  try {
    const manifest = JSON.parse(await readFile(join(directory, 'manifest.json'), 'utf8'));
    const expected = [toolName(platform, arch), 'License.txt', 'NOTICE.txt'];
    if (manifest.version !== version || manifest.platform !== platform || manifest.arch !== arch) return false;
    return (await Promise.all(expected.map(async name =>
      sha256(await readFile(join(directory, name))) === manifest.files[name]))).every(Boolean);
  } catch { return false; }
}

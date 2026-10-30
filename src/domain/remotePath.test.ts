import { describe, expect, it } from 'vitest';
import fixture from '../tauri/fixtures/remote-paths.json';
import { isRemotePath, parseRemotePath, remoteLocationKey, remotePathJoin, remotePathParent, remoteUrl } from './remotePath';

describe('remote path', () => {
  it('parses and formats the same cases as the Rust remote path module', () => {
    for (const item of fixture.valid) {
      const parsed = parseRemotePath(item.input);
      expect(parsed, item.input).toEqual({ user: item.user, host: item.host, port: item.port, path: item.path });
      expect(remoteUrl(parsed!, parsed!.path)).toBe(item.url);
      expect(parseRemotePath(item.url)).toEqual(parsed);
    }
    for (const input of fixture.invalid) {
      expect(parseRemotePath(input), input).toBeNull();
    }
  });

  it('joins names, finds parents and keys connections by user, host and port', () => {
    const base = parseRemotePath('sftp://u@h:2222/srv/data')!;
    expect(remotePathJoin(base, '새 폴더')).toBe('sftp://u@h:2222/srv/data/새 폴더');
    expect(remotePathParent(base)).toBe('sftp://u@h:2222/srv');
    expect(remotePathParent(parseRemotePath('sftp://u@h/x')!)).toBe('sftp://u@h/');
    expect(remotePathParent(parseRemotePath('sftp://u@h/')!)).toBeNull();
    expect(remoteLocationKey(base)).toBe('sftp://u@h:2222/');
    expect(isRemotePath('SFTP://u@h/') && !isRemotePath('/sftp')).toBe(true);
  });
});

import { describe, expect, it } from 'vitest';
import { commonMode, formatOctalMode, modeFromPermissionText, parseOctalMode } from './remoteChmod';

describe('remote permission helpers', () => {
  it('reads listing permission text and octal input', () => {
    expect(modeFromPermissionText('drwxr-xr-x')).toBe(0o755);
    expect(modeFromPermissionText('-rw-r-----')).toBe(0o640);
    expect(modeFromPermissionText('rwx------')).toBe(0o700);
    expect(modeFromPermissionText('readonly')).toBeNull();
    expect(parseOctalMode('0644')).toBe(0o644);
    expect(parseOctalMode(' 755 ')).toBe(0o755);
    for (const invalid of ['', '75', '8888', '07777x', '12345']) expect(parseOctalMode(invalid)).toBeNull();
    expect([formatOctalMode(0o644), formatOctalMode(0o4755)]).toEqual(['644', '4755']);
  });

  it('uses a shared initial mode only when every selected item agrees', () => {
    expect(commonMode(['-rw-r--r--', '-rw-r--r--'])).toBe(0o644);
    expect(commonMode(['-rw-r--r--', 'drwxr-xr-x'])).toBeNull();
    expect(commonMode([null])).toBeNull();
  });
});

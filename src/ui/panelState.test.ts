import { describe, expect, it } from 'vitest';
import { parentPathOf } from './panelState';

describe('panel state path helpers', () => {
  it('normalizes POSIX and Windows parent paths without losing drive roots', () => {
    expect(parentPathOf('/')).toBe('/');
    expect(parentPathOf('/demo/BokslDir/docs')).toBe('/demo/BokslDir');
    expect(parentPathOf('/demo/BokslDir/docs/')).toBe('/demo/BokslDir');
    expect(parentPathOf('C:\\')).toBe('C:\\');
    expect(parentPathOf('C:\\Users\\boksl')).toBe('C:\\Users');
    expect(parentPathOf('C:/')).toBe('C:/');
    expect(parentPathOf('C:/Users')).toBe('C:/');
    expect(parentPathOf('C:/Users/boksl')).toBe('C:/Users');
  });
});

import { describe, expect, it } from 'vitest';
import { settingsFixture } from '../ui/testing/clientStubs';
import { isSettingChecked, resolveSettingUpdate } from './settingActions';

describe('remote link policy setting', () => {
  it('defaults to preserving links for settings saved before the option existed', () => {
    const legacy = settingsFixture({ remote: { sites: [], keepaliveSeconds: 45, connectTimeoutSeconds: 9 } as never });
    expect(isSettingChecked({ kind: 'remoteLinkPolicy', value: 'preserve' }, legacy)).toBe(true);
    expect(isSettingChecked({ kind: 'remoteLinkPolicy', value: 'skip' }, legacy)).toBe(false);
  });

  it('changes only the link policy and keeps the other remote settings', () => {
    const site = { id: 's', name: 'n', host: 'h', port: 22, user: 'u', authMethod: 'agent' as const, savedSecret: false };
    const current = settingsFixture({ remote: { sites: [site], keepaliveSeconds: 45, connectTimeoutSeconds: 9, linkPolicy: 'preserve' } });
    const update = resolveSettingUpdate({ kind: 'remoteLinkPolicy', value: 'follow' }, current);
    expect(update.patch).toEqual({ remote: { sites: [site], keepaliveSeconds: 45, connectTimeoutSeconds: 9, linkPolicy: 'follow' } });
  });
});

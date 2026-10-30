import { remoteSettingsOf, type RemoteLinkPolicy, type Settings } from '../domain/types';

export type SettingAction =
  | { kind: 'theme'; value: Settings['theme'] }
  | { kind: 'language'; value: Settings['language'] }
  | { kind: 'sizeFormat'; value: Settings['sizeFormat'] }
  | { kind: 'showIcons' }
  | { kind: 'remoteLinkPolicy'; value: RemoteLinkPolicy };

type SettingUpdate =
  | { kind: 'theme'; value: Settings['theme']; patch: Pick<Settings, 'theme'> }
  | { kind: 'language'; value: Settings['language']; patch: Pick<Settings, 'language'> }
  | { kind: 'sizeFormat'; value: Settings['sizeFormat']; patch: Pick<Settings, 'sizeFormat'> }
  | { kind: 'showIcons'; value: boolean; patch: Pick<Settings, 'view'> }
  | { kind: 'remoteLinkPolicy'; value: RemoteLinkPolicy; patch: Pick<Settings, 'remote'> };

export const isSettingChecked = (setting: SettingAction, settings: Settings): boolean => {
  switch (setting.kind) {
    case 'theme': return settings.theme === setting.value;
    case 'language': return settings.language === setting.value;
    case 'sizeFormat': return settings.sizeFormat === setting.value;
    case 'showIcons': return settings.view.showIcons;
    case 'remoteLinkPolicy': return remoteSettingsOf(settings).linkPolicy === setting.value;
  }
};

export const resolveSettingUpdate = (setting: SettingAction, settings: Settings): SettingUpdate => {
  switch (setting.kind) {
    case 'theme': return { ...setting, patch: { theme: setting.value } };
    case 'language': return { ...setting, patch: { language: setting.value } };
    case 'sizeFormat': return { ...setting, patch: { sizeFormat: setting.value } };
    case 'showIcons': {
      const value = !settings.view.showIcons;
      return { kind: setting.kind, value, patch: { view: { ...settings.view, showIcons: value } } };
    }
    case 'remoteLinkPolicy': return { ...setting, patch: { remote: { ...remoteSettingsOf(settings), linkPolicy: setting.value } } };
  }
};

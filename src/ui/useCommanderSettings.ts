import type { Dispatch, SetStateAction } from 'react';
import { useEffect, useRef, useState } from 'react';
import {
  type ActionId
} from '../actions/registry';
import type { PanelId, Settings } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import {
  COMMANDER_STATUS_TEXT,
  formatUserErrorMessage
} from '../i18n-resources';
import { SafeMutationClient } from '../tauri/commanderClients';
import { DEFAULT_SETTINGS, MAX_ZOOM_STEP, MIN_ZOOM_STEP, ZoomCommand, clampNumber, mergeSettings, normalizeSettings, zoomPercentForStep } from './settingsModel';

interface CommanderSettingsDependencies {
  readonly mutationClient: SafeMutationClient;
  readonly setStatusMessage: Dispatch<SetStateAction<string | null>>;
  readonly runtimeBackendAvailable: boolean;
  readonly statusText: CommanderStatusText;
  readonly setActivePanel: Dispatch<SetStateAction<PanelId>>;
}
export function useCommanderSettings(runtime: CommanderSettingsDependencies) {

  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  const settingsRef = useRef(settings);

  const persistedSettingsRef = useRef(settings);

  settingsRef.current = settings;

  const settingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const settingsSaveVersionRef = useRef(0);

  const [settingsLoaded, setSettingsLoaded] = useState(() => !runtime.mutationClient.loadSettings);

  const saveSettingsPatch = async (patch: Partial<Settings>, successMessage: string | null, options: { silent?: boolean; onSaveFailureRollback?: () => void } = {}) => {
    const nextSettings = mergeSettings(settingsRef.current, patch);
    settingsRef.current = nextSettings;
    setSettings(nextSettings);
    const version = ++settingsSaveVersionRef.current;
    if (!options.silent && successMessage) runtime.setStatusMessage(successMessage);
    if (!runtime.runtimeBackendAvailable || !runtime.mutationClient.saveSettings) return;
    const save = async () => {
      const result = await runtime.mutationClient.saveSettings!({ patch });
      if (!result.ok) {
        if (options.onSaveFailureRollback && version === settingsSaveVersionRef.current) {
          settingsRef.current = persistedSettingsRef.current;
          setSettings(persistedSettingsRef.current);
          options.onSaveFailureRollback();
        }
        runtime.setStatusMessage(runtime.statusText.settingsSaveFailed(formatUserErrorMessage(settingsRef.current.language, result.error)));
        return;
      }
      const saved = normalizeSettings(result.data);
      persistedSettingsRef.current = saved;
      if (version === settingsSaveVersionRef.current) {
        settingsRef.current = saved;
        setSettings(saved);
      }
    };
    settingsSaveQueueRef.current = settingsSaveQueueRef.current.then(save, save);
    await settingsSaveQueueRef.current;
  };

  const applyZoom = (command: ZoomCommand) => {
    const currentStep = settings.view.zoomStep;
    const nextStep = command === 'reset'
      ? 0
      : clampNumber(currentStep + (command === 'in' ? 1 : -1), MIN_ZOOM_STEP, MAX_ZOOM_STEP);
    if (nextStep === currentStep) {
      runtime.setStatusMessage(runtime.statusText.zoom(zoomPercentForStep(settings.view.zoomStep)));
      return;
    }
    void saveSettingsPatch({
      view: { ...settings.view, zoomStep: nextStep },
    }, runtime.statusText.zoom(zoomPercentForStep(nextStep)));
  };

  const applyLayout = (patch: Partial<Settings['layout']>, message: string) => {
    void saveSettingsPatch({ layout: { ...settings.layout, ...patch } }, message);
  };

  const applyDirectSetting = (actionId: ActionId) => {
    const themeByAction: Partial<Record<ActionId, Settings['theme']>> = {
      'settings.themeDark': 'dark',
      'settings.themeLight': 'light',
      'settings.themeHighContrast': 'highContrast',
    };
    const languageByAction: Partial<Record<ActionId, Settings['language']>> = {
      'settings.languageEn': 'en',
      'settings.languageKo': 'ko',
    };
    const sizeByAction: Partial<Record<ActionId, Settings['sizeFormat']>> = {
      'settings.sizeAuto': 'binary',
      'settings.sizeBytes': 'decimal',
    };
    const theme = themeByAction[actionId];
    if (theme) {
      void saveSettingsPatch({ theme }, runtime.statusText.themeChanged(theme));
      return true;
    }
    const language = languageByAction[actionId];
    if (language) {
      void saveSettingsPatch({ language }, COMMANDER_STATUS_TEXT[language].languageChanged(language));
      return true;
    }
    const sizeFormat = sizeByAction[actionId];
    if (sizeFormat) {
      void saveSettingsPatch({ sizeFormat }, runtime.statusText.sizeFormat(sizeFormat === 'binary' ? 'auto' : 'bytes'));
      return true;
    }
    if (actionId === 'settings.toggleIcons') {
      const showIcons = !settings.view.showIcons;
      void saveSettingsPatch({ view: { ...settings.view, showIcons } }, runtime.statusText.icons(showIcons));
      return true;
    }
    return false;
  };

  useEffect(() => {
    if (!runtime.runtimeBackendAvailable || !runtime.mutationClient.loadSettings) {
      setSettingsLoaded(true);
      return;
    }
    let disposed = false;
    void runtime.mutationClient.loadSettings().then((result) => {
      if (disposed) return;
      if (result.ok) {
        const loaded = normalizeSettings(result.data);
        persistedSettingsRef.current = loaded;
        setSettings(loaded);
        runtime.setActivePanel(loaded.session.activePanel);

      } else {
        runtime.setStatusMessage(runtime.statusText.settingsLoadFailed(formatUserErrorMessage(settings.language, result.error)));
      }
      setSettingsLoaded(true);
    });
    return () => { disposed = true; };
  }, [runtime.mutationClient, runtime.runtimeBackendAvailable]);

  useEffect(() => {
    const previousTheme = document.body.dataset.theme;
    document.body.dataset.theme = settings.theme;

    return () => {
      if (previousTheme) {
        document.body.dataset.theme = previousTheme;
      } else {
        delete document.body.dataset.theme;
      }
    };
  }, [settings.theme]);
  return { settings, settingsRef, saveSettingsPatch, applyLayout, applyDirectSetting, applyZoom, settingsLoaded };
}

import { describe, expect, it } from 'vitest';
import { APP_NAME, IMPLEMENTATION_BOUNDARY } from './foundation';
import { I18N_RESOURCES, translateMessageKey } from './i18n-resources';

describe('BokslDirGUI foundation contract', () => {
  it('names the Tauri app and implementation source of truth', () => {
    expect(APP_NAME).toBe('복슬Dir');
    expect(IMPLEMENTATION_BOUNDARY.runtime).toBe('tauri-react-rust');
    expect(IMPLEMENTATION_BOUNDARY.sourceOfTruth).toBe('docs/implementation');
  });

  it('keeps the clickable prototype as visual reference only', () => {
    expect(IMPLEMENTATION_BOUNDARY.mockupUse).toBe('visual-reference-only');
  });

  it('keeps Korean and English message resources for backend message keys', () => {
    for (const language of ['ko', 'en'] as const) {
      expect(I18N_RESOURCES[language]['errors.archiveFormatUnsupported']).toBeTruthy();
      expect(I18N_RESOURCES[language]['errors.shellCommandDisabled']).toBeTruthy();
      expect(I18N_RESOURCES[language]['settings.external.shellCommand.disabledByDefault']).toBeTruthy();
    }
    expect(translateMessageKey('ko', 'missing.key')).toBe('missing.key');
  });
});

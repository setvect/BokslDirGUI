import { expect, it } from 'vitest';
import type { AppError, PlatformInfo, FileEntry, OperationProgress, OperationSummary, Settings } from '../domain/types';
import { normalizeInvokeError } from './client';
import fixture from './fixtures/contract.json';
import platformFixtures from './fixtures/platform.json';

it('consumes the same camelCase and nullable fixture verified by Rust serialization', () => {
  // JSON imports widen enum strings; narrow those exact literals while checking all remaining fields.
  const entry: FileEntry = { ...fixture.entry, kind: 'directory' };
  const progress: OperationProgress = { ...fixture.progress, kind: 'archiveExtract', state: 'waitingForConflict' };
  const error: AppError = fixture.error;
  expect(entry).toEqual(fixture.entry);
  expect(progress).toEqual(fixture.progress);
  expect(normalizeInvokeError(error, 'get_metadata')).toEqual(error);
});

it('retains the persisted settings shape without a format migration', () => {
  const settings: Settings = {
    ...fixture.settings, theme: 'dark', language: 'ko', sizeFormat: 'binary',
    layout: { ...fixture.settings.layout, ratio: '50:50' },
    session: { ...fixture.settings.session, activePanel: 'right' },
    view: { ...fixture.settings.view, density: 'compact' },
  };
  expect(settings).toEqual(fixture.settings);
});

it('consumes the platform capability fixture also checked by Rust', () => {
  const platforms: PlatformInfo[] = platformFixtures;
  expect(platforms[0].features.nativeFileClipboard).toBe(true);
  expect(platforms[1].os).toBe('windows');
  expect(platforms[1].features.nativeFileClipboard).toBe(false);
});


it('consumes command output in the shared operation summary contract', () => {
  const summary: OperationSummary = { ...fixture.commandSummary, kind: 'shellCommand', state: 'cancelled' };
  expect(summary.commandResult?.truncated).toBe(true);
  expect(summary.commandResult?.stdout).toBe('부분 출력\n');
  expect(summary).toEqual(fixture.commandSummary);
});

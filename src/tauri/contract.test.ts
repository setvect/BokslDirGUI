import { expect, it } from 'vitest';
import type { AppError, PlatformInfo, FileEntry, OperationProgress, OperationSummary, NativeFileClipboard, RemoteConnectionChanged, RemoteConnectRequest, RemoteSession, RemoteSettings, RenamePreview, RenameRules, Settings, TrashUndoPreview } from '../domain/types';
import { normalizeInvokeError } from './client';
import { EVENTS } from './commands';
import { ARCHIVE_FORMATS, archiveFormatForName } from '../domain/archiveFormats';
import { remoteLocationKey } from '../domain/remotePath';
import archiveFormats from './fixtures/archive-formats.json';
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
  expect(platforms[1].features.nativeFileClipboard).toBe(true);
});


it('consumes command output in the shared operation summary contract', () => {
  const summary: OperationSummary = { ...fixture.commandSummary, kind: 'shellCommand', state: 'cancelled' };
  expect(summary.commandResult?.truncated).toBe(true);
  expect(summary.commandResult?.stdout).toBe('부분 출력\n');
  expect(summary).toEqual(fixture.commandSummary);
});


it('consumes the native clipboard copy/move contract also checked by Rust', () => {
  const clipboard: NativeFileClipboard = { ...fixture.fileClipboard, intent: 'move' };
  expect(clipboard).toEqual(fixture.fileClipboard);
  expect(clipboard.paths[0]).toBe('C:\\fixture\\한글 space.txt');
});

it('consumes the bulk rename and trash undo contract also checked by Rust', () => {
  const rules: RenameRules = fixture.renameRules;
  const preview: RenamePreview = fixture.renamePreview;
  const trash: TrashUndoPreview = { ...fixture.trashUndoPreview, entries: [{ ...fixture.trashUndoPreview.entries[0], kind: 'file' }] };
  expect(rules.preserveExtension).toBe(true);
  expect(preview.item.newName).toBe('photo 1 001.jpg');
  expect(trash).toEqual(fixture.trashUndoPreview);
});

it('consumes the remote connection contract also checked by Rust', () => {
  const request: RemoteConnectRequest = { ...fixture.remoteConnectRequest, authMethod: 'publicKey' };
  const session: RemoteSession = fixture.remoteSession;
  const changed: RemoteConnectionChanged = { ...fixture.remoteConnectionChanged, state: 'lost' };
  expect(request).toEqual(fixture.remoteConnectRequest);
  expect(session.sessionId).toBe(remoteLocationKey(session));
  expect(changed).toEqual(fixture.remoteConnectionChanged);
});

it('keeps frontend event names identical to the Rust event constants', () => {
  const rustSources = Object.values(import.meta.glob('../../src-tauri/src/**/*.rs', { query: '?raw', import: 'default', eager: true })).map(String);
  const rustEvents = rustSources.flatMap((source) => [...source.matchAll(/const [A-Z_]+_EVENT: &str = "([^"]+)";/g)].map((match) => match[1]));
  expect([...rustEvents].sort()).toEqual(Object.values(EVENTS).sort());
  for (const source of rustSources) {
    expect(source).not.toMatch(/\.emit\(\s*"/);
    expect(source).not.toMatch(/\.emit_to\([^,]+,\s*"/);
  }
});

it('keeps the archive format table identical to the Rust provider table', () => {
  expect(ARCHIVE_FORMATS).toEqual(archiveFormats);
  expect(archiveFormatForName('Bundle.TAR.GZ')).toBe('tar.gz');
  expect(archiveFormatForName('app.war')).toBe('war');
  expect(archiveFormatForName('notes.txt')).toBeNull();
});

it('consumes the remote site settings contract without secret fields', () => {
  const remote: RemoteSettings = { ...fixture.remoteSettings, sites: fixture.remoteSettings.sites.map((site) => ({ ...site, authMethod: 'publicKey' as const })) };
  expect(remote).toEqual(fixture.remoteSettings);
  expect(JSON.stringify(fixture.remoteSettings).toLowerCase()).not.toMatch(/password"|passphrase"|secret"\s*:\s*"/);
});

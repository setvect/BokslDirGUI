import { describe, expect, it } from 'vitest';
import { displayPath } from './pathDisplay';
import { shortenPath } from '../ui/textLayout';
import { COMMANDER_STATUS_TEXT, formatUserErrorMessage } from '../i18n-resources';
import { splitOperationProgressPath } from '../operations/progressPresentation';

describe('Windows path presentation', () => {
  it.each([
    [String.raw`\\?\C:` + '\\', 'C:\\'],
    [String.raw`\\?\c:\한글 폴더\name. `, String.raw`c:\한글 폴더\name. `],
    [String.raw`\\?\UNC\server\share\폴더`, String.raw`\\server\share\폴더`],
    [String.raw`\\?\unc\server\share`, String.raw`\\server\share`],
    [String.raw`\\?\C:\archive.zip:/한글/file.txt`, String.raw`C:\archive.zip:/한글/file.txt`],
    [String.raw`\\?\Volume{abc}\file`, String.raw`\\?\Volume{abc}\file`],
    [String.raw`\\.\PhysicalDrive0`, String.raw`\\.\PhysicalDrive0`],
    [String.raw`C:\일반\file`, String.raw`C:\일반\file`],
    [String.raw`/tmp/한글/\\?\C:\literal`, String.raw`/tmp/한글/\\?\C:\literal`],
  ])('formats only recognized path namespaces: %s', (path, label) => {
    expect(displayPath(path)).toBe(label);
    expect(displayPath(label)).toBe(label);
  });

  it('retains Windows drive/share roots and separators in abbreviated labels', () => {
    expect(shortenPath(String.raw`\\?\C:` + '\\')).toBe('C:\\');
    expect(shortenPath(String.raw`\\?\C:\one\two\three\four`)).toBe(String.raw`C:\…\three\four`);
    expect(shortenPath(String.raw`\\?\UNC\server\share\one\two\three\four`)).toBe(String.raw`\\server\share\…\three\four`);
  });

  it.each(['ko', 'en'] as const)('formats structured error, status and progress paths in %s', language => {
    const path = String.raw`\\?\C:\한글\file.txt`;
    const error = { messageKey: 'errors.notFound', path };
    for (const message of [formatUserErrorMessage(language, error), COMMANDER_STATUS_TEXT[language].gotoCompleted(path),
      COMMANDER_STATUS_TEXT[language].sessionRestoreUnavailable([path]), splitOperationProgressPath(path).full]) {
      expect(message).toContain(String.raw`C:\한글\file.txt`);
      expect(message).not.toContain('\\\\?\\');
    }
    expect(error.path).toBe(path);
  });
});

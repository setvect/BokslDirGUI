import { describe, expect, it } from 'vitest';
import { ARCHIVE_FILE_SUFFIXES } from '../domain/archiveFormats';
import { isArchiveVirtualPath } from './archiveVirtual';
import { archiveAutoExtractFolderName } from './fileActionPlans';

describe('archive auto-extract folder name', () => {
  it.each(ARCHIVE_FILE_SUFFIXES)('uses the archive basename for %s', (suffix) => {
    expect(archiveAutoExtractFolderName(`release-bundle${suffix}`)).toBe('release-bundle');
  });

  it('keeps case-insensitive matching, trimming and the fallback for other names', () => {
    expect(archiveAutoExtractFolderName('  Photos.TAR.ZST ')).toBe('Photos');
    expect(archiveAutoExtractFolderName('notes.txt')).toBe('notes.txt-extracted');
    expect(archiveAutoExtractFolderName('.zip')).toBe('.zip-extracted');
    expect(archiveAutoExtractFolderName('   ')).toBe('archive-extracted');
  });

  it('treats the same suffixes as archive virtual directories', () => {
    for (const suffix of ARCHIVE_FILE_SUFFIXES) {
      expect(isArchiveVirtualPath(`/tmp/fixture${suffix}:/`), suffix).toBe(true);
    }
  });
});

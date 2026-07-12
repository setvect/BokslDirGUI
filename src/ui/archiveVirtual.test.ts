import { describe, expect, it } from 'vitest';
import type { ArchiveListing, FileEntry } from '../domain/types';
import {
  archiveExitFocusPath,
  archiveListingToDirectoryListing,
  archiveParentFocusPath,
  archiveParentPath,
  archiveVirtualChildPath,
  archiveVirtualRootPath,
  parseArchiveVirtualPath,
} from './archiveVirtual';
import { DEFAULT_SORT } from './panelState';

const archivePath = '/tmp/archive.zip';

const archiveEntry = (
  innerPath: string,
  kind: FileEntry['kind'] = 'file',
  metadata: Partial<Pick<FileEntry, 'sizeBytes' | 'modifiedAt' | 'createdAt' | 'permissions'>> = {},
): FileEntry => ({
  path: `${archivePath}!${innerPath}`,
  name: innerPath.split('/').filter(Boolean).at(-1) ?? innerPath,
  kind,
  sizeBytes: metadata.sizeBytes ?? (kind === 'file' ? 100 : null),
  modifiedAt: metadata.modifiedAt ?? null,
  createdAt: metadata.createdAt ?? null,
  permissions: metadata.permissions ?? null,
  owner: null,
  group: null,
  isHidden: innerPath.split('/').at(-1)?.startsWith('.') ?? false,
  isVirtual: false,
});

const listing: ArchiveListing = {
  archivePath,
  encrypted: false,
  totalEntries: 4,
  truncated: false,
  entries: [
    archiveEntry('dist/', 'directory', { modifiedAt: '2026-07-02T23:30:28', permissions: 'drwxr-xr-x' }),
    archiveEntry('dist/app.js'),
    archiveEntry('dist/config/settings.json'),
    archiveEntry('README.md', 'file', { sizeBytes: 2048, modifiedAt: '2026-07-02T23:31:00' }),
    archiveEntry('.gitkeep'),
  ],
};

describe('archive virtual directory helpers', () => {
  it('uses archive.zip:/ paths for archive virtual directories', () => {
    expect(archiveVirtualRootPath(archivePath)).toBe('/tmp/archive.zip:/');
    expect(archiveVirtualChildPath(archivePath, 'dist/config')).toBe('/tmp/archive.zip:/dist/config');
    expect(parseArchiveVirtualPath('/tmp/archive.zip:/dist/config')).toEqual({
      archivePath,
      innerPath: 'dist/config',
    });
    for (const name of ['a.tar', 'a.tar.gz', 'a.tgz', 'a.tar.zst', 'a.tzst', 'a.7z', 'a.jar', 'a.war']) {
      expect(parseArchiveVirtualPath(`/tmp/${name}:/`)?.archivePath).toBe(`/tmp/${name}`);
    }
  });

  it('projects flat archive entries as directory listings', () => {
    const root = archiveListingToDirectoryListing({
      panelId: 'left',
      virtualPath: archiveVirtualRootPath(archivePath),
      archiveListing: listing,
      showHidden: false,
      sort: DEFAULT_SORT,
      filter: null,
    });

    expect(root.path).toBe('/tmp/archive.zip:/');
    expect(root.totalEntries).toBe(4);
    expect(root.truncated).toBe(false);
    expect(root.entries.map((entry) => entry.name)).toEqual(['..', 'dist', 'README.md']);
    expect(root.entries.find((entry) => entry.name === 'dist')).toMatchObject({
      kind: 'directory',
      path: '/tmp/archive.zip:/dist',
      modifiedAt: '2026-07-02T23:30:28',
      permissions: 'drwxr-xr-x',
    });
    expect(root.entries.find((entry) => entry.name === 'README.md')).toMatchObject({
      sizeBytes: 2048,
      modifiedAt: '2026-07-02T23:31:00',
    });
  });

  it('preserves backend truncation metadata for the panel status', () => {
    const partial = archiveListingToDirectoryListing({
      panelId: 'left',
      virtualPath: archiveVirtualRootPath(archivePath),
      archiveListing: { ...listing, totalEntries: 80_000, truncated: true },
      showHidden: false,
      sort: DEFAULT_SORT,
      filter: null,
    });

    expect(partial.totalEntries).toBe(80_000);
    expect(partial.truncated).toBe(true);
  });

  it('supports nested archive folders and parent focus targets', () => {
    const dist = archiveListingToDirectoryListing({
      panelId: 'left',
      virtualPath: archiveVirtualChildPath(archivePath, 'dist'),
      archiveListing: listing,
      showHidden: false,
      sort: DEFAULT_SORT,
      filter: null,
    });

    expect(dist.entries.map((entry) => entry.name)).toEqual(['..', 'config', 'app.js']);
    expect(archiveParentPath('/tmp/archive.zip:/dist/config')).toBe('/tmp/archive.zip:/dist');
    expect(archiveParentFocusPath('/tmp/archive.zip:/')).toBe('/tmp/archive.zip');
    expect(archiveExitFocusPath('/tmp/archive.zip:/dist')).toBe('/tmp/archive.zip');
  });
});

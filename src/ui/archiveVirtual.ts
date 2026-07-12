import type { ArchiveListing, DirectoryListing, FileEntry, PanelId, SortSpec } from '../domain/types';
import { createDirectoryListing, parentPathOf } from './panelState';

export interface ArchiveVirtualPath {
  archivePath: string;
  innerPath: string;
}

const ARCHIVE_VIRTUAL_PATH_PATTERN = /^(.+\.(?:tar\.gz|tar\.zst|tgz|tzst|zip|jar|war|tar|7z)):\/?(.*)$/i;

export const archiveVirtualRootPath = (archivePath: string) => `${archivePath.replace(/\/+$/, '')}:/`;

export const archiveVirtualChildPath = (archivePath: string, innerPath: string) => {
  const normalizedInner = normalizeArchiveInnerPath(innerPath);
  return normalizedInner ? `${archiveVirtualRootPath(archivePath)}${normalizedInner}` : archiveVirtualRootPath(archivePath);
};

export const parseArchiveVirtualPath = (path: string): ArchiveVirtualPath | null => {
  const match = path.match(ARCHIVE_VIRTUAL_PATH_PATTERN);
  if (!match) {
    return null;
  }
  return {
    archivePath: match[1],
    innerPath: normalizeArchiveInnerPath(match[2] ?? ''),
  };
};

export const isArchiveVirtualPath = (path: string) => parseArchiveVirtualPath(path) !== null;

export const archiveExitFocusPath = (virtualPath: string) => parseArchiveVirtualPath(virtualPath)?.archivePath ?? null;

export const archiveParentPath = (virtualPath: string) => {
  const parsed = parseArchiveVirtualPath(virtualPath);
  if (!parsed) {
    return parentPathOf(virtualPath);
  }
  if (!parsed.innerPath) {
    return parentPathOf(parsed.archivePath);
  }
  const parentInner = parentArchiveInnerPath(parsed.innerPath);
  return archiveVirtualChildPath(parsed.archivePath, parentInner);
};

export const archiveParentFocusPath = (virtualPath: string) => {
  const parsed = parseArchiveVirtualPath(virtualPath);
  if (!parsed) {
    return virtualPath;
  }
  return parsed.innerPath ? virtualPath : parsed.archivePath;
};

export const archiveListingToDirectoryListing = ({
  panelId,
  virtualPath,
  archiveListing,
  showHidden,
  sort,
  filter,
}: {
  panelId: PanelId;
  virtualPath: string;
  archiveListing: ArchiveListing;
  showHidden: boolean;
  sort: SortSpec;
  filter: string | null;
}): DirectoryListing => {
  const parsed = parseArchiveVirtualPath(virtualPath) ?? {
    archivePath: archiveListing.archivePath,
    innerPath: '',
  };
  const currentInner = parsed.innerPath;
  const normalizedFilter = filter?.trim().toLowerCase() || null;
  const children = new Map<string, FileEntry>();

  for (const sourceEntry of archiveListing.entries) {
    const innerPath = innerPathFromArchiveEntry(archiveListing.archivePath, sourceEntry);
    if (!innerPath || !archiveInnerPathIsChildOf(innerPath, currentInner)) {
      continue;
    }
    const remainder = currentInner ? innerPath.slice(currentInner.length + 1) : innerPath;
    const [segment, ...rest] = remainder.split('/').filter(Boolean);
    if (!segment) {
      continue;
    }
    if (!showHidden && segment.startsWith('.')) {
      continue;
    }
    if (normalizedFilter && !segment.toLowerCase().includes(normalizedFilter)) {
      continue;
    }

    const childInner = joinArchiveInnerPath(currentInner, segment);
    const explicitDirectory = sourceEntry.kind === 'directory' || sourceEntry.path.endsWith('/') || innerPath.endsWith('/');
    if (rest.length > 0) {
      if (!children.has(segment)) {
        children.set(segment, archiveDirectoryEntry(parsed.archivePath, childInner, segment));
      }
      continue;
    }
    if (explicitDirectory) {
      children.set(segment, {
        ...sourceEntry,
        path: archiveVirtualChildPath(parsed.archivePath, childInner),
        name: segment,
        kind: 'directory',
        sizeBytes: null,
        isHidden: segment.startsWith('.'),
        isVirtual: false,
      });
      continue;
    }

    children.set(segment, {
      ...sourceEntry,
      path: archiveVirtualChildPath(parsed.archivePath, childInner),
      name: segment,
      kind: sourceEntry.kind === 'archive' ? 'archive' : 'file',
      isHidden: segment.startsWith('.'),
      isVirtual: false,
    });
  }

  const entries = [archiveParentEntry(parsed.archivePath, currentInner), ...sortArchiveEntries([...children.values()], sort)];
  return {
    ...createDirectoryListing(panelId, archiveVirtualChildPath(parsed.archivePath, currentInner), entries, sort, filter, Date.now()),
    totalEntries: archiveListing.totalEntries,
    truncated: archiveListing.truncated,
  };
};

const archiveParentEntry = (archivePath: string, currentInner: string): FileEntry => ({
  path: currentInner ? archiveVirtualChildPath(archivePath, parentArchiveInnerPath(currentInner)) : parentPathOf(archivePath),
  name: '..',
  kind: 'directory',
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: false,
  isVirtual: true,
});

const archiveDirectoryEntry = (archivePath: string, innerPath: string, name: string): FileEntry => ({
  path: archiveVirtualChildPath(archivePath, innerPath),
  name,
  kind: 'directory',
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: name.startsWith('.'),
  isVirtual: false,
});

const innerPathFromArchiveEntry = (archivePath: string, entry: FileEntry) => {
  const bangPrefix = `${archivePath}!`;
  if (entry.path.startsWith(bangPrefix)) {
    return normalizeArchiveInnerPath(entry.path.slice(bangPrefix.length));
  }
  const virtualPrefix = archiveVirtualRootPath(archivePath);
  if (entry.path.startsWith(virtualPrefix)) {
    return normalizeArchiveInnerPath(entry.path.slice(virtualPrefix.length));
  }
  const slashPrefix = `${archivePath.replace(/\/+$/, '')}/`;
  if (entry.path.startsWith(slashPrefix)) {
    return normalizeArchiveInnerPath(entry.path.slice(slashPrefix.length));
  }
  return normalizeArchiveInnerPath(entry.name);
};

const archiveInnerPathIsChildOf = (innerPath: string, parentInner: string) => {
  if (!parentInner) {
    return true;
  }
  return innerPath !== parentInner && innerPath.startsWith(`${parentInner}/`);
};

const normalizeArchiveInnerPath = (path: string) => path
  .replace(/\\/g, '/')
  .replace(/^\/+/, '')
  .replace(/\/+$/, '')
  .split('/')
  .filter((segment) => segment && segment !== '.')
  .join('/');

const joinArchiveInnerPath = (base: string, segment: string) => [base, segment].filter(Boolean).join('/');

const parentArchiveInnerPath = (innerPath: string) => {
  const normalized = normalizeArchiveInnerPath(innerPath);
  const separator = normalized.lastIndexOf('/');
  return separator < 0 ? '' : normalized.slice(0, separator);
};

const sortArchiveEntries = (entries: FileEntry[], sort: SortSpec) => {
  const multiplier = sort.direction === 'asc' ? 1 : -1;
  return [...entries].sort((left, right) => {
    if (sort.directoriesFirst && left.kind !== right.kind) {
      if (left.kind === 'directory') return -1;
      if (right.kind === 'directory') return 1;
    }
    const result = compareEntryField(left, right, sort.field);
    return result * multiplier;
  });
};

const compareEntryField = (left: FileEntry, right: FileEntry, field: SortSpec['field']) => {
  if (field === 'size') {
    return (left.sizeBytes ?? -1) - (right.sizeBytes ?? -1) || left.name.localeCompare(right.name);
  }
  if (field === 'modifiedAt') {
    return (left.modifiedAt ?? '').localeCompare(right.modifiedAt ?? '') || left.name.localeCompare(right.name);
  }
  if (field === 'extension') {
    return extensionOf(left.name).localeCompare(extensionOf(right.name)) || left.name.localeCompare(right.name);
  }
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base', numeric: true });
};

const extensionOf = (name: string) => {
  const index = name.lastIndexOf('.');
  return index > 0 ? name.slice(index + 1).toLowerCase() : '';
};

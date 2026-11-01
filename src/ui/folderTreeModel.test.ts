import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../domain/types';
import {
  createFolderTreeSpace,
  flattenFolderTree,
  folderTreeActionTarget,
  pathIsSameOrInside,
  folderTreeChain,
  folderTreePathsToLoad,
  folderTreeSpaceKey,
  revealFolderTreePath,
  setFolderTreeExpanded,
  withFolderTreeChildren,
  withFolderTreeError,
  withFolderTreeListing,
  withFolderTreeRoots,
} from './folderTreeModel';
import { createDirectoryListing } from './panelState';

const folder = (path: string, extra: Partial<FileEntry> = {}): FileEntry => ({
  path,
  name: path.split('/').filter(Boolean).at(-1) ?? path,
  kind: 'directory',
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: false,
  isVirtual: false,
  ...extra,
});

const rowsOf = (space: ReturnType<typeof createFolderTreeSpace>, path: string, showHidden = false) =>
  flattenFolderTree(space, { showHidden, chain: folderTreeChain(space.roots, path) })
    .map((row) => `${'  '.repeat(row.depth)}${row.entry.name}${row.expanded ? '/' : ''}`);

describe('folder tree model', () => {
  it('reveals the panel path from the most specific root and expands only its ancestors', () => {
    const space = revealFolderTreePath(
      createFolderTreeSpace('local', ['/', '/Volumes/ssd']),
      '/Volumes/ssd/IdeaProjects/app',
    );

    expect(folderTreeChain(space.roots, '/Volumes/ssd/IdeaProjects/app')).toEqual([
      '/Volumes/ssd', '/Volumes/ssd/IdeaProjects', '/Volumes/ssd/IdeaProjects/app',
    ]);
    expect(rowsOf(space, '/Volumes/ssd/IdeaProjects/app')).toEqual([
      '/',
      'ssd/',
      '  IdeaProjects/',
      '    app',
    ]);
    expect(folderTreePathsToLoad(space, flattenFolderTree(space, {
      showHidden: false,
      chain: folderTreeChain(space.roots, '/Volumes/ssd/IdeaProjects/app'),
    }), false)).toEqual(['/Volumes/ssd', '/Volumes/ssd/IdeaProjects']);
  });

  it('matches a drive root with the canonical Windows path and adds an unknown top folder as a root', () => {
    const windows = revealFolderTreePath(createFolderTreeSpace('local', ['C:\\', 'D:\\']), '\\\\?\\C:\\Users\\me');
    expect(windows.roots).toEqual(['\\\\?\\C:\\', 'D:\\']);
    expect(windows.nodes['\\\\?\\C:\\'].entry.name).toBe('C:\\');
    expect(windows.expanded.has('\\\\?\\C:\\Users')).toBe(true);

    const unc = revealFolderTreePath(windows, '\\\\?\\UNC\\server\\share\\docs');
    expect(unc.roots.at(-1)).toBe('\\\\?\\UNC\\server\\share\\');

    const withoutRoots = revealFolderTreePath(createFolderTreeSpace('local'), '/a/b');
    expect(withoutRoots.roots).toEqual(['/']);
    // 위치 목록을 늦게 읽으면 같은 폴더의 상태를 유지한 채 맨 위 항목 교체
    expect(withFolderTreeRoots(withoutRoots, ['/', '/Volumes/ssd']).nodes['/a']).toBeDefined();
  });

  it('keeps loaded descendants, prunes removed folders, and hides hidden folders off the panel path', () => {
    let space = revealFolderTreePath(createFolderTreeSpace('local', ['/']), '/work/.cache/app');
    space = withFolderTreeChildren(space, '/', [folder('/work')]);
    space = withFolderTreeChildren(space, '/work', [folder('/work/.cache', { isHidden: true }), folder('/work/.git', { isHidden: true }), folder('/work/src')]);
    space = withFolderTreeChildren(space, '/work/src', [folder('/work/src/ui')]);
    space = setFolderTreeExpanded(space, '/work/src', true);

    expect(rowsOf(space, '/work/.cache/app')).toEqual(['//', '  work/', '    .cache/', '      app', '    src/', '      ui']);
    expect(rowsOf(space, '/work/.cache/app', true)).toContain('    .git');

    const refreshed = withFolderTreeChildren(space, '/work', [folder('/work/.cache', { isHidden: true }), folder('/work/lib')]);
    expect(refreshed.nodes['/work/src']).toBeUndefined();
    expect(refreshed.nodes['/work/src/ui']).toBeUndefined();
    expect(refreshed.nodes['/work/.cache/app']).toBeDefined();
  });

  it('fills the current folder from the panel listing without dropping known hidden folders', () => {
    let space = revealFolderTreePath(createFolderTreeSpace('local', ['/']), '/work');
    space = withFolderTreeChildren(space, '/work', [folder('/work/.git', { isHidden: true }), folder('/work/src')]);
    const listing = createDirectoryListing('left', '/work', [
      folder('/', { name: '..', isVirtual: true }),
      folder('/work/docs'),
      folder('/work/src'),
      folder('/work/link', { kind: 'symlink', symlinkTargetIsDirectory: true }),
      folder('/work/readme.md', { kind: 'file' }),
    ]);

    const merged = withFolderTreeListing(space, listing, false);
    expect(merged.nodes['/work'].children).toEqual(['/work/.git', '/work/docs', '/work/link', '/work/src']);
    expect(merged.nodes['/work'].partial).toBe(false);

    const fresh = withFolderTreeListing(revealFolderTreePath(createFolderTreeSpace('local', ['/']), '/work'), listing, false);
    expect(fresh.nodes['/work'].partial).toBe(true);
    expect(withFolderTreeListing(space, { ...listing, filter: 'do' }, true)).toBe(space);
  });

  it('shows an open archive under its folder and folder links as leaves', () => {
    let space = revealFolderTreePath(createFolderTreeSpace('local', ['/']), '/x/a.zip:/in/dir');
    space = withFolderTreeChildren(space, '/', [folder('/x')]);
    space = withFolderTreeChildren(space, '/x', [folder('/x/b'), folder('/x/link', { kind: 'symlink', symlinkTargetIsDirectory: true })]);
    space = setFolderTreeExpanded(space, '/x/link', true);

    expect(rowsOf(space, '/x/a.zip:/in/dir')).toEqual(['//', '  x/', '    a.zip/', '      in/', '        dir', '    b', '    link']);
    const link = flattenFolderTree(space, { showHidden: false, chain: [] }).find((row) => row.path === '/x/link');
    expect(link).toMatchObject({ isLink: true, expandable: false, expanded: false });
  });

  it('keys remote trees by server and labels the server root', () => {
    expect(folderTreeSpaceKey('sftp://me@host:2222/home/me')).toBe('sftp://me@host:2222/');
    expect(folderTreeSpaceKey('/home/me')).toBe('local');
    const space = revealFolderTreePath(createFolderTreeSpace('sftp://me@host:2222/', ['sftp://me@host:2222/']), 'sftp://me@host:2222/home/me');
    expect(rowsOf(space, 'sftp://me@host:2222/home/me')).toEqual(['me@host:2222/', '  home/', '    me']);
  });

  it('marks failed folders without reloading them automatically and keeps empty folders unexpandable', () => {
    let space = revealFolderTreePath(createFolderTreeSpace('local', ['/']), '/empty');
    space = withFolderTreeChildren(space, '/empty', []);
    space = withFolderTreeError(space, '/', { code: 'permission_denied', messageKey: 'errors.permissionDenied', path: '/', details: null, recoverable: true });
    const rows = flattenFolderTree(space, { showHidden: false, chain: ['/', '/empty'] });

    expect(rows.find((row) => row.path === '/empty')?.expandable).toBe(false);
    expect(rows.find((row) => row.path === '/')?.error?.code).toBe('permission_denied');
    expect(folderTreePathsToLoad(space, rows, false)).toEqual([]);
  });

  it('keeps top folders and the open archive navigation-only and blocks drops into the dragged folder', () => {
    let space = revealFolderTreePath(createFolderTreeSpace('local', ['/']), '/x/a.zip:/in');
    space = withFolderTreeChildren(space, '/', [folder('/x')]);
    const rows = flattenFolderTree(space, { showHidden: false, chain: folderTreeChain(space.roots, '/x/a.zip:/in') });
    const target = (path: string) => folderTreeActionTarget('left', rows.find((row) => row.path === path)!);

    expect(target('/')).toBeNull();
    expect(target('/x/a.zip:/')).toBeNull();
    expect(target('/x')?.sourceListing.path).toBe('/');
    expect(target('/x/a.zip:/in')?.sourceListing.path).toBe('/x/a.zip:/');

    expect(pathIsSameOrInside('/work/app', '/work')).toBe(true);
    expect(pathIsSameOrInside('/work', '/work')).toBe(true);
    expect(pathIsSameOrInside('/work2', '/work')).toBe(false);
    expect(pathIsSameOrInside('\\\\?\\C:\\a\\b', '\\\\?\\C:\\a')).toBe(true);
    expect(pathIsSameOrInside('/x/a.zip:/in', '/x/a.zip:/')).toBe(true);
    expect(pathIsSameOrInside('sftp://me@host/home/me', 'sftp://me@host/home')).toBe(true);
  });
});

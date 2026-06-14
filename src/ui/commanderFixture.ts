import type { DirectoryListing, FileEntry, PanelId } from '../domain/types';

const entry = (
  parent: string,
  name: string,
  kind: FileEntry['kind'],
  sizeBytes: number | null,
  modifiedAt: string,
  permissions = kind === 'directory' ? 'drwxr-xr-x' : '-rw-r--r--',
  owner = 'boksl',
  group = 'staff',
): FileEntry => ({
  path: `${parent}/${name}`.replace(/\/+/g, '/'),
  name,
  kind,
  sizeBytes,
  modifiedAt,
  createdAt: null,
  permissions,
  owner,
  group,
  isHidden: name.startsWith('.'),
  isVirtual: false,
});

const leftPath = '/demo/BokslDir/docs';
const leftParentPath = '/demo/BokslDir';
const rightPath = '/demo/BokslDir/target/debug/build';
const rightParentPath = '/demo/BokslDir/target/debug';

const virtualParent = (path: string, modifiedAt: string): FileEntry => ({
  path,
  name: '..',
  kind: 'directory',
  sizeBytes: null,
  modifiedAt,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: false,
  isVirtual: true,
});

const leftEntries: FileEntry[] = [
  virtualParent(leftParentPath, '2026-02-18T11:39:00+09:00'),
  entry(leftPath, 'images', 'directory', null, '2026-02-18T11:39:00+09:00'),
  entry(leftPath, 'temp', 'directory', null, '2026-02-01T08:56:00+09:00'),
  entry(leftPath, 'Architecture.md', 'file', 23_100, '2026-01-31T23:34:00+09:00'),
  entry(leftPath, 'release-bundle.zip', 'archive', 4_194_304, '2026-02-12T21:10:00+09:00'),
  entry(leftPath, 'PRD.md', 'file', 39_900, '2026-02-18T11:33:00+09:00'),
  entry(leftPath, 'Requirements.md', 'file', 2_000, '2026-02-17T13:27:00+09:00'),
  entry(leftPath, 'UI_UX_Improvements.md', 'file', 13_100, '2026-02-10T20:23:00+09:00'),
  entry(leftPath, 'User-Manual.md', 'file', 3_700, '2026-02-18T11:39:00+09:00'),
  entry(leftPath, 'BokslDir_GUI_feature_requirements.md', 'file', 18_400, '2026-06-13T16:12:00+09:00'),
  entry(leftPath, 'implementation', 'directory', null, '2026-06-13T18:42:00+09:00'),
];

const rightNames = [
  'anyhow-6af8f50c0ed79557',
  'anyhow-df659377c9a99701',
  'bzip2-sys-282fbd1854103487',
  'bzip2-sys-9d2a7f760528c551',
  'bzip2-sys-c72a38032bde18e1',
  'bzip2-sys-e503c83ef21fcb52',
  'crc32fast-7c34a2189793b3bc',
  'crc32fast-f59db741d9e64744',
  'generic-array-6de08afde610f112',
  'generic-array-7534a23a150ae5e7',
  'getrandom-24ce5e891f8ae242',
  'getrandom-57a16f13c2494bb0',
  'getrandom-7ea81d8076ca391a',
  'getrandom-d3772c78cbf44e4f',
  'instability-56e6e9cf7b545eba',
  'instability-57c5e4e850a1d060',
  'libc-01c34eb226074b21',
  'libc-048fef6c6612c4d0',
  'libc-f43fc412485597f1',
  'libc-fa5ade5605832f6c',
  'lzma-sys-2de591cea961db69',
  'lzma-sys-7d2156500d37e750',
  'lzma-sys-ea76ded1350c01d3',
  'lzma-sys-ef557a42c87d9852',
  'num-traits-1b6ede2045f08b33',
  'num-traits-1faef01599a3b7df',
  'objc2-6764073654b68c85',
  'quote-02c6b6a8d413ffad',
  'serde-42a5ba8faad0b922',
  'syn-1a4bdbfe9f66a9a0',
  'tauri-build-4f10e5ac3d58ef0a',
  'zstd-safe-7e327a088ab042be',
];

const rightEntries: FileEntry[] = [
  virtualParent(rightParentPath, '2026-02-18T11:42:00+09:00'),
  ...rightNames.map((name, index) =>
    entry(
      rightPath,
      name,
      'directory',
      null,
      index % 5 === 0
        ? '2026-02-18T00:02:00+09:00'
        : index % 3 === 0
          ? '2026-02-17T13:57:00+09:00'
          : '2026-02-18T11:42:00+09:00',
    ),
  ),
];

const listing = (panelId: PanelId, path: string, entries: FileEntry[]): DirectoryListing => ({
  panelId,
  path,
  entries,
  sort: { field: 'name', direction: 'asc', directoriesFirst: true },
  filter: null,
  version: 1,
});

export const SAMPLE_LISTINGS: Record<PanelId, DirectoryListing> = {
  left: listing('left', leftPath, leftEntries),
  right: listing('right', rightPath, rightEntries),
};

export const INITIAL_FOCUS_INDEX: Record<PanelId, number> = {
  left: 0,
  right: 9,
};

export const INITIAL_SELECTED_PATHS: Record<PanelId, string[]> = {
  left: [],
  right: [rightEntries[9]?.path ?? rightEntries[0].path],
};

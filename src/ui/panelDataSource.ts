import type { AppError, DirectoryChanged, DirectoryListing, FileEntry, LocationList, PanelId, SortSpec, WatchAck } from '../domain/types';
import { type ListDirInput, tauriClient, type TauriResult } from '../tauri/client';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { createDirectoryListing, DEFAULT_SORT, PANEL_IDS, parentPathOf } from './panelState';

export type PanelInitialLoadResult = Record<PanelId, TauriResult<DirectoryListing>>;

export interface PanelDataSource {
  readonly initialListings: Record<PanelId, DirectoryListing>;
  readonly loadInitialOnMount: boolean;
  loadInitialListings(): Promise<PanelInitialLoadResult>;
  listDir(input: ListDirInput): Promise<TauriResult<DirectoryListing>>;
  // base: `~`·상대 경로 해석 기준인 활성 패널의 실제 디렉터리(압축 내부면 생략)
  gotoPath(input: { panelId: PanelId; path: string; base?: string }): Promise<TauriResult<DirectoryListing>>;
  listLocations(): Promise<TauriResult<LocationList>>;
  // 외부 변경 감시(Tauri 실행에서만 제공): 패널마다 감시 하나, 변경 알림은 같은 version일 때만 유효
  watchPath?(input: { panelId: PanelId; path: string }): Promise<TauriResult<WatchAck>>;
  unwatchPath?(input: { panelId: PanelId }): Promise<TauriResult<void>>;
  listenDirectoryChanges?(handler: (event: DirectoryChanged) => void): Promise<() => void>;
}

type TauriNavigationClient = Pick<typeof tauriClient, 'listDir' | 'gotoPath' | 'listLocations'>
  & Partial<Pick<typeof tauriClient, 'watchPath' | 'unwatchPath' | 'listenDirectoryChanges'>>;

export const createTauriPanelDataSource = (
  client: TauriNavigationClient = tauriClient,
  initialListings: Record<PanelId, DirectoryListing> = SAMPLE_LISTINGS,
  fallbackToInitialOnUnavailable = false,
): PanelDataSource => ({
  initialListings,
  loadInitialOnMount: true,
  loadInitialListings: async () => {
    const locations = await client.listLocations();
    if (!locations.ok) {
      if (fallbackToInitialOnUnavailable && locations.error.messageKey === 'errors.tauriInvokeFailed') {
        return okInitialListings(initialListings);
      }
      return errorInitialListings(locations.error);
    }

    const defaultPaths: Record<PanelId, string> = {
      left: locations.data.recent[0] ?? locations.data.home,
      right: locations.data.home,
    };
    const [left, right] = await Promise.all(
      PANEL_IDS.map((panelId) => client.listDir({
        panelId,
        path: defaultPaths[panelId],
        showHidden: false,
        sort: initialListings[panelId].sort ?? DEFAULT_SORT,
        filter: null,
      })),
    );

    return { left, right };
  },
  listDir: (input) => client.listDir(input),
  gotoPath: (input) => client.gotoPath(input),
  listLocations: () => client.listLocations(),
  ...(client.watchPath && client.unwatchPath && client.listenDirectoryChanges
    ? { watchPath: client.watchPath, unwatchPath: client.unwatchPath, listenDirectoryChanges: client.listenDirectoryChanges }
    : {}),
});

export const createPreviewPanelDataSource = (
  client: TauriNavigationClient = tauriClient,
  initialListings: Record<PanelId, DirectoryListing> = SAMPLE_LISTINGS,
) => createTauriPanelDataSource(client, initialListings, true);

export const createFixturePanelDataSource = (
  initialListings: Record<PanelId, DirectoryListing> = SAMPLE_LISTINGS,
  overrides: Record<string, DirectoryListing> = {},
): PanelDataSource => {
  const listingMap = new Map<string, DirectoryListing>();
  for (const panelId of PANEL_IDS) {
    listingMap.set(initialListings[panelId].path, initialListings[panelId]);
  }
  for (const listing of Object.values(overrides)) {
    listingMap.set(listing.path, listing);
  }

  const listingFor = (panelId: PanelId, path: string, sort: SortSpec, filter: string | null): DirectoryListing => {
    const existing = listingMap.get(path);
    const base = existing ?? syntheticDirectoryListing(panelId, path, sort, filter);
    return applyListingRequest(base, panelId, sort, filter);
  };

  return {
    initialListings,
    loadInitialOnMount: false,
    loadInitialListings: async () => okInitialListings(initialListings),
    listDir: async (input) => ok(listingFor(input.panelId, input.path, input.sort, input.filter)),
    gotoPath: async (input) => ok(listingFor(input.panelId, input.path, DEFAULT_SORT, null)),
    listLocations: async () => ok({
      home: initialListings.right.path,
      roots: [initialListings.left.path, initialListings.right.path],
      recent: [initialListings.right.path, initialListings.left.path],
      bookmarks: [],
    }),
  };
};

const applyListingRequest = (
  listing: DirectoryListing,
  panelId: PanelId,
  sort: SortSpec,
  filter: string | null,
): DirectoryListing => ({
  ...listing,
  panelId,
  sort,
  filter,
  entries: listing.entries.filter((entry) => entry.isVirtual || !filter || entry.name.toLowerCase().includes(filter.toLowerCase())),
});

const syntheticDirectoryListing = (
  panelId: PanelId,
  path: string,
  sort: SortSpec,
  filter: string | null,
): DirectoryListing => createDirectoryListing(
  panelId,
  path,
  [virtualParent(parentPathOf(path)), syntheticEntry(path, 'README.md')],
  sort,
  filter,
);

const virtualParent = (path: string): FileEntry => ({
  path,
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

const syntheticEntry = (parent: string, name: string): FileEntry => ({
  path: `${parent.replace(/[\\/]+$/, '')}/${name}`,
  name,
  kind: 'file',
  sizeBytes: 1024,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  owner: 'boksl',
  group: 'staff',
  isHidden: name.startsWith('.'),
  isVirtual: false,
});

const okInitialListings = (listings: Record<PanelId, DirectoryListing>): PanelInitialLoadResult => ({
  left: ok(listings.left),
  right: ok(listings.right),
});

const errorInitialListings = (error: AppError): PanelInitialLoadResult => ({
  left: { ok: false, error },
  right: { ok: false, error },
});

const ok = <T>(data: T): TauriResult<T> => ({ ok: true, data });

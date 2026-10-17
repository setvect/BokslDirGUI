import type { AppError, DirectoryListing, FileEntry, PanelId, SortSpec } from '../domain/types';

export const PANEL_IDS: readonly PanelId[] = ['left', 'right'];

export const DEFAULT_SORT: SortSpec = {
  field: 'name',
  direction: 'asc',
  directoriesFirst: true,
};

export interface PanelNavigationState {
  path: string;
  listing: DirectoryListing;
  focusedIndex: number;
  selectedPaths: string[];
  historyBack: string[];
  historyForward: string[];
  sort: SortSpec;
  filter: string | null;
  showHidden: boolean;
  loading: boolean;
  error: AppError | null;
}

export type PanelStateById = Record<PanelId, PanelNavigationState>;
export type FocusFallbackMode = 'preserve-index' | 'first-concrete';

interface PanelStateOptions {
  focusedIndex?: number;
  selectedPaths?: string[];
  historyBack?: string[];
  historyForward?: string[];
  sort?: SortSpec;
  filter?: string | null;
  showHidden?: boolean;
  loading?: boolean;
  error?: AppError | null;
}

export const createDirectoryListing = (
  panelId: PanelId,
  path: string,
  entries: FileEntry[] = [],
  sort: SortSpec = DEFAULT_SORT,
  filter: string | null = null,
  version = 1,
): DirectoryListing => ({
  panelId,
  path,
  entries,
  sort,
  filter,
  version,
});

export const createPanelStateFromListing = (
  listing: DirectoryListing,
  options: PanelStateOptions = {},
): PanelNavigationState => {
  const sort = options.sort ?? listing.sort ?? DEFAULT_SORT;
  const filter = options.filter ?? listing.filter ?? null;
  const focusedIndex = clampFocusedIndex(options.focusedIndex ?? 0, listing.entries.length);
  return {
    path: listing.path,
    listing: { ...listing, sort, filter },
    focusedIndex,
    selectedPaths: pruneSelection(options.selectedPaths ?? [], listing.entries),
    historyBack: options.historyBack ?? [],
    historyForward: options.historyForward ?? [],
    sort,
    filter,
    showHidden: options.showHidden ?? false,
    loading: options.loading ?? false,
    error: options.error ?? null,
  };
};

export const createPanelStates = (
  listings: Record<PanelId, DirectoryListing>,
  options: Partial<Record<PanelId, PanelStateOptions>> = {},
): PanelStateById => ({
  left: createPanelStateFromListing(listings.left, options.left),
  right: createPanelStateFromListing(listings.right, options.right),
});

export const replacePanelListing = (
  current: PanelNavigationState,
  listing: DirectoryListing,
  options: {
    pushHistory?: boolean;
    replaceBack?: string[];
    replaceForward?: string[];
    preserveSelection?: boolean;
    preserveFocusPath?: string | null;
    focusPath?: string | null;
    focusFallback?: FocusFallbackMode;
  } = {},
): PanelNavigationState => {
  const focusPath = options.focusPath ?? options.preserveFocusPath ?? null;
  const focusedIndex = focusPath
    ? indexOfPathOrDefault(listing.entries, focusPath, 0)
    : options.focusFallback === 'first-concrete'
      ? firstConcreteEntryIndexOrDefault(listing.entries, 0)
      : clampFocusedIndex(current.focusedIndex, listing.entries.length);
  const selectedPaths = options.preserveSelection
    ? pruneSelection(current.selectedPaths, listing.entries)
    : [];
  return {
    ...current,
    path: listing.path,
    listing,
    focusedIndex,
    selectedPaths,
    historyBack: (options.replaceBack ?? (options.pushHistory && current.path !== listing.path
      ? [...current.historyBack, current.path]
      : current.historyBack)).slice(-100),
    historyForward: (options.replaceForward ?? (options.pushHistory ? [] : current.historyForward)).slice(0, 100),
    sort: listing.sort,
    filter: listing.filter,
    loading: false,
    error: null,
  };
};

export const markPanelLoading = (current: PanelNavigationState): PanelNavigationState => ({
  ...current,
  loading: true,
  error: null,
});

export const restorePanelAfterFailedNavigation = (current: PanelNavigationState): PanelNavigationState => ({
  ...current,
  loading: false,
  error: null,
});

export const markPanelError = (current: PanelNavigationState, error: AppError): PanelNavigationState => ({
  ...current,
  loading: false,
  error,
});

export const focusedEntryOf = (panel: PanelNavigationState) =>
  panel.listing.entries[panel.focusedIndex] ?? null;

export const parentNavigationEntryOf = (panel: PanelNavigationState) =>
  panel.listing.entries.find((entry) => entry.isVirtual && entry.kind === 'directory') ?? null;

export const parentPathOf = (path: string) => {
  if (!path) return '/';
  // 문자열은 그대로 유지하고 루트 경계 판정에만 구분자를 통일.
  const view = path.replace(/\\/g, '/');
  const root = view.match(/^\/\/\?\/(?:[A-Za-z]:\/|UNC\/[^/]+\/[^/]+(?:\/|$))/i)
    ?? view.match(/^\/\/[^/?]+\/[^/]+(?:\/|$)/)
    ?? view.match(/^[A-Za-z]:\//)
    ?? view.match(/^\//);
  const rootLength = root?.[0].length ?? 0;
  let end = path.length;
  while (end > rootLength && /[\\/]$/.test(path.slice(0, end))) end--;
  if (end <= rootLength) return path.slice(0, rootLength);
  const normalized = path.slice(0, end);
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (index < rootLength) return rootLength ? path.slice(0, rootLength) : normalized;
  return normalized.slice(0, index);
};

export const panelCanGoBack = (panel: PanelNavigationState) => panel.historyBack.length > 0;
export const panelCanGoForward = (panel: PanelNavigationState) => panel.historyForward.length > 0;

export const clampFocusedIndex = (index: number, entryCount: number) =>
  clamp(index, 0, Math.max(0, entryCount - 1));

const pruneSelection = (selectedPaths: string[], entries: FileEntry[]) => {
  const selectable = new Set(entries.filter((entry) => !entry.isVirtual).map((entry) => entry.path));
  return selectedPaths.filter((path) => selectable.has(path));
};

const indexOfPathOrDefault = (entries: FileEntry[], path: string, defaultIndex: number) => {
  const found = entries.findIndex((entry) => entry.path === path);
  return found >= 0 ? found : clampFocusedIndex(defaultIndex, entries.length);
};

const firstConcreteEntryIndexOrDefault = (entries: FileEntry[], defaultIndex: number) => {
  const found = entries.findIndex((entry) => !entry.isVirtual);
  return found >= 0 ? found : clampFocusedIndex(defaultIndex, entries.length);
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

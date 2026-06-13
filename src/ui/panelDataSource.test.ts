import { describe, expect, it, vi } from 'vitest';
import type { AppError, DirectoryListing, PanelId } from '../domain/types';
import type { ListDirInput } from '../tauri/client';
import { createPreviewPanelDataSource, createTauriPanelDataSource } from './panelDataSource';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { createDirectoryListing, DEFAULT_SORT } from './panelState';

const invokeUnavailableError: AppError = {
  code: 'io_error',
  messageKey: 'errors.tauriInvokeFailed',
  path: null,
  details: { command: 'list_locations' },
  recoverable: true,
};

describe('panel data source', () => {
  it('loads real default locations through listDir when Tauri is available', async () => {
    const loaded: Record<'left' | 'right', DirectoryListing> = {
      left: createDirectoryListing('left', '/recent', [entry('/recent', 'recent.txt')]),
      right: createDirectoryListing('right', '/home', [entry('/home', 'home.txt')]),
    };
    const client = {
      listLocations: vi.fn(async () => ({ ok: true as const, data: { home: '/home', roots: ['/'], recent: ['/recent'], bookmarks: [] } })),
      listDir: vi.fn(async (input: ListDirInput) => ({ ok: true as const, data: loaded[input.panelId] })),
      gotoPath: vi.fn(async (input: { panelId: PanelId; path: string }) => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path) })),
    };

    const result = await createTauriPanelDataSource(client, SAMPLE_LISTINGS).loadInitialListings();

    expect(result.left.ok).toBe(true);
    expect(result.right.ok).toBe(true);
    if (result.left.ok && result.right.ok) {
      expect(result.left.data.path).toBe('/recent');
      expect(result.right.data.path).toBe('/home');
    }
    expect(client.listDir).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: '/recent',
      sort: DEFAULT_SORT,
      filter: null,
      showHidden: false,
    }));
  });

  it('keeps browser preview usable only for Tauri invoke-unavailable failures', async () => {
    const client = {
      listLocations: vi.fn(async () => ({ ok: false as const, error: invokeUnavailableError })),
      listDir: vi.fn(),
      gotoPath: vi.fn(),
    };

    const strictResult = await createTauriPanelDataSource(client, SAMPLE_LISTINGS).loadInitialListings();
    expect(strictResult).toEqual({
      left: { ok: false, error: invokeUnavailableError },
      right: { ok: false, error: invokeUnavailableError },
    });

    const previewResult = await createPreviewPanelDataSource(client, SAMPLE_LISTINGS).loadInitialListings();
    expect(previewResult).toEqual({
      left: { ok: true, data: SAMPLE_LISTINGS.left },
      right: { ok: true, data: SAMPLE_LISTINGS.right },
    });
  });
});

const entry = (parent: string, name: string) => ({
  path: `${parent}/${name}`,
  name,
  kind: 'file' as const,
  sizeBytes: 1,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  isHidden: false,
  isVirtual: false,
});

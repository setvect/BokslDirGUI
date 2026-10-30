// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import type { SavedTab, Settings } from '../domain/types';
import { COMMANDER_STATUS_TEXT } from '../i18n-resources';
import { DEFAULT_SETTINGS } from './settingsModel';
import { DEFAULT_SORT, createDirectoryListing } from './panelState';
import { createFixturePanelDataSource } from './panelDataSource';
import { normalizeSavedTabs } from './sessionState';
import { mutationClientStub } from './testing/clientStubs';
import type { ListDirInput, TauriResult } from '../tauri/client';
import type { DirectoryListing } from '../domain/types';
import { usePanelNavigation } from './usePanelNavigation';

const tab = (path: string): SavedTab => ({ path, sort: DEFAULT_SORT, filter: null, showHidden: false, historyBack: [], historyForward: [] });
const setup = (settings: Settings) => {
  const dataSource = { ...createFixturePanelDataSource(), loadInitialOnMount: true,
    listDir: vi.fn(async (input: ListDirInput): Promise<TauriResult<DirectoryListing>> => ({ ok: true as const, data: createDirectoryListing(input.panelId, input.path, [], input.sort, input.filter) })) };
  const runtime: Parameters<typeof usePanelNavigation>[0] = {
    dataSource, settings, settingsLoaded: true,
    initialFocusIndex: undefined, initialSelectedPaths: undefined,
    setDirectoryComparison: vi.fn(), setStatusMessage: vi.fn(), statusText: COMMANDER_STATUS_TEXT.ko,
    shellRef: { current: null }, mutationClient: mutationClientStub(),
    runtimeBackendAvailable: true, setArchivePasswordRequest: vi.fn(), saveSettingsPatch: vi.fn(async () => {}),
  };
  return { runtime, dataSource };
};

it('restores every tab with its active index, sort, hidden files and history', async () => {
  const active = { ...tab('/work'), sort: { ...DEFAULT_SORT, field: 'size' as const, direction: 'desc' as const }, showHidden: true, filter: '.json', historyBack: ['/previous'] };
  const settings: Settings = { ...DEFAULT_SETTINGS, session: { leftPath: '/legacy', rightPath: '/right', activePanel: 'left',
    tabs: { left: { items: [tab('/first'), active], activeIndex: 1 }, right: { items: [tab('/right')], activeIndex: 0 } } } };
  const { runtime, dataSource } = setup(settings);
  const { result } = renderHook(() => usePanelNavigation(runtime));
  await waitFor(() => expect(result.current.panelState.left.path).toBe('/work'));
  expect(result.current.panelTabs.left).toHaveLength(2);
  expect(result.current.activeTab.left).toBe(1);
  expect(result.current.panelState.left).toMatchObject({ showHidden: true, filter: '.json', historyBack: ['/previous'], sort: active.sort });
  expect(dataSource.listDir).toHaveBeenCalledWith(expect.objectContaining({ path: '/work', showHidden: true, filter: '.json', sort: active.sort }));
  act(() => result.current.activateTab('left', 0));
  expect(result.current.panelState.left.path).toBe('/first');
  await waitFor(() => expect(runtime.saveSettingsPatch).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ tabs: expect.objectContaining({ left: expect.objectContaining({ activeIndex: 0 }) }) }) }), null, { silent: true }));
});

it('persists direct path navigation, active panel changes, tab creation and closing', async () => {
  const { runtime } = setup({ ...DEFAULT_SETTINGS, session: { leftPath: '/left', rightPath: '/right', activePanel: 'right' } });
  const { result } = renderHook(() => usePanelNavigation(runtime));
  await waitFor(() => expect(result.current.panelState.right.path).toBe('/right'));
  await act(() => result.current.gotoPanelPath('right', '/new-path'));
  await waitFor(() => expect(runtime.saveSettingsPatch).toHaveBeenCalledWith(expect.objectContaining({ session: expect.objectContaining({ rightPath: '/new-path' }) }), null, { silent: true }));
  act(() => result.current.addTab('right'));
  await waitFor(() => expect(result.current.panelTabs.right).toHaveLength(2));
  expect(vi.mocked(runtime.saveSettingsPatch).mock.lastCall?.[0].session?.tabs?.right.items).toHaveLength(2);
  act(() => result.current.closeTab('right'));
  act(() => result.current.setActivePanel('left'));
  await waitFor(() => expect(vi.mocked(runtime.saveSettingsPatch).mock.lastCall?.[0].session).toMatchObject({ activePanel: 'left', tabs: { right: { activeIndex: 0, items: [expect.objectContaining({ path: '/new-path' })] } } }));
});

it('recovers an unavailable saved path to home with an explicit notice', async () => {
  const { runtime, dataSource } = setup({ ...DEFAULT_SETTINGS, session: { leftPath: null, rightPath: null, activePanel: 'right',
    tabs: { left: { items: [tab('/disconnected')], activeIndex: 0 }, right: { items: [tab('/right')], activeIndex: 0 } } } });
  const original = dataSource.listDir.getMockImplementation()!;
  dataSource.listDir.mockImplementation(async (input) => input.path === '/disconnected'
    ? { ok: false, error: { code: 'not_found', messageKey: 'errors.notFound', path: input.path, details: null, recoverable: true } }
    : original(input));
  const { result } = renderHook(() => usePanelNavigation(runtime));
  await waitFor(() => expect(result.current.panelState.left.path).toBe(dataSource.initialListings.right.path));
  expect(runtime.setStatusMessage).toHaveBeenCalledWith(expect.stringContaining('/disconnected'));
  expect(result.current.panelState.left.loading).toBe(false);
});

it('normalizes malformed tab state without restoring unsafe selections or secrets', () => {
  const panel = { activeIndex: 99, items: [{ path: '/saved', showHidden: true, sort: { field: 'unknown' }, selectedPaths: ['/danger'], password: 'secret' }] };
  const normalized = normalizeSavedTabs({ left: panel, right: panel });
  expect(normalized?.left.activeIndex).toBe(0);
  expect(normalized?.left.items[0].sort).toEqual(DEFAULT_SORT);
  expect(JSON.stringify(normalized)).not.toMatch(/danger|secret/);
  expect(normalizeSavedTabs({ left: {}, right: {} })).toBeUndefined();
});

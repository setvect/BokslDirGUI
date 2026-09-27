import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useMemo, useRef, useState } from 'react';
import type { PanelId, Settings } from '../domain/types';
import type { CommanderNavigationText, CommanderStatusText } from '../i18n-resources';
import {
  formatUserErrorMessage
} from '../i18n-resources';
import {
  type NavigationListItem,
  type NavigationListState
} from './CommanderOverlays';
import { navigationItemsFromLocations } from './navigationItems';
import { type PanelDataSource } from './panelDataSource';
import { panelIdLabel } from './panelPresentation';
import type { PanelNavigationState, PanelStateById } from './panelState';
import { shortenPath } from './textLayout';

interface NavigationMenusDependencies {
  readonly activateTab: (panelId: PanelId, index: number) => void;
  readonly closeTab: (panelId: PanelId, index: number) => void;
  readonly panelState: PanelStateById;
  readonly settings: Settings;
  readonly saveSettingsPatch: (patch: Partial<Settings>, successMessage: string | null, options?: { silent?: boolean; }) => Promise<void>;
  readonly statusText: CommanderStatusText;
  readonly setStatusMessage: Dispatch<SetStateAction<string | null>>;
  readonly navigationText: CommanderNavigationText;
  readonly panelTabs: Record<PanelId, PanelNavigationState[]>;
  readonly activeTab: Record<PanelId, number>;
  readonly panelStateRef: RefObject<PanelStateById>;
  readonly dataSource: PanelDataSource;
  readonly gotoPanelPath: (panelId: PanelId, path: string) => Promise<void>;
}
export function useNavigationMenus(dependencies: NavigationMenusDependencies) {

  const locationsRequestRef = useRef(0);

  const [bookmarkRenameRequest, setBookmarkRenameRequest] = useState<{ bookmarkId: string; initialValue: string } | null>(null);

  const [navigationList, setNavigationList] = useState<NavigationListState | null>(null);

  const addBookmark = (panelId: PanelId) => {
    const panel = dependencies.panelState[panelId];
    const bookmark = {
      id: `bookmark-${Date.now()}`,
      label: shortenPath(panel.path),
      path: panel.path,
    };
    const bookmarks = Array.isArray(dependencies.settings.bookmarks) ? dependencies.settings.bookmarks : [];
    void dependencies.saveSettingsPatch({
      bookmarks: [...bookmarks.filter((item) => item.path !== panel.path), bookmark],
    }, dependencies.statusText.bookmarkAdded(bookmark.label));
  };

  const renameBookmarkForPanel = (panelId: PanelId) => {
    const panel = dependencies.panelState[panelId];
    const bookmarks = Array.isArray(dependencies.settings.bookmarks) ? dependencies.settings.bookmarks : [];
    const bookmark = bookmarks.find((item) => item.path === panel.path);
    if (!bookmark) {
      dependencies.setStatusMessage(dependencies.statusText.bookmarkNotFound);
      return;
    }
    setBookmarkRenameRequest({ bookmarkId: bookmark.id, initialValue: bookmark.label });
  };

  const applyBookmarkRename = (label: string) => {
    const request = bookmarkRenameRequest;
    if (!request) {
      return;
    }
    const bookmarks = Array.isArray(dependencies.settings.bookmarks) ? dependencies.settings.bookmarks : [];
    const next = bookmarks.map((bookmark) =>
      bookmark.id === request.bookmarkId ? { ...bookmark, label } : bookmark,
    );
    setBookmarkRenameRequest(null);
    void dependencies.saveSettingsPatch({ bookmarks: next }, dependencies.statusText.bookmarkRenamed(label));
  };

  const deleteBookmarkForPanel = (panelId: PanelId) => {
    const panel = dependencies.panelState[panelId];
    const bookmarks = Array.isArray(dependencies.settings.bookmarks) ? dependencies.settings.bookmarks : [];
    void dependencies.saveSettingsPatch({
      bookmarks: bookmarks.filter((bookmark) => bookmark.path !== panel.path),
    }, dependencies.statusText.bookmarkDeleted(shortenPath(panel.path)));
  };

  const openBookmarkList = (panelId: PanelId) => {
    const bookmarks = Array.isArray(dependencies.settings.bookmarks) ? dependencies.settings.bookmarks : [];
    setNavigationList({
      kind: 'bookmarks',
      panelId,
      title: dependencies.navigationText.bookmarksTitle,
      items: bookmarks.map((bookmark) => ({
        id: bookmark.id,
        label: bookmark.label,
        path: bookmark.path,
        group: 'bookmark',
      })),
    });
    dependencies.setStatusMessage(null);
  };

  const openHistoryList = (panelId: PanelId) => {
    const panel = dependencies.panelState[panelId];
    const history = [...panel.historyBack, panel.path, ...panel.historyForward];
    setNavigationList({
      kind: 'history',
      panelId,
      title: dependencies.navigationText.historyTitle(panelIdLabel(panelId, dependencies.settings.language)),
      items: history.map((path, index) => ({
        id: `history-${index}-${path}`,
        label: index === panel.historyBack.length ? dependencies.navigationText.currentPathLabel(shortenPath(path)) : shortenPath(path),
        path,
        group: index < panel.historyBack.length ? 'back' : index === panel.historyBack.length ? 'current' : 'forward',
      })),
    });
    dependencies.setStatusMessage(null);
  };

  const openTabList = (panelId: PanelId) => {
    setNavigationList({
      kind: 'tabs',
      panelId,
      title: dependencies.navigationText.tabsTitle(panelIdLabel(panelId, dependencies.settings.language)),
      items: tabItemsForPanel(dependencies, panelId),
    });
    dependencies.setStatusMessage(null);
  };

  const openLocationsList = async (panelId: PanelId) => {
    const requestId = ++locationsRequestRef.current;
    dependencies.setStatusMessage(dependencies.statusText.locationsLoading);
    const result = await dependencies.dataSource.listLocations();
    if (requestId !== locationsRequestRef.current) {
      return;
    }
    if (!result.ok) {
      dependencies.setStatusMessage(dependencies.statusText.locationsFailed(formatUserErrorMessage(dependencies.settings.language, result.error)));
      return;
    }
    setNavigationList({
      kind: 'locations',
      panelId,
      title: dependencies.navigationText.locationsTitle,
      items: navigationItemsFromLocations(result.data, dependencies.settings),
    });
    dependencies.setStatusMessage(null);
  };

  const chooseNavigationItem = (state: NavigationListState, item: NavigationListItem) => {
    setNavigationList(null);
    if (state.kind === 'tabs') {
      const index = state.items.findIndex((candidate) => candidate.id === item.id);
      dependencies.activateTab(state.panelId, index);
      return;
    }
    void dependencies.gotoPanelPath(state.panelId, item.path);
  };

  const closeNavigationTab = (state: NavigationListState, item: NavigationListItem) => {
    if (state.kind !== 'tabs' || state.items.length <= 1) return;
    const index = state.items.findIndex((candidate) => candidate.id === item.id);
    if (index >= 0) dependencies.closeTab(state.panelId, index);
  };

  const visibleNavigationList = useMemo(
    () => navigationList?.kind === 'tabs'
      ? { ...navigationList, items: tabItemsForPanel(dependencies, navigationList.panelId) }
      : navigationList,
    [navigationList, dependencies.panelTabs, dependencies.activeTab, dependencies.panelState, dependencies.panelStateRef],
  );

  return { openLocationsList, openTabList, openHistoryList, addBookmark, openBookmarkList, renameBookmarkForPanel, deleteBookmarkForPanel, setBookmarkRenameRequest, locationsRequestRef, setNavigationList, bookmarkRenameRequest, applyBookmarkRename, navigationList: visibleNavigationList, chooseNavigationItem, closeNavigationTab };
}

function tabItemsForPanel(dependencies: NavigationMenusDependencies, panelId: PanelId): NavigationListItem[] {
  const activeIndex = dependencies.activeTab[panelId];
  const paths = dependencies.panelTabs[panelId].map((tab, index) =>
    index === activeIndex ? dependencies.panelStateRef.current[panelId].path : tab.path,
  );
  return tabListItems(paths, activeIndex);
}

function tabListItems(paths: string[], activeIndex: number): NavigationListItem[] {
  return paths.map((path, index) => ({
    id: `tab-${index}`,
    label: `${index + 1}. ${shortenPath(path)}`,
    path,
    group: index === activeIndex ? 'active tab' : 'tab',
  }));
}

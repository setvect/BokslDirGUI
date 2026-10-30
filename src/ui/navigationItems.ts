import { remoteUrl } from '../domain/remotePath';
import { remoteSettingsOf, type LocationList, type Settings } from '../domain/types';
import {
  COMMANDER_NAVIGATION_TEXT
} from '../i18n-resources';
import {
  type NavigationListItem
} from './CommanderOverlays';
import { shortenPath } from './textLayout';

export const REMOTE_SITE_ITEM_PREFIX = 'remote-site-';

const uniqueNavigationItems = (items: readonly NavigationListItem[]) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.path)) {
      return false;
    }
    seen.add(item.path);
    return true;
  });
};

export const navigationItemsFromLocations = (locations: LocationList, settings: Settings): NavigationListItem[] => {
  const navigationText = COMMANDER_NAVIGATION_TEXT[settings.language];
  return (
    // The palette dedupes by path because navigation target identity matters more
    // than source provenance here; labels from earlier, higher-signal groups win.
    uniqueNavigationItems([
      { id: 'home', label: navigationText.locationHome, path: locations.home, group: 'location' },
      ...locations.roots.map((path, index) => ({
        id: `root-${index}-${path}`,
        label: navigationText.locationRoot(shortenPath(path)),
        path,
        group: 'root',
      })),
      ...locations.recent.map((path, index) => ({
        id: `recent-${index}-${path}`,
        label: navigationText.locationRecent(shortenPath(path)),
        path,
        group: 'recent',
      })),
      ...locations.bookmarks.map((bookmark) => ({
        id: `location-bookmark-${bookmark.id}`,
        label: bookmark.label,
        path: bookmark.path,
        group: 'location bookmark',
      })),
      ...settings.bookmarks.map((bookmark) => ({
        id: `settings-bookmark-${bookmark.id}`,
        label: bookmark.label,
        path: bookmark.path,
        group: 'bookmark',
      })),
      // 저장된 원격 사이트(FR-36.7): 고르면 연결 흐름으로 진행
      ...remoteSettingsOf(settings).sites.map((site) => ({
        id: `${REMOTE_SITE_ITEM_PREFIX}${site.id}`,
        label: `SFTP · ${site.name}`,
        path: remoteUrl(site, site.startPath?.startsWith('/') ? site.startPath : '/'),
        group: 'remote site',
      })),
    ])
  );
};

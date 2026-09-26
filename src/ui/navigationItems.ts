import type { LocationList, Settings } from '../domain/types';
import {
  COMMANDER_NAVIGATION_TEXT
} from '../i18n-resources';
import {
  type NavigationListItem
} from './CommanderOverlays';
import { shortenPath } from './textLayout';

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
    ])
  );
};

import type { PanelId, SavedPanelTabs, SavedTab, Settings } from '../domain/types';
import { DEFAULT_SORT, MAX_PANEL_HISTORY, MAX_PANEL_TABS, type PanelNavigationState, type PanelStateById } from './panelState';

export const savedTab = (panel: PanelNavigationState): SavedTab => ({
  path: panel.path, sort: panel.sort, filter: panel.filter, showHidden: panel.showHidden,
  historyBack: panel.historyBack.slice(-MAX_PANEL_HISTORY), historyForward: panel.historyForward.slice(0, MAX_PANEL_HISTORY),
});

export const sessionFromPanels = (
  panels: PanelStateById, tabs: Record<PanelId, PanelNavigationState[]>,
  active: Record<PanelId, number>, activePanel: PanelId,
): Settings['session'] => {
  const forPanel = (id: PanelId): SavedPanelTabs => ({
    items: tabs[id].map((tab, index) => savedTab(index === active[id] ? panels[id] : tab)),
    activeIndex: active[id],
  });
  return { leftPath: panels.left.path, rightPath: panels.right.path, activePanel,
    tabs: { left: forPanel('left'), right: forPanel('right') } };
};

export function normalizeSavedTabs(value: unknown): Settings['session']['tabs'] {
  if (!value || typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  const panel = (input: unknown): SavedPanelTabs | null => {
    if (!input || typeof input !== 'object') return null;
    const candidate = input as Partial<SavedPanelTabs>;
    if (!Array.isArray(candidate.items) || !candidate.items.length) return null;
    const items = candidate.items.slice(0, MAX_PANEL_TABS).filter((tab) => tab && typeof tab.path === 'string' && tab.path.length > 0)
      .map((tab): SavedTab => ({
        path: tab.path,
        sort: {
          field: ['name', 'size', 'modifiedAt', 'extension'].includes(tab.sort?.field) ? tab.sort.field : DEFAULT_SORT.field,
          direction: tab.sort?.direction === 'desc' ? 'desc' : 'asc',
          directoriesFirst: tab.sort?.directoriesFirst !== false,
        },
        filter: typeof tab.filter === 'string' ? tab.filter : null,
        showHidden: tab.showHidden === true,
        historyBack: Array.isArray(tab.historyBack) ? tab.historyBack.filter((path) => typeof path === 'string').slice(-MAX_PANEL_HISTORY) : [],
        historyForward: Array.isArray(tab.historyForward) ? tab.historyForward.filter((path) => typeof path === 'string').slice(0, MAX_PANEL_HISTORY) : [],
      }));
    if (!items.length) return null;
    return { items, activeIndex: Number.isInteger(candidate.activeIndex)
      ? Math.max(0, Math.min(candidate.activeIndex!, items.length - 1)) : 0 };
  };
  const left = panel(record.left), right = panel(record.right);
  return left && right ? { left, right } : undefined;
}

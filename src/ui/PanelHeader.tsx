import type { Settings } from '../domain/types';
import {
  COMMANDER_UI_TEXT
} from '../i18n-resources';
import { panelIdLabel } from './panelPresentation';
import {
  panelCanGoBack,
  panelCanGoForward,
  type PanelNavigationState
} from './panelState';
import { shortenPath } from './textLayout';

export function PanelHeader({
  panel,
  active,
  tabCount,
  language,
  onClearFilter,
}: {
  panel: PanelNavigationState;
  active: boolean;
  tabCount: number;
  language: Settings['language'];
  onClearFilter(): void;
}) {
  const labels = COMMANDER_UI_TEXT[language];
  return (
    <header className="panel-header">
      <span className="panel-path" title={panel.path}>· {shortenPath(panel.path)}</span>
      {panel.filter ? (
        <button type="button" className="filter-chip" aria-label={`${labels.filter} ${panel.filter} ${labels.target}`} onClick={onClearFilter}>
          {labels.filter.toUpperCase()} {panel.filter} ×
        </button>
      ) : null}
      <span className="panel-tabs">{labels.tabs} {tabCount}</span>
      <span className={`panel-marker ${active ? 'active' : ''}`}>{active ? labels.active : labels.passive}</span>
      {panel.loading ? <span className="panel-loading">{labels.loading}</span> : null}
    </header>
  );
}

export function PathControls({
  panel,
  language,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onRefresh,
  onGotoPath,
  onRestoreFocus,
}: {
  panel: PanelNavigationState;
  language: Settings['language'];
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onRefresh(): void;
  onGotoPath(): void;
  onRestoreFocus(): void;
}) {
  const labels = COMMANDER_UI_TEXT[language];
  const runNavigation = (callback: () => void) => {
    callback();
    window.requestAnimationFrame(() => onRestoreFocus());
  };

  return (
    <div className="path-controls" aria-label={`${panelIdLabel(panel.listing.panelId, language)} ${labels.navigationControls}`}>
      <button type="button" aria-label={labels.back} disabled={!panelCanGoBack(panel)} onClick={() => runNavigation(onNavigateBack)}>◀</button>
      <button type="button" aria-label={labels.forward} disabled={!panelCanGoForward(panel)} onClick={() => runNavigation(onNavigateForward)}>▶</button>
      <button type="button" aria-label={labels.up} onClick={() => runNavigation(onNavigateUp)}>↑</button>
      <button type="button" aria-label={labels.refresh} onClick={() => runNavigation(onRefresh)}>⟳</button>
      <span className="path-input" title={panel.path}>{panel.path}</span>
      <button type="button" aria-label={labels.gotoPath} onClick={onGotoPath}>⌘</button>
    </div>
  );
}

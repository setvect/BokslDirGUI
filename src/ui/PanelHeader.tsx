import type { Settings } from '../domain/types';
import {
  COMMANDER_UI_TEXT
} from '../i18n-resources';
import { panelIdLabel } from './panelPresentation';
import { displayPath } from './textLayout';
import {
  panelCanGoBack,
  panelCanGoForward,
  type PanelNavigationState
} from './panelState';

export function PanelHeader({
  panel,
  tabCount,
  language,
  onClearFilter,
  onNavigateBack,
  onNavigateForward,
  onNavigateUp,
  onGotoPath,
  onRestoreFocus,
}: {
  panel: PanelNavigationState;
  tabCount: number;
  onClearFilter(): void;
  language: Settings['language'];
  onNavigateBack(): void;
  onNavigateForward(): void;
  onNavigateUp(): void;
  onGotoPath(): void;
  onRestoreFocus(): void;
}) {
  const labels = COMMANDER_UI_TEXT[language];
  const pathLabel = displayPath(panel.path);
  const runNavigation = (callback: () => void) => {
    callback();
    window.requestAnimationFrame(() => onRestoreFocus());
  };

  return (
    <header className="path-controls" aria-label={`${panelIdLabel(panel.listing.panelId, language)} ${labels.navigationControls}`}>
      <button type="button" aria-label={labels.back} disabled={!panelCanGoBack(panel)} onClick={() => runNavigation(onNavigateBack)}>◀</button>
      <button type="button" aria-label={labels.forward} disabled={!panelCanGoForward(panel)} onClick={() => runNavigation(onNavigateForward)}>▶</button>
      <button type="button" aria-label={labels.up} onClick={() => runNavigation(onNavigateUp)}>↑</button>
      <span className="path-input" title={pathLabel}>{pathLabel}</span>
      <button type="button" aria-label={labels.gotoPath} onClick={onGotoPath}>↗</button>
      <div className="panel-header-status">
        {panel.filter ? (
          <button type="button" className="filter-chip" title={panel.filter} aria-label={`${labels.filter} ${panel.filter} ${labels.target}`} onClick={onClearFilter}>
            <span className="filter-chip-label">{labels.filter.toUpperCase()} {panel.filter} </span>×
          </button>
        ) : null}
        <span className={`panel-loading${panel.loading ? ' is-loading' : ''}`} aria-label={labels.loading} title={labels.loading} aria-hidden={!panel.loading}>⟳</span>
        <span className="panel-tabs" title={`${labels.tabs} ${tabCount}`} aria-label={`${labels.tabs} ${tabCount}`}><span className="panel-tabs-label">{labels.tabs} </span>{tabCount}</span>
      </div>
    </header>
  );
}

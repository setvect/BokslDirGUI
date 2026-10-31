import type { Settings } from '../domain/types';
import {
  COMMANDER_UI_TEXT
} from '../i18n-resources';
import { panelIdLabel } from './panelPresentation';
import type { RemotePanelStatus } from './remoteSessionState';
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
  remoteStatus = null,
}: {
  panel: PanelNavigationState;
  tabCount: number;
  remoteStatus?: RemotePanelStatus | null;
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
  const remoteStateLabel = remoteStatus
    ? { connected: labels.remoteConnected, lost: labels.remoteLost, disconnected: labels.remoteDisconnected }[remoteStatus.state]
    : null;
  const remoteTitle = remoteStatus
    ? [remoteStatus.siteName, remoteStatus.address, remoteStateLabel].filter(Boolean).join(' · ')
    : '';
  const runNavigation = (callback: () => void) => {
    callback();
    window.requestAnimationFrame(() => onRestoreFocus());
  };

  return (
    <header className="path-controls" aria-label={`${panelIdLabel(panel.listing.panelId, language)} ${labels.navigationControls}`}>
      <button type="button" aria-label={labels.back} disabled={!panelCanGoBack(panel)} onClick={() => runNavigation(onNavigateBack)}>◀</button>
      <button type="button" aria-label={labels.forward} disabled={!panelCanGoForward(panel)} onClick={() => runNavigation(onNavigateForward)}>▶</button>
      <button type="button" aria-label={labels.up} onClick={() => runNavigation(onNavigateUp)}>↑</button>
      {/* 긴 경로는 앞쪽을 줄여 현재 폴더 이름(끝)이 보이게 함: 바깥은 오른쪽 기준, 안쪽 글자는 왼쪽→오른쪽으로 격리 */}
      <span className="path-input" title={pathLabel}><bdi className="path-input-text">{pathLabel}</bdi></span>
      <button type="button" aria-label={labels.gotoPath} onClick={onGotoPath}>↗</button>
      <div className="panel-header-status">
        {panel.filter ? (
          <button type="button" className="filter-chip" title={panel.filter} aria-label={`${labels.filter} ${panel.filter} ${labels.target}`} onClick={onClearFilter}>
            <span className="filter-chip-label">{labels.filter.toUpperCase()} {panel.filter} </span>×
          </button>
        ) : null}
        {remoteStatus ? (
          <span className={`remote-chip is-${remoteStatus.state}`} role="status" title={remoteTitle} aria-label={`SFTP ${remoteTitle}`}>
            <span className="remote-chip-name">{remoteStatus.siteName ?? 'SFTP'} </span>{remoteStateLabel}
          </span>
        ) : null}
        <span className={`panel-loading${panel.loading ? ' is-loading' : ''}`} aria-label={labels.loading} title={labels.loading} aria-hidden={!panel.loading}>⟳</span>
        <span className="panel-tabs" title={`${labels.tabs} ${tabCount}`} aria-label={`${labels.tabs} ${tabCount}`}><span className="panel-tabs-label">{labels.tabs} </span>{tabCount}</span>
      </div>
    </header>
  );
}

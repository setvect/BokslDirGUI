import { displayPath } from '../domain/pathDisplay';
import { useMemo, useRef } from 'react';
import {
  hotkeyLabelForAction,
  hotkeyStripActionsFromRegistry,
  shortcutLabelForAction
} from '../actions/registry';
import type { FileEntry, PanelId, Settings } from '../domain/types';
import {
  COMMANDER_UI_TEXT,
  HOTKEY_STRIP_TEXT,
  METADATA_KIND_LABELS
} from '../i18n-resources';
import { formatSize } from './format';
import { hotkeyStripActionsForWidth } from './hotkeyStripLayout';
import { useElementWidth } from './useElementWidth';

export function BottomStatusStrip({
  language,
  activePanel,
  focusedEntry,
  message,
  filter,
  sizeFormat,
}: {
  language: Settings['language'];
  activePanel: PanelId;
  focusedEntry: FileEntry | null;
  message: string | null;
  filter: string | null;
  sizeFormat: Settings['sizeFormat'];
}) {
  const labels = COMMANDER_UI_TEXT[language];
  return (
    <footer className="bottom-status" aria-label={labels.activePanelStatus}>
      {focusedEntry ? (
        <span className="status-focused-entry" title={displayPath(focusedEntry.path)}>
          {focusedEntry.name} · {METADATA_KIND_LABELS[language][focusedEntry.kind]}{formatSize(focusedEntry, sizeFormat) ? ` · ${formatSize(focusedEntry, sizeFormat)}` : ''}
        </span>
      ) : null}
      {filter ? <span className="status-filter">{labels.filter}: {filter}</span> : null}
      <span className="status-panel">{activePanel === 'left' ? labels.activePanelLeft : labels.activePanelRight}</span>
      {message ? <span className="status-message" aria-live="polite">{message}</span> : null}
    </footer>
  );
}

export function HotkeyStrip({ scale, language, onShowAllShortcuts }: {
  scale: number;
  language: Settings['language'];
  /** "+N"을 누르면 숨겨진 단축키를 볼 수 있게 단축키 도움말 열기 */
  onShowAllShortcuts?: () => void;
}) {
  const stripRef = useRef<HTMLElement>(null);
  const stripWidth = useElementWidth(stripRef, 960);
  const visibleActions = useMemo(
    () => hotkeyStripActionsForWidth(stripWidth, scale, undefined, language),
    [language, scale, stripWidth],
  );
  const hiddenCount = hotkeyStripActionsFromRegistry().length - visibleActions.length;
  return (
    <footer
      ref={stripRef}
      className="hotkey-strip"
      aria-label="hotkey hints"
      title={hiddenCount > 0 ? HOTKEY_STRIP_TEXT[language].hiddenShortcuts(hiddenCount) : HOTKEY_STRIP_TEXT[language].allVisible}
    >
      {visibleActions.map((action) => {
        const shortcut = shortcutLabelForAction(action);
        return (
          <span className="hotkey" key={action.id}>
            <kbd>{shortcut}</kbd>:<span>{hotkeyLabelForAction(action, language)}</span>
          </span>
        );
      })}
      {hiddenCount > 0 ? (
        <button type="button" className="hotkey hotkey-more" tabIndex={-1} onClick={onShowAllShortcuts}
          title={HOTKEY_STRIP_TEXT[language].hiddenShortcuts(hiddenCount)} aria-label={HOTKEY_STRIP_TEXT[language].hiddenShortcutLabel(hiddenCount)}>
          +{hiddenCount}
        </button>
      ) : null}
    </footer>
  );
}

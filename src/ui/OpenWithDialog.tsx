import { useEffect, useRef, useState } from 'react';
import type { FileEntry, OpenWithApp } from '../domain/types';
import { formatUserErrorMessage, type SupportedLanguage } from '../i18n-resources';
import type { SafeMutationClient } from '../tauri/commanderClients';
import { CommanderOverlayDialog } from './CommanderOverlays';

const TEXT = {
  ko: { title: '다음으로 열기', search: '앱 검색', loading: '앱 목록을 불러오는 중…', empty: '이 파일을 열 수 있는 앱이 없습니다.', noMatch: '검색 결과가 없습니다.', default: '기본', close: '취소', retry: '다시 불러오기', failed: '앱을 열지 못했습니다.', opening: '앱으로 여는 중…' },
  en: { title: 'Open With', search: 'Search apps', loading: 'Loading applications…', empty: 'No applications are available for this file.', noMatch: 'No matching applications.', default: 'default', close: 'Cancel', retry: 'Reload applications', failed: 'Unable to open the application.', opening: 'Opening application…' },
};

export function OpenWithDialog({ entry, language, client, onClose }: {
  entry: FileEntry;
  language: SupportedLanguage;
  client: SafeMutationClient;
  onClose(): void;
}) {
  const text = TEXT[language];
  const [apps, setApps] = useState<OpenWithApp[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const requestRef = useRef(0);
  const openingRef = useRef(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const visibleApps = apps.filter((app) => app.name.toLocaleLowerCase().includes(query.toLocaleLowerCase().trim()));

  useEffect(() => {
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    setApps([]);
    void (async () => {
      try {
        const result = await client.listOpenWithApps!({ path: entry.path });
        if (request !== requestRef.current) return;
        if (result.ok) setApps(result.data);
        else setError(formatUserErrorMessage(language, result.error));
      } catch {
        if (request === requestRef.current) setError(text.failed);
      } finally {
        if (request === requestRef.current) setLoading(false);
      }
    })();
    return () => { requestRef.current += 1; };
  }, [client, entry.path, language, reload, text.failed]);

  const open = async (app: OpenWithApp) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setError(null);
    const request = requestRef.current;
    try {
      const result = await client.openWithApp!({ path: entry.path, applicationPath: app.path });
      if (request !== requestRef.current) return;
      if (result.ok) onClose();
      else setError(formatUserErrorMessage(language, result.error));
    } catch {
      if (request === requestRef.current) setError(text.failed);
    } finally {
      if (request === requestRef.current) {
        openingRef.current = false;
        setOpening(false);
      }
    }
  };

  const focusApp = (index: number) => {
    const buttons = listRef.current?.querySelectorAll<HTMLButtonElement>('button');
    if (!buttons?.length) return;
    const button = buttons[Math.max(0, Math.min(index, buttons.length - 1))];
    button.focus();
    button.scrollIntoView?.({ block: 'nearest' });
  };

  return (
    <CommanderOverlayDialog owner="open-with" title={text.title} ariaLabel={text.title} onClose={onClose}
      className="open-with-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); searchRef.current?.focus(); }}>
      <div className="filter-form">
        <p className="open-with-target" title={entry.path}>{entry.path}</p>
        <input ref={searchRef} aria-label={text.search} placeholder={text.search} value={query} disabled={opening}
          onChange={(event) => setQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); focusApp(0); }
          }} />
        {error ? <p className="operation-error" role="alert">{error}</p> : null}
        {loading || opening ? <p role="status">{opening ? text.opening : text.loading}</p> : null}
        <div className="navigation-list open-with-list" ref={listRef} aria-busy={loading || opening}
          onKeyDown={(event) => {
            const buttons = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (index < 0 || event.altKey || event.ctrlKey || event.metaKey) return;
            const next = { ArrowDown: index + 1, ArrowUp: index - 1, Home: 0, End: buttons.length - 1 }[event.key];
            if (next !== undefined) { event.preventDefault(); focusApp(next); }
          }}>
          {visibleApps.map((app) => (
            <button className="navigation-list-item open-with-app" type="button" key={app.path} disabled={opening}
              onClick={() => { void open(app); }}>
              <span>{app.name}{app.isDefault ? ` (${text.default})` : ''}</span>
              <small title={app.path}>{app.path}</small>
            </button>
          ))}
          {!loading && !error && visibleApps.length === 0 ? <p className="dialog-empty">{apps.length ? text.noMatch : text.empty}</p> : null}
        </div>
        <div className="filter-actions">
          <button type="button" disabled={loading || opening} onClick={() => setReload((value) => value + 1)}>{text.retry}</button>
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

import { displayPath } from '../domain/pathDisplay';
import { useEffect, useRef, useState } from 'react';
import type { FileEntry, RenameItem, RenamePreview, RenameRules } from '../domain/types';
import { BULK_RENAME_TEXT, formatUserErrorMessage, type SupportedLanguage } from '../i18n-resources';
import type { SafeMutationClient } from '../tauri/commanderClients';
import { CommanderOverlayDialog } from './CommanderOverlays';

const DEFAULT_RULES: RenameRules = { find: '', replacement: '', prefix: '', numbering: false, start: 1, padding: 3, preserveExtension: true };

export function BulkRenameDialog({ sources, language, client, onClose, onConfirm }: {
  sources: FileEntry[]; language: SupportedLanguage; client: SafeMutationClient;
  onClose(): void; onConfirm(items: RenameItem[]): void;
}) {
  const text = BULK_RENAME_TEXT[language];
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [preview, setPreview] = useState<{ signature: string; rows: RenamePreview[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const revision = useRef(0);
  const submitted = useRef(false);
  const firstInput = useRef<HTMLInputElement>(null);
  const signature = JSON.stringify(rules);
  const rows = preview?.signature === signature ? preview.rows : null;
  const ready = rows && rows.length === sources.length && rows.some(row => row.changed) && rows.every(row => !row.error);
  useEffect(() => {
    const request = ++revision.current;
    setError(null);
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const result = await client.previewBulkRename!({ sources: sources.map(source => source.path), rules });
          if (request !== revision.current) return;
          if (result.ok) setPreview({ signature, rows: result.data });
          else setError(formatUserErrorMessage(language, result.error));
        } catch { if (request === revision.current) setError(text.failed); }
      })();
    }, 150);
    return () => { revision.current++; window.clearTimeout(timer); };
  }, [signature, sources, client, language, text.failed]);
  const update = (patch: Partial<RenameRules>) => { revision.current++; setPreview(null); setError(null); setRules(current => ({ ...current, ...patch })); };
  return <CommanderOverlayDialog owner="bulk-rename" title={text.title} ariaLabel={text.title} onClose={onClose}
    className="bulk-rename-dialog" onOpenAutoFocus={event => { event.preventDefault(); firstInput.current?.focus(); }}>
    <div className="bulk-rename-fields">
      {(['find', 'replacement', 'prefix'] as const).map((key, index) => <label key={key}>{text[key]}
        <input ref={index === 0 ? firstInput : undefined} value={rules[key]} onChange={event => update({ [key]: event.currentTarget.value })} />
      </label>)}
      <label><input type="checkbox" checked={rules.preserveExtension} onChange={event => update({ preserveExtension: event.currentTarget.checked })} />{text.extension}</label>
      <label><input type="checkbox" checked={rules.numbering} onChange={event => update({ numbering: event.currentTarget.checked })} />{text.numbering}</label>
      <label>{text.start}<input type="number" min={0} max={1000000000} disabled={!rules.numbering} value={rules.start} onChange={event => update({ start: event.currentTarget.valueAsNumber })} /></label>
      <label>{text.padding}<input type="number" min={0} max={9} disabled={!rules.numbering} value={rules.padding} onChange={event => update({ padding: event.currentTarget.valueAsNumber })} /></label>
    </div>
    <p>{text.note}</p>
    {error ? <p role="alert" className="operation-error">{error}</p> : !rows ? <p role="status">{text.loading}</p> : null}
    <div className="bulk-rename-preview" role="region" aria-label={text.title} tabIndex={0}>
      <table><thead><tr><th>{text.before}</th><th>{text.after}</th></tr></thead><tbody>
        {(rows ?? sources.map(source => ({ item: { source: source.path, newName: '', stamp: '' }, changed: false, error: null }))).map((row, index) =>
          <tr key={row.item.source}><td title={displayPath(row.item.source)}>{sources[index].name}</td><td>{row.item.newName}
            {row.error ? <span className="operation-error"> — {formatUserErrorMessage(language, row.error)}</span> : rows && !row.changed ? <small> — {text.unchanged}</small> : null}
          </td></tr>)}
      </tbody></table>
    </div>
    <div className="filter-actions"><button type="button" onClick={onClose}>{text.cancel}</button>
      <button type="button" className="primary" disabled={!ready} onClick={() => {
        if (!ready || submitted.current) return;
        submitted.current = true;
        onConfirm(rows.filter(row => row.changed).map(row => row.item));
      }}>{text.apply}</button></div>
  </CommanderOverlayDialog>;
}

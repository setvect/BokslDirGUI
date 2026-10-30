import { useRef, useState } from 'react';
import type { ChmodScope, FileEntry } from '../domain/types';
import { REMOTE_CHMOD_TEXT, type SupportedLanguage } from '../i18n-resources';
import { CommanderOverlayDialog } from './CommanderOverlays';
import { commonMode, formatOctalMode, parseOctalMode, PERMISSION_BITS } from './remoteChmod';

export function RemoteChmodDialog({ sources, language, onClose, onConfirm }: {
  sources: FileEntry[]; language: SupportedLanguage;
  onClose(): void; onConfirm(input: { mode: number; recursive: boolean; scope: ChmodScope }): void;
}) {
  const text = REMOTE_CHMOD_TEXT[language];
  const initial = commonMode(sources.map((source) => source.permissions));
  const [octal, setOctal] = useState(initial === null ? '' : formatOctalMode(initial));
  const [recursive, setRecursive] = useState(false);
  const [scope, setScope] = useState<ChmodScope>('all');
  const submitted = useRef(false);
  const octalInput = useRef<HTMLInputElement>(null);
  const mode = parseOctalMode(octal);
  const hasDirectory = sources.some((source) => source.kind === 'directory');
  const toggle = (bit: number, checked: boolean) => {
    const base = mode ?? 0;
    setOctal(formatOctalMode(checked ? base | bit : base & ~bit));
  };
  const submit = () => {
    if (mode === null || submitted.current) return;
    submitted.current = true;
    onConfirm({ mode, recursive: hasDirectory && recursive, scope });
  };
  const rows = [text.owner, text.group, text.others];
  return <CommanderOverlayDialog owner="remote-chmod" title={text.title} ariaLabel={text.title} onClose={onClose}
    className="remote-chmod-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); octalInput.current?.focus(); octalInput.current?.select(); }}>
    <p className="remote-chmod-targets">{text.selected}: {sources.map((source) => source.name).join(', ')}</p>
    <label className="remote-chmod-octal">{text.octal}
      <input ref={octalInput} value={octal} inputMode="numeric" maxLength={4} aria-invalid={mode === null}
        onChange={(event) => setOctal(event.currentTarget.value.replace(/[^0-7]/g, ''))}
        onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); submit(); } }} />
    </label>
    <table className="remote-chmod-grid"><thead><tr><th />{[text.read, text.write, text.execute].map((label) => <th key={label}>{label}</th>)}</tr></thead>
      <tbody>{PERMISSION_BITS.map((bits, row) => <tr key={rows[row]}><th scope="row">{rows[row]}</th>
        {bits.map((bit, column) => <td key={bit}><input type="checkbox" aria-label={`${rows[row]} ${[text.read, text.write, text.execute][column]}`}
          checked={mode !== null && (mode & bit) !== 0} onChange={(event) => toggle(bit, event.currentTarget.checked)} /></td>)}
      </tr>)}</tbody></table>
    <label><input type="checkbox" disabled={!hasDirectory} checked={hasDirectory && recursive} onChange={(event) => setRecursive(event.currentTarget.checked)} />{text.recursive}</label>
    <fieldset className="remote-chmod-scope" disabled={!hasDirectory || !recursive}>
      {([['all', text.scopeAll], ['files', text.scopeFiles], ['directories', text.scopeDirectories]] as const).map(([value, label]) =>
        <label key={value}><input type="radio" name="remote-chmod-scope" value={value} checked={scope === value} onChange={() => setScope(value)} />{label}</label>)}
    </fieldset>
    <p>{text.note}</p>
    {mode === null ? <p role="alert" className="operation-error">{text.invalid}</p> : null}
    <div className="filter-actions"><button type="button" onClick={onClose}>{text.cancel}</button>
      <button type="button" className="primary" disabled={mode === null} onClick={submit}>{text.apply}</button></div>
  </CommanderOverlayDialog>;
}

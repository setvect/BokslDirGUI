import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { RemoteAuthMethod, RemoteSession, RemoteSite } from '../domain/types';
import { REMOTE_CONNECT_TEXT, type SupportedLanguage } from '../i18n-resources';
import { CommanderOverlayDialog } from './CommanderOverlays';
import { usesSecret, type AuthPrompts, type HostKeyQuestion, type RemoteConnectDraft, type RemoteSecrets } from './remoteConnectModel';
import { remoteAddressOf, type RemotePanelStatus } from './remoteSessionState';
import { LITERAL_TEXT_INPUT_PROPS } from './textInputProps';

const AUTH_METHODS: readonly RemoteAuthMethod[] = ['password', 'publicKey', 'agent', 'keyboardInteractive'];

const authLabel = (language: SupportedLanguage, method: RemoteAuthMethod) => {
  const text = REMOTE_CONNECT_TEXT[language];
  return { password: text.authPassword, publicKey: text.authPublicKey, agent: text.authAgent, keyboardInteractive: text.authKeyboard }[method];
};


// 연결 창: 연결 정보 입력, 비밀값은 제출 때만 넘기고 창이 닫히면 버림
export function RemoteConnectDialog({ language, draft: initial, error, pending, onConnect, onSave, onCancel }: {
  language: SupportedLanguage;
  draft: RemoteConnectDraft;
  error: string | null;
  pending: boolean;
  onConnect(draft: RemoteConnectDraft, secrets: RemoteSecrets): void;
  onSave(draft: RemoteConnectDraft): void;
  onCancel(): void;
}) {
  const text = REMOTE_CONNECT_TEXT[language];
  const [draft, setDraft] = useState(initial);
  const [portText, setPortText] = useState(String(initial.port));
  const [password, setPassword] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const firstInput = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const update = (patch: Partial<RemoteConnectDraft>) => setDraft((current) => ({ ...current, ...patch }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onConnect(draft, { password, passphrase });
  };
  // 긴 연결 창(창 안 스크롤)에서도 호스트 키 차단·인증 실패 문구가 보이도록 오류로 스크롤
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [error]);
  return (
    <CommanderOverlayDialog owner="remote-connect" title={text.connectTitle} ariaLabel={text.connectTitle} onClose={onCancel}
      className="remote-connect-dialog" onOpenAutoFocus={(event) => { if (firstInput.current) { event.preventDefault(); firstInput.current.focus(); } }}>
      <form className="filter-form remote-connect-form" onSubmit={submit}>
        <div className="remote-connect-grid">
          <label>{text.host}<input {...LITERAL_TEXT_INPUT_PROPS} ref={draft.host ? undefined : firstInput} value={draft.host} disabled={pending}
            onChange={(event) => update({ host: event.currentTarget.value })} /></label>
          <label>{text.port}<input inputMode="numeric" maxLength={5} value={portText} disabled={pending}
            onChange={(event) => { const value = event.currentTarget.value.replace(/\D/g, ''); setPortText(value); update({ port: Number.parseInt(value, 10) }); }} /></label>
          <label>{text.user}<input {...LITERAL_TEXT_INPUT_PROPS} value={draft.user} disabled={pending}
            onChange={(event) => update({ user: event.currentTarget.value })} /></label>
          <label>{text.authMethod}<select value={draft.authMethod} disabled={pending}
            onChange={(event) => update({ authMethod: event.currentTarget.value as RemoteAuthMethod })}>
            {AUTH_METHODS.map((method) => <option key={method} value={method}>{authLabel(language, method)}</option>)}
          </select></label>
        </div>
        {draft.authMethod === 'password' ? (
          <label>{text.password}<input ref={draft.host ? firstInput : undefined} type="password" value={password} disabled={pending} autoComplete="off"
            placeholder={draft.hasSavedSecret ? text.savedSecretHint : undefined}
            onChange={(event) => setPassword(event.currentTarget.value)} /></label>
        ) : null}
        {draft.authMethod === 'publicKey' ? (
          <>
            <label>{text.keyPath}<input {...LITERAL_TEXT_INPUT_PROPS} value={draft.keyPath} disabled={pending}
              onChange={(event) => update({ keyPath: event.currentTarget.value })} /></label>
            <label>{text.passphrase}<input ref={draft.host ? firstInput : undefined} type="password" value={passphrase} disabled={pending} autoComplete="off"
              placeholder={draft.hasSavedSecret ? text.savedSecretHint : undefined}
              onChange={(event) => setPassphrase(event.currentTarget.value)} /></label>
          </>
        ) : null}
        <label>{text.startPath}<input {...LITERAL_TEXT_INPUT_PROPS} value={draft.startPath} disabled={pending}
          onChange={(event) => update({ startPath: event.currentTarget.value })} /></label>
        <label className="remote-connect-check"><input type="checkbox" checked={draft.saveSite} disabled={pending}
          onChange={(event) => update({ saveSite: event.currentTarget.checked })} />{text.saveSite}</label>
        {draft.saveSite ? (
          <label>{text.siteName}<input {...LITERAL_TEXT_INPUT_PROPS} value={draft.name} maxLength={120} disabled={pending}
            onChange={(event) => update({ name: event.currentTarget.value })} /></label>
        ) : null}
        {draft.saveSite && usesSecret(draft.authMethod) ? (
          <label className="remote-connect-check"><input type="checkbox" checked={draft.saveSecret} disabled={pending}
            onChange={(event) => update({ saveSecret: event.currentTarget.checked })} />{text.saveSecret}</label>
        ) : null}
        <p className="operation-muted">{text.secretNote}</p>
        {error ? <p ref={errorRef} className="operation-error" role="alert">{error}</p> : null}
        {pending ? <p role="status">{text.connecting}</p> : null}
        <div className="filter-actions">
          <button type="button" onClick={onCancel}>{text.cancel}</button>
          {draft.saveSite ? <button type="button" disabled={pending} onClick={() => onSave(draft)}>{text.save}</button> : null}
          <button type="submit" className="primary" disabled={pending}>{text.connect}</button>
        </div>
      </form>
    </CommanderOverlayDialog>
  );
}

// 처음 보는 호스트 키 확인. 기본 포커스는 취소(FR-35.3, 4.3)
export function RemoteHostKeyDialog({ language, question, pending, onTrust, onCancel }: {
  language: SupportedLanguage; question: HostKeyQuestion; pending: boolean; onTrust(): void; onCancel(): void;
}) {
  const text = REMOTE_CONNECT_TEXT[language];
  const cancelRef = useRef<HTMLButtonElement>(null);
  const server = `${question.host.includes(':') ? `[${question.host}]` : question.host}:${question.port}`;
  return (
    <CommanderOverlayDialog owner="remote-host-key" title={text.hostKeyTitle} ariaLabel={text.hostKeyTitle} onClose={onCancel}
      className="remote-host-key-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
      <p>{text.hostKeyIntro}</p>
      <dl className="remote-info-list">
        <dt>{text.hostKeyServer}</dt><dd>{server}</dd>
        <dt>{text.hostKeyAlgorithm}</dt><dd>{question.algorithm}</dd>
        <dt>{text.hostKeyFingerprint}</dt><dd className="remote-fingerprint">{question.fingerprint}</dd>
      </dl>
      <div className="filter-actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>{text.cancel}</button>
        <button type="button" className="primary" disabled={pending} onClick={onTrust}>{text.trust}</button>
      </div>
    </CommanderOverlayDialog>
  );
}

// keyboard-interactive 질문(FR-35.8). 숨김 질문은 암호 입력란
export function RemoteAuthPromptDialog({ language, prompts, error, pending, onSubmit, onCancel }: {
  language: SupportedLanguage; prompts: AuthPrompts; error: string | null; pending: boolean; onSubmit(responses: string[]): void; onCancel(): void;
}) {
  const text = REMOTE_CONNECT_TEXT[language];
  const [responses, setResponses] = useState(() => prompts.prompts.map(() => ''));
  const firstInput = useRef<HTMLInputElement>(null);
  return (
    <CommanderOverlayDialog owner="remote-prompts" title={text.promptsTitle} ariaLabel={text.promptsTitle} onClose={onCancel}
      onOpenAutoFocus={(event) => { event.preventDefault(); firstInput.current?.focus(); }}>
      <form className="filter-form" onSubmit={(event) => { event.preventDefault(); onSubmit(responses); }}>
        <p>{prompts.instructions || text.promptsIntro}</p>
        {prompts.prompts.map((prompt, index) => (
          <label key={`${index}-${prompt.prompt}`}>{prompt.prompt.trim() || text.password}
            <input ref={index === 0 ? firstInput : undefined} type={prompt.echo ? 'text' : 'password'} autoComplete="off" value={responses[index]} disabled={pending}
              onChange={(event) => { const value = event.currentTarget.value; setResponses((current) => current.map((item, at) => (at === index ? value : item))); }} />
          </label>
        ))}
        {error ? <p className="operation-error" role="alert">{error}</p> : null}
        <div className="filter-actions">
          <button type="button" onClick={onCancel}>{text.cancel}</button>
          <button type="submit" className="primary" disabled={pending}>{text.confirm}</button>
        </div>
      </form>
    </CommanderOverlayDialog>
  );
}

// 사이트 한 항목: 이름(첫 줄)과 주소·인증 방식(둘째 줄). 사이트 목록과 삭제 확인 창에서 같이 사용
function RemoteSiteSummary({ language, site }: { language: SupportedLanguage; site: RemoteSite }) {
  return (
    <>
      {/* 사이 공백: 화면 배치(그리드)에는 영향 없이 읽기 프로그램이 이름과 주소를 붙여 읽지 않게 함 */}
      <strong>{site.name}</strong>{' '}
      <span className="remote-site-detail">{remoteAddressOf(site.user, site.host, site.port)} · {authLabel(language, site.authMethod)}</span>
    </>
  );
}

// 저장된 사이트 목록: 연결·추가·편집·복제·삭제(FR-34.3). 위·아래 키로 선택, Enter로 연결, Delete·Backspace로 삭제 확인
export function RemoteSitesDialog({ language, sites, selectedId, onSelect, onConnect, onNew, onEdit, onDuplicate, onDelete, onForgetSecret, onImport, onClose }: {
  language: SupportedLanguage;
  sites: readonly RemoteSite[];
  selectedId: string | null;
  onSelect(id: string): void;
  onConnect(site: RemoteSite): void;
  onNew(): void;
  onEdit(site: RemoteSite): void;
  onDuplicate(site: RemoteSite): void;
  onDelete(site: RemoteSite): void;
  onForgetSecret(site: RemoteSite): void;
  onImport(): void;
  onClose(): void;
}) {
  const text = REMOTE_CONNECT_TEXT[language];
  const listRef = useRef<HTMLUListElement>(null);
  const newRef = useRef<HTMLButtonElement>(null);
  const selected = sites.find((site) => site.id === selectedId) ?? null;
  const move = (step: number) => {
    if (!sites.length) return;
    const index = Math.max(0, sites.findIndex((site) => site.id === selectedId));
    onSelect(sites[Math.min(sites.length - 1, Math.max(0, index + step))].id);
  };
  // 고른 사이트를 목록 안에 보이게 유지: 키 이동 때와 창이 열릴 때(삭제 확인·편집 창에서 돌아온 경우 포함).
  // 처음 그릴 때는 포털에 내용이 아직 없어 열림 시점(onOpenAutoFocus)에 한 번 더 맞춤
  const showSelected = () => {
    if (selectedId) document.getElementById(`remote-site-${selectedId}`)?.scrollIntoView?.({ block: 'nearest' });
  };
  useEffect(() => showSelected(), [selectedId]);
  return (
    <CommanderOverlayDialog owner="remote-sites" title={text.sitesTitle} ariaLabel={text.sitesTitle} onClose={onClose}
      className="remote-sites-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); (sites.length ? listRef.current : newRef.current)?.focus(); showSelected(); }}>
      {sites.length ? (
        <ul ref={listRef} className="remote-site-list" role="listbox" aria-label={text.sitesTitle} tabIndex={0}
          aria-activedescendant={selected ? `remote-site-${selected.id}` : undefined}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') { event.preventDefault(); move(1); }
            else if (event.key === 'ArrowUp') { event.preventDefault(); move(-1); }
            else if (event.key === 'Enter' && selected) { event.preventDefault(); onConnect(selected); }
            else if ((event.key === 'Delete' || event.key === 'Backspace') && selected) { event.preventDefault(); onDelete(selected); }
          }}>
          {sites.map((site) => (
            <li key={site.id} id={`remote-site-${site.id}`} role="option" aria-selected={site.id === selectedId}
              className={site.id === selectedId ? 'is-selected' : undefined}
              onClick={() => onSelect(site.id)} onDoubleClick={() => onConnect(site)}>
              <RemoteSiteSummary language={language} site={site} />
            </li>
          ))}
        </ul>
      ) : <p>{text.noSites}</p>}
      {/* 버튼은 역할별 두 줄: 목록 아래 사이트 관리, 맨 아래 가져오기(왼쪽)와 창 버튼(오른쪽) */}
      <div className="filter-actions remote-site-tools">
        <button ref={newRef} type="button" onClick={onNew}>{text.newSite}</button>
        <button type="button" disabled={!selected} onClick={() => selected && onEdit(selected)}>{text.edit}</button>
        <button type="button" disabled={!selected} onClick={() => selected && onDuplicate(selected)}>{text.duplicate}</button>
        <button type="button" disabled={!selected} onClick={() => selected && onDelete(selected)}>{text.delete}</button>
        <button type="button" disabled={!selected?.savedSecret} onClick={() => selected && onForgetSecret(selected)}>{text.forgetSecret}</button>
      </div>
      <div className="filter-actions remote-site-footer">
        <button type="button" className="remote-site-import" onClick={onImport}>{text.importSshConfig}</button>
        <button type="button" onClick={onClose}>{text.close}</button>
        <button type="button" className="primary" disabled={!selected} onClick={() => selected && onConnect(selected)}>{text.connect}</button>
      </div>
    </CommanderOverlayDialog>
  );
}

// 사이트 삭제 확인(FR-34.3, FR-35.6): 지울 사이트와 함께 지워지는 저장된 비밀값 안내. 기본 포커스는 취소, Esc는 목록으로 복귀
export function RemoteSiteDeleteDialog({ language, site, onConfirm, onCancel }: {
  language: SupportedLanguage; site: RemoteSite; onConfirm(): void; onCancel(): void;
}) {
  const text = REMOTE_CONNECT_TEXT[language];
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <CommanderOverlayDialog owner="remote-site-delete" title={text.deleteSiteTitle} ariaLabel={text.deleteSiteTitle} onClose={onCancel}
      className="remote-site-delete-dialog" onOpenAutoFocus={(event) => { event.preventDefault(); cancelRef.current?.focus(); }}>
      <p>{text.deleteSiteIntro}</p>
      <div className="remote-site-delete-target"><RemoteSiteSummary language={language} site={site} /></div>
      {site.savedSecret ? <p className="remote-site-delete-note">{text.deleteSiteSecretNote}</p> : null}
      <div className="filter-actions">
        <button ref={cancelRef} type="button" onClick={onCancel}>{text.cancel}</button>
        <button type="button" className="danger" onClick={onConfirm}>{text.delete}</button>
      </div>
    </CommanderOverlayDialog>
  );
}

export function RemoteInfoDialog({ language, status, session, onClose }: {
  language: SupportedLanguage; status: RemotePanelStatus; session: RemoteSession | null; onClose(): void;
}) {
  const text = REMOTE_CONNECT_TEXT[language];
  const state = { connected: text.stateConnected, lost: text.stateLost, disconnected: text.stateDisconnected }[status.state];
  return (
    <CommanderOverlayDialog owner="remote-info" title={text.infoTitle} ariaLabel={text.infoTitle} onClose={onClose}>
      <dl className="remote-info-list">
        {status.siteName ? <><dt>{text.infoSite}</dt><dd>{status.siteName}</dd></> : null}
        <dt>{text.infoAddress}</dt><dd>{status.address}</dd>
        <dt>{text.infoState}</dt><dd>{state}</dd>
        <dt>{text.infoHome}</dt><dd>{session?.home ?? text.unknown}</dd>
        <dt>{text.hostKeyAlgorithm}</dt><dd>{session?.hostKeyAlgorithm ?? text.unknown}</dd>
        <dt>{text.hostKeyFingerprint}</dt><dd className="remote-fingerprint">{session?.hostKeyFingerprint ?? text.unknown}</dd>
      </dl>
      <div className="filter-actions"><button type="button" className="primary" onClick={onClose}>{text.close}</button></div>
    </CommanderOverlayDialog>
  );
}

import { useRef, useState, type RefObject } from 'react';
import { isRemotePath, parseRemotePath, remoteLocationKey } from '../domain/remotePath';
import { remoteSettingsOf, type AppError, type LocationList, type PanelId, type RemoteSession, type RemoteSite, type Settings } from '../domain/types';
import { formatUserErrorMessage, REMOTE_CONNECT_TEXT, type SupportedLanguage } from '../i18n-resources';
import type { TauriResult } from '../tauri/client';
import type { RemoteSessionClient } from '../tauri/commanderClients';
import type { PanelStateById } from './panelState';
import {
  authPromptsOf, changedHostKeyOf, connectRequestOf, draftFromSite, draftFromUrl, emptyDraft, hostKeyQuestionOf, newSiteId,
  siteFromDraft, startUrlFor, usesSecret, validateDraft, type AuthPrompts, type HostKeyQuestion, type RemoteConnectDraft, type RemoteSecrets,
} from './remoteConnectModel';
import { remoteStatusForPath, type RemotePanelStatus, type RemoteSessionMap } from './remoteSessionState';

// 원격 연결 흐름의 화면 단계. 비밀값은 상태에 두지 않고 `secretsRef`에만 보관
export type RemoteFlow =
  | { stage: 'form'; panelId: PanelId; draft: RemoteConnectDraft; targetUrl: string | null; error: string | null; pending: boolean }
  | { stage: 'hostKey'; panelId: PanelId; draft: RemoteConnectDraft; targetUrl: string | null; question: HostKeyQuestion; pending: boolean }
  | { stage: 'prompts'; panelId: PanelId; draft: RemoteConnectDraft; targetUrl: string | null; prompts: AuthPrompts; error: string | null; pending: boolean }
  | { stage: 'sites'; panelId: PanelId; selectedId: string | null }
  | { stage: 'info'; panelId: PanelId; status: RemotePanelStatus; session: RemoteSession | null };

interface RemoteConnectDependencies {
  readonly client: RemoteSessionClient;
  readonly language: SupportedLanguage;
  readonly settings: Settings;
  readonly sessions: RemoteSessionMap;
  readonly recordSession: (session: RemoteSession) => void;
  readonly saveSettingsPatch: (patch: Partial<Settings>, message: string | null) => Promise<void>;
  readonly gotoPanelPath: (panelId: PanelId, path: string, options?: { relativeToPanel?: boolean }) => Promise<AppError | null | undefined>;
  readonly panelStateRef: RefObject<PanelStateById>;
  readonly listLocations: () => Promise<TauriResult<LocationList>>;
  readonly setStatusMessage: (message: string) => void;
  readonly focusShell: () => void;
}

export function useRemoteConnect(dependencies: RemoteConnectDependencies) {
  const [flow, setFlow] = useState<RemoteFlow | null>(null);
  const secretsRef = useRef<RemoteSecrets>({});
  // 연결 흐름으로 원격에 들어가기 전 패널의 로컬 경로. 연결 해제 때 복귀(FR-34.6)
  const localPathBeforeRemote = useRef<Record<PanelId, string | null>>({ left: null, right: null });
  const requestRef = useRef(0);
  const text = () => REMOTE_CONNECT_TEXT[dependencies.language];
  const sites = () => remoteSettingsOf(dependencies.settings).sites;

  const close = () => {
    requestRef.current += 1;
    secretsRef.current = {};
    setFlow(null);
    dependencies.focusShell();
  };

  const openForm = (panelId: PanelId, draft: RemoteConnectDraft = emptyDraft(), targetUrl: string | null = null, error: string | null = null) => {
    secretsRef.current = {};
    setFlow({ stage: 'form', panelId, draft, targetUrl, error, pending: false });
  };

  const openSites = (panelId: PanelId) => setFlow({ stage: 'sites', panelId, selectedId: sites()[0]?.id ?? null });

  const saveSites = (next: RemoteSite[], message: string | null) =>
    dependencies.saveSettingsPatch({ remote: { ...remoteSettingsOf(dependencies.settings), sites: next } }, message);

  const persistSite = (draft: RemoteConnectDraft): RemoteConnectDraft => {
    if (!draft.saveSite) return draft;
    const id = draft.siteId ?? newSiteId();
    const existing = sites().find((site) => site.id === id);
    const site = siteFromDraft(draft, id, existing?.savedSecret ?? false);
    const next = existing ? sites().map((candidate) => (candidate.id === id ? site : candidate)) : [...sites(), site];
    void saveSites(next, text().siteSaved(site.name));
    return { ...draft, siteId: id };
  };

  // 저장된 비밀값 표시 갱신: 사이트 목록의 다른 항목은 그대로
  const markSavedSecret = (id: string, savedSecret: boolean, message: string | null) => {
    if (!sites().some((site) => site.id === id && site.savedSecret !== savedSecret)) return;
    void saveSites(sites().map((site) => (site.id === id ? { ...site, savedSecret } : site)), message);
  };

  const forgetSecret = async (id: string) => {
    const site = sites().find((candidate) => candidate.id === id);
    if (!site) return;
    const result = await dependencies.client.remoteForgetSecret({ siteId: id });
    if (!result.ok) {
      dependencies.setStatusMessage(formatUserErrorMessage(dependencies.language, result.error));
      return;
    }
    markSavedSecret(id, false, text().secretForgotten(site.name));
  };

  // SSH 설정의 Host 항목을 사이트로 추가(FR-34.9). 같은 사용자·호스트·포트의 사이트는 건너뜀
  const importSshConfig = async () => {
    const result = await dependencies.client.remoteImportSshConfig();
    if (!result.ok) {
      dependencies.setStatusMessage(formatUserErrorMessage(dependencies.language, result.error));
      return;
    }
    const existing = sites();
    const added = result.data.entries
      .filter((entry) => !existing.some((site) => site.user === entry.user && site.host === entry.host && site.port === entry.port))
      .map((entry): RemoteSite => ({
        id: newSiteId(), name: entry.alias.slice(0, 120), host: entry.host, port: entry.port, user: entry.user,
        authMethod: entry.keyPath ? 'publicKey' : 'agent', ...(entry.keyPath ? { keyPath: entry.keyPath } : {}), savedSecret: false,
      }));
    if (added.length) void saveSites([...existing, ...added], null);
    dependencies.setStatusMessage(text().imported(added.length, result.data.warnings));
    setFlow((current) => (current?.stage === 'sites' && added[0] ? { ...current, selectedId: added[0].id } : current));
  };

  const deleteSite = (id: string) => {
    const site = sites().find((candidate) => candidate.id === id);
    if (!site) return;
    void dependencies.client.remoteForgetSecret({ siteId: id });
    const next = sites().filter((candidate) => candidate.id !== id);
    void saveSites(next, text().siteDeleted(site.name));
    setFlow((current) => (current?.stage === 'sites' ? { ...current, selectedId: next[0]?.id ?? null } : current));
  };

  const duplicateSite = (id: string) => {
    const site = sites().find((candidate) => candidate.id === id);
    if (!site) return;
    const copy: RemoteSite = { ...site, id: newSiteId(), name: text().copyName(site.name).slice(0, 120), savedSecret: false };
    void saveSites([...sites(), copy], text().siteSaved(copy.name));
    setFlow((current) => (current?.stage === 'sites' ? { ...current, selectedId: copy.id } : current));
  };

  // 연결 결과 처리: 성공이면 패널 이동, 호스트 키·추가 질문은 다음 단계, 그 밖은 연결 창에 오류.
  // `secretRequest`: 입력한 비밀값의 저장 요청 여부, 요청 때 같은 위치가 이미 연결되어 있었는지(재사용이면 저장되지 않음)
  const handleResult = async (request: number, panelId: PanelId, draft: RemoteConnectDraft, targetUrl: string | null, result: TauriResult<RemoteSession>,
    secretRequest: { saving: boolean; reusing: boolean } = { saving: false, reusing: false }) => {
    if (request !== requestRef.current) return;
    if (result.ok) {
      secretsRef.current = {};
      dependencies.recordSession(result.data);
      if (draft.siteId && result.data.secretStored) markSavedSecret(draft.siteId, true, null);
      const secretNotice = !secretRequest.saving || result.data.secretStored ? null
        : secretRequest.reusing ? text().secretNotVerified : text().secretSaveFailed;
      setFlow(null);
      const currentPath = dependencies.panelStateRef.current?.[panelId].path ?? null;
      if (currentPath && !isRemotePath(currentPath)) localPathBeforeRemote.current[panelId] = currentPath;
      const target = startUrlFor(result.data, draft.startPath, targetUrl);
      const failed = await dependencies.gotoPanelPath(panelId, target);
      if (failed && target !== result.data.homeUrl) await dependencies.gotoPanelPath(panelId, result.data.homeUrl);
      // 저장하지 못한 안내는 이동 안내에 덮이지 않도록 마지막에 표시
      dependencies.setStatusMessage(secretNotice ?? text().connected(`${result.data.user}@${result.data.host}`));
      return;
    }
    const question = hostKeyQuestionOf(result.error, draft);
    if (question) {
      setFlow({ stage: 'hostKey', panelId, draft, targetUrl, question, pending: false });
      return;
    }
    const prompts = authPromptsOf(result.error);
    if (prompts) {
      setFlow({ stage: 'prompts', panelId, draft, targetUrl, prompts, error: null, pending: false });
      return;
    }
    const changed = changedHostKeyOf(result.error);
    const message = changed
      ? text().hostKeyChanged(changed.algorithm, changed.recordedFingerprint, changed.fingerprint)
      : formatUserErrorMessage(dependencies.language, result.error);
    if (result.error.code === 'remote_key_passphrase_required' || result.error.code === 'remote_key_passphrase_invalid') {
      secretsRef.current = { ...secretsRef.current, passphrase: undefined };
    }
    setFlow({ stage: 'form', panelId, draft, targetUrl, error: message, pending: false });
  };

  const connect = async (panelId: PanelId, draft: RemoteConnectDraft, targetUrl: string | null) => {
    const request = ++requestRef.current;
    const connectRequest = connectRequestOf(draft, secretsRef.current);
    const secretRequest = {
      saving: Boolean(connectRequest.saveSecret && (connectRequest.password || connectRequest.passphrase)),
      // 이미 연결된 위치는 기존 연결을 재사용해 입력한 비밀값으로 인증하지 않음
      reusing: dependencies.sessions[remoteLocationKey(connectRequest)]?.state === 'connected',
    };
    const result = await dependencies.client.remoteConnect({ request: connectRequest });
    await handleResult(request, panelId, draft, targetUrl, result, secretRequest);
  };

  const submitForm = (draft: RemoteConnectDraft, secrets: RemoteSecrets) => {
    if (flow?.stage !== 'form' || flow.pending) return;
    const invalid = validateDraft(draft);
    if (invalid) {
      setFlow({ ...flow, draft, error: text().invalid[invalid] });
      return;
    }
    secretsRef.current = secrets;
    const saved = persistSite(draft);
    setFlow({ ...flow, draft: saved, error: null, pending: true });
    void connect(flow.panelId, saved, flow.targetUrl);
  };

  const saveOnly = (draft: RemoteConnectDraft) => {
    if (flow?.stage !== 'form') return;
    const invalid = validateDraft({ ...draft, saveSite: true });
    if (invalid) {
      setFlow({ ...flow, draft, error: text().invalid[invalid] });
      return;
    }
    const saved = persistSite({ ...draft, saveSite: true });
    setFlow({ stage: 'sites', panelId: flow.panelId, selectedId: saved.siteId });
  };

  const trustHostKey = async () => {
    if (flow?.stage !== 'hostKey' || flow.pending) return;
    const { panelId, draft, targetUrl, question } = flow;
    const request = ++requestRef.current;
    setFlow({ ...flow, pending: true });
    const trusted = await dependencies.client.remoteTrustHostKey({ host: question.host, port: question.port, fingerprint: question.fingerprint });
    if (request !== requestRef.current) return;
    if (!trusted.ok) {
      setFlow({ stage: 'form', panelId, draft, targetUrl, error: formatUserErrorMessage(dependencies.language, trusted.error), pending: false });
      return;
    }
    setFlow({ stage: 'form', panelId, draft, targetUrl, error: null, pending: true });
    await connect(panelId, draft, targetUrl);
  };

  const respondPrompts = async (responses: string[]) => {
    if (flow?.stage !== 'prompts' || flow.pending) return;
    const { panelId, draft, targetUrl, prompts } = flow;
    const request = ++requestRef.current;
    setFlow({ ...flow, pending: true, error: null });
    const result = await dependencies.client.remoteAuthRespond({ challengeId: prompts.challengeId, responses });
    await handleResult(request, panelId, draft, targetUrl, result);
  };

  const cancel = () => {
    if (flow?.stage === 'prompts') void dependencies.client.remoteAuthCancel({ challengeId: flow.prompts.challengeId });
    close();
  };

  // 입력 없이 연결할 수 있는 사이트: 에이전트, 저장된 비밀값, 키 파일(키 암호가 필요하면 연결 창으로)
  const connectsWithoutInput = (site: RemoteSite) => site.authMethod === 'agent' || site.authMethod === 'publicKey' || (site.savedSecret && usesSecret(site.authMethod));

  const connectSite = (panelId: PanelId, site: RemoteSite) => {
    const draft = draftFromSite(site);
    if (connectsWithoutInput(site)) {
      secretsRef.current = {};
      setFlow({ stage: 'form', panelId, draft, targetUrl: null, error: null, pending: true });
      void connect(panelId, draft, null);
      return;
    }
    openForm(panelId, draft);
  };

  // 연결되지 않은 원격 주소로 이동 요청(FR-36.3): 주소의 사용자·호스트·포트로 연결 창을 열고 연결 뒤 그 주소로 이동
  const openForUrl = (panelId: PanelId, url: string) => {
    const draft = draftFromUrl(url, sites());
    if (!draft) return false;
    openForm(panelId, draft, url);
    return true;
  };

  const panelStatus = (panelId: PanelId) => {
    const path = dependencies.panelStateRef.current?.[panelId].path ?? '';
    return remoteStatusForPath(path, dependencies.sessions, sites());
  };

  const disconnect = async (panelId: PanelId) => {
    const status = panelStatus(panelId);
    if (!status) return;
    await dependencies.client.remoteDisconnect({ sessionId: status.sessionId });
    const panels = dependencies.panelStateRef.current;
    let home: string | null = null;
    for (const id of ['left', 'right'] as const) {
      const remote = panels ? parseRemotePath(panels[id].path) : null;
      if (!remote || remoteLocationKey(remote) !== status.sessionId) continue;
      if (!localPathBeforeRemote.current[id] && home === null) {
        const locations = await dependencies.listLocations();
        home = locations.ok ? locations.data.home : null;
      }
      const target = localPathBeforeRemote.current[id] ?? home;
      localPathBeforeRemote.current[id] = null;
      // 복귀 위치는 로컬 절대 경로: 원격 패널 기준으로 해석하면 같은 서버 경로가 됨
      if (target) await dependencies.gotoPanelPath(id, target, { relativeToPanel: false });
    }
    dependencies.setStatusMessage(text().disconnected(status.address));
  };

  const reconnect = (panelId: PanelId) => {
    const path = dependencies.panelStateRef.current?.[panelId].path ?? '';
    const draft = draftFromUrl(path, sites());
    if (!draft) return;
    const site = draft.siteId ? sites().find((candidate) => candidate.id === draft.siteId) : undefined;
    if (site && connectsWithoutInput(site)) {
      setFlow({ stage: 'form', panelId, draft, targetUrl: path, error: null, pending: true });
      void connect(panelId, draft, path);
      return;
    }
    openForm(panelId, draft, path);
  };

  // 시작 때 원격 탭 복원(FR-36.9): 입력 없이 연결할 수 있는 사이트만 조용히 연결, 그 밖은 false
  const reconnectForPath = async (path: string) => {
    const draft = draftFromUrl(path, sites());
    const site = draft?.siteId ? sites().find((candidate) => candidate.id === draft.siteId) : undefined;
    if (!draft || !site || !connectsWithoutInput(site)) return false;
    const result = await dependencies.client.remoteConnect({ request: connectRequestOf(draft, {}) });
    if (!result.ok) return false;
    dependencies.recordSession(result.data);
    return true;
  };

  const showInfo = (panelId: PanelId) => {
    const status = panelStatus(panelId);
    if (!status) return;
    setFlow({ stage: 'info', panelId, status, session: dependencies.sessions[status.sessionId]?.session ?? null });
  };

  return {
    flow, setFlow, close, cancel, openForm, openSites, openForUrl, submitForm, saveOnly, trustHostKey, respondPrompts,
    connectSite, deleteSite, duplicateSite, forgetSecret, importSshConfig, disconnect, reconnect, reconnectForPath, showInfo,
  };
}

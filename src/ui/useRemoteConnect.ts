import { useRef, useState, type RefObject } from 'react';
import { isRemotePath, parseRemotePath, remoteLocationKey } from '../domain/remotePath';
import { remoteSettingsOf, type AppError, type LocationList, type PanelId, type RemoteSession, type RemoteSite, type Settings } from '../domain/types';
import { formatUserErrorMessage, REMOTE_CONNECT_TEXT, type SupportedLanguage } from '../i18n-resources';
import type { TauriResult } from '../tauri/client';
import type { RemoteSessionClient } from '../tauri/commanderClients';
import type { PanelStateById } from './panelState';
import {
  authPromptsOf, changedHostKeyOf, connectRequestOf, draftFromSite, draftFromUrl, emptyDraft, hostKeyQuestionOf, newSiteId,
  siteFromDraft, startUrlFor, validateDraft, type AuthPrompts, type HostKeyQuestion, type RemoteConnectDraft, type RemoteSecrets,
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
  readonly gotoPanelPath: (panelId: PanelId, path: string) => Promise<AppError | null | undefined>;
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

  const deleteSite = (id: string) => {
    const site = sites().find((candidate) => candidate.id === id);
    if (!site) return;
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

  // 연결 결과 처리: 성공이면 패널 이동, 호스트 키·추가 질문은 다음 단계, 그 밖은 연결 창에 오류
  const handleResult = async (request: number, panelId: PanelId, draft: RemoteConnectDraft, targetUrl: string | null, result: TauriResult<RemoteSession>) => {
    if (request !== requestRef.current) return;
    if (result.ok) {
      secretsRef.current = {};
      dependencies.recordSession(result.data);
      setFlow(null);
      const currentPath = dependencies.panelStateRef.current?.[panelId].path ?? null;
      if (currentPath && !isRemotePath(currentPath)) localPathBeforeRemote.current[panelId] = currentPath;
      const target = startUrlFor(result.data, draft.startPath, targetUrl);
      const failed = await dependencies.gotoPanelPath(panelId, target);
      if (failed && target !== result.data.homeUrl) await dependencies.gotoPanelPath(panelId, result.data.homeUrl);
      dependencies.setStatusMessage(text().connected(`${result.data.user}@${result.data.host}`));
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
    const result = await dependencies.client.remoteConnect({ request: connectRequestOf(draft, secretsRef.current) });
    await handleResult(request, panelId, draft, targetUrl, result);
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

  const connectSite = (panelId: PanelId, site: RemoteSite) => {
    const draft = draftFromSite(site);
    // 에이전트는 입력할 비밀값이 없어 바로 연결, 그 밖은 연결 창에서 암호·키 암호 입력
    if (site.authMethod === 'agent') {
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
      if (target) await dependencies.gotoPanelPath(id, target);
    }
    dependencies.setStatusMessage(text().disconnected(status.address));
  };

  const reconnect = (panelId: PanelId) => {
    const path = dependencies.panelStateRef.current?.[panelId].path ?? '';
    const draft = draftFromUrl(path, sites());
    if (!draft) return;
    const site = draft.siteId ? sites().find((candidate) => candidate.id === draft.siteId) : undefined;
    if (site?.authMethod === 'agent') {
      setFlow({ stage: 'form', panelId, draft, targetUrl: path, error: null, pending: true });
      void connect(panelId, draft, path);
      return;
    }
    openForm(panelId, draft, path);
  };

  const showInfo = (panelId: PanelId) => {
    const status = panelStatus(panelId);
    if (!status) return;
    setFlow({ stage: 'info', panelId, status, session: dependencies.sessions[status.sessionId]?.session ?? null });
  };

  return {
    flow, setFlow, close, cancel, openForm, openSites, openForUrl, submitForm, saveOnly, trustHostKey, respondPrompts,
    connectSite, deleteSite, duplicateSite, disconnect, reconnect, showInfo,
  };
}

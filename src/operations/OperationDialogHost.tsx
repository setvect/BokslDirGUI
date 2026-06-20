import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useOperationStore, type OperationDialogDraft } from './operationStore';
import { useCommanderKeyboardBoundaryProps } from '../ui/keyboardOwnership';
import { tauriClient } from '../tauri/client';
import type { OperationState, OperationSummary } from '../domain/types';
import { translateMessageKey, type SupportedLanguage } from '../i18n-resources';

export function OperationDialogHost({ language = 'en' }: { language?: SupportedLanguage } = {}) {
  const text = OPERATION_DIALOG_TEXT[language];
  const dialog = useOperationStore((state) => state.dialog);
  const progress = useOperationStore((state) => state.progress);
  const conflictPrompt = useOperationStore((state) => state.conflictPrompt);
  const summary = useOperationStore((state) => state.summary);
  const lastError = useOperationStore((state) => state.lastError);
  const atomicResult = useOperationStore((state) => state.dialog?.atomicResult);
  const confirmDialog = useOperationStore((state) => state.confirmDialog);
  const updateDialogInput = useOperationStore((state) => state.updateDialogInput);
  const resolveConflict = useOperationStore((state) => state.resolveConflict);
  const cancelOperation = useOperationStore((state) => state.cancelOperation);
  const closeDialog = useOperationStore((state) => state.closeDialog);
  const clearSummary = useOperationStore((state) => state.clearSummary);
  const applyOperationProgress = useOperationStore((state) => state.applyOperationProgress);
  const applyOperationConflict = useOperationStore((state) => state.applyOperationConflict);
  const applyOperationSummary = useOperationStore((state) => state.applyOperationSummary);
  const applyOperationError = useOperationStore((state) => state.applyOperationError);
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('operation-dialog', Boolean(dialog));
  const [progressDelayElapsed, setProgressDelayElapsed] = useState(false);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void tauriClient.listenOperationEvents({
      progress: applyOperationProgress,
      conflict: applyOperationConflict,
      summary: applyOperationSummary,
      error: applyOperationError,
    }).then((unlisten) => {
      if (disposed) {
        unlisten();
        return;
      }
      cleanup = unlisten;
    }).catch((error) => {
      applyOperationError({
        code: 'event_listen_failed',
        messageKey: 'errors.operationEventListenFailed',
        path: null,
        details: { message: String(error) },
        recoverable: true,
      });
    });
    return () => {
      disposed = true;
      cleanup?.();
    };
  }, [applyOperationConflict, applyOperationError, applyOperationProgress, applyOperationSummary]);

  const progressIsTerminal = progress ? isTerminalOperationState(progress.state) : false;
  const summaryNeedsAttention = Boolean(summary && summaryRequiresAttention(summary));
  const attentionSurfaceOpen = !dialog && Boolean(conflictPrompt || lastError || summaryNeedsAttention);
  const attentionKeyboardBoundaryProps = useCommanderKeyboardBoundaryProps('operation-attention-dialog', attentionSurfaceOpen);
  const dialogProgress = progress && !conflictPrompt && progress.state !== 'waitingForConflict' ? progress : null;
  const visibleProgress = dialogProgress && !progressIsTerminal && progressDelayElapsed ? dialogProgress : null;
  const progressSurfaceOpen = !dialog && !attentionSurfaceOpen && Boolean(visibleProgress);
  const progressKeyboardBoundaryProps = useCommanderKeyboardBoundaryProps('operation-progress-dialog', progressSurfaceOpen);

  useEffect(() => {
    if (!progress || isTerminalOperationState(progress.state) || progress.state === 'waitingForConflict' || conflictPrompt) {
      setProgressDelayElapsed(false);
      return;
    }
    setProgressDelayElapsed(false);
    const timeout = window.setTimeout(() => setProgressDelayElapsed(true), OPERATION_PROGRESS_SURFACE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [conflictPrompt, progress?.operationId, progress?.state]);

  useEffect(() => {
    if (!summary || summaryRequiresAttention(summary)) {
      return;
    }
    const timeout = window.setTimeout(clearSummary, OPERATION_SUCCESS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [clearSummary, summary]);

  return (
    <>
      <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content className="operation-dialog" {...keyboardBoundaryProps}>
            {dialog ? (
            <>
              <Dialog.Title className="operation-title">{dialog.title}</Dialog.Title>
              <Dialog.Description className="operation-description">{dialog.description}</Dialog.Description>
              <div className="operation-grid">
                <span>{text.action}</span>
                <strong>{dialog.actionId}</strong>
                <span>{text.commandPath}</span>
                <code>{dialog.commandPath}</code>
                <span>{text.panel}</span>
                <strong>{dialog.panelId.toUpperCase()}</strong>
                <span>{operationTargetLabel(dialog.dialogKind)}</span>
                <code>{dialog.targetDir ?? '—'}</code>
                <span>{text.conflictDefault}</span>
                <strong>{dialog.defaultDecision}</strong>
              </div>
              <div className="operation-section">
                <h3>{text.sources}</h3>
                {dialog.sources.length > 0 ? (
                  <ul className="operation-source-list">
                    {dialog.sources.map((source) => (
                      <li key={source.path}>
                        <span>{source.name}</span>
                        <code>{source.path}</code>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="operation-muted">현재 패널 경로 자체를 대상으로 하는 작업입니다.</p>
                )}
              </div>
              {dialog.backendExecutionStubbed ? (
                <p className="operation-warning">
                  실제 파일 변경은 아직 연결하지 않았습니다. 이 shell은 확인/상태/오류 UX만 검증합니다.
                  {dialog.backendExecutionStubReasonKey ? ` (${dialog.backendExecutionStubReasonKey})` : null}
                </p>
              ) : null}
              {dialog.inputLabel ? (
                <label className="operation-field">
                  <span>{dialog.inputLabel}</span>
                  <input
                    aria-label={dialog.inputLabel}
                    value={dialog.inputValue}
                    onChange={(event) => updateDialogInput(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        void confirmDialog();
                      }
                    }}
                  />
                  {dialog.validationErrorKey ? (
                    <span className="operation-error" role="alert">{dialog.validationErrorKey}</span>
                  ) : null}
                </label>
              ) : null}
              {dialog.shellPreview ? (
                <div className="operation-section operation-shell-preview">
                  <h3>Shell command policy</h3>
                  <p>{dialog.shellPreview.policy.enabled ? 'enabled' : 'disabled'} · {dialog.shellPreview.policy.reasonKey}</p>
                  <code>{dialog.shellPreview.fingerprint}</code>
                </div>
              ) : null}
              {atomicResult ? (
                <div className="operation-section operation-result">
                  <h3>Result</h3>
                  <pre>{formatAtomicResult(atomicResult)}</pre>
                </div>
              ) : null}
              {dialogProgress ? (
                <div className="operation-section">
                  <h3>{text.progress}</h3>
                  <div className="progress-bar" aria-label="operation progress">
                    <span style={{ width: `${progressPercent(dialogProgress.completedFiles, dialogProgress.totalFiles)}%` }} />
                  </div>
                  <p>{dialogProgress.state} · {dialogProgress.completedFiles}/{dialogProgress.totalFiles ?? text.unknown} {text.files} · {dialogProgress.currentPath}</p>
                </div>
              ) : null}
              {conflictPrompt ? (
                <div className="operation-section conflict-dialog">
                  <h3>{text.conflictResolution}</h3>
                  <p>{conflictPrompt.source.name} → {conflictPrompt.destination.name}</p>
                  <p>{text.defaultDecision}: {conflictPrompt.defaultDecision}</p>
                  <div className="conflict-actions">
                    {conflictPrompt.availableDecisions.map((decision) => (
                      <button type="button" key={decision} onClick={() => resolveConflict(decision)}>
                        {decision}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
              {summary ? (
                <div className="operation-section">
                  <h3>{text.summary}</h3>
                  <p>{summary.state} · {text.completed} {summary.completedFiles} · {text.failed} {summary.failedFiles}</p>
                  {summary.errors.map((error) => (
                    <p className="operation-error" key={`${error.code}-${error.messageKey}`}>{formatOperationError(error, language)}</p>
                  ))}
                </div>
              ) : null}
              {lastError && !summary ? (
                <p className="operation-error">{formatOperationError(lastError, language)}</p>
              ) : null}
              <div className="operation-actions">
                <Dialog.Close asChild>
                  <button type="button" className="dialog-button secondary" onClick={closeDialog}>{text.dismiss}</button>
                </Dialog.Close>
                <button
                  type="button"
                  className="dialog-button secondary"
                  onClick={dialog.executionMode === 'atomicCommand' ? closeDialog : cancelOperation}
                >
                  {dialog.cancelLabel}
                </button>
                <button
                  type="button"
                  className="dialog-button primary"
                  disabled={Boolean(dialog.validationErrorKey) || dialog.atomicPending || dialog.operationPending}
                  onClick={() => void confirmDialog()}
                >
                  {dialog.atomicPending || dialog.operationPending ? text.running : dialog.primaryLabel}
                </button>
              </div>
            </>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={progressSurfaceOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          {visibleProgress ? (
            <Dialog.Content
              aria-label="Operation status"
              aria-live="polite"
              className="operation-status-surface is-progress"
              onEscapeKeyDown={(event) => event.preventDefault()}
              onPointerDownOutside={(event) => event.preventDefault()}
              {...progressKeyboardBoundaryProps}
            >
              <div className="operation-section operation-progress-layout">
                <Dialog.Title className="operation-section-title">{text.operationProgress}</Dialog.Title>
                <div className="progress-bar" aria-label="operation progress">
                  <span style={{ width: `${progressPercent(visibleProgress.completedFiles, visibleProgress.totalFiles)}%` }} />
                </div>
                <Dialog.Description className="operation-progress-description">
                  <span>
                    {visibleProgress.kind} · {visibleProgress.state} · {visibleProgress.completedFiles}/{visibleProgress.totalFiles ?? text.unknown} {text.files}
                  </span>
                  <ProgressPath path={visibleProgress.currentPath} />
                </Dialog.Description>
                <p className="operation-progress-detail">
                  {formatByteProgress(visibleProgress.completedBytes, visibleProgress.totalBytes, text.unknown)} · {progressPercent(visibleProgress.completedFiles, visibleProgress.totalFiles)}% · {formatThroughput(visibleProgress.bytesPerSecond, text.unknown)} · {text.eta} {formatEta(visibleProgress.etaSeconds, text.unknown)}
                </p>
                <div className="operation-progress-actions">
                  <button type="button" className="dialog-button secondary" onClick={cancelOperation}>{text.cancel}</button>
                </div>
              </div>
            </Dialog.Content>
          ) : null}
        </Dialog.Portal>
      </Dialog.Root>
      <Dialog.Root open={attentionSurfaceOpen} onOpenChange={(open) => { if (!open && summaryNeedsAttention) clearSummary(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            aria-label="Operation status"
            className="operation-status-surface is-attention"
            onEscapeKeyDown={(event) => {
              if (conflictPrompt || lastError) {
                event.preventDefault();
              }
            }}
            onPointerDownOutside={(event) => {
              if (conflictPrompt || lastError) {
                event.preventDefault();
              }
            }}
            {...attentionKeyboardBoundaryProps}
          >
            {conflictPrompt ? (
              <div className="operation-section conflict-dialog">
                <Dialog.Title>{text.conflictResolution}</Dialog.Title>
                <Dialog.Description>
                  {conflictPrompt.source.name} → {conflictPrompt.destination.name} · {text.defaultDecision}: {conflictPrompt.defaultDecision}
                </Dialog.Description>
                <div className="conflict-actions">
                  {conflictPrompt.availableDecisions.map((decision) => (
                    <button type="button" key={decision} onClick={() => resolveConflict(decision)}>
                      {decision}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {summaryNeedsAttention && summary ? (
              <div className="operation-section">
                <Dialog.Title>{text.operationSummary}</Dialog.Title>
                <Dialog.Description>{summary.kind} · {summary.state} · {text.completed} {summary.completedFiles} · {text.failed} {summary.failedFiles}</Dialog.Description>
                {summary.errors.map((error) => (
                  <p className="operation-error" key={`${error.code}-${error.messageKey}`}>{formatOperationError(error, language)}</p>
                ))}
                <button type="button" className="dialog-button secondary" onClick={clearSummary}>{text.dismiss}</button>
              </div>
            ) : null}
            {lastError && !summary ? (
              <div className="operation-section">
                <Dialog.Title>{text.operationError}</Dialog.Title>
                <Dialog.Description className="operation-error">{formatOperationError(lastError, language)}</Dialog.Description>
                <button type="button" className="dialog-button secondary" onClick={clearSummary}>{text.dismiss}</button>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}

const OPERATION_PROGRESS_SURFACE_DELAY_MS = 450;
const OPERATION_SUCCESS_AUTO_DISMISS_MS = 1200;
const OPERATION_PROGRESS_PATH_MAX_CHARS = 96;
const OPERATION_DIALOG_TEXT: Record<SupportedLanguage, {
  action: string;
  commandPath: string;
  panel: string;
  conflictDefault: string;
  sources: string;
  progress: string;
  conflictResolution: string;
  defaultDecision: string;
  summary: string;
  completed: string;
  failed: string;
  running: string;
  operationProgress: string;
  operationSummary: string;
  operationError: string;
  files: string;
  unknown: string;
  eta: string;
  cancel: string;
  dismiss: string;
}> = {
  ko: {
    action: '작업',
    commandPath: '명령 경로',
    panel: '패널',
    conflictDefault: '충돌 기본값',
    sources: '대상 항목',
    progress: '진행',
    conflictResolution: '충돌 처리',
    defaultDecision: '기본값',
    summary: '요약',
    completed: '완료',
    failed: '실패',
    running: '실행 중…',
    operationProgress: '작업 진행',
    operationSummary: '작업 요약',
    operationError: '작업 오류',
    files: '개 파일',
    unknown: '알 수 없음',
    eta: '예상',
    cancel: '취소',
    dismiss: '닫기',
  },
  en: {
    action: 'Action',
    commandPath: 'Command path',
    panel: 'Panel',
    conflictDefault: 'Conflict default',
    sources: 'Sources',
    progress: 'Progress',
    conflictResolution: 'Conflict resolution',
    defaultDecision: 'default',
    summary: 'Summary',
    completed: 'completed',
    failed: 'failed',
    running: 'Running…',
    operationProgress: 'Operation progress',
    operationSummary: 'Operation summary',
    operationError: 'Operation error',
    files: 'files',
    unknown: 'unknown',
    eta: 'ETA',
    cancel: 'Cancel',
    dismiss: 'Dismiss',
  },
};

const isTerminalOperationState = (state: OperationState) =>
  state === 'completed' || state === 'completedWithErrors' || state === 'failed' || state === 'cancelled';

const summaryRequiresAttention = (summary: OperationSummary) =>
  summary.state === 'failed' ||
  summary.state === 'completedWithErrors' ||
  summary.failedFiles > 0 ||
  summary.errors.length > 0;

const progressPercent = (completed: number, total: number | null) => {
  if (!total) {
    return 0;
  }
  return Math.min(100, Math.round((completed / total) * 100));
};

function ProgressPath({ path }: { path: string | null }) {
  const display = splitOperationProgressPath(path);
  if (!display.end) {
    return (
      <code className="operation-progress-path" title={display.full} aria-label={display.full}>
        <span className="operation-progress-path-single">{display.start}</span>
      </code>
    );
  }
  return (
    <code className="operation-progress-path" title={display.full} aria-label={display.full}>
      <span className="operation-progress-path-start">{display.start}</span>
      <span className="operation-progress-path-mark" aria-hidden="true">…</span>
      <span className="operation-progress-path-end">{display.end}</span>
    </code>
  );
}

export const splitOperationProgressPath = (path: string | null, maxChars = OPERATION_PROGRESS_PATH_MAX_CHARS) => {
  const full = path ?? '—';
  const chars = Array.from(full);
  if (chars.length <= maxChars) {
    return { full, start: full, end: null };
  }
  const suffixLength = Math.min(Math.max(32, Math.floor(maxChars * 0.45)), Math.max(1, maxChars - 24));
  const prefixLength = Math.max(8, maxChars - suffixLength);
  return {
    full,
    start: chars.slice(0, prefixLength).join(''),
    end: chars.slice(-suffixLength).join(''),
  };
};

const operationTargetLabel = (dialogKind: OperationDialogDraft['dialogKind']) => {
  if (dialogKind === 'trash' || dialogKind === 'deletePermanent') {
    return 'Delete target';
  }
  if (dialogKind === 'rename' || dialogKind === 'properties' || dialogKind === 'archivePreview') {
    return 'Source';
  }
  return 'Target';
};

const formatByteProgress = (completed: number, total: number | null, unknownLabel = 'unknown') => {
  if (total === null) {
    return `${formatBytes(completed)} / ${unknownLabel}`;
  }
  return `${formatBytes(completed)} / ${formatBytes(total)}`;
};

const formatThroughput = (bytesPerSecond: number | null, unknownLabel = 'unknown') => {
  if (bytesPerSecond === null) {
    return unknownLabel;
  }
  return `${formatBytes(bytesPerSecond)}/s`;
};

const formatEta = (etaSeconds: number | null, unknownLabel = 'unknown') => {
  if (etaSeconds === null) {
    return unknownLabel;
  }
  if (etaSeconds < 60) {
    return `${etaSeconds}s`;
  }
  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

const formatOperationError = (
  error: { code: string; messageKey: string },
  language: SupportedLanguage,
) => `${error.code}: ${translateMessageKey(language, error.messageKey)}`;

const formatBytes = (bytes: number) => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unitIndex]}`;
};

const formatAtomicResult = (value: unknown) => {
  if (typeof value === 'string') {
    return value;
  }
  return JSON.stringify(value, null, 2);
};

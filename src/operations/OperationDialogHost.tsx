import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useOperationStore, type OperationDialogDraft } from './operationStore';
import { useCommanderKeyboardBoundaryProps } from '../ui/keyboardOwnership';
import { tauriClient } from '../tauri/client';
import type { OperationState, OperationSummary } from '../domain/types';

export function OperationDialogHost() {
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
                <span>Action</span>
                <strong>{dialog.actionId}</strong>
                <span>Command path</span>
                <code>{dialog.commandPath}</code>
                <span>Panel</span>
                <strong>{dialog.panelId.toUpperCase()}</strong>
                <span>{operationTargetLabel(dialog.dialogKind)}</span>
                <code>{dialog.targetDir ?? '—'}</code>
                <span>Conflict default</span>
                <strong>{dialog.defaultDecision}</strong>
              </div>
              <div className="operation-section">
                <h3>Sources</h3>
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
                  <h3>Progress</h3>
                  <div className="progress-bar" aria-label="operation progress">
                    <span style={{ width: `${progressPercent(dialogProgress.completedFiles, dialogProgress.totalFiles)}%` }} />
                  </div>
                  <p>{dialogProgress.state} · {dialogProgress.completedFiles}/{dialogProgress.totalFiles ?? 'unknown'} files · {dialogProgress.currentPath}</p>
                </div>
              ) : null}
              {conflictPrompt ? (
                <div className="operation-section conflict-dialog">
                  <h3>Conflict resolution</h3>
                  <p>{conflictPrompt.source.name} → {conflictPrompt.destination.name}</p>
                  <p>default: {conflictPrompt.defaultDecision}</p>
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
                  <h3>Summary</h3>
                  <p>{summary.state} · completed {summary.completedFiles} · failed {summary.failedFiles}</p>
                  {summary.errors.map((error) => (
                    <p className="operation-error" key={`${error.code}-${error.messageKey}`}>{error.code}: {error.messageKey}</p>
                  ))}
                </div>
              ) : null}
              {lastError && !summary ? (
                <p className="operation-error">{lastError.code}: {lastError.messageKey}</p>
              ) : null}
              <div className="operation-actions">
                <Dialog.Close asChild>
                  <button type="button" className="dialog-button secondary" onClick={closeDialog}>닫기</button>
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
                  {dialog.atomicPending || dialog.operationPending ? '실행 중…' : dialog.primaryLabel}
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
              <div className="operation-section">
                <Dialog.Title className="operation-section-title">Operation progress</Dialog.Title>
                <div className="progress-bar" aria-label="operation progress">
                  <span style={{ width: `${progressPercent(visibleProgress.completedFiles, visibleProgress.totalFiles)}%` }} />
                </div>
                <Dialog.Description className="operation-progress-description">
                  <span>
                    {visibleProgress.kind} · {visibleProgress.state} · {visibleProgress.completedFiles}/{visibleProgress.totalFiles ?? 'unknown'} files
                  </span>
                  <code className="operation-progress-path" title={visibleProgress.currentPath ?? ''}>
                    {visibleProgress.currentPath ?? '—'}
                  </code>
                </Dialog.Description>
                <p className="operation-progress-detail">
                  {formatByteProgress(visibleProgress.completedBytes, visibleProgress.totalBytes)} · {progressPercent(visibleProgress.completedFiles, visibleProgress.totalFiles)}% · {formatThroughput(visibleProgress.bytesPerSecond)} · ETA {formatEta(visibleProgress.etaSeconds)}
                </p>
                <button type="button" className="dialog-button secondary" onClick={cancelOperation}>Cancel</button>
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
                <Dialog.Title>Conflict resolution</Dialog.Title>
                <Dialog.Description>
                  {conflictPrompt.source.name} → {conflictPrompt.destination.name} · default: {conflictPrompt.defaultDecision}
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
                <Dialog.Title>Operation summary</Dialog.Title>
                <Dialog.Description>{summary.kind} · {summary.state} · completed {summary.completedFiles} · failed {summary.failedFiles}</Dialog.Description>
                {summary.errors.map((error) => (
                  <p className="operation-error" key={`${error.code}-${error.messageKey}`}>{error.code}: {error.messageKey}</p>
                ))}
                <button type="button" className="dialog-button secondary" onClick={clearSummary}>Dismiss</button>
              </div>
            ) : null}
            {lastError && !summary ? (
              <div className="operation-section">
                <Dialog.Title>Operation error</Dialog.Title>
                <Dialog.Description className="operation-error">{lastError.code}: {lastError.messageKey}</Dialog.Description>
                <button type="button" className="dialog-button secondary" onClick={clearSummary}>Dismiss</button>
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

const operationTargetLabel = (dialogKind: OperationDialogDraft['dialogKind']) => {
  if (dialogKind === 'trash' || dialogKind === 'deletePermanent') {
    return 'Delete target';
  }
  if (dialogKind === 'rename' || dialogKind === 'properties' || dialogKind === 'archivePreview') {
    return 'Source';
  }
  return 'Target';
};

const formatByteProgress = (completed: number, total: number | null) => {
  if (total === null) {
    return `${formatBytes(completed)} / unknown`;
  }
  return `${formatBytes(completed)} / ${formatBytes(total)}`;
};

const formatThroughput = (bytesPerSecond: number | null) => {
  if (bytesPerSecond === null) {
    return 'speed unknown';
  }
  return `${formatBytes(bytesPerSecond)}/s`;
};

const formatEta = (etaSeconds: number | null) => {
  if (etaSeconds === null) {
    return 'unknown';
  }
  if (etaSeconds < 60) {
    return `${etaSeconds}s`;
  }
  const minutes = Math.floor(etaSeconds / 60);
  const seconds = etaSeconds % 60;
  return `${minutes}m ${seconds}s`;
};

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

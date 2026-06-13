import * as Dialog from '@radix-ui/react-dialog';
import { useEffect } from 'react';
import { useOperationStore } from './operationStore';
import { useCommanderKeyboardBoundaryProps } from '../ui/keyboardOwnership';
import { tauriClient } from '../tauri/client';

export function OperationDialogHost() {
  const dialog = useOperationStore((state) => state.dialog);
  const progress = useOperationStore((state) => state.progress);
  const conflictPrompt = useOperationStore((state) => state.conflictPrompt);
  const summary = useOperationStore((state) => state.summary);
  const lastError = useOperationStore((state) => state.lastError);
  const confirmDialog = useOperationStore((state) => state.confirmDialog);
  const updateDialogInput = useOperationStore((state) => state.updateDialogInput);
  const resolveConflict = useOperationStore((state) => state.resolveConflict);
  const cancelOperation = useOperationStore((state) => state.cancelOperation);
  const closeDialog = useOperationStore((state) => state.closeDialog);
  const applyOperationProgress = useOperationStore((state) => state.applyOperationProgress);
  const applyOperationConflict = useOperationStore((state) => state.applyOperationConflict);
  const applyOperationSummary = useOperationStore((state) => state.applyOperationSummary);
  const applyOperationError = useOperationStore((state) => state.applyOperationError);
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('operation-dialog', Boolean(dialog));

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

  return (
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
                <span>Target</span>
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
              {progress ? (
                <div className="operation-section">
                  <h3>Progress</h3>
                  <div className="progress-bar" aria-label="operation progress">
                    <span style={{ width: `${progressPercent(progress.completedFiles, progress.totalFiles)}%` }} />
                  </div>
                  <p>{progress.state} · {progress.completedFiles}/{progress.totalFiles ?? 'unknown'} files · {progress.currentPath}</p>
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
                <button type="button" className="dialog-button secondary" onClick={cancelOperation}>{dialog.cancelLabel}</button>
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
  );
}

const progressPercent = (completed: number, total: number | null) => {
  if (!total) {
    return 0;
  }
  return Math.min(100, Math.round((completed / total) * 100));
};

import { displayPath } from '../domain/pathDisplay';
import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  OPERATION_DIALOG_TEXT,
  translateUserMessageKey,
  type SupportedLanguage
} from '../i18n-resources';
import { tauriClient } from '../tauri/client';
import { useCommanderKeyboardBoundaryProps } from '../ui/keyboardOwnership';
import { ConflictActions, ConflictComparison, ConflictResolutionView } from './ConflictResolutionView';
import { dialogFocusSignature, handleDialogButtonGroupKeyDown, operationDialogActions, operationDialogDescription, operationDialogInputLabel, operationDialogTitle, shouldFocusOperationInput } from './dialogPresentation';
import { OperationInputs } from './OperationInputs';
import { operationKindLabel, operationStateLabel } from './operationLabels';
import { OperationOverview } from './OperationOverview';
import { OperationResultView } from './OperationResultView';
import { useOperationStore } from './operationStore';
import { ProgressPath } from './ProgressPath';
import { formatByteProgress, formatBytes, formatEta, formatOperationError, formatThroughput, isTerminalOperationState, progressPercentLabel, progressWidth, summaryRequiresAttention } from './progressPresentation';

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
  const updateDialogSecret = useOperationStore((state) => state.updateDialogSecret);
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
  const dialogInputRef = useRef<HTMLInputElement>(null);
  const defaultDialogButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let disposed = false;
    let cleanup: (() => void) | null = null;
    void tauriClient.listenOperationEvents({
      progress: applyOperationProgress,
      conflict: applyOperationConflict,
      summary: applyOperationSummary,
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
  const progressDelayBlocked = !progress || progressIsTerminal || progress.state === 'waitingForConflict' || Boolean(conflictPrompt);

  useEffect(() => {
    if (progressDelayBlocked) {
      setProgressDelayElapsed(false);
      return;
    }
    if (progressDelayElapsed) {
      return;
    }
    const timeout = window.setTimeout(() => setProgressDelayElapsed(true), OPERATION_PROGRESS_SURFACE_DELAY_MS);
    return () => window.clearTimeout(timeout);
  }, [progressDelayBlocked, progressDelayElapsed]);

  useEffect(() => {
    if (!summary || summaryRequiresAttention(summary)) {
      return;
    }
    const timeout = window.setTimeout(clearSummary, OPERATION_SUCCESS_AUTO_DISMISS_MS);
    return () => window.clearTimeout(timeout);
  }, [clearSummary, summary]);

  const dialogTitle = dialog ? operationDialogTitle(dialog.dialogKind, language) : '';
  const dialogDescription = dialog ? operationDialogDescription(dialog, language) : '';
  const dialogInputLabel = dialog ? operationDialogInputLabel(dialog.dialogKind, language) : null;
  const dialogActions = dialog && !conflictPrompt
    ? operationDialogActions({
      dialog,
      atomicResult,
      inputLabel: dialogInputLabel,
      language,
      text,
      confirmDialog,
      cancelOperation,
      closeDialog,
    })
    : [];
  const shouldFocusInput = Boolean(dialog && shouldFocusOperationInput(dialogInputLabel, dialog, atomicResult));
  const focusSignature = dialog ? dialogFocusSignature(dialog, atomicResult, dialogInputLabel) : null;
  const lastFocusSignatureRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!dialog || !focusSignature) {
      lastFocusSignatureRef.current = null;
      return;
    }
    if (lastFocusSignatureRef.current === focusSignature) {
      return;
    }
    lastFocusSignatureRef.current = focusSignature;

    const focusTarget = () => {
      if (shouldFocusInput) {
        const input = dialogInputRef.current;
        if (!input) {
          return false;
        }
        input.focus({ preventScroll: true });
        if (input.value === dialog.inputValue) {
          input.select();
        }
        return true;
      }
      const button = defaultDialogButtonRef.current;
      if (!button) {
        return false;
      }
      button.focus({ preventScroll: true });
      return true;
    };

    if (focusTarget()) {
      return;
    }
    const timeout = window.setTimeout(focusTarget, 0);
    return () => window.clearTimeout(timeout);
  }, [dialog, focusSignature, shouldFocusInput]);

  return (
    <>
      <Dialog.Root open={Boolean(dialog)} onOpenChange={(open) => { if (!open) closeDialog(); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="dialog-overlay" />
          <Dialog.Content
            className="operation-dialog"
            onOpenAutoFocus={(event) => event.preventDefault()}
            {...keyboardBoundaryProps}
          >
            {dialog ? (
              <>
                <Dialog.Title className="operation-title">{dialogTitle}</Dialog.Title>
                <Dialog.Description className="operation-description">{dialogDescription}</Dialog.Description>
                <OperationOverview dialog={dialog} language={language} text={text} />
                {dialog.sources.length > 0 ? (
                  <div className="operation-section">
                    <h3>{text.sources}</h3>
                    <ul className="operation-source-list">
                      {dialog.sources.map((source) => (
                        <li key={source.path}>
                          <code title={displayPath(source.path)}>{displayPath(source.path)}</code>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {dialog.backendExecutionStubbed ? (
                  <p className="operation-warning">
                    {translateUserMessageKey(language, dialog.backendExecutionStubReasonKey)}
                  </p>
                ) : null}
                <OperationInputs dialog={dialog} dialogInputLabel={dialogInputLabel} dialogInputRef={dialogInputRef}
                  language={language} text={text} updateDialogInput={updateDialogInput}
                  updateDialogSecret={updateDialogSecret} confirmDialog={confirmDialog} />
                {atomicResult ? (
                  <div className="operation-section operation-result">
                    <h3>{text.result}</h3>
                    <OperationResultView value={atomicResult} language={language} text={text} />
                  </div>
                ) : null}
                {dialogProgress ? (
                  <div className="operation-section">
                    <h3>{text.progress}</h3>
                    <div className="progress-bar" aria-label="operation progress">
                      <span style={{ width: progressWidth(dialogProgress) }} />
                    </div>
                    <p>{operationStateLabel(language, dialogProgress.state)} · {dialogProgress.completedFiles}/{dialogProgress.totalFiles ?? text.unknown} {text.files}</p>
                    <ProgressPath path={dialogProgress.currentPath} />
                  </div>
                ) : null}
                {conflictPrompt ? (
                  <ConflictResolutionView
                    prompt={conflictPrompt}
                    language={language}
                    text={text}
                    resolveConflict={resolveConflict}
                  />
                ) : null}
                {summary ? (
                  <div className="operation-section">
                    <h3>{text.summary}</h3>
                    <p>{operationStateLabel(language, summary.state)} · {text.completed} {summary.completedFiles} · {text.failed} {summary.failedFiles}</p>
                    {summary.errors.map((error, index) => (
                      <p className="operation-error" key={error.code + '-' + (error.path ?? '') + '-' + index}>{formatOperationError(error, language)}</p>
                    ))}
                  </div>
                ) : null}
                {lastError && !summary && !(dialog.validationShown && lastError.messageKey === dialog.validationErrorKey) ? (
                  <p className="operation-error">{formatOperationError(lastError, language)}</p>
                ) : null}
                <div className="operation-actions" onKeyDown={handleDialogButtonGroupKeyDown}>
                  {dialogActions.map((action) => {
                    const button = (
                      <button
                        key={action.key}
                        ref={action.autoFocus ? defaultDialogButtonRef : undefined}
                        type="button"
                        className={action.className}
                        disabled={action.disabled}
                        onClick={action.onClick}
                      >
                        {action.label}
                      </button>
                    );
                    return action.closeWrapper ? (
                      <Dialog.Close asChild key={action.key}>
                        {button}
                      </Dialog.Close>
                    ) : button;
                  })}
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
                {visibleProgress.kind !== 'shellCommand' ? <div className="progress-bar" aria-label="operation progress">
                  <span style={{ width: progressWidth(visibleProgress) }} />
                </div> : null}
                <Dialog.Description className="operation-progress-description">
                  <span>
                    {operationKindLabel(language, visibleProgress.kind)} · {operationStateLabel(language, visibleProgress.state)}{visibleProgress.kind !== 'shellCommand' ? ` · ${visibleProgress.completedFiles}/${visibleProgress.totalFiles ?? text.unknown} ${text.files}` : ''}
                  </span>
                  <ProgressPath path={visibleProgress.currentPath} />
                </Dialog.Description>
                <p className="operation-progress-detail">
                  {visibleProgress.kind === 'shellCommand' ? `${text.commandOutput}: ${formatBytes(visibleProgress.completedBytes)}` : <>{formatByteProgress(visibleProgress.completedBytes, visibleProgress.totalBytes, text.unknown)} · {progressPercentLabel(visibleProgress)}% · {formatThroughput(visibleProgress.bytesPerSecond, text.unknown)} · {text.eta} {formatEta(visibleProgress.etaSeconds, text.unknown)}</>}
                </p>
                <div className="operation-progress-actions" onKeyDown={handleDialogButtonGroupKeyDown}>
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
                <Dialog.Description>{text.conflictPrompt}</Dialog.Description>
                <ConflictComparison prompt={conflictPrompt} text={text} />
                <ConflictActions prompt={conflictPrompt} language={language} resolveConflict={resolveConflict} />
              </div>
            ) : null}
            {summaryNeedsAttention && summary ? (
              <div className="operation-section">
                <Dialog.Title>{text.operationSummary}</Dialog.Title>
                <Dialog.Description>{operationKindLabel(language, summary.kind)} · {operationStateLabel(language, summary.state)}{summary.kind !== 'shellCommand' ? ` · ${text.completed} ${summary.completedFiles} · ${text.failed} ${summary.failedFiles}` : ''}</Dialog.Description>
                {summary.commandResult ? <OperationResultView value={summary.commandResult} language={language} text={text} /> : null}
                {summary.errors.map((error, index) => (
                  <p className="operation-error" key={error.code + '-' + (error.path ?? '') + '-' + index}>{formatOperationError(error, language)}</p>
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

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useOperationStore, type OperationDialogDraft } from './operationStore';
import { useCommanderKeyboardBoundaryProps } from '../ui/keyboardOwnership';
import { tauriClient } from '../tauri/client';
import type {
  ArchiveListing,
  ConflictDecision,
  ConflictPrompt,
  FileMetadata,
  OperationProgress,
  OperationState,
  OperationSummary,
  ShellCommandPreview,
  ShellCommandResult,
} from '../domain/types';
import {
  OPERATION_DIALOG_DESCRIPTIONS,
  OPERATION_DIALOG_INPUT_LABELS,
  OPERATION_DIALOG_PRIMARY_LABELS,
  OPERATION_DIALOG_TEXT,
  OPERATION_DIALOG_TITLES,
  OPERATION_CONFIRMATION_TEXT,
  METADATA_KIND_LABELS,
  formatItemCount,
  formatUserErrorMessage,
  translateUserMessageKey,
  type OperationDialogText,
  type SupportedLanguage,
} from '../i18n-resources';
import { conflictDecisionLabel, operationKindLabel, operationStateLabel } from './operationLabels';

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
                        <code title={source.path}>{source.path}</code>
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
              {dialogInputLabel ? (
                <label className="operation-field">
                  <span>{dialogInputLabel}</span>
                  <input
                    ref={dialogInputRef}
                    aria-label={dialogInputLabel}
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
                    <span className="operation-error" role="alert">{translateUserMessageKey(language, dialog.validationErrorKey)}</span>
                  ) : null}
                </label>
              ) : null}
              {dialog.dialogKind === 'archiveCreate' || dialog.dialogKind === 'archiveExtract' ? (
                <label className="operation-field">
                  <span>{text.archivePassword}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    aria-label={text.archivePassword}
                    value={dialog.secretValue}
                    onChange={(event) => updateDialogSecret(event.currentTarget.value)}
                  />
                </label>
              ) : null}
              {dialog.shellPreview ? (
                <div className="operation-section operation-shell-preview">
                  <h3>{text.shellCommand}</h3>
                  <p>
                    {dialog.shellPreview.policy.enabled
                      ? text.shellCommandReady
                      : translateUserMessageKey(language, dialog.shellPreview.policy.reasonKey)}
                  </p>
                </div>
              ) : null}
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
                  {summary.errors.map((error) => (
                    <p className="operation-error" key={`${error.code}-${error.messageKey}`}>{formatOperationError(error, language)}</p>
                  ))}
                </div>
              ) : null}
              {lastError && !summary ? (
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
                <div className="progress-bar" aria-label="operation progress">
                  <span style={{ width: progressWidth(visibleProgress) }} />
                </div>
                <Dialog.Description className="operation-progress-description">
                  <span>
                    {operationKindLabel(language, visibleProgress.kind)} · {operationStateLabel(language, visibleProgress.state)} · {visibleProgress.completedFiles}/{visibleProgress.totalFiles ?? text.unknown} {text.files}
                  </span>
                  <ProgressPath path={visibleProgress.currentPath} />
                </Dialog.Description>
                <p className="operation-progress-detail">
                  {formatByteProgress(visibleProgress.completedBytes, visibleProgress.totalBytes, text.unknown)} · {progressPercentLabel(visibleProgress)}% · {formatThroughput(visibleProgress.bytesPerSecond, text.unknown)} · {text.eta} {formatEta(visibleProgress.etaSeconds, text.unknown)}
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
                <Dialog.Description>{operationKindLabel(language, summary.kind)} · {operationStateLabel(language, summary.state)} · {text.completed} {summary.completedFiles} · {text.failed} {summary.failedFiles}</Dialog.Description>
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

const DIALOG_BUTTON_SELECTOR = 'button:not(:disabled):not([aria-disabled="true"])';

const handleDialogButtonGroupKeyDown = (event: KeyboardEvent<HTMLElement>) => {
  const direction = dialogButtonNavigationDirection(event.key);
  if (direction === 0) {
    return;
  }

  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(DIALOG_BUTTON_SELECTOR));
  if (buttons.length < 2) {
    return;
  }

  const activeButtonIndex = buttons.findIndex((button) => button === document.activeElement);
  const currentIndex = activeButtonIndex >= 0 ? activeButtonIndex : 0;
  const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;

  event.preventDefault();
  event.stopPropagation();
  buttons[nextIndex].focus({ preventScroll: true });
};

const dialogButtonNavigationDirection = (key: string) => {
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return 1;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return -1;
  }
  return 0;
};

const OPERATION_PROGRESS_SURFACE_DELAY_MS = 450;
const OPERATION_SUCCESS_AUTO_DISMISS_MS = 1200;
const OPERATION_PROGRESS_PATH_MAX_CHARS = 96;
type OperationDialogKind = OperationDialogDraft['dialogKind'];

// Keep user-facing dialog copy in the presentation layer. The store carries semantic
// operation state; this helper family derives the visible modal contract from it.
const operationDialogTitle = (dialogKind: OperationDialogKind, language: SupportedLanguage) => {
  return OPERATION_DIALOG_TITLES[language][dialogKind];
};

const operationDialogDescription = (dialog: OperationDialogDraft, language: SupportedLanguage) => {
  const count = dialog.sources.length;
  return OPERATION_DIALOG_DESCRIPTIONS[language][dialog.dialogKind](formatItemCount(language, count));
};

const operationDialogPrimaryLabel = (dialog: OperationDialogDraft, atomicResult: unknown, language: SupportedLanguage) => {
  if (hasRunnableShellPreview(dialog, atomicResult)) {
    return OPERATION_DIALOG_PRIMARY_LABELS[language].runShellAfterConfirm;
  }
  return OPERATION_DIALOG_PRIMARY_LABELS[language][dialog.dialogKind];
};

const operationDialogInputLabel = (dialogKind: OperationDialogKind, language: SupportedLanguage) =>
  OPERATION_DIALOG_INPUT_LABELS[language][dialogKind] ?? null;

interface OperationDialogAction {
  key: string;
  label: string;
  className: string;
  disabled?: boolean;
  autoFocus?: boolean;
  closeWrapper?: boolean;
  onClick(): void;
}

const operationDialogActions = ({
  dialog,
  atomicResult,
  inputLabel,
  language,
  text,
  confirmDialog,
  cancelOperation,
  closeDialog,
}: {
  dialog: OperationDialogDraft;
  atomicResult: unknown;
  inputLabel: string | null;
  language: SupportedLanguage;
  text: OperationDialogText;
  confirmDialog(): Promise<void>;
  cancelOperation(): void;
  closeDialog(): void;
}): OperationDialogAction[] => {
  if (shouldShowCloseOnlyAction(dialog, atomicResult)) {
    return [{
      key: 'close',
      label: text.dismiss,
      className: 'dialog-button secondary safe-default',
      autoFocus: true,
      closeWrapper: true,
      onClick: closeDialog,
    }];
  }

  const cancelShouldOwnFocus = shouldFocusCancelAction(inputLabel, dialog, atomicResult);
  const primaryDisabled = Boolean(dialog.validationErrorKey) || dialog.atomicPending || dialog.operationPending;
  const primaryShouldOwnFocus = !cancelShouldOwnFocus && !shouldFocusOperationInput(inputLabel, dialog, atomicResult) && !primaryDisabled;

  return [
    {
      key: 'cancel',
      label: text.cancel,
      className: `dialog-button secondary${cancelShouldOwnFocus ? ' safe-default' : ''}`,
      autoFocus: cancelShouldOwnFocus,
      onClick: dialog.executionMode === 'atomicCommand' ? closeDialog : cancelOperation,
    },
    {
      key: 'confirm',
      label: dialog.atomicPending || dialog.operationPending ? text.running : operationDialogPrimaryLabel(dialog, atomicResult, language),
      className: `dialog-button primary${isDangerousDialog(dialog) ? ' danger' : ''}`,
      disabled: primaryDisabled,
      autoFocus: primaryShouldOwnFocus,
      onClick: () => { void confirmDialog(); },
    },
  ];
};

const shouldShowCloseOnlyAction = (dialog: OperationDialogDraft, atomicResult: unknown) => {
  if (!atomicResult) {
    return false;
  }
  return !hasRunnableShellPreview(dialog, atomicResult);
};

const shouldFocusOperationInput = (inputLabel: string | null, dialog: OperationDialogDraft, atomicResult: unknown) =>
  Boolean(inputLabel && !shouldShowCloseOnlyAction(dialog, atomicResult));

const dialogFocusSignature = (
  dialog: OperationDialogDraft,
  atomicResult: unknown,
  inputLabel: string | null,
) => [
  dialog.dialogKind,
  inputLabel ?? '',
  dialog.sources.map((source) => source.path).join('|'),
  dialog.targetDir ?? '',
  atomicResult ? 'result' : 'draft',
  isShellCommandPreview(atomicResult) ? atomicResult.confirmToken : '',
].join('\u0000');

const shouldFocusCancelAction = (inputLabel: string | null, dialog: OperationDialogDraft, atomicResult: unknown) => {
  if (shouldFocusOperationInput(inputLabel, dialog, atomicResult)) {
    return false;
  }
  if (dialog.executionMode === 'longRunningOperation') {
    return true;
  }
  return isDangerousDialog(dialog);
};

const hasRunnableShellPreview = (dialog: OperationDialogDraft, atomicResult: unknown) =>
  dialog.dialogKind === 'shellCommand' &&
  isShellCommandPreview(atomicResult) &&
  atomicResult.policy.enabled === true &&
  atomicResult.confirmToken !== 'disabled';

const isDangerousDialog = (dialog: OperationDialogDraft) =>
  dialog.dialogKind === 'deletePermanent' ||
  dialog.dialogKind === 'trash' ||
  dialog.dangerLevel === 'destructive' ||
  dialog.dangerLevel === 'irreversible';

const isDefaultConflictDecision = (decision: ConflictDecision, prompt: ConflictPrompt) => {
  if (prompt.availableDecisions.includes(prompt.defaultDecision)) {
    return decision === prompt.defaultDecision;
  }
  if (prompt.availableDecisions.includes('skip')) {
    return decision === 'skip';
  }
  return decision === 'cancel';
};

const conflictDecisionButtonClassName = (decision: ConflictDecision, prompt: ConflictPrompt) => {
  const classes = ['dialog-button', 'conflict-button'];
  if (decision === 'overwrite' || decision === 'allOverwrite') {
    classes.push('danger');
  }
  if (isDefaultConflictDecision(decision, prompt)) {
    classes.push('safe-default');
  }
  return classes.join(' ');
};

const isTerminalOperationState = (state: OperationState) =>
  state === 'completed' || state === 'completedWithErrors' || state === 'failed' || state === 'cancelled';

const summaryRequiresAttention = (summary: OperationSummary) =>
  summary.state === 'failed' ||
  summary.state === 'completedWithErrors' ||
  summary.failedFiles > 0 ||
  summary.errors.length > 0;

const progressPercent = (completed: number, total: number | null) => {
  if (!total || total <= 0) {
    return 0;
  }
  return Math.min(100, Math.max(0, (completed / total) * 100));
};

const operationProgressPercent = (progress: OperationProgress) => {
  if (progress.totalBytes !== null && progress.totalBytes > 0) {
    return progressPercent(progress.completedBytes, progress.totalBytes);
  }
  return progressPercent(progress.completedFiles, progress.totalFiles);
};

const progressWidth = (progress: OperationProgress) => `${operationProgressPercent(progress).toFixed(2)}%`;

const progressPercentLabel = (progress: OperationProgress) => Math.round(operationProgressPercent(progress));

const DESTINATION_DIALOGS: ReadonlySet<OperationDialogKind> = new Set([
  'copy',
  'move',
  'archiveExtract',
  'archiveCreate',
]);

const CURRENT_LOCATION_DIALOGS: ReadonlySet<OperationDialogKind> = new Set([
  'createDir',
  'shellCommand',
]);

function OperationOverview({
  dialog,
  language,
  text,
}: {
  dialog: OperationDialogDraft;
  language: SupportedLanguage;
  text: OperationDialogText;
}) {
  const pathLabel = DESTINATION_DIALOGS.has(dialog.dialogKind)
    ? text.destination
    : CURRENT_LOCATION_DIALOGS.has(dialog.dialogKind)
      ? text.currentLocation
      : null;
  const displayedPath = pathLabel ? dialog.targetDir : null;
  const showPermanentDeleteWarning = dialog.dialogKind === 'deletePermanent';
  if (!displayedPath && !showPermanentDeleteWarning) {
    return null;
  }
  return (
    <div className="operation-overview">
      {displayedPath ? (
        <div className="operation-overview-path">
          <span>{pathLabel}</span>
          <code title={displayedPath}>{displayedPath}</code>
        </div>
      ) : null}
      {showPermanentDeleteWarning ? (
        <>
          <p className="operation-warning is-inline">{text.irreversibleHint}</p>
          {dialog.requiredConfirmationPhrase ? (
            <p className="operation-muted">{confirmationPhraseInstruction(language, dialog.requiredConfirmationPhrase)}</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function ConflictResolutionView({
  prompt,
  language,
  text,
  resolveConflict,
}: {
  prompt: ConflictPrompt;
  language: SupportedLanguage;
  text: OperationDialogText;
  resolveConflict: (decision: ConflictDecision) => void;
}) {
  return (
    <div className="operation-section conflict-dialog">
      <h3>{text.conflictResolution}</h3>
      <p>{text.conflictPrompt}</p>
      <ConflictComparison prompt={prompt} text={text} />
      <ConflictActions prompt={prompt} language={language} resolveConflict={resolveConflict} />
    </div>
  );
}

function ConflictComparison({
  prompt,
  text,
}: {
  prompt: ConflictPrompt;
  text: OperationDialogText;
}) {
  return (
    <div className="conflict-comparison">
      <ConflictEntryDetails label={text.sourceItem} entry={prompt.source} text={text} />
      <ConflictEntryDetails label={text.destinationItem} entry={prompt.destination} text={text} />
    </div>
  );
}

function ConflictEntryDetails({
  label,
  entry,
  text,
}: {
  label: string;
  entry: ConflictPrompt['source'];
  text: OperationDialogText;
}) {
  return (
    <section className="conflict-entry" aria-label={label}>
      <h4>{label}</h4>
      <dl>
        <div><dt>{text.path}</dt><dd><code title={entry.path}>{entry.path}</code></dd></div>
        <div><dt>{text.size}</dt><dd>{entry.sizeBytes === null ? '—' : formatBytes(entry.sizeBytes)}</dd></div>
        <div><dt>{text.modified}</dt><dd>{entry.modifiedAt ?? '—'}</dd></div>
      </dl>
    </section>
  );
}

function ConflictActions({
  prompt,
  language,
  resolveConflict,
}: {
  prompt: ConflictPrompt;
  language: SupportedLanguage;
  resolveConflict: (decision: ConflictDecision) => void;
}) {
  return (
    <div className="conflict-actions" onKeyDown={handleDialogButtonGroupKeyDown}>
      {prompt.availableDecisions.map((decision) => (
        <button
          type="button"
          key={decision}
          className={conflictDecisionButtonClassName(decision, prompt)}
          autoFocus={isDefaultConflictDecision(decision, prompt)}
          onClick={() => resolveConflict(decision)}
        >
          {conflictDecisionLabel(language, decision)}
        </button>
      ))}
    </div>
  );
}

const confirmationPhraseInstruction = (language: SupportedLanguage, phrase: string) =>
  OPERATION_CONFIRMATION_TEXT[language].phraseInstruction(phrase);

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
  error: { messageKey: string; path?: string | null },
  language: SupportedLanguage,
) => formatUserErrorMessage(language, error);

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

function OperationResultView({
  value,
  language,
  text,
}: {
  value: unknown;
  language: SupportedLanguage;
  text: OperationDialogText;
}) {
  if (isFileMetadata(value)) {
    return (
      <dl className="operation-result-list">
        <div><dt>{text.fileInfo}</dt><dd>{value.name}</dd></div>
        <div><dt>{text.currentLocation}</dt><dd><code title={value.absolutePath}>{value.absolutePath}</code></dd></div>
        <div><dt>{text.type}</dt><dd>{metadataKindLabel(language, value.kind)}</dd></div>
        <div><dt>{text.size}</dt><dd>{value.sizeBytes === null ? '—' : formatBytes(value.sizeBytes)}</dd></div>
        <div><dt>{text.modified}</dt><dd>{value.modifiedAt ?? '—'}</dd></div>
        <div><dt>{text.permissions}</dt><dd>{value.permissions ?? '—'}</dd></div>
      </dl>
    );
  }
  if (isArchiveListing(value)) {
    return (
      <div className="operation-result-stack">
        <dl className="operation-result-list">
          <div><dt>{text.currentLocation}</dt><dd><code title={value.archivePath}>{value.archivePath}</code></dd></div>
          <div><dt>{text.encrypted}</dt><dd>{value.encrypted ? text.yes : text.no}</dd></div>
        </dl>
        <div>
          <h4>{text.archiveEntries}</h4>
          {value.entries.length > 0 ? (
            <ul className="operation-result-items">
              {value.entries.slice(0, 20).map((entry) => (
                <li key={entry.path}>
                  <span>{entry.name}</span>
                  <small>{metadataKindLabel(language, entry.kind)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="operation-muted">{text.noOutput}</p>
          )}
        </div>
      </div>
    );
  }
  if (isShellCommandPreview(value)) {
    return <p>{value.policy.enabled ? text.shellCommandReady : translateUserMessageKey(language, value.policy.reasonKey)}</p>;
  }
  if (isShellCommandResult(value)) {
    return (
      <div className="operation-result-stack">
        <dl className="operation-result-list">
          <div><dt>{text.exitCode}</dt><dd>{value.exitCode ?? '—'}</dd></div>
        </dl>
        <CommandOutput title={text.stdout} output={value.stdout} emptyLabel={text.noOutput} />
        <CommandOutput title={text.stderr} output={value.stderr} emptyLabel={text.noOutput} />
      </div>
    );
  }
  if (typeof value === 'string') {
    return <p>{value}</p>;
  }
  return <p>{text.resultComplete}</p>;
}

function CommandOutput({ title, output, emptyLabel }: { title: string; output: string; emptyLabel: string }) {
  return (
    <div className="operation-command-output">
      <h4>{title}</h4>
      {output ? <pre>{output}</pre> : <p className="operation-muted">{emptyLabel}</p>}
    </div>
  );
}

const metadataKindLabel = (language: SupportedLanguage, kind: string) => {
  return METADATA_KIND_LABELS[language][kind] ?? kind;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFileMetadata = (value: unknown): value is FileMetadata =>
  isRecord(value) &&
  typeof value.absolutePath === 'string' &&
  typeof value.name === 'string' &&
  typeof value.kind === 'string';

const isArchiveListing = (value: unknown): value is ArchiveListing =>
  isRecord(value) &&
  typeof value.archivePath === 'string' &&
  Array.isArray(value.entries) &&
  typeof value.encrypted === 'boolean';

const isShellCommandPreview = (value: unknown): value is ShellCommandPreview =>
  isRecord(value) &&
  typeof value.confirmToken === 'string' &&
  isRecord(value.policy) &&
  typeof value.policy.enabled === 'boolean';

const isShellCommandResult = (value: unknown): value is ShellCommandResult =>
  isRecord(value) &&
  (typeof value.exitCode === 'number' || value.exitCode === null) &&
  typeof value.stdout === 'string' &&
  typeof value.stderr === 'string' &&
  typeof value.timedOut === 'boolean';

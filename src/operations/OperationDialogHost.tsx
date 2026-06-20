import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useState } from 'react';
import { useOperationStore, type OperationDialogDraft } from './operationStore';
import { useCommanderKeyboardBoundaryProps } from '../ui/keyboardOwnership';
import { tauriClient } from '../tauri/client';
import type {
  ArchiveListing,
  FileMetadata,
  OperationState,
  OperationSummary,
  ShellCommandPreview,
  ShellCommandResult,
} from '../domain/types';
import { formatUserErrorMessage, translateUserMessageKey, type SupportedLanguage } from '../i18n-resources';
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
              <OperationOverview dialog={dialog} language={language} text={text} />
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
                  <p className="operation-muted">{text.currentFolderTarget}</p>
                )}
              </div>
              {dialog.backendExecutionStubbed ? (
                <p className="operation-warning">
                  {translateUserMessageKey(language, dialog.backendExecutionStubReasonKey)}
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
                    <span className="operation-error" role="alert">{translateUserMessageKey(language, dialog.validationErrorKey)}</span>
                  ) : null}
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
                    <span style={{ width: `${progressPercent(dialogProgress.completedFiles, dialogProgress.totalFiles)}%` }} />
                  </div>
                  <p>{operationStateLabel(language, dialogProgress.state)} · {dialogProgress.completedFiles}/{dialogProgress.totalFiles ?? text.unknown} {text.files}</p>
                  <ProgressPath path={dialogProgress.currentPath} />
                </div>
              ) : null}
              {conflictPrompt ? (
                <div className="operation-section conflict-dialog">
                  <h3>{text.conflictResolution}</h3>
                  <p>{text.conflictPrompt}</p>
                  <p>{conflictPrompt.source.name} → {conflictPrompt.destination.name}</p>
                  <div className="conflict-actions">
                    {conflictPrompt.availableDecisions.map((decision) => (
                      <button type="button" key={decision} onClick={() => resolveConflict(decision)}>
                        {conflictDecisionLabel(language, decision)}
                      </button>
                    ))}
                  </div>
                </div>
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
                    {operationKindLabel(language, visibleProgress.kind)} · {operationStateLabel(language, visibleProgress.state)} · {visibleProgress.completedFiles}/{visibleProgress.totalFiles ?? text.unknown} {text.files}
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
                  {text.conflictPrompt} {conflictPrompt.source.name} → {conflictPrompt.destination.name}
                </Dialog.Description>
                <div className="conflict-actions">
                  {conflictPrompt.availableDecisions.map((decision) => (
                    <button type="button" key={decision} onClick={() => resolveConflict(decision)}>
                      {conflictDecisionLabel(language, decision)}
                    </button>
                  ))}
                </div>
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

const OPERATION_PROGRESS_SURFACE_DELAY_MS = 450;
const OPERATION_SUCCESS_AUTO_DISMISS_MS = 1200;
const OPERATION_PROGRESS_PATH_MAX_CHARS = 96;
const OPERATION_DIALOG_TEXT: Record<SupportedLanguage, {
  currentFolderTarget: string;
  destination: string;
  currentLocation: string;
  irreversibleHint: string;
  shellCommand: string;
  shellCommandReady: string;
  result: string;
  resultComplete: string;
  fileInfo: string;
  archiveEntries: string;
  commandOutput: string;
  type: string;
  size: string;
  modified: string;
  permissions: string;
  exitCode: string;
  stdout: string;
  stderr: string;
  noOutput: string;
  encrypted: string;
  yes: string;
  no: string;
  sources: string;
  progress: string;
  conflictResolution: string;
  conflictPrompt: string;
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
    currentFolderTarget: '현재 폴더 자체를 대상으로 하는 작업입니다.',
    destination: '대상 위치',
    currentLocation: '현재 위치',
    irreversibleHint: '영구 삭제 후에는 되돌릴 수 없습니다.',
    shellCommand: '쉘 명령',
    shellCommandReady: '실행 전 확인이 완료되었습니다. 확인 후 실행할 수 있습니다.',
    result: '결과',
    resultComplete: '작업이 완료되었습니다.',
    fileInfo: '파일 정보',
    archiveEntries: '압축 파일 항목',
    commandOutput: '명령 출력',
    type: '종류',
    size: '크기',
    modified: '수정일',
    permissions: '권한',
    exitCode: '종료 코드',
    stdout: '표준 출력',
    stderr: '오류 출력',
    noOutput: '출력 없음',
    encrypted: '암호화',
    yes: '예',
    no: '아니오',
    sources: '대상 항목',
    progress: '진행',
    conflictResolution: '충돌 처리',
    conflictPrompt: '같은 이름의 항목이 이미 있습니다. 처리 방법을 선택하세요.',
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
    currentFolderTarget: 'This action targets the current folder.',
    destination: 'Destination',
    currentLocation: 'Current location',
    irreversibleHint: 'Permanent deletion cannot be undone.',
    shellCommand: 'Shell command',
    shellCommandReady: 'The command is ready to run after confirmation.',
    result: 'Result',
    resultComplete: 'The operation completed.',
    fileInfo: 'File information',
    archiveEntries: 'Archive entries',
    commandOutput: 'Command output',
    type: 'Type',
    size: 'Size',
    modified: 'Modified',
    permissions: 'Permissions',
    exitCode: 'Exit code',
    stdout: 'Standard output',
    stderr: 'Error output',
    noOutput: 'No output',
    encrypted: 'Encrypted',
    yes: 'Yes',
    no: 'No',
    sources: 'Sources',
    progress: 'Progress',
    conflictResolution: 'Conflict resolution',
    conflictPrompt: 'An item with the same name already exists. Choose how to continue.',
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

type OperationDialogText = (typeof OPERATION_DIALOG_TEXT)[SupportedLanguage];

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

const operationOverviewText = (
  dialogKind: OperationDialogDraft['dialogKind'],
  count: number,
  language: SupportedLanguage,
) => {
  const item = language === 'ko' ? `${count}개 항목` : `${count} item${count === 1 ? '' : 's'}`;
  const texts: Record<OperationDialogDraft['dialogKind'], string> = language === 'ko'
    ? {
      copy: `${item}을 대상 위치로 복사합니다.`,
      move: `${item}을 대상 위치로 이동합니다.`,
      trash: `${item}을 휴지통으로 보냅니다.`,
      deletePermanent: `${item}을 영구 삭제합니다. 이 작업은 되돌릴 수 없습니다.`,
      rename: '선택한 항목의 이름을 변경합니다.',
      createDir: '현재 위치에 새 폴더를 만듭니다.',
      properties: '선택한 항목의 정보를 표시합니다.',
      archivePreview: '압축 파일의 내용을 표시합니다.',
      archiveCreate: `${item}을 압축 파일로 만듭니다.`,
      archiveExtract: '압축 파일을 대상 위치에 풉니다.',
      externalOpenDefault: '선택한 파일을 기본 앱으로 엽니다.',
      externalReveal: '선택한 항목의 위치를 파일 관리자에서 엽니다.',
      externalEditor: '선택한 파일을 터미널 편집기로 엽니다.',
      shellCommand: '현재 위치에서 명령을 실행하기 전에 확인합니다.',
    }
    : {
      copy: `Copy ${item} to the destination.`,
      move: `Move ${item} to the destination.`,
      trash: `Move ${item} to the trash.`,
      deletePermanent: `Permanently delete ${item}. This cannot be undone.`,
      rename: 'Rename the selected item.',
      createDir: 'Create a folder in the current location.',
      properties: 'Show information for the selected item.',
      archivePreview: 'Show the contents of the archive.',
      archiveCreate: `Create an archive from ${item}.`,
      archiveExtract: 'Extract the archive to the destination.',
      externalOpenDefault: 'Open the selected file with the default app.',
      externalReveal: 'Reveal the selected item in the file manager.',
      externalEditor: 'Open the selected file in the terminal editor.',
      shellCommand: 'Review a command before running it in the current location.',
    };
  return texts[dialogKind];
};

const overviewPathLabel = (
  dialogKind: OperationDialogDraft['dialogKind'],
  text: OperationDialogText,
) => {
  if (dialogKind === 'copy' || dialogKind === 'move' || dialogKind === 'archiveExtract' || dialogKind === 'archiveCreate') {
    return text.destination;
  }
  return text.currentLocation;
};

function OperationOverview({
  dialog,
  language,
  text,
}: {
  dialog: OperationDialogDraft;
  language: SupportedLanguage;
  text: OperationDialogText;
}) {
  const count = dialog.sources.length || 1;
  const destination = dialog.targetDir;
  return (
    <div className="operation-overview">
      <p>{operationOverviewText(dialog.dialogKind, count, language)}</p>
      {destination ? (
        <div className="operation-overview-path">
          <span>{overviewPathLabel(dialog.dialogKind, text)}</span>
          <code title={destination}>{destination}</code>
        </div>
      ) : null}
      {dialog.dialogKind === 'deletePermanent' ? (
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

const confirmationPhraseInstruction = (language: SupportedLanguage, phrase: string) =>
  language === 'ko'
    ? `계속하려면 “${phrase}”를 입력하세요.`
    : `Type “${phrase}” to continue.`;

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
  const labels: Record<SupportedLanguage, Record<string, string>> = {
    ko: { file: '파일', directory: '폴더', symlink: '링크', archive: '압축 파일', other: '기타' },
    en: { file: 'File', directory: 'Folder', symlink: 'Link', archive: 'Archive', other: 'Other' },
  };
  return labels[language][kind] ?? kind;
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

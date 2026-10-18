import type {
  OperationProgress,
  OperationState,
  OperationSummary
} from '../domain/types';
import {
  formatUserErrorMessage,
  type SupportedLanguage
} from '../i18n-resources';

const OPERATION_PROGRESS_PATH_MAX_CHARS = 96;

export const isTerminalOperationState = (state: OperationState) =>
  state === 'completed' || state === 'completedWithErrors' || state === 'failed' || state === 'cancelled';

export const summaryRequiresAttention = (summary: OperationSummary) =>
  summary.kind === 'shellCommand' ||
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

export const progressWidth = (progress: OperationProgress) => `${operationProgressPercent(progress).toFixed(2)}%`;

export const progressPercentLabel = (progress: OperationProgress) => Math.round(operationProgressPercent(progress));

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

export const formatByteProgress = (completed: number, total: number | null, unknownLabel = 'unknown') => {
  if (total === null) {
    return `${formatBytes(completed)} / ${unknownLabel}`;
  }
  return `${formatBytes(completed)} / ${formatBytes(total)}`;
};

export const formatThroughput = (bytesPerSecond: number | null, unknownLabel = 'unknown') => {
  if (bytesPerSecond === null) {
    return unknownLabel;
  }
  return `${formatBytes(bytesPerSecond)}/s`;
};

export const formatEta = (etaSeconds: number | null, unknownLabel = 'unknown') => {
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

export const formatOperationError = (
  error: { code?: string; messageKey: string; path?: string | null; details?: Record<string, unknown> | null },
  language: SupportedLanguage,
) => {
  const message = formatUserErrorMessage(language, error);
  const cause = error.code === 'trash_failed' && typeof error.details?.message === 'string'
    ? error.details.message.trim()
    : '';
  return cause ? message + '\n' + cause : message;
};

export const formatBytes = (bytes: number) => {
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

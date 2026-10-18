import type { ConflictDecision, OperationKind, OperationState, OperationSummary } from '../domain/types';
import {
  CONFLICT_DECISION_LABELS,
  OPERATION_KIND_LABELS,
  OPERATION_STATE_LABELS,
  OPERATION_SUMMARY_STATUS_TEXT,
  type SupportedLanguage,
} from '../i18n-resources';

export const operationKindLabel = (language: SupportedLanguage, kind: OperationKind) =>
  OPERATION_KIND_LABELS[language][kind];

export const operationStateLabel = (language: SupportedLanguage, state: OperationState) =>
  OPERATION_STATE_LABELS[language][state];

export const conflictDecisionLabel = (language: SupportedLanguage, decision: ConflictDecision) =>
  CONFLICT_DECISION_LABELS[language][decision];

export const operationSummaryStatusLabel = (summary: OperationSummary, language: SupportedLanguage) => {
  if (summary.kind === 'shellCommand') return operationStateLabel(language, summary.state);
  const text = OPERATION_SUMMARY_STATUS_TEXT[language];
  if (summary.state === 'completed') {
    return text.completed(summary.completedFiles);
  }
  if (summary.state === 'completedWithErrors') {
    return text.completedWithErrors(summary.completedFiles, summary.failedFiles);
  }
  if (summary.state === 'cancelled') {
    return text.cancelled;
  }
  return text.failed(summary.failedFiles);
};

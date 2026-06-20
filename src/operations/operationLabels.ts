import type { ConflictDecision, OperationKind, OperationState, OperationSummary } from '../domain/types';
import type { SupportedLanguage } from '../i18n-resources';

const OPERATION_KIND_LABELS: Record<SupportedLanguage, Record<OperationKind, string>> = {
  ko: {
    copy: '복사',
    move: '이동',
    delete: '삭제',
    trash: '휴지통 이동',
    rename: '이름 변경',
    createDir: '새 폴더',
    archiveCreate: '압축 생성',
    archiveExtract: '압축 해제',
  },
  en: {
    copy: 'Copy',
    move: 'Move',
    delete: 'Delete',
    trash: 'Move to Trash',
    rename: 'Rename',
    createDir: 'New Folder',
    archiveCreate: 'Create Archive',
    archiveExtract: 'Extract Archive',
  },
};

const OPERATION_STATE_LABELS: Record<SupportedLanguage, Record<OperationState, string>> = {
  ko: {
    idle: '대기',
    validating: '확인 중',
    scanning: '스캔 중',
    queued: '대기 중',
    waitingForConflict: '충돌 처리 대기',
    running: '진행 중',
    cancelling: '취소 중',
    completed: '완료',
    completedWithErrors: '일부 실패',
    failed: '실패',
    cancelled: '취소됨',
  },
  en: {
    idle: 'Idle',
    validating: 'Validating',
    scanning: 'Scanning',
    queued: 'Queued',
    waitingForConflict: 'Waiting for conflict choice',
    running: 'Running',
    cancelling: 'Cancelling',
    completed: 'Completed',
    completedWithErrors: 'Completed with errors',
    failed: 'Failed',
    cancelled: 'Cancelled',
  },
};

const CONFLICT_DECISION_LABELS: Record<SupportedLanguage, Record<ConflictDecision, string>> = {
  ko: {
    overwrite: '덮어쓰기',
    skip: '건너뛰기',
    allOverwrite: '모두 덮어쓰기',
    allSkip: '모두 건너뛰기',
    cancel: '취소',
  },
  en: {
    overwrite: 'Overwrite',
    skip: 'Skip',
    allOverwrite: 'Overwrite All',
    allSkip: 'Skip All',
    cancel: 'Cancel',
  },
};

export const operationKindLabel = (language: SupportedLanguage, kind: OperationKind) =>
  OPERATION_KIND_LABELS[language][kind];

export const operationStateLabel = (language: SupportedLanguage, state: OperationState) =>
  OPERATION_STATE_LABELS[language][state];

export const conflictDecisionLabel = (language: SupportedLanguage, decision: ConflictDecision) =>
  CONFLICT_DECISION_LABELS[language][decision];

export const operationSummaryStatusLabel = (summary: OperationSummary, language: SupportedLanguage) => {
  if (language === 'ko') {
    if (summary.state === 'completed') {
      return `완료: ${summary.completedFiles}개`;
    }
    if (summary.state === 'completedWithErrors') {
      return `일부 실패: 완료 ${summary.completedFiles}개, 실패 ${summary.failedFiles}개`;
    }
    if (summary.state === 'cancelled') {
      return '취소됨';
    }
    return `실패: ${summary.failedFiles}개`;
  }

  if (summary.state === 'completed') {
    return `completed: ${summary.completedFiles}`;
  }
  if (summary.state === 'completedWithErrors') {
    return `partially failed: completed ${summary.completedFiles}, failed ${summary.failedFiles}`;
  }
  if (summary.state === 'cancelled') {
    return 'cancelled';
  }
  return `failed: ${summary.failedFiles}`;
};

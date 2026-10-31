import { parseShellCommandInput } from '../actions/commandInput';
import { archiveFileSuffix } from '../domain/archiveFormats';
import { DIALOG_DEFINITIONS } from './dialogDefinitions';
import { OPERATION_CONFIRMATION_TEXT } from '../i18n-resources';
import { ACTION_BY_ID, type ActionId } from '../actions/registry';
import type { OperationKind } from '../domain/types';
import { DialogExecutionMode, DialogKind, LongRunningDialogKind, OpenDialogRequest, OperationDialogDraft } from './operationTypes';

let nextDialogId = 0;

export const dialogKindForAction = (actionId: ActionId): DialogKind | null =>
  ACTION_BY_ID.get(actionId)?.dialogKind ?? null;

export const buildDialogDraft = (dialogKind: DialogKind, request: OpenDialogRequest): OperationDialogDraft => {
  const isPermanentDelete = dialogKind === 'deletePermanent';
  const backendExecutionStubbed = isBackendExecutionStubbed(dialogKind, request);
  const inputValue = initialInputValueForDialog(dialogKind, request);
  const requiredConfirmationPhrase = requiredConfirmationPhraseForDialog(dialogKind, request);
  return {
    id: ++nextDialogId,
    dialogKind,
    executionMode: dialogExecutionModeForDialog(dialogKind),
    panelId: request.panelId,
    sources: request.sources,
    targetDir: targetForDialog(dialogKind, request),
    dangerLevel: request.action.dangerLevel,
    defaultDecision: isPermanentDelete ? 'cancel' : 'skip',
    backendExecutionStubbed,
    backendExecutionStubReasonKey: backendExecutionStubbed
      ? 'operations.backendExecution.stubbedUntilCommandWiring'
      : null,
    atomicResult: null,
    inputValue,
    secretValue: '',
    requiredConfirmationPhrase,
    validationErrorKey: validateDialogInput(dialogKind, inputValue, requiredConfirmationPhrase),
    validationShown: false,
    atomicPending: false,
    operationPending: false,
    atomicExecutor: request.atomicExecutor ?? null,
    longRunningExecutor: request.longRunningExecutor ?? null,
    cancelExecutor: request.cancelExecutor ?? null,
    conflictResolver: request.conflictResolver ?? null,
    onAtomicSuccess: request.onAtomicSuccess ?? null,
    onOperationSummary: request.onOperationSummary ?? null,
    onOperationStartError: request.onOperationStartError ?? null,
  };
};

const targetForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind === 'bulkRename' || dialogKind === 'copy' || dialogKind === 'move' || dialogKind === 'archiveCreate' || dialogKind === 'archiveExtract') {
    return request.targetDir;
  }
  if (dialogKind === 'createDir' || dialogKind === 'shellCommand') {
    return request.workingDir;
  }
  return request.sources[0]?.path ?? request.workingDir;
};

export const isLongRunningDialog = (dialogKind: DialogKind): dialogKind is LongRunningDialogKind =>
  DIALOG_DEFINITIONS[dialogKind].executionMode === 'longRunningOperation';

export const dialogExecutionModeForDialog = (dialogKind: DialogKind): DialogExecutionMode =>
  DIALOG_DEFINITIONS[dialogKind].executionMode;

const isBackendExecutionStubbed = (dialogKind: DialogKind, request: OpenDialogRequest) =>
  isLongRunningDialog(dialogKind) ? !request.longRunningExecutor : !request.atomicExecutor;

const initialInputValueForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind === 'rename') {
    return request.sources[0]?.name ?? '';
  }
  if (dialogKind === 'archiveCreate') {
    return defaultArchiveCreateName(request);
  }
  return '';
};

const defaultArchiveCreateName = (request: OpenDialogRequest) => {
  const baseName = request.sources.length === 1
    ? request.sources[0]?.name
    : basenameOfPath(request.workingDir);
  const base = (baseName || OPERATION_CONFIRMATION_TEXT[request.language ?? 'ko'].defaultArchiveBase).replace(/[\\/]/g, '_');
  const extension = '.zip';
  const candidate = `${base}${extension}`;
  const existingNames = new Set((request.targetEntries ?? [])
    .map((entry) => normalizeArchiveCandidate(entry.name)));
  if (!existingNames.has(normalizeArchiveCandidate(candidate))) {
    return candidate;
  }
  for (let number = 2; ; number += 1) {
    const numberedCandidate = `${base} (${number})${extension}`;
    if (!existingNames.has(normalizeArchiveCandidate(numberedCandidate))) {
      return numberedCandidate;
    }
  }
};

const basenameOfPath = (path: string) => {
  const name = path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? '';
  return /^[a-z]:$/i.test(name) ? '' : name;
};

const normalizeArchiveCandidate = (name: string) => name.normalize('NFD').toLowerCase();

const requiredConfirmationPhraseForDialog = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (dialogKind !== 'deletePermanent') {
    return null;
  }
  // 항목 수가 든 짧은 문구(한국어 UI는 한/영 전환 없이 입력): 파일 이름 전체를 다시 치게 하지 않음
  return OPERATION_CONFIRMATION_TEXT[request.language ?? 'ko'].deletePhrase(request.sources.length);
};

/** 입력하는 동안 오류를 바로 보일지: 비어 있지 않은 이름·명령만(확인 문구는 확인을 시도한 뒤에만) */
export const showsValidationWhileTyping = (dialogKind: DialogKind, value: string) =>
  dialogKind !== 'deletePermanent' && value.trim() !== '';

// 이름 입력 공통 오류: 빈 이름과 경로 구분자를 서로 다른 안내로 구분
const nameInputError = (trimmed: string) => {
  if (!trimmed) {
    return 'errors.nameRequired';
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return 'errors.nameHasSeparator';
  }
  return null;
};

export const validateDialogInput = (dialogKind: DialogKind, value: string, requiredConfirmationPhrase: string | null) => {
  const trimmed = value.trim();
  if (dialogKind === 'deletePermanent') {
    return requiredConfirmationPhrase && trimmed === requiredConfirmationPhrase ? null : 'errors.confirmationRequired';
  }
  if (dialogKind === 'archiveCreate') {
    const nameError = nameInputError(trimmed);
    if (nameError) {
      return nameError;
    }
    if (archiveFileSuffix(trimmed) === null) {
      return 'errors.archiveFormatUnsupported';
    }
    return null;
  }
  if (dialogKind === 'shellCommand') {
    return parseShellCommandInput(value) ? null : 'errors.invalidShellCommand';
  }
  if (dialogKind !== 'createDir' && dialogKind !== 'rename') {
    return null;
  }
  return nameInputError(trimmed) ?? (trimmed === '.' || trimmed === '..' ? 'errors.invalidName' : null);
};


export const operationKindForDialog = (dialogKind: LongRunningDialogKind): OperationKind =>
  DIALOG_DEFINITIONS[dialogKind].operationKind;

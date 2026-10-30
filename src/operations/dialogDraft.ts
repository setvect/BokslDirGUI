import { parseShellCommandInput } from '../actions/commandInput';
import { archiveFileSuffix } from '../domain/archiveFormats';
import { DIALOG_DEFINITIONS } from './dialogDefinitions';
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
  const base = (baseName || '선택 항목').replace(/[\\/]/g, '_');
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
  if (request.sources.length === 1 && request.sources[0]?.name) {
    return request.sources[0].name;
  }
  return `DELETE ${request.sources.length}`;
};

export const validateDialogInput = (dialogKind: DialogKind, value: string, requiredConfirmationPhrase: string | null) => {
  const trimmed = value.trim();
  if (dialogKind === 'deletePermanent') {
    return requiredConfirmationPhrase && trimmed === requiredConfirmationPhrase ? null : 'errors.confirmationRequired';
  }
  if (dialogKind === 'archiveCreate') {
    if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
      return 'errors.invalidName';
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
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return 'errors.invalidName';
  }
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('\0')) {
    return 'errors.invalidName';
  }
  return null;
};

export const operationKindForDialog = (dialogKind: LongRunningDialogKind): OperationKind =>
  DIALOG_DEFINITIONS[dialogKind].operationKind;

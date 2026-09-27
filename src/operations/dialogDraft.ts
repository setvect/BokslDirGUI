import type { ActionId } from '../actions/registry';
import type { OperationKind } from '../domain/types';
import { AtomicCommandDialogKind, DialogExecutionMode, DialogKind, LongRunningDialogKind, OpenDialogRequest, OperationDialogDraft } from './operationTypes';

let nextDialogId = 0;

export const dialogKindForAction = (actionId: ActionId): DialogKind | null => {
  const mapping: Partial<Record<ActionId, DialogKind>> = {
    'file.copy': 'copy',
    'file.move': 'move',
    'file.trash': 'trash',
    'file.deletePermanent': 'deletePermanent',
    'file.rename': 'rename',
    'file.mkdir': 'createDir',
    'file.properties': 'properties',
    'archive.extract': 'archiveExtract',
    'archive.extractAuto': 'archiveExtract',
    'archive.create': 'archiveCreate',
    'external.openDefault': 'externalOpenDefault',
    'external.reveal': 'externalReveal',
    'external.openEditor': 'externalEditor',
    'external.runShellCommand': 'shellCommand',
  };
  return mapping[actionId] ?? null;
};

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
  if (dialogKind === 'copy' || dialogKind === 'move' || dialogKind === 'archiveCreate' || dialogKind === 'archiveExtract') {
    return request.targetDir;
  }
  if (dialogKind === 'createDir' || dialogKind === 'shellCommand') {
    return request.workingDir;
  }
  return request.sources[0]?.path ?? request.workingDir;
};

const LONG_RUNNING_DIALOGS: readonly LongRunningDialogKind[] = [
  'copy',
  'move',
  'trash',
  'deletePermanent',
  'archiveCreate',
  'archiveExtract',
];

const ATOMIC_COMMAND_DIALOGS: readonly AtomicCommandDialogKind[] = [
  'rename',
  'createDir',
  'properties',
  'externalOpenDefault',
  'externalReveal',
  'externalEditor',
  'shellCommand',
];

export const isLongRunningDialog = (dialogKind: DialogKind): dialogKind is LongRunningDialogKind =>
  LONG_RUNNING_DIALOGS.includes(dialogKind as LongRunningDialogKind);

const isAtomicCommandDialog = (dialogKind: DialogKind): dialogKind is AtomicCommandDialogKind =>
  ATOMIC_COMMAND_DIALOGS.includes(dialogKind as AtomicCommandDialogKind);

export const dialogExecutionModeForDialog = (dialogKind: DialogKind): DialogExecutionMode => {
  if (isLongRunningDialog(dialogKind)) {
    return 'longRunningOperation';
  }
  if (isAtomicCommandDialog(dialogKind)) {
    return 'atomicCommand';
  }
  return 'unsupportedPreview';
};

const CONNECTABLE_SAFE_MUTATIONS: readonly DialogKind[] = ['createDir', 'rename'];
const CONNECTABLE_LONG_RUNNING_OPERATIONS: readonly DialogKind[] = ['copy', 'move', 'trash', 'deletePermanent', 'archiveCreate', 'archiveExtract'];

const isBackendExecutionStubbed = (dialogKind: DialogKind, request: OpenDialogRequest) => {
  if (CONNECTABLE_LONG_RUNNING_OPERATIONS.includes(dialogKind)) {
    return !request.longRunningExecutor;
  }
  if (isLongRunningDialog(dialogKind)) {
    return true;
  }
  if (CONNECTABLE_SAFE_MUTATIONS.includes(dialogKind)) {
    return !request.atomicExecutor;
  }
  return dialogExecutionModeForDialog(dialogKind) === 'atomicCommand' && !request.atomicExecutor;
};

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
    if (!archiveCreateNameIsSupported(trimmed)) {
      return 'errors.archiveFormatUnsupported';
    }
    return null;
  }
  if (dialogKind === 'shellCommand') {
    return trimmed ? null : 'errors.invalidShellCommand';
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

const archiveCreateNameIsSupported = (name: string) => [
  '.zip', '.jar', '.war', '.tar', '.tar.gz', '.tgz', '.tar.zst', '.tzst', '.7z',
].some((suffix) => name.toLowerCase().endsWith(suffix));

export const operationKindForDialog = (dialogKind: LongRunningDialogKind): OperationKind => {
  const mapping: Record<LongRunningDialogKind, OperationKind> = {
    copy: 'copy',
    move: 'move',
    trash: 'trash',
    deletePermanent: 'delete',
    archiveCreate: 'archiveCreate',
    archiveExtract: 'archiveExtract',
  };
  return mapping[dialogKind];
};

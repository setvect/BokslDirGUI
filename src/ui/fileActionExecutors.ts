import {
  type ActionId
} from '../actions/registry';
import { type AtomicCommandExecutor, type LongRunningOperationExecutor } from '../operations/operationTypes';
import { LongRunningOperationClient, SafeMutationClient } from '../tauri/commanderClients';
import { ArchiveAddPlan, ArchiveCopyPlan, archiveFormatForPath, joinPath, parseShellCommandInput } from './fileActionPlans';

export const atomicExecutorForAction = (
  actionId: ActionId,
  mutationClient: SafeMutationClient,
): AtomicCommandExecutor | undefined => {
  if (actionId === 'file.mkdir') {
    return (dialog) =>
      mutationClient.createDir({ parent: dialog.targetDir ?? '', name: dialog.inputValue.trim() });
  }
  if (actionId === 'file.rename') {
    return (dialog) =>
      mutationClient.renameEntry({ path: dialog.sources[0]?.path ?? '', newName: dialog.inputValue.trim() });
  }
  if (actionId === 'file.properties') {
    return (dialog) => mutationClient.getMetadata
      ? mutationClient.getMetadata({ path: dialog.sources[0]?.path ?? dialog.targetDir ?? '' })
      : unsupportedClientResult('get_metadata', dialog.targetDir);
  }
  if (actionId === 'external.openDefault') {
    return (dialog) => mutationClient.openDefault
      ? mutationClient.openDefault({ path: dialog.sources[0]?.path ?? '' })
      : unsupportedClientResult('open_default', dialog.targetDir);
  }
  if (actionId === 'external.reveal') {
    return (dialog) => mutationClient.revealInManager
      ? mutationClient.revealInManager({ path: dialog.sources[0]?.path ?? '' })
      : unsupportedClientResult('reveal_in_manager', dialog.targetDir);
  }
  if (actionId === 'external.runShellCommand') {
    return async (dialog) => {
      const parsed = parseShellCommandInput(dialog.inputValue);
      if (!parsed) {
        return {
          ok: false,
          error: {
            code: 'invalid_command',
            messageKey: 'errors.invalidShellCommand',
            path: dialog.targetDir,
            details: null,
            recoverable: true,
          },
        };
      }
      return mutationClient.runShellCommand ? mutationClient.runShellCommand({
        workingDir: dialog.targetDir ?? '',
        command: parsed.command,
        args: parsed.args,
      }) : unsupportedClientResult('run_shell_command', dialog.targetDir);
    };
  }
  return undefined;
};

export const longRunningExecutorForAction = (
  actionId: ActionId,
  operationClient: LongRunningOperationClient,
): LongRunningOperationExecutor | undefined => {
  if (actionId === 'file.copy') {
    return (dialog) => operationClient.startCopy({
      sources: dialog.sources.map((source) => source.path),
      targetDir: dialog.targetDir ?? '',
      policy: dialog.defaultDecision,
    });
  }
  if (actionId === 'file.move') {
    return (dialog) => operationClient.startMove({
      sources: dialog.sources.map((source) => source.path),
      targetDir: dialog.targetDir ?? '',
      policy: dialog.defaultDecision,
    });
  }
  if (actionId === 'file.trash') {
    return (dialog) => operationClient.startDelete({
      targets: dialog.sources.map((source) => source.path),
      mode: 'trash',
    });
  }
  if (actionId === 'file.deletePermanent') {
    return (dialog) => operationClient.startDelete({
      targets: dialog.sources.map((source) => source.path),
      mode: 'permanent',
      confirmToken: dialog.requiredConfirmationPhrase && dialog.inputValue.trim() === dialog.requiredConfirmationPhrase
        ? 'PERMANENT_DELETE'
        : undefined,
    });
  }
  if (actionId === 'archive.create') {
    return (dialog) => {
      if (!operationClient.archiveCreate) {
        return unsupportedClientResult('archive_create', dialog.targetDir);
      }
      const targetArchive = joinPath(dialog.targetDir ?? '', dialog.inputValue.trim());
      const format = archiveFormatForPath(targetArchive);
      return operationClient.archiveCreate({
        sources: dialog.sources.map((source) => source.path),
        targetArchive,
        format,
        password: dialog.secretValue || undefined,
      });
    };
  }
  if (actionId === 'archive.extract' || actionId === 'archive.extractAuto') {
    return (dialog) => operationClient.archiveExtract ? operationClient.archiveExtract({
      archivePath: dialog.sources[0]?.path ?? '',
      targetDir: dialog.targetDir ?? '',
      password: dialog.secretValue || undefined,
      policy: dialog.defaultDecision,
    }) : unsupportedClientResult('archive_extract', dialog.targetDir);
  }
  return undefined;
};

export const archiveCopyExecutorForPlan = (
  plan: ArchiveCopyPlan,
  operationClient: LongRunningOperationClient,
): LongRunningOperationExecutor => (dialog) => operationClient.archiveExtract ? operationClient.archiveExtract({
  archivePath: plan.archivePath,
  targetDir: dialog.targetDir ?? '',
  policy: dialog.defaultDecision,
  entries: plan.entries,
  stripPrefix: plan.stripPrefix,
  password: plan.password,
}) : unsupportedClientResult('archive_extract', dialog.targetDir);

export const archiveAddExecutorForPlan = (
  plan: ArchiveAddPlan,
  operationClient: LongRunningOperationClient,
): LongRunningOperationExecutor => (dialog) => operationClient.archiveAdd ? operationClient.archiveAdd({
  sources: dialog.sources.map((source) => source.path),
  archivePath: plan.archivePath,
  targetInnerDir: plan.targetInnerDir,
  policy: dialog.defaultDecision,
}) : unsupportedClientResult('archive_add', dialog.targetDir);

const unsupportedClientResult = async (command: string, path: string | null) => ({
  ok: false as const,
  error: {
    code: 'unsupported',
    messageKey: 'errors.commandNotConnected',
    path,
    details: { command },
    recoverable: true,
  },
});

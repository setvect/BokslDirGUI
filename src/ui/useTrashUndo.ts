import { useEffect, useRef, useState } from 'react';
import { ACTION_BY_ID, labelForAction } from '../actions/registry';
import type { PanelId, PlatformInfo, TrashUndoPreview } from '../domain/types';
import { formatUserErrorMessage, type SupportedLanguage } from '../i18n-resources';
import { operationSummaryStatusLabel } from '../operations/operationLabels';
import type { OpenDialogRequest } from '../operations/operationTypes';
import type { LongRunningOperationClient, SafeMutationClient } from '../tauri/commanderClients';

interface Dependencies {
  readonly mutationClient: SafeMutationClient;
  readonly operationClient: LongRunningOperationClient;
  readonly runtimeBackendAvailable: boolean;
  readonly operationBusy: boolean;
  readonly platformInfo?: PlatformInfo;
  readonly language: SupportedLanguage;
  readonly openOperationDialog: (request: OpenDialogRequest) => void;
  readonly refreshPanel: (panel: PanelId, background?: boolean) => void;
  readonly setStatusMessage: (message: string) => void;
}

export function useTrashUndo(dependencies: Dependencies) {
  const [preview, setPreview] = useState<TrashUndoPreview | null>(null);
  const [revision, setRevision] = useState(0);
  const sequence = useRef(0);
  const { mutationClient, operationClient, runtimeBackendAvailable, operationBusy } = dependencies;
  const enabled = runtimeBackendAvailable && (dependencies.platformInfo?.features.trashUndo ?? true) && !!mutationClient.previewTrashUndo && !!operationClient.startTrashUndo;
  useEffect(() => {
    const request = ++sequence.current;
    setPreview(null);
    if (enabled && !operationBusy) {
      void mutationClient.previewTrashUndo!().then(result => {
        if (request === sequence.current && result.ok) setPreview(result.data);
      }).catch(() => { /* A later operation refresh retries; never reuse an unverified receipt. */ });
    }
    return () => { sequence.current++; };
  }, [mutationClient, enabled, operationBusy, revision]);

  const openTrashUndo = (panelId: PanelId, workingDir: string) => {
    if (!preview || !enabled || operationBusy) return;
    const snapshot = preview;
    const action = ACTION_BY_ID.get('file.undoTrash')!;
    dependencies.openOperationDialog({
      action, panelId, sources: snapshot.entries, targetDir: null, workingDir,
      longRunningExecutor: () => operationClient.startTrashUndo!({ id: snapshot.id }),
      cancelExecutor: operationId => operationClient.cancelOperation({ operationId }),
      onOperationSummary: summary => {
        dependencies.refreshPanel('left', true);
        dependencies.refreshPanel('right', true);
        dependencies.setStatusMessage(`${labelForAction(action, dependencies.language)} ${operationSummaryStatusLabel(summary, dependencies.language)}`);
        setRevision(value => value + 1);
      },
      onOperationStartError: error => {
        setRevision(value => value + 1);
        dependencies.setStatusMessage(formatUserErrorMessage(dependencies.language, error));
        return 'dismiss';
      },
    });
  };
  return { trashUndoAvailable: enabled && !operationBusy && !!preview, openTrashUndo,
    refreshTrashUndo: () => setRevision(value => value + 1) };
}

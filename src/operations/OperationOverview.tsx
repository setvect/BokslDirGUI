import {
  type OperationDialogText,
  type SupportedLanguage
} from '../i18n-resources';
import { OperationDialogKind, confirmationPhraseInstruction } from './dialogPresentation';
import { type OperationDialogDraft } from './operationTypes';

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

export function OperationOverview({
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

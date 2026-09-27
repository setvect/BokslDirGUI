import type { RefObject } from 'react';
import { translateUserMessageKey, type OperationDialogText, type SupportedLanguage } from '../i18n-resources';
import type { OperationDialogDraft } from './operationTypes';

interface OperationInputsProps {
  dialog: OperationDialogDraft;
  dialogInputLabel: string | null;
  dialogInputRef: RefObject<HTMLInputElement | null>;
  language: SupportedLanguage;
  text: OperationDialogText;
  updateDialogInput(value: string): void;
  updateDialogSecret(value: string): void;
  confirmDialog(): Promise<void>;
}

export function OperationInputs({ dialog, dialogInputLabel, dialogInputRef, language, text,
  updateDialogInput, updateDialogSecret, confirmDialog }: OperationInputsProps) {
  return <>
    {dialogInputLabel ? (
      <label className="operation-field">
        <span>{dialogInputLabel}</span>
        <input
          ref={dialogInputRef}
          aria-label={dialogInputLabel}
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
    {dialog.dialogKind === 'archiveCreate' || dialog.dialogKind === 'archiveExtract' ? (
      <label className="operation-field">
        <span>{text.archivePassword}</span>
        <input
          type="password"
          autoComplete="new-password"
          aria-label={text.archivePassword}
          value={dialog.secretValue}
          onChange={(event) => updateDialogSecret(event.currentTarget.value)}
        />
      </label>
    ) : null}
  </>;
}

import type { RefObject } from 'react';
import { translateUserMessageKey, type OperationDialogText, type SupportedLanguage } from '../i18n-resources';
import { LITERAL_TEXT_INPUT_PROPS } from '../ui/textInputProps';
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
          {...LITERAL_TEXT_INPUT_PROPS}
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
        {/* 오류 줄 자리를 늘 확보해 오류가 나타나거나 사라져도 아래 버튼이 움직이지 않게 함 */}
        <span className="operation-field-message">
          {dialog.validationShown && dialog.validationErrorKey ? (
            <span className="operation-error" role="alert">{translateUserMessageKey(language, dialog.validationErrorKey)}</span>
          ) : null}
        </span>
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

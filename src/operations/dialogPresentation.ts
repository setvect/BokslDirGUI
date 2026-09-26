import { type KeyboardEvent } from 'react';
import {
  OPERATION_CONFIRMATION_TEXT,
  OPERATION_DIALOG_DESCRIPTIONS,
  OPERATION_DIALOG_INPUT_LABELS,
  OPERATION_DIALOG_PRIMARY_LABELS,
  OPERATION_DIALOG_TITLES,
  formatItemCount,
  type OperationDialogText,
  type SupportedLanguage
} from '../i18n-resources';
import { isShellCommandPreview } from './OperationResultView';
import { type OperationDialogDraft } from './operationTypes';

const DIALOG_BUTTON_SELECTOR = 'button:not(:disabled):not([aria-disabled="true"])';

export const handleDialogButtonGroupKeyDown = (event: KeyboardEvent<HTMLElement>) => {
  const direction = dialogButtonNavigationDirection(event.key);
  if (direction === 0) {
    return;
  }

  const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>(DIALOG_BUTTON_SELECTOR));
  if (buttons.length < 2) {
    return;
  }

  const activeButtonIndex = buttons.findIndex((button) => button === document.activeElement);
  const currentIndex = activeButtonIndex >= 0 ? activeButtonIndex : 0;
  const nextIndex = (currentIndex + direction + buttons.length) % buttons.length;

  event.preventDefault();
  event.stopPropagation();
  buttons[nextIndex].focus({ preventScroll: true });
};

const dialogButtonNavigationDirection = (key: string) => {
  if (key === 'ArrowRight' || key === 'ArrowDown') {
    return 1;
  }
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    return -1;
  }
  return 0;
};

// Keep user-facing dialog copy in the presentation layer. The store carries semantic
// operation state; this helper family derives the visible modal contract from it.
export const operationDialogTitle = (dialogKind: OperationDialogKind, language: SupportedLanguage) => {
  return OPERATION_DIALOG_TITLES[language][dialogKind];
};

export const operationDialogDescription = (dialog: OperationDialogDraft, language: SupportedLanguage) => {
  const count = dialog.sources.length;
  return OPERATION_DIALOG_DESCRIPTIONS[language][dialog.dialogKind](formatItemCount(language, count));
};

const operationDialogPrimaryLabel = (dialog: OperationDialogDraft, atomicResult: unknown, language: SupportedLanguage) => {
  if (hasRunnableShellPreview(dialog, atomicResult)) {
    return OPERATION_DIALOG_PRIMARY_LABELS[language].runShellAfterConfirm;
  }
  return OPERATION_DIALOG_PRIMARY_LABELS[language][dialog.dialogKind];
};

export const operationDialogInputLabel = (dialogKind: OperationDialogKind, language: SupportedLanguage) =>
  OPERATION_DIALOG_INPUT_LABELS[language][dialogKind] ?? null;

export const operationDialogActions = ({
  dialog,
  atomicResult,
  inputLabel,
  language,
  text,
  confirmDialog,
  cancelOperation,
  closeDialog,
}: {
  dialog: OperationDialogDraft;
  atomicResult: unknown;
  inputLabel: string | null;
  language: SupportedLanguage;
  text: OperationDialogText;
  confirmDialog(): Promise<void>;
  cancelOperation(): void;
  closeDialog(): void;
}): OperationDialogAction[] => {
  if (shouldShowCloseOnlyAction(dialog, atomicResult)) {
    return [{
      key: 'close',
      label: text.dismiss,
      className: 'dialog-button secondary safe-default',
      autoFocus: true,
      closeWrapper: true,
      onClick: closeDialog,
    }];
  }

  const cancelShouldOwnFocus = shouldFocusCancelAction(inputLabel, dialog, atomicResult);
  const primaryDisabled = Boolean(dialog.validationErrorKey) || dialog.atomicPending || dialog.operationPending;
  const primaryShouldOwnFocus = !cancelShouldOwnFocus && !shouldFocusOperationInput(inputLabel, dialog, atomicResult) && !primaryDisabled;

  return [
    {
      key: 'cancel',
      label: text.cancel,
      className: `dialog-button secondary${cancelShouldOwnFocus ? ' safe-default' : ''}`,
      autoFocus: cancelShouldOwnFocus,
      onClick: dialog.executionMode === 'atomicCommand' ? closeDialog : cancelOperation,
    },
    {
      key: 'confirm',
      label: dialog.atomicPending || dialog.operationPending ? text.running : operationDialogPrimaryLabel(dialog, atomicResult, language),
      className: `dialog-button primary${isDangerousDialog(dialog) ? ' danger' : ''}`,
      disabled: primaryDisabled,
      autoFocus: primaryShouldOwnFocus,
      onClick: () => { void confirmDialog(); },
    },
  ];
};

const shouldShowCloseOnlyAction = (dialog: OperationDialogDraft, atomicResult: unknown) => {
  if (!atomicResult) {
    return false;
  }
  return !hasRunnableShellPreview(dialog, atomicResult);
};

export const shouldFocusOperationInput = (inputLabel: string | null, dialog: OperationDialogDraft, atomicResult: unknown) =>
  Boolean(inputLabel && !shouldShowCloseOnlyAction(dialog, atomicResult));

export const dialogFocusSignature = (
  dialog: OperationDialogDraft,
  atomicResult: unknown,
  inputLabel: string | null,
) => [
  dialog.dialogKind,
  inputLabel ?? '',
  dialog.sources.map((source) => source.path).join('|'),
  dialog.targetDir ?? '',
  atomicResult ? 'result' : 'draft',
  isShellCommandPreview(atomicResult) ? atomicResult.confirmToken : '',
].join('\u0000');

const shouldFocusCancelAction = (inputLabel: string | null, dialog: OperationDialogDraft, atomicResult: unknown) => {
  if (shouldFocusOperationInput(inputLabel, dialog, atomicResult)) {
    return false;
  }
  if (dialog.executionMode === 'longRunningOperation') {
    return true;
  }
  return isDangerousDialog(dialog);
};

const hasRunnableShellPreview = (dialog: OperationDialogDraft, atomicResult: unknown) =>
  dialog.dialogKind === 'shellCommand' &&
  isShellCommandPreview(atomicResult) &&
  atomicResult.policy.enabled === true &&
  atomicResult.confirmToken !== 'disabled';

const isDangerousDialog = (dialog: OperationDialogDraft) =>
  dialog.dialogKind === 'deletePermanent' ||
  dialog.dialogKind === 'trash' ||
  dialog.dangerLevel === 'destructive' ||
  dialog.dangerLevel === 'irreversible';

export type OperationDialogKind = OperationDialogDraft['dialogKind'];

export interface OperationDialogAction {
  key: string;
  label: string;
  className: string;
  disabled?: boolean;
  autoFocus?: boolean;
  closeWrapper?: boolean;
  onClick(): void;
}

export const confirmationPhraseInstruction = (language: SupportedLanguage, phrase: string) =>
  OPERATION_CONFIRMATION_TEXT[language].phraseInstruction(phrase);

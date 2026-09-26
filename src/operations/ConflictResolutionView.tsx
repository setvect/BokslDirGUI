import type {
  ConflictDecision,
  ConflictPrompt
} from '../domain/types';
import {
  type OperationDialogText,
  type SupportedLanguage
} from '../i18n-resources';
import { formatDateTime } from '../ui/format';
import { handleDialogButtonGroupKeyDown } from './dialogPresentation';
import { conflictDecisionLabel } from './operationLabels';
import { formatBytes } from './progressPresentation';

const isDefaultConflictDecision = (decision: ConflictDecision, prompt: ConflictPrompt) => {
  if (prompt.availableDecisions.includes(prompt.defaultDecision)) {
    return decision === prompt.defaultDecision;
  }
  if (prompt.availableDecisions.includes('skip')) {
    return decision === 'skip';
  }
  return decision === 'cancel';
};

const conflictDecisionButtonClassName = (decision: ConflictDecision, prompt: ConflictPrompt) => {
  const classes = ['dialog-button', 'conflict-button'];
  if (decision === 'overwrite' || decision === 'allOverwrite') {
    classes.push('danger');
  }
  if (isDefaultConflictDecision(decision, prompt)) {
    classes.push('safe-default');
  }
  return classes.join(' ');
};

export function ConflictResolutionView({
  prompt,
  language,
  text,
  resolveConflict,
}: {
  prompt: ConflictPrompt;
  language: SupportedLanguage;
  text: OperationDialogText;
  resolveConflict: (decision: ConflictDecision) => void;
}) {
  return (
    <div className="operation-section conflict-dialog">
      <h3>{text.conflictResolution}</h3>
      <p>{text.conflictPrompt}</p>
      <ConflictComparison prompt={prompt} text={text} />
      <ConflictActions prompt={prompt} language={language} resolveConflict={resolveConflict} />
    </div>
  );
}

export function ConflictComparison({
  prompt,
  text,
}: {
  prompt: ConflictPrompt;
  text: OperationDialogText;
}) {
  return (
    <div className="conflict-comparison">
      <ConflictEntryDetails label={text.sourceItem} entry={prompt.source} text={text} />
      <ConflictEntryDetails label={text.destinationItem} entry={prompt.destination} text={text} />
    </div>
  );
}

function ConflictEntryDetails({
  label,
  entry,
  text,
}: {
  label: string;
  entry: ConflictPrompt['source'];
  text: OperationDialogText;
}) {
  return (
    <section className="conflict-entry" aria-label={label}>
      <h4>{label}</h4>
      <dl>
        <div><dt>{text.path}</dt><dd><code title={entry.path}>{entry.path}</code></dd></div>
        <div><dt>{text.size}</dt><dd>{entry.sizeBytes === null ? '—' : formatBytes(entry.sizeBytes)}</dd></div>
        <div><dt>{text.modified}</dt><dd>{formatDateTime(entry.modifiedAt) || '—'}</dd></div>
      </dl>
    </section>
  );
}

export function ConflictActions({
  prompt,
  language,
  resolveConflict,
}: {
  prompt: ConflictPrompt;
  language: SupportedLanguage;
  resolveConflict: (decision: ConflictDecision) => void;
}) {
  return (
    <div className="conflict-actions" onKeyDown={handleDialogButtonGroupKeyDown}>
      {prompt.availableDecisions.map((decision) => (
        <button
          type="button"
          key={decision}
          className={conflictDecisionButtonClassName(decision, prompt)}
          autoFocus={isDefaultConflictDecision(decision, prompt)}
          onClick={() => resolveConflict(decision)}
        >
          {conflictDecisionLabel(language, decision)}
        </button>
      ))}
    </div>
  );
}

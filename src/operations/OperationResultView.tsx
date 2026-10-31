import { displayPath } from '../domain/pathDisplay';
import type {
  ArchiveListing,
  FileMetadata,
  ShellCommandResult
} from '../domain/types';
import {
  METADATA_KIND_LABELS,
  type OperationDialogText,
  type SupportedLanguage
} from '../i18n-resources';
import { FileInfoView } from '../ui/FileInfoView';

export function OperationResultView({
  value,
  language,
  text,
}: {
  value: unknown;
  language: SupportedLanguage;
  text: OperationDialogText;
}) {
  if (isFileMetadata(value)) {
    return <FileInfoView metadata={value} language={language} />;
  }
  if (isArchiveListing(value)) {
    return (
      <div className="operation-result-stack">
        <dl className="operation-result-list">
          <div><dt>{text.path}</dt><dd><code title={displayPath(value.archivePath)}>{displayPath(value.archivePath)}</code></dd></div>
          <div><dt>{text.encrypted}</dt><dd>{value.encrypted ? text.yes : text.no}</dd></div>
        </dl>
        <div>
          <h4>{text.archiveEntries}</h4>
          {value.entries.length > 0 ? (
            <ul className="operation-result-items">
              {value.entries.slice(0, 20).map((entry) => (
                <li key={entry.path}>
                  <span>{entry.name}</span>
                  <small>{metadataKindLabel(language, entry.kind)}</small>
                </li>
              ))}
            </ul>
          ) : (
            <p className="operation-muted">{text.noOutput}</p>
          )}
        </div>
      </div>
    );
  }
  if (isShellCommandResult(value)) {
    return (
      <div className="operation-result-stack">
        <dl className="operation-result-list">
          <div><dt>{text.currentLocation}</dt><dd><code>{displayPath(value.workingDir)}</code></dd></div>
          <div><dt>{text.exitCode}</dt><dd>{value.exitCode ?? '—'}</dd></div>
        </dl>
        {value.truncated ? <p className="operation-muted">{text.commandTruncated}</p> : null}
        <CommandOutput title={text.stdout} output={value.stdout} emptyLabel={text.noOutput} />
        <CommandOutput title={text.stderr} output={value.stderr} emptyLabel={text.noOutput} />
      </div>
    );
  }
  if (typeof value === 'string') {
    return <p>{value}</p>;
  }
  return <p>{text.resultComplete}</p>;
}

function CommandOutput({ title, output, emptyLabel }: { title: string; output: string; emptyLabel: string }) {
  return (
    <div className="operation-command-output">
      <h4>{title}</h4>
      {output ? <pre>{output}</pre> : <p className="operation-muted">{emptyLabel}</p>}
    </div>
  );
}

const metadataKindLabel = (language: SupportedLanguage, kind: string) => {
  return METADATA_KIND_LABELS[language][kind] ?? kind;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isFileMetadata = (value: unknown): value is FileMetadata =>
  isRecord(value) &&
  typeof value.absolutePath === 'string' &&
  typeof value.name === 'string' &&
  typeof value.kind === 'string';

const isArchiveListing = (value: unknown): value is ArchiveListing =>
  isRecord(value) &&
  typeof value.archivePath === 'string' &&
  Array.isArray(value.entries) &&
  typeof value.encrypted === 'boolean';

const isShellCommandResult = (value: unknown): value is ShellCommandResult =>
  isRecord(value) &&
  (typeof value.exitCode === 'number' || value.exitCode === null) &&
  typeof value.stdout === 'string' &&
  typeof value.stderr === 'string' &&
  typeof value.timedOut === 'boolean';

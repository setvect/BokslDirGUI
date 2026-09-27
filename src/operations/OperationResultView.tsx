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
import { formatDateTime } from '../ui/format';
import { formatBytes } from './progressPresentation';

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
    const directoryStats = value.kind === 'directory' ? value.directoryStats : null;
    const sizeBytes = directoryStats ? directoryStats.totalFileBytes : value.sizeBytes;
    const locale = language === 'ko' ? 'ko-KR' : 'en-US';
    return (
      <div className="operation-result-stack">
        <dl className="operation-result-list">
          <div><dt>{text.fileInfo}</dt><dd>{value.name}</dd></div>
          <div><dt>{text.currentLocation}</dt><dd><code title={value.absolutePath}>{value.absolutePath}</code></dd></div>
          <div><dt>{text.type}</dt><dd>{metadataKindLabel(language, value.kind)}</dd></div>
          <div><dt>{directoryStats ? text.directoryFileSize : text.size}</dt><dd>{sizeBytes === null ? '—' : formatBytes(sizeBytes)}</dd></div>
          {directoryStats ? (
            <>
              <div><dt>{text.fileCount}</dt><dd>{directoryStats.fileCount.toLocaleString(locale)}</dd></div>
              <div><dt>{text.directoryCount}</dt><dd>{directoryStats.directoryCount.toLocaleString(locale)}</dd></div>
            </>
          ) : null}
          <div><dt>{text.modified}</dt><dd>{formatDateTime(value.modifiedAt) || '—'}</dd></div>
          <div><dt>{text.permissions}</dt><dd>{value.permissions ?? '—'}</dd></div>
        </dl>
        {directoryStats ? <p className="operation-muted">{text.directoryScanScope}</p> : null}
      </div>
    );
  }
  if (isArchiveListing(value)) {
    return (
      <div className="operation-result-stack">
        <dl className="operation-result-list">
          <div><dt>{text.currentLocation}</dt><dd><code title={value.archivePath}>{value.archivePath}</code></dd></div>
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
          <div><dt>{text.exitCode}</dt><dd>{value.exitCode ?? '—'}</dd></div>
        </dl>
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

import { displayPath } from '../domain/pathDisplay';
import type { FileMetadata } from '../domain/types';
import { FILE_INFO_TEXT, IMAGE_METADATA_TAG_LABELS, METADATA_KIND_LABELS, OPERATION_DIALOG_TEXT, type SupportedLanguage } from '../i18n-resources';
import { formatBytes } from '../operations/progressPresentation';
import { formatDateTime } from './format';

const SUMMARY_KEYS = ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'OffsetTimeOriginal',
  'ExposureTime', 'FNumber', 'PhotographicSensitivity', 'ISOSpeed', 'FocalLength', 'FocalLengthIn35mmFilm'];

export function FileInfoView({ metadata: value, language }: { metadata: FileMetadata; language: SupportedLanguage }) {
  const text = OPERATION_DIALOG_TEXT[language];
  const info = FILE_INFO_TEXT[language];
  const directoryStats = value.kind === 'directory' ? value.directoryStats : null;
  const sizeBytes = directoryStats ? directoryStats.totalFileBytes : value.sizeBytes;
  const locale = language === 'ko' ? 'ko-KR' : 'en-US';
  const image = value.imageMetadata;
  const summaryFields = SUMMARY_KEYS.flatMap(key => image?.fields.filter(field => field.key === key) ?? []);
  const detailFields = image?.fields.filter(field => !SUMMARY_KEYS.includes(field.key)) ?? [];
  const fields = (items: Array<{ key: string; value: string }>) => (
    <dl className="operation-result-list">
      {items.map((field, index) => <div key={`${field.key}-${index}`}>
        <dt>{IMAGE_METADATA_TAG_LABELS[language][field.key] ?? field.key}</dt><dd>{field.value}</dd>
      </div>)}
    </dl>
  );

  return <div className="operation-result-stack file-info-view">
    <dl className="operation-result-list">
      <div><dt>{text.fileInfo}</dt><dd>{value.name}</dd></div>
      <div><dt>{text.currentLocation}</dt><dd><code title={displayPath(value.absolutePath)}>{displayPath(value.absolutePath)}</code></dd></div>
      <div><dt>{text.type}</dt><dd>{METADATA_KIND_LABELS[language][value.kind] ?? value.kind}</dd></div>
      {value.extension ? <div><dt>{info.extension}</dt><dd>{value.extension}</dd></div> : null}
      {value.mimeType ? <div><dt>MIME</dt><dd>{value.mimeType}</dd></div> : null}
      <div><dt>{directoryStats ? text.directoryFileSize : text.size}</dt>
        <dd title={sizeBytes === null ? undefined : `${sizeBytes.toLocaleString(locale)} B`}>{sizeBytes === null ? '—' : formatBytes(sizeBytes)}</dd></div>
      {directoryStats ? <>
        <div><dt>{text.fileCount}</dt><dd>{directoryStats.fileCount.toLocaleString(locale)}</dd></div>
        <div><dt>{text.directoryCount}</dt><dd>{directoryStats.directoryCount.toLocaleString(locale)}</dd></div>
      </> : null}
      <div><dt>{info.created}</dt><dd>{formatDateTime(value.createdAt) || '—'}</dd></div>
      <div><dt>{text.modified}</dt><dd>{formatDateTime(value.modifiedAt) || '—'}</dd></div>
      <div><dt>{text.permissions}</dt><dd>{value.permissions ?? '—'}</dd></div>
      <div><dt>{info.owner}</dt><dd>{value.owner ?? '—'}</dd></div>
      <div><dt>{info.group}</dt><dd>{value.group ?? '—'}</dd></div>
      <div><dt>{info.readonly}</dt><dd>{value.readonly ? text.yes : text.no}</dd></div>
    </dl>
    {directoryStats ? <p className="operation-muted">{text.directoryScanScope}</p> : null}
    {image ? <section aria-label={info.image}>
      <h4>{info.image}</h4>
      {image.width && image.height ? <dl className="operation-result-list">
        <div><dt>{info.dimensions}</dt><dd>{image.width.toLocaleString(locale)} × {image.height.toLocaleString(locale)} px</dd></div>
      </dl> : null}
      {summaryFields.length ? <><h4>{info.shooting}</h4>{fields(summaryFields)}</> : null}
      {image.exifStatus === 'absent' || (image.exifStatus === 'present' && !summaryFields.length)
        ? <p className="operation-muted">{info.absent}</p> : null}
      {image.exifStatus === 'unreadable' ? <p className="operation-warning">{info.unreadable}</p> : null}
      {image.exifStatus === 'limited' ? <p className="operation-warning">{info.limited}</p> : null}
      {detailFields.length ? <details><summary>{info.details}</summary>{fields(detailFields)}</details> : null}
      {image.truncated ? <p className="operation-muted">{info.truncated}</p> : null}
    </section> : null}
  </div>;
}

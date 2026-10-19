import { displayPath } from '../domain/pathDisplay';
import type { FileMetadata } from '../domain/types';
import { METADATA_KIND_LABELS, OPERATION_DIALOG_TEXT, type SupportedLanguage } from '../i18n-resources';
import { formatBytes } from '../operations/progressPresentation';
import { formatDateTime } from './format';

export const FILE_INFO_TEXT = {
  ko: {
    created: '생성일', owner: '소유자', group: '그룹', readonly: '읽기 전용', extension: '확장자',
    image: '이미지 정보', dimensions: '픽셀 크기', shooting: '촬영 정보', details: '상세 메타데이터',
    absent: '촬영 정보 없음', unreadable: '이미지 메타데이터를 읽을 수 없습니다.',
    limited: '읽기 한도 안에서 메타데이터를 확인하지 못했습니다.',
    truncated: '일부 태그 또는 긴 값은 생략했습니다.',
    loading: '파일 정보를 불러오는 중…', failed: '파일 정보를 불러오지 못했습니다.', retry: '다시 시도',
  },
  en: {
    created: 'Created', owner: 'Owner', group: 'Group', readonly: 'Read-only', extension: 'Extension',
    image: 'Image information', dimensions: 'Pixel dimensions', shooting: 'Camera information', details: 'Detailed metadata',
    absent: 'No camera information', unreadable: 'Unable to read image metadata.',
    limited: 'Metadata could not be found within the read limit.',
    truncated: 'Some tags or long values have been omitted.',
    loading: 'Loading file information…', failed: 'Unable to load file information.', retry: 'Retry',
  },
};

const SUMMARY_KEYS = ['Make', 'Model', 'LensModel', 'DateTimeOriginal', 'OffsetTimeOriginal',
  'ExposureTime', 'FNumber', 'PhotographicSensitivity', 'ISOSpeed', 'FocalLength', 'FocalLengthIn35mmFilm'];

const TAG_LABELS: Record<string, readonly [string, string]> = {
  Make: ['카메라 제조사', 'Camera make'], Model: ['카메라 모델', 'Camera model'], LensModel: ['렌즈 모델', 'Lens model'],
  DateTimeOriginal: ['촬영 시각', 'Date taken'], OffsetTimeOriginal: ['촬영 시간대', 'Capture time zone'],
  ExposureTime: ['셔터 속도', 'Shutter speed'], FNumber: ['조리개', 'Aperture'],
  PhotographicSensitivity: ['ISO 감도', 'ISO'], ISOSpeed: ['ISO 감도', 'ISO'],
  FocalLength: ['초점거리', 'Focal length'], FocalLengthIn35mmFilm: ['35mm 환산 초점거리', '35mm equivalent'],
  ExposureBiasValue: ['노출 보정', 'Exposure compensation'], ExposureProgram: ['노출 프로그램', 'Exposure program'],
  MeteringMode: ['측광 방식', 'Metering mode'], Flash: ['플래시', 'Flash'], WhiteBalance: ['화이트 밸런스', 'White balance'],
  Orientation: ['회전 방향', 'Orientation'], ColorSpace: ['색공간', 'Color space'],
  Artist: ['촬영자', 'Artist'], Copyright: ['저작권', 'Copyright'], ImageDescription: ['설명', 'Description'],
  GPSLatitude: ['위도', 'Latitude'], GPSLatitudeRef: ['위도 방향', 'Latitude reference'],
  GPSLongitude: ['경도', 'Longitude'], GPSLongitudeRef: ['경도 방향', 'Longitude reference'],
  GPSAltitude: ['고도', 'Altitude'], GPSAltitudeRef: ['고도 기준', 'Altitude reference'],
};

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
        <dt>{TAG_LABELS[field.key]?.[language === 'ko' ? 0 : 1] ?? field.key}</dt><dd>{field.value}</dd>
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

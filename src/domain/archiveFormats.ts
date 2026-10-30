// 압축 파일로 다루는 확장자와 형식 이름, 긴 확장자부터 비교.
// Rust `archive_provider::ARCHIVE_FORMATS`와 같은 표, 양쪽 테스트가 `src/tauri/fixtures/archive-formats.json`과 대조.
export const ARCHIVE_FORMATS = [
  { suffix: '.tar.gz', format: 'tar.gz' },
  { suffix: '.tgz', format: 'tar.gz' },
  { suffix: '.tar.zst', format: 'tar.zst' },
  { suffix: '.tzst', format: 'tar.zst' },
  { suffix: '.zip', format: 'zip' },
  { suffix: '.jar', format: 'jar' },
  { suffix: '.war', format: 'war' },
  { suffix: '.tar', format: 'tar' },
  { suffix: '.7z', format: '7z' },
] as const;

export type ArchiveFormat = (typeof ARCHIVE_FORMATS)[number]['format'];

export const ARCHIVE_FILE_SUFFIXES = ARCHIVE_FORMATS.map(({ suffix }) => suffix);

const archiveFormatEntry = (name: string) => {
  const lowered = name.toLowerCase();
  return ARCHIVE_FORMATS.find(({ suffix }) => lowered.endsWith(suffix)) ?? null;
};

export const archiveFileSuffix = (name: string) => archiveFormatEntry(name)?.suffix ?? null;

export const archiveFormatForName = (name: string): ArchiveFormat | null => archiveFormatEntry(name)?.format ?? null;

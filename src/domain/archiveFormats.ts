// 압축 파일로 다루는 확장자. Rust `filesystem::is_archive_path`와 같은 목록 유지, 긴 확장자부터 비교
export const ARCHIVE_FILE_SUFFIXES = ['.tar.gz', '.tar.zst', '.tgz', '.tzst', '.tar', '.zip', '.jar', '.war', '.7z'] as const;

export const archiveFileSuffix = (name: string) => {
  const lowered = name.toLowerCase();
  return ARCHIVE_FILE_SUFFIXES.find((suffix) => lowered.endsWith(suffix)) ?? null;
};

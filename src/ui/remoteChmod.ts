// 원격 권한 표시와 8진수 변환. React·Tauri 의존 없음
export const PERMISSION_BITS = [
  [0o400, 0o200, 0o100],
  [0o040, 0o020, 0o010],
  [0o004, 0o002, 0o001],
] as const;

// `drwxr-xr-x` 같은 목록 권한 문자열의 하위 9비트(특수 비트 미포함)
export const modeFromPermissionText = (text: string | null | undefined): number | null => {
  if (!text || !/^[-dlcbps]?[-r][-w][-xsStT][-r][-w][-xsStT][-r][-w][-xtT]$/.test(text)) return null;
  const bits = text.length === 10 ? text.slice(1) : text;
  return [...bits].reduce((mode, flag, index) => (flag === '-' || flag === 'S' || flag === 'T' ? mode : mode | (1 << (8 - index))), 0);
};

export const parseOctalMode = (text: string): number | null =>
  /^[0-7]{3,4}$/.test(text.trim()) ? Number.parseInt(text.trim(), 8) : null;

export const formatOctalMode = (mode: number) => (mode > 0o777 ? mode.toString(8).padStart(4, '0') : mode.toString(8).padStart(3, '0'));

// 여러 항목의 권한이 모두 같을 때만 초기값으로 사용
export const commonMode = (permissions: ReadonlyArray<string | null>): number | null => {
  const modes = permissions.map(modeFromPermissionText);
  return modes.length > 0 && modes.every((mode) => mode !== null && mode === modes[0]) ? modes[0] : null;
};

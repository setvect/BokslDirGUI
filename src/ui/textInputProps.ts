// 경로·파일 이름·명령·패턴 입력: OS 맞춤법 검사·자동 수정·자동 대문자가 입력값을 바꾸지 않도록 끔
// (macOS WebView는 `renamed-dir`을 `renamed-direct…`처럼 고칠 수 있음)
export const LITERAL_TEXT_INPUT_PROPS = {
  spellCheck: false,
  autoCorrect: 'off',
  autoCapitalize: 'off',
  autoComplete: 'off',
} as const;

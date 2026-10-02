// 공통 프론트엔드 어댑터 밖에서 호출되는 기존 네이티브 명령만 예외로 허용.
export const NATIVE_ONLY_COMMANDS = {
  health_check: '네이티브 상태 확인',
  show_drop_overlay: '드래그 오버레이 전용 호출',
  hide_drop_overlay: '드래그 오버레이 전용 호출',
};

export function validateRustCommands(commandNames: readonly string[], libSource: string, commandSource: string): string[] {
  const errors = [];
  const registration = libSource.match(/tauri::generate_handler!\s*\[([\s\S]*?)\]/)?.[1];
  if (!registration) return ['Rust generate_handler 등록 목록 없음'];
  const entries = registration.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
    .split(',').map((entry) => entry.trim()).filter(Boolean);
  if (entries.some((entry) => !/^commands::\w+$/.test(entry))) errors.push('알 수 없는 Rust 명령 등록 형식');
  const registered = entries.map((entry) => entry.replace(/^commands::/, ''));
  const implementations = [...commandSource.matchAll(/#\[tauri::command(?:\([^)]*\))?\]\s*pub(?:\([^)]*\))?\s+(?:async\s+)?fn\s+(\w+)/g)]
    .map((match) => match[1]);
  const expected = new Set([...commandNames, ...Object.keys(NATIVE_ONLY_COMMANDS)]);
  if (new Set(commandNames).size !== commandNames.length) errors.push('중복 프론트 명령 이름');
  if (new Set(registered).size !== registered.length) errors.push('중복 Rust 명령 등록');
  for (const name of expected) {
    if (!registered.includes(name)) errors.push(`Rust 미등록 명령: ${name}`);
  }
  for (const name of registered) {
    if (!expected.has(name)) errors.push(`분류되지 않은 Rust 명령: ${name}`);
    if (!implementations.includes(name)) errors.push(`Tauri 명령 구현 없음: ${name}`);
  }
  return errors;
}

export interface ParityRequirements {
  tuiActions: readonly {
    tuiId: string;
    implementationStatus: string;
    guiActionIds: readonly string[];
  }[];
  guiOnlyExtensions: readonly { guiActionId: string }[];
}

export const requiredActionIdsFromParity = (requirements: ParityRequirements): string[] => [...new Set([
  ...requirements.tuiActions.filter((row) => row.implementationStatus !== 'excluded')
    .flatMap((row) => row.guiActionIds).filter((id) => !id.startsWith('__ui_motion.')),
  ...requirements.guiOnlyExtensions.map((item) => item.guiActionId),
])];

interface FeatureAction {
  id: string;
  command?: string;
  dialogKind?: string;
}

export function validateFeatureMetadata(
  actions: readonly FeatureAction[],
  commands: readonly string[],
  dialogs: Record<string, { executionMode: string }>,
  requirements: ParityRequirements,
): string[] {
  const errors: string[] = [];
  const ids = new Set(actions.map((action) => action.id));
  const requiredIds = new Set(requiredActionIdsFromParity(requirements));
  if (ids.size !== actions.length) errors.push('중복 액션 ID');
  const tuiIds = requirements.tuiActions.map((row) => row.tuiId);
  if (new Set(tuiIds).size !== tuiIds.length) errors.push('중복 TUI 요구사항 ID');
  for (const id of requiredIds) {
    if (!ids.has(id)) errors.push(`필수 액션 누락: ${id}`);
  }
  for (const row of requirements.tuiActions) {
    if (row.implementationStatus === 'excluded' && row.guiActionIds.length) errors.push(`제외된 요구사항에 GUI 매핑 존재: ${row.tuiId}`);
  }
  for (const action of actions) {
    if (!requiredIds.has(action.id)) errors.push(`요구사항에 없는 액션: ${action.id}`);
    if (action.command && !commands.includes(action.command)) errors.push(`알 수 없는 명령: ${action.id} → ${action.command}`);
    if (action.dialogKind && !Object.hasOwn(dialogs, action.dialogKind)) errors.push(`알 수 없는 다이얼로그: ${action.id} → ${action.dialogKind}`);
  }
  for (const [kind, definition] of Object.entries(dialogs)) {
    if (!['atomicCommand', 'longRunningOperation'].includes(definition.executionMode)) errors.push(`알 수 없는 실행 모드: ${kind}`);
    if (!actions.some((action) => action.dialogKind === kind)) errors.push(`연결 액션이 없는 다이얼로그: ${kind}`);
  }
  return errors;
}

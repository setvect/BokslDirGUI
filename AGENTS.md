# AGENTS.md — BokslDirGUI 작업 지침

이 파일은 `/Users/boksl/IdeaProjects/BokslDirGUI` 전체에 적용된다. 하위 디렉터리에 더 구체적인 `AGENTS.md`가 있으면 그 지침이 우선한다.

## 프로젝트 정체성

- BokslDirGUI는 기존 BokslDir TUI의 기능 동등성을 목표로 하는 GUI 파일 매니저다.
- 기술 스택은 **Tauri 2 + React 19 + TypeScript + Rust**다.
- UX 기준은 일반 웹 페이지가 아니라 **키보드 중심 dual-panel file commander**다.
- 기본 화면은 faithful TUI commander identity를 유지한다.
- 파일 시스템 변경은 Rust command/service 계층에서 검증하고 실행한다.

## 주요 문서 기준

구현 판단은 다음 문서를 우선 참조한다.

- `docs/implementation/README.md` — 구현 설계 문서 인덱스와 완료 기준
- `docs/implementation/tui-parity-map.md` — 기존 TUI 기능 동등성 매핑
- `docs/implementation/action-registry.md` — 메뉴/단축키/컨텍스트 메뉴 공통 액션 모델
- `docs/implementation/tauri-command-api.md` — React↔Rust command/event DTO 계약
- `docs/implementation/file-operation-state-machine.md` — 파일 작업 상태 전이와 안전성
- `docs/implementation/full-scope-test-spec.md` — 전체 기능 검증 전략
- `docs/requirements/` — 주제별 기능 요구사항
- `mockups/clickable-prototype/` — GUI 목업/레이아웃 참고

문서와 코드가 충돌하면 먼저 충돌 근거를 기록하고, 안전한 범위에서는 코드와 문서를 함께 갱신한다.

## 개발 원칙

- 축소 범위/MVP 전제로 구현하지 않는다. 기존 TUI 기반 BokslDir 기능을 모두 포함하는 방향을 유지한다.
- 로직 재사용 자체가 목적이 아니다. GUI/Tauri 구조에 맞는 안전하고 명확한 경계를 우선한다.
- 메뉴, 단축키, 컨텍스트 메뉴, 도움말은 같은 action registry를 기준으로 동작해야 한다.
- 키보드 제어는 웹 기본 동작보다 파일 커맨더 동작을 우선한다.
  - `Tab`: 좌/우 활성 패널 전환
  - `ArrowUp/ArrowDown`, `PageUp/PageDown`, `Home/End`: 파일 row 포커스 이동
  - `Space`: 선택 토글
  - `Enter`: 항목 열기
  - 입력 필드, 다이얼로그, 메뉴, 컨텍스트 메뉴, 네이티브 버튼은 자체 키보드 소유권을 유지한다.
- GUI 변경 시 마우스 동작(클릭, 더블클릭, 우클릭 컨텍스트 메뉴, 드래그 앤 드롭)을 함께 고려한다.
- 파일 변경/삭제/덮어쓰기/쉘 실행 등 위험 작업은 명시 확인, 진행률, 취소, 오류 요약을 포함해야 한다.
- 새 라이브러리는 대중적이고 검증된 라이브러리를 우선하며, 필요성이 문서/코드에서 설명되어야 한다.

## 코드 구조 지침

- `src/actions/` — action registry, 단축키, 메뉴/컨텍스트 액션 계약
- `src/ui/` — React UI, commander shell, 패널, 키보드/마우스 상호작용
- `src/operations/` — 작업 다이얼로그, 진행 상태, 충돌 처리 UI 상태
- `src/tauri/` — 프론트엔드 Tauri command wrapper
- `src-tauri/src/` — Rust command/service 구현
- `scripts/verify-full-scope.mjs` — 전체 범위 스모크/정합성 게이트

권장 사항:

- action ID, command 이름, DTO 타입은 문서와 코드에서 같은 이름을 사용한다.
- display-only shortcut label과 실제 dispatch keyboard binding을 혼동하지 않는다.
- portal 기반 UI(다이얼로그/메뉴/컨텍스트 메뉴)는 commander keyboard owner boundary를 명시한다.
- 샘플 데이터/스텁은 실제 파일 변경과 혼동되지 않게 표시한다.

## 검증 명령

변경 규모에 따라 최소 검증을 선택하되, 완료 주장 전에는 fresh evidence를 확보한다.

- 타입 검사: `npm run typecheck`
- 프론트 테스트: `npm test`
- Rust 검사: `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust 테스트: `npm run rust:test`
- 전체 스모크: `npm run verify:scope`
- 전체 검증: `npm run verify`

키보드/액션 변경 시 우선 실행:

```sh
npx vitest run src/actions/registry.test.ts src/ui/CommanderShell.test.tsx
```

커밋 전 권장:

```sh
git diff --check
npm run verify
```

## 문서 작성 규칙

- 사용자를 향한 문서와 프로젝트 설명은 기본적으로 한국어로 작성한다.
- 설계 문서에는 “MVP” 같은 축소 범위 표현을 사용하지 않는다.
- 요구사항 문서는 주제별로 분리하고, 인덱스 문서에서 링크한다.
- 목업/프로토타입 관련 결정은 구현 설계 문서 또는 목업 README에 출처를 남긴다.

## Git / 커밋 규칙

- 사용자가 명시적으로 요청하지 않으면 커밋하지 않는다.
- 커밋 전 `git status --short`로 의도하지 않은 파일이 포함되지 않았는지 확인한다.
- 커밋 메시지는 **한글로 작성해야 한다.**
- 상위 지침의 Lore Commit Protocol 형식은 유지한다.
  - 첫 줄의 의도 설명은 한글로 쓴다.
  - 본문과 trailer 값도 한글로 쓴다.
  - `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, `Not-tested:` 같은 trailer 키는 프로토콜 호환을 위해 영문 키를 유지할 수 있다.

예시:

```text
키보드 중심 파일 커맨더 조작을 보장하기 위해 입력 경계를 정리

Constraint: 웹 기본 포커스 이동보다 기존 TUI 파일 커맨더 조작감이 우선이다
Confidence: 높음
Scope-risk: 보통
Tested: npm run verify
Not-tested: 실제 운영 파일 시스템 변경 작업
```

## 완료 보고

최종 보고에는 다음을 간단히 포함한다.

- 변경한 주요 파일
- 사용자 요청이 어떻게 반영되었는지
- 실행한 검증 명령과 결과
- 남은 위험 또는 후속 작업

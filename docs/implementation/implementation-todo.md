# BokslDirGUI 구현 TODO 계획서

- 상태: RALPLAN approved (2026-06-13)
- 기준: 기존 TUI BokslDir 기능 동등성 + GUI 전환 필수 기능
- 범위: 현재 구현 완료 내용을 포함한 전체 구현 TODO
- 원본 계획: `.omx/plans/boksldirgui-implementation-todo-20260613T124809Z.md`
- 비목표: 축소 범위 구현, MVP 표현, 검증 없는 실제 파일 변경 연결

## RALPLAN-DR 요약

### Principles

1. **파일 안전성 우선**: 실제 파일 변경은 Rust command/service 계층에서 검증·실행하고, UI는 상태/확인/오류 표시를 담당한다.
2. **TUI commander 정체성 유지**: 키보드 중심 dual-panel 조작감, dense row, bottom hotkey strip, overlay dialog 흐름을 유지한다.
3. **Action registry 단일 기준**: 메뉴, 단축키, 컨텍스트 메뉴, 도움말, enablement는 같은 registry/selector를 공유한다.
4. **작업 상태는 관찰 가능해야 함**: 장시간 작업은 진행률, 취소, 충돌 처리, 오류 요약, 완료 요약을 제공한다.
5. **검증 가능한 단계로 연결**: 각 구현 단위는 TypeScript/Rust 테스트, full-scope smoke, 실제 임시 fixture 검증으로 완료 판정한다.

### Decision Drivers

1. 실제 파일 조작의 데이터 손실 방지와 복구 가능한 오류 처리.
2. 기존 TUI 기능 동등성 누락 방지.
3. Tauri/React/Rust 경계의 장기 유지보수성.
4. 현재 stub contract(`BACKEND_IMPLEMENTED_COMMANDS`, `backendExecutionStubbed`, `confirmDialog`)에서 실제 실행 contract로 넘어가는 seam의 명확성.

### Viable Options

#### Option A — 안전한 기능 축 순차 구현

- 장점: 읽기 전용 탐색 → safe mutation → destructive operation → archive/external 순서로 위험을 제어하기 쉽다.
- 단점: 전체 기능 완성까지 시간이 더 걸리며, 중간 기간에는 일부 UI가 stub 상태로 남는다.

#### Option B — backend command 전체를 먼저 skeleton으로 등록

- 장점: frontend wrapper와 Rust handler 이름 drift를 빠르게 줄일 수 있다.
- 단점: 실제 검증/상태/충돌 처리가 없는 handler가 생기면 “동작하는 것처럼 보이는 위험한 기능”이 될 수 있다.

#### Chosen direction

- **Option A를 기본으로 한다.** 실제 파일 변경 기능은 안전성/테스트/상태 모델을 갖춘 순서로 연결한다.
- Option B는 각 command가 명시적으로 unsupported 또는 dry-run임을 보장하는 경우에만 보조적으로 사용한다.
- 실제 구현 전환은 두 seam을 먼저 둔다.
  1. **Panel-state seam**: listing/history/sort/filter/selection/focus를 sample fixture에서 분리한다.
  2. **Command capability seam**: frontend whitelist와 Rust handler 등록 상태를 매 단계 동기화하거나 backend capability source of truth로 대체한다.

## 0. 현재 구현 완료 현황

### 0.1 프로젝트/문서/작업 규칙

- [x] Tauri 2 + React 19 + TypeScript + Rust 기반 프로젝트 scaffold 구성.
- [x] `docs/requirements/` 주제별 요구사항 문서 구성.
- [x] `docs/implementation/` 설계 문서 인덱스와 세부 설계 문서 구성.
- [x] clickable prototype/mockup reference 구성.
- [x] `README.md`에 실행 방법 작성.
- [x] `.gitignore`와 `temp/` 제외 설정.
- [x] `AGENTS.md` 추가: 프로젝트 지침, 검증 명령, 커밋 메시지 한글 규칙.

### 0.2 GUI shell / commander UX

- [x] faithful TUI commander 방향의 dual-panel shell 구현.
- [x] persistent sidebar/inspector/large toolbar 제거 방향 반영.
- [x] dense file row, panel header/path controls/bottom status/hotkey strip 구성.
- [x] sample fixture 기반 좌/우 패널 파일 목록 표시.
- [x] 클릭, 더블클릭, 우클릭 컨텍스트 메뉴 shell 구현.
- [x] Radix Dialog/Popover/ContextMenu 기반 overlay shell 구현.

### 0.3 키보드 중심 제어

- [x] `Tab`으로 활성 패널 전환.
- [x] `ArrowUp/ArrowDown`, `PageUp/PageDown`, `Home/End`로 focused row 이동.
- [x] TUI/Vim 계열 이동키(`j/k`, `gg`, `G`, `Ctrl+U`, `Ctrl+D`)로 focused row 이동.
- [x] `Space`로 선택 토글 후 TUI처럼 다음 row 이동, `..` row는 선택하지 않고 아래로 이동.
- [x] `Shift+ArrowUp/ArrowDown`, `Shift+PageUp/PageDown`, `Shift+Home/End`, Shift-click으로 범위 선택.
- [x] `Enter`로 focused entry open preview.
- [x] action registry 기반 단축키 dispatch 구현.
- [x] 한글 IME 입력 상태에서도 물리 키 기준 단축키 dispatch.
- [x] display-only `shortcutLabel`과 executable `keyboardBindings` 분리.
- [x] prefix sequence shortcut 처리(`t b` vs `t b a`)와 timeout disambiguation 구현.
- [x] 입력 필드, 다이얼로그, 메뉴, 컨텍스트 메뉴, native control의 keyboard ownership 보호.
- [x] ref-counted keyboard owner boundary helper 구현.
- [x] `Cmd/Ctrl +`, `Cmd/Ctrl -`, `Cmd/Ctrl 0`로 글자/행 높이/여백/status/hotkey strip을 함께 조정하고 `Settings.view.zoomStep`으로 저장.
- [x] 확대 배율은 `75/80/90/100/110/125/150/175/200%` preset으로 표시하고, 확대 시 metadata는 실제 항목 길이를 반영해 잘라 표시하지 않고 낮은 우선순위 컬럼부터 숨긴다. header/body는 같은 panel-level grid template을 공유하고, dual-panel에서는 파일명 폭을 우선 보존한다.
- [x] 긴 파일명은 Unicode-safe middle ellipsis로 suffix/확장자를 보존하고, row hover/focus 정보로 전체 파일 정보를 제공한다.

### 0.4 Action / operation shell

- [x] parity-critical action ID 등록.
- [x] 메뉴 root와 hotkey strip을 registry에서 파생. hotkey strip은 화면 폭/확대 배율에 따라 핵심 단축키부터 가능한 만큼 표시한다.
- [x] context menu action enablement와 virtual parent row 보호.
- [x] 선택 항목이 없을 때 focused concrete row를 복사/이동/삭제/압축 effective target으로 사용하는 TUI fallback 구현.
- [x] filter 적용 상태를 panel header/status/bottom status에 표시하고 파일명 매칭 구간 highlight 구현.
- [x] 복사/이동/삭제/이름변경/폴더생성/압축/external/shell command 다이얼로그 shell 구성.
- [x] operation state union, transition table, conflict decision model skeleton 구성.
- [x] 실제 backend 미연결 작업은 `backendExecutionStubbed`로 표시.

### 0.5 Tauri/Rust read-only backend

- [x] typed Tauri client wrapper와 `TauriResult`/error normalization 구성.
- [x] unsupported command boundary 구성.
- [x] Rust command 구현: `list_dir`, `goto_path`, `get_metadata`, `watch_path`, `list_locations`.
- [x] Rust path canonicalization, hidden file filtering, sorting, metadata, parent virtual row 구현.
- [x] Rust read-only tests 구성.

### 0.6 검증

- [x] TypeScript/Vitest 테스트 기반 구축.
- [x] Rust unit tests 구축.
- [x] `scripts/verify-full-scope.mjs` smoke gate 구성.
- [x] 최근 전체 검증 `npm run verify` 통과.
- [x] 최근 독립 review gate: code-reviewer APPROVE, architect CLEAR.

## 1. 실제 파일 탐색 연결 TODO

> 구현 메모(2026-06-13): `src/ui/panelState.ts`와 `src/ui/panelDataSource.ts`로 panel state/provider seam을 분리했고, `CommanderShell`은 provider 기반 `listDir`/`gotoPath` 경로를 사용한다. `operationStore`는 `atomicCommand`와 `longRunningOperation` 실행 모드를 분리했다. 회귀 검증은 `src/ui/CommanderShell.test.tsx`, `src/operations/operationStore.test.ts`, `src/verification/fullScope.test.ts`, `scripts/verify-full-scope.mjs`에서 담당한다.

### 1.0 선행 seam 정리

- [x] Panel-state abstraction을 도입한다.
  - 내용: panel별 `path`, `listing`, `focusedIndex`, `selectedPaths`, `historyBack`, `historyForward`, `sort`, `filter`, `showHidden`, `loading`, `error`를 묶는 store/hook을 만든다.
  - Acceptance: `CommanderShell`의 핵심 렌더링이 `SAMPLE_LISTINGS` 직접 참조 대신 panel state provider를 통해 동작한다.
  - Tests: fixture-backed provider와 mocked Tauri-backed provider를 같은 UI 테스트에서 교체 가능해야 한다.
- [x] Command capability seam을 도입한다.
  - 내용: `BACKEND_IMPLEMENTED_COMMANDS`를 새 command 구현마다 갱신하는 규칙을 문서화하고, 가능하면 Rust/backend capability를 단일 source of truth로 노출하는 방향을 검토한다.
  - Acceptance: 실제 Rust handler가 등록되지 않은 command는 계속 `unsupported`로 보이고, 등록된 command만 UI에서 실제 실행 path를 탄다.
  - Tests: `src/tauri/client.test.ts`와 `src/verification/fullScope.test.ts`가 command별 implemented/unsupported 상태를 검증한다.
- [x] Dialog 실행 경로를 atomic command와 long-running operation으로 분리한다.
  - Atomic command: `create_dir`, `rename_entry`, `get_metadata`, `open_default`, `reveal_in_manager`, `load_settings`, `save_settings`처럼 request/response 후 panel refresh 또는 dialog update로 끝나는 작업.
  - Long-running operation: `start_copy`, `start_move`, `start_delete`, `archive_create`, `archive_extract`처럼 progress/cancel/conflict event가 필요한 작업.
  - Acceptance: `operationStore.confirmDialog()`가 모든 dialog를 queued progress로 처리하지 않고, dialog kind별 실행 adapter를 선택한다.

### 1.1 sample fixture 제거와 real listing 연결

- [x] `CommanderShell` panel state를 `SAMPLE_LISTINGS` 의존에서 panel-state abstraction + `tauriClient.listDir` 기반 async state로 전환한다.
  - Acceptance: 앱 시작 시 좌/우 panel이 실제 기본 경로를 표시한다.
  - Acceptance: loading/error/empty 상태가 panel 내부에 표시된다.
  - Tests: mocked `tauriClient.listDir`로 panel render, error, empty state 검증.
- [x] directory entry `Enter`/double-click이 실제 `listDir` 호출로 진입하도록 연결한다.
  - Contract: entry open은 현재 panel의 `sort/filter/showHidden` 상태를 유지한 `list_dir` 흐름을 사용한다.
  - Acceptance: 디렉터리 진입 후 path bar, row list, active descendant가 갱신된다.
  - Tests: user-event Enter/double-click integration test.
- [x] `..` virtual parent row가 실제 parent navigation으로 동작하되 파일 작업 target에서는 계속 차단되게 한다.
  - Acceptance: parent row open은 navigation, copy/delete/rename 대상은 불가.
  - Tests: virtual row action filtering regression.

### 1.2 panel navigation state

- [x] `goto_path` 계약을 명시적으로 정리한다.
  - 결정: `goto_path`는 주소 입력/북마크/히스토리 직접 이동용 command로 유지하되, panel state(`sort/filter/showHidden`) 보존이 필요한 entry open/refresh는 `list_dir`를 사용한다.
  - 후속 후보: UX상 직접 이동에서도 sort/filter/showHidden 보존이 필요하면 `goto_path` DTO를 `ListDirInput`과 동등하게 확장한다.
  - Tests: `goto_path`가 상태 reset을 유발하는 경로와 `list_dir` 상태 보존 경로를 구분해 검증한다.
- [x] panel별 history back/forward stack 구현.
- [x] `Alt+Left`, `Alt+Right`, `Backspace/h`, refresh를 실제 panel navigation에 연결.
- [x] sort/filter/showHidden 상태를 panel state로 관리하고 `list_dir` 인자로 전달.
- [x] watcher 또는 manual refresh 후 focused row/selection 보존 정책 구현.
- [x] `goto_path` 직접 입력 overlay와 `list_locations` 위치 palette를 실제 이동 흐름에 연결.

## 2. Safe mutation TODO — create/rename부터 연결

> 구현 메모(2026-06-13): `create_dir`와 `rename_entry`를 Rust command로 등록했고, frontend `BACKEND_IMPLEMENTED_COMMANDS`와 CommanderShell atomic executor 경로를 연결했다. create/rename 다이얼로그는 이름 입력과 client-side validation을 제공하며, Rust command는 parent/source validation, child name validation, overwrite 차단을 최종 검증한다. `rename_entry`는 symlink target이 아니라 화면에 보이는 source entry 자체를 rename하며, 지원 OS에서는 no-replace rename primitive로 overwrite race를 줄인다. 성공 후 active panel을 refresh하고 새/변경 항목에 focus를 맞춘다.

### 2.1 `create_dir`

- [x] Rust `create_dir` command 구현: parent canonicalization, invalid name 차단, existing path 충돌 처리.
- [x] `tauriClient.BACKEND_IMPLEMENTED_COMMANDS` 또는 command capability source of truth에 `create_dir` 추가.
- [x] `OperationDialogHost`/`operationStore`에서 createDir를 atomic command path로 실행하고 성공 후 panel refresh를 호출한다.
- [x] Create Directory dialog에 이름 입력 field와 validation 표시 추가.
- [x] 성공 후 active panel refresh 및 새 폴더 focused row 이동.
- [x] 실패 시 recoverable AppError 표시.
- [x] Tests: Rust temp fixture create success/existing/invalid-name; React dialog validation; full-scope command alignment.

### 2.2 `rename_entry`

- [x] Rust `rename_entry` command 구현: 같은 parent 내 rename, cross-volume move 금지, overwrite 금지 기본값.
- [x] `tauriClient.BACKEND_IMPLEMENTED_COMMANDS` 또는 command capability source of truth에 `rename_entry` 추가.
- [x] `OperationDialogHost`/`operationStore`에서 rename을 atomic command path로 실행하고 성공 후 panel refresh를 호출한다.
- [x] Rename dialog에 새 이름 입력 field와 중복/invalid validation 표시 추가.
- [x] 성공 후 panel refresh 및 renamed row focus 유지.
- [x] Tests: Rust rename success/existing/invalid/virtual-target 차단; React dialog flow.

## 3. 장시간 파일 작업 TODO — copy/move/delete/trash

상태: 2026-06-13 구현 반영. copy/move/delete/trash는 Rust operation service와 Tauri event stream으로 연결했다. archive create/extract는 같은 long-running dialog 모델을 유지하되 실제 압축 구현은 5번 archive TODO에서 별도 완료한다.

### 3.1 operation backend architecture

- [x] Long-running operation 전용 adapter를 atomic command path와 분리한다.
  - Acceptance: copy/move/delete/trash는 operation service를 사용하고, create/rename은 request/response atomic command path를 사용한다. archive는 long-running dialog 모델만 유지하고 실제 service 연결은 archive TODO에서 처리한다.
- [x] Rust operation service 설계/구현: operation id, background worker handoff, queued/running/progress state, cancellation token registry, conflict prompt wait/resolve channel.
- [x] Tauri event contract 추가: `operation_progress`, `operation_conflict`, `operation_summary`(`operation_completed` 호환 event도 emit).
- [x] frontend operation store가 실제 event stream을 구독하도록 연결.
- [x] `OperationState` 전이가 실제 backend state와 일치하도록 정합성 테스트 추가.

### 3.2 `start_copy`

- [x] Rust recursive copy 구현: file/dir/symlink 정책 명시, metadata preservation은 현재 파일 내용/디렉터리/Unix symlink entry 보존 범위로 제한.
- [x] conflict decision `skip/overwrite/allSkip/allOverwrite/cancel` 적용.
- [x] progress bytes/files 계산과 cancel 처리.
- [x] Tests: temp fixture copy file/dir/conflict/cancel; UI progress/conflict flow.

### 3.3 `start_move`

- [x] same filesystem rename fast-path와 cross-device copy+delete fallback 정책 구현.
- [x] move conflict/cancel/partial failure summary 구현.
- [x] Tests: move file/dir/conflict/cancel; cross-device는 error classifier로 fallback 정책 검증.

### 3.4 `start_delete` / trash / permanent delete

- [x] Trash 구현 dependency 결정: 새 dependency 없이 OS별 safe trash directory adapter를 우선 사용하고, 테스트는 `BOKSLDIRGUI_TRASH_DIR` fixture로 격리한다.
- [x] `trash` mode는 휴지통 실패 시 permanent delete로 자동 전환하지 않는다.
- [x] `permanent` mode는 기본 취소, 사용자 입력 확인 문구와 명시 confirm token(`PERMANENT_DELETE`), 대상 guard를 요구한다.
- [x] Tests: trash success/failure policy, permanent confirm required, virtual/system path guard.

## 4. Properties / external integration TODO

상태: 2026-06-14 구현 반영. properties/external integration은 Rust command와 React atomic dialog 경로에 연결했다. 외부 앱 실행은 테스트 격리를 위해 `BOKSLDIRGUI_EXTERNAL_DRY_RUN` dry-run 경계를 제공한다.

- [x] `file.properties`를 실제 `get_metadata` 결과 dialog로 연결.
- [x] `open_default` command 구현: OS별 기본 앱 열기, 실패 메시지 정규화.
- [x] `reveal_in_manager` command 구현: Finder/Explorer/file manager reveal.
- [x] `open_external_editor` command 구현: 설정된 editor id/path 정책, 명시 확인.
- [x] Tests: command wrapper, OS abstraction dry-run, UI error/result handling.

## 5. Archive / 7z TODO

상태: 2026-07-12 구현 반영. archive provider는 새 dependency 없이 검증된 OS 외부 도구(`zip`/`unzip`, `tar`, `7zz` 또는 `7z`)를 호출한다. 필수 형식, zip/7z 암호, 대형 목록 제한, 읽기 전용 가상 패널 정책을 검증한다.

- [x] archive provider 전략 확정: external adapter(`zip`/`unzip`/`tar`/`7z`)를 사용한다.
- [x] `archive_list`는 읽기 전용 atomic command로 분리하고, create/extract/add만 long-running operation service에 연결한다.
- [x] `archive_list` 구현: password 필요/unsupported format/provider unavailable 오류를 typed error로 반환한다.
- [x] `archive_extract` 구현: zip-slip 차단, target canonicalization, conflict decision 적용.
- [x] `archive_create` 구현: format/password 정책, progress/cancel, 같은 parent 내 상대 entry name 생성.
- [x] 필수 형식 fixture gate 구축: zip/jar/war/tar/tar.gz/tgz/tar.zst/tzst/7z list/extract/create round-trip과 malicious path guard.
- [x] Tests: Rust provider unit/integration, UI 가상 디렉터리 탐색/extract/create/add flow.
- [x] 조건부 7z binary fixture gate 추가: `7zz/7z` provider가 있는 환경에서는 실제 `.7z` 생성 후 listing을 검증하고, provider가 없으면 안전하게 skip한다.
- [x] password archive 정책 검증: zip/7z 생성·목록·해제를 지원하고 masked input과 summary/history/error 비노출을 테스트로 고정한다. jar/war/tar 계열 암호는 typed unsupported로 처리한다.
- [x] 대형 archive listing은 기본 50,000개/최대 200,000개로 제한하고 `totalEntries`/`truncated`와 패널 안내를 제공한다.
- [x] 압축 가상 디렉터리는 읽기 전용으로 고정하고 copy-in/copy-out 외 move/delete/rename/create-dir을 비활성화한다.

## 6. Bookmarks / history / tabs / layout TODO

상태: 2026-06-14 구현 반영. settings는 Rust JSON persistence로 연결했고, bookmark/history/tabs/layout은 action registry 기반 UI state와 settings 저장 경로를 사용한다.

- [x] `load_settings/save_settings` Rust command 구현.
- [x] bookmarks add/list/rename/delete 실제 settings persistence 연결.
- [x] navigation history UI와 `history.list` overlay 구현.
- [x] tab.new/tab.close panel tab state 구현.
- [x] `tt` tab list overlay를 구현하고 선택 시 해당 tab path로 이동한다.
- [x] single/dual panel toggle, ratio 50:50/70:30/30:70 layout state 구현.
- [x] Tests: settings persistence, bookmark/history action, layout regression.

## 7. Drag and drop / mouse GUI 기능 TODO

상태: 2026-06-14 구현 반영. row drag source와 panel drop handler를 구현했다. 기본 drop은 copy, `Shift` modifier drop은 move로 해석한다. 외부 파일 drop은 Tauri/WebView가 OS absolute path를 노출한 경우에만 import copy dialog로 연결하고, 경로가 확인되지 않으면 recoverable 안내로 차단한다.

- [x] row drag source 모델 구현.
- [x] panel-to-panel drag copy/move 의도 결정 modifier 정책 구현.
- [x] external file drop/import 정책 결정: OS absolute path가 확인된 파일만 target panel로 copy import하고, 확인 불가 파일은 차단한다.
- [x] drop target hover/forbidden target 기본 UI 구현.
- [x] Tests: component-level handler tests.
- [x] 후속 강화: 외부 파일 import는 기존 copy operation dialog/충돌 정책을 재사용해 안전 확인 후 실행한다.

## 8. Shell command TODO — 기본 비활성 유지

상태: 2026-06-14 구현 반영. shell command는 기본 disabled이며, settings에서 활성화된 경우에만 `prepare_shell_command`가 one-shot confirm token을 발급한다. 실행은 shell interpolation 없이 command/args 배열로 제한한다.

- [x] shell command settings gate 구현: 기본 disabled.
- [x] `prepare_shell_command` 구현: workingDir canonicalization, command parsing, fingerprint, confirmToken expiry.
- [x] `run_shell_command` 구현은 confirmToken 검증 후 제한된 정책에서만 실행.
- [x] stdout/stderr/result summary UI 구현.
- [x] Tests: disabled policy, one-shot token, command allow, no shell interpolation.
- [x] token clock abstraction과 deterministic TTL expiry test 추가.

## 9. 품질/보안/접근성 TODO

- [x] CSP와 Tauri capability 정책을 실제 command surface에 맞춰 재검토.
- [x] destructive action audit log 또는 local operation history 설계: `operationHistory` bounded local history로 구현.
- [x] keyboard shortcut help dialog를 registry에서 자동 생성.
- [x] ARIA semantics 재점검: application role, activedescendant, table/row semantics, dialog labels.
- [x] 대량 디렉터리 성능 검증: React virtualization 유지, Rust pagination은 후속 대량 fixture 결과에 따라 판단.
- [x] i18n 메시지 key와 한국어/영어 resource 정리.

## 10. 검증/완료 게이트 TODO

- [x] `verify:scope`를 문자열 smoke에서 가능한 범위의 semantic import/assertion으로 점진 강화.
- [x] Rust temp fixture 기반 실제 파일 작업 integration tests 추가.
- [x] frontend mocked Tauri client integration tests 추가.
- [x] destructive operation은 임시 디렉터리 fixture에서만 실행하는 e2e smoke 추가.
- [x] 전체 완료 전 `npm run verify`, Rust tests, full-scope smoke를 통과한다.
- [ ] 최종 독립 code review/architecture review는 Codex native subagent 실행 권한이 있는 세션에서 수행한다.

## 권장 실행 순서

1. **Seam 정리**: panel-state abstraction, command capability seam, atomic-vs-long-running 실행 adapter를 먼저 만든다.
2. **Real listing 연결**: sample fixture 의존을 걷어내고 읽기 전용 탐색을 실제 파일 시스템에 연결한다.
3. **Safe mutation 연결**: `create_dir`, `rename_entry`를 atomic command path로 먼저 실제 command 구현한다.
4. **Operation service 구축**: copy/move/delete/trash를 위한 progress/cancel/conflict event 모델을 완성한다.
5. **Copy/move/delete 구현**: destructive 안전장치와 임시 fixture tests를 갖춘 뒤 연결한다.
6. **External/properties/archive/settings 확장**: 시스템 연동과 7z provider는 각각 fixture gate를 통과한 뒤 완료 처리한다.
7. **GUI 고도화**: drag/drop, tabs/layout, shortcut help, 접근성/성능 점검을 마무리한다.

## ADR

- Decision: 실제 파일 커맨드 구현은 seam 정리(panel-state/capability/실행 adapter) → read-only 탐색 → safe atomic mutation → long-running destructive operation → archive/external/settings 순서로 진행한다.
- Drivers: 데이터 손실 방지, TUI 기능 동등성, Tauri command boundary 정합성, 검증 가능성.
- Alternatives considered:
  - 모든 backend command skeleton 선등록: 빠르지만 안전성 없는 실제 기능처럼 보일 위험이 있어 기본안에서 제외한다.
  - UI만 먼저 확장: 기존 stub 상태가 길어져 실제 파일 매니저 완성도가 지연되므로 보조 작업으로만 둔다.
- Why chosen: 위험도가 낮은 기능부터 실제 command를 연결하면 검증과 사용자 신뢰를 쌓으면서 destructive 작업으로 확장할 수 있다.
- Consequences: 일부 dialog/action은 단계적으로 stub에서 실제 실행으로 전환된다. 각 전환은 tests와 `BACKEND_IMPLEMENTED_COMMANDS` 또는 command capability source of truth 갱신을 동반해야 한다. Atomic command와 long-running operation은 서로 다른 실행 adapter를 유지해야 한다.
- Follow-ups: dependency 검토(trash, watcher, archive provider), real listing integration plan, operation service 상세 설계.

## 실행 lane 제안

- 기본 후속: `$ultragoal` — 위 TODO를 순차 goal로 분해해 ledger/checkpoint 기반으로 진행.
- 병렬 후속: `$ultragoal` + `$team` — Rust operation service, React panel state, tests를 분리해 병렬 구현.
- fallback: `$ralph` — 단일 owner가 한 기능 축을 끝까지 밀어야 할 때만 명시적으로 선택.

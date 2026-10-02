# 설계 문서 정합성 검토 보고서

- 현재 상태 보정(2026-10-03): 사용자 요청으로 터미널 편집기와 전용 설정 제거, 아래 과거 구현·검토 기록 보존. 현재 범위는 [동등성 매핑](tui-parity-matrix.md) 참조


**VERDICT: PASS — 현재 확인된 상충 없음.**

- 상태: RALPLAN approved (2026-06-13)
- 검토 대상: 구현 설계 문서 세트 8개
- 기준: 기존 TUI 기능 동등성, Tauri/React/Rust 아키텍처, faithful TUI commander visual direction
- 최종 검증일: 2026-06-13
- 현재 구현 참고(2026-09-27): 현재 경로 기준 북마크 삭제 메뉴 제거, 북마크 목록의 항목별 삭제로 대체

## 1. 용어 정합성

| 용어 | 사용 문서 | 판정 |
| --- | --- | --- |
| 기존 TUI 기능 동등성 | 전체 | 일관됨 |
| 기준 기능 | scope/test/library stage | 일관됨 |
| GUI 전환 필수 기능 | baseline/parity | 일관됨 |
| 후속 검토 | baseline/index | 일관됨 |
| 축소 구현 기준 | 전체 설계 문서 | 사용 금지, 발견 없음 |

## 2. 범위 정합성

| 항목 | parity map | baseline | command API | component | test spec | 판정 |
| --- | --- | --- | --- | --- | --- | --- |
| 듀얼 패널 | 포함 | 포함 | list/watch | FilePanel | 포함 | 일치 |
| 선택/정렬/필터 | 포함 | 포함 | list_dir/filter | FileTable | 포함 | 일치 |
| 복사/이동/삭제 | 포함 | 포함 | start_* | OperationDialog | 포함 | 일치 |
| 충돌/진행률/취소 | 포함 | 포함 | events/resolve | dialogs/store | 포함 | 일치 |
| 압축/7z | 포함 | 검증 게이트 | archive_* | ArchiveDialog | fixture gate | 일치 |
| 단축키/메뉴/도움말 | 포함 | 포함 | 일부 command | action registry | 정합성 테스트 | 일치 |
| 기본 화면 identity | 포함 | 불변 조건 | 해당 없음 | layout rule | visual/e2e | 일치 |

## 3. 발견된 잠재 충돌과 해소

| 잠재 충돌 | 원인 | 해소 방식 |
| --- | --- | --- |
| GUI 확장 기능으로 기본 화면 복잡화 가능 | sidebar/preview/queue 요구 | 기본 persistent가 아니라 overlay/collapsed로 제한 |
| 7z는 기준 기능이지만 provider 성숙도 리스크가 있음 | sevenz-rust2 검증 필요 | 기준 기능-검증 게이트로 분류, 실패 시 fallback ADR |
| 외부 에디터/명령 실행은 TUI 기능이지만 보안 위험 | 외부 process 실행 | 기본 비활성/명시 확인/설정 기반 실행, shell command는 backend 발급 TTL/one-shot `confirmToken` 재검증 |
| 키보드 단축키와 텍스트 입력 충돌 | single-key shortcut | text input/edit mode에서 단축키 비활성 |
| 메뉴/컨텍스트/도움말 중복 정의 위험 | UI 경로가 많음 | action registry를 단일 source of truth로 지정 |
| conflict decision 명칭 drift | API/state/test가 각각 all/applyAll을 다르게 표현 가능 | `ConflictDecision = overwrite | skip | allOverwrite | allSkip | cancel`로 통일 |
| 외부 에디터 action 누락 | API/parity에는 있으나 action registry에서 빠질 수 있음 | `external.openEditor`를 action registry에 추가하고 `open_external_editor`에 연결 |

## 4. Action Coverage Matrix

| 기능군 | 대표 action IDs | Command/store path | Component owner | Test assertion | 판정 |
| --- | --- | --- | --- | --- | --- |
| 탐색/경로 | `nav.enter`, `nav.up`, `nav.back`, `nav.forward`, `nav.gotoPath`, `nav.locations` | `list_dir`, `goto_path`, `list_locations` | `PathControls`, `FilePanel` | 탐색/패널 시나리오 | 일치 |
| 탭/레이아웃 | `tab.new`, `tab.close`, `layout.toggleSingleDual`, ratio actions | UI state | `TabStrip`, `DualPanelLayout` | single/dual + ratio | 일치 |
| 선택 | `selection.toggle`, `selection.all`, `selection.invert`, `selection.clear` | UI state | `FileTable` | 선택 시나리오 | 일치 |
| 정렬/필터/숨김 | `view.sortName`, `view.sortSize`, `view.sortDate`, `view.sortExt`, `view.reverseSort`, `filter.start`, `filter.clear`, `view.toggleHidden` | `list_dir` + UI state | `FileTable` | action coverage 검사 | 일치 |
| 파일 작업 | `file.copy`, `file.move`, `file.trash`, `file.deletePermanent`, `file.mkdir`, `file.rename` | `start_*`, `create_dir`, `rename_entry` | `OperationDialog` | 파일 작업 fixture | 일치 |
| 압축 | `archive.list`, `archive.extract`, `archive.create` | `archive_*` | 패널 가상 디렉터리 + 작업 다이얼로그 | archive fixture | 일치 |
| 북마크/히스토리 | `nav.back`, `nav.forward`, `history.list`, `bookmark.add`, `bookmark.list`, `bookmark.rename`, `bookmark.delete` | UI/settings store | `HistoryPopover`, `BookmarkDialog` | 탭/히스토리/북마크 | 일치 |
| 외부 연동 | `external.openDefault`, `external.reveal`, `external.openEditor`, `external.runShellCommand` | `open_default`, `reveal_in_manager`, `open_external_editor`, `prepare_shell_command` → `run_shell_command` | `ContextMenuLayer`, `ExternalOpenDialog`, `ShellCommandDialog` | 외부 연동 시나리오 | 일치 |
| 설정/도움말 | `settings.theme`, `settings.language`, `settings.sizeFormat`, `help.shortcuts`, `help.search`, `help.about` | settings/UI state | `SettingsDialog`, `HelpDialog` | action coverage 검사 | 일치 |

## 5. 누락 점검

- TUI parity map의 기준 기능은 full-scope-baseline에 모두 반영됨
- full-scope-baseline의 파일 작업은 command API와 state machine에 반영됨
- component-design의 OperationDialog/ArchiveDialog/ContextMenuLayer/ExternalOpenDialog는 command API 또는 action registry와 연결됨
- test spec은 각 설계 문서의 불변 조건을 검증 항목으로 포함함

## 6. 공개 문서 동기화 승인 기준

- Architect와 Critic이 순차 승인한 뒤에만 `.omx/plans` 초안을 `docs/design`/`docs/implementation`으로 복사
- 공개 반영 전 금지 표현, README 링크, action-command-component-test coverage, `ConflictDecision` enum 통일을 재검사
- 공개 문서에는 RALPLAN draft 상태가 아닌 approved 상태와 최종 검증일 반영

## 7. Machine-check Checklist

- 공개 문서 동기화 전 다음 자동/수동 체크 수행

- action registry 밖에서 참조된 action ID가 registry에 존재하는지 검사
- command API 표 밖에서 참조된 command name이 command table에 존재하는지 검사
- component-design 밖에서 참조된 component owner가 컴포넌트 트리에 존재하는지 검사
- `prepare_shell_command` → `run_shell_command` shell 실행 흐름과 `confirmToken` 보안 조건이 API/test/report에서 같은 이름으로 연결되는지 검사

## 8. 결론

- Architect 1차 검토에서 발견된 외부 에디터 action 누락, conflict decision 명칭 불일치, 테스트 범위 누락 반영 완료
- Critic 1차 검토에서 발견된 parity-critical action coverage와 외부 shell command 누락도 반영 완료
- 현재 설계 문서 세트에는 확인된 상충 내용이 없음
- 남은 리스크는 구현 전 추가 read-only audit로 기존 BokslDir 소스의 세부 기능을 재확인해야 한다는 점과, 7z provider가 fixture gate를 통과해야 한다는 점

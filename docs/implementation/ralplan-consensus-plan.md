# RALPLAN Consensus Plan: BokslDirGUI 설계 문서 세트

## Requirements Summary

- 사용자는 구현 전에 필요한 설계 문서를 실제로 작성하고, 문서 간 정합성 및 상충 여부를 확인하며, 요약 인덱스 문서까지 요구했음
- 범위는 축소 기준이 아니라 기존 TUI BokslDir 기능 동등성 전체를 기준으로 적용

## RALPLAN-DR Summary

### Principles

1. 기존 TUI 기능 동등성은 축소하지 않음
2. 파일 작업 안전성은 UI 편의보다 우선
3. 메뉴/단축키/컨텍스트 메뉴/도움말은 action registry를 단일 출처로 사용
4. React UI와 Rust command boundary는 DTO/event 계약으로 분리
5. faithful TUI commander identity를 기본 화면의 시각/레이아웃 불변 조건으로 배치

### Decision Drivers

1. 구현 착수 시 누락/상충을 줄이는 문서 간 계약
2. 프론트엔드/백엔드/테스트 병렬 작업이 가능한 설계 분해
3. 기존 TUI 기능 전체 포함이라는 사용자 기준

### Viable Options

| Option | Pros | Cons | Decision |
| --- | --- | --- | --- |
| A; 8개 세부 문서 + 인덱스 + 정합성 보고서 | 구현자가 바로 각 영역을 참조 가능, 상충 검토 명확 | 문서 수가 많음 | 채택 |
| B; 단일 대형 설계 문서 | 관리 파일 수 적음 | 섹션 간 참조/변경 추적 어려움 | 기각 |
| C; 구현하면서 문서 보강 | 빠른 착수 | 사용자의 구현 전 정합성 요구와 충돌 | 기각 |

## Planning Artifacts

- `README.md`: 인덱스/요약
- `tui-parity-map.md`
- `full-scope-baseline.md`
- `tauri-command-api.md`
- `component-design.md`
- `file-operation-state-machine.md`
- `action-registry.md`
- `full-scope-test-spec.md`
- `design-consistency-report.md`

## Acceptance Criteria

- 설계 문서에 축소 구현 표현이 없음
- 각 기준 기능은 parity map, baseline, API/component/state/test 중 적어도 둘 이상의 문서에서 연결
- 파일 변경 작업은 command API와 state machine 양쪽에서 정의
- action registry는 메뉴/단축키/컨텍스트 메뉴/도움말의 단일 출처로 정의
- 정합성 보고서가 잠재 충돌과 해소 방식 명시

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| 문서가 많아 변경 시 불일치 가능 | 인덱스와 consistency report 유지 |
| 기존 TUI 세부 기능 누락 가능 | 구현 전 BokslDir source read-only audit 추가 |
| 7z 구현 불확실 | 검증 게이트와 fallback ADR 명시 |
| GUI 확장으로 화면 복잡도 증가 | 기본 persistent chrome 금지 |

## ADR

### Decision

- 구현 전 설계는 단일 문서가 아니라 8개 세부 문서 + 인덱스 + 정합성 보고서로 분리

### Drivers

- 기존 TUI 기능 동등성 전체를 명확히 추적 필수
- React/Rust/테스트 작업이 병렬로 착수될 수 있어야 함
- 상충 검토 결과가 별도 산출물로 기록 필요

### Alternatives considered

- 단일 대형 문서: 변경 단위가 크고 구현자별 참조성이 낮아 기각
- 구현 후 문서화: 사용자 요청과 반대되어 기각

### Why chosen

- 기능 범위, API, UI 구조, 작업 상태, 액션 모델, 테스트를 독립 문서로 분리하면 각 구현 lane이 독립적으로 움직이면서도 인덱스/정합성 보고서로 전체 일관성 유지 가능

### Consequences

- 문서 간 참조 업데이트 관리 필수
- 구현 전 read-only audit로 기존 TUI 세부 동작을 보강하는 후속 작업이 필요

### Follow-ups

- Architect/Critic 검토 후 공개 `docs/design`, `docs/implementation`으로 동기화
- 이후 `$ultragoal` 또는 `$team`으로 구현 착수 가능

## Available-Agent-Types Roster

- `architect`: 문서 구조/경계/상충 검토
- `critic`: 정합성, 검증 가능성, 누락 위험 평가
- `executor`: 승인 후 공개 docs 동기화 및 구현
- `test-engineer`: 테스트 명세 구현 가능성 점검
- `designer`: faithful TUI commander UI 문서 보강
- `verifier`: 최종 문서 링크/용어/상충 검증

## Follow-up Staffing Guidance

### $ultragoal

- 기본 추천
- 설계 문서 공개 동기화 후 Tauri scaffold, command API, component shell, operation state machine 순서로 durable goals 생성

### $team

- 병렬 구현 시 사용
- UI shell, Rust command/service, action registry, test harness lane으로 분리

- Launch hint:

```bash
omx team --brief "docs/implementation/README.md 기준으로 BokslDirGUI TUI parity 구현을 병렬 진행"
```

### $ralph fallback

- 좁은 단일 lane의 검증 반복이 필요할 때만 선택

## Goal-Mode Follow-up Suggestions

- `$ultragoal`: 기본 구현 follow-up
- `$team`: UI/API/test 병렬 구현
- `$performance-goal`: 10,000+ 항목 렌더링/metadata 성능 최적화
- `$autoresearch-goal`: 7z provider나 OS DnD 조사/PoC가 중심일 때

## Review Iteration Log

- Architect 1차: ITERATE
- 외부 에디터 action 누락, conflict decision 불일치, 테스트 범위 누락 지적
- Planner 보정: `external.openEditor` 추가, `ConflictDecision = overwrite | skip | allOverwrite | allSkip | cancel` 통일, 탭/히스토리/북마크/시작 복원/패널 모드/외부 연동 테스트 보강

- Architect 2차: APPROVE
- 비차단 권고였던 conflict shorthand를 명시 enum으로 정리

- Critic 1차: ITERATE
- parity-critical action coverage와 외부 shell command parity 누락 지적
- Planner 보정: sort/filter/hidden/selection/layout/history/bookmark/settings/archive/help actions 추가, `external.runShellCommand`/`run_shell_command` 및 ShellCommandDialog/test/정합성 matrix 추가

- Critic 1차 보정 검증: parity-critical action ID, shell command command/action/component/test, action coverage matrix, 공개 문서 동기화 승인 기준 명시 완료

- Architect 최종 비차단 보강: `run_shell_command`에 `external.shellCommand.enabled` 설정 게이트와 backend 발급 TTL/one-shot `confirmToken` 재검증 계약 추가 완료

- Critic 2차 보정: `prepare_shell_command`를 명시 command로 승격, history action ID를 `nav.back`/`nav.forward`로 통일, component owner 명칭을 `BookmarkDialog`/`HistoryPopover`/`ContextMenuLayer`/`ExternalOpenDialog`로 정규화 완료

- Critic 2차 추가 보정: 테스트 명세의 pseudo action ID tab.restoreOnStartup을 설명 문구로 바꿔 action registry drift 제거 완료

- Architect 3차 비차단 보강: `external.runShellCommand`의 실행 경로를 action registry/component 설계에도 `ShellCommandDialog → prepare_shell_command → run_shell_command`로 명시 완료

- Critic 최종 승인: blocking issue 없음, public docs mirror 가능
- 공개 반영 시 approved 상태/최종 검증일로 갱신하고 machine-check checklist를 재실행

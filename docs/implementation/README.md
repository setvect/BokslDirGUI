# BokslDirGUI 구현 설계 문서 인덱스

- 상태: RALPLAN approved (2026-06-13)
- 기준: **기존 TUI BokslDir 기능 동등성 + GUI 전환 필수 기능**
- 비목표: 축소 범위 구현, 기존 Rust 로직 재사용 강제, 구현 코드 작성

## 문서 목록

| 문서 | 목적 | 구현 전 역할 |
| --- | --- | --- |
| `tui-parity-map.md` | 기존 TUI 기능을 GUI 기능/컴포넌트/API로 매핑 | 누락 기능 방지 |
| `full-scope-baseline.md` | 첫 완성 기준과 범위 분류 | 구현 범위 기준선 |
| `tauri-command-api.md` | React↔Rust command/event DTO 계약 | 프론트/백엔드 병렬 구현 기준 |
| `component-design.md` | React 컴포넌트 구조와 책임 | UI 구현 분해 기준 |
| `file-operation-state-machine.md` | 복사/이동/삭제/압축 작업 상태와 전이 | 데이터 안전성 기준 |
| `action-registry.md` | 메뉴/단축키/컨텍스트 메뉴 공통 액션 모델 | UX 일관성 기준 |
| `full-scope-test-spec.md` | 전체 기준 기능 검증 전략 | 완료 판정 기준 |
| `design-consistency-report.md` | 문서 간 정합성/상충 검토 | 설계 품질 게이트 |
| `ralplan-consensus-plan.md` | RALPLAN 의사결정/ADR/후속 실행 가이드 | 거버넌스 기록 |

## 구현 착수 순서 권장

1. `tui-parity-map.md`로 누락 없는 기능 범위를 잠근다.
2. `action-registry.md`와 `tauri-command-api.md`로 UI와 Rust 경계를 고정한다.
3. `component-design.md`로 화면을 분해한다.
4. `file-operation-state-machine.md`로 파일 변경 작업 안전성을 잠근다.
5. `full-scope-test-spec.md`를 구현 완료 게이트로 사용한다.

## 공통 용어

- **기존 TUI 기능 동등성**: 기존 BokslDir TUI에서 제공하던 탐색, 선택, 파일 작업, 압축, 북마크/히스토리, 설정/도움말 등 핵심 기능을 GUI에서도 제공하는 기준.
- **GUI 전환 필수 기능**: 마우스, 컨텍스트 메뉴, 다이얼로그, 드래그 앤 드롭, 시스템 파일 관리자/기본 앱 연동처럼 GUI 앱에서 자연스럽게 요구되는 기능.
- **후속 검토 기능**: 기존 구현 근거가 약하거나 위험도가 높아 별도 설계/PoC 후 도입할 기능.

## 주요 불변 조건

- 기본 화면은 faithful TUI commander identity를 유지한다.
- 파일 시스템 변경은 Rust command/service 계층에서 검증하고 실행한다.
- 메뉴, 단축키, 컨텍스트 메뉴, 도움말은 같은 action registry를 참조한다.
- 모든 장시간 작업은 진행률, 취소, 오류 요약을 제공한다.
- 7z는 기준 기능 범위에 포함하지만 provider PoC/fixture 통과 전 완료로 보지 않는다.

## 정합성 게이트

공개 문서로 동기화하기 전 다음을 통과해야 한다.

- 금지된 축소 범위 표현 없음.
- 기준 기능별 action ID, command/store path, component owner, test assertion 연결.
- `ConflictDecision` 명칭 통일.
- 외부 shell command는 기본 비활성/명시 확인 정책 포함.

- 공개 반영 전 `design-consistency-report.md`의 machine-check checklist를 통과해야 한다.
- 최종 검증일: 2026-06-13

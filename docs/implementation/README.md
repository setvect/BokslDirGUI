# BokslDirGUI 구현 설계 문서 인덱스

- 상태: RALPLAN approved (2026-06-13)
- 기준: **기존 TUI BokslDir 기능 동등성 + GUI 전환 필수 기능**
- 비목표: 축소 범위 구현, 기존 Rust 로직 재사용 강제, 구현 코드 작성

- 2026-09-25 전체 소스 검토와 수정·잔여 항목은 [코드 리뷰 보고서](code-review-2026-09-25.md) 참조

- 2026-09-27 구조 분리와 검증 기록은 [전체 구조 리팩토링](refactoring.md) 참조

## 문서 목록

| 문서 | 목적 | 구현 전 역할 |
| --- | --- | --- |
| `tui-parity-map.md` | 기존 TUI 기능을 GUI 기능/컴포넌트/API로 매핑 | 누락 기능 방지 |
| `tui-parity-matrix.md` / `tui-parity-matrix.json` | 기존 TUI 액션·단축키·메뉴·서브메뉴와 GUI 구현 상태를 1:1로 대조 | Phase 0 하드 게이트, 허위 완료 방지 |
| `full-scope-baseline.md` | 첫 완성 기준과 범위 분류 | 구현 범위 기준선 |
| `tauri-command-api.md` | React↔Rust command/event DTO 계약 | 프론트/백엔드 병렬 구현 기준 |
| [windows-support-plan.md](windows-support-plan.md) | 단일 소스 기반 Windows 지원의 현황·수정 범위·단계별 검증 계획 | OS 의존성 해소와 Windows 기능 동등성 완료 기준 |
| [windows-validation.md](windows-validation.md) | W0~W2 구현 정책과 Windows 네이티브 실행 체크리스트 | Mac 검증과 Windows 미검증의 구분 |
| [drag-and-drop.md](drag-and-drop.md) | 내부 포인터 세션, 외부 인계, 좌표 계약과 회귀 검증 | 잘못된 대상 파일 작업 방지 |
| `component-design.md` | React 컴포넌트 구조와 책임 | UI 구현 분해 기준 |
| `file-operation-state-machine.md` | 복사/이동/삭제/압축 작업 상태와 전이 | 데이터 안전성 기준 |
| `action-registry.md` | 메뉴/단축키/컨텍스트 메뉴 공통 액션 모델 | UX 일관성 기준 |
| `full-scope-test-spec.md` | 전체 기준 기능 검증 전략 | 완료 판정 기준 |
| `design-consistency-report.md` | 문서 간 정합성/상충 검토 | 설계 품질 게이트 |
| `ralplan-consensus-plan.md` | RALPLAN 의사결정/ADR/후속 실행 가이드 | 거버넌스 기록 |
| `implementation-todo.md` | 현재 구현 완료 내용과 남은 실제 파일 커맨드 구현 TODO | 후속 구현 실행 순서 기준 |
| `prd-remaining-todo.md` | PRD 기준으로 실제 사용자 시나리오에서 아직 덜 닫힌 작업 체크리스트 | 남은 작업 추적 |
| `ui-quality-audit-todo.md` | 전체 UI를 단계별로 점검하고 결함·수정·검증 증거를 추적하는 체크리스트 | UI 품질 감사와 완료 판정 |

## 구현 착수 순서 권장

1. `tui-parity-map.md`로 기능 범위를 확인하고, `tui-parity-matrix.json`으로 TUI action/menu/key 누락 여부를 기계 검증
2. `action-registry.md`와 `tauri-command-api.md`로 UI와 Rust 경계를 고정
3. `component-design.md`로 화면을 분해
4. `file-operation-state-machine.md`로 파일 변경 작업 안전성을 확정
5. `full-scope-test-spec.md` 구현 완료 게이트로 사용

## 공통 용어

- **기존 TUI 기능 동등성**: 기존 BokslDir TUI에서 제공하던 탐색, 선택, 파일 작업, 압축, 북마크/히스토리, 설정/도움말 등 핵심 기능을 GUI에서도 제공하는 기준
- **GUI 전환 필수 기능**: 마우스, 컨텍스트 메뉴, 다이얼로그, 드래그 앤 드롭, 시스템 파일 관리자/기본 앱 연동처럼 GUI 앱에서 자연스럽게 요구되는 기능
- **후속 검토 기능**: 기존 구현 근거가 약하거나 위험도가 높아 별도 설계/PoC 후 도입할 기능

## 주요 불변 조건

- 기본 화면은 faithful TUI commander identity 유지
- 파일 시스템 변경은 Rust command/service 계층에서 검증하고 실행
- 메뉴, 단축키, 컨텍스트 메뉴, 도움말은 같은 action registry 참조
- 모든 장시간 작업은 진행률, 취소, 오류 요약 제공
- 7z는 기준 기능 범위에 포함하지만 provider PoC/fixture 통과 전 완료로 보지 않음

## 정합성 게이트

- 공개 문서로 동기화하기 전 다음 통과 필수

- 금지된 축소 범위 표현 없음
- 기준 기능별 action ID, command/store path, component owner, test assertion 연결
- `ConflictDecision` 명칭 통일
- 외부 shell command는 기본 비활성 설정을 유지하며 입력 후 바로 실행

- 공개 반영 전 `design-consistency-report.md`의 machine-check checklist 통과 필수
- 최종 검증일: 2026-06-13

## 기능 변경 시 기준과 문서 관리

- 개선 근거: 터미널 편집기 제거 시 같은 액션 속성·다이얼로그 타입·명령·필수 목록·문서 표의 반복 수정 발생
- 개선 범위: 중복 선언 제거와 누락 검출, 패널 상태·operation store·React↔Rust 계약·파일 작업 실행 경로 유지

| 변경 대상 | 수정 기준 | 파생 소비처 |
| --- | --- | --- |
| 다이얼로그 종류·실행 모드 | [`dialogDefinitions.ts`](../../src/operations/dialogDefinitions.ts) | 기존 타입 export·번역 타입·실행기 연결 검사 |
| 액션의 대상 조건·다이얼로그·설정 | [`registry.ts`](../../src/actions/registry.ts) | 대상 조회·다이얼로그 조회·메뉴 체크·설정 변경 |
| 프론트 명령 이름 | [`commands.ts`](../../src/tauri/commands.ts)의 `COMMANDS` | 백엔드 지원 목록·Rust 대조 검사 |
| 독립 기능 요구·동등성 상태·제외 근거 | [`tui-parity-matrix.json`](tui-parity-matrix.json) | 필수 액션 검사·동등성 문서 표 |

- 액션·기능 추가 또는 제거 시 레지스트리와 독립 요구사항의 의도적인 동시 검토 필수
- 다이얼로그·명령 변경 시 위 공통 정의와 해당 실행 구현·행동 테스트 수정 필수
- 타입·속성·목록 통합을 이유로 입력 검증·확인·취소·충돌·완료 처리 테스트 축소 금지
- Rust의 실제 `generate_handler!` 등록과 `#[tauri::command]` 구현은 프론트 목록과 별도 대조 유지
- 상태 확인·드롭 오버레이의 기존 네이티브 전용 명령만 [`featureContracts.ts`](../../src/verification/featureContracts.ts)에 용도 명시 예외 허용
- 사용자 요청으로 제외된 터미널 편집기 5개 항목은 날짜·사유·원천 TUI 기록 유지, 구현 완료와 구분 필수

### 생성 문서와 검증

- 적용 문서: [액션 레지스트리](action-registry.md), [동등성 매트릭스](tui-parity-matrix.md)의 `BEGIN GENERATED`·`END GENERATED` 사이만 갱신
- `npm run docs:generate`: 실제 레지스트리와 독립 요구사항 JSON에서 지정 표 생성, 입력 순서 고정·실행 시각 미포함
- `npm run docs:check`: 파일 수정 없이 불일치 보고, `npm run verify`에 포함
- 기존 Vite의 서버 측 모듈 로딩으로 실제 TypeScript 정의 참조, 네트워크 리스닝·신규 의존성 없음
- `npm test`: 동작 테스트와 검증 도구의 실패 사례 테스트 실행
- 필수 액션 누락·Rust 미등록 명령·잘못된 다이얼로그 연결·문서 불일치의 실패 검증 유지
- 메뉴·단축키·설정 저장·입력창 소유권·파일 안전성의 독립 행동 검증 유지
- 생성 구간 밖 설명·판단 근거는 수동 관리, 기능 변경마다 과거 검토·완료 문서 일괄 갱신 금지
- 과거 기록에 적힌 날짜·검증 수치·완료·실패·미검증 상태 보존, 현재 변경을 과거 검증 결과로 표현 금지

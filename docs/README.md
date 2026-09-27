# BokslDirGUI 문서 인덱스

- 작성일: 2026-06-13
- 개정일: 2026-06-13
- 목적: BokslDirGUI의 요구사항, 아키텍처, 구현 설계 문서를 한 곳에서 탐색할 수 있도록 정리
- 기준: **기존 TUI BokslDir 기능 동등성 + GUI 전환 필수 기능**
- 비목표: 축소 범위 구현, 기존 Rust 로직 재사용 강제, 구현 코드 작성

## 1. 문서 구조

| 영역 | 문서 | 역할 |
| --- | --- | --- |
| 목업/프로토타입 | [`../mockups/clickable-prototype/README.md`](../mockups/clickable-prototype/README.md) | TUI-faithful 클릭 프로토타입, 실행/검증 방법, 목업 안전 경계 |
| 요구사항 | [`requirements/README.md`](requirements/README.md) | 제품 목표, 근거 원칙, 우선순위 맵 |
| 요구사항 | [`requirements/01-core-experience.md`](requirements/01-core-experience.md) | 앱 시작, 듀얼 패널, 파일 목록, 탐색, 선택, 정렬/필터 |
| 요구사항 | [`requirements/02-file-operations.md`](requirements/02-file-operations.md) | 복사/이동/삭제/새 폴더/이름 변경/속성/압축/외부 앱 |
| 요구사항 | [`requirements/03-navigation-search-organization.md`](requirements/03-navigation-search-organization.md) | 탭, 히스토리, 북마크, 경로 입력, 검색/필터 고도화, 사이드바 |
| 요구사항 | [`requirements/04-gui-desktop-interactions.md`](requirements/04-gui-desktop-interactions.md) | 마우스 이벤트, 컨텍스트 메뉴, 드래그 앤 드롭, 보기 모드, 미리보기, 작업 큐 |
| 요구사항 | [`requirements/05-customization-platform-quality.md`](requirements/05-customization-platform-quality.md) | 테마, i18n, 설정, 보안, 플랫폼, 성능/안정성/접근성 |
| 요구사항 | [`requirements/06-validation-evidence.md`](requirements/06-validation-evidence.md) | 검증 시나리오, 회귀 테스트, 근거 파일 요약, 미확정 사항 |
| 아키텍처 | [`architecture/BokslDirGUI_tauri_react_rust_architecture.md`](architecture/BokslDirGUI_tauri_react_rust_architecture.md) | Tauri + React + Rust 기반 구조 정의 |
| 구현 설계 | [`implementation/README.md`](implementation/README.md) | 구현 설계 문서 인덱스와 착수 순서 |
| 구현 설계 | [`implementation/tui-parity-map.md`](implementation/tui-parity-map.md) | 기존 TUI 기능과 GUI 구현 단위 매핑 |
| 구현 설계 | [`implementation/full-scope-baseline.md`](implementation/full-scope-baseline.md) | 첫 완성 기준과 전체 범위 기준선 |
| 구현 설계 | [`implementation/tauri-command-api.md`](implementation/tauri-command-api.md) | React↔Rust command/event/DTO 계약 |
| 구현 설계 | [`implementation/component-design.md`](implementation/component-design.md) | React 컴포넌트 구조와 책임 |
| 구현 설계 | [`implementation/file-operation-state-machine.md`](implementation/file-operation-state-machine.md) | 파일 작업 상태와 전이 |
| 구현 설계 | [`implementation/action-registry.md`](implementation/action-registry.md) | 메뉴/단축키/컨텍스트 메뉴 공통 액션 모델 |
| 구현 설계 | [`implementation/full-scope-test-spec.md`](implementation/full-scope-test-spec.md) | 전체 기준 기능 검증 전략 |
| 구현 설계 | [`implementation/design-consistency-report.md`](implementation/design-consistency-report.md) | 설계 문서 간 정합성/상충 검토 |
| 구현 설계 | [`implementation/ralplan-consensus-plan.md`](implementation/ralplan-consensus-plan.md) | RALPLAN 의사결정/ADR/후속 실행 가이드 |
| 구현 설계 | [`implementation/implementation-todo.md`](implementation/implementation-todo.md) | 현재 구현 완료 내용과 남은 실제 파일 커맨드 구현 TODO |

## 2. 권장 읽기 순서

1. [`requirements/README.md`](requirements/README.md)에서 제품 목표와 우선순위 확인
2. [`architecture/BokslDirGUI_tauri_react_rust_architecture.md`](architecture/BokslDirGUI_tauri_react_rust_architecture.md)에서 선택된 기술 구조 확인
3. [`implementation/README.md`](implementation/README.md)에서 구현 설계 문서 묶음과 착수 순서 확인
4. 구현 전에는 [`implementation/design-consistency-report.md`](implementation/design-consistency-report.md)와 [`implementation/full-scope-test-spec.md`](implementation/full-scope-test-spec.md)를 완료 게이트로 사용

## 3. 공통 원칙

- 기본 목표는 축소 범위가 아니라 **기존 TUI 기능 동등성**
- GUI 전환으로 추가되는 마우스, 컨텍스트 메뉴, 드래그 앤 드롭, 다이얼로그, OS 연동은 기능 동등성을 해치지 않는 방식으로 포함
- 기본 화면은 faithful TUI commander identity 유지
- 파일 시스템 변경 작업은 Rust command/service 계층에서 검증하고 실행
- 메뉴, 단축키, 컨텍스트 메뉴, 도움말은 같은 action registry 참조
- 설계 문서 변경 시 관련 요구사항, API, 컴포넌트, 테스트 명세, 정합성 보고서를 함께 갱신

## 4. 목업/프로토타입 참고

- 현재 GUI 방향 검증용 클릭 목업은 [`mockups/clickable-prototype`](../mockups/clickable-prototype/README.md)에 있음
- 이 목업은 TUI 파일 커맨더 정체성을 GUI로 옮기는 방향을 확인하기 위한 참고 산출물이며, 실제 파일 시스템 작업이나 생산 코드 구조로 재사용하는 것을 전제하지 않음

- 구현 설계에서 화면 밀도, 듀얼 패널 우선순위, 하단 hotkey strip, overlay 기반 메뉴/다이얼로그 흐름을 판단할 때 참고
- 단, 최종 구현 계약은 `docs/implementation/`의 API, 컴포넌트, 상태 머신, 테스트 명세를 우선

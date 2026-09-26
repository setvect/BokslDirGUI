# 전체 구조 리팩토링 기록

## 기준과 완료 범위

- 기준 커밋: `35c7423`. 시작 작업 트리는 깨끗한 상태였다. 리팩토링 구현 완료 시점에는 커밋하지 않았다.
- AGENTS.md, 구현 설계·요구사항, TUI parity map/matrix, 2026-09-25 코드 리뷰를 기준으로 진행했다.
- 공개 command/event 이름, DTO의 serde 형식, 설정 JSON과 기존 화면·키보드·마우스·파일 작업 정책을 유지한다. 신규 라이브러리와 기능은 추가하지 않았다.
- 큰 파일의 행 수보다 수정 책임·의존 방향·단독 검증 가능성을 기준으로 나눴다. 아래 완료는 코드 분리와 가용 자동 검증의 완료이며 실제 네이티브 앱 검증을 의미하지 않는다.

## 개선 목록과 단계별 체크리스트

| 단계 | 기존 위치 / 혼재된 책임 | 변경 이점과 영향 범위 | 검증 근거 | 상태 |
| --- | --- | --- | --- | --- |
| 1. 기준선 | Shell에 화면·입력·탐색, lib/operation에 계약·서비스·실행 책임 집중 | 기능 변경과 구조 변경을 구분할 기준 확보 | `baseline.txt`: 프론트 257, Rust 68, 범위 261 통과 | 완료 |
| 2. 화면·계산 | `CommanderShell.tsx`의 화면, 열 너비·문자 폭·비교·선택·설정 계산 | 화면은 필요한 상태/의도별 콜백만 받고, 계산은 DOM/Shell 없이 테스트 | 기능별 Shell 회귀, `presentation.test.ts` | 완료 |
| 3. 탐색·입력 | 패널·탭·선택·요청 버전과 설정 저장, 키보드/드래그/클립보드 처리 혼재 | 함께 변하는 탐색 상태는 한 소유자에 유지하고 입력 수명주기 분리 | navigation/keyboard/drag/clipboard 회귀, StrictMode 리스너와 닫힌 탭 응답 회귀 추가 | 완료 |
| 4. 작업 상태 | `operationStore.ts`의 초안·검증·이벤트 처리, 직접 시작/다이얼로그 시작의 중복 | 단일 store와 공개 인터페이스 유지, 공통 실행 응답 처리 사용 | 시작 전 취소·다른 ID·중복 완료·충돌·닫힌 창 회귀, store/host 테스트 60개 통과 | 완료 |
| 5. Rust | `lib.rs`의 DTO/서비스, `operation.rs`의 모든 작업 실행 | 명령 등록·서비스·작업 수명·안전 I/O의 변경 위치 명확화 | 기존 Rust 68개 보존 + 계약 fixture 3개, 총 71개 통과 | 완료 |
| 검증·문서 | 특정 대형 파일의 문자열에 의존한 scope 검사와 단일 UI 테스트 파일 | 담당 모듈별 근거를 지정하고 기존 검사 ID 유지 | 최종 `npm run verify`: 프론트 264 / Rust 71 / 범위 261 통과 | 완료 |

다음 영역을 모두 대조했다.

- [x] UI: 패널·상단 메뉴·컨텍스트 메뉴·경로 입력·상태/단축키 표시, 기존 CSS/DOM/접근성 속성 유지
- [x] 입력: 패널 전환·행/범위 선택·페이지 이동, 입력/메뉴/다이얼로그 소유권, 실시간 Shift와 취소
- [x] 탐색: 요청 버전, 탭 전환/닫기, 늦은 응답 무시, 새로고침 후 선택·포커스, 설정 저장 순서
- [x] 작업: 시작 응답 전 취소, 창을 닫아도 작업 유지, 다른 작업 ID 차단, 완료 콜백 중복 방지
- [x] Rust: 복사·이동·휴지통/영구 삭제·충돌·압축·프로세스·원본 보존·임시 파일 게시·심볼릭 링크
- [x] 계약: 대표 DTO/오류/진행 이벤트/설정 직렬화 fixture, 기존 command 등록
- [x] 검증: 기존 테스트 보존, 기능별 파일 분리, 순환 import 검사, 범위 검사 261개 유지

## 최종 책임과 의존 방향

| 영역 | 담당 파일 | 상태 소유 / 의존 방향 |
| --- | --- | --- |
| 화면 조립 | `src/ui/CommanderShell.tsx` | 컨트롤러와 화면을 연결하고 보조 창 표시를 소유 |
| 화면 | `FilePanel`, `PanelHeader`, `TopMenuBar`, `PanelContextMenus`, `EntryName`, `StatusStrips` | 표시용 상태와 행 포커스/선택/열기 등 의도별 콜백. 파일 작업 직접 호출 없음 |
| 독립 계산 | `panelPresentation`, `textLayout`, `directoryComparison`, `selectionModel`, `settingsModel`, `hotkeyStripLayout` | domain 타입/정적 registry에 의존, React·Tauri·store 의존 없음 |
| 탐색 | `usePanelNavigation`, `useNavigationMenus` | 패널·탭·목록·선택·히스토리·요청 버전·압축 캐시는 탐색 컨트롤러가 소유 |
| 설정 | `useCommanderSettings` | 로딩·직렬 저장 큐·최신 설정 참조, 표시 계산은 `settingsModel` |
| 실행과 입력 | `useCommanderActions`, `actionRequest`, `useCommanderKeyboard`, `useFileDrag`, `useFileClipboard` | 입력 모듈 → 명시적 ActionRequest → 공통 실행 경로. Shell 역참조 없음 |
| 외부 연결 | `src/tauri/client.ts`, `commands.ts`, `commanderClients.ts` | 명령/이벤트 호출, 네이티브 드래그·창 어댑터 |
| 작업 상태 | `operationStore`, `dialogDraft`, `operationLifecycle`, `operationRuntime`, `operationEvents`, `operationTypes` | 기존 store 하나. 내부 모듈은 set/get 주입을 받고 store를 import하지 않음 |
| 작업 화면 | `OperationDialogHost`, `OperationInputs`, `OperationOverview`, `OperationResultView`, `ConflictResolutionView` | Host는 공통 프레임·포커스·구독 연결, 입력/표시는 실행 컨트롤러를 복제하지 않음 |
| Rust 진입/계약 | `lib.rs`, `commands.rs`, `contracts.rs` | 초기화/등록 → command → 서비스. DTO/오류와 설정 형식 유지 |
| Rust 서비스 | `navigation`, `filesystem`, `path_text`, `settings_service`, `mutation`, `external`, `shell_command`, `archive`, `preview` | 기존 구현을 서비스 단위로 이동. 경로 표시처럼 낮은 계층의 계산은 별도 leaf 모듈 |
| Rust 작업 엔진 | `operation/{start,runtime,transfer,delete,archive_ops,process,conflict,file_io}.rs` | 작업 ID와 등록부는 runtime 공유. 유형별 알고리즘은 분리하고 경로/임시 파일/덮어쓰기/심볼릭 링크 안전성은 I/O 경계 유지 |

액션 요청은 action ID, 출발 패널, 선택 항목, 대상 경로, 원본 목록과 클립보드 이동 스냅샷을 이름 있는 필드로 전달한다. 비동기 작업은 요청 당시 원본/대상을 유지하며 기존 drop/실행 직전 검증을 보존한다. getter 기반 컨트롤러 연결은 나중에 생성되는 콜백을 지연 참조하기 위한 것으로 새 전역 상태 저장소가 아니다.

모든 Rust `use super::*`를 명시적인 import로 바꿨다. 작업별로 진행률/취소 저장소를 만들지 않았고 복사·이동·삭제·압축을 범용 알고리즘으로 합치지 않았다. 순환 의존 검사는 TypeScript import/export(타입 전용 포함)와 Rust 명시적 use 경로를 대상으로 한다.

## 설계 문서와 코드의 차이

- 초기 component-design의 panel/selection/navigation/settings store 구상과 실제 React 상태 소유 방식이 달랐다. 원자적으로 함께 갱신하는 탐색 상태를 `usePanelNavigation`에 유지하고 별도 store는 추가하지 않는 것으로 설계를 갱신했다.
- 기존 압축 생성 매핑 증거에는 반대 패널을 대상으로 한다는 오래된 설명이 남아 있었다. 현재 동작과 기존 회귀에 맞춰 출발 패널 디렉터리로 문서만 정정했다.
- scope 검사의 파일 위치 가정은 추출 중 실패로 확인했으며 담당 모듈과 실제 테스트 경로로 갱신했다. 전체 소스를 합쳐 문자열을 찾는 방식으로 대체하지 않았다.
- 이전 코드 리뷰는 당시 상태의 기록으로 유지한다. 현재 책임/검증 위치는 이 문서와 component-design 및 parity matrix를 기준으로 한다.

## 검증 기록

로그는 `temp/verification/refactor/`에 보관한다(저장소 추적 제외).

- `baseline.txt`: 변경 전 `npm run verify` 통과(257 / 68 / 261).
- `frontend.txt`, `modules.txt`: 중간 추출 후 기존 프론트·Rust 테스트는 통과했고 이전 파일 위치를 가정한 scope 실패를 발견했다. 해당 위치 검사는 최종본에서 수정했다.
- `final.txt`: 최종 타입 검사, 프론트 테스트 264개, 프론트 빌드, Rust check/test 71개, 전체 범위 검사 261개 통과.
- `git diff --check` 통과. 새 파일의 후행 공백, 기존 범위 검사 이름 보존, parity evidence 파일 존재 여부도 대조했다.
- 추가된 프론트 테스트 7개: 공통 DTO fixture 2개, 모듈 경계 3개, StrictMode 리스너와 닫힌 탭 응답 2개. 기존 테스트를 줄이지 않았다.
- 10,000행 가상화와 200,000항목 계산 회귀를 유지했다. 탐색 응답 무효화와 이벤트 구독 정리를 확인했으나 새 성능 향상을 주장하지 않는다.
- 번들 500 kB 경고는 기준선에도 있었고 최종 빌드에도 남아 있다. 초기 로딩 성능이나 네이티브 앱 속도를 비교 측정하지 않았다.

## 남은 위험과 별도 확인

- 실제 Tauri WebKit 창의 포커스/스크롤·드래그, Finder/Chrome OS 드롭, 외부 볼륨 휴지통·권한 창은 이번 변경에서 직접 실행 검증하지 않았다. 컴포넌트/임시 파일 테스트로 네이티브 E2E 완료를 대체하지 않는다.
- 7z/provider와 운영체제별 동작은 설치 환경의 영향을 받는다. 다른 운영체제에서 다시 검증해야 한다.
- 기존 리뷰의 shell command 취소/시간 제한, watch_path의 실제 파일 감시 미구현, 비활성 탭의 외부 변경/스크롤 복원 한계는 이번 구조 변경에서 기능 수정하지 않았다.
- UI 재설계·새 기능·라이브러리 교체·성능 튜닝은 별도 범위다. 추출 중 확인된 import/연결 오류는 회귀 검증으로 수정했으며 별도의 제품 동작 변경은 섞지 않았다.

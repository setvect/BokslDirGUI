# React 컴포넌트 설계

## 1. 목적

- Tauri/React UI를 faithful TUI commander identity에 맞게 분해
- 기본 화면은 좌/우 파일 패널이 지배하고, 보조 기능은 overlay/collapsed로 제공

## 2. 컴포넌트 트리

```text
App
└─ AppProviders
   ├─ ThemeProvider
   ├─ I18nProvider
   └─ TauriEventProvider
      └─ CommanderShell
         ├─ TopMenuBar
         ├─ DualPanelLayout
         │  ├─ FilePanel(left)
         │  │  ├─ PanelHeader
         │  │  ├─ PathControls
         │  │  ├─ TabStrip
         │  │  └─ FileTable
         │  └─ FilePanel(right)
         ├─ BottomStatusStrip
         │  └─ TransientStatusText
         ├─ HotkeyStrip
         └─ DialogLayer
            ├─ CommandPalette
            ├─ ContextMenuLayer
            ├─ OperationDialog
            ├─ ConflictResolutionDialog
            ├─ ArchiveDialog
            ├─ PropertiesDialog
            ├─ SettingsDialog
            ├─ BookmarkDialog
            ├─ HistoryPopover
            ├─ ExternalOpenDialog
            ├─ ShellCommandDialog
            └─ HelpDialog
```

## 3. 주요 컴포넌트 책임

| 컴포넌트 | 책임 | 참조 상태 | 금지 사항 |
| --- | --- | --- | --- |
| `CommanderShell` | 전체 layout, active panel, global keyboard dispatch | activePanel, layoutMode | 파일 작업 직접 실행 |
| `TopMenuBar` | File/Edit/View/Go/Archive/Settings/Help | action registry | 독자 메뉴 정의 |
| `DualPanelLayout` | panel ratio, splitter, single/dual mode | layout store | 패널 내부 상태 소유 |
| `FilePanel` | panel-local state binding | panel store | global operation state 소유 |
| `PanelHeader` | compact path chip, active marker, sort/filter indicators | panel/navigation state | bulky breadcrumb bar |
| `PathControls` | back/forward/up/refresh/address edit/drive overlay | navigation store | persistent sidebar 강제 |
| `FileTable` | virtualized rows, selection, keyboard row navigation | listing/selection state | 전체 DOM row 렌더링 |
| `OperationDialog` | move/delete/archive/external 등 명시 확인이 필요한 action의 preflight/confirm shell | operation store | Rust validation 우회 |
| `ContextMenuLayer` | row/blank/context menu | action registry | 메뉴별 별도 handler |
| `HistoryPopover` | panel별 back/forward 목록 표시 | navigation store | 전역 단일 history 가정 |
| `BookmarkDialog` | 북마크 추가/이름 변경/삭제, 중복 방지 | navigation/settings store | panel history 직접 변조 |
| `ExternalOpenDialog` | 기본 앱/파일 관리자/외부 에디터 실행 확인 및 실패 메시지 | action/settings state | 사용자 확인 없는 외부 실행 |
| `OperationStatusSurface` | copy direct-start 및 닫힌 dialog 뒤의 progress/bytes/speed/ETA/conflict/summary/error non-modal 표시 | operation store + activeOperationController | 실행 중 controller/progress 분리 손실 |
| `ConflictResolutionDialog` | `ConflictDecision` 선택과 apply-all 정책 표시 | operation store | enum 밖 결정값 생성 |
| `CommandPalette` | action registry 검색/실행, Help 검색과 동일 ID 사용 | action registry | registry 밖 임의 command 실행 |
| `BottomStatusStrip` | 파일/선택/활성 패널 상태와 짧은 transient status를 한 줄로 표시 | panel/action state | 조작을 막는 팝업 표시 |
| `HotkeyStrip` | 화면 폭/확대 배율에 따라 우선순위 action hint를 가능한 만큼 표시 | action registry + measured width | 실제 action source 중복, 고정 개수 표시 |
| `ShellCommandDialog` | 현재 경로 기준 shell command 입력/result 표시, backend `run_shell_command` 직접 호출 흐름 소유 | action/operation/settings state | 설정 비활성 상태에서 명령 실행 |
| `HelpDialog` | action registry 기반 도움말/검색/About | action registry | 하드코딩 단축키 목록 |


### Operation UI split

- `file.copy`는 TUI copy UX에 맞춰 no-conflict 경로에서 preflight 없이 `startLongRunningOperation` 시작
- `file.move`, delete, archive extract/create처럼 destructive 또는 명시 확인이 필요한 작업은 `OperationDialog`에서 확인 수행
- operation이 시작된 뒤 사용자가 dialog를 닫아도 `activeOperationController`와 `progress`는 유지
- 이후 backend summary/conflict/cancel event는 `OperationStatusSurface`에서 표시하고 panel refresh callback을 계속 실행
- backend가 실제 `operationId`를 반환하기 전 취소를 요청하면 synthetic pending id를 backend cancel에 보내지 않고, 실제 id가 확정된 즉시 cancel 전달

## 4. 실제 상태 소유권과 실행 경계

- 2026-09-27 구조 리팩토링에서 초기 설계의 store별 분리 구상을 실제 갱신 단위에 맞춰 조정 완료
- 패널·탭·선택·히스토리는 함께 변경되므로 별도 store를 만들지 않음
- 위 트리는 UI 역할 구분이며 모든 노드가 별도의 컴포넌트나 store라는 의미는 아님

| 소유자 | 포함 상태와 책임 | 연결 방식 |
| --- | --- | --- |
| `usePanelNavigation` | 좌우 경로·탭·목록·포커스·선택·히스토리, 요청 버전, 압축 목록/암호 캐시 | 탐색·탭 전환·선택·새로고침 의도별 메서드 |
| `useCommanderSettings` | 표시 설정, 설정 로딩, 낙관적 갱신과 직렬 저장 큐 | 설정 patch와 레이아웃/확대 명령 |
| `useCommanderActions` | registry 액션 실행, 미리보기, 압축 암호 재시도 | `ActionRequest`의 action ID·출발 패널·선택·대상 경로 |
| `useFileClipboard` | 복사/잘라내기 원본 스냅샷, 붙여넣기 의도 | 공통 액션 실행에 요청 전달 |
| `useCommanderKeyboard` | 문서 리스너, 최신 실행 참조, 시퀀스 타이머 정리 | registry 판정과 입력 소유권을 거쳐 공통 액션 호출 |
| `useFileDrag` / `pointerFileDrag` | 내부 포인터 세션, 외부 드래그 연결과 리스너 해제 | 놓는 시점에 대상/작업 가능 여부 재검사 |
| `operationStore` | 다이얼로그 초안, 진행·충돌·완료, 실제 작업 ID 연결 | 기존 공개 store API 유지, 내부 runtime/events 모듈에 상태 접근 주입 |
| `CommanderShell` | 화면 배치, 메뉴·보조 창 표시, 컨트롤러 연결 | 화면에 필요한 상태와 의도별 콜백 전달 |

- UI → 컨트롤러 → 클라이언트 → Rust command/service 방향으로 의존
- 컨트롤러는 Shell을 import하지 않음
- `FilePanel`, `PanelHeader`, `TopMenuBar`, `PanelContextMenus`, `StatusStrips`는 자체 파일 작업을 실행하지 않음
- `panelPresentation`, `textLayout`, `selectionModel`, `directoryComparison`, `settingsModel`, `hotkeyStripLayout`은 독립 계산 제공
- `OperationDialogHost`는 공통 프레임/포커스/이벤트 구독을 연결하고 `OperationInputs`, `OperationOverview`, `OperationResultView`, `ConflictResolutionView`는 표시와 의도별 콜백을 담당
- 컨트롤러 연결의 지연 getter: 렌더 중 나중에 만들어지는 콜백 참조 목적
- 최신 이벤트 실행 참조와 요청 버전은 해당 컨트롤러가 유지
- 추출 범위와 검증 증거는 [구조 리팩토링 기록](refactoring.md) 참조

## 5. 렌더링 규칙

- `FileTable`은 TanStack Table state와 TanStack Virtual row virtualization을 조합
- row height는 commander density를 유지하는 design token으로 고정/준고정
- active row와 selected row는 색상만이 아니라 marker/text style로도 구분
- path/header는 한 줄을 기본으로 하고, 긴 경로는 middle ellipsis + tooltip/address edit로 처리
- sidebar/preview/queue는 기본 화면 persistent 영역이 아니라 overlay/collapsed로 시작

## 6. 접근성/키보드

- 모든 action은 keyboard path가 있어야 함
- dialog는 Esc 취소/닫기, Enter 기본 action, focus trap 보유
- context menu는 keyboard invocation 지원
- high contrast theme에서 active/selected/error 상태가 색상 외 단서로 구분

## 7. 컴포넌트 테스트 기준

- `FileTable`: 10,000개 fixture에서 virtual row 수 제한
- `ContextMenuLayer`: selected row/blank area별 enabled action 검증
- `OperationDialog`: confirm→progress→complete/conflict/cancel flow 검증
- `HelpDialog`: action registry와 표시 내용 동기화 검증

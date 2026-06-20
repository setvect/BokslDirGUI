# React 컴포넌트 설계

## 1. 목적

Tauri/React UI를 faithful TUI commander identity에 맞게 분해한다. 기본 화면은 좌/우 파일 패널이 지배하고, 보조 기능은 overlay/collapsed로 제공한다.

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
| `ShellCommandDialog` | 현재 경로 기준 shell command preview/confirm/result 표시, backend `prepare_shell_command` → `run_shell_command` 호출 흐름 소유 | action/operation/settings state | 확인 없이 명령 실행 |
| `HelpDialog` | action registry 기반 도움말/검색/About | action registry | 하드코딩 단축키 목록 |


### Operation UI split

- `file.copy`는 TUI copy UX에 맞춰 no-conflict 경로에서 preflight 없이 `startLongRunningOperation`을 시작한다.
- `file.move`, delete, archive extract/create처럼 destructive 또는 명시 확인이 필요한 작업은 `OperationDialog`에서 확인을 거친다.
- operation이 시작된 뒤 사용자가 dialog를 닫아도 `activeOperationController`와 `progress`는 유지된다. 이후 backend summary/conflict/cancel event는 `OperationStatusSurface`에서 표시하고 panel refresh callback을 계속 실행한다.
- backend가 실제 `operationId`를 반환하기 전 취소를 요청하면 synthetic pending id를 backend cancel에 보내지 않고, 실제 id가 확정된 즉시 cancel을 전달한다.

## 4. 상태 store 분리

| Store | 포함 상태 | 비고 |
| --- | --- | --- |
| `panelStore` | left/right current path, tabs, listing version, focused row | panel별 slice |
| `selectionStore` | selected paths, anchor index, selection mode | keyboard/mouse 공통 |
| `navigationStore` | history, editable path draft, drive/mount cache | panel-local + shared cache |
| `actionStore` | action definitions, enabled/disabled state | registry는 static + selectors |
| `operationStore` | queue, progress, conflict prompt, summary | Rust event 기반 |
| `settingsStore` | theme, language, editor, display preferences | persisted |

## 5. 렌더링 규칙

- `FileTable`은 TanStack Table state와 TanStack Virtual row virtualization을 조합한다.
- row height는 commander density를 유지하는 design token으로 고정/준고정한다.
- active row와 selected row는 색상만이 아니라 marker/text style로도 구분한다.
- path/header는 한 줄을 기본으로 하고, 긴 경로는 middle ellipsis + tooltip/address edit로 처리한다.
- sidebar/preview/queue는 기본 화면 persistent 영역이 아니라 overlay/collapsed로 시작한다.

## 6. 접근성/키보드

- 모든 action은 keyboard path가 있어야 한다.
- dialog는 Esc 취소/닫기, Enter 기본 action, focus trap을 갖는다.
- context menu는 keyboard invocation을 지원한다.
- high contrast theme에서 active/selected/error 상태가 색상 외 단서로 구분된다.

## 7. 컴포넌트 테스트 기준

- `FileTable`: 10,000개 fixture에서 virtual row 수 제한.
- `ContextMenuLayer`: selected row/blank area별 enabled action 검증.
- `OperationDialog`: confirm→progress→complete/conflict/cancel flow 검증.
- `HelpDialog`: action registry와 표시 내용 동기화 검증.

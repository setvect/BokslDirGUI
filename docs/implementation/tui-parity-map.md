# TUI 기능 동등성 매핑

## 1. 목적

기존 TUI 기반 BokslDir 기능을 GUI 구현 단위로 매핑해, 첫 구현이 축소 범위가 아니라 **기존 TUI 기능 동등성**을 만족하도록 한다.

## 2. 매핑 원칙

| 원칙 | 설명 |
| --- | --- |
| TUI 정체성 유지 | 좌/우 패널, 활성 패널, 반대 패널 대상 작업, 하단 hotkey strip을 유지한다. |
| GUI 접근성 추가 | 기존 단축키 기능은 메뉴/컨텍스트 메뉴/마우스 흐름에서도 접근 가능해야 한다. |
| 안전 경계 강화 | 파일 변경 작업은 Rust command/service를 통해서만 실행한다. |
| 보조 기능은 기본 패널을 침범하지 않음 | 사이드바/미리보기/작업 큐는 overlay/collapsed/command-invoked 방식 우선. |

## 3. 기능 매핑

| TUI/기존 기능 영역 | GUI 대응 | 주요 컴포넌트 | Command/API | 테스트 기준 |
| --- | --- | --- | --- | --- |
| 좌/우 듀얼 패널 | 두 개의 FilePanel, 활성 패널 강조 | `CommanderShell`, `FilePanel` | `list_dir`, `watch_path` | 양쪽 패널이 독립 경로/정렬/선택/스크롤 유지 |
| 파일 목록/메타데이터 | 조밀한 table row, 타입 아이콘, 권한/크기/날짜 컬럼 | `FileTable`, `FileRow` | `list_dir`, `get_metadata` | 10,000개 항목 virtualized rendering |
| 디렉토리 진입/상위 이동 | Enter/double click/up action/compact breadcrumb | `PanelHeader`, `PathControls` | `list_dir` | 진입 후 오류/권한 부족이 패널 오류로 표시 |
| 패널 전환 | Tab/click focus | `CommanderShell` | none | 키보드/마우스가 같은 active panel state 사용 |
| 패널별 탭 | 탭 생성/닫기/전환, 마지막 탭 보호 | `TabStrip`, `FilePanel` | `list_dir` | 패널별 탭 상태 독립 유지 |
| 선택/다중 선택 | Space, Shift click, Cmd/Ctrl click, drag selection 후보 | `SelectionModel`, `FileTable` | none | 선택/포커스/작업 대상이 구분됨 |
| 정렬/필터/숨김 파일 | 컬럼 헤더, filter bar/overlay, hotkey | `FileTable`, `FilterOverlay` | `list_dir` 또는 client filter | 이름/크기/날짜/확장자, glob 필터 검증 |
| 복사/이동 | 반대 패널 기본 대상, 확인/충돌/진행률 | `OperationDialog`, `ProgressDialog` | `start_copy`, `start_move`, `resolve_conflict` | `overwrite`/`skip`/`allOverwrite`/`allSkip`/`cancel`, progress event |
| 삭제/휴지통/영구 삭제 | 휴지통/영구 삭제 구분, 강한 확인 | `DeleteDialog` | `start_delete` | trash/permanent policy, undo 후보 |
| 새 폴더/이름 변경 | dialog + inline rename 후보 | `CreateDirDialog`, `RenameInline` | `create_dir`, `rename_entry` | 빈 이름/중복/권한 오류 |
| 속성 보기 | modal dialog | `PropertiesDialog` | `get_metadata` | 파일/디렉토리/링크 metadata 표시 |
| 압축/해제/미리보기 | archive list/extract/create dialog | `ArchiveDialog` | `archive_list`, `archive_extract`, `archive_create` | zip/tar/zstd/7z fixture, zip-slip 방지 |
| 북마크/히스토리 | compact 위치 overlay, panel history | `BookmarkDialog`, `HistoryPopover` | `load_settings`, `save_settings` | 재시작 후 복원, 중복 방지 |
| 기본 앱/외부 편집기 | open/reveal/editor action | `ContextMenuLayer`, `ExternalOpenDialog` | `open_default`, `reveal_in_manager`, `open_external_editor` | OS별 실패 메시지 |
| 외부 shell command | 현재 경로에서 명시 확인 후 command 실행 | `ShellCommandDialog` | `prepare_shell_command` → `run_shell_command` | 기본 비활성/확인/종료 코드/오류 표시 |
| 정렬/필터/보기 설정 | sort/filter/hidden/size format/theme/language | `TopMenuBar`, `FileTable`, `SettingsDialog` | `list_dir`, `save_settings` | action registry coverage 검사 |
| 도움말/단축키 | action registry 기반 help | `HelpDialog` | none | action registry와 help 내용 일치 |
| 설정/테마/i18n | settings dialog, runtime apply | `SettingsDialog` | `load_settings`, `save_settings` | 테마/언어 저장/복원 |

## 4. GUI 확장 매핑

| GUI 확장 | 기준 포함 여부 | 이유 | 제약 |
| --- | --- | --- | --- |
| 우클릭 컨텍스트 메뉴 | 포함 | GUI 파일 매니저 기본 상호작용 | action registry 참조 |
| 더블클릭 | 포함 | 폴더 진입/기본 앱 열기 기대 | Enter와 같은 action |
| Drag and drop | 포함하되 단계적 | GUI 전환 요구 | drop 후 Rust validation 필수 |
| 미리보기 패널 | 포함하되 기본 숨김 | 요구사항상 Should, UI identity 보호 | 기본 화면 침범 금지 |
| 작업 큐 패널 | 포함하되 overlay/collapsed | 장시간 작업 visibility | panel dominance 유지 |
| 명령 팔레트 | 후속 검토 | 생산성 확장 | action registry 기반일 때만 |

## 5. 완료 판정

기능 동등성 완료는 모든 Must 기능이 GUI 경로와 키보드 경로에서 동작하고, 파일 변경 작업이 상태 머신과 테스트 명세의 안전 조건을 통과했을 때만 선언한다.

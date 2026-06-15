# 전체 범위 테스트 명세

## 1. 목적

기존 TUI 기능 동등성 및 GUI 전환 필수 기능의 완료 판정을 위한 테스트 기준을 정의한다.

## 2. 테스트 계층

| 계층 | 도구 | 대상 |
| --- | --- | --- |
| Rust unit | cargo test | path validation, conflict policy, operation state, archive safety |
| Rust integration | assert_fs/tempfile | 실제 fixture 기반 copy/move/delete/archive |
| Frontend unit | Vitest | stores, action registry, DTO wrapper |
| Component | Testing Library/user-event | FileTable, Dialog, ContextMenuLayer, Help |
| E2E/visual | Playwright | dual panel shell, menu flows, dialogs, no dashboard chrome |
| Tauri smoke | cargo tauri dev/build | command bridge, plugin permissions |
| Platform matrix | macOS/Windows/Linux | trash, reveal, open default, mount/drive, DnD |

## 3. 기능 동등성 시나리오

공통 충돌 결정은 전 문서에서 `type ConflictDecision = 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel'`로 검증한다.


### 3.1 탐색/패널

- 앱 시작 시 좌/우 패널이 표시되고 active panel이 명확하다.
- 시작 탭/경로 복원: 시작 경로가 없으면 이전 종료 상태 또는 안전한 기본 경로로 복원된다.
- 유효하지 않은 시작 경로는 앱 종료가 아니라 panel error/fallback으로 처리된다.
- 각 패널은 독립 경로, 탭, 정렬, 필터, 선택, 스크롤을 유지한다.
- 탭 생성/닫기/전환이 동작하고 마지막 탭은 닫히지 않는다.
- `nav.back`/`nav.forward`/`history.list`와 `bookmark.add`/`bookmark.list`/`bookmark.rename`/`bookmark.delete`: 패널별 히스토리 back/forward 목록과 북마크 추가/이름 변경/삭제/중복 방지가 동작한다.
- Enter/double click으로 폴더 진입, Backspace/up으로 상위 이동.
- 뒤로/앞으로/refresh/주소 입력/drive quick access가 동작한다.
- `layout.toggleSingleDual` 및 `layout.ratio50`/`layout.ratio70Left`/`layout.ratio70Right`: single-panel/dual-panel 전환과 50:50/70:30/30:70 panel ratio가 상태 손실 없이 동작한다.

### 3.2 파일 목록/선택

- 파일/디렉토리/링크/실행 파일 타입을 구분한다.
- 숨김 파일 toggle, 정렬, glob/부분 문자열 필터가 동작한다.
- 단일/다중/범위/전체/반전/해제 선택이 같은 selection model을 사용한다.
- 10,000개 항목 fixture에서 rendered row 수가 virtual range로 제한된다.

### 3.3 파일 작업

- copy/move/delete/trash/permanent delete/create dir/rename/properties가 성공/실패 fixture를 가진다.
- conflict prompt가 `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel`을 구분하고 `allOverwrite`/`allSkip`를 이후 충돌에 일관 적용한다.
- cancel은 partial summary를 제공한다.
- 권한 오류/디스크 오류/존재하지 않는 경로가 앱 crash로 이어지지 않는다.

### 3.4 압축

- zip/jar/war list/create/extract.
- tar/tar.gz/tar.zst list/create/extract.
- 7z list/create/extract/password fixture.
- zip-slip/path traversal fixture 차단.
- 암호는 화면 masking, 로그 미기록.

### 3.5 외부 연동

- `external.openDefault` action은 `open_default` command로 연결되며 OS 기본 앱 열기를 시도하고 실패 시 사용자 메시지를 표시한다.
- `external.reveal` action은 `reveal_in_manager` command로 연결되며 Finder/Explorer/파일 관리자에서 위치 표시를 시도하고 OS별 실패를 처리한다.
- `external.openEditor` action은 `open_external_editor` command로 연결되며, 설정된 편집기 또는 명시 선택을 사용하고 실행 전 확인/실패/종료 코드 메시지를 제공한다.
- `external.runShellCommand` action은 `prepare_shell_command` → `run_shell_command` command로 연결되며, disabled by default 정책(`external.shellCommand.enabled`), explicit confirmation, workingDir 검증, confirmToken TTL/one-shot/fingerprint 재검증, exitCode/stdout/stderr 표시를 검증한다.

### 3.6 GUI/UX

- 우클릭 컨텍스트 메뉴는 row/blank/selection scope별 항목이 다르다.
- 메뉴/단축키/컨텍스트 메뉴가 같은 action 결과를 낸다.
- `view.sortName`/`view.sortSize`/`view.sortDate`/`view.sortExt`/`view.reverseSort`, `filter.start`/`filter.clear`, `view.toggleHidden`, `selection.invert`/`selection.clear`, `layout.toggleSingleDual`, `history.list`, `bookmark.add`/`bookmark.list`, `settings.theme`/`settings.language`/`settings.sizeFormat`, `archive.preview`, `help.search`/`help.about` action이 registry에 존재하고 UI에서 같은 enablement를 사용한다.
- Space는 focused concrete row 선택을 토글한 뒤 다음 row로 이동하고, `..` virtual row에서는 선택하지 않고 아래 row로 이동한다.
- 명시 선택이 없는 파일 작업은 focused concrete row를 effective source로 사용하며, registry enablement와 operation dialog source 목록이 같은 대상을 보여야 한다.
- path/refresh/back/up 같은 non-modal control 클릭 뒤에는 shell이 keyboard owner를 되찾아 다음 Space/화살표 입력이 commander 동작으로 처리되어야 한다.
- Cmd/Ctrl `+`, Cmd/Ctrl `-`, Cmd/Ctrl `0`은 글자 크기뿐 아니라 row height, header/status/hotkey strip 높이, padding, virtualizer estimate까지 같이 조정하고 `Settings.view.zoomStep`으로 저장/복원되어야 한다.
- Zoom 단계는 예측 가능한 preset(`75/80/90/100/110/125/150/175/200%`)으로 표시되어야 한다.
- 확대/축소 후 표시되는 metadata 컬럼(size/modified/created/permissions/owner)은 중간에 ellipsis로 잘리지 않아야 하며, listing 변경 시 계산한 실제 항목의 metadata 표시 길이를 반영해 공간 부족 시 owner → created → permissions → size → modified 순으로 숨겨야 한다.
- 긴 파일명은 Unicode grapheme-safe middle ellipsis로 표시해 뒤쪽 확장자/식별자를 보존해야 한다. `Intl.Segmenter`가 없는 환경에서도 fallback 분할은 원본 문자열을 정규화로 바꾸지 않고 combining mark/variation selector/emoji modifier/ZWJ sequence를 같은 cluster로 유지해야 한다. row hover/focus 정보에는 전체 파일명과 경로/크기/날짜/권한/소유자 정보가 포함되어야 한다.
- filter 적용 상태는 panel header/status와 bottom status에 표시되고, 파일명 substring 매칭 구간이 시각적으로 강조되어야 한다.
- 다이얼로그는 Esc/Enter/focus trap을 지원한다.
- 기본 화면에 persistent sidebar/inspector/large toolbar가 없다.
- bottom status/hotkey strip이 표시된다.

## 4. 정합성 테스트

- action registry에 없는 action ID를 메뉴/도움말/컴포넌트가 참조하지 않는다.
- Tauri command API 문서의 command는 action registry와 component design에서 같은 이름으로 참조된다.
- state machine의 operation state는 command event payload와 일치한다.
- 기준 기능 목록은 TUI parity map의 모든 Must 항목을 포함한다.

## 5. 완료 게이트

- 모든 기준 기능 테스트가 통과해야 기능 동등성 완료.
- 7z 게이트 실패 시 archive 기능은 부분 완료로 표시하고 release note에 제한을 명시한다.
- 플랫폼별 미검증 항목은 완료가 아니라 “지원 예정/검증 필요”로 남긴다.
- destructive operation 테스트는 실제 사용자 파일이 아닌 temp fixture에서만 수행한다.

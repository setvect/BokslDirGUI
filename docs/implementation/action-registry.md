# 액션 레지스트리 설계

## 1. 목적

- 메뉴·단축키·컨텍스트 메뉴·hotkey strip·도움말의 동일한 action 정의 참조

## 2. Action 모델

- 실제 `AppAction` 계약과 액션 선언의 기준: [`src/actions/registry.ts`](../../src/actions/registry.ts)
- `shortcutLabel`: 사용자에게 표시할 설명, `keyboardBindings`: 실제 키 입력 매칭 기준
- `command`·`runPath`: 명령 및 실행 경로 정보, 실제 실행·비동기 처리·상태 소유권은 기존 UI 훅·operation store·Tauri 계층 유지

| 내부 속성 | 의미 | 생략 시 의미 |
| --- | --- | --- |
| `requiresConcreteSources` | 가상 항목을 제외한 대상 파일 필요 여부 | 대상 요구 없음 |
| `dialogKind` | 공통 정의의 작업 다이얼로그 종류 | 작업 다이얼로그 없음 |
| `setting` | 테마·언어·크기 표시의 종류와 값 또는 아이콘 토글 | 설정 액션 아님 |

- 설정 종류별 타입과 체크·변경 값 계산: [`settingActions.ts`](../../src/actions/settingActions.ts) 기준
- 다이얼로그 종류·실행 모드·장시간 작업 종류: [`dialogDefinitions.ts`](../../src/operations/dialogDefinitions.ts) 기준
- 레지스트리에 React 컴포넌트·store·Tauri 실행 함수 추가 금지
- 공통 정의에서 레지스트리 역참조 금지

## 3. 기본 액션 목록

- 다음 생성 구간은 `npm run docs:generate`로 갱신, 직접 편집 금지

<!-- BEGIN GENERATED:action-table -->
| ID | 범주 | 표시 단축키 | 실제 키 바인딩 | 메뉴 | 위험도 | 실행 경로 |
| --- | --- | --- | --- | --- | --- | --- |
| `menu.open` | navigation | F9 | `F9` | 없음 | none | UI state |
| `panel.switchActive` | panel | Tab | `Tab` | View | none | UI state |
| `panel.swapPaths` | panel | ts | `t s` | View > Swap Panel Paths | none | UI state |
| `panel.copyPathToOther` | panel | tp | `t p` | View > Copy Path to Other Panel | safe | UI state + list_dir |
| `panel.compareDirectories` | panel | tc | `t c` | View > Compare Directories | none | UI state |
| `nav.enter` | navigation | Enter/l | `Enter`, `l` | File > Open | safe | list_dir/open_default |
| `external.openWith` | file | 없음 | 없음 | File > Open With… | safe | list_open_with_apps/open_with_app |
| `nav.up` | navigation | Backspace/h | `Backspace`, `h` | Go > Up | safe | list_dir |
| `nav.back` | navigation | Alt+Left | `Alt+ArrowLeft` | Go > Back | safe | list_dir |
| `nav.forward` | navigation | Alt+Right | `Alt+ArrowRight` | Go > Forward | safe | list_dir |
| `nav.refresh` | navigation | Ctrl+R | `Ctrl+R` | View > Refresh | safe | list_dir |
| `nav.gotoPath` | navigation | gp | `g p` | View > Go To Path | safe | goto_path |
| `nav.locations` | navigation | gm | `g m` | View > Mount Points | safe | list_locations |
| `nav.top` | navigation | gg | `g g` | Go > Top | none | UI state |
| `nav.bottom` | navigation | G | `Shift+G` | Go > Bottom | none | UI state |
| `tab.new` | panel | tn | `t n` | View > New Tab | none | UI state + list_dir |
| `tab.close` | panel | tx | `t x` | View > Close Tab | none | UI state |
| `tab.list` | panel | tt | `t t` | View > Tab List | none | UI state |
| `selection.toggle` | selection | Space | `Space` | Edit > Select | none | UI state |
| `selection.all` | selection | Ctrl+A | `Ctrl+A` | Edit > Select All | none | UI state |
| `file.undoTrash` | file | Cmd+Z | `Cmd+Z`, `Ctrl+Z` | Edit > Undo Move to Trash | safe | preview_trash_undo/start_trash_undo |
| `file.clipboardCopy` | file | Cmd+C | `Cmd+C`, `Ctrl+C` | Edit > Copy | safe | macOS/Windows write_file_clipboard / UI clipboard state |
| `file.clipboardCut` | file | Ctrl+X | `Ctrl+X` | Edit > Cut | safe | Windows write_file_clipboard / UI clipboard state |
| `file.clipboardPaste` | file | Cmd+V | `Cmd+V`, `Ctrl+V` | Edit > Paste | safe | start_copy/start_move/archive_extract/archive_add |
| `file.clipboardMovePaste` | file | Opt+Cmd+V | `Alt+Cmd+V` | Edit > Move Here | destructive | start_move via confirmation dialog |
| `file.copy` | file | y/F5 | `y`, `F5` | Edit > Copy to Other Panel | safe | start_copy |
| `file.move` | file | x/F6 | `x`, `F6` | Edit > Move | destructive | start_move |
| `file.trash` | file | d | `d` | File > Delete | destructive | start_delete trash |
| `file.deletePermanent` | file | Shift+D/Shift+Delete | `Shift+D`, `Shift+Delete` | File > Permanent Delete | irreversible | start_delete permanent |
| `file.mkdir` | file | a/F7 | `a`, `F7` | File > New Folder | safe | create_dir |
| `file.rename` | file | r/F2 | `r`, `F2` | File > Rename | destructive | rename_entry |
| `file.bulkRename` | file | 없음 | 없음 | File > Bulk Rename | destructive | preview_bulk_rename/start_bulk_rename |
| `remote.sites` | navigation | gr | `g r` | Remote > Sites… | none | site list → remote_connect |
| `remote.connect` | navigation | 없음 | 없음 | Remote > New Connection… | none | remote_connect |
| `remote.disconnect` | navigation | gd | `g d` | Remote > Disconnect | safe | remote_disconnect |
| `remote.reconnect` | navigation | 없음 | 없음 | Remote > Reconnect | none | remote_connect |
| `remote.info` | navigation | 없음 | 없음 | Remote > Connection Info | none | remote_sessions |
| `remote.chmod` | file | 없음 | 없음 | Remote > Change Permissions… | destructive | start_remote_chmod |
| `app.quit` | file | Cmd+Q | `Cmd+Q` | File > Quit | none | getCurrentWindow().close via explicit menu/platform quit shortcut |
| `file.properties` | file | i | `i` | View > File Info | safe | get_metadata |
| `file.quickView` | file | F3 | `F3` | View > Quick View | safe | preview_file |
| `archive.list` | archive | Enter on archive | 없음 | Archive > Open Archive | safe | archive_list virtual-directory |
| `archive.extract` | archive | zx | `z x` | File > Archive Extract | destructive | archive_extract |
| `archive.extractAuto` | archive | za | `z a` | File > Archive Extract Auto | destructive | archive_extract auto |
| `archive.create` | archive | zc | `z c` | File > Archive Compress | safe | archive_create |
| `external.openDefault` | file | o | `o` | File > Open Default App | safe | open_default |
| `external.reveal` | file | 없음 | 없음 | File > Reveal | safe | reveal_in_manager |
| `external.openCurrentInFileManager` | navigation | 없음 | 없음 | Go > Open Current Folder in File Manager | safe | open_current_in_file_manager |
| `external.openCurrentInTerminal` | navigation | 없음 | 없음 | Go > Open Terminal Here | safe | open_current_in_terminal |
| `view.sortName` | view | sn | `s n` | View > Sort > Name | none | UI state + list_dir |
| `view.sortSize` | view | ss | `s s` | View > Sort > Size | none | UI state + list_dir |
| `view.sortDate` | view | sd | `s d` | View > Sort > Modified Date | none | UI state + list_dir |
| `view.sortExt` | view | se | `s e` | View > Sort > Extension | none | UI state + list_dir |
| `view.reverseSort` | view | sr | `s r` | View > Sort > Reverse | none | UI state + list_dir |
| `view.sortAsc` | view | 없음 | 없음 | View > Sort > Ascending | none | UI state + list_dir |
| `view.sortDesc` | view | 없음 | 없음 | View > Sort > Descending | none | UI state + list_dir |
| `filter.start` | view | / | `/` | View > Filter | none | UI state |
| `filter.clear` | view | Esc in filter | 없음 | View > Clear Filter | none | UI state + list_dir |
| `view.toggleHidden` | view | . | `.` | View > Hidden Files | none | UI state + list_dir |
| `selection.invert` | selection | v | `v` | Edit > Invert Selection | none | UI state |
| `selection.clear` | selection | u | `u` | Edit > Clear Selection | none | UI state |
| `layout.toggleSingleDual` | view | Ctrl+W | `Ctrl+W` | View > Toggle Layout | none | UI state |
| `layout.ratio50` | view | 없음 | 없음 | View > Panel Ratio > 50:50 | none | UI state |
| `layout.ratio70Left` | view | 없음 | 없음 | View > Panel Ratio > 70:30 | none | UI state |
| `layout.ratio70Right` | view | 없음 | 없음 | View > Panel Ratio > 30:70 | none | UI state |
| `history.list` | navigation | th | `t h` | View > History List | none | UI state |
| `bookmark.add` | navigation | Ctrl+B | `Ctrl+B` | View > Bookmark Add | safe | save_settings |
| `bookmark.list` | navigation | tb | `t b` | View > Bookmark List | none | UI state |
| `bookmark.rename` | navigation | 없음 | 없음 | Go > Bookmark > Rename | safe | save_settings |
| `bookmark.delete` | navigation | 없음 | 없음 | 없음 | destructive | bookmark list → save_settings |
| `settings.themeDark` | settings | 없음 | 없음 | Settings > Theme > Dark | none | save_settings |
| `settings.themeLight` | settings | 없음 | 없음 | Settings > Theme > Light | none | save_settings |
| `settings.themeHighContrast` | settings | 없음 | 없음 | Settings > Theme > High Contrast | none | save_settings |
| `settings.themeMdir` | settings | 없음 | 없음 | Settings > Theme > Mdir | none | save_settings |
| `settings.languageEn` | settings | 없음 | 없음 | Settings > Language > English | none | save_settings |
| `settings.languageKo` | settings | 없음 | 없음 | Settings > Language > Korean | none | save_settings |
| `settings.toggleIcons` | settings | 없음 | 없음 | Settings > Toggle Icons | none | save_settings |
| `settings.sizeAuto` | settings | 없음 | 없음 | Settings > File Size Format > Auto | none | save_settings |
| `settings.sizeBytes` | settings | 없음 | 없음 | Settings > File Size Format > Bytes | none | save_settings |
| `settings.remoteLinksPreserve` | settings | 없음 | 없음 | Settings > Remote Links > Preserve Links | none | save_settings |
| `settings.remoteLinksFollow` | settings | 없음 | 없음 | Settings > Remote Links > Copy Link Targets | none | save_settings |
| `settings.remoteLinksSkip` | settings | 없음 | 없음 | Settings > Remote Links > Skip Links | none | save_settings |
| `external.runShellCommand` | file | : | `:` | File > Run Shell Command | destructive | ShellCommandDialog → prepare_shell_command → run_shell_command |
| `help.shortcuts` | help | ? | `?` | Help > Keyboard Help | none | dialog |
| `help.search` | help | 없음 | 없음 | Help > Search | none | UI state |
| `help.about` | help | 없음 | 없음 | Help > About | none | dialog |
<!-- END GENERATED:action-table -->

## 4. Context rules

- `external.openWith`: macOS 단일 파일의 연결 앱 조회 후 선택한 앱으로 한 번 열기
- `file.copy`: 일반→일반 `start_copy`, 압축 내부→일반 `archive_extract`, 일반→압축 내부 `archive_add`로 실행
- `app.quit`: macOS `Cmd+Q`, Windows `Alt+F4`로 현재 Tauri 창 종료 요청
- 플랫폼 단축키: 기본 액션 표의 macOS 표시값에 액션 속성 `windowsShortcut`의 Windows 표시·실행 바인딩 적용
- 플랫폼 제한 속성: 백엔드 기능 필요(`platformFeature`), 단축키 플랫폼 제한(`shortcutPlatforms`), 가용성 판정(`isActionAvailable`)이 함께 확인하므로 각 액션 `isEnabled`에 플랫폼 조건 중복 금지
- 실행 플랫폼 판정: `src/domain/runtimePlatform.ts` 하나에서 userAgent 기준, 백엔드 `PlatformInfo`가 있으면 그 값 우선, 기능 정보를 받기 전 기본값은 macOS 기능 기준
- Windows 복사·잘라내기·붙여넣기·휴지통 이동 취소: `Ctrl+C`·`Ctrl+X`·`Ctrl+V`·`Ctrl+Z` 유지
- Windows의 `Cmd` 바인딩·Mac 전용 이동 붙여넣기 안내 제외, 메뉴·도움말·하단 안내·접근성·키 매칭에 공통 조회 사용
- 종료 검증 경계: 프론트엔드로 전달된 종료 키의 작업 중 차단 회귀 포함, OS가 직접 처리하는 `Alt+F4`의 실제 VM 입력 확인은 별도 필요
- `bookmark.delete`: 북마크 목록의 지정 항목 삭제 버튼으로 실행, 현재 경로 기준 삭제 메뉴 미노출

- `ActionContext`는 active panel, focused entry, selected entries, opposite panel path, operation state, settings 포함
- action enablement는 메뉴/컨텍스트 메뉴/hotkey strip/help에서 같은 selector 사용
- hotkey strip은 action registry의 우선순위 목록을 사용하되 화면 폭과 확대 배율에 따라 표시 개수를 동적으로 조정
- 좁은 화면에서는 핵심 조작만 남기고, 넓은 화면에서는 추가 action hint를 더 노출
- destructive/irreversible action은 command 실행 전 dialog 정책을 수행; 활성화된 셸 명령은 명령 입력 후 추가 확인 없이 실행
- 압축 가상 디렉터리는 **읽기 전용 패널**
- `file.copy`는 압축 내부→일반 디렉터리 추출 및 일반 디렉터리→압축 내부 추가로 허용하지만, `file.move`, `file.trash`, `file.deletePermanent`, `file.rename`, `file.mkdir`는 action registry에서 비활성화
- 패널 상태줄은 `압축 내부 읽기 전용`을 표시해 비활성화 이유 설명
- 압축 내부 직접 삭제/이름 변경/이동은 provider별 재작성 방식과 원자성 차이로 인해 지원하지 않음
- 사용자는 복사/추출 후 일반 파일 시스템에서 변경하고 필요하면 새 압축 파일 생성
- `external.runShellCommand`는 `ShellCommandDialog`에서 명령 입력 후 입력 확정 후 backend `prepare_shell_command`의 토큰을 같은 입력의 `run_shell_command`에 전달
- 기본 비활성 설정을 유지하며 작업 디렉터리/명령/종료 코드/표준 오류를 사용자에게 표시

## 5. Shortcut rules

- 기존 TUI 단축키를 우선 제공하고 GUI 표준 단축키를 병행 가능
- 파일 패널의 Page Up/Down 및 Ctrl/Cmd+U/D: 표시 가능한 행 수에서 1행을 뺀 만큼 커서·스크롤 동시 이동, 최소 1행 이동
- 페이지 이동 시 커서의 화면 내 세로 위치 유지, 목록 처음·끝에서 이동 제한, Shift 조합 시 범위 선택 확장
- 페이지 이동량 계산 시 활성 패널의 현재 높이·확대 배율 반영
- single key shortcut은 text input/edit mode에서는 비활성화
- F3 빠른 보기의 `i`: 공통 `file.properties` 바인딩으로 현재 미리보기 파일의 정보 영역 토글, 동일 `get_metadata`와 파일 정보 표시 컴포넌트 사용
- 빠른 보기의 정보 버튼과 `i`는 같은 토글 경로 사용, 입력·네이티브 버튼·상세 펼치기의 키보드 소유권 유지
- 빠른 보기에서 `Esc`는 정보 영역을 포함한 미리보기 닫기, 파일 목록 포커스 복원
- sequence shortcut은 timeout 후 초기화
- 사용자 커스터마이징은 후속 가능하지만, 충돌 검증 없이는 저장하지 않음

## 6. Help/menu generation

- 도움말은 registry에서 category, label, shortcut, menuPath를 읽어 생성
- 단축키 도움말은 넓은 창에서 이동·패널·파일·보기 제목을 각 열의 같은 시작선에 맞추고, 남은 범주를 열 높이가 비슷하도록 배치
- 좁은 창에서는 열 수를 줄이며, 높이가 부족하면 도움말 목록이 스크롤
- 도움말이 열려 있는 동안 화살표·Page Up/Down·Home/End는 파일 패널 대신 목록 스크롤에 적용
- 메뉴 구조도 registry에서 생성하거나 registry ID 참조
- hardcoded menu handler는 금지

## 7. 테스트 기준

- 모든 menu item은 유효한 action ID 참조
- 모든 context menu item은 scope에 맞는 enablement 보유
- help dialog의 shortcut 목록은 registry snapshot과 일치
- irreversible action은 confirm dialog 없이 command를 호출하지 않음


## 복사·붙여넣기 범위

- macOS는 Finder처럼 `Cmd+C`로 항목을 준비한 뒤 `Cmd+V`로 복사하거나 `Opt+Cmd+V`로 이동
- Windows·Linux는 `Ctrl+C`로 복사 준비, `Ctrl+X`로 이동 준비, `Ctrl+V`로 활성 패널의 현재 폴더에 붙여넣기
- 잘라내기는 원본을 즉시 변경하지 않으며, 이동 확인 다이얼로그와 Rust의 충돌·취소 처리 수행
- 완전히 이동했을 때 복사 목록을 비우고, 일부만 이동한 경우에는 남은 항목을 다시 선택하도록 안내

- 선택 항목이 있으면 이를, 없으면 포커스 항목 사용
- macOS·Windows의 복사 목록은 시스템 파일 클립보드에 기록, Finder·Explorer와 양방향 붙여넣기 지원([Finder·Explorer 파일 클립보드 연동](../requirements/04-gui-desktop-interactions.md#finderexplorer-파일-클립보드-연동))
- 가상 압축 항목, 그 밖의 플랫폼, 브라우저 미리보기의 복사 목록은 앱 내부에만 유지, 반복 붙여넣기 가능, 앱 종료 시 삭제
- 탐색줄 경로 텍스트를 선택한 상태의 `Cmd+C`·`Ctrl+C`는 선택한 텍스트의 시스템 클립보드 복사 우선
- 경로 텍스트 복사 시 앱 내부 파일 복사 목록 유지
- 경로 텍스트 선택이 없으면 기존 파일 복사 액션 실행
- 입력 필드와 다이얼로그의 문자 복사·붙여넣기는 해당 UI가 처리
- 같은 폴더에 붙여넣기는 원본 덮어쓰기를 피하도록 안내하고 실행하지 않음
- 압축 내부 항목은 복사만 가능하고 이동은 차단
- `y/F5`와 `x/F6`는 기존처럼 반대 패널을 대상으로 하며, 이동은 확인 다이얼로그 수행

## 원격 패널 액션

- 근거: [SFTP 요구사항](../requirements/07-remote-sftp.md) 4절, 2026-10-31 구현
- 속성 `remoteSupport`: `localOnly`는 원격 패널에서 비활성, `remoteOnly`는 원격 패널에서만 활성, 생략 시 양쪽 지원
- 판정 위치: `isActionAvailable`, 메뉴·컨텍스트 메뉴·단축키 공통
- 컨텍스트 값: `activePathIsRemote`(활성 패널 경로), `activeRemoteConnected`(공유 상태의 연결된 세션 목록 기준)

| 구분 | 액션 |
| --- | --- |
| 원격(R) 메뉴 | `remote.sites`(g r)·`remote.connect`·`remote.disconnect`(g d)·`remote.reconnect`·`remote.info`·`remote.chmod` |
| 원격 빈 영역 메뉴 추가 | 연결 해제·다시 연결·연결 정보 |
| 의미 변경 | `file.trash`(d)는 원격 패널에서 `file.deletePermanent` 확인 흐름으로 전환 |
| 받은 뒤 실행 | `file.quickView`(앞부분만 받기), `external.openDefault`·Enter(임시 폴더로 받은 뒤 열기) |
| 앱 내부 클립보드 | 복사·잘라내기·붙여넣기, 원격 경로는 OS 파일 클립보드에 기록하지 않음 |
| `localOnly` | `external.openWith`·`external.reveal`·`external.openCurrentInFileManager`·`external.openCurrentInTerminal`·`external.runShellCommand`·`file.undoTrash`·`archive.*` |
| 설정 | `settings.remoteLinksPreserve`·`settings.remoteLinksFollow`·`settings.remoteLinksSkip`(설정 > 원격 링크 처리) |

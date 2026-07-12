# BokslDir TUI ↔ GUI parity matrix

- 기준일: 2026-06-17
- 원천 TUI 코드: `/Users/boksl/IdeaProjects/BokslDir/src/core/actions.rs`, `/Users/boksl/IdeaProjects/BokslDir/src/ui/components/dropdown_menu.rs`
- GUI 기준: `src/actions/registry.ts`
- 기계 검증 원본: `docs/implementation/tui-parity-matrix.json`

## 목적

이 문서는 기존 BokslDir TUI의 액션, 키 바인딩, 메뉴/서브메뉴 항목을 GUI 구현 상태와 1:1로 대조하는 Phase 0 하드 게이트다. `implemented`가 아닌 항목은 기능 완료로 주장할 수 없다. Space/Shift 선택, theme/language/size/session 복원, 실제 파일 작업, 메뉴 조작은 사용자 시나리오 증거가 있어야 완료로 인정한다.

## 상태 기준

| 상태 | 의미 | 완료 주장 가능 여부 |
| --- | --- | --- |
| `implemented` | GUI action/menu/key behavior가 TUI 의미와 동등하고 증거가 있음 | 가능 |
| `partial` | 일부 command/UI/registry는 있으나 키·메뉴·동작 의미가 완전 동등하지 않음 | 불가 |
| `stub` | UI 또는 adapter만 있고 실제 동작은 stub/preview | 불가 |
| `planned` | 설계/계획에만 있음 | 불가 |
| `missing` | GUI action/command/menu가 없음 | 불가 |

## 현재 요약

| 상태 | 개수 |
| --- | ---: |
| implemented | 64 |

### P0 gap

- 없음

### 완전 누락 항목

- 없음

## TUI 메뉴 루트

| Root | Hotkey | TUI action ids |
| --- | --- | --- |
| File | f | `new_dir`, `open_default`, `open_terminal_editor`, `run_shell_command`, `archive_compress`, `archive_extract`, `archive_extract_auto`, `archive_preview`, `rename`, `delete`, `perm_delete`, `quit` |
| Edit | e | `copy`, `move`, `select_all`, `invert_selection`, `deselect` |
| View | v | `refresh`, `toggle_layout`, `file_info`, `sort_name`, `sort_size`, `sort_date`, `sort_ext`, `sort_asc`, `sort_desc`, `filter_start`, `filter_clear`, `toggle_hidden`, `mount_points`, `goto_path`, `history_list`, `bookmark_list`, `size_auto`, `size_bytes` |
| Settings | s | `theme_dark`, `theme_light`, `theme_contrast`, `language_en`, `language_ko`, `editor_preset_vi`, `editor_preset_vim`, `editor_preset_nano`, `editor_preset_emacs`, `toggle_icons` |
| Help | h | `help_keys`, `about` |

## GUI 전환 확장 action

다음 action은 TUI에 1:1 원천이 없는 GUI 확장이다. 검증 스크립트는 이 목록에 없는 GUI action이 matrix 밖에 남으면 실패해야 한다.

- `external.reveal`: GUI 전환 필수 기능: 시스템 파일 관리자에서 위치 표시
- `archive.list`: 압축 파일을 별도 preview 팝업이 아니라 `archive.zip:/` 가상 디렉터리로 패널에 진입시키는 기본 archive_list 액션
- `layout.ratio50`: GUI dual-panel 비율 직접 조정 확장
- `layout.ratio70Left`: GUI dual-panel 비율 직접 조정 확장
- `layout.ratio70Right`: GUI dual-panel 비율 직접 조정 확장
- `bookmark.rename`: GUI 북마크 관리 확장
- `bookmark.delete`: GUI 북마크 관리 확장
- `help.search`: GUI 도움말 검색 확장
- `view.reverseSort`: GUI convenience toggle retained alongside TUI direct ascending/descending sort actions.

## 전체 matrix

| TUI id | TUI shortcut | TUI menu path | GUI action | Status | Priority | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `move_up` | j / k | - | `__ui_motion.move_up` | implemented | P0 | ArrowUp/k/한글 입력 물리 KeyK 이동을 commander keyboard owner가 처리하며 브라우저 기본 동작을 막고 활성 패널 row focus를 유지한다. |
| `move_down` | - | - | `__ui_motion.move_down` | implemented | P0 | ArrowDown/j/한글 입력 물리 KeyJ 이동을 commander keyboard owner가 처리하며 브라우저 기본 동작을 막고 활성 패널 row focus를 유지한다. |
| `go_parent` | h / l | - | `nav.up` | implemented | P0 | Backspace/h가 nav.up으로 parent 이동을 수행하며, h TUI alias와 브라우저 기본 focus/scroll 억제를 검증했다. |
| `enter` | - | - | `nav.enter` | implemented | P0 | Enter/l이 nav.enter로 포커스 항목을 열며, 디렉터리는 패널 listing으로 진입하고 파일은 backend available 시 기본 앱 열기로 연결하고, browser preview에서는 status-gated 메시지로 차단한다. |
| `go_top` | gg / Home | - | `nav.top` | implemented | P1 | gg/Home이 commander motion 경로로 첫 row에 이동하며 range selection에서도 가상 parent row는 선택하지 않는다. |
| `go_bottom` | G / End | - | `nav.bottom` | implemented | P1 | G/End가 registry/motion 경로로 마지막 row에 이동하며 commander focus를 유지한다. |
| `page_up` | ^U / ^D | - | `__ui_motion.page_up` | implemented | P0 | PageUp/Ctrl+U, 한글 입력 물리 KeyU, Shift+PageUp range selection을 검증했다. |
| `page_down` | - | - | `__ui_motion.page_down` | implemented | P0 | PageDown/Ctrl+D, 한글 입력 물리 KeyD, Shift+PageDown range selection을 검증했다. |
| `toggle_panel` | Tab | - | `panel.switchActive` | implemented | P0 | 웹 기본 focus 이동을 막는 commander keyboard owner가 유지되어야 한다. |
| `toggle_layout` | Ctrl+W | View > Toggle Layout | `layout.toggleSingleDual` | implemented | P1 | Ctrl+W와 View > Toggle Layout가 settings.layout.singlePanel을 저장하고 단일/듀얼 패널 표시를 즉시 반영한다. |
| `tab_new` | tn | - | `tab.new` | implemented | P1 | tn으로 현재 패널 경로를 tab 목록에 추가하고 Tab List overlay에서 확인한다. |
| `tab_close` | tx | - | `tab.close` | implemented | P1 | tx로 현재 패널 tab 목록의 마지막 항목을 닫고 Tab List overlay에서 제거 상태를 확인한다. |
| `copy` | y | Edit > Copy | `file.copy` | implemented | P0 | 선택이 없으면 포커스 항목을 대상으로 확인 다이얼로그 없이 즉시 시작한다. 일반→일반은 `start_copy`, 압축 내부→일반은 선택 entry 기반 `archive_extract`, 일반→압축 내부는 `archive_add`로 라우팅하며 공통 충돌/취소/패널 refresh 정책을 적용한다. |
| `move` | x | Edit > Move | `file.move` | implemented | P0 | TUI Edit > Move 메뉴와 x 단축키를 맞췄고, destructive move는 명시 확인 다이얼로그를 거친 뒤 실제 operation을 시작한다. 충돌/취소는 독립 상태 UI와 Rust start_move overwrite 안전 정책으로 처리한다. |
| `open_default` | o | File > Open Default App | `external.openDefault` | implemented | P1 | o/File > Open Default App가 선택 파일을 OS 기본 앱 command boundary로 전달하고, recoverable backend error는 dialog/status로 표시된다. |
| `open_terminal_editor` | e | File > Open Terminal Editor | `external.openEditor` | implemented | P1 | e/File > Open Terminal Editor는 Settings Default Editor preset 또는 명시 editorId를 사용해 파일을 terminal editor로 연다. |
| `run_shell_command` | : | File > Run Shell Command | `external.runShellCommand` | implemented | P1 | 기본 비활성 정책을 유지하되 TUI File > Run Shell Command 위치로 노출하고, enabled 설정에서 prepare preview와 confirmToken 후 run만 허용한다. |
| `delete` | d | File > Delete | `file.trash` | implemented | P1 | TUI Delete는 GUI에서 File > Delete/d로 노출하고 Rust trash mode로 실행한다. 선택이 없으면 포커스 concrete row를 대상으로 하며, 가상 parent는 제외하고 trash 실패 시 영구 삭제로 fallback하지 않는다. |
| `perm_delete` | D | File > Permanent Delete | `file.deletePermanent` | implemented | P1 | 영구 삭제는 별도 File > Permanent Delete/D action이며 PERMANENT_DELETE 명시 입력 없이는 operation client/Rust confirm token으로 전달되지 않는다. |
| `new_dir` | a | File > New Directory | `file.mkdir` | implemented | P1 | Rust child-name 검증과 atomic command 경로가 있다. |
| `rename` | r | File > Rename | `file.rename` | implemented | P1 | no-replace Rust 경로를 유지해야 한다. |
| `file_info` | i | View > File Info | `file.properties` | implemented | P1 | TUI View > File Info 위치와 i shortcut에 맞췄고, GUI dialog title은 Properties로 metadata DTO를 표시한다. |
| `archive_compress` | zc | File > Archive Compress | `archive.create` | implemented | P1 | zip/jar/war/tar/tar.gz/tgz/tar.zst/tzst/7z 생성을 지원한다. zip/7z 암호는 masked input으로 전달하고 summary/history/error에 기록하지 않는다. |
| `archive_extract` | zx | File > Archive Extract | `archive.extract` | implemented | P1 | 필수 압축 형식의 전체/선택 항목 해제를 지원하고 zip/7z 암호 및 공통 충돌 정책을 적용한다. zip-slip/absolute path 차단은 Rust operation tests가 보장한다. |
| `archive_extract_auto` | za | File > Archive Extract Auto | `archive.extractAuto` | implemented | P1 | TUI za 자동 해제 parity를 추가했다. GUI는 archive basename(예: release-bundle.zip → release-bundle)으로 opposite panel 아래 target folder를 계산하고 같은 Rust archive_extract 경계를 사용한다. |
| `archive_preview` | - | Archive > Open Archive | `archive.list` | implemented | P1 | 필수 형식을 `archive.zip:/` 가상 디렉터리로 열고 Enter/Backspace 탐색을 제공한다. 가상 패널은 읽기 전용이며 copy-in/out만 허용한다. 목록은 50,000개 제한과 “일부만 표시됨” 상태를 제공한다. |
| `toggle_sel` | Space | Edit > Select | `selection.toggle` | implemented | P0 | Space가 포커스된 concrete row 선택을 토글하고 TUI처럼 다음 row로 이동한다. 가상 parent row와 native control keyboard owner 경계도 검증했다. |
| `invert_selection` | v | Edit > Invert Selection | `selection.invert` | implemented | P1 | v가 활성 패널 concrete row 선택을 반전하며 가상 parent row는 선택하지 않는다. |
| `select_all` | ^A | Edit > Select All | `selection.all` | implemented | P1 | Ctrl+A가 활성 패널 concrete row 전체를 선택하고 브라우저 select-all 기본 동작을 억제한다. |
| `deselect` | u | Edit > Deselect | `selection.clear` | implemented | P1 | u가 활성 패널 선택을 해제하며 commander keyboard ownership 경계를 공유한다. |
| `help_keys` | ? | Help > Keyboard Help | `help.shortcuts` | implemented | P1 | ? 및 Help > Keyboard Help가 action registry 기반 shortcut help를 열어 실제 등록 action과 동기화된다. |
| `refresh` | ^R | View > Refresh | `nav.refresh` | implemented | P1 | 현재 panel data source 기반 refresh 경로가 있다. |
| `open_menu` | F9 | - | `menu.open` | implemented | P0 | F9로 File root menu를 열고, Escape/F9 닫기, Left/Right root 이동, Up/Down item 이동, submenu 진입/실행을 처리한다. |
| `quit` | q | File > Quit | `app.quit` | implemented | P1 | 일반 q는 파일명 타이핑 충돌 방지를 위해 사용하지 않고, File > Quit/Cmd+Q만 Tauri current window close 정책으로 연결한다. |
| `theme_dark` | - | Settings > Theme > Dark | `settings.themeDark` | implemented | P0 | Dark theme direct menu action saves settings.theme=dark and updates shell data-theme. |
| `theme_light` | - | Settings > Theme > Light | `settings.themeLight` | implemented | P0 | Light theme direct menu action saves settings.theme=light and updates shell data-theme. |
| `theme_contrast` | - | Settings > Theme > High Contrast | `settings.themeHighContrast` | implemented | P0 | High Contrast direct menu action saves settings.theme=highContrast and updates shell data-theme. |
| `language_en` | - | Settings > Language > English | `settings.languageEn` | implemented | P0 | English language direct menu action saves settings.language=en and updates shell data-language. |
| `language_ko` | - | Settings > Language > Korean | `settings.languageKo` | implemented | P0 | Korean language direct menu action saves settings.language=ko and updates shell data-language. |
| `toggle_icons` | - | Settings > Toggle Icons | `settings.toggleIcons` | implemented | P2 | Settings > Toggle Icons가 settings.view.showIcons를 저장하고 파일 row icon 표시를 즉시 토글한다. |
| `editor_preset_vi` | - | Settings > Default Editor > vi | `settings.editorVi` | implemented | P1 | Settings > Default Editor > vi가 settings.external.editorId=vi로 저장된다. |
| `editor_preset_vim` | - | Settings > Default Editor > vim | `settings.editorVim` | implemented | P1 | Settings > Default Editor > vim이 settings.external.editorId=vim으로 저장되고 open terminal editor 경로에서 사용된다. |
| `editor_preset_nano` | - | Settings > Default Editor > nano | `settings.editorNano` | implemented | P1 | Settings > Default Editor > nano가 settings.external.editorId=nano로 저장된다. |
| `editor_preset_emacs` | - | Settings > Default Editor > emacs | `settings.editorEmacs` | implemented | P1 | Settings > Default Editor > emacs가 settings.external.editorId=emacs로 저장된다. |
| `sort_name` | sn | View > Sort By > Name | `view.sortName` | implemented | P1 | 메뉴 그룹명만 다르다. |
| `sort_size` | ss | View > Sort By > Size | `view.sortSize` | implemented | P1 | 메뉴 그룹명만 다르다. |
| `sort_date` | sd | View > Sort By > Date | `view.sortDate` | implemented | P1 | GUI label은 Modified Date. |
| `sort_ext` | se | View > Sort By > Extension | `view.sortExt` | implemented | P1 | 메뉴 그룹명만 다르다. |
| `sort_asc` | sr | View > Sort Order > Ascending | `view.sortAsc` | implemented | P1 | Ascending sort direct menu action applies asc direction without relying on reverse toggle. |
| `sort_desc` | - | View > Sort Order > Descending | `view.sortDesc` | implemented | P1 | Descending sort direct menu action applies desc direction without relying on reverse toggle. |
| `filter_start` | / | View > Filter | `filter.start` | implemented | P1 | 필터 입력은 list_dir filter로 전달되고 panel/status/chip 및 파일명 match highlight로 적용 상태를 표시한다. |
| `filter_clear` | - | View > Clear Filter | `filter.clear` | implemented | P1 | Clear Filter는 list_dir filter=null로 갱신하고 filter chip/status를 제거한다. |
| `toggle_hidden` | . | View > Toggle Hidden | `view.toggleHidden` | implemented | P1 | 숨김 토글 후 list_dir 갱신 경로가 있다. |
| `mount_points` | gm | View > Mount Points | `nav.locations` | implemented | P1 | gm/View > Mount Points는 list_locations 결과를 Locations overlay로 표시하고 stale async 응답을 무시한다. |
| `goto_path` | gp | View > Go To Path | `nav.gotoPath` | implemented | P1 | gp/View > Go To Path가 Path prompt를 열고 goto_path 결과 listing으로 패널을 이동한다. |
| `tab_list` | tt | - | `tab.list` | implemented | P1 | tt는 현재 패널 tab overlay를 열고 tab_new/tab_close 결과를 확인할 수 있다. |
| `history_back` | Alt+Left | - | `nav.back` | implemented | P1 | 히스토리 state와 list_dir 재요청 경로가 있다. |
| `history_forward` | Alt+Right | - | `nav.forward` | implemented | P1 | history_back과 동일. |
| `history_list` | th | View > History List | `history.list` | implemented | P1 | th/View > History List는 back/current/forward 경로를 overlay로 표시한다. |
| `bookmark_add` | Ctrl+B | - | `bookmark.add` | implemented | P1 | Ctrl+B 및 tb+a가 현재 경로를 settings.bookmarks에 저장한다. |
| `bookmark_list` | tb | View > Bookmark List | `bookmark.list` | implemented | P1 | tb/View > Bookmark List는 저장된 bookmark overlay를 열고 선택 시 해당 경로로 이동한다. |
| `size_auto` | - | View > Size Format > Auto | `settings.sizeAuto` | implemented | P0 | Auto size direct menu action saves the human-readable size format and updates visible file size formatting. |
| `size_bytes` | - | View > Size Format > Bytes | `settings.sizeBytes` | implemented | P0 | Bytes size direct menu action saves the byte size format and updates visible file size formatting. |
| `about` | - | Help > About | `help.about` | implemented | P2 | Help > About이 BokslDirGUI 정체성/기술스택 설명 dialog를 연다. |

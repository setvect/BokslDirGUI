# BokslDir TUI ↔ GUI parity matrix

- 기준일: 2026-06-16
- 원천 TUI 코드: `/Users/boksl/IdeaProjects/BokslDir/src/core/actions.rs`, `/Users/boksl/IdeaProjects/BokslDir/src/ui/components/dropdown_menu.rs`
- GUI 기준: `src/actions/registry.ts`
- 기계 검증 원본: `docs/implementation/tui-parity-matrix.json`

## 목적

이 문서는 기존 BokslDir TUI의 액션, 키 바인딩, 메뉴/서브메뉴 항목을 GUI 구현 상태와 1:1로 대조하는 Phase 0 하드 게이트다. `implemented`가 아닌 항목은 기능 완료로 주장할 수 없다. 특히 copy/move UX, Space/Shift 선택, theme/language/size/session 복원은 후속 구현 전 누락 상태가 명시되어야 한다.

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
| partial | 45 |
| implemented | 12 |
| missing | 7 |

### P0 gap

- `move_up` (partial): GUI는 row 이동을 action registry 밖 UI keyboard owner에서 처리한다. TUI parity 완료 전까지 registry/도움말 추적이 필요하다.
- `move_down` (partial): move_up과 동일한 UI motion 경로.
- `go_parent` (partial): TUI는 Left도 parent다. GUI registry 표시에는 Backspace/h만 있고 Left parity는 별도 확인 필요.
- `enter` (partial): 디렉터리 진입과 파일 기본 열기 분기가 GUI에서 유지되어야 한다.
- `page_up` (partial): Ctrl+U와 Shift+PageUp 선택 확장까지 G004에서 검증 필요.
- `page_down` (partial): Ctrl+D와 Shift+PageDown 선택 확장까지 G004에서 검증 필요.
- `copy` (partial): GUI 메뉴 위치가 TUI Edit와 불일치하며, 현재 copy UX는 no-conflict 즉시 실행/충돌 독립 UI 검증이 필요하다(G003).
- `move` (partial): GUI 메뉴 위치가 TUI Edit와 불일치하며, copy와 같은 UX 수리 대상이다(G003).
- `toggle_sel` (partial): 사용자 보고 기준 Space 선택 reliability가 미완료/회귀 가능성이 있어 G004에서 하드 검증한다.
- `theme_dark` (partial): TUI는 direct submenu action 3개. GUI는 단일 theme action/저장 경로라 직접 선택/시각 적용 검증 필요(G005).
- `theme_light` (partial): theme_dark와 동일.
- `theme_contrast` (partial): theme_dark와 동일.
- `language_en` (partial): TUI direct submenu action 2개. GUI 표시 문자열 실제 변경 검증 필요(G005).
- `language_ko` (partial): language_en과 동일.
- `size_auto` (partial): TUI는 direct submenu. GUI는 단일 action/저장 경로라 실제 표시 변경 검증 필요(G005).
- `size_bytes` (partial): size_auto와 동일.

### 완전 누락 항목

- `archive_extract_auto`: TUI parity 누락. archive_extract_auto action과 자동 폴더명/충돌 정책 설계가 필요하다.
- `quit`: Tauri app quit command/action 설계 필요. 현재 q는 일반 파일명 타이핑/shortcut 충돌 위험이 있어 별도 UX 정책 필요.
- `toggle_icons`: 파일 row icon mode parity 누락.
- `editor_preset_vi`: Default editor direct preset menu 누락.
- `editor_preset_vim`: Default editor direct preset menu 누락.
- `editor_preset_nano`: Default editor direct preset menu 누락.
- `editor_preset_emacs`: Default editor direct preset menu 누락.

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
- `archive.list`: GUI 명칭 확장: archive.preview와 같은 archive_list command를 메뉴에서 명시
- `layout.ratio50`: GUI dual-panel 비율 직접 조정 확장
- `layout.ratio70Left`: GUI dual-panel 비율 직접 조정 확장
- `layout.ratio70Right`: GUI dual-panel 비율 직접 조정 확장
- `bookmark.rename`: GUI 북마크 관리 확장
- `bookmark.delete`: GUI 북마크 관리 확장
- `help.search`: GUI 도움말 검색 확장

## 전체 matrix

| TUI id | TUI shortcut | TUI menu path | GUI action | Status | Priority | Note |
| --- | --- | --- | --- | --- | --- | --- |
| `move_up` | j / k | - | `__ui_motion.move_up` | partial | P0 | GUI는 row 이동을 action registry 밖 UI keyboard owner에서 처리한다. TUI parity 완료 전까지 registry/도움말 추적이 필요하다. |
| `move_down` | - | - | `__ui_motion.move_down` | partial | P0 | move_up과 동일한 UI motion 경로. |
| `go_parent` | h / l | - | `nav.up` | partial | P0 | TUI는 Left도 parent다. GUI registry 표시에는 Backspace/h만 있고 Left parity는 별도 확인 필요. |
| `enter` | - | - | `nav.enter` | partial | P0 | 디렉터리 진입과 파일 기본 열기 분기가 GUI에서 유지되어야 한다. |
| `go_top` | gg / Home | - | `nav.top` | partial | P1 | Home 키 parity는 UI motion 경로와 함께 검증 필요. |
| `go_bottom` | G / End | - | `nav.bottom` | partial | P1 | End 키 parity는 UI motion 경로와 함께 검증 필요. |
| `page_up` | ^U / ^D | - | `__ui_motion.page_up` | partial | P0 | Ctrl+U와 Shift+PageUp 선택 확장까지 G004에서 검증 필요. |
| `page_down` | - | - | `__ui_motion.page_down` | partial | P0 | Ctrl+D와 Shift+PageDown 선택 확장까지 G004에서 검증 필요. |
| `toggle_panel` | Tab | - | `panel.switchActive` | implemented | P0 | 웹 기본 focus 이동을 막는 commander keyboard owner가 유지되어야 한다. |
| `toggle_layout` | Ctrl+W | View > Toggle Layout | `layout.toggleSingleDual` | partial | P1 | TUI 메뉴 위치는 View > Toggle Layout. GUI 비율 확장과 함께 동작 검증 필요. |
| `tab_new` | tn | - | `tab.new` | partial | P1 | TUI에는 메뉴 항목이 없고 단축키 중심이다. |
| `tab_close` | tx | - | `tab.close` | partial | P1 | 탭 상태/닫기 검증 필요. |
| `copy` | y | Edit > Copy | `file.copy` | partial | P0 | GUI 메뉴 위치가 TUI Edit와 불일치하며, 현재 copy UX는 no-conflict 즉시 실행/충돌 독립 UI 검증이 필요하다(G003). |
| `move` | x | Edit > Move | `file.move` | partial | P0 | GUI 메뉴 위치가 TUI Edit와 불일치하며, copy와 같은 UX 수리 대상이다(G003). |
| `open_default` | o | File > Open Default App | `external.openDefault` | partial | P1 | 파일/디렉터리 enablement와 오류 표시 검증 필요. |
| `open_terminal_editor` | e | File > Open Terminal Editor | `external.openEditor` | partial | P1 | TUI는 terminal editor preset을 사용한다. GUI는 외부 editor 연동으로 이름/설정 의미가 다르다. |
| `run_shell_command` | : | File > Run Shell Command | `external.runShellCommand` | partial | P1 | GUI에서는 안전상 Tools로 분리되어 있고 기본 비활성/확인 토큰 정책을 유지한다. |
| `delete` | d | File > Delete | `file.trash` | partial | P1 | TUI Delete 의미와 GUI Trash 의미 차이를 명확히 검증해야 한다. |
| `perm_delete` | D | File > Permanent Delete | `file.deletePermanent` | partial | P1 | 명시 확인/취소/오류 요약 검증 필요. |
| `new_dir` | a | File > New Directory | `file.mkdir` | implemented | P1 | Rust child-name 검증과 atomic command 경로가 있다. |
| `rename` | r | File > Rename | `file.rename` | implemented | P1 | no-replace Rust 경로를 유지해야 한다. |
| `file_info` | i | View > File Info | `file.properties` | partial | P1 | TUI 메뉴는 View, GUI 메뉴는 File이다. 속성 표시 UI 검증 필요. |
| `archive_compress` | zc | File > Archive Compress | `archive.create` | partial | P1 | GUI에서는 Archive 루트로 분리. |
| `archive_extract` | zx | File > Archive Extract | `archive.extract` | partial | P1 | 충돌/대상 경로 검증 필요. |
| `archive_extract_auto` | za | File > Archive Extract Auto | - | missing | P1 | TUI parity 누락. archive_extract_auto action과 자동 폴더명/충돌 정책 설계가 필요하다. |
| `archive_preview` | - | File > Archive Preview | `archive.preview` | partial | P1 | archive.list는 GUI 확장 action으로 별도 허용한다. |
| `toggle_sel` | Space | Edit > Select | `selection.toggle` | partial | P0 | 사용자 보고 기준 Space 선택 reliability가 미완료/회귀 가능성이 있어 G004에서 하드 검증한다. |
| `invert_selection` | v | Edit > Invert Selection | `selection.invert` | partial | P1 | 선택 모델과 필터 상태 동작 검증 필요. |
| `select_all` | ^A | Edit > Select All | `selection.all` | partial | P1 | 브라우저 select-all 기본 동작 방지 검증 필요. |
| `deselect` | u | Edit > Deselect | `selection.clear` | partial | P1 | clear selection 명칭 차이. |
| `help_keys` | ? | Help > Keyboard Help | `help.shortcuts` | partial | P1 | 도움말이 registry/matrix와 동기화되어야 한다. |
| `refresh` | ^R | View > Refresh | `nav.refresh` | implemented | P1 | 현재 panel data source 기반 refresh 경로가 있다. |
| `open_menu` | F9 | - | `menu.open` | implemented | P0 | F9로 File root menu를 열고, Escape/F9 닫기, Left/Right root 이동, Up/Down item 이동, submenu 진입/실행을 처리한다. |
| `quit` | q | File > Quit | - | missing | P1 | Tauri app quit command/action 설계 필요. 현재 q는 일반 파일명 타이핑/shortcut 충돌 위험이 있어 별도 UX 정책 필요. |
| `theme_dark` | - | Settings > Theme > Dark | `settings.theme` | partial | P0 | TUI는 direct submenu action 3개. GUI는 단일 theme action/저장 경로라 직접 선택/시각 적용 검증 필요(G005). |
| `theme_light` | - | Settings > Theme > Light | `settings.theme` | partial | P0 | theme_dark와 동일. |
| `theme_contrast` | - | Settings > Theme > High Contrast | `settings.theme` | partial | P0 | theme_dark와 동일. |
| `language_en` | - | Settings > Language > English | `settings.language` | partial | P0 | TUI direct submenu action 2개. GUI 표시 문자열 실제 변경 검증 필요(G005). |
| `language_ko` | - | Settings > Language > Korean | `settings.language` | partial | P0 | language_en과 동일. |
| `toggle_icons` | - | Settings > Toggle Icons | - | missing | P2 | 파일 row icon mode parity 누락. |
| `editor_preset_vi` | - | Settings > Default Editor > vi | - | missing | P1 | Default editor direct preset menu 누락. |
| `editor_preset_vim` | - | Settings > Default Editor > vim | - | missing | P1 | Default editor direct preset menu 누락. |
| `editor_preset_nano` | - | Settings > Default Editor > nano | - | missing | P1 | Default editor direct preset menu 누락. |
| `editor_preset_emacs` | - | Settings > Default Editor > emacs | - | missing | P1 | Default editor direct preset menu 누락. |
| `sort_name` | sn | View > Sort By > Name | `view.sortName` | implemented | P1 | 메뉴 그룹명만 다르다. |
| `sort_size` | ss | View > Sort By > Size | `view.sortSize` | implemented | P1 | 메뉴 그룹명만 다르다. |
| `sort_date` | sd | View > Sort By > Date | `view.sortDate` | implemented | P1 | GUI label은 Modified Date. |
| `sort_ext` | se | View > Sort By > Extension | `view.sortExt` | implemented | P1 | 메뉴 그룹명만 다르다. |
| `sort_asc` | sr | View > Sort Order > Ascending | `view.reverseSort` | partial | P1 | TUI는 sort_asc/sort_desc direct action이 있으나 GUI는 reverse toggle 하나라 direct 상태 설정 parity가 불완전하다. |
| `sort_desc` | - | View > Sort Order > Descending | `view.reverseSort` | partial | P1 | sort_asc와 동일. |
| `filter_start` | / | View > Filter | `filter.start` | partial | P1 | 필터 적용 표시/매칭 시각화는 최근 UX repair 대상이며 회귀 검증 필요. |
| `filter_clear` | - | View > Clear Filter | `filter.clear` | partial | P1 | TUI에는 별도 단축키 표시 없음. |
| `toggle_hidden` | . | View > Toggle Hidden | `view.toggleHidden` | implemented | P1 | 숨김 토글 후 list_dir 갱신 경로가 있다. |
| `mount_points` | gm | View > Mount Points | `nav.locations` | partial | P1 | TUI Mount Points와 GUI Locations 명칭/범위가 다를 수 있어 parity 확인 필요. |
| `goto_path` | gp | View > Go To Path | `nav.gotoPath` | partial | P1 | 경로 입력/검증/오류 표시 확인 필요. |
| `tab_list` | tt | - | `tab.list` | partial | P1 | TUI 메뉴에는 없지만 액션 parity 대상. |
| `history_back` | Alt+Left | - | `nav.back` | implemented | P1 | 히스토리 state와 list_dir 재요청 경로가 있다. |
| `history_forward` | Alt+Right | - | `nav.forward` | implemented | P1 | history_back과 동일. |
| `history_list` | th | View > History List | `history.list` | partial | P1 | 히스토리 목록 UI 동작 검증 필요. |
| `bookmark_add` | Ctrl+B | - | `bookmark.add` | partial | P1 | TUI shortcut는 Ctrl+B, GUI shortcut는 sequence tb+a로 다르다. 단축키 parity 또는 의도적 차이 기록 필요. |
| `bookmark_list` | tb | View > Bookmark List | `bookmark.list` | partial | P1 | 북마크 목록 UI 동작 검증 필요. |
| `size_auto` | - | View > Size Format > Auto | `settings.sizeFormat` | partial | P0 | TUI는 direct submenu. GUI는 단일 action/저장 경로라 실제 표시 변경 검증 필요(G005). |
| `size_bytes` | - | View > Size Format > Bytes | `settings.sizeFormat` | partial | P0 | size_auto와 동일. |
| `about` | - | Help > About | `help.about` | partial | P2 | 정보 다이얼로그 내용 검증 필요. |

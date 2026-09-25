# 액션 레지스트리 설계

## 1. 목적

메뉴, 단축키, 컨텍스트 메뉴, hotkey strip, 도움말이 같은 action 정의를 참조하도록 한다.

## 2. Action 모델

```ts
type ActionId = string;
type PanelRatio = '50:50' | '70:30' | '30:70';
interface AppAction {
  id: ActionId;
  category: 'navigation' | 'selection' | 'file' | 'archive' | 'view' | 'panel' | 'settings' | 'help';
  labelKey: string;
  descriptionKey: string;
  defaultShortcut?: string;
  menuPath?: string[];
  contextScopes?: Array<'file' | 'directory' | 'archive' | 'blank' | 'selection'>;
  dangerLevel: 'none' | 'safe' | 'destructive' | 'irreversible';
  isEnabled(context: ActionContext): boolean;
  run(context: ActionContext): Promise<void>;
}
```

## 3. 기본 액션 목록

| ID | 범주 | 기본 단축키 | 메뉴 | 위험도 | 실행 경로 |
| --- | --- | --- | --- | --- | --- |
| `panel.switchActive` | panel | Tab | View | none | UI state |
| `panel.swapPaths` | panel | ts | View/Swap Panel Paths | none | UI state |
| `panel.copyPathToOther` | panel | tp | View/Copy Path to Other Panel | safe | UI state + list_dir |
| `panel.compareDirectories` | panel | tc | View/Compare Directories | none | UI state |
| `nav.enter` | navigation | Enter/l | File/Open | safe | list_dir/open_default |
| `nav.up` | navigation | Backspace/h | Go/Up | safe | list_dir |
| `nav.back` | navigation | Alt+Left | Go/Back | safe | list_dir |
| `nav.forward` | navigation | Alt+Right | Go/Forward | safe | list_dir |
| `nav.refresh` | navigation | Ctrl+R | View/Refresh | safe | list_dir |
| `nav.gotoPath` | navigation | gp | View/Go To Path | safe | goto_path |
| `nav.locations` | navigation | gm | View/Mount Points | safe | list_locations |
| `tab.new` | panel | tn | View/New Tab | none | UI state + list_dir |
| `tab.close` | panel | tx | View/Close Tab | none | UI state |
| `selection.toggle` | selection | Space | Edit/Select | none | UI state |
| `selection.all` | selection | Ctrl+A | Edit/Select All | none | UI state |
| `file.clipboardCopy` | file | Cmd+C | Edit/Copy | safe | 현재 선택 항목 또는 포커스 항목을 앱 내부 복사 목록에 저장 |
| `file.clipboardPaste` | file | Cmd+V | Edit/Paste | safe | 저장된 항목을 활성 패널 현재 폴더에 복사; 기존 `file.copy` 실행 경로 사용 |
| `file.copy` | file | y/F5 | Edit/Copy to Other Panel | safe | 일반→일반 `start_copy`, 압축 내부→일반 `archive_extract`, 일반→압축 내부 `archive_add` |
| `file.move` | file | x/F6 | Edit/Move | destructive | start_move |
| `file.trash` | file | d | File/Delete | destructive | start_delete trash |
| `file.deletePermanent` | file | D/Shift+Delete | File/Permanent Delete | irreversible | start_delete permanent |
| `file.mkdir` | file | a/F7 | File/New Folder | safe | create_dir |
| `file.rename` | file | r/F2 | File/Rename | destructive | rename_entry |
| `app.quit` | file | Cmd+Q | File/Quit | none | getCurrentWindow().close safety policy |
| `file.properties` | file | i | View/File Info | safe | get_metadata |
| `file.quickView` | file | F3 | View/Quick View | safe | preview_file |
| `archive.list` | archive | Enter on archive | Archive/Open Archive | safe | archive_list |
| `archive.extract` | archive | zx | File/Archive Extract | destructive | archive_extract |
| `archive.extractAuto` | archive | za | File/Archive Extract Auto | destructive | archive_extract auto target |
| `archive.create` | archive | zc | File/Archive Compress | safe | archive_create |
| `external.openDefault` | file | o | File/Open Default App | safe | open_default |
| `external.reveal` | file | none | File/Reveal | safe | reveal_in_manager |
| `external.openEditor` | file | e | File/Open Terminal Editor | safe | open_external_editor |
| `settings.themeDark` | settings | none | Settings/Theme/Dark | none | save_settings |
| `settings.themeLight` | settings | none | Settings/Theme/Light | none | save_settings |
| `settings.themeHighContrast` | settings | none | Settings/Theme/High Contrast | none | save_settings |
| `settings.languageEn` | settings | none | Settings/Language/English | none | save_settings |
| `settings.languageKo` | settings | none | Settings/Language/Korean | none | save_settings |
| `settings.editorVi` | settings | none | Settings/Default Editor/vi | none | save_settings |
| `settings.editorVim` | settings | none | Settings/Default Editor/vim | none | save_settings |
| `settings.editorNano` | settings | none | Settings/Default Editor/nano | none | save_settings |
| `settings.editorEmacs` | settings | none | Settings/Default Editor/emacs | none | save_settings |
| `settings.toggleIcons` | settings | none | Settings/Toggle Icons | none | save_settings |
| `settings.sizeAuto` | settings | none | Settings/File Size Format/Auto | none | save_settings |
| `settings.sizeBytes` | settings | none | Settings/File Size Format/Bytes | none | save_settings |
| `view.sortName` | view | sn | View/Sort/Name | none | UI state + list_dir |
| `view.sortSize` | view | ss | View/Sort/Size | none | UI state + list_dir |
| `view.sortDate` | view | sd | View/Sort/Modified Date | none | UI state + list_dir |
| `view.sortExt` | view | se | View/Sort/Extension | none | UI state + list_dir |
| `view.reverseSort` | view | sr | View/Sort/Reverse | none | UI state + list_dir |
| `view.sortAsc` | view | none | View/Sort/Ascending | none | UI state + list_dir |
| `view.sortDesc` | view | none | View/Sort/Descending | none | UI state + list_dir |
| `filter.start` | view | / | View/Filter | none | UI state |
| `filter.clear` | view | Esc in filter | View/Clear Filter | none | UI state + list_dir |
| `view.toggleHidden` | view | . | View/Hidden Files | none | UI state + list_dir |
| `selection.invert` | selection | v | Edit/Invert Selection | none | UI state |
| `selection.clear` | selection | u | Edit/Clear Selection | none | UI state |
| `layout.toggleSingleDual` | view | none | View/Toggle Layout | none | UI state |
| `layout.ratio50` | view | none | View/Panel Ratio/50:50 | none | UI state |
| `layout.ratio70Left` | view | none | View/Panel Ratio/70:30 | none | UI state |
| `layout.ratio70Right` | view | none | View/Panel Ratio/30:70 | none | UI state |
| `history.list` | navigation | th | View/History List | none | UI state |
| `bookmark.add` | navigation | Ctrl+B/tb+a | View/Bookmark Add | safe | save_settings |
| `bookmark.list` | navigation | tb | View/Bookmark List | none | UI state |
| `bookmark.rename` | navigation | none | Go/Bookmark/Rename | safe | save_settings |
| `bookmark.delete` | navigation | none | Go/Bookmark/Delete | destructive | save_settings |
| `archive.list` | archive | Enter on archive | Archive/Open Archive | safe | archive_list 기반 가상 디렉터리 진입 |
| `external.runShellCommand` | file | : | File/Run Shell Command | destructive | ShellCommandDialog → prepare_shell_command → run_shell_command |
| `help.shortcuts` | help | ? | Help/Keyboard Help | none | dialog |
| `help.search` | help | none | Help/Search | none | UI state |
| `help.about` | help | none | Help/About | none | dialog |

## 4. Context rules

- `ActionContext`는 active panel, focused entry, selected entries, opposite panel path, operation state, settings를 포함한다.
- action enablement는 메뉴/컨텍스트 메뉴/hotkey strip/help에서 같은 selector를 사용한다.
- hotkey strip은 action registry의 우선순위 목록을 사용하되 화면 폭과 확대 배율에 따라 표시 개수를 동적으로 조정한다. 좁은 화면에서는 핵심 조작만 남기고, 넓은 화면에서는 추가 action hint를 더 노출한다.
- destructive/irreversible action은 command 실행 전 dialog 정책을 반드시 거친다.
- 압축 가상 디렉터리는 **읽기 전용 패널**이다. `file.copy`는 압축 내부→일반 디렉터리 추출 및 일반 디렉터리→압축 내부 추가로 허용하지만, `file.move`, `file.trash`, `file.deletePermanent`, `file.rename`, `file.mkdir`는 action registry에서 비활성화한다. 패널 상태줄은 `압축 내부 읽기 전용`을 표시해 비활성화 이유를 설명한다.
- 압축 내부 직접 삭제/이름 변경/이동은 provider별 재작성 방식과 원자성 차이로 인해 지원하지 않는다. 사용자는 복사/추출 후 일반 파일 시스템에서 변경하고 필요하면 새 압축 파일을 생성한다.
- `external.runShellCommand`는 `ShellCommandDialog`의 preview/confirm 단계를 거쳐 backend `prepare_shell_command` → `run_shell_command` 순서로 실행한다. 기본 비활성 또는 명시 확인 정책을 거치며, 작업 디렉토리/명령/종료 코드/표준 오류를 사용자에게 표시한다.

## 5. Shortcut rules

- 기존 TUI 단축키를 우선 제공하고 GUI 표준 단축키를 병행할 수 있다.
- single key shortcut은 text input/edit mode에서는 비활성화한다.
- sequence shortcut은 timeout 후 초기화한다.
- 사용자 커스터마이징은 후속 가능하지만, 충돌 검증 없이는 저장하지 않는다.

## 6. Help/menu generation

- 도움말은 registry에서 category, label, shortcut, menuPath를 읽어 생성한다.
- 단축키 도움말은 넓은 창에서 이동·패널·파일·보기 제목을 각 열의 같은 시작선에 맞추고, 남은 범주를 열 높이가 비슷하도록 배치한다. 좁은 창에서는 열 수를 줄이며, 높이가 부족하면 도움말 목록이 스크롤된다. 도움말이 열려 있는 동안 화살표·Page Up/Down·Home/End는 파일 패널 대신 목록 스크롤에 적용한다.
- 메뉴 구조도 registry에서 생성하거나 registry ID를 참조한다.
- hardcoded menu handler는 금지한다.

## 7. 테스트 기준

- 모든 menu item은 유효한 action ID를 참조한다.
- 모든 context menu item은 scope에 맞는 enablement를 가진다.
- help dialog의 shortcut 목록은 registry snapshot과 일치한다.
- irreversible action은 confirm dialog 없이 command를 호출하지 않는다.


## 복사·붙여넣기 범위

`Cmd+C`는 현재 선택 항목이 있으면 선택 항목을, 없으면 포커스 항목을 앱 내부 복사 목록에 보관한다. 이후 `Cmd+V`는 **활성 패널의 현재 폴더**를 대상으로 기존 복사 작업을 실행한다. 복사 목록은 반복 붙여넣기에 유지되며 앱 종료 시 사라진다. Finder 등 다른 앱의 파일 클립보드와는 연동하지 않는다. 입력 필드와 다이얼로그의 문자 복사·붙여넣기는 해당 UI가 처리한다. 같은 폴더에 붙여넣기는 원본 덮어쓰기를 피하도록 안내하고 실행하지 않는다. `y/F5`는 기존처럼 즉시 반대 패널로 복사한다.

# BokslDirGUI TUI-faithful clickable prototype

- 이 디렉토리는 BokslDirGUI의 브라우저 기반 클릭 목업
- 최신 방향은 `.omx/specs/deep-interview-file-commander-visual-direction.md` 준수

- 핵심 목표는 **현대식 파일 관리자 dashboard**가 아니라, 기존 터미널 BokslDir의 정체성을 거의 그대로 GUI로 옮긴 **파일커맨더형 dual-panel canvas** 검증

> - 이 목업은 일회성 UX 검증 산출물
> - `app.js`는 DOM-only 클릭 흐름을 보여주기 위한 state machine이며, 실제 앱의 파일 시스템 계층·상태관리·컴포넌트 아키텍처 청사진으로 재사용하지 않음

## Prototype quarantine

- 이 목업은 **생산 코드 seed로 재사용 금지**

- `app.js`의 중앙 command/router/state-machine 구조는 클릭 가능한 목업을 빠르게 검증하기 위한 장치
- 실제 Electron/Tauri/웹 앱 구현 시 이 파일을 모듈화하거나 추출하지 않음
- production 구현은 별도의 app boundary, filesystem boundary, state model, accessibility strategy를 새로 설계 필수
- 이 디렉토리에서 허용되는 동작은 fixture 기반 DOM state 변경뿐
- HTML template에 runtime 값이 들어갈 때는 `escapeHtml`을 통과해야 하며, 이 규칙은 `verify.mjs`에서 marker/check로 확인

## 열기

```bash
python3 -m http.server 4171 --bind 127.0.0.1 --directory mockups/clickable-prototype
# 브라우저에서 http://127.0.0.1:4171/ 접속
```

- 파일을 직접 열 수도 있음

```bash
open mockups/clickable-prototype/index.html
```

## 시각 방향

- 상단은 TUI처럼 얇은 메뉴바만 유지
- 기본 화면의 대부분은 좌/우 파일 패널이 차지
- 파일 목록은 행 높이를 낮춘 dense table로 표시
- 사이드바, 미리보기, 작업 큐, 큰 툴바는 기본 화면에 고정하지 않음
- 보조 기능은 메뉴, context menu, dialog, transient overlay로만 표시
- 패널 하단에는 패널별 status row를 두고, 앱 최하단에는 hotkey strip만 배치
- 전체 tone은 monospace/terminal-style line structure를 기준으로 적용

## 포함 범위

- 기본 shell
  - `[복슬Dir]` brand, File/Edit/View/Settings/Help menu
  - 좌/우 dual file panel
  - compact path header
  - dense file table
  - active/target panel indicator
  - bottom status bar + hotkey strip
- transient GUI affordances
  - 상단 메뉴 popover
  - 파일/빈 영역 context menu
  - copy/move/delete/rename/archive/new-folder/properties dialog flow
  - conflict/progress/complete/error dialog states
  - preview/info overlay
  - queue overlay
  - locations/go-to overlay
  - about/settings/filter/help overlays
- mouse/keyboard validation
  - click selection
  - multi/range selection sample
  - double-click open sample
  - right-click context menu
  - `Tab`, `?`, `/`, `y`, `x`, `d`, `a`, `r`, `z`, `i`, `g`, `q`, `F1`

## 제외 범위 / 비목표

- 실제 파일 복사/이동/삭제/이름 변경/압축/휴지통 동작
- 실제 파일 시스템 읽기/쓰기/권한 확인
- 실제 preview, search, sync, compare, batch rename, disk usage 구현
- 설정 저장, 단축키 충돌 검증, 앱 재시작 후 복원
- persistent left sidebar
- persistent right inspector/preview/task queue
- large always-visible toolbar
- card-heavy dashboard UI
- Finder/Explorer 스타일의 일반 데스크톱 파일 관리자 재해석

## 안전 보장

- 이 목업은 DOM 상태만 변경

- `fetch`, `XMLHttpRequest`, `localStorage`, `sessionStorage`, `indexedDB`, File System Access API, Node `fs`를 사용하지 않음
- 파일명, 경로, 크기, 날짜, 작업 큐는 모두 샘플
- 화면에 보이는 경로는 `/데모/...` 가상 경로
- 버튼을 눌러도 실제 파일은 생성/수정/삭제되지 않음

## 참고 시각 자료

- 기존 TUI reference는 원 프로젝트의 사용자 매뉴얼 이미지

- `/Users/boksl/IdeaProjects/BokslDir/docs/images/user-manual/01-main-dual-panel.png`
- `/Users/boksl/IdeaProjects/BokslDir/docs/images/user-manual/02-menu.png`
- `/Users/boksl/IdeaProjects/BokslDir/docs/images/user-manual/03-copy-dialog.png`
- `/Users/boksl/IdeaProjects/BokslDir/docs/images/user-manual/04-archive-compress.png`
- `/Users/boksl/IdeaProjects/BokslDir/docs/images/user-manual/05-about-dialog.png`

- 이번 목업의 headless 확인 스크린샷은 `temp/browser-check/` 아래에 생성 완료
- `temp/`는 gitignore 대상

## 로컬 검증

```bash
node mockups/clickable-prototype/verify.mjs
```

- 검증 항목:

- 두 개의 `.file-panel` 존재
- `.panel-zone`, `.hotkey-strip`, `.menu-popover`, `.transient-overlay`, `.context-menu`, `#operation-dialog` 존재
- 기본 markup에 persistent sidebar/inspector/large toolbar 없음
- dense file rows 개수 기준 충족
- terminal/monospace CSS 기준 충족
- `app.js` syntax check 통과
- 금지된 파일/네트워크/저장 API 문자열 없음

## 파일 구조

```text
mockups/clickable-prototype/
├── index.html   # TUI-faithful mockup DOM
├── styles.css   # terminal/commander visual style
├── app.js       # DOM-only interaction state machine
├── verify.mjs   # local verification checks
└── README.md    # usage, scope, acceptance criteria
```

## 수용 기준

- [ ] 첫 화면에서 좌/우 패널이 시각 영역 대부분을 차지
- [ ] sidebar/inspector/queue/large toolbar가 기본 화면에 고정되어 있지 않음
- [ ] 파일 row가 dense하고 “만들다 만 여백” 느낌이 없음
- [ ] 패널별 status row와 최하단 hotkey strip이 겹치지 않고 TUI 정체성 형성
- [ ] 메뉴와 작업 다이얼로그는 panel canvas 위에 overlay로 표시
- [ ] preview/queue/locations/settings/about/filter/help는 기본 레이아웃을 밀지 않음
- [ ] 한글 파일명과 한글/영문 혼합 commander label이 표시
- [ ] 실제 파일 시스템 접근 또는 변경 코드가 없음

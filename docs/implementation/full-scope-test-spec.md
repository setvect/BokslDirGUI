# 전체 범위 테스트 명세

## 1. 목적

- 기존 TUI 기능 동등성 및 GUI 전환 필수 기능의 완료 판정을 위한 테스트 기준 정의

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

- 공통 충돌 결정은 전 문서에서 `type ConflictDecision = 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel'`로 검증


### 3.1 탐색/패널

- 앱 시작 시 좌/우 패널이 표시되고 active panel이 명확함
- 시작 탭/경로 복원: 시작 경로가 없으면 이전 종료 상태 또는 안전한 기본 경로로 복원
- 유효하지 않은 시작 경로는 앱 종료가 아니라 panel error/fallback으로 처리
- 각 패널은 독립 경로, 탭, 정렬, 필터, 선택, 스크롤 유지
- 탭 생성/닫기/전환이 동작하고 마지막 탭은 닫히지 않음
- `nav.back`/`nav.forward`/`history.list`와 `bookmark.add`/`bookmark.list`/`bookmark.rename`: 패널별 히스토리 back/forward 목록과 북마크 추가/이름 변경/중복 방지 검증
- 북마크 삭제: 현재 경로 기준 메뉴 미노출, 목록의 지정 항목 ID 기준 삭제·설정 저장·포커스 유지·마지막 항목 처리·저장 실패 시 복원 검증
- Enter/double click으로 폴더 진입, Backspace/up으로 상위 이동
- 뒤로/앞으로/refresh/주소 입력/drive quick access가 동작
- `layout.toggleSingleDual` 및 `layout.ratio50`/`layout.ratio70Left`/`layout.ratio70Right`: single-panel/dual-panel 전환과 50:50/70:30/30:70 panel ratio가 상태 손실 없이 동작

### 3.2 파일 목록/선택

- 파일/디렉토리/링크/실행 파일 타입 구분
- 숨김 파일 toggle, 정렬, glob/부분 문자열 필터가 동작
- 단일/다중/범위/전체/반전/해제 선택이 같은 selection model 사용
- Page Up/Down: 고정 행 수 대신 실제 목록 높이 기준 이동, 1행 겹침·커서 세로 위치·처음과 끝 제한 검증
- 패널 전환·창 크기·확대 배율 변경 후 페이지 이동량 재계산, Shift 범위 선택과 다이얼로그 입력 소유권 유지 검증
- 10,000개 항목 fixture에서 rendered row 수가 virtual range로 제한

### 3.3 파일 작업

- copy/move/delete/trash/permanent delete/create dir/rename/properties가 성공/실패 fixture 보유
- 파일 정보: EXIF 카메라·노출·촬영 시각·GPS·저작권·픽셀 크기, 정보 없음·손상·읽기 한도·표시 길이 제한·원본 보존 검증
- F3 빠른 보기: 8 MiB 초과 이미지 정보 조회·`i`/버튼 토글·본문 스크롤 보존·키보드 소유권·늦은 응답 무시·오류 후 재시도 검증
- conflict prompt가 `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel`을 구분하고 `allOverwrite`/`allSkip`를 이후 충돌에 일관 적용
- cancel은 partial summary 제공
- 권한 오류/디스크 오류/존재하지 않는 경로가 앱 crash로 이어지지 않음

### 3.4 압축

- zip/jar/war list/create/extract fixture
- macOS `zip`이 UTF-8 표시 비트 없이 저장한 한글 이름도 목록·선택 추출에서 원본대로 표시 필수
- tar/tar.gz/tgz/tar.zst/tzst list/create/extract fixture
- zip/7z list/create/extract/password fixture
- provider가 있는 환경에서 7z 대형 목록과 암호 round-trip을 조건부 검증
- zip-slip/path traversal fixture 차단
- 암호는 화면 masking, operation summary/history/error 직렬화 미기록
- 압축 가상 디렉터리에서 copy-out은 허용하고 move/delete/permanent-delete/rename/create-dir은 비활성화
- 대형 목록은 limit를 적용하고 `totalEntries`/`truncated` 및 패널의 “일부만 표시됨” 상태 검증
- 사용자 시나리오는 일반→일반, 일반→압축, 압축→일반 복사와 Enter 하위 진입/Backspace 상위 이동, Space 다중 선택 포함

### 3.5 외부 연동

- `external.openDefault` action은 `open_default` command로 연결되며 OS 기본 앱 열기를 시도하고 실패 시 사용자 메시지 표시
- `external.reveal` action은 `reveal_in_manager` command로 연결되며 Finder/Explorer/파일 관리자에서 위치 표시를 시도하고 OS별 실패 처리
- `external.openCurrentInFileManager`/`external.openCurrentInTerminal` action은 macOS·Windows에서 현재 패널의 실제 디렉터리를 전달하고, 파일·없는 경로·압축 내부 경로는 거부
- `external.runShellCommand` action의 검증 항목
  - `prepare_shell_command` → `run_shell_command` 연결, 확정 입력의 단회 토큰 전달
  - disabled by default 정책(`external.shellCommand.enabled`) 및 workingDir 검증
  - 실행 버튼으로 입력 확정, 추가 확인 다이얼로그 없이 실행, exitCode/stdout/stderr 표시
  - 토큰 누락·재사용·만료·인수 변경 거부, 잘못된 따옴표와 암묵적 Windows 배치 실행 거부
  - 준비 중 취소의 실행 차단, 공통 controller의 실행 중 취소와 출력 요약 유지
  - 양쪽 출력 동시 포화·보관 상한·시간 초과·부모 선종료 후 자식 취소의 실제 프로세스 fixture 검증

### 3.6 GUI/UX

- 우클릭 컨텍스트 메뉴는 row/blank/selection scope별 항목이 다름
- 메뉴/단축키/컨텍스트 메뉴가 같은 action 결과 제공
- 다음 action의 registry 존재 및 UI의 동일 enablement 사용 검증
  - `view.sortName`/`view.sortSize`/`view.sortDate`/`view.sortExt`/`view.reverseSort`
  - `filter.start`/`filter.clear`
  - `view.toggleHidden`
  - `selection.invert`/`selection.clear`
  - `layout.toggleSingleDual`
  - `history.list`
  - `bookmark.add`/`bookmark.list`
  - `settings.themeDark`/`settings.themeLight`/`settings.themeHighContrast`
  - `settings.languageEn`/`settings.languageKo`
  - `settings.sizeAuto`/`settings.sizeBytes`
  - `archive.list`
  - `help.search`/`help.about`
- Space는 focused concrete row 선택을 토글한 뒤 다음 row로 이동하고, `..` virtual row에서는 선택하지 않고 아래 row로 이동
- 명시 선택이 없는 파일 작업은 focused concrete row를 effective source로 사용하며, registry enablement와 operation dialog source 목록이 같은 대상 표시 필수
- path/refresh/back/up 같은 non-modal control 클릭 뒤에는 shell이 keyboard owner를 되찾아 다음 Space/화살표 입력이 commander 동작으로 처리 필수
- Cmd/Ctrl `+`, Cmd/Ctrl `-`, Cmd/Ctrl `0`은 글자 크기뿐 아니라 row height, header/status/hotkey strip 높이, padding, virtualizer estimate까지 같이 조정하고 `Settings.view.zoomStep`으로 저장/복원 필수
- Zoom 단계는 예측 가능한 preset(`75/80/90/100/110/125/150/175/200%`)으로 표시 필수
- 확대/축소 후 표시되는 metadata 컬럼(size/modified/created/permissions/owner)은 중간에 ellipsis로 잘리지 않아야 하며, listing 변경 시 계산한 실제 항목의 metadata 표시 길이를 반영해 공간 부족 시 owner → created → permissions → size → modified 순으로 숨김 필수
- 단, dual-panel에서는 파일명이 우선 정보이므로 metadata가 name 가독 폭을 침범하면 Created/Permissions를 적극적으로 숨김
- 파일 목록 header와 body row는 같은 panel 단위 grid template을 공유해 `Name/Size/Modified/Created/Permissions` 헤더 위치와 실제 값 위치가 어긋나지 않아야 함
- 긴 파일명은 Unicode grapheme-safe middle ellipsis로 표시해 뒤쪽 확장자/식별자 보존 필수
- `Intl.Segmenter`가 없는 환경에서도 fallback 분할은 원본 문자열을 정규화로 바꾸지 않고 combining mark/variation selector/emoji modifier/ZWJ sequence를 같은 cluster로 유지 필수
- row hover/focus 정보에는 전체 파일명과 경로/크기/날짜/권한/소유자 정보가 포함 필수
- filter 적용 상태는 panel header/status와 bottom status에 표시되고, 파일명 substring 매칭 구간이 시각적으로 강조 필수
- 다이얼로그는 Esc/Enter/focus trap 지원
- 기본 화면에 persistent sidebar/inspector/large toolbar가 없음
- bottom status/hotkey strip이 표시

### 3.7 원격(SFTP)

- 근거: [SFTP 요구사항](../requirements/07-remote-sftp.md) 8절·10절
- Rust 통합: 테스트 SFTP 서버(`src-tauri/src/remote/test_server.rs`)를 127.0.0.1 임의 포트로 실행, 외부 서버·Docker 불필요

| 영역 | 시험 근거 |
| --- | --- |
| 연결·인증·호스트 키 | `remote/tests.rs`: 처음 키 지문 확인 뒤 신뢰, 변경 키 차단, 사용자 known_hosts 읽기 전용, 암호·키 암호·keyboard-interactive, 단계별 네트워크 오류, 비밀값 미노출 |
| 목록·이동 | 원격 URL·종류·숨김·필터, 실행 파일·링크 대상, `~`·상대·절대 입력, 위험한 이름 제외, 잘림, 권한 거부 |
| 관리 | 새 폴더·이름 변경 규칙과 덮어쓰기 금지, 영구 삭제와 보호 경로, 링크 비추적 삭제, 권한 변경 범위, 다중 이름 변경 |
| 전송 | 업로드·다운로드 내용·수정 시각, 충돌 건너뛰기·교체, 같은 서버 이동, 이동 실패 시 원본 보존, 끊김 임시본·이어받기·빈 구간 임시본 재전송, 취소 정리, 링크 정책 |
| 자격 증명·재연결 | 저장 선택 시에만 저장, 저장된 값 재사용, 끊김 뒤 한 번 재연결, 앱 해제 뒤 재연결 없음 |
| 화면 | `CommanderShell.remote.test.tsx`: 연결·호스트 키·질문·사이트·해제·복원·삭제 전환·권한 창·전송 키·열기·빠른 보기·앱 내부 클립보드, `CommanderShell.drag.test.tsx`: 드롭 업로드·끌어내기 차단 |
| 계약 | `contract.test.ts`·`contract_tests.rs`: 원격 DTO fixture, `remote_connection_changed` 이벤트 이름 |

- VM E2E: macOS(Tart)의 원격 로그인을 SFTP 서버로 사용, Windows VM은 네트워크로 같은 서버 접속, 결과는 요구사항 문서 10절에 기록

## 4. 정합성 테스트

- action registry에 없는 action ID를 메뉴/도움말/컴포넌트가 참조하지 않음
- Tauri command API 문서의 command는 action registry와 component design에서 같은 이름으로 참조
- state machine의 operation state는 command event payload와 일치
- 기준 기능 목록은 TUI parity map의 모든 Must 항목 포함

## 5. 완료 게이트

- 모든 기준 기능 테스트가 통과해야 기능 동등성 완료
- 7z provider가 없는 환경에서는 조건부 fixture를 건너뛰되, provider가 있는 CI/개발 환경에서 list/create/extract/password/대형 목록 게이트를 통과해야 배포 검증이 완료
- 플랫폼별 미검증 항목은 완료가 아니라 “지원 예정/검증 필요”로 기록
- destructive operation 테스트는 실제 사용자 파일이 아닌 temp fixture에서만 수행


## 6. 구조 리팩토링 이후 검증 위치

- UI 회귀는 `src/ui/CommanderShell.{keyboard,navigation,settings,operations,archives,clipboard,drag}.test.tsx`와 기본 렌더링 테스트로 분리
- 공통 준비 코드는 `src/ui/testing/`에 두며 제품 코드에서 import하지 않음
- `src/ui/presentation.test.ts`는 Shell이나 브라우저 DOM을 불러오지 않고 열 너비·문자열 줄임·확대 단계·단축키 배치 검증
- 200,000항목 계산과 10,000행 가상화 회귀 유지
- `src/verification/moduleBoundaries.test.ts`는 TypeScript의 타입 전용 import를 포함한 순환 의존, 순수 계산의 React/Tauri/store 의존, Rust의 명시적 import 의존 검사
- `src/tauri/fixtures/contract.json`을 TypeScript 계약 테스트와 Rust `contract_tests.rs`가 함께 사용
- camelCase, enum 값, null 필드, 오류 details와 설정 저장 형식의 대표 fixture 유지
- 키보드 리스너의 StrictMode 재등록/해제와 닫힌 탭의 늦은 목록 응답을 별도 회귀 테스트로 고정
- `scripts/verify-full-scope.mjs`의 문자열 검사는 구현 위치·매핑 정합성만 증명
- 기능 동작은 해당 테스트에서 검증
- 구현 문자열을 전체 소스에서 합쳐 찾지 않고 담당 모듈을 지정
- TUI 매핑 evidence는 분리된 실제 테스트 경로 참조 필수
- 기준선의 범위 검사 261개를 삭제하지 않음
- 실제 Tauri WebKit 및 Finder/Chrome 연동은 별도의 수동 검증 항목
- 브라우저/컴포넌트 테스트로 네이티브 연동 완료를 주장하지 않음

## 다음으로 열기 회귀 검증

- 파일 우클릭과 파일 메뉴에서 공통 `external.openWith` 액션 진입 확인
- 앱 목록 조회의 대상 파일 고정, 기본 앱 표시와 검색·방향키·Enter 실행 확인
- 조회 실패 재시도, 실행 실패 안내, 취소 이후 늦은 응답 무시 확인
- 폴더·압축 내부·다중 선택·다른 OS의 액션 제외 확인
- Rust 파일·앱 경로 검증과 공백·셸 특수문자 인자의 분리 확인

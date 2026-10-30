# 전체 소스 리뷰 · 2026-10-30

## 기준과 범위

- 기준 커밋: `ae5856b`, 깨끗한 작업 트리에서 시작
- 작성 근거: 사용자 요청에 따른 별도 기록 문서
- 기준 문서: AGENTS.md, [change-review 스킬](../../.agents/skills/change-review/SKILL.md), [전체 구조 리팩토링](refactoring.md), [2026-09-25 코드 리뷰](code-review-2026-09-25.md)

| 영역 | 검토 대상 |
| --- | --- |
| 화면·입력 | `src/ui/**`, `src/styles.css`, UI 테스트 |
| 프론트 핵심·도구 | `src/actions`, `src/operations`, `src/tauri`, `src/domain`, `src/i18n-resources.ts`, `scripts/*.mjs` |
| Rust 백엔드 | `src-tauri/src/**`, Rust 테스트, `src-tauri/vendor/drag` 유지 부담 |

- 중점: 2026-09-27 구조 리팩토링(`65022bd`) 이후 49개 커밋으로 추가된 코드
  - Windows 지원, 휴지통 되돌리기, 일괄 이름 변경, 파일 클립보드, Mdir 테마, 플랫폼별 단축키
- 제외 기준
  - `refactoring.md`에 기록된 의도적 결정을 되돌리는 제안
  - 파일 길이·개수만을 근거로 한 분리
  - 2026-09-25 리뷰의 남은 기능 작업(쉘 시간 제한, 실제 watcher, 백엔드 동시 작업 차단 등)
- 근거 수준 표기
  - 재현: 수정 전 코드에서 실패하는 테스트로 확인
  - 코드 대조: 소스 읽기와 명령 출력으로 확인
  - 검토 근거: 검토 과정의 위치 제시, 이 문서 작성 시 직접 재확인 전

## 결함과 수정 결과

- 모두 P2(동작·요구사항 불일치), 데이터 손실 경로 없음
- 위치는 함수명 기준 기록

| ID | 위치 | 발생 조건과 영향 | 근거 수준 | 수정과 검증 |
| --- | --- | --- | --- | --- |
| D01 | `PanelContextMenus` 빈 영역·항목 메뉴 | 복사·잘라내기 후 빈 영역 우클릭 메뉴에 붙여넣기·여기로 이동 누락, 상단 편집 메뉴에는 표시 | 재현 | `actionContext.createPanelActionContext`로 단축키·상단 메뉴와 컨텍스트 메뉴의 활성 조건 계산 통합, `FilePanel`은 공유 상태 하나만 전달, `CommanderShell.clipboard.test.tsx` 회귀 추가 |
| D02 | `CommanderShell.closeOverlay` | 북마크 이름 변경 창이 취소 버튼·Esc로 닫히지 않음 | 재현 | `closeOverlay`에서 이름 변경 요청 초기화, 취소·Esc 회귀 2건(설정 저장 미호출 포함) |
| D03 | `fileActionPlans.archiveAutoExtractFolderName` | 자동 해제(`za`)가 `.tar.zst`·`.tzst`·`.tar`·`.jar`·`.war`에서 `이름.확장자-extracted` 폴더 생성, parity 노트의 basename 규칙과 불일치 | 재현 | 지원 확장자 목록을 `src/domain/archiveFormats.ts`로 분리해 사용, 형식별·대소문자·대체 이름 단위 테스트 11건 |
| D04 | `i18n-resources` | Rust 오류 키 6개 번역 없음(`errors.io`, `errors.operationCancelled`, `errors.protectedPath`, `errors.emptyOperation`, `errors.homeUnavailable`, `errors.symlinkCopyUnsupported`), 구체 사유 대신 일반 실패 문구 표시 | 재현 | ko·en 번역 추가, Rust 소스 전체의 `errors.*` 키 번역 존재 검사 추가(`fullScope.test.ts`) |
| D05 | `archive::list_7z_entries_with_metadata` | Windows 배포본(GUI 서브시스템)에서 ZIP·7z 목록 조회 시 7-Zip이 콘솔 세션을 만들어 콘솔 창 표시 가능 | 코드 대조, Windows VM 확인 | `platform::hide_console_window`로 `CREATE_NO_WINDOW` 적용, 작업용 실행(`spawn_managed`)과 같은 정책, Windows VM 수정 전후 비교(아래 기록) |
| D06 | `external::open_directory_in_app`, `external::run_open_command` | macOS `open` 종료를 기다리지 않아 실패 미보고, 종료된 자식 프로세스 미회수 가능 | 코드 대조, 실기 미확인 | macOS는 종료 상태 확인 후 실패 시 `errors.externalCommandFailed`(연결 앱 열기와 동일), Linux는 응답을 막지 않고 백그라운드 회수, Windows 변경 없음, macOS 단위 테스트 추가 |
| D07 | `archive::zip_name_listing_command` 등 ZIP 목록 도구 | 로케일이 없으면 macOS 기본 `tar`가 한글 이름을 8진수 이스케이프로 출력, Finder 실행 앱이 물려받는 launchd 환경에 `LANG` 없음 → 배포 앱의 ZIP 목록 한글 이름 깨짐 가능 | 재현(로케일 없는 Rust 테스트 실패), 실제 앱 실기 미확인 | macOS 목록 도구(`tar`·`unzip`·`zipinfo`)에 `LC_ALL=en_US.UTF-8` 고정, 테스트의 교차 확인용 `/usr/bin/tar`도 동일 |

- D07 발견 경위: 전체 검증 중 이 실행 환경(`LANG` 없음)에서 Rust 테스트 2개 실패, 원래 코드에서도 같은 실패 확인
- D07 부수 관찰: 실패한 테스트가 테스트 환경 mutex를 오염시켜 무관한 테스트 9개 연쇄 실패(R08 참조)

### 재조사로 결함 아님을 확인한 항목

- D08: 상단 메뉴를 마우스로 눌러 연 대화상자가 Esc에 닫히지 않는다는 초기 관찰은 시험 도구 문제로 판명, 앱 결함 아님
  - 원인: VM 안 `cliclick`의 기능 키 입력(Esc·방향키·Tab·Return)이 마우스 이벤트 뒤 자주 유실됨
  - 근거: 진단 빌드에서 `cliclick`으로 보낸 Esc는 DOM keydown 자체가 기록되지 않음, 같은 도구로 TextEdit의 Return·방향키도 유실
  - 근거: 수정자 키 상태를 비우고 CGEvent로 키를 보내는 도구(`vmkey`)로는 TextEdit 정상, 상단 메뉴로 연 경로 이동 창 5회 모두 첫 Esc에 닫힘
  - 근거: 브라우저 모드(Chromium)에서도 첫 Esc에 닫힘
  - 회귀 테스트: 키보드·보기 메뉴로 연 경로 이동 창이 Esc 한 번에 닫히고 방향키 조작이 이어지는지 확인(`CommanderShell.navigation.test.tsx`)
  - 정정: 앞선 기록의 "수정 후 3회·수정 전 2회 미닫힘"은 `cliclick` 유실의 영향

### 확인이 필요한 후보

- D09 후보: macOS에서 만든 ZIP의 한글 이름이 Windows에서 깨질 가능성
  - 관찰(6단계 D07 후속): macOS `/usr/bin/zip`(Info-ZIP 3.0)은 로케일과 무관하게 UTF-8 플래그(general purpose bit 11)를 설정하지 않고 이름 바이트만 UTF-8로 저장
  - 관찰: macOS `7zz`는 같은 ZIP의 한글 이름을 정상 표시, 7zz로 만든 ZIP은 UTF-8 플래그 설정
  - 확인 필요: Windows 앱(7-Zip 목록)과 탐색기에서 macOS 앱이 만든 ZIP의 한글 이름 표시(VM E2E)
  - 수정 후보: macOS의 ZIP 생성 도구를 배포한 7zz로 변경, 압축 provider 변경이라 실기 결과 확인 후 결정

## 리팩토링 후보

- 우선순위 순, 모두 동작 보존 정리 기준
- 공개 command·DTO·설정 형식과 상태 소유자 유지 전제

### R01 압축 형식·도구 선택 규칙 단일화

- 형식 판정 중복
  - TS 4곳: `dialogDraft.archiveCreateNameIsSupported`, `archiveVirtual` 경로 패턴, `fileActionPlans.archiveFormatForPath`, `domain/archiveFormats`
  - Rust 3곳: `filesystem::is_archive_path`, `archive::archive_format_name`, `operation::archive_ops::archive_format_name`(같은 함수 2벌)
- 도구 선택 중복: `zip_uses_seven_zip()` 분기 9곳, 내용이 같은 `archive::find_binary`·`operation::process::external_binary` 2벌
- 변경 부담: Windows ZIP 처리 커밋 `b0fc275`의 분기·7z 인수 개별 수정(검토 근거)
- 제안: TS 소비처를 `domain/archiveFormats`로 통합, Rust는 `archive_provider.rs`에 형식·provider 선택·도구 탐색 집중, 형식 표의 계약 fixture 양쪽 대조
- 유지: 유형별 압축 알고리즘, staging, no-replace 게시 경계
- 위험·검증: 중간(provider 선택 오류 가능), `BOKSLDIRGUI_REQUIRE_PROVIDERS=1`·`BOKSLDIRGUI_TEST_WINDOWS_ARCHIVES=1` Rust 테스트, `verify-full-scope.mjs`의 `archiveVirtual` 문자열 검사 갱신 필요
- 진행(6단계): TS 형식 판정 4곳을 `domain/archiveFormats`의 표 하나로 통합(가상 경로 패턴도 표에서 생성)
- 진행(6단계): Rust 형식 판정 3벌과 도구 탐색 2벌을 `archive_provider`의 `ARCHIVE_FORMATS`·`archive_format`·`find_tool`로 통합, 도구 없음 오류 10곳은 `require_tool`
- 진행(6단계): 형식 표 공유 fixture `src/tauri/fixtures/archive-formats.json`을 Rust·TS 테스트가 대조
- 유지 결정: `zip_uses_seven_zip()` 분기는 작업별 진입점마다 한 번씩이라 유지, 같은 함수 두 번 찾던 `7zz`→`7z` 대체 탐색은 제거
- 검증: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1`와 `BOKSLDIRGUI_TEST_WINDOWS_ARCHIVES=1` 조합에서 압축 테스트 20개 통과

### R02 플랫폼 분기 정리

- 판정 방식 3가지: userAgent(`registry.fileShortcutPlatform`), `navigator.platform`(`useFileDrag`, `drop-overlay`, `commanderClients`), 백엔드 `PlatformInfo.os`(`createActionContext`)
- 플랫폼 정보가 없을 때 기본값 불일치: `useFileClipboard`는 mac 기준, `useTrashUndo`는 허용
- `registry.PLATFORM_ACTION_FEATURES` 표와 각 액션 `isEnabled`의 같은 조건 중복, 액션 ID 하드코딩 분기
- 변경 부담: Windows 지원 커밋 `5d5a2f4`·`ec41bd5`·`8bd6d9f`·`ca34f30`·`ae5856b`마다 여러 표 동시 수정(검토 근거)
- 제안: 플랫폼 기능·대상 플랫폼·단축키를 액션 속성으로 이동(`dialogKind`·`setting` 선례), 판정 모듈 하나로 통합
- 별도 결정 필요: `useFileClipboard`의 `'⌘V'` 표기와 registry `Cmd+V` 통일(화면 표시 변경)
- 위험·검증: 낮음~중간, `registry.test.ts`, `windowsShortcuts.test.tsx`, `useRuntimePlatform.test.tsx`
- 진행(7단계): 판정을 `domain/runtimePlatform.ts`(userAgent, `PlatformInfo` 우선)로 통합, `navigator.platform` 사용 3곳 제거
- 진행(7단계): `PLATFORM_ACTION_FEATURES`·`WINDOWS_SHORTCUTS` 표와 액션 ID 하드코딩 분기를 액션 속성(`platformFeature`·`shortcutPlatforms`·`windowsShortcut`)으로 이동, `isActionAvailable`이 플랫폼 조건 확인
- 진행(7단계): 기능 정보 없을 때 기본값을 macOS 기능 기준으로 통일(`useTrashUndo`의 허용 기본값 변경, Windows는 플랫폼 정보 수신 뒤 같은 결과)
- 유지: `useFileClipboard`의 `'⌘V'` 표기(화면 표시 변경, 별도 결정)

### R03 메뉴 활성 조건과 빈 영역 메뉴 목록 단일화

- 완료: D01 수정으로 단축키·상단 메뉴·컨텍스트 메뉴의 활성 조건 계산 통합
- 남은 부분: 빈 영역 메뉴 14개 ID가 `menuModel.BLANK_CONTEXT_ACTION_IDS`에 별도 정의, registry의 `contextScopes: ['blank']`는 5개
- 남은 부분: 메뉴 단축키 표기 함수 3가지(`shortcutHelpLabelForAction`, `shortcutLabelForAction`, `menuShortcutLabel`)
- 제안: 나머지 액션에 `blank` 범위 추가 후 목록을 registry에서 파생, 표기 통일은 화면 표시 변경이라 별도 결정
- 진행(3단계): 빈 영역 메뉴 14개를 registry `contextScopes: ['blank']`에서 파생, `registry.test.ts` 목록 고정 테스트 추가
- 남은 부분: 단축키 표기 함수 통일(화면 표시 변경, 별도 결정)
- 위험·검증: 낮음, `fullScope.test.ts` 컨텍스트 메뉴 검사, `CommanderShell.keyboard.test.tsx` 빈 영역 메뉴 테스트

### R04 장기 작업 시작·완료 처리 공통화

- 프론트: 완료 처리(취소 연결, 양쪽 패널 새로고침, 상태 메시지)가 `useCommanderActions.confirmBulkRename`, `useTrashUndo.openTrashUndo`, 일반 작업 실행 경로 3곳에 복제, 메시지 형식·선택 해제 기준 상이
- Rust: 작업 시작(등록, 스레드 생성, 초기 진행 상태)이 9곳 3형태(`operation/start.rs` 6곳, `operation/bulk_rename.rs`, `operation/trash_restore.rs`, `operation/shell.rs`), 스레드 생성 실패 정리는 `shell`만 수행
- 이점: 2026-09-25 리뷰의 남은 작업인 백엔드 단일 활성 작업 차단을 한 곳에 추가 가능
- 제안: `useCommanderActions` 안 공통 완료 요청 생성, `operation/runtime.rs`의 공통 시작 함수
- 유지: 유형별 사전 검증과 `run_*` 알고리즘, 이벤트 순서와 등록 해제 시점
- 위험·검증: 낮음~중간, `trashUndo.test.tsx`, `BulkRenameDialog.test.tsx`, Rust 동기 경로 테스트, 스레드 생성 실패 주입 테스트 추가
- 진행(9단계): Rust 시작 9곳을 `launch_operation`(첫 상태 알림 선택, 스레드 생성 실패 정리 포함)으로 통합, 백엔드 단일 활성 작업 차단 추가
- 진행(9단계): 프론트 완료 처리 3곳을 `operationCompletion.ts`의 `finishOperation`·`operationCanceller`로 통합, 다중 이름 변경 완료 메시지에 액션 이름 추가
- 유지 결정: 선택 해제 기준은 작업 의미가 달라 작업별 유지
- 미검증: 스레드 생성 실패 주입 테스트(표준 라이브러리 스레드 생성 실패를 결정적으로 만들 수단 없음), 공통 경로는 기존 shell 정리 방식과 동일

### R05 Shell의 컨트롤러 내부 직접 조작 정리

- `closeOverlay`가 각 훅의 ref·setter를 직접 초기화(D02의 원인)
- 압축 암호 재시도가 탐색 훅 소유의 `archivePasswordsRef`·`archiveListingsRef`를 Shell에서 직접 수정, `component-design.md` 4절의 소유 기록과 불일치
- 변경 부담: 보조 창 추가마다 훅·렌더·`closeOverlay` 3곳 수정, 누락 시 D02와 같은 결함
- 제안: 소유 훅에 `closeOverlays()`, 압축 목록 재시도 같은 의도 메서드 추가, ref 반환 제거
- 유지: 새 store 없이 기존 소유자
- 위험·검증: 낮음~중간(요청 무효화 순서), `CommanderShell.archives.test.tsx` 암호 사례, D02 회귀 테스트
- 진행(4단계): `useNavigationMenus`·`useCommanderActions`의 `closeOverlays`, `resumeArchiveCopy`, `usePanelNavigation`의 `retryArchiveListing`·`archivePasswordFor` 추가, Shell의 ref·setter 직접 조작과 ref 반환 제거, `component-design.md` 4절 소유 기록 갱신

### R06 경로 확인·재파싱 지점 검사 공통화

- `platform::validate_reparse_point` 호출 6개 파일 8곳: `archive_tar`, `mutation`, `native_drop`, `bulk_rename`, `operation/delete`, `operation/file_io` 3곳
- 부모 정규화와 정확한 이름 해석 3벌, 디렉터리 정규화 인라인 7곳(검토 근거)
- 위험: 새 진입점에서 호출 누락 시 Windows junction 검사 누락
- 제안: 항목 메타데이터 조회와 재파싱 지점 검사를 묶은 공통 함수, 디렉터리 정규화 함수 공유
- 위험·검증: 낮음~중간(오류 우선순위·코드 변화 가능), `windows_tests.rs` junction·ADS 테스트(Windows CI), rename·create_dir·bulk_rename 테스트
- 진행(8단계): 메타데이터 조회와 재파싱 지점 검사를 `platform::entry_metadata`로 묶어 7곳 교체
- 진행(8단계): 디렉터리 정규화 9곳을 `navigation::canonical_existing_directory` 하나로 공유(오류 코드·경로 동일)
- 유지 결정: `archive_tar`는 io 오류 종류 보존이 필요해 기존 두 단계 유지, 정확한 이름 해석 3벌은 `invalid_name`·`invalid_path` 오류 우선순위가 달라 유지
- 검증: 새 단위 테스트(디렉터리 아님·없는 항목·링크 비추적), Windows junction·ADS 테스트는 CI 확인

### R07 React↔Rust 계약 검증 보강

- 완료: D04 수정으로 Rust 오류 키 번역 존재 검사 추가
- 남은 부분: 기존 표본 번역 검사 3벌(`foundation.test.ts`, `fullScope.test.ts`, `verify-full-scope.mjs`) 정리
- 이벤트: 프론트가 구독하는 `operation_error`를 Rust가 보내지 않음, Rust의 `operation_completed`는 프론트 미구독
- DTO: 새 DTO 4종이 `contracts.rs` 밖(`platform`, `file_clipboard`, `bulk_rename`, `operation/trash_restore`)에 있고 계약 fixture 미포함
- 타입: `commanderClients.ts` 인터페이스가 메서드 문법으로 입력 타입을 다시 적어 입력 필드 추가를 컴파일러가 못 잡음(검토 근거)
- 제안: 이벤트 이름 상수화와 Rust emit 대조, 클라이언트 인터페이스를 `tauriClient` 타입에서 파생, fixture 확장, DTO를 `contracts.rs`로 이동
- 위험·검증: 낮음, `npm run typecheck`, `src/tauri/contract.test.ts`, `src-tauri/src/contract_tests.rs`
- 진행(5단계): 이벤트 이름을 `EVENTS`·Rust `*_EVENT` 상수로 모으고 `contract.test.ts`로 대조, `operation_error` 구독·`operation_completed` 발행 제거
- 진행(5단계): DTO 4종을 `contracts.rs`로 이동, 다중 이름 변경·휴지통 되돌리기 fixture와 양쪽 계약 테스트 추가
- 진행(5단계): `SafeMutationClient`·`LongRunningOperationClient`를 `tauriClient` 타입에서 파생
- 진행(5단계): 표본 번역 검사 3벌을 Rust `errors.*`·`settings.*` 메시지 키 전수 검사 하나로 정리

### R08 테스트 공용 도구

- TS: 클라이언트 가짜 구현 리터럴 반복(5개 메서드 `operationClient` 35회 등), 설정·`PlatformInfo` 리터럴 반복(검토 근거)
- Rust: 임시 디렉터리 정리 헬퍼 6벌, Drop 정리 없는 임시 디렉터리 7곳, 환경 변수 덮어쓰기 2벌
- 실제 관찰: D07 확인 중 한 테스트의 실패가 테스트 환경 mutex를 오염시켜 무관한 테스트 9개 연쇄 실패
- 제안: `src/ui/testing/`의 생성 함수, Rust 공용 임시 디렉터리·환경 변수 복원 가드(Drop 복원), 오염된 mutex 회복
- 위험·검증: 낮음, 테스트 수·결과 동일 여부 대조
- 진행(2단계): Rust `test_util.rs`의 `lock_env`·`TempDir`, TS `src/ui/testing/clientStubs.ts` 생성 함수, 테스트 수 동일(프론트 424개, Rust 127개)
- 진행(2단계): `verify-full-scope.mjs`의 구현 문자열 검사를 이름 있는 행동 테스트 근거로 전환

## 소규모 정리 후보

- i18n: `OpenWithDialog`, `BulkRenameDialog`, `FileInfoView`, `usePanelNavigation`·`useCommanderActions` 일부 메시지의 하드코딩 문자열(FR-20.4), 레이아웃 메시지의 한국어 UI 영어 표시
  - 진행(3단계): 문구 표를 `i18n-resources.ts`로 이동, 상태 메시지 5종을 `COMMANDER_STATUS_TEXT`로 이동, 한국어 레이아웃 메시지 회귀 테스트 추가
- 라벨 원천 중복: registry 기본값, `ACTION_LABELS.en`, `MENU_SEGMENT_LABELS.en`, `HOTKEY_LABELS`, 테마·언어 이름 삼항식
- 한도 상수 중복: 탭 5개·히스토리 100개(`usePanelNavigation`, `sessionState`, `panelState`, Rust `settings_service`)
  - 진행(3단계): TS는 `panelState`의 `MAX_PANEL_TABS`·`MAX_PANEL_HISTORY` 공유, Rust 검증 값은 유지
- 작업 상태: 진행 초기값 리터럴 7벌, `pending-` ID 생성·판정 분산, 종료 상태 판정 2벌
- 심볼릭 링크 판정: 대상 미확인 링크를 경로마다 디렉터리·파일로 다르게 취급, 디렉터리 링크의 "다음으로 열기" 표시 후 실행 불가 의심(정적 확인만)
- Rust: tar 오류의 문자열 비교, 파일 동일성 판정 3벌, 창 크기 상수 중복, 자체 base64 구현, `JoinError` 매핑의 `recoverable` 불일치, 테스트 훅 `BOKSLDIRGUI_EXTERNAL_DRY_RUN`의 배포본 동작, Windows `ItemId` 중복, 클립보드 무효 경로 오류 코드의 OS별 불일치
- 미사용 코드: `labelKey`·`descriptionKey`, 도달 불가 분기(`BACKEND_IMPLEMENTED_COMMANDS`), `'unsupportedPreview'`, 테스트 전용 `FOUNDATION_DOCUMENTS`, `formatModified`
  - 진행(3단계): 모두 제거, 죽은 코드만 확인하던 테스트 4개·게이트 검사 4개 삭제(프론트 421개, 게이트 258개)
- 문서 불일치: `action-registry.md`의 "Finder 등 다른 앱의 파일 클립보드와는 연동하지 않음" 문구, parity JSON `sort_asc`의 `sr` 라벨
  - 진행(3단계): 클립보드 문구를 Finder·Explorer 연동 요구사항 기준으로 수정
  - 진행(3단계): TUI 원본 확인 결과 `sort_asc`(`s r`)는 이름과 달리 정렬 방향 반전 실행 → GUI `view.reverseSort`·`view.sortAsc` 두 액션에 대응, GUI 전용 확장 목록에서 `view.reverseSort` 제외
  - 진행(3단계): `implementation-todo.md`의 쉘 취소·출력/시간 상한 항목을 구현 근거와 함께 완료 처리

## 남은 기능 진행(10단계)

| 항목 | 결과 | 근거 |
| --- | --- | --- |
| 경로 입력 `~`·상대 경로(FR-26.4) | 구현, `goto_path`의 `base`와 Rust `resolve_input_path` | `goto_path_resolves_home_and_panel_relative_input`, 프론트 base 전달 테스트 |
| 실제 watcher | 구현, `notify` 8.2.1·패널당 감시·300ms 병합·version 일치 새로고침 | `real_directory_watch_reports_a_new_entry`, 프론트 version 테스트 |
| 같은 패널 하위 폴더 드롭(FR-29.2) | 구현, 패널 간 드롭과 같은 기본 복사·Shift 이동 | `CommanderShell.drag.test.tsx` 복사·이동 |
| 압축 목록 성능 | 5만 항목 ZIP 측정: 이름 0.24초·상세 0.15초·암호 확인용 `zipinfo -v` 0.56초(출력 69MB) → 암호 판정을 상세 목록에서 계산해 `zipinfo -v` 제거, 명령을 작업 스레드로 이동 | `zip_detail_listing_marks_encrypted_entries_with_uppercase_type`, 압축 테스트 21개 |
| 코드 서명 | 결정 필요, 선택지를 `windows-support-plan.md` W7에 기록 | 스마트 앱 컨트롤 차단 관찰 |
| OS 창 닫기 중 작업 정책 | 결정 필요(차단·확인·취소 후 닫기) | `implementation-todo.md` |

- 남은 확인: Windows 실기 감시·드롭·경로 입력과 D09 후보는 VM E2E에서 확인

## 문제없음으로 확인한 영역

- 작업 상태 단일 store와 내부 모듈 주입 구조, `dialogDefinitions`·`COMMANDS`·parity JSON 단일 원천
- Rust `operation/runtime.rs` 등록부·충돌·취소, `operation/process.rs` 캡처·취소 경계
- `operation/file_io.rs` 백업·no-replace 게시와 transfer·delete·conflict 경계
- 키보드 소유권·키 시퀀스, `pointerFileDrag` 단계별 재검사, `archiveVirtual`, `panelDataSource`, `sessionState`
- 문서 생성 도구, 압축 도구 준비 스크립트(SHA-256 검증)
- 4개 테마 색상 토큰 집합 동일
- `cargo check` 경고 없음(macOS 기준, Windows `cfg` 코드 제외)

## 진행 시 주의 사항

- `verify-full-scope.mjs` 일부 검사의 코드 문자열 모양 의존 → R01·R04 등 정리 시 게이트 동시 수정 필요, 이름 있는 행동 테스트 근거로 전환 권장
- 결함 수정과 동작 보존 정리의 커밋 분리, 결함은 회귀 테스트 우선
- Windows 전용 코드는 이 Mac에서 앱 전체 컴파일 불가 → GitHub Actions windows-2022 또는 Windows VM 확인 필수
- macOS 외부 압축 도구(`zip`·`unzip`·`7zz`)의 생성·해제도 로케일 영향 가능 → Finder 실행 앱 기준 확인 필요(D07 후속)
  - 확인(6단계): `LANG`·`LC_ALL` 없는 환경에서 `zip` 생성, `unzip` 해제, `tar` 생성·해제 모두 한글·악센트 이름 정상, 로케일 영향 없음(목록 표시만 영향, D07에서 수정)
  - 별도 관찰: UTF-8 플래그 미설정은 D09 후보로 분리
- macOS VM 키 입력: 기능 키는 `cliclick kp:` 대신 수정자 상태를 비운 CGEvent 도구 사용, 마우스 조작은 `cliclick` 유지

## 검증 기록

- 재현 확인: 수정 파일을 되돌린 상태에서 D01·D02 회귀 3건, D03 단위 6건, D04 번역 검사 1건 실패, 수정 후 통과
- D05: 추가 함수를 단독 crate로 `x86_64-pc-windows-msvc` 대상 `cargo check`(경고를 오류로 처리) 통과, 앱 전체 Windows 컴파일·실행 미검증
- D06: macOS 단위 테스트(`/usr/bin/true`·`/usr/bin/false`) 통과, 실제 Finder·Terminal 열기 미검증
- D07: 로케일 없는 환경(`LANG`·`LC_ALL`·`LC_CTYPE` 제거)에서 원래 코드의 Rust 테스트 2개 실패와 연쇄 실패 9개 확인, 수정 후 Rust 테스트 127개 통과·1개 무시
- 최종 전체 검증(로케일 없는 환경): `git diff --check` 통과, `npm run verify` 통과
  - 타입 검사, 프론트 테스트 41개 파일·422개, 도구 테스트 16개, 빌드
  - Rust 검사, Rust 테스트 127개 통과·1개 무시, 범위 검사 262개, 생성 문서 정합성
- 미검증
  - 실제 앱에서 `open` 실패 시 오류 표시(D06 실패 경로)
  - Linux

### macOS VM 실기 확인

- 환경: Tart VM `boksldir-golden`(macOS 26.6.2), 앱을 `open`으로 실행해 Finder 실행과 같은 환경 확인(앱 환경에 `LANG`·`LC_*` 없음)
- 수정 전 앱: 2026-10-19 16:51 빌드(이번 수정 이전 코드), 수정 후 앱: 작업 트리에서 `npm run tauri:build -- --bundles app`
- 시험 자료: VM 안 테스트 폴더의 한글 이름 ZIP(`한글 폴더/보고서.txt`, `사진.txt`)

| 항목 | 수정 전 앱 | 수정 후 앱 |
| --- | --- | --- |
| D07 한글 ZIP 목록 | `한글 폴더`·`사진.txt`가 `354`·`355` 폴더로 표시 | `한글 폴더`·`사진.txt`(14 B) 정상 표시 |
| D01 빈 영역 우클릭 메뉴 | jsdom 재현으로 대체 | 붙여넣기·여기로 이동 표시, 붙여넣기 실행 후 원본·사본 SHA-1 일치 |
| D02 북마크 이름 변경 창 | jsdom 재현으로 대체 | 취소 버튼·창 바깥 클릭으로 닫힘, Esc는 당시 `cliclick` 유실로 판정 불가(D08 재조사 참조) |
| D06 기본 앱으로 열기 | TextEdit 실행 후 앱에 회수되지 않은 `open` 자식(좀비) 잔존 | TextEdit 실행, 앱 자식 프로세스 없음 |

### Windows VM 실기 확인

- 환경: VirtualBox VM `win 11`(Windows 11 ARM64, x64 앱 에뮬레이션), 시험 전 스냅샷 `before-d05-verify-20261030` 생성
- 수정 전 앱: VM에 설치돼 있던 2026-10-19 17:48 빌드(실행 파일 SHA-256 앞자리 `B667CFE8DD63`)
- 수정 후 앱: 브랜치 `claude/code-review-fixes-20261030`의 CI 실행 41057264320 NSIS 설치본(설치 후 실행 파일 `7FD159DF0D7D`)
- 방법: 3,001개 항목 ZIP을 열 때 새로 생기는 최상위 창과 `7za`·`conhost`·`OpenConsole`·`WindowsTerminal` 프로세스를 PowerShell로 기록
- CI windows-2022 작업에서 Windows 전용 코드 컴파일과 Rust 테스트 117개 통과

| 항목 | 수정 전 앱 | 수정 후 앱 |
| --- | --- | --- |
| `7za` 실행 | 있음 | 있음(목록 캐시 없는 새 실행으로 확인) |
| 콘솔 세션 | `conhost`·`OpenConsole`(Windows 터미널 호스트) 생성, `7za` 소유 `PseudoConsoleWindow` 창 | 창 없는 `conhost`만 생성, `OpenConsole`·콘솔 창 없음 |
| 화면·작업 표시줄 | 감시 스크립트가 Windows 터미널에서 실행돼 판정 불가 | 터미널 항목·콘솔 창 없음 |
| ZIP 목록 | 정상 | 정상 |

- 한계: 수정 전 앱은 감시 스크립트가 Windows 터미널에서 실행된 상태로만 측정
- 한계: 수정 전 CI 설치본(`ae5856b`) 재설치는 Windows 스마트 앱 컨트롤 차단으로 같은 조건 재측정 미실시
- 관찰: 스마트 앱 컨트롤이 서명 없는 설치본을 차단할 수 있음 → 배포 시 코드 서명 검토 필요

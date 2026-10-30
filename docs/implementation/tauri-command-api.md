# Tauri Command API 명세

## 1. 목적

- React/TypeScript UI와 Rust/Tauri backend 사이의 command, event, DTO 계약 정의

## 2. 공통 DTO

```ts
type PanelId = 'left' | 'right';
type EntryKind = 'file' | 'directory' | 'symlink' | 'executable' | 'archive' | 'unknown';
type OperationKind = 'copy' | 'move' | 'delete' | 'trash' | 'rename' | 'createDir' | 'archiveCreate' | 'archiveExtract' | 'archiveAdd';
type OperationState = 'idle' | 'validating' | 'scanning' | 'queued' | 'waitingForConflict' | 'running' | 'cancelling' | 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';
type ConflictDecision = 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel';
```

### 2.1 FileEntry

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `path` | string | 절대 경로; UI 표시 전 escaping 필요 |
| `name` | string | 파일명 |
| `kind` | EntryKind | 타입 |
| `symlinkTargetIsDirectory` | boolean/null | 링크 대상이 디렉터리면 true, 다른 종류면 false, 끊겼거나 확인할 수 없으면 null; 일반 항목은 null |
| `sizeBytes` | number/null | 알 수 없으면 null |
| `modifiedAt` | string/null | ISO timestamp |
| `createdAt` | string/null | 플랫폼별 가능 시 |
| `permissions` | string/null | 표시용 권한 |
| `owner` | string/null | 플랫폼에서 확인 가능한 소유자 표시값 |
| `group` | string/null | 플랫폼에서 확인 가능한 그룹 표시값 |
| `isHidden` | boolean | 숨김 여부 |
| `isVirtual` | boolean | `..` 같은 가상 항목 |

### 2.2 FileMetadata / DirectoryStats

- 파일 정보 응답은 FileEntry 필드에 절대 경로, 확장자, MIME 종류, 읽기 전용 여부와 directoryStats를 추가
- 일반 파일·심볼릭 링크·junction의 directoryStats는 null
- 선택 항목의 마지막 링크 자체와 끊긴 링크 보존, 부모만 정규화하여 absolutePath 반환
- 탐색용 list_dir/goto_path의 링크 대상 진입 동작과 속성 조회의 항목 자체 보존 구분

| directoryStats 필드 | 타입 | 설명 |
| --- | --- | --- |
| totalFileBytes | number | 선택 폴더 아래 일반 파일의 논리적 크기 합계(byte) |
| fileCount | number | 하위 일반 파일 수; 숨김 파일 포함 |
| directoryCount | number | 선택 폴더 자신을 제외한 하위 실제 폴더 수 |

- 하위 폴더까지 별도 작업 스레드에서 순회하되 심볼릭 링크를 따라가지 않고 링크·소켓 등 특수 파일은 집계에서 제외
- 접근 오류가 나면 불완전한 합계를 반환하지 않고 get_metadata 오류를 반환

### 2.2.1 이미지 메타데이터

- `FileMetadata.imageMetadata`: 이미지 정보 객체 또는 null, 프론트엔드의 기존 클라이언트 응답 호환을 위한 필드 생략 허용
- 일반 파일 정보 조회의 `get_metadata` 응답 확장, 파일 목록 조회에서 이미지 본문 읽기 없음

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| width / height | number/null | 픽셀 크기, 이미지 헤더 우선·EXIF 크기 보완 |
| exifStatus | present / absent / unreadable / limited | 표시 가능한 EXIF 존재·없음·손상/읽기 실패·읽기 한도 도달 구분 |
| fields | `{ key, value }[]` | 원본 이미지 IFD의 EXIF 태그 이름과 단위 포함 표시값 |
| truncated | boolean | 태그 수 또는 개별 값 길이 제한에 따른 생략 여부 |

- JPEG·TIFF/DNG·HEIF/HEIC/AVIF·PNG·WebP의 EXIF 조회 지원, GIF·BMP는 픽셀 크기 조회 지원
- MakerNote 등 바이너리 값과 썸네일 IFD 제외, 별도 XMP/IPTC·외부 sidecar·제조사 전용 RAW 해석 제외
- 조회당 실제 읽기량 16 MiB 제한, 픽셀 본문은 가능한 경우 seek로 건너뛰기
- 응답은 128개 태그·값당 512문자와 생략 표시로 제한, 한도 도달 시 상태 표시 필수
- 큰 TIFF처럼 파서가 전체 본문을 요구하는 경우 `limited` 반환 가능, 미리보기의 8 MiB 제한과 독립
- 메타데이터 분석 실패 시 기본 파일 정보 유지, 촬영 시각의 시간대 임의 변환 금지
- 의존성 근거: [kamadak-exif 0.6.1](https://docs.rs/kamadak-exif/0.6.1/exif/)의 Rust EXIF 컨테이너 파서와 [imagesize 0.14.0](https://docs.rs/imagesize/0.14.0/imagesize/)의 디코딩 없는 크기 조회 사용
- 선정 이유: 공통 이미지 형식 지원·전용 파서 재사용·외부 실행 파일 설치 불필요, 전체 이미지 디코더 도입 없이 독립 검증 가능

### 2.3 AppError

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `code` | string | `not_found`, `permission_denied`, `conflict`, `invalid_path`, `unsupported`, `io_error` 등 |
| `messageKey` | string | i18n key |
| `path` | string/null | 관련 경로 |
| `details` | object/null | 로그/디버그용 structured data |
| `recoverable` | boolean | 계속 진행 가능 여부 |

### 2.4 ShellCommandPreview

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `confirmToken` | string | backend가 발급한 짧은 TTL/one-shot token |
| `expiresAt` | string | ISO timestamp, 만료 후 실행 거부 |
| `fingerprint` | string | workingDir + command + args의 backend 계산 fingerprint |
| `requiresConfirmation` | boolean | 항상 true, UI 확인 표시용 |
| `policy` | object | `external.shellCommand.enabled`, 허용/거부 사유 |

## 3. Command 목록

| Command | 입력 | 출력 | 비고 |
| --- | --- | --- | --- |
| `list_dir` | `{ panelId, path, showHidden, sort, filter }` | `DirectoryListing` | 읽기 전용 |
| `get_metadata` | `{ path }` | `FileMetadata` | 속성/preview; 폴더는 내부 파일 크기·파일 수·하위 폴더 수를 조회 시 계산 |
| `prepare_native_file_drag` | `{ paths: string[] }` | `string[]` | Windows 내부 드래그 준비용; 별도 스레드에서 전체 원본·재파싱 지점 검증 후 링크 자체를 보존한 Shell 호환 경로 반환, 다른 OS 미지원 |
| `watch_path` | `{ panelId, path }` | `WatchAck` | 패널 디렉터리 직접 자식 감시 등록(패널마다 하나, 교체), `version`은 감시 등록 번호, 변경이 300ms 멈추면 `dir_changed` 1회 |
| `unwatch_path` | `{ panelId }` | `void` | 패널 감시 해제(압축 내부 이동·화면 종료) |
| `goto_path` | `{ panelId, path, base? }` | `DirectoryListing` | 주소 입력/북마크/히스토리 이동, `~`는 홈·상대 경로는 `base`(활성 패널의 실제 디렉터리) 기준 해석(FR-26.4) |
| `list_locations` | `{}` | `LocationList` | 홈/드라이브/마운트 quick access |
| `create_dir` | `{ parent, name }` | `FileEntry` | 이름 검증 |
| `rename_entry` | `{ path, newName }` | `FileEntry` | 같은 parent 내 rename |
| `start_copy` | `{ sources, targetDir, policy }` | `OperationStarted` | 진행률 event |
| `start_move` | `{ sources, targetDir, policy }` | `OperationStarted` | rename 우선, fallback copy+delete |
| `start_delete` | `{ targets, mode, confirmToken? }` | `OperationStarted` | `trash`/`permanent`; permanent는 `PERMANENT_DELETE` token 필요 |
| `cancel_operation` | `{ operationId }` | `CancelAck` | cooperative cancel |
| `resolve_conflict` | `{ operationId, decision }` | `ConflictAck` | overwrite/skip/allOverwrite/allSkip/cancel |
| `archive_list` | `{ archivePath, password?, limit? }` | `ArchiveListing { totalEntries, truncated, ... }` | 기본 50,000개, 최대 200,000개 응답 제한, 작업 스레드 실행(화면 멈춤 없음), ZIP 암호 여부는 상세 목록의 대문자 형식 표시(T·B)로 판정 |
| `archive_create` | `{ sources, targetArchive, format, password? }` | `OperationStarted` | zip/7z 암호 지원; jar/war/tar 계열 암호 미지원 |
| `archive_extract` | `{ archivePath, targetDir, password?, policy, entries?, stripPrefix? }` | `OperationStarted` | zip-slip 차단, 선택 항목 추출 지원 |
| `archive_add` | `{ sources, archivePath, targetInnerDir, policy }` | `OperationStarted` | 일반 파일/폴더를 zip/jar/war/7z 내부 경로에 추가; unsafe 내부 경로 차단 |
| `open_default` | `{ path }` | `ActionResult` | OS 기본 앱 |
| `reveal_in_manager` | `{ path }` | `ActionResult` | Finder/Explorer 등 |
| `open_current_in_file_manager` | `{ path }` | `ActionResult` | 현재 패널의 실제 디렉터리 검증 후 macOS Finder·Windows 파일 관리자에서 열기 |
| `open_current_in_terminal` | `{ path }` | `ActionResult` | 실제 디렉터리 검증 후 macOS Terminal·Windows PowerShell 열기, Windows PowerShell 미설치 시 Windows Terminal 사용 |
| `list_open_with_apps` | `{ path }` | `OpenWithApp[]` | macOS NSWorkspace·Windows Shell의 파일 연결 앱 조회, 기본 앱 우선 정렬 |
| `open_with_app` | `{ path, applicationId }` | `ActionResult` | 대상 파일·OS 등록 앱 식별자 재검증 후 선택 앱으로 열기, 기본 연결 유지 |
| `prepare_shell_command` | `{ workingDir, command, args? }` | `ShellCommandPreview` | 설정 게이트, workingDir, command fingerprint 검증 후 짧은 TTL/one-shot `confirmToken` 발급 |
| `run_shell_command` | `{ workingDir, command, args?, confirmToken }` | `OperationStarted` | 설정·디렉터리·필수 토큰 검증 후 공통 장기 작업 시작, kind=shellCommand, 결과는 operation_summary.commandResult |
| `load_settings` | `{}` | `Settings` | schema version 포함 |
| `save_settings` | `{ patch }` | `Settings` | 원자적 저장 고려 |

## 4. Event 목록

| Event | Payload | 발행자 | 소비자 | 상태 |
| --- | --- | --- | --- | --- |
| `operation_progress` | `OperationProgress` | operation service(`operation/runtime.rs`) | operation store/dialog | 구현 |
| `operation_conflict` | `ConflictPrompt` | operation service(`operation/runtime.rs`) | conflict dialog | 구현 |
| `operation_summary` | `OperationSummary` | operation service(`operation/runtime.rs`) | queue/toast/panel refresh | 구현 |
| `boksldir://native-file-drop` | `NativeFileDropEvent` | Windows 주 창(`native_drop.rs`), macOS 드롭 오버레이(`drop-overlay.ts`) | `useFileDrag` | 구현 |
| `dir_changed` | `{ panelId, path, version }` | watch service(`watch_service.rs`) | `usePanelNavigation` 백그라운드 새로고침(같은 version만) | 구현 |
| `settings_changed` | `Settings` | settings service | UI providers | 미구현 |

- 이벤트 이름 원천: 프론트 `src/tauri/commands.ts`의 `EVENTS`, Rust의 `*_EVENT` 상수, `contract.test.ts`가 양쪽 일치와 Rust 문자열 리터럴 발행 금지 확인
- 2026-10-30: 발행하지 않던 `operation_error` 구독과 소비자 없는 `operation_completed` 별칭 발행 제거

## 5. 안전 규칙

- 모든 path는 Rust에서 canonicalize/normalize
- `..` virtual entry는 파일 작업 대상이 될 수 없음
- copy/move는 자기 자신 내부 대상, 중복 대상, 권한 오류를 선검증
- archive extract는 target directory 밖 쓰기 차단
- archive add는 `targetInnerDir`와 생성할 entry를 정규화하고 절대 경로, `..`, NUL 차단
- 같은 이름은 공통 conflict decision으로만 덮어쓰기
- 압축 가상 경로는 읽기 전용
- delete/rename/move/create-dir command에 압축 내부 경로를 전달하지 않으며 action registry에서도 선차단
- 지원 형식은 zip, tar, tar.gz/tgz, tar.zst/tzst, 7z, jar, war
- jar/war는 zip provider, tar 계열은 tar provider 사용
- `archive_list.limit`는 1~200,000 범위로 제한하며 생략 시 50,000 사용
- 잘린 응답은 `truncated=true`와 원본 `totalEntries`를 반환
- password는 event/log/details에 남기지 않음
- `run_shell_command`는 설정 키 `external.shellCommand.enabled === true`일 때만 활성화하고, shell interpolation을 피하기 위해 command/args를 분리하며, workingDir은 활성 패널 경로로 검증
- `preview_file(path, maxBytes?)`는 일반 파일만 읽고 텍스트는 최대 1 MiB, 이미지는 8 MiB로 제한
- 미지원 형식과 제한 초과 이미지는 command 오류가 아니라 `unsupported`/`tooLarge` 결과로 반환하며 파일을 실행하지 않음
- GUI의 실행 버튼으로 입력 확정 후 `prepare_shell_command`의 토큰을 같은 입력의 `run_shell_command`에 전달, 추가 확인 다이얼로그 없음
- backend는 모든 실행의 작업 디렉터리·명령·인수 fingerprint와 TTL/one-shot 조건 검증, 누락·무효·만료 시 `invalid_token`/`errors.shellConfirmationInvalid` 반환
- 직접 실행 입력: 작은/큰따옴표로 공백 포함 인수 묶기, 인용 중 같은 따옴표 2개는 리터럴 따옴표 1개, 빈 인수 보존
- 역슬래시·환경 변수·와일드카드·파이프·리다이렉션은 직접 실행에서 리터럴 전달, 닫히지 않은 따옴표와 NUL 거부
- 셸 내장 명령과 셸 문법은 `sh`·`cmd.exe`·`powershell.exe` 등 명시 호출, Windows `.bat`·`.cmd` 직접 실행의 암묵적 셸 전환 거부
- `shellCommand` 작업은 기존 `cancel_operation`과 operation 이벤트 사용, 별도 취소 레지스트리·UI store 생성 없음
- `OperationSummary.commandResult?`: 명령 실행 시 `{ workingDir, exitCode, stdout, stderr, timedOut, truncated }`, 다른 작업은 필드 생략
- 명령 실행 상한: 5분, stdout/stderr 각각 최초 16 KiB만 보관하며 초과 출력도 계속 배출, 표준 입력은 닫힘
- Windows 긴 작업 위치: 프로세스 시작 오류 87/267과 UTF-16 경로 260자 이상 조건에서 `working_directory_too_long` 반환, 짧은 폴더 경로로 재시도 안내·실행 위치의 임의 대체 금지
- 출력 해석: UTF-8·UTF-8 BOM·UTF-16 BOM, Windows의 비 UTF-8 출력은 OS OEM 코드페이지 fallback, 임의 프로그램의 모든 인코딩 자동 판별 보장 없음
- 성공·실패·취소 명령의 출력 요약은 사용자가 닫을 때까지 유지, 진행 표시의 임의 백분율·파일 개수 표시 제외
- renderer 권한은 command invocation에 필요한 범위로 제한

## 6. TypeScript wrapper 규칙

- UI는 `invoke`를 직접 호출하지 않고 `src/tauri/client.ts`의 typed wrapper만 사용
- wrapper는 `Result<T, AppError>` 형태로 normalize
- i18n 문자열은 Rust가 완성 문장으로 보내지 않고 `messageKey`와 structured details 전달


## 구조 리팩토링의 계약 보존

- 2026-09-27 기준 `src-tauri/src/contracts.rs`가 DTO와 오류 타입을, `commands.rs`가 명령 핸들러를 소유
- 2026-10-30: 플랫폼 정보·파일 클립보드·다중 이름 변경·휴지통 되돌리기 DTO도 `contracts.rs`로 이동
- `lib.rs`에는 앱 초기화와 기존 이름의 command 등록 유지
- 서비스와 작업 엔진의 파일 분리는 command/event 이름, serde 필드/enum 값, 설정 JSON 형식을 변경하지 않음

- 프론트엔드 명령 이름은 `src/tauri/commands.ts`, 호출과 이벤트 수신은 `client.ts`, 네이티브 드래그/창 어댑터는 `commanderClients.ts`가 담당
- `client.ts`의 기존 명령 이름 export도 유지
- 공통 직렬화 fixture는 `src/tauri/fixtures/contract.json`이며 `contract.test.ts`와 Rust `contract_tests.rs`에서 양쪽 형식 검증
- 프론트 클라이언트 인터페이스(`commanderClients.ts`)는 `tauriClient` 메서드 타입에서 파생, 입력 필드 변경이 가짜 구현과 호출부에 컴파일 오류로 전파

## 다음으로 열기 계약

- `OpenWithApp`: `{ id: string, path: string | null, name: string, isDefault: boolean }`
- `OpenWithApp.id`: OS 조회 결과의 불투명 선택 식별자, 실행 전 재조회 필수, 임의 실행 파일 경로 수용 금지
- `OpenWithApp.path`: 표시용 앱 경로, 경로가 없는 Windows 등록 앱은 null 허용
- 데스크톱 외부 실행: 비동기 command와 blocking worker 사용, Windows COM 객체의 전용 STA 생성·사용·해제 유지
- 대상: macOS 일반 파일 시스템의 단일 파일, 압축 파일 자체 포함
- 폴더·압축 내부 가상 경로·여러 파일 선택 제외, 다른 OS에서는 액션 숨김 및 명령의 unsupported 오류 반환
- [Apple NSWorkspace API](https://developer.apple.com/documentation/appkit/nsworkspace/urlforapplication(toopen:)-7qkzf) 기준 `NSWorkspace.URLsForApplicationsToOpenURL` 조회와 `URLForApplicationToOpenURL` 기본 앱 표시
- 선택 앱 경로의 정규화와 실행 직전 연결 앱 목록 재검증 필수
- `/usr/bin/open -a`에 앱·파일 절대 경로를 개별 인자로 전달, 셸 해석 없음
- 종료 상태 실패 시 `errors.externalCommandFailed`, 연결 앱 불일치 시 `errors.openWithAppUnavailable` 반환
- Tauri 전이 의존성으로 사용 중인 `objc2`, `objc2-app-kit`, `objc2-foundation`의 macOS 전용 직접 의존성 명시
- 의존성 목적: 외부 스크립트나 앱 이름 하드코딩 없이 OS 연결 앱 조회, 현재 잠금 버전 재사용

## 제거된 터미널 편집기 계약

- 2026-10-03 사용자 요청으로 `open_external_editor` 명령 제거
- `external.editorId`는 기존 설정 JSON의 읽기·쓰기 호환용으로만 유지, 실행 또는 설정 UI 사용 없음

## 파일 클립보드·다중 이름 변경·작업 환경 복원

| 명령 | 입력 | 응답·정책 |
| --- | --- | --- |
| `read_file_clipboard` | `{ resolve: boolean }` | `{ changeCount, paths, entries, intent }`; macOS 파일 URL·Windows `CF_HDROP` 수용, `intent`는 `copy` 또는 `move`, `resolve=true`에서 실제 항목 조회 |
| `write_file_clipboard` | `{ paths: string[], intent: "copy" | "move" }` | 클립보드 변경 번호; 전체 원본 확인 후 기록, 링크 자체 경로 보존 |
| `clear_file_clipboard` | `{ changeCount: number }` | 해당 변경 번호가 아직 최신인 경우에만 해제 |
| `preview_bulk_rename` | `{ sources, rules }` | `{ item: { source, newName, stamp }, changed, error }[]`; 파일 변경 없는 사전 검증 |
| `start_bulk_rename` | `{ items: { source, newName, stamp }[] }` | `OperationStarted(kind=rename)`; 기존 진행률·취소·완료 이벤트 사용 |

- Windows 파일 목록: UTF-16·ANSI `DROPFILES` 경계 검사, 최대 16MiB의 클립보드 블록, 절대 경로·실제 원본 검증, `Preferred DropEffect`의 명시 이동 값만 이동으로 수용
- 클립보드 수명주기: 읽기 잠금 해제 후 원본 조회와 변경 번호 재검사, 버전 조회와 원본 조회 사이 변경 시 실행 거부, 부분 이동 뒤 기존 버전만 해제
- macOS 일반 클립보드 접근: WebKit과 공유하는 `NSPasteboard`를 Tauri 메인 스레드에서 생성·읽기·쓰기·해제, worker 직접 접근 차단
- 원본 검증·메타데이터 조회와 Windows 클립보드 OS 호출: blocking worker에서 실행, macOS 원본 조회 뒤 메인 스레드에서 변경 번호 재검사
- 자동 클립보드 확인: 시작·포커스·표시 상태·주기 요청이 겹쳐도 진행 중인 읽기는 1개로 제한, 완료·오류 후 다음 확인 허용
- 가상 압축 항목: 기존 내부 snapshot 유지
- `rules`: `find`·`replacement`·`prefix` 문자열, `numbering`·`preserveExtension` 불리언, `start`·`padding` 정수
- 치환은 리터럴 전체 치환, 번호는 표시 순서대로 `_001` 형식 추가, 확장자 유지 기본값 참
- 다중 이름 변경은 최대 10,000개, 기존 대상·중복 대상·폴더와 그 자손의 동시 변경 거부
- 대소문자 무시 플랫폼의 계획 중복을 보수적으로 차단, macOS의 Unicode 정규화 동등 이름도 중복 처리
- 실행 직전 원본 식별 정보 재검증과 원자적 no-replace 이름 변경 사용, 중간 실패 시 중단·완료 수 보고
- 새 기본 단축키 지정 없음; 파일 메뉴와 선택 항목 컨텍스트 메뉴에서 접근
- 설정의 선택 필드 `session.tabs.left/right`: `{ items: SavedTab[], activeIndex }`, 패널당 최대 5개
- `SavedTab`: `path`·`sort`·`filter`·`showHidden`·`historyBack`·`historyForward`, 히스토리 각 최대 100개
- 설정의 선택 필드 `window`: `{ width, height, maximized }`, 일반 창 크기 보존과 연속 크기 이벤트 저장 병합
- 기존 `leftPath`·`rightPath`·`activePanel` 호환 유지, 저장 필드에 선택·진행 작업·압축 암호 포함 금지
- 접근 불가능한 저장 경로는 홈으로 대체하고 원래 경로 안내; 잠긴 압축 탭은 오류 상태 유지·사용자 새로고침 시 암호 요청
- 검증 근거: `nativeFileClipboard.test.tsx`, `BulkRenameDialog.test.tsx`, `sessionState.test.tsx`, Rust `file_clipboard`·`bulk_rename`·`window_session` 테스트

## 휴지통 작업 실행 취소

- `preview_trash_undo()` → `{ id, entries: FileEntry[] } | null`: 현재 세션의 최근 복원 가능 작업 조회
- `start_trash_undo({ id })` → `OperationStarted`: 확인한 이력 ID를 검증하고 `restoreTrash` 작업 시작
- macOS [FileManager 휴지통 API](https://developer.apple.com/documentation/foundation/filemanager/trashitem(at:resultingitemurl:))가 반환한 실제 휴지통 위치 기록, 파일명 추측 금지
- 원래 경로·휴지통 위치·파일 및 부모 폴더 동일성 정보는 Rust 메모리에서 관리, 프론트 입력은 이력 ID로 제한
- 최근 20개 작업을 세션 내 유지, 다중 항목은 한 작업으로 복원, 재시작·영구 삭제·타 앱 삭제 이력 제외
- 복원은 기존 작업 레지스트리·진행 이벤트·취소·요약 경로 사용, 충돌 시 덮어쓰기 없이 오류 요약과 재시도 유지
- 휴지통 항목 소실·교체는 오류 안내 후 해당 복원 기록 제거, 부분 취소·경로 충돌·부모 폴더 문제는 미완료 항목 유지
- Windows `IFileOperation`의 삭제 완료 콜백에서 받은 Shell 항목 ID와 실제 휴지통 위치 보관, 복원은 해당 ID로 Shell 이동 API 호출
- Windows 휴지통 요청의 비가역 삭제 전환 거부, 연결 HTML 리소스 등의 선택 밖 항목 동반 삭제 금지
- Windows 복원 직전 원본·부모 동일성·대상 충돌 재검사, Shell의 충돌 이름 변경으로 기존 대상 덮어쓰기 방지
- 복원 경합으로 다른 이름에 보관된 결과는 실제 보관 위치와 재시도 가능한 이력 유지, 경합을 성공으로 보고 금지
- macOS·Windows 외 플랫폼의 기존 휴지통 동작 유지, 복원 메뉴 노출 제외

## 플랫폼 지원 정보

- `get_platform_info`: 인수 없음, OS와 실제 OS 연동 구현의 지원 정보 반환
- 응답 계약: `{ os: string, features: { openWith: boolean, currentFolderManager: boolean, currentFolderTerminal: boolean, nativeFileClipboard: boolean, trashUndo: boolean } }`
- `COMMANDS` 등록 여부와 플랫폼 기능 지원 여부의 구분 필수
- 실제 Tauri 실행에서 조회 대기·실패 시 해당 OS 전용 기능의 실행 차단
- 메뉴·컨텍스트 메뉴·실행·OS 클립보드·휴지통 복원에서 동일 지원 정보 사용
- Windows W0~W2에서는 위 OS 전용 기능 false 유지, 기존 내부 클립보드·공통 파일 작업 유지
- UI 경로는 Rust에서 받은 원문 유지, Windows UNC·확장 드라이브 루트의 부모 계산 보존
- 관련 정책·네이티브 검증: [Windows 검증](windows-validation.md) 참조

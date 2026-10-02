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
- 일반 파일의 directoryStats는 null

| directoryStats 필드 | 타입 | 설명 |
| --- | --- | --- |
| totalFileBytes | number | 선택 폴더 아래 일반 파일의 논리적 크기 합계(byte) |
| fileCount | number | 하위 일반 파일 수; 숨김 파일 포함 |
| directoryCount | number | 선택 폴더 자신을 제외한 하위 실제 폴더 수 |

- 하위 폴더까지 별도 작업 스레드에서 순회하되 심볼릭 링크를 따라가지 않고 링크·소켓 등 특수 파일은 집계에서 제외
- 접근 오류가 나면 불완전한 합계를 반환하지 않고 get_metadata 오류를 반환

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
| `watch_path` | `{ panelId, path }` | `WatchAck` | 현재: 경로 검증/version ACK; 실제 변경 이벤트 구독은 미구현 |
| `goto_path` | `{ panelId, path }` | `DirectoryListing` | 주소 입력/북마크/히스토리 이동 |
| `list_locations` | `{}` | `LocationList` | 홈/드라이브/마운트 quick access |
| `create_dir` | `{ parent, name }` | `FileEntry` | 이름 검증 |
| `rename_entry` | `{ path, newName }` | `FileEntry` | 같은 parent 내 rename |
| `start_copy` | `{ sources, targetDir, policy }` | `OperationStarted` | 진행률 event |
| `start_move` | `{ sources, targetDir, policy }` | `OperationStarted` | rename 우선, fallback copy+delete |
| `start_delete` | `{ targets, mode, confirmToken? }` | `OperationStarted` | `trash`/`permanent`; permanent는 `PERMANENT_DELETE` token 필요 |
| `cancel_operation` | `{ operationId }` | `CancelAck` | cooperative cancel |
| `resolve_conflict` | `{ operationId, decision }` | `ConflictAck` | overwrite/skip/allOverwrite/allSkip/cancel |
| `archive_list` | `{ archivePath, password?, limit? }` | `ArchiveListing { totalEntries, truncated, ... }` | 기본 50,000개, 최대 200,000개 응답 제한 |
| `archive_create` | `{ sources, targetArchive, format, password? }` | `OperationStarted` | zip/7z 암호 지원; jar/war/tar 계열 암호 미지원 |
| `archive_extract` | `{ archivePath, targetDir, password?, policy, entries?, stripPrefix? }` | `OperationStarted` | zip-slip 차단, 선택 항목 추출 지원 |
| `archive_add` | `{ sources, archivePath, targetInnerDir, policy }` | `OperationStarted` | 일반 파일/폴더를 zip/jar/war/7z 내부 경로에 추가; unsafe 내부 경로 차단 |
| `open_default` | `{ path }` | `ActionResult` | OS 기본 앱 |
| `reveal_in_manager` | `{ path }` | `ActionResult` | Finder/Explorer 등 |
| `open_current_in_finder` | `{ path }` | `ActionResult` | macOS 현재 패널 디렉터리를 Finder에서 열기; 실제 디렉터리 검증 |
| `open_current_in_terminal` | `{ path }` | `ActionResult` | macOS 현재 패널 디렉터리에서 Terminal 열기; 실제 디렉터리 검증 |
| `list_open_with_apps` | `{ path }` | `OpenWithApp[]` | macOS NSWorkspace의 파일 연결 앱 조회, 기본 앱 우선 정렬 |
| `open_with_app` | `{ path, applicationPath }` | `ActionResult` | 파일·앱 재검증 후 선택 앱으로 열기, 기본 연결 유지 |
| `prepare_shell_command` | `{ workingDir, command, args? }` | `ShellCommandPreview` | 설정 게이트, workingDir, command fingerprint 검증 후 짧은 TTL/one-shot `confirmToken` 발급 |
| `run_shell_command` | `{ workingDir, command, args?, confirmToken? }` | `ShellCommandResult` | 설정·작업 디렉터리 검증 후 즉시 실행, stdout/stderr/exitCode 반환; 기존 토큰 전달 시 검증 유지 |
| `load_settings` | `{}` | `Settings` | schema version 포함 |
| `save_settings` | `{ patch }` | `Settings` | 원자적 저장 고려 |

## 4. Event 목록

| Event | Payload | 발행자 | 소비자 |
| --- | --- | --- | --- |
| `dir_changed` | `{ panelId, path, version }` | watch service | panel store |
| `operation_progress` | `OperationProgress` | operation service | operation store/dialog |
| `operation_conflict` | `ConflictPrompt` | operation service | conflict dialog |
| `operation_summary` | `OperationSummary` | operation service | queue/toast/panel refresh |
| `operation_completed` | `OperationSummary` | operation service | `operation_summary` 호환 alias |
| `operation_error` | `OperationError` | operation service | error summary/log |
| `settings_changed` | `Settings` | settings service | UI providers |

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
- `prepare_shell_command`와 `confirmToken`은 기존 호출 호환용; GUI는 토큰 없이 `run_shell_command`를 직접 호출
- 토큰을 전달한 기존 호출은 backend가 작업 디렉터리/명령 fingerprint와 TTL/one-shot 조건을 검증; 무효·만료 시 `invalid_token`/`errors.shellConfirmationInvalid` 반환
- renderer 권한은 command invocation에 필요한 범위로 제한

## 6. TypeScript wrapper 규칙

- UI는 `invoke`를 직접 호출하지 않고 `src/tauri/client.ts`의 typed wrapper만 사용
- wrapper는 `Result<T, AppError>` 형태로 normalize
- i18n 문자열은 Rust가 완성 문장으로 보내지 않고 `messageKey`와 structured details 전달


## 구조 리팩토링의 계약 보존

- 2026-09-27 기준 `src-tauri/src/contracts.rs`가 DTO와 오류 타입을, `commands.rs`가 명령 핸들러를 소유
- `lib.rs`에는 앱 초기화와 기존 이름의 command 등록 유지
- 서비스와 작업 엔진의 파일 분리는 command/event 이름, serde 필드/enum 값, 설정 JSON 형식을 변경하지 않음

- 프론트엔드 명령 이름은 `src/tauri/commands.ts`, 호출과 이벤트 수신은 `client.ts`, 네이티브 드래그/창 어댑터는 `commanderClients.ts`가 담당
- `client.ts`의 기존 명령 이름 export도 유지
- 공통 직렬화 fixture는 `src/tauri/fixtures/contract.json`이며 `contract.test.ts`와 Rust `contract_tests.rs`에서 양쪽 형식 검증

## 다음으로 열기 계약

- `OpenWithApp`: `{ path: string, name: string, isDefault: boolean }`
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

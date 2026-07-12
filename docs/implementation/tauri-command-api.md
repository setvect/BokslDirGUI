# Tauri Command API 명세

## 1. 목적

React/TypeScript UI와 Rust/Tauri backend 사이의 command, event, DTO 계약을 정의한다.

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
| `path` | string | 절대 경로. UI 표시 전 escaping 필요 |
| `name` | string | 파일명 |
| `kind` | EntryKind | 타입 |
| `sizeBytes` | number/null | 알 수 없으면 null |
| `modifiedAt` | string/null | ISO timestamp |
| `createdAt` | string/null | 플랫폼별 가능 시 |
| `permissions` | string/null | 표시용 권한 |
| `owner` | string/null | 플랫폼에서 확인 가능한 소유자 표시값 |
| `group` | string/null | 플랫폼에서 확인 가능한 그룹 표시값 |
| `isHidden` | boolean | 숨김 여부 |
| `isVirtual` | boolean | `..` 같은 가상 항목 |

### 2.2 AppError

| 필드 | 타입 | 설명 |
| --- | --- | --- |
| `code` | string | `not_found`, `permission_denied`, `conflict`, `invalid_path`, `unsupported`, `io_error` 등 |
| `messageKey` | string | i18n key |
| `path` | string/null | 관련 경로 |
| `details` | object/null | 로그/디버그용 structured data |
| `recoverable` | boolean | 계속 진행 가능 여부 |

### 2.3 ShellCommandPreview

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
| `get_metadata` | `{ path }` | `FileMetadata` | 속성/preview |
| `watch_path` | `{ panelId, path }` | `WatchAck` | 변경 이벤트 구독 |
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
| `open_external_editor` | `{ path, editorId? }` | `ActionResult` | 명시 확인/설정 기반 |
| `prepare_shell_command` | `{ workingDir, command, args? }` | `ShellCommandPreview` | 설정 게이트, workingDir, command fingerprint 검증 후 짧은 TTL/one-shot `confirmToken` 발급 |
| `run_shell_command` | `{ workingDir, command, args?, confirmToken }` | `ShellCommandResult` | `confirmToken`/fingerprint 재검증 후 실행, stdout/stderr/exitCode 반환 |
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

- 모든 path는 Rust에서 canonicalize/normalize한다.
- `..` virtual entry는 파일 작업 대상이 될 수 없다.
- copy/move는 자기 자신 내부 대상, 중복 대상, 권한 오류를 선검증한다.
- archive extract는 target directory 밖 쓰기를 차단한다.
- archive add는 `targetInnerDir`와 생성할 entry를 정규화하고 절대 경로, `..`, NUL을 차단한다. 같은 이름은 공통 conflict decision으로만 덮어쓴다.
- 압축 가상 경로는 읽기 전용이다. delete/rename/move/create-dir command에 압축 내부 경로를 전달하지 않으며 action registry에서도 선차단한다.
- 지원 형식은 zip, tar, tar.gz/tgz, tar.zst/tzst, 7z, jar, war다. jar/war는 zip provider, tar 계열은 tar provider를 사용한다.
- `archive_list.limit`는 1~200,000 범위로 제한하며 생략 시 50,000을 사용한다. 잘린 응답은 `truncated=true`와 원본 `totalEntries`를 반환한다.
- password는 event/log/details에 남기지 않는다.
- `run_shell_command`는 설정 키 `external.shellCommand.enabled === true`일 때만 활성화하고, shell interpolation을 피하기 위해 command/args를 분리하며, workingDir은 활성 패널 경로로 검증한다.
- `preview_file(path, maxBytes?)`는 일반 파일만 읽고 텍스트는 최대 1 MiB, 이미지는 8 MiB로 제한한다. 미지원 형식과 제한 초과 이미지는 command 오류가 아니라 `unsupported`/`tooLarge` 결과로 반환하며 파일을 실행하지 않는다.
- `confirmToken`은 Rust backend가 `prepare_shell_command`에서 발급하는 짧은 TTL/one-shot token으로 정의하며, `run_shell_command` 실행 시 backend가 token, workingDir, command fingerprint를 재검증한다. renderer가 임의 문자열로 확인을 우회할 수 없어야 한다.
- renderer 권한은 command invocation에 필요한 범위로 제한한다.

## 6. TypeScript wrapper 규칙

- UI는 `invoke`를 직접 호출하지 않고 `src/tauri/client.ts`의 typed wrapper만 사용한다.
- wrapper는 `Result<T, AppError>` 형태로 normalize한다.
- i18n 문자열은 Rust가 완성 문장으로 보내지 않고 `messageKey`와 structured details를 보낸다.

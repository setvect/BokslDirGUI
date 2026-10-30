# 파일 작업 상태 머신 설계

## 1. 목적

- 복사, 이동, 삭제, 휴지통, 압축 생성/해제/내부 추가 같은 데이터 변경 작업의 안전성·테스트 가능성 확보

## 2. 공통 상태

- 공통 충돌 결정 enum은 command API와 동일하게 고정

```ts
type ConflictDecision = 'overwrite' | 'skip' | 'allOverwrite' | 'allSkip' | 'cancel';
```

```text
idle
  -> validating
  -> scanning
  -> queued
  -> running
  -> waitingForConflict
  -> running
  -> cancelling
  -> cancelled
  -> completed
  -> completedWithErrors
  -> failed
```

## 3. 상태 정의

| 상태 | 의미 | UI 표시 | 허용 command |
| --- | --- | --- | --- |
| `validating` | 경로/권한/대상 위험 검사 | blocking dialog 또는 inline spinner | cancel |
| `scanning` | 파일 수/바이트 계산 | progress 준비 | cancel |
| `queued` | backend가 작업을 접수했거나 실제 I/O 시작을 기다리는 상태 | 지연 시간 전에는 즉시 상태만 반영하고, 긴 작업이면 progress dialog | cancel |
| `running` | 실제 I/O 진행 | progress dialog | cancel |
| `waitingForConflict` | 충돌 결정 대기 | conflict dialog | resolve/cancel |
| `cancelling` | cooperative cancel 처리 중 | cancelling 표시 | none |
| `completed` | 전체 성공 | 상태 표시줄 후 양쪽 패널 자동 새로고침 | none |
| `completedWithErrors` | 일부 실패 | error summary | show log/retry 후보 |
| `failed` | 시작/진행 불가 | error dialog | close/show log |
| `cancelled` | 사용자 취소 | cancel summary | close |

## 4. 작업별 정책

- 현재는 **단일 활성 작업**만 허용
- 진행 중 새 파일 작업은 `operation_busy`로 차단해 충돌 결정, 취소, 완료 후 패널 새로고침의 순서를 결정적으로 유지
- 2026-10-30: 백엔드도 `operation/runtime.rs`의 `launch_operation` 한곳에서 앱 작업 자리를 잡아 두 번째 작업을 `operation_busy`로 거절, 요약 발행 직전에 자리 해제
- 시작 공통 경계: 자리 확보 → 등록 → `queued` 응답 → 작업 스레드의 첫 상태 알림·실행·요약 발행·등록 해제, 스레드 생성 실패 시 등록과 자리 정리 후 오류 반환
- 휴지통 되돌리기는 자리를 먼저 잡은 뒤 기록을 꺼내 거절 시 되돌리기 기록 유지
- `queued`는 작업 접수 직후 UI가 즉시 만드는 상태이지만 실제 다중 작업 큐를 의미하지 않음

### 4.1 Copy

- target은 반대 패널 경로를 기본 제안
- 자기 자신 내부 복사를 validation에서 차단
- symlink 정책은 copy mode에 명시하고 UI에 표시
- 충돌 시 `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel` 지원
- 재귀 복사 중 Unix 소켓은 복사 대상에서 제외 수만 기록하고 나머지 항목을 계속 복사
- 소켓 제외만으로는 실패 메시지를 띄우지 않음
- 장치·FIFO 등 다른 특수 파일은 경로별 오류를 남기고 일부 실패로 표시

### 4.2 Move

- 같은 filesystem이면 rename 우선
- 실패하거나 cross-device면 copy 후 source delete fallback
- fallback 중 실패하면 partial result를 summary에 표시
- 이동 원본에 소켓·장치 등 특수 파일이 있으면 사전 검사에서 거부
- 일부만 복사한 뒤 원본을 삭제하지 않음

### 4.3 Delete/Trash

- 휴지통과 영구 삭제는 별도 action
- 영구 삭제는 기본 버튼을 cancel로 배치
- 휴지통 실패 시 영구 삭제로 자동 전환하지 않음

### 4.4 Archive List/Create/Extract/Add

- zip/jar/war, tar/tar.gz/tgz/tar.zst/tzst, 7z 형식별 provider 분리
- 압축 가상 디렉터리는 읽기 전용이며 내부 delete/rename/move/create-dir은 action 단계에서 차단
- `archive_list`는 기본 50,000개(최대 200,000개)로 응답을 제한하고 `totalEntries`/`truncated`를 반환
- extract는 모든 entry path를 target directory 아래로 normalize한 후 쓰기 시작
- zip/7z password는 masked UI로 입력받고 log/event/history/error details에 남기지 않음
- jar/war/tar 계열에 암호를 요청하면 typed unsupported 오류를 반환
- 7z는 `archive-7z` fixture gate를 통과해야 완료로 판단
- 압축 생성 중에는 provider의 출력에서 처리량을 읽어 `operation_progress` 갱신
- ZIP/JAR/WAR는 처리한 항목·원본 바이트와 대용량 파일의 진행 점을 사용하고, 7z는 provider 백분율로 바이트·항목 수를 추정
- 압축 파일 게시가 끝난 뒤에만 완료 상태 전달
- 일반 패널에서 압축 가상 디렉터리로 복사하면 `file.copy` UX를 유지하되 backend 실행은 `archive_add`로 라우팅
- archive add는 source를 안전한 staging 경로에 구성한 뒤 provider에 상대 경로만 전달
- 같은 archive entry가 있으면 `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel`을 적용하고 overwrite는 기존 entry subtree를 제거한 뒤 추가
- 성공, 실패, 취소 요약 후 source/target panel을 모두 refresh하여 부분 결과도 즉시 반영

### 4.5 ShellCommand

- 기존 단일 작업 controller·진행 이벤트·취소·요약·패널 새로고침 경로 사용
- 실행 버튼으로 확정한 입력의 단회 토큰 검증 후 장기 작업 시작, 준비 응답 대기 중 취소 시 프로세스 실행 없음
- 표준 입력 없는 비대화형 실행, 대화형 명령은 현재 폴더의 터미널 열기 사용
- 실행 상태·작업 폴더·출력 바이트 수 표시, 전체 작업량을 알 수 없는 명령의 임의 완료율 표시 금지
- 출력 스트림별 16 KiB 보관 상한과 실제 출력 배출 분리, 파이프 포화·무제한 메모리 적재 방지
- 5분 제한 시 실패·시간 초과 요약, 사용자 취소 시 취소 요약과 이미 수집한 출력 유지
- Windows Job Object·Unix 프로세스 그룹의 종료 사용, 부모 종료 후 파이프를 유지하는 자식도 취소 대상 포함
- 취소의 이미 수행된 명령 효과 자동 롤백 보장 없음, 종료 코드·부분 출력·양쪽 패널 새로고침으로 결과 확인

### 4.6 원격 전송·삭제·권한 변경

- 근거: [SFTP 요구사항](../requirements/07-remote-sftp.md) FR-37·38, 2026-10-31 구현
- 공통: 기존 작업 런타임(단일 작업 자리·진행률·충돌·취소·요약) 사용, 작업 스레드에서 요청마다 원격 런타임 실행
- 원격 전송(`operation/remote_transfer.rs`): 원본·대상 끝점(로컬·원격) 조합 하나의 흐름

| 단계 | 처리 |
| --- | --- |
| 검증 | 원본 위치 하나, 관련 연결 존재, 자기 안으로 복사·이동 차단 |
| 같은 서버 이동 | 서버 이름 변경, 충돌은 선택(건너뛰기·덮어쓰기는 백업 후 교체) |
| 스캔 | 링크 정책(보존·대상 복사·건너뛰기) 적용, 대상 복사는 조상 폴더 재진입 차단, 특수 파일 거부 |
| 최상위 항목 전송 | 같은 폴더의 임시 이름으로 전체 전송 후 게시, 덮어쓰기는 기존 항목을 백업으로 옮긴 뒤 게시하고 백업 삭제(실패 시 복원) |
| 파일 | 256KiB 단위 전송, 크기 확인, 수정 시각 보존 |
| 취소·실패 | 임시본 삭제, 끊김으로 실패한 단일 파일 임시본만 이어받기용으로 보존 |
| 이어받기 | 임시 이름에 원본 크기·수정 시각, 16곳 표본이 원본과 같을 때만 이어서 전송, 다르면 처음부터 |
| 이동 | 게시 성공 뒤 원본 삭제, 실패한 최상위 항목의 원본은 보존 |

- 원격 영구 삭제(`operation/remote_ops.rs`): 휴지통 없음, 확인 문구 토큰 필수, 원격 루트·홈 보호, 중첩 대상 정리, 링크는 따라가지 않고 링크 자체 삭제, 대상 하나가 실패하면 그 대상의 남은 항목 건너뜀
- 원격 권한 변경: kind=chmod, 재귀가 아니면 선택 항목만, 재귀면 선택 항목 포함 전체를 범위로 거르고 링크 제외
- 원격 다중 이름 변경: 로컬과 같은 이름 규칙, 실행 직전 항목별 재검증, 첫 실패에서 중단
- 연결 끊김: 진행 중 요청은 `remote_connection_lost`로 실패, 요약에 남은 항목 표시, 다음 목록 요청에서 저장된 방법으로 한 번 재연결

## 5. ConflictPrompt

| 필드 | 설명 |
| --- | --- |
| `operationId` | 작업 ID |
| `source` | 원본 entry 정보 |
| `destination` | 대상 entry 정보 |
| `defaultDecision` | 안전 기본값, 보통 skip/cancel |
| `availableDecisions` | `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel` |

## 6. Progress event

- 전체 파일 수, 완료 파일 수
- 전체 바이트, 완료 바이트
- 현재 파일명/경로
- 속도, ETA
- 최근 오류 개수
- operation state

## 7. 패널 refresh 정책

- 작업 성공/부분 성공 후 관련 source/target panel listing version을 invalidate
- 프론트 완료 공통 처리(`src/ui/operationCompletion.ts`): 양쪽 패널 새로고침과 "작업 이름 결과" 상태 메시지(작업 이름은 대화상자 제목, 예: 복사 완료·이동 완료), 선택 해제는 작업별 기준(일반 작업은 전체 성공 시, 다중 이름 변경은 일부라도 바뀌면)
- refresh 실패는 작업 성공을 되돌리지 않고 panel error로 표시
- 취소/실패 후 임시 파일/디렉토리 정리를 시도하고 결과를 summary에 포함

## 8. 테스트 기준

- validation은 위험 경로를 실제 I/O 전에 차단
- `allOverwrite`와 `allSkip` 결정은 이후 같은 작업의 충돌에 일관 적용
- cancel은 안전 지점에서 멈추고 partial result를 요약
- zip-slip fixture는 target 밖 쓰기를 실패 처리
- 일부 실패는 앱 상태를 손상시키지 않음


## 9. 2026-09-25 리뷰 반영

- 덮어쓰기는 완성된 작업 사본을 게시하며 기존 대상은 게시 성공 전까지 백업으로 보존
- 복원 경합 시 백업을 제거하지 않고 오류 상세에 복구 경로 기록
- 파일 복사 중 실패/취소는 해당 불완전 파일을 제거하며 권한 보존
- 재귀 복사의 Unix 소켓은 오류 없이 제외하고 다른 특수 파일은 경로별 오류를 남기며, 이동·압축 생성의 특수 파일은 사전 검사에서 거부
- 압축 생성/추가는 provider가 원본 대상을 직접 변경하지 않고 작업 사본을 완성한 뒤 게시
- 압축 해제의 skip은 성공 수에 포함하지 않음
- 휴지통은 macOS FileManager·Windows Shell API 사용, 다른 OS의 `trash` 라이브러리 구현 유지
- macOS에서는 Finder 자동화 권한이 필요 없는 NSFileManager 방식 선택
- 휴지통 실패 시 영구 삭제로 fallback하지 않고 원본을 유지하며 OS 오류 표시
- 테스트 override는 테스트 빌드에서만 허용
- 재귀 스캔과 영구 삭제는 항목별 취소를 확인하고 부분 처리 수 유지
- 완료 시 양쪽 패널의 **현재 경로**를 background refresh
- 사용자가 시작한 탐색·현재 활성 패널·모달 입력 포커스 작업 완료 때문에 변경하지 않음
- 지연된 시작 ACK/atomic 응답은 자신이 시작된 controller/dialog에만 적용
- 취소/충돌 명령 실패는 재시도할 수 있게 UI 상태를 복구
- OS별 미검증 및 남은 설계 차이는 [전체 리뷰 보고서](code-review-2026-09-25.md)에 별도로 추적


### 휴지통 복원 수명주기

- macOS 실제 휴지통 경로·Windows Shell 항목 ID를 Rust의 세션 이력에 보관, 최근 20개 작업과 공통 복원 확인·진행·취소·요약 유지
- Windows 삭제의 휴지통 플래그 없는 콜백 거부, 영구 삭제 fallback·선택 밖 연결 항목 변경 금지
- 복원 직전 원본·부모 폴더 동일성·이름 충돌 재검사, Windows Shell 완료 콜백의 실제 결과를 이력 갱신 근거로 사용
- 늦은 취소보다 실제 완료 항목의 영수증 보존 우선, 미완료 항목의 이력 유지
- Windows 복원 경합에서 안전한 다른 이름이 생성된 경우 해당 보관 위치 안내와 재시도 유지, 기존 대상 덮어쓰기 금지

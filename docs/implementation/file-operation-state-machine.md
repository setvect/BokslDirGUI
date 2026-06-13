# 파일 작업 상태 머신 설계

## 1. 목적

복사, 이동, 삭제, 휴지통, 압축 생성/해제 같은 데이터 변경 작업을 안전하고 테스트 가능하게 만든다.

## 2. 공통 상태

공통 충돌 결정 enum은 command API와 동일하게 고정한다.

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
| `queued` | 실행 대기 | 작업 큐 | cancel |
| `running` | 실제 I/O 진행 | progress dialog/queue | cancel |
| `waitingForConflict` | 충돌 결정 대기 | conflict dialog | resolve/cancel |
| `cancelling` | cooperative cancel 처리 중 | cancelling 표시 | none |
| `completed` | 전체 성공 | toast/summary | reveal/open target |
| `completedWithErrors` | 일부 실패 | error summary | show log/retry 후보 |
| `failed` | 시작/진행 불가 | error dialog | close/show log |
| `cancelled` | 사용자 취소 | cancel summary | close |

## 4. 작업별 정책

### 4.1 Copy

- target은 반대 패널 경로를 기본 제안한다.
- 자기 자신 내부 복사를 validation에서 차단한다.
- symlink 정책은 copy mode에 명시하고 UI에 표시한다.
- 충돌 시 `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel`을 지원한다.

### 4.2 Move

- 같은 filesystem이면 rename 우선.
- 실패하거나 cross-device면 copy 후 source delete fallback.
- fallback 중 실패하면 partial result를 summary에 표시한다.

### 4.3 Delete/Trash

- 휴지통과 영구 삭제는 별도 action.
- 영구 삭제는 기본 버튼을 cancel로 둔다.
- 휴지통 실패 시 영구 삭제로 자동 전환하지 않는다.

### 4.4 Archive Create/Extract

- zip/tar/gz/zstd/7z 형식별 provider를 분리한다.
- extract는 모든 entry path를 target directory 아래로 normalize한 후 쓰기 시작한다.
- password는 masked UI로 입력받고 log/event에 남기지 않는다.
- 7z는 `archive-7z` fixture gate를 통과해야 완료로 본다.

## 5. ConflictPrompt

| 필드 | 설명 |
| --- | --- |
| `operationId` | 작업 ID |
| `source` | 원본 entry 정보 |
| `destination` | 대상 entry 정보 |
| `defaultDecision` | 안전 기본값, 보통 skip/cancel |
| `availableDecisions` | `overwrite`, `skip`, `allOverwrite`, `allSkip`, `cancel` |

## 6. Progress event

- 전체 파일 수, 완료 파일 수.
- 전체 바이트, 완료 바이트.
- 현재 파일명/경로.
- 속도, ETA.
- 최근 오류 개수.
- operation state.

## 7. 패널 refresh 정책

- 작업 성공/부분 성공 후 관련 source/target panel listing version을 invalidate한다.
- refresh 실패는 작업 성공을 되돌리지 않고 panel error로 표시한다.
- 취소/실패 후 임시 파일/디렉토리 정리를 시도하고 결과를 summary에 포함한다.

## 8. 테스트 기준

- validation은 위험 경로를 실제 I/O 전에 차단한다.
- `allOverwrite`와 `allSkip` 결정은 이후 같은 작업의 충돌에 일관 적용된다.
- cancel은 안전 지점에서 멈추고 partial result를 요약한다.
- zip-slip fixture는 target 밖 쓰기를 실패시킨다.
- 일부 실패는 앱 상태를 손상시키지 않는다.

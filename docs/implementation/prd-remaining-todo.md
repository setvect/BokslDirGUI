# PRD 기준 남은 작업 TODO

- 작성일: 2026-07-11
- 기준 문서:
  - `docs/requirements/02-file-operations.md`
  - `docs/requirements/04-gui-desktop-interactions.md`
  - `docs/requirements/05-customization-platform-quality.md`
  - `docs/implementation/tui-parity-map.md`
  - `docs/implementation/tui-parity-matrix.md`
  - `docs/implementation/tui-parity-matrix.json`
  - `docs/implementation/tauri-command-api.md`
- 목적: 문서상 `implemented`로 표시된 항목이라도 실제 사용자 시나리오 기준으로 덜 닫힌 작업을 추적

## 완료 판정 규칙

- [ ] 체크는 실제 UI 동작, Rust backend 동작, 프론트 테스트, Rust 테스트, 문서 갱신이 모두 맞을 때만 수행
- [ ] UI shell/mock 통과만으로 완료 처리하지 않음
- [ ] `docs/implementation/tui-parity-matrix.md` / `.json`의 `implemented` 상태는 실제 테스트 근거와 함께 갱신
- [ ] 새 command/action이 생기면 `docs/implementation/action-registry.md`, `docs/implementation/tauri-command-api.md`, `scripts/verify-full-scope.mjs`도 같이 갱신

## P0 — 압축 파일을 디렉터리처럼 다루는 핵심 쓰기 작업

### 1. 일반 파일/디렉터리 → 압축 파일 내부 복사

- [x] `archive_add` Rust command를 추가
  - 입력 후보: `{ sources, archivePath, targetInnerDir, policy }`
  - 출력: `OperationStarted`
  - 상태 전이: scanning → running → completed / completedWithErrors / cancelled
- [x] `OperationKind`에 `archiveAdd`를 추가
- [x] Tauri invoke handler에 `archive_add` 등록
- [x] `src/tauri/client.ts`에 `COMMANDS.archiveAdd`, `BACKEND_IMPLEMENTED_COMMANDS`, `tauriClient.archiveAdd()`를 추가
- [x] 일반 파일/디렉터리 복사 대상이 `archive.zip:/inner/path`이면 `start_copy`가 아니라 `archive_add`로 라우팅
- [x] 대상 압축 내부 경로가 없으면 안전하게 생성 가능한 경로로 처리
- [x] zip 내부 대상 경로가 `../`, 절대경로, NUL 문자를 포함하면 차단
- [x] 7z 내부 대상 경로도 동일한 안전 검증을 적용
- [x] 성공 후 대상 압축 패널을 refresh해서 새로 추가된 항목의 즉시 표시
- [x] 실패/취소 후에도 부분 추가 결과가 있으면 대상 패널 refresh 정책을 적용

### 2. 압축 내부 복사 충돌 처리

- [x] 압축 내부에 같은 이름의 항목이 있으면 충돌 다이얼로그 표시
- [x] `overwrite`는 기존 압축 내부 항목을 제거한 뒤 새 항목을 추가
- [x] `skip`은 해당 항목만 건너뛰기
- [x] `allOverwrite` / `allSkip`을 다중 항목에 적용
- [x] `cancel`은 이후 항목 처리를 중단하고 요약 표시
- [x] 충돌 UI에는 내부 command id가 아니라 사용자 용어만 표시

### 3. 압축 내부 선택 항목 → 일반 디렉터리 복사 회귀 고정

- [x] 현재 구현된 `archive_extract(entries, stripPrefix)` 기반 복사가 일반 `file.copy` UX와 동일하게 동작하는지 테스트를 보강
- [x] 압축 내부 파일 1개 복사 테스트를 추가
- [x] 압축 내부 디렉터리 복사 테스트를 추가
- [x] 압축 내부 다중 선택 복사 테스트를 추가
- [x] 복사 완료 후 일반 대상 패널 refresh와 선택 해제 정책 검증

## P1 — 압축 파일 가상 디렉터리 기능 확장

### 4. 압축 내부 삭제/이름 변경/이동 정책 결정

- 정책: 압축 가상 디렉터리는 읽기 전용으로 유지
- copy-in/copy-out은 지원하지만 delete/rename/move/create-dir은 action registry에서 비활성화하고 패널 상태줄에 이유 표시

- [x] 압축 내부 항목 삭제를 지원할지 결정
  - 지원 시: `archive_delete` command와 안전 확인 다이얼로그를 추가
  - 미지원 시: 메뉴/단축키/컨텍스트 메뉴에서 명확히 비활성화하고 이유 표시
- [x] 압축 내부 항목 이름 변경을 지원할지 결정
  - 지원 시: provider별 rename 가능 여부 검증
  - 미지원 시: 비활성화 상태와 안내 메시지 제공
- [x] 압축 내부 항목 이동을 지원할지 결정
  - 지원 시: 같은 archive 내부 이동과 archive 밖 이동 구분
  - 미지원 시: 사용자가 일반 파일 이동처럼 오해하지 않도록 차단
- [x] 위 정책을 `docs/implementation/action-registry.md`와 `docs/implementation/tui-parity-matrix.md`에 반영

### 5. 지원 압축 포맷 범위 정리

- 지원 범위: zip, tar, tar.gz/tgz, tar.zst/tzst, 7z, jar, war의 list/create/extract 제공
- jar/war는 zip provider, tar 계열은 tar provider 사용

- [x] 현재 실제 지원 범위와 PRD `FR-14.1`의 요구 포맷을 대조
  - PRD 요구: zip, tar, tar.gz/tgz, tar.zst/tzst, 7z, jar, war
  - 완료 구현: zip, tar, tar.gz/tgz, tar.zst/tzst, 7z, jar, war
- [x] jar/war를 zip 호환 포맷으로 감지/list/extract/create 할지 결정
- [x] tar, tar.gz/tgz, tar.zst/tzst 지원 여부 결정
- [x] 구현하지 않을 필수 포맷이 없음 확인
- [x] 구현할 포맷은 provider adapter, fixture, unsafe path guard 테스트를 추가

### 6. 암호 압축 파일 지원 정책 정리

- 정책: zip/7z 생성·목록·해제 암호 지원
- 입력은 masking하고 operation summary/history/error 직렬화에는 암호를 남기지 않음
- jar/war/tar 계열 암호는 명시적인 미지원 오류를 반환

- [x] PRD `FR-14.6`의 암호 지원 Must와 현재 unsupported 정책을 정합화
- [x] 암호 목록 조회를 지원할지 결정
- [x] 암호 해제를 지원할지 결정
- [x] 암호 압축 생성을 지원할지 결정
- [x] 지원 시 암호 입력 UI는 masking input 사용
- [x] 작업 로그, 오류 상세, history에 암호가 남지 않도록 테스트
- [x] jar/war/tar 계열 암호 미지원은 typed 오류와 UI 문구로 명확히 안내

### 7. 대용량 압축 파일 listing 전략

- 정책: `archive_list` 응답은 기본 50,000개, 최대 200,000개로 제한
- `totalEntries`와 `truncated`를 반환하고 패널에 “일부만 표시됨”을 표시

- [x] 압축 내부 항목이 매우 많을 때의 표시 제한 정책 결정
- [x] `archive_list`에 limit 또는 paging 전략을 추가할지 결정
- [x] 일부만 표시될 경우 panel header/status에 “일부만 표시됨” 상태 표시
- [x] 대형 zip fixture 테스트를 추가
- [x] 대형 7z fixture 테스트를 provider가 있는 환경에서 조건부로 추가

## P1 — 사용자 시나리오 검증 보강

### 8. 실제 파일 커맨더 시나리오 테스트

- 근거: `CommanderShell.test.tsx`의 일반/압축 양방향 복사, Enter/Backspace 탐색, Space 다중 선택 시나리오와 Rust temp fixture의 충돌 결정 테스트를 완료 기준으로 사용

- [x] “일반 디렉터리 → 일반 디렉터리 복사” E2E 시나리오를 고정
- [x] “일반 디렉터리 → 압축 내부 복사” E2E 시나리오를 추가
- [x] “압축 내부 → 일반 디렉터리 복사” E2E 시나리오를 추가
- [x] “압축 파일 Enter 진입 → 하위 폴더 진입 → Backspace 상위 이동” 시나리오를 추가
- [x] “압축 내부 파일 선택 → Space 다중 선택 → 복사” 시나리오를 추가
- [x] “충돌 처리 overwrite/skip/allOverwrite/allSkip/cancel” 시나리오를 추가

### 9. PRD와 검증 게이트 정합성 보강

- 근거: full-scope 정적 게이트와 semantic test가 archive_add, 읽기 전용 정책, 필수 형식, 암호 비노출, 대형 목록 제한을 함께 검사

- [x] `scripts/verify-full-scope.mjs`가 `archive_add` 구현 여부 검사
- [x] `src/verification/fullScope.test.ts`가 archive add command/client/action 경계 검사
- [x] `docs/implementation/tui-parity-matrix.json`에 압축 내부 쓰기 시나리오 근거를 추가
- [x] `docs/implementation/tui-parity-matrix.md`의 archive 관련 `implemented` 설명을 실제 지원 범위에 맞게 수정
- [x] `docs/implementation/tauri-command-api.md`에 `archive_add`를 추가
- [x] `docs/implementation/file-operation-state-machine.md`에 archive add 상태 전이를 추가

## P2 — GUI 확장/편의 기능

### 10. 미리보기/빠른 보기

- [x] 기본 패널을 침범하지 않는 명령 호출형 빠른 보기 오버레이 제공
- [x] `F3` 및 `보기 > 빠른 보기` 액션 제공
- [x] 텍스트/Markdown/코드는 기본 256 KiB(최대 1 MiB), 이미지는 8 MiB로 제한
- [x] 미지원 파일과 제한 초과 이미지는 오류가 아닌 명시적 지원 상태로 표시
- [x] 미리보기는 파일을 자동 실행하거나 HTML로 렌더링하지 않음

### 11. 작업 큐, 알림, Undo

- [x] 동시 장시간 작업 큐는 제공하지 않음
  - 충돌 판단과 패널 새로고침의 결정성을 위해 단일 활성 작업 정책을 유지하고, 진행 중 추가 요청은 명시적으로 차단
- [x] 완료 결과는 인앱 상태 표시줄과 실패/부분 실패 요약으로 제공하며, 별도 시스템 알림은 기본 제공하지 않음
- [x] 완료 후 양쪽 패널을 자동 새로고침하므로 대상 위치 열기/결과 보기 알림 액션은 중복 기능으로 추가하지 않음
- [x] 이동/이름 변경/휴지통 삭제 Undo는 현재 제공하지 않음
  - 안전한 복구에는 영속 작업 journal과 파일 identity 검증이 선행 필수
- [x] Undo UI를 노출하지 않으므로 실행 불가능 상태를 오인하게 만드는 비활성 Undo 항목도 표시하지 않음

### 12. 듀얼 패널 고급 기능

- [x] `ts` 및 `보기 > 패널 경로 맞바꾸기`로 좌우 패널의 탐색 상태와 탭을 맞교환
- [x] `tp` 및 `보기 > 반대 패널에 경로 열기`로 활성 패널의 실제 경로를 반대 패널에서 열기
- [x] `tc` 및 `보기 > 폴더 비교`로 현재 목록의 이름·종류·크기·수정일 차이를 행 표시와 상태 요약으로 제공
- [x] 동기화 복사/양방향 동기화는 오삭제 방지, 방향 규칙, dry-run, 충돌 정책이 필요한 별도 설계 항목으로 분리하고 이번 범위에는 포함하지 않음

## 우선 구현 순서 제안

1. [x] `archive_add` backend command와 operation kind 추가
2. [x] 일반 파일/디렉터리 → 압축 내부 복사 UI 라우팅
3. [x] zip 기준 archive add 테스트
4. [x] 7z 기준 archive add 조건부 테스트
5. [x] 충돌 처리 UX와 tests
6. [x] PRD/matrix/API 문서 정합성 갱신
7. [x] tar/jar/war/password 지원 범위 결정
8. [x] 대형 archive listing 전략 결정

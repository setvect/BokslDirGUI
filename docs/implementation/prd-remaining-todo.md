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
- 목적: 문서상 `implemented`로 표시된 항목이라도 실제 사용자 시나리오 기준으로 덜 닫힌 작업을 추적한다.

## 완료 판정 규칙

- [ ] 체크는 실제 UI 동작, Rust backend 동작, 프론트 테스트, Rust 테스트, 문서 갱신이 모두 맞을 때만 한다.
- [ ] UI shell/mock 통과만으로 완료 처리하지 않는다.
- [ ] `docs/implementation/tui-parity-matrix.md` / `.json`의 `implemented` 상태는 실제 테스트 근거와 함께 갱신한다.
- [ ] 새 command/action이 생기면 `docs/implementation/action-registry.md`, `docs/implementation/tauri-command-api.md`, `scripts/verify-full-scope.mjs`도 같이 갱신한다.

## P0 — 압축 파일을 디렉터리처럼 다루는 핵심 쓰기 작업

### 1. 일반 파일/디렉터리 → 압축 파일 내부 복사

- [x] `archive_add` Rust command를 추가한다.
  - 입력 후보: `{ sources, archivePath, targetInnerDir, policy }`
  - 출력: `OperationStarted`
  - 상태 전이: scanning → running → completed / completedWithErrors / cancelled
- [x] `OperationKind`에 `archiveAdd`를 추가한다.
- [x] Tauri invoke handler에 `archive_add`를 등록한다.
- [x] `src/tauri/client.ts`에 `COMMANDS.archiveAdd`, `BACKEND_IMPLEMENTED_COMMANDS`, `tauriClient.archiveAdd()`를 추가한다.
- [x] 일반 파일/디렉터리 복사 대상이 `archive.zip:/inner/path`이면 `start_copy`가 아니라 `archive_add`로 라우팅한다.
- [x] 대상 압축 내부 경로가 없으면 안전하게 생성 가능한 경로로 처리한다.
- [x] zip 내부 대상 경로가 `../`, 절대경로, NUL 문자를 포함하면 차단한다.
- [x] 7z 내부 대상 경로도 동일한 안전 검증을 적용한다.
- [x] 성공 후 대상 압축 패널을 refresh해서 새로 추가된 항목이 즉시 보이게 한다.
- [x] 실패/취소 후에도 부분 추가 결과가 있으면 대상 패널 refresh 정책을 적용한다.

### 2. 압축 내부 복사 충돌 처리

- [x] 압축 내부에 같은 이름의 항목이 있으면 충돌 다이얼로그를 표시한다.
- [x] `overwrite`는 기존 압축 내부 항목을 제거한 뒤 새 항목을 추가한다.
- [x] `skip`은 해당 항목만 건너뛴다.
- [x] `allOverwrite` / `allSkip`을 다중 항목에 적용한다.
- [x] `cancel`은 이후 항목 처리를 중단하고 요약을 표시한다.
- [x] 충돌 UI에는 내부 command id가 아니라 사용자 용어만 표시한다.

### 3. 압축 내부 선택 항목 → 일반 디렉터리 복사 회귀 고정

- [x] 현재 구현된 `archive_extract(entries, stripPrefix)` 기반 복사가 일반 `file.copy` UX와 동일하게 동작하는지 테스트를 보강한다.
- [x] 압축 내부 파일 1개 복사 테스트를 추가한다.
- [x] 압축 내부 디렉터리 복사 테스트를 추가한다.
- [x] 압축 내부 다중 선택 복사 테스트를 추가한다.
- [x] 복사 완료 후 일반 대상 패널 refresh와 선택 해제 정책을 검증한다.

## P1 — 압축 파일 가상 디렉터리 기능 확장

### 4. 압축 내부 삭제/이름 변경/이동 정책 결정

- [ ] 압축 내부 항목 삭제를 지원할지 결정한다.
  - 지원 시: `archive_delete` command와 안전 확인 다이얼로그를 추가한다.
  - 미지원 시: 메뉴/단축키/컨텍스트 메뉴에서 명확히 비활성화하고 이유를 표시한다.
- [ ] 압축 내부 항목 이름 변경을 지원할지 결정한다.
  - 지원 시: provider별 rename 가능 여부를 검증한다.
  - 미지원 시: 비활성화 상태와 안내 메시지를 제공한다.
- [ ] 압축 내부 항목 이동을 지원할지 결정한다.
  - 지원 시: 같은 archive 내부 이동과 archive 밖 이동을 구분한다.
  - 미지원 시: 사용자가 일반 파일 이동처럼 오해하지 않도록 차단한다.
- [ ] 위 정책을 `docs/implementation/action-registry.md`와 `docs/implementation/tui-parity-matrix.md`에 반영한다.

### 5. 지원 압축 포맷 범위 정리

- [ ] 현재 실제 지원 범위와 PRD `FR-14.1`의 요구 포맷을 대조한다.
  - PRD 요구: zip, tar, tar.gz/tgz, tar.zst/tzst, 7z, jar, war
  - 현재 구현 중심: zip, 7z
- [ ] jar/war를 zip 호환 포맷으로 감지/list/extract/create 할지 결정한다.
- [ ] tar, tar.gz/tgz, tar.zst/tzst 지원 여부를 결정한다.
- [ ] 구현하지 않을 포맷은 PRD에서 후속 기능으로 명확히 낮춘다.
- [ ] 구현할 포맷은 provider adapter, fixture, unsafe path guard 테스트를 추가한다.

### 6. 암호 압축 파일 지원 정책 정리

- [ ] PRD `FR-14.6`의 암호 지원 Must와 현재 unsupported 정책을 정합화한다.
- [ ] 암호 목록 조회를 지원할지 결정한다.
- [ ] 암호 해제를 지원할지 결정한다.
- [ ] 암호 압축 생성을 지원할지 결정한다.
- [ ] 지원 시 암호 입력 UI는 masking input을 사용한다.
- [ ] 작업 로그, 오류 상세, history에 암호가 남지 않도록 테스트한다.
- [ ] 미지원 유지 시 PRD와 UI 문구를 “지원 예정/미지원”으로 명확히 갱신한다.

### 7. 대용량 압축 파일 listing 전략

- [ ] 압축 내부 항목이 매우 많을 때의 표시 제한 정책을 정한다.
- [ ] `archive_list`에 limit 또는 paging 전략을 추가할지 결정한다.
- [ ] 일부만 표시될 경우 panel header/status에 “일부만 표시됨” 상태를 표시한다.
- [ ] 대형 zip fixture 테스트를 추가한다.
- [ ] 대형 7z fixture 테스트를 provider가 있는 환경에서 조건부로 추가한다.

## P1 — 사용자 시나리오 검증 보강

### 8. 실제 파일 커맨더 시나리오 테스트

- [ ] “일반 디렉터리 → 일반 디렉터리 복사” E2E 시나리오를 고정한다.
- [ ] “일반 디렉터리 → 압축 내부 복사” E2E 시나리오를 추가한다.
- [ ] “압축 내부 → 일반 디렉터리 복사” E2E 시나리오를 추가한다.
- [ ] “압축 파일 Enter 진입 → 하위 폴더 진입 → Backspace 상위 이동” 시나리오를 추가한다.
- [ ] “압축 내부 파일 선택 → Space 다중 선택 → 복사” 시나리오를 추가한다.
- [ ] “충돌 처리 overwrite/skip/allOverwrite/allSkip/cancel” 시나리오를 추가한다.

### 9. PRD와 검증 게이트 정합성 보강

- [ ] `scripts/verify-full-scope.mjs`가 `archive_add` 구현 여부를 검사하게 한다.
- [ ] `src/verification/fullScope.test.ts`가 archive add command/client/action 경계를 검사하게 한다.
- [ ] `docs/implementation/tui-parity-matrix.json`에 압축 내부 쓰기 시나리오 근거를 추가한다.
- [ ] `docs/implementation/tui-parity-matrix.md`의 archive 관련 `implemented` 설명을 실제 지원 범위에 맞게 수정한다.
- [ ] `docs/implementation/tauri-command-api.md`에 `archive_add`를 추가한다.
- [ ] `docs/implementation/file-operation-state-machine.md`에 archive add 상태 전이를 추가한다.

## P2 — GUI 확장/편의 기능

### 10. 미리보기/빠른 보기

- [ ] 미리보기 패널을 실제로 제공할지 결정한다.
- [ ] 빠른 보기 키 또는 메뉴를 제공할지 결정한다.
- [ ] 이미지/텍스트/Markdown 미리보기의 안전한 크기 제한을 정한다.
- [ ] 미지원 파일은 오류가 아니라 “미리보기 지원 안 함”으로 표시한다.
- [ ] 실행 가능한 콘텐츠는 자동 실행하지 않는다.

### 11. 작업 큐, 알림, Undo

- [ ] 여러 장시간 작업을 작업 큐로 관리할지 결정한다.
- [ ] 완료 토스트와 시스템 알림 제공 여부를 결정한다.
- [ ] 완료 알림에서 대상 위치 열기/결과 보기 액션을 제공한다.
- [ ] 이동/이름 변경/휴지통 삭제 Undo 지원 여부를 결정한다.
- [ ] Undo 지원 시 이후 파일 변경과 충돌하는 경우의 불가 상태를 표시한다.

### 12. 듀얼 패널 고급 기능

- [ ] 좌우 패널 경로 스왑을 제공할지 결정한다.
- [ ] 한쪽 패널 경로를 반대쪽 패널로 복사하는 액션을 제공할지 결정한다.
- [ ] 폴더 비교 기능을 제공할지 결정한다.
- [ ] 동기화 복사/양방향 동기화는 별도 설계 후 진행한다.

## 우선 구현 순서 제안

1. [x] `archive_add` backend command와 operation kind 추가
2. [x] 일반 파일/디렉터리 → 압축 내부 복사 UI 라우팅
3. [x] zip 기준 archive add 테스트
4. [x] 7z 기준 archive add 조건부 테스트
5. [x] 충돌 처리 UX와 tests
6. [x] PRD/matrix/API 문서 정합성 갱신
7. [ ] tar/jar/war/password 지원 범위 결정
8. [ ] 대형 archive listing 전략 결정

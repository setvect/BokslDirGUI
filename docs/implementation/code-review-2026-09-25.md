# 전체 소스 리뷰 · 2026-09-25

## 기준과 시작 상태

- 기존 미커밋 변경 13개와 새 파일 3개를 포함한 작업 디렉터리를 기준으로 검토했다. 기존 native drag/drop overlay 구현을 보존했고 커밋하지 않았다.
- 시작 상태의 패치와 새 파일 사본은 `/tmp/boksldir-review-initial.patch`, `/tmp/boksldir-review-initial/`에 임시 보관했다.
- 기준: AGENTS.md, 구현 설계의 상태 머신·action registry·command API·전체 테스트 명세, 요구사항, TUI parity map/matrix.
- 초기 `npm run verify`: 프론트 206개, Rust 46개, 정합성 261개 통과. 테스트 통과와 실제 기능 완성은 별도로 판단했다.

## 범위 체크리스트

아래 체크는 해당 영역의 정적 검토와 가용 테스트 검토를 했다는 뜻이다. 플랫폼 실동작이나 모든 결함 부재를 뜻하지 않는다.

- [x] Rust 파일 작업: 경로 검증, 복사/이동, 삭제/휴지통, 충돌, 취소/부분 실패
- [x] 압축: 생성/조회/추가/해제, 경로 이탈, 암호, 외부 provider
- [x] Rust 탐색/메타데이터/미리보기, 설정 저장, 외부 앱/쉘 확인
- [x] React↔Rust DTO/command/event, 작업 store와 다이얼로그 비동기 상태
- [x] 탐색/탭/히스토리/북마크/설정 복원 및 요청 순서
- [x] action registry, 키보드 소유권, 메뉴/도움말/컨텍스트 메뉴
- [x] 마우스 선택/드래그 앤 드롭 및 기존 미커밋 overlay 변경
- [x] 가상 목록/렌더링 성능, 스타일·번역 경계, 유지보수성
- [x] 기능 동등성 매핑, 테스트·빌드·권한 구성, 목업과 실제 앱 검증 경계
- [x] 최종 전체 검증 및 수정 diff 재검토

## 확인하여 수정한 사항

P1은 데이터 손실·잘못된 대상 조작·중요한 상태 손상, P2는 동작·요구사항 불일치다. 위치는 함수명으로 기록해 이후 줄 번호 변경에도 추적할 수 있게 했다.

| ID | 우선순위 / 위치 | 발생 조건과 영향 | 수정 및 검증 근거 |
| --- | --- | --- | --- |
| R01 | P1 · `operation.rs` `copy_tree_replacing` | 기존 대상을 삭제한 뒤 새 파일 게시가 실패하면 원본 대상도 사라짐 | 기존 항목을 백업 경로로 이동한 뒤 no-replace 게시. 실패 시 복원하며 복원이 막히면 백업 경로를 오류 상세에 보존. 게시 실패·동시 작성자 fixture |
| R02 | P1 · `operation.rs` `run_copy/run_move` | `/same/same`을 부모의 부모로 덮어쓰면 원본을 포함한 `/same`이 교체됨 | 원본을 포함하는 대상 경로를 쓰기 전에 차단. 형제 파일과 원본 보존 fixture |
| R03 | P1 · `lib.rs` `rename_entry`, `CommanderShell.tsx` 외부 드롭 경로 | 앞뒤 공백이 있는 기존 이름을 trim하여 다른 항목을 선택할 수 있음 | 기존 파일명·OS 드롭 경로는 정확히 보존. ` note `와 `note` 공존 rename 및 공백 경로 native-drop 컴포넌트 회귀 |
| R04 | P1 · `operation.rs` `scan_work` | 소켓 등 특수 파일을 복사하지 않고 성공으로 계산. 덮어쓰기 이동 시 원본 삭제 가능 | 미지원 특수 파일은 사전 검사에서 typed error. 소켓 포함 디렉터리 이동 시 원본/대상 보존 fixture |
| R05 | P2 · `operation.rs` `copy_file_no_replace` | 취소·읽기/쓰기 오류 시 불완전한 파일이 정상 이름으로 남음. 실행·비공개 권한 유실 | 실패 파일 제거, 정리 실패 경로 기록, 파일 권한 보존 및 Unix 생성 권한 제한. 청크 취소·0700 권한 fixture |
| R06 | P2 · `operation.rs` 재귀 스캔/영구 삭제 | 큰 트리를 조사하거나 단일 폴더를 삭제하는 동안 취소 미확인 | 재귀 항목별 취소 검사, 부분 삭제 건수/바이트 기록, 진행 이벤트 주기 제한. 첫 파일 삭제 후 취소 fixture |
| R07 | P1 · `operation.rs` 압축 생성/추가 | provider가 대상 압축을 직접 수정. 새 항목 추가 실패에도 원본 압축 훼손 가능 | 같은 파일시스템의 작업 사본만 수정하고 성공 후 게시. 실패·취소 시 작업 사본 정리. 일부 데이터를 쓴 뒤 실패하는 provider fixture로 생성/추가 보존 확인 |
| R08 | P1 · `operation.rs` 압축 선택 해제 | 검증하지 않은 `stripPrefix` 또는 staging 부모 symlink로 외부 파일을 읽을 수 있음 | 원문 prefix 경로 검증, 선택 항목과 prefix 관계 검사, staging 내부 부모 확인. prefix 경로 이탈 사전 차단 fixture |
| R09 | P2 · `operation.rs` 압축 진행/요약 | 건너뛴 항목도 성공 수로 보정하고, 압축 생성 디렉터리 크기는 자식 합산 누락 | 실제 처리 수 유지, 생성 전 재귀 합산, 해제 실패 시 이전 성공 수 보존. 전체 skip 시 성공 0/원본 대상 유지 fixture |
| R10 | P2 · `operation.rs` 압축 생성 provider 인자 | `-`로 시작하는 소스 이름이 옵션으로 해석될 수 있음 | 현재 디렉터리 상대 인자를 `./이름`으로 전달. 기존 형식별 round-trip 검증 |
| R11 | P1 · `operation.rs` 휴지통 | OS 전용 API 대신 휴지통 폴더 rename. Linux 복원 정보 누락, Windows 미지원, 이름 충돌 가능 | `trash` 라이브러리로 OS 휴지통 사용. 임시 휴지통 override는 테스트 빌드에만 허용하고 no-replace 사용. 성공/실패 보존 fixture; 실제 OS 복원은 미검증 |
| R12 | P1 · `operationStore.ts` 지연 응답 | 완료 후 늦은 시작 응답이 새 작업 ID를 덮어쓰거나 닫힌 속성 요청이 새 다이얼로그를 변경 | 요청별 다이얼로그 ID/실행 controller 소속 확인, 완료 이력의 지연 이벤트 무시. 늦은 atomic 응답·새 작업 후 이전 ACK 회귀 |
| R13 | P2 · `operationStore.ts` 완료 callback | 작업 중 속성 다이얼로그가 열려 있으면 해당 다이얼로그를 완료 작업으로 오인 | 실행 controller의 callback/draft 우선. 중복 완료 callback 억제. 속성 창 보존 회귀 |
| R14 | P2 · `operationStore.ts` 취소/충돌 응답 | 실패 응답을 버려 UI만 진행 상태로 바뀌고 재시도 불가 | 실패 표시와 진행/충돌 상태 복구. 실패한 충돌 결정 후 prompt 복원 회귀 |
| R15 | P2 · `CommanderShell.tsx` 작업 완료 새로고침 | 작업 중 다른 경로로 이동하면 시작 당시 경로로 돌아가고 활성 패널/입력 포커스가 바뀜 | 현재 패널 참조로 background refresh, 진행 중 탐색 보호, 다른 경로의 선택 보존. 복사 중 이동 후 현재 경로·포커스 유지 회귀; atomic 완료도 같은 정책 |
| R16 | P2 · `CommanderShell.tsx` 초기 로드 | StrictMode effect 재실행 시 취소된 첫 요청과 시작 플래그 때문에 초기 목록 누락 | effect 재설정과 폐기된 설정 응답 차단. StrictMode 실제 mount 회귀 |
| R17 | P1 · `CommanderShell.tsx`, `lib.rs` 설정 저장 | 늦은 저장 응답이 새 UI 설정을 되돌리거나 동시 patch가 유실됨. 손상 설정을 기본값으로 덮어씀 | 프론트 저장 직렬화/버전 확인, Rust 저장 mutex, 손상 설정 오류 보존. 연속 줌·동시 patch·손상 파일 fixture |
| R18 | P2 · `CommanderShell.tsx` 탭 | 경로 문자열만 저장해 선택/정렬/히스토리 복원 불가. 활성 탭 대신 마지막 탭 닫힘 | 탭별 패널 상태 snapshot과 활성 index, 현재 상태 복제·최대 5개·활성 탭 닫기·요청 무효화. 전환/선택 복원/닫기/마지막 탭 보호 회귀 |
| R19 | P2 · `panelState.ts`, 목록 너비 계산 | 히스토리 무제한 성장, 대량 목록을 `Math.max(...values)`에 전달하여 호출 인자 한도 초과 | 히스토리 100개, 중복 표시값을 제거한 순회 최대값. 150회 이동·200,000개 목록 fixture |
| R20 | P2 · `CommanderShell.tsx`, `drop-overlay.ts` 드래그 | HTML fallback은 선택된 여러 항목 중 한 개만 전달. 이벤트 전달 실패 시 투명 창이 남음 | 선택 묶음 전달, drop/leave 후 finally에서 overlay 숨김. 기존 drag 회귀 전체 실행; 실제 투명 창 동작 미검증 |
| R21 | P2 · `lib.rs` provider 테스트 | PATH를 바꾸는 취소 테스트와 압축 round-trip이 병렬 실행되어 간헐적 실패 | 동일 환경 mutex로 provider 테스트 격리. 단독 성공/전체 실패로 간섭을 확인한 뒤 전체 Rust 통과 |

## 구조 변경 판단

- 탭 상태는 FR-11의 동작을 충족하려면 경로 배열로는 부족하다. 비활성 탭의 `PanelNavigationState`와 활성 index를 보관하는 국소 변경을 선택했다. 별도 전역 store 도입과 화면 재설계는 하지 않았다.
- `trash = 5.2.9`는 휴지통의 플랫폼별 복원 정보와 OS 처리를 직접 구현하지 않기 위한 의존성이다. [라이브러리 공식 문서](https://docs.rs/trash/5.2.9/trash/)를 확인했다. Linux는 Freedesktop Trash 규약을 전제로 한다.
- `CommanderShell.tsx`와 `lib.rs`는 각각 탐색/저장/드래그와 여러 서비스를 크게 묶고 있다. 후속 분리는 탐색·탭 훅, 설정 저장 훅, native DnD 어댑터, Rust 설정/외부 프로세스 모듈 단위가 적합하다. 먼저 회귀를 확보하고 책임 경계별로 나누는 것이 변경 영향 추적에 유리하다.

## 문서와 코드 충돌 및 남은 작업

아래는 이번 검토에서 식별했지만 완성 또는 실제 검증으로 처리하지 않은 항목이다. 기존 전체 정합성 게이트의 통과가 이 항목의 완료를 의미하지 않는다.

| 우선순위 | 근거 / 현재 한계 | 후속 작업과 완료 증거 |
| --- | --- | --- |
| P1 | `shell_command::run_shell_command`는 `.output()`으로 종료를 기다리고 출력 전체를 받은 뒤 잘라냄. 취소/시간 제한이 없고 `timedOut`은 항상 false | 별도 실행 controller와 취소 command, 출력 상한을 유지하며 pipe를 계속 비우는 reader, timeout/자식 프로세스 종료 정책. 오래 실행·과다 출력·취소 fixture 필요 |
| P2 | `external::run_open_command`는 vi/vim/nano/emacs를 터미널 없이 spawn. 시작 성공과 실제 편집 가능/정상 종료를 구분하지 않음 | OS별 terminal/PTY 실행 정책과 종료 오류 전달. 실제 편집기 창·입력·종료 검증 필요 |
| P2 | `watch_path`는 검증 후 version ACK만 반환하며 파일 감시 등록/이벤트를 만들지 않음. API 문서의 '변경 이벤트 구독'과 불일치 | API 문서에 현재 한계를 명시. watcher 수명/패널·탭 교체/중복 이벤트 병합 설계 후 외부 변경 fixture 추가 |
| P2 | 경로 입력의 `~`·상대경로는 활성 패널 기준 확장이 없고 Rust canonicalize에 직접 전달. 위치 목록은 macOS 볼륨 중심 | FR-26.4의 경로 해석, Windows 드라이브/예약어/UNC, Linux 마운트 목록을 플랫폼 fixture로 보완 |
| P2 | 동시 파일 작업 차단은 현재 메인 UI store에서 수행. Rust start command 자체는 여러 요청 등록 가능 | backend 단일 활성 작업 gate와 앱 종료 시 worker 처리 정책을 command 계층에서 검증 |
| P2 | 파일 복사의 ACL/xattr/resource fork 및 디렉터리 권한·수정 시각 보존을 완성으로 보지 않음. 압축의 symlink/hardlink 처리는 provider별 차이가 있음 | 실제 메타데이터 보존 요구 범위와 provider별 악성 링크 fixture를 확정하고 플랫폼별 검증 |
| P2 | `archive_list`는 외부 프로세스의 전체 출력을 파싱한 뒤 결과 개수만 제한하며 동기 command임 | 대형 목록의 실제 메모리/응답시간 측정 후 background 실행과 스트리밍 한도 검토 |
| P2 | 비활성 탭 snapshot은 복원되지만 별도 watcher가 없어 외부 변경을 자동 반영하지 않음. 독립 스크롤 위치 저장도 없음 | 선택/정렬을 보존하는 탭 활성화 재검증과 스크롤 위치 보관 테스트 추가 |

## 검증 결과와 증거

- 초기 전체 검증: 프론트 206개 / Rust 46개 / 정합성 261개 통과.
- 최종 `npm run verify`: 타입 검사, 프론트 **216개**, 빌드, Rust 검사·테스트 **58개**, 정합성 **261개** 모두 통과. 초기 대비 회귀 테스트 22개 증가.
- 키보드 우선 검증 `npx vitest run src/actions/registry.test.ts src/ui/CommanderShell.test.tsx src/operations/operationStore.test.ts` 통과 후 최종 전체 검증에 포함했다.
- `git diff --check` 통과. 기존 사용자 변경을 유지하며 새 변경을 검토했고 커밋하지 않았다.
- 재현 로그: [초기 전체 검증](evidence/code-review-2026-09-25/baseline-verify.txt), [최종 전체 검증](evidence/code-review-2026-09-25/final-verify.txt).
- 파일 변경 fixture는 모두 임시 디렉터리에서 실행했다. 실제 사용자 파일이나 OS 휴지통을 테스트 대상으로 사용하지 않았다.
- 브라우저 UI 검증을 시도했으나 실행 도구가 프로젝트 writable root의 심볼릭 링크를 지원하지 않아 시작 전에 종료되었다. 기본 shell도 같은 제한이 있어 승인된 확장 실행으로 테스트했다. 브라우저 연결 도구에는 같은 실행 옵션이 없다.
- 따라서 실제 WebView 렌더링·Finder/Explorer/native drag/drop·새 OS 휴지통 복원·Windows/Linux 실행 검증은 남아 있다. 컴포넌트/fixture 통과를 실제 데스크톱 E2E로 표현하지 않는다.
- Vite의 큰 번들 경고는 초기부터 존재한다. 단순 경고 상한 조정으로 숨기지 않았다.

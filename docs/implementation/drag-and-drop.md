# 드래그 앤 드롭 세션과 대상 결정

- 2026-09-27 기준
- 파일 작업은 기존 action registry와 operation store를 통해 Rust에 전달

## 확인된 결함

| 위치 | 발생 조건 | 영향과 근거 | 수정 |
| --- | --- | --- | --- |
| `src/drop-overlay.ts` | macOS Retina 배율 2 | Wry 0.55.1의 `wkwebview/drag_drop.rs`는 `draggingLocation()`의 논리 좌표를 전달하고 `tauri-runtime-wry`도 값을 그대로 전달; 기존 코드는 이를 다시 DPR로 나눠 오른쪽 x=900을 왼쪽 x=450으로 판단 완료 | macOS 좌표는 배율로 나누지 않음; 변환은 `nativeDropPosition.ts`에서 관리 |
| `CommanderShell.tsx`의 네이티브 완료 콜백 | 취소되거나 앱 위에서 네이티브 드래그가 끝남 | 실제 drop 이벤트 없이 사후 커서 조회만으로 복사 실행 완료; Escape 취소와 놓기를 구분하지 못하며 오버레이 drop 처리와도 경합 완료 | 보정 경로와 `main_cursor_position` 명령 제거; 네이티브 취소로 내부 작업을 실행하지 않음 |
| 네이티브 시작 시 `mode` 저장 | 드래그 시작 후 Shift를 누르거나 뗌 | 시작 때 저장한 mode를 끝까지 재사용해 표시와 실행이 바뀌지 않았음 | 내부 세션에서 pointer/keydown/keyup을 함께 처리하고 `pointerup.shiftKey`로 최종 결정 |

## 내부 세션

- `pointerFileDrag.ts`가 하나의 포인터 제스처를 소유

1. 왼쪽 버튼을 누르면 출발 패널·출발 경로·선택 항목을 고정
   - 선택하지 않은 행을 끌면 그 행만 대상
2. 6 CSS px 이동 후 드래그 시작
   - 클릭·작은 떨림은 기존 클릭 동작 유지
3. 포인터를 누른 시점부터 종료까지 `selectstart`와 WebKit 접두사를 포함한 `user-select`로 브라우저 텍스트 선택 차단
   - 드래그가 확정되면 기존 텍스트 선택도 해제하고, 모든 종료 경로에서 차단을 복구
   - 창 안에서는 CSS 좌표와 `document.elementFromPoint()`만 사용
   - DOM 미리보기는 `pointer-events: none`이라 대상 판정을 가리지 않음
4. Shift 변경은 포인터가 멈춰 있어도 표시 갱신
   - 드래그 중 다른 커맨더 단축키는 실행하지 않음
5. 실제 `pointerup`에서 대상을 다시 판정
   - 출발 패널과 같음, 두 패널의 경로가 같음, 패널 밖, 대상이 압축 내부, 작업 진행 중, 목록 변경/로딩 중이면 작업을 시작하지 않음
6. 유효한 드롭은 출발 항목과 명시한 대상 디렉터리를 기존 복사/이동 액션에 전달
   - 이동 확인과 충돌·진행률·취소 처리는 기존 작업 흐름 유지
7. 놓기·취소·창 포커스 상실·unmount 시 리스너 정리
   - 중복 pointerup은 실행되지 않음
   - 드래그 직후의 click도 중복 선택/버튼 실행으로 이어지지 않음

- 반대 패널 대상은 그 패널의 현재 디렉터리
- 같은 패널의 하위 폴더 행에 놓기(FR-29.2, 2026-10-30): 끌고 있는 항목이 아닌 실제 폴더 행 위에서만 허용, 패널 간 드롭과 같은 규칙(기본 복사, Shift 이동)
  - 대상 표시: 폴더 행 강조와 "폴더에 복사·폴더로 이동 · 폴더 이름" 안내(FR-29.5)
  - 같은 패널의 폴더 행 밖이나 파일 행, 끌고 있는 폴더 자신에는 놓기 금지(FR-29.9)
  - 실행: 일반 복사·이동 액션과 같은 확인·충돌·진행률 흐름(FR-29.6), 압축 내부 폴더는 금지

## 외부 인계와 수신

- 창 경계를 넘을 때만 `tauri-plugin-drag`에 선택 경로와 파일 이름 PNG 미리보기 전달
- 네이티브 실패 시에도 다음 내부 포인터 세션은 정상 동작

- 외부에서 들어오는 OS 파일은 별도 오버레이가 경로와 위치 전달
- 앱에서 시작해 밖으로 나갔다 돌아오는 경우에도 명시적인 native drop 이벤트만 작업을 요청 가능
- 완료/취소 콜백에서 현재 커서를 근거로 대상을 추측하지 않음

- 네이티브 세션으로 인계된 뒤의 보조키 변경 및 Finder/Chrome 실제 드롭 수락은 이번 내부 드래그 검증 범위에 포함하지 않음

## 진단 로그

- 필요할 때 해당 창 개발자 콘솔에서 `sessionStorage.setItem('boksldir.debugDrag', '1')` 실행
- 콘솔의 `[file-drag]` 로그에 시작 패널, 대상 패널, CSS 좌표, 배율, 모드, 차단 여부, 취소/완료가 기록
- 파일명과 경로는 기록하지 않음
- 포인터 이동마다 출력하지 않고 대상/모드/차단 상태가 바뀔 때만 출력

- 비활성화: `sessionStorage.removeItem('boksldir.debugDrag')`

## 검증 범위

- `CommanderShell.drag.test.tsx`: 양방향 복사/이동, 같은 패널 복귀, 마지막 move 없이 release, Shift 실시간 변경, 다중 선택 스냅샷, 같은 경로 차단, 작업 상태 재검증, Escape/blur/pointercancel/패널 밖, 중복 release, unmount, 네이티브 취소 및 실패 후 복구
- `nativeDropPosition.test.ts`: macOS 배율 1/1.5/2/3에서 좌표 보존과 기존 비-macOS 변환
- 독립 Chrome 154, viewport 1280×820, DPR 1/2: 실제 `mouse.down/move/up`, Shift key down/up으로 14개 시나리오 통과
- 샘플 파일 목록과 기록용 작업 클라이언트로 대상 경로·횟수 검사 완료
- 실제 사용자 파일은 변경하지 않았음
- 로컬 브라우저 결과와 화면: `temp/verification/drag/results.json`, `temp/verification/drag/live-shift.png`
- 실제 Tauri WebKit 창과 Finder/Chrome 간 OS 드래그는 macOS 자동 입력 권한이 없어 검증하지 못했음
- 브라우저 테스트와 네이티브 E2E를 동일한 검증으로 취급하지 않음

- 구조 분리 후 Shell 연결은 `useFileDrag.ts`, OS 어댑터는 `src/tauri/commanderClients.ts`, 공통 액션 요청은 `actionRequest.ts`가 담당
- 포인터 세션과 대상 결정 정책은 유지

## Windows 네이티브 수신과 복귀 — 2026-10-19

- Windows 시작 설정: 주 창의 네이티브 파일 수신 활성화, 별도 `drop-overlay` 창 생성 제외
- 근거: 보조 WebView 수신 방식에서 release 설치본의 실제 native drop 누락 재현, 배경 alpha 조정 후에도 잔류 현상 재현
- Windows 전달 경로: 주 창 `WindowEvent::DragDrop` → `native_drop.rs` → 기존 `boksldir://native-file-drop` 이벤트 → 공통 액션
- Mac 수신: 기존 보조 창과 JavaScript 전달 경로 유지
- 내부 포인터 드래그: 기존 pointer 세션과 공통 복사/이동 액션 유지, 네이티브 인계 이후의 OS 이벤트만 별도 수신
- 좌표: Windows 물리 좌표를 주 창 배율로 한 번만 변환, 원본 경로 문자열 유지
- 자체 복귀: 백엔드 메타데이터로 원본 경로 동일성 확인, 저장된 복사/이동 의도·명시 확인·공통 작업 상태 유지
- 비동기 경계: 메타데이터 대기 전 소스 확보, 중복 drop·unmount 후 응답·다른 작업 시작·대상 경로 변경 시 실행 방지
- 네이티브 인계 전 검증: 부모만 정규화·미지원 재파싱 지점 차단·오류 이후 정상 재시도 허용
- Move 협상: Wry의 복사 전용 수신 효과와 호환되도록 `drag` 로컬 패치 유지, 자체 복귀는 원래 이동 의도로 실행
- 외부 이동 완료: 원본 폴더 표시 패널의 기존 background refresh 호출, 취소·복사·unmount 후 종료 응답 제외
- 완료 경계: 네이티브 종료 콜백과 수신 앱의 실제 파일 전달 성공 구분 필수
- 원본 의존성·패치 근거: `src-tauri/vendor/drag/PATCH.md` 참조
- 실제 실행 증거와 남은 범위: [Windows 검증 기록](windows-validation.md)의 15절 이후 참조

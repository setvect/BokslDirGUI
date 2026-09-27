# AGENTS.md — BokslDirGUI 작업 지침

- 적용 범위: `/Users/boksl/IdeaProjects/BokslDirGUI` 전체
- 하위 디렉터리에 더 구체적인 `AGENTS.md` 존재 시 해당 지침 우선

## 프로젝트 정체성

- 목표: 기존 BokslDir TUI와 기능 동등성을 갖춘 GUI 파일 매니저
- 기술 스택: **Tauri 2 + React 19 + TypeScript + Rust**
- UX 기준: **키보드 중심 dual-panel file commander**
- 기본 화면: faithful TUI commander identity 유지
- 파일 시스템 변경: Rust command/service 계층에서 검증·실행

## 주요 문서 기준

- 구현 판단 시 다음 문서 우선 참조
  - `docs/implementation/README.md` — 구현 설계 인덱스와 완료 기준
  - `docs/implementation/tui-parity-map.md` — 기존 TUI 기능 동등성 매핑
  - `docs/implementation/action-registry.md` — 메뉴/단축키/컨텍스트 메뉴 공통 액션 모델
  - `docs/implementation/tauri-command-api.md` — React↔Rust command/event DTO 계약
  - `docs/implementation/file-operation-state-machine.md` — 파일 작업 상태 전이와 안전성
  - `docs/implementation/full-scope-test-spec.md` — 전체 기능 검증 전략
  - `docs/requirements/` — 주제별 기능 요구사항
  - `mockups/clickable-prototype/` — GUI 목업/레이아웃 참고
- 문서와 코드 충돌 시 근거 우선 기록, 안전한 범위에서 코드·문서 동시 갱신

## 개발 원칙

- 기존 TUI 기반 BokslDir의 전체 기능 동등성 유지, 축소 범위/MVP 전제 구현 금지
- 로직 재사용 자체보다 GUI/Tauri 구조에 맞는 안전하고 명확한 경계 우선
- 메뉴·단축키·컨텍스트 메뉴·도움말의 공통 action registry 사용 필수
- 웹 기본 동작보다 파일 커맨더 키보드 제어 우선
  - `Tab`: 좌/우 활성 패널 전환
  - `ArrowUp/ArrowDown`, `PageUp/PageDown`, `Home/End`: 파일 row 포커스 이동
  - `Space`: 선택 토글
  - `Enter`: 항목 열기
  - 입력 필드·다이얼로그·메뉴·컨텍스트 메뉴·네이티브 버튼의 자체 키보드 소유권 유지
- GUI 변경 시 클릭·더블클릭·우클릭 컨텍스트 메뉴·드래그 앤 드롭 동시 고려
- 파일 변경·삭제·덮어쓰기·쉘 실행 등 위험 작업에 명시 확인·진행률·취소·오류 요약 포함 필수
- 새 라이브러리 선정 시 대중적이고 검증된 라이브러리 우선, 도입 필요성의 문서/코드 근거 필수

## 코드 구조 지침

- `src/actions/` — action registry, 단축키, 메뉴/컨텍스트 액션 계약
- `src/ui/` — React UI, commander shell, 패널, 키보드/마우스 상호작용
- `src/operations/` — 작업 다이얼로그, 진행 상태, 충돌 처리 UI 상태
- `src/tauri/` — 프론트엔드 Tauri command wrapper
- `src-tauri/src/` — Rust command/service 구현
- `scripts/verify-full-scope.mjs` — 전체 범위 스모크/정합성 게이트
- 권장 사항
  - action ID·command 이름·DTO 타입의 문서/코드 명칭 통일
  - display-only shortcut label과 실제 dispatch keyboard binding 구분
  - portal 기반 UI의 commander keyboard owner boundary 명시
  - 샘플 데이터/스텁과 실제 파일 변경의 명확한 구분 표시

## 점진적 유지보수와 변경 검토

- 기능 추가·버그 수정 범위 안에서 구조 점검
  - 관련 없는 코드의 일괄 포맷·이름 변경·전면 분리 제외
  - 파일 길이·개수만을 목표로 한 분리 금지
  - 책임·변경 이유·독립 검증 가능성이 명확한 경우 분리
  - 항상 함께 바뀌는 작은 모듈의 통합 허용, 적절한 구조라면 수정 없이 완료
- 상태 소유권과 실행 경로 유지
  - 패널·탭·목록·선택·히스토리처럼 함께 갱신하는 상태의 소유권 유지
  - 기존 operation store의 작업 상태 소유, 입력 경로별 실행·취소·완료 처리 복제 금지
  - 화면에 필요한 상태와 의도별 콜백 전달
  - 독립 계산의 React·Tauri·store 의존 배제
  - 메뉴·키보드·드래그·클립보드의 공통 액션 실행 경로 사용
- 비동기·계약·파일 안전성 검토
  - 요청 시점의 원본·대상, 늦은 응답 무시, 리스너 해제, 취소·포커스 복원 확인
  - React↔Rust 계약·파일 작업 안전성에 영향이 있는 경우 관련 회귀 검증 포함
- 변경 종류 구분
  - 동작 보존 정리와 결함 수정 구분, 결함의 재현 근거·회귀 검증 확보
  - 공개 계약·상태 소유권·여러 기능에 걸친 구조 개선의 별도 범위 정리
  - 반복되는 변경 부담 확인 시 기존 설계/후속 문서에 위치·근거·이점·영향 범위 기록
  - 작업마다 새 리팩토링 보고서 생성 금지

### 작업 마무리·커밋 전 조건

- 제품 코드·테스트·빌드 설정 변경 시 마무리 전에 [`change-review`](.agents/skills/change-review/SKILL.md) 프로젝트 스킬로 변경 범위 검토
  - 스킬 사용 불가 시 이 절의 기준으로 동등한 검토 수행 및 스킬 미사용 명시
  - 설명 문서만 변경한 경우 내용·링크 정합성 확인으로 완료 가능
- 검토 범위·정리 내용 또는 수정 없음·검증 결과·남은 문제의 간결한 보고
  - 동일한 최종 변경의 검토 기록 재사용, 이후 변경된 부분만 보완
- 커밋 준비 시 누락된 검토 우선 수행
  - 선택적 개선 후보의 후속 분리
  - 확인된 결함·필수 검증 실패의 해결 또는 미해결 보고
  - 단순 커밋 요청을 전면 리팩토링의 허가로 해석 금지
- 커밋 훅의 용도: 빠르고 결정적인 검사
  - 훅에서 AI 리팩토링·검토 완료 코드 자동 재설계 금지
  - 실제 훅 설치는 별도 작업으로 취급

## 검증 명령

- 변경 규모에 맞는 최소 검증 선택, 완료 주장 전 최신 검증 근거 확보
- 타입 검사: `npm run typecheck`
- 프론트 테스트: `npm test`
- Rust 검사: `cargo check --manifest-path src-tauri/Cargo.toml`
- Rust 테스트: `npm run rust:test`
- 전체 스모크: `npm run verify:scope`
- 전체 검증: `npm run verify`

키보드/액션 변경 시 우선 실행 명령:

```sh
npx vitest run src/actions/registry.test.ts src/ui/CommanderShell.test.tsx
```

커밋 전 권장 명령:

```sh
git diff --check
npm run verify
```

## 문서 작성 규칙

- 적용 범위: 저장소의 `AGENTS.md`·프로젝트 스킬·README·설계·요구사항·검토 기록 등 Markdown 문서
- 기본 언어: 한국어
- 기본 구조: 개조식, 목록 중첩과 제목 깊이 각각 최대 3단계
  - 한 항목에 하나의 규칙·사실·판단 기준
  - 긴 항목은 조건·행동·근거별 분리, 비교·대응 관계는 표 사용
  - 4단계 이상 세분화가 필요한 경우 새 소제목 또는 표로 재구성
- 종결 방식: `확인`, `유지`, `금지`, `필수`, `허용`, `없음` 등 명사·명사형
  - 대상·조건·행동·예외·필수/선택 수준의 명시
  - 분량 축소를 위한 의미·근거 생략 금지
- 원문·형식 보존
  - 코드 블록·명령어·실제 출력·직접 인용·외부 원문의 임의 문체 변경 금지
  - YAML frontmatter 등 도구용 구조 유지, 설명 값은 의미 보존 범위에서 명사형 정리 가능
  - 링크·앵커·요구사항 ID·계약 식별자·체크박스 상태·날짜·검증 수치 유지
  - 과거 기록의 완료·실패·미검증 상태 유지, 문체 변경을 새로운 검증 완료로 표현 금지
- 설계 문서의 “MVP” 등 축소 범위 표현 금지
- 요구사항의 주제별 분리 및 인덱스 링크 유지
- 목업/프로토타입 결정의 출처를 구현 설계 문서 또는 목업 README에 기록

## Git / 커밋 규칙

- 사용자 명시 요청 없이 커밋 금지
- 커밋 전 `git status --short`로 의도하지 않은 파일 포함 여부 확인
- 커밋 메시지의 **한글 작성 필수**
- 상위 지침의 Lore Commit Protocol 형식 유지
  - 첫 줄의 의도 설명·본문·trailer 값의 한글 작성
  - 프로토콜 호환을 위한 `Constraint:`, `Rejected:`, `Confidence:`, `Scope-risk:`, `Directive:`, `Tested:`, `Not-tested:` 등 영문 trailer 키 허용

예시:

```text
키보드 중심 파일 커맨더 조작을 보장하기 위해 입력 경계를 정리

Constraint: 웹 기본 포커스 이동보다 기존 TUI 파일 커맨더 조작감이 우선이다
Confidence: 높음
Scope-risk: 보통
Tested: npm run verify
Not-tested: 실제 운영 파일 시스템 변경 작업
```

## 완료 보고

- 주요 변경 파일
- 사용자 요청 반영 내용
- 실행한 검증 명령과 결과
- 남은 위험 또는 후속 작업

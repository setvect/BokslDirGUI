# BokslDirGUI 아키텍처 정의서: Tauri 2 + React/TypeScript + Rust

- 작성일: 2026-06-13
- RALPLAN 원본 계획: `.omx/plans/architecture-definition-tauri-react-rust-architecture-20260613T065406Z.md`
- RALPLAN 컨텍스트: `.omx/context/tauri-react-rust-architecture-20260613T065406Z.md`
- 상태: RALPLAN consensus approved — Architect APPROVE, Critic APPROVE
- 적용 범위: 신규 GUI 파일 매니저의 초기 구현 아키텍처와 라이브러리 기준
- 비범위: 기존 BokslDir Rust 로직 재사용, 실제 구현 코드 작성, 배포/서명 자동화 상세

## 1. 결론 요약

BokslDirGUI는 **Tauri 2 + Rust 백엔드 + React + TypeScript + Vite**로 시작한다.

핵심 결정은 다음과 같다.

1. **UI는 React/TypeScript가 담당**한다. 듀얼 패널, 조밀한 파일 테이블, 메뉴/오버레이/다이얼로그, 단축키/마우스 상태를 컴포넌트와 상태 모델로 표현한다.
2. **실제 파일 시스템 작업은 Rust/Tauri command 계층이 담당**한다. renderer는 사용자의 의도를 명령으로 전달하고, Rust가 경로 검증·충돌 처리·진행률·취소·로그를 통제한다.
3. **파일 목록은 TanStack Table + TanStack Virtual**로 구현한다. 요구사항의 대량 디렉토리 스크롤과 정렬/필터/컬럼 요구를 동시에 만족하기 위해 테이블 상태와 가상 스크롤을 분리한다.
4. **Radix UI Primitives는 메뉴/컨텍스트 메뉴/다이얼로그의 접근성 있는 headless 기반**으로 사용한다. 완성형 디자인 시스템은 쓰지 않고, TUI 파일커맨더 느낌은 자체 CSS 토큰으로 만든다.
5. **Tauri 플러그인은 최소 권한 원칙으로 채택**한다. `dialog`, `opener`, `store`, `log`, `notification`, `clipboard-manager`는 기본 후보이고, `fs` 플러그인은 넓은 renderer 파일 권한이 필요할 때만 제한적으로 사용한다.
6. **7z는 요구사항상 1급 archive capability로 남긴다.** 다만 core zip/tar 계열과 달리 Rust 생태계 성숙도 리스크가 있으므로 `sevenz-rust2`를 `archive-7z` feature/provider 후보로 명시 채택하고, PoC와 회귀 fixture를 통과해야 FR-14를 완료로 판정한다.

## 2. 근거 요구사항 요약

| 요구사항 영역 | 아키텍처 영향 | 근거 |
| --- | --- | --- |
| 좌·우 독립 패널, 상태/스크롤/정렬/필터 | 패널별 상태 모델과 action registry 필요 | `docs/requirements/01-core-experience.md:23-31` |
| 큰 디렉토리에서도 부드러운 목록 | 가상 스크롤과 백그라운드 메타데이터 계산 필요 | `docs/requirements/01-core-experience.md:43-53`, `docs/requirements/05-customization-platform-quality.md:112-119` |
| 키보드/마우스 선택 통합 | UI selection store를 단일 모델로 관리 | `docs/requirements/01-core-experience.md:87-97`, `docs/requirements/04-gui-desktop-interactions.md:92-102` |
| 복사/이동/삭제/충돌/진행률/취소 | Rust operation service + frontend event stream 필요 | `docs/requirements/02-file-operations.md:7-16`, `docs/requirements/02-file-operations.md:28-35` |
| 휴지통/기본 앱/reveal/platform 차이 | Rust platform adapter와 OS별 테스트 필요 | `docs/requirements/02-file-operations.md:46-53`, `docs/requirements/02-file-operations.md:106-114`, `docs/requirements/05-customization-platform-quality.md:91-96` |
| 압축/해제와 zip-slip 방지 | Archive service는 Rust에서 경로 정규화 수행 | `docs/requirements/02-file-operations.md:84-94`, `docs/requirements/05-customization-platform-quality.md:71-78` |
| 메뉴/툴바/단축키/도움말 일관성 | 단일 action registry가 UI 경로를 생성 | `docs/requirements/04-gui-desktop-interactions.md:7-15`, `docs/requirements/04-gui-desktop-interactions.md:40-47` |
| GUI 방향성 | 기본 화면은 패널 우선, 보조 기능은 overlay/collapsed | `.omx/specs/deep-interview-file-commander-visual-direction.md:33-53`, `.omx/specs/deep-interview-file-commander-visual-direction.md:57-65` |
| i18n/Unicode | i18next 키 기반 문자열, Rust/TS UTF-8 경로 데이터 계약 | `docs/requirements/05-customization-platform-quality.md:25-37` |
| 최소 권한 | renderer 파일 API 노출 제한, capability 검토 | `docs/requirements/05-customization-platform-quality.md:71-78` |

## 3. RALPLAN-DR 요약

### 3.1 원칙

1. **파일커맨더 정체성 우선**: 화면 대부분은 좌/우 패널과 조밀한 파일 목록이 차지해야 한다.
2. **파일 작업은 안전 우선**: 실제 I/O, 영구 삭제, 덮어쓰기, 압축 해제는 Rust 계층에서 검증하고 renderer 권한은 최소화한다.
3. **대량 목록 성능은 초기 아키텍처 요구**: 가상 스크롤, 비동기 로딩, 이벤트 기반 갱신을 기준 아키텍처부터 고려한다.
4. **대중적이고 검증된 라이브러리 우선**: UI와 시스템 작업 모두 생태계가 크고 문서화된 도구를 선택한다.
5. **OS별 차이는 추상화하되 숨기지 않는다**: macOS/Windows/Linux 경로·휴지통·기본 앱·DnD 차이는 adapter와 테스트 매트릭스로 드러낸다.

### 3.2 상위 결정 동인

1. **파일 매니저 안전성**: 사용자의 실제 파일을 다루므로 command boundary, 충돌 처리, 취소, 로그가 중요하다.
2. **개발 편의성과 검증 가능성**: React/Vite/TypeScript와 Rust 테스트 생태계를 이용해 UI/도메인 테스트를 분리한다.
3. **TUI에서 GUI로의 충실한 전환**: 풀 컴포넌트 프레임워크보다 headless primitives와 자체 스타일이 적합하다.

### 3.3 검토한 선택지

| 선택지 | 장점 | 단점 | 판정 |
| --- | --- | --- | --- |
| **A. Tauri 2 + React/TS/Vite + Rust command backend** | 멀티 OS, 작은 앱 번들, Rust I/O 안전 경계, React 생태계, Tauri 공식 Vite 권장 | Rust/Tauri 권한·capability 학습 필요, WebView별 차이 테스트 필요 | **채택** |
| B. Tauri 2 + Svelte/TS | 작은 UI 런타임, 간결한 상태/컴포넌트 작성 | 팀/생태계 범용성은 React보다 좁고 TanStack/Radix 조합의 자료가 상대적으로 적음 | 보류 |
| C. Electron + React/TS | 데스크톱 앱 사례와 Node 파일 시스템 생태계가 매우 큼 | 번들 크기/메모리 부담, renderer/main 보안 설계 부담, Tauri 선택과 충돌 | 기각 |
| D. Rust native GUI(egui/iced/slint 계열) | Rust 단일 언어, 네이티브-ish 제어 | 웹 UI 생태계/브라우저 테스트/데스크톱 UX 라이브러리 활용도가 낮고 디자인 반복 속도가 느릴 수 있음 | 기각 |

## 4. 시스템 아키텍처

```text
┌─────────────────────────────────────────────────────────────┐
│ React/TypeScript UI                                          │
│ - Commander shell, dual panels, dense file rows              │
│ - Radix overlays/dialogs/menus                               │
│ - Zustand UI/domain state, i18next strings                   │
│ - TanStack Table + Virtual, dnd-kit interactions             │
└───────────────┬─────────────────────────────────────────────┘
                │ typed command wrappers + events
┌───────────────▼─────────────────────────────────────────────┐
│ Tauri bridge                                                 │
│ - invoke commands                                            │
│ - event/progress stream                                      │
│ - capability/permission boundary                             │
└───────────────┬─────────────────────────────────────────────┘
                │ Rust DTOs, operation IDs
┌───────────────▼─────────────────────────────────────────────┐
│ Rust application core                                        │
│ - filesystem service                                         │
│ - operation queue/cancel/conflict resolver                   │
│ - archive service                                            │
│ - platform adapter                                           │
│ - settings/logging/watcher services                          │
└───────────────┬─────────────────────────────────────────────┘
                │ OS/filesystem APIs
┌───────────────▼─────────────────────────────────────────────┐
│ macOS / Windows / Linux                                      │
└─────────────────────────────────────────────────────────────┘
```

## 5. 프론트엔드 아키텍처

### 5.1 주요 모듈

| 모듈 | 책임 | 주 라이브러리 |
| --- | --- | --- |
| `app-shell` | 상단 메뉴, 두 패널, 하단 hotkey/status strip, overlay host | React, CSS Modules/plain CSS |
| `file-panel` | 패널별 경로/탭/정렬/필터/스크롤/선택 표시 | TanStack Table, TanStack Virtual |
| `navigation` / `path-controls` | back/forward/up/refresh, compact breadcrumb/address edit, drive/mount quick access | React, Radix Dropdown/Popover 후보, Zustand |
| `actions` | 명령 ID, 단축키, 메뉴 표시명, 활성 조건, 실행 handler | TypeScript, Zustand |
| `dialogs` | 복사/이동/삭제/충돌/속성/설정/도움말 | Radix Dialog/AlertDialog |
| `menus` | menubar, context menu, dropdown | Radix Menubar/ContextMenu/DropdownMenu |
| `dnd` | 패널 간 drag intent, hover target, drop validation UI | dnd-kit |
| `i18n` | 한국어/영어 문자열, 런타임 언어 전환 | i18next, react-i18next |
| `tauri-api` | invoke 래퍼, event subscription, DTO 변환 | @tauri-apps/api |

### 5.2 상태 설계

상태는 다음처럼 분리한다.

- **UI 상태**: 활성 패널, 열려 있는 overlay, 메뉴 포커스, theme, language.
- **패널 상태**: current path, tabs, sort/filter, selection, focused row, scroll anchor, history.
- **탐색 상태**: back/forward stack, editable path draft, compact breadcrumb segments, drive/mount quick-access cache, refresh/invalidation state.
- **도메인 캐시**: directory listing cache, metadata loading state, watcher invalidation version.
- **작업 상태**: operation queue, operation progress, conflict prompt, cancellation state.
- **설정 상태**: persisted preferences, schema version, last window layout.

Zustand store는 하나의 거대한 store로 시작하지 않는다. `panelStore`, `actionStore`, `operationStore`, `settingsStore`처럼 책임별 slice를 두고 selector 기반으로 구독 범위를 줄인다.

### 5.3 Compact navigation layer

FR-4.8/FR-4.9의 드라이브·마운트 빠른 접근, 주소 표시줄, breadcrumb, 뒤로/앞으로, 새로고침은 별도 `navigation`/`path-controls` 모듈로 둔다. 단, deep-interview 시각 원칙에 따라 기본 화면을 두꺼운 breadcrumb bar로 만들지 않는다. 기본 표현은 각 패널 헤더 안의 짧은 path chip, `..`/back/forward/refresh hotkey/menu action, 필요 시 열리는 dropdown/overlay 주소 편집기로 제한한다.

- back/forward/up/refresh는 action registry에 등록되어 메뉴·단축키·작은 패널 헤더 버튼이 같은 command를 사용한다.
- drive/mount quick access는 persistent sidebar가 아니라 `Go`/`위치` overlay, compact dropdown, 또는 command palette 후보로 노출한다.
- breadcrumb segment 클릭/우클릭은 panel-local navigation action으로 처리하고, path 직접 입력은 modal/inline edit 상태로 들어간다.
- navigation UI도 panel dominance를 해치면 안 되며, visual acceptance에는 “bulky path bars 금지”를 포함한다.
- drive/mount enumeration은 `platform_service`가 제공하고, UI는 이를 단순 위치 overlay로만 표시한다.
  - macOS: 홈/데스크톱/문서/다운로드와 `/Volumes` 하위 볼륨을 우선 노출한다. 접근 불가 볼륨은 비활성/오류 상태로 표시한다.
  - Windows: 홈 계열 known folders와 사용 가능한 drive root를 노출한다. 예약어/불가 문자/대소문자 정책은 Rust 검증 계층에서 처리한다.
  - Linux: 홈 계열 경로와 `/mnt`, `/media`, `/run/media/$USER` 및 mount table 기반 후보를 노출한다. 권한 없는 mount는 진입 전 오류로 표시한다.
  - 모든 OS: enumeration 실패는 앱 시작 실패가 아니라 “위치 목록 일부 사용 불가” 상태로 degrade한다.

### 5.4 스타일 원칙

- Tailwind/MUI/Ant Design 같은 큰 스타일 시스템은 초기 채택하지 않는다.
- 기본은 **CSS Modules 또는 plain CSS + design tokens**다.
- 색상, row height, border, monospace font, active panel marker는 TUI commander identity를 보존하는 토큰으로 정의한다.
- Radix는 동작/접근성 primitives만 사용하고 시각 스타일은 직접 입힌다.

## 6. Tauri/Rust 백엔드 아키텍처

### 6.1 Command API 초안

| Command | 입력 | 출력 | 비고 |
| --- | --- | --- | --- |
| `list_dir` | `path`, `show_hidden`, `sort`, `filter` | `DirectoryListing` | 권한/존재 오류는 패널 오류로 반환 |
| `get_metadata` | `path` | `FileMetadata` | 속성 다이얼로그/preview용 |
| `start_copy` | `sources`, `target_dir`, `mode` | `OperationId` | 진행률은 event stream |
| `start_move` | `sources`, `target_dir`, `mode` | `OperationId` | 같은 볼륨 rename 우선 |
| `start_delete` | `targets`, `delete_mode` | `OperationId` | trash/permanent 구분 |
| `cancel_operation` | `operation_id` | `CancelAck` | cooperative cancellation |
| `resolve_conflict` | `operation_id`, `decision` | `ConflictAck` | overwrite/skip/all 등 |
| `create_dir` | `parent`, `name` | `FileEntry` | 이름 검증 |
| `rename_entry` | `path`, `new_name` | `FileEntry` | 충돌/불가 문자 검증 |
| `open_default` | `path` | `ActionResult` | Tauri opener/platform adapter |
| `reveal_in_manager` | `path` | `ActionResult` | OS별 adapter 필요 |
| `archive_list` | `archive_path` | `ArchiveListing` | 대량 내부 목록 제한 |
| `archive_extract` | `archive_path`, `target_dir`, `password?` | `OperationId` | zip-slip 차단 |
| `watch_path` | `panel_id`, `path` | `WatchAck` | notify 기반 무효화 이벤트 |
| `load_settings` | 없음 | `Settings` | schema version 포함 |
| `save_settings` | `SettingsPatch` | `Settings` | 원자적 저장 고려 |

### 6.2 Rust 서비스 분리

#### 6.2.1 `archive-7z` PoC 종료 기준

`sevenz-rust2`는 FR-14의 7z/암호 요구를 만족하기 위한 1차 provider이지만, 다음 fixture를 통과하기 전에는 7z 지원을 완료로 표시하지 않는다.

- 일반 7z archive 목록 읽기와 전체 해제 round-trip.
- password-protected 7z archive에서 암호 필요 상태, 잘못된 암호 오류, 올바른 암호 해제 성공을 구분.
- 7z 생성 후 외부 7-Zip/Finder/Explorer 호환성 smoke 또는 최소 자체 재열기 검증.
- `../` 또는 절대경로 entry를 포함한 악성 fixture가 target directory 밖으로 쓰지 못함.
- 진행률/취소 이벤트가 최소 파일 단위로 발행되고, 암호가 로그/trace에 남지 않음.
- macOS/Windows/Linux 중 지원 대상에서 같은 fixture suite가 통과하거나, 미지원 codec/filter는 사용자 메시지와 fallback 정책으로 문서화.

PoC 실패 시 `libarchive2` 또는 `compress-tools` 대안을 별도 ADR로 평가한다. 단, libarchive 계열은 시스템 의존성과 패키징 복잡도를 도입하므로 기본값으로 바로 승격하지 않는다.

| 서비스 | 책임 | 후보 crate/plugin |
| --- | --- | --- |
| `fs_service` | listing, metadata, create, rename, safe path normalization | Rust std, walkdir |
| `operation_service` | copy/move/delete queue, progress, cancel, conflict | tokio, tempfile, tracing |
| `trash_service` | OS trash/recycle bin 이동 | trash |
| `archive_service` | zip/tar/gz/zstd/7z list/create/extract, zip-slip 방지, password prompt bridge | zip, tar, flate2, zstd, sevenz-rust2(`archive-7z` gated) |
| `watch_service` | 경로 감시와 listing invalidation | notify |
| `platform_service` | default open, reveal, drive/mount enumeration | tauri opener + OS-specific code |
| `settings_service` | schema version, read/write, fallback | Tauri store plugin 또는 Rust 파일 저장 |
| `logging_service` | 파일 작업/오류 로그, 민감정보 마스킹 | tracing, tracing-subscriber, tauri-plugin-log |

### 6.3 비동기/진행률 설계

- UI 요청은 즉시 `OperationId`를 받고, 진행률은 Tauri event 또는 channel로 받는다.
- 장시간 파일 작업은 UI thread를 막지 않는다.
- 파일 복사/압축처럼 blocking I/O가 많은 작업은 Rust에서 별도 task/blocking pool 전략을 사용한다.
- 취소는 강제 kill이 아니라 operation loop가 `CancellationToken`에 해당하는 내부 상태를 주기적으로 확인하는 방식으로 설계한다.
- 충돌은 Rust가 event로 `ConflictPrompt`를 발행하고, UI가 결정을 command로 되돌려준다.

## 7. 라이브러리 선정표

### 7.1 Frontend/runtime

| 라이브러리 | 채택 단계 | 사용 이유 |
| --- | --- | --- |
| `react`, `react-dom` | 기준 기능 | 컴포넌트 기반 UI와 넓은 생태계 |
| `typescript` | 기준 기능 | command DTO, action registry, 상태 모델 타입 안전성 |
| `vite`, `@vitejs/plugin-react` | 기준 기능 | Tauri가 SPA 프론트엔드에 권장하는 빠른 개발 서버/빌드 도구 |
| `@tanstack/react-table` | 기준 기능 | headless table state, sorting/filtering/column 모델 |
| `@tanstack/react-virtual` | 기준 기능 | 대량 파일 행 가상 렌더링 |
| `@radix-ui/react-dialog` | 기준 기능 | 파일 작업/속성/설정 다이얼로그 기반 |
| `@radix-ui/react-context-menu` | 기준 기능 | 우클릭 컨텍스트 메뉴 |
| `@radix-ui/react-dropdown-menu` | 기준 기능 | compact overlay/dropdown |
| `@radix-ui/react-menubar` | 기준 기능 | TUI 상단 메뉴를 GUI 메뉴로 표현 |
| `zustand` | 기준 기능 | 가볍고 boilerplate가 적은 UI/domain 상태 관리 |
| `i18next`, `react-i18next` | 기준 기능 | 한국어/영어 런타임 전환과 키 기반 문자열 관리 |
| `@dnd-kit/core` | Should | 패널 간/폴더 간 drag/drop intent 구현. 실제 파일 작업과 연결은 Rust 검증 후 |
| CSS Modules/plain CSS | 기준 기능 | 파일커맨더 스타일을 직접 제어하고 큰 UI kit를 피함 |

### 7.2 Tauri plugins

| 플러그인 | 채택 단계 | 사용 이유/제약 |
| --- | --- | --- |
| `@tauri-apps/api` | 기준 기능 | frontend↔Rust command/event bridge |
| `tauri-plugin-drag`, `@crabnebula/tauri-plugin-drag` | 기준 기능 | WebView 경계를 넘어 선택된 실제 파일 경로를 macOS/Windows/Linux 네이티브 드래그 세션으로 전달. 메인 WebView의 HTML5 drag와 Tauri native file-drop 가로채기 충돌을 피하기 위해 메인은 `dragDropEnabled: false`, 숨겨진 투명 `drop-overlay` WebView만 native drop을 수신한다. 절대 경로만 허용하고 실제 변경 작업은 기존 Rust operation 경계를 유지 |
| `@tauri-apps/plugin-dialog` | 기준 기능 | 폴더 선택, 확인/메시지 다이얼로그 후보 |
| `@tauri-apps/plugin-opener` | 기준 기능 | 기본 앱 열기/open URL 후보 |
| `@tauri-apps/plugin-store` | 기준 기능 | 단순 설정/상태 저장 후보. 복잡해지면 Rust settings service로 흡수 |
| `@tauri-apps/plugin-log` | 기준 기능 | 앱 로그 수집/파일 기록 |
| `@tauri-apps/plugin-notification` | Should | 장시간 작업 완료 알림 |
| `@tauri-apps/plugin-clipboard-manager` | Should | 경로/파일명 복사, 추후 파일 클립보드 후보 |
| `@tauri-apps/plugin-fs` | 제한/보류 | renderer 직접 파일 조작은 최소화. path helper 등 좁은 scope가 필요할 때만 검토 |

### 7.3 Rust crates

| crate | 채택 단계 | 사용 이유 |
| --- | --- | --- |
| `tokio` | 기준 기능 | async command, 작업 큐, background task 관리 |
| `serde`, `serde_json` | 기준 기능 | Rust↔TS DTO 직렬화와 설정 JSON |
| `thiserror` | 기준 기능 | 사용자 노출 가능한 typed domain error |
| `anyhow` | 기준 기능 | 내부 오류/context 전파 |
| `tracing`, `tracing-subscriber` | 기준 기능 | 구조화 로그와 진단 |
| `walkdir` | 기준 기능 | 디렉토리 순회/크기 계산/재귀 작업 |
| `notify` | Should | 디렉토리 변경 감시와 panel refresh |
| `trash` | 기준 기능 | 플랫폼 휴지통/Recycle Bin 이동 |
| `zip` | 기준 기능 | zip/jar/war 목록/해제/생성 기반 |
| `tar`, `flate2`, `zstd` | 기준 기능 | tar/tar.gz/tgz/tar.zst/tzst 처리 |
| `sevenz-rust2` | 기준 기능-검증 게이트 | 7z list/extract/create/password capability 후보. core dependency보다 성숙도 리스크가 있으므로 `archive-7z` feature와 fixture PoC 통과 후 활성화 |
| `tempfile` | 기준 기능 | 안전한 임시 파일/작업 중간 산출물 |
| `assert_fs` | 기준 기능 테스트 | 실제 파일 시스템 테스트 fixture/assertion |

### 7.4 후속/조건부 라이브러리

| 후보 | 조건 |
| --- | --- |
| `libarchive2` 또는 `compress-tools` | `sevenz-rust2` PoC가 실패하거나 7z/기타 archive 호환성이 부족할 때 대안. 단, libarchive 시스템 의존성과 배포 복잡도를 별도 검증해야 함 |
| `image` | 이미지 썸네일/preview가 2차 기능으로 들어갈 때 |
| `syntect` | 코드/텍스트 preview syntax highlight가 필요할 때 |
| `mime_guess`, `infer` | 파일 타입 감지 정책이 확정될 때 |
| Storybook | UI 상태 문서화/디자인 QA가 필요할 때. 초기 구현 필수는 아님 |

## 8. 보안/권한 경계

1. renderer는 파일 경로와 사용자 의도만 전달한다.
2. Rust command는 모든 경로를 canonicalize/normalize하고 자기 자신 내부 복사, zip-slip, 영구 삭제, 덮어쓰기 위험을 검증한다.
3. Tauri capability는 command/plugin별 최소 권한으로 시작한다.
4. `plugin-fs`는 광범위 read/write 권한으로 열지 않는다.
5. 외부 명령 실행은 기존 TUI 기능 동등성 범위에 포함하되, GUI에서는 기본 비활성 또는 명시 확인 정책으로 보호한다.
6. 작업 로그에는 암호, 사용자가 입력한 압축 비밀번호, 민감한 입력값을 남기지 않는다.

## 9. 프로젝트 구조 제안

```text
BokslDirGUI/
├─ src/
│  ├─ app/                  # App bootstrap, providers
│  ├─ components/           # pure/shared UI components
│  ├─ features/
│  │  ├─ commander-shell/
│  │  ├─ file-panel/
│  │  ├─ actions/
│  │  ├─ navigation/
│  │  ├─ operations/
│  │  ├─ dialogs/
│  │  ├─ menus/
│  │  ├─ settings/
│  │  └─ i18n/
│  ├─ stores/               # Zustand slices/selectors
│  ├─ tauri/                # typed invoke/event wrappers
│  ├─ styles/               # tokens, commander theme, high contrast
│  └─ test/                 # frontend test utilities
├─ src-tauri/
│  ├─ src/
│  │  ├─ commands/          # Tauri command handlers
│  │  ├─ dto/               # serde DTOs shared by command boundary
│  │  ├─ services/          # fs/operation/archive/platform/settings
│  │  ├─ platform/          # macOS/Windows/Linux adapters
│  │  ├─ errors.rs
│  │  └─ main.rs
│  ├─ capabilities/
│  └─ tauri.conf.json
├─ tests/                   # Rust integration tests
├─ e2e/                     # Playwright flows
└─ docs/architecture/        # architecture decisions/docs
```

## 10. 테스트/검증 전략

| 계층 | 도구 | 검증 대상 |
| --- | --- | --- |
| Rust unit | `cargo test` | path validation, conflict decision, archive zip-slip 방지, 7z password/error fixtures, error mapping |
| Rust integration | `assert_fs`, `tempfile` | copy/move/delete/rename/trash fallback, archive fixtures |
| Frontend unit/component | `vitest`, `@testing-library/react`, `@testing-library/user-event` | action registry, selection model, compact navigation controls, dialogs, keyboard/mouse interaction |
| Frontend visual/e2e | `@playwright/test` | 좌우 패널, compact path controls, drive/mount overlay, 메뉴/컨텍스트, copy flow, conflict dialog, no-sidebar default layout |
| Tauri smoke | `cargo tauri dev/build` + targeted manual/automated smoke | command bridge, plugin permission, OS별 open/reveal/trash |
| Platform matrix | macOS/Windows/Linux | path separator/case sensitivity, drive/mount list, OS DnD, default app, recycle/trash |

기존 TUI 기능 동등성 수용 기준:

- 10,000개 더미/fixture 항목 렌더링에서 스크롤이 DOM 전체 렌더링으로 폭증하지 않는다.
- 단일/다중/범위 선택이 키보드와 마우스에서 같은 selection model을 사용한다.
- 복사/이동/삭제 command는 실제 파일 수정 전 dry-run/validation 결과를 낼 수 있다.
- 충돌/취소/오류는 panic이 아니라 typed error/result로 UI에 전달된다.
- 기본 화면은 persistent sidebar/inspector/large toolbar 없이 패널이 화면을 지배한다.
- back/forward/up/refresh, compact breadcrumb/address edit, drive/mount quick access가 패널 dominance를 깨지 않는 방식으로 접근 가능하다.
- 7z fixture는 목록/해제/암호 필요 오류/zip-slip 방지 wrapper 테스트를 통과해야 FR-14 완료로 판정한다.

## 11. 구현 순서 제안

1. **프로젝트 골격**: Tauri 2 + React/TS/Vite scaffold, lint/test/build 명령 정의.
2. **디자인 토큰/Commander shell**: 두 패널, bottom hotkey strip, overlay host, compact menu 구조.
3. **Action registry + Zustand 상태**: 키보드/메뉴/컨텍스트 메뉴가 같은 action을 참조하도록 구성.
4. **File panel table**: TanStack Table + Virtual 기반 listing renderer, dummy provider → Rust command provider 교체 가능하게 설계.
5. **Rust command DTO와 `list_dir`**: typed DTO, error mapping, path validation, panel error state.
6. **파일 작업 operation service**: copy/move/delete/trash, progress event, cancel, conflict prompt.
7. **설정/i18n/theme**: store/plugin 또는 Rust settings service, 한국어/영어, dark/light/high contrast.
8. **압축/외부 앱/감시**: zip/tar 계열, opener/reveal, notify refresh.
9. **플랫폼 매트릭스 검증**: macOS 우선, Windows/Linux smoke 추가.

## 12. 리스크와 완화

| 리스크 | 영향 | 완화 |
| --- | --- | --- |
| WebView별 DnD/default-open/reveal 동작 차이 | OS별 UX 불일치 | platform adapter와 OS별 smoke test를 별도 정의 |
| renderer에 파일 권한을 넓게 부여 | 보안/데이터 손실 위험 | Rust command boundary 원칙, `plugin-fs` 제한 사용 |
| 7z 암호 지원 라이브러리 성숙도 불확실 | 압축 요구사항 미충족 | `sevenz-rust2`를 `archive-7z` provider로 명시하되, PoC/fixture 통과 전 FR-14 완료 금지. 실패 시 libarchive 계열 대안 평가 |
| 파일 작업 취소/충돌 로직 복잡도 | 데이터 손실/부분 실패 | operation state machine과 fixture 기반 회귀 테스트 선행 |
| GUI 라이브러리 UI가 대시보드화 | 사용자 취향과 불일치 | Radix headless + 자체 CSS, persistent sidebar/inspector 금지 |
| 대량 파일 메타데이터 계산으로 UI 정지 | 사용성 저하 | listing/metadata 분리, background task, virtualized rows |

## 13. ADR

### Decision

BokslDirGUI의 초기 프로덕션 아키텍처는 **Tauri 2 + Rust backend + React + TypeScript + Vite**로 정의한다. UI primitives는 Radix, 파일 테이블은 TanStack Table/Virtual, 상태는 Zustand, i18n은 i18next/react-i18next, drag/drop intent는 dnd-kit, 실제 파일 작업은 Rust command/service 계층에서 처리한다. 탐색 affordance는 별도 compact `navigation/path-controls` 모듈로 두고, 7z는 `sevenz-rust2` 기반 `archive-7z` provider로 명시하되 테스트 게이트를 통과해야 제품 요구사항 완료로 본다.

### Drivers

- macOS/Windows/Linux 파일 매니저 요구사항.
- 실제 파일을 다루는 앱에 필요한 최소 권한/검증/작업 취소/진행률.
- TUI 파일커맨더 정체성을 유지하기 위한 headless UI와 직접 스타일링.
- 대량 디렉토리 목록, 정렬/필터, 키보드/마우스 선택 통합.
- 대중적이고 검증된 라이브러리 우선 원칙.

### Alternatives considered

- Electron + React: 생태계는 크지만 번들/메모리/보안 부담이 커서 현재 Tauri 선택과 맞지 않는다.
- Tauri + Svelte: 좋은 선택지지만 React 생태계/팀 범용성/선정 라이브러리 조합이 더 강하다.
- Rust native GUI: 단일 언어 장점은 있으나 GUI 반복, 웹 테스트, headless UI 생태계 활용이 약하다.
- 큰 UI kit(MUI/Ant/Chakra): 생산성은 좋지만 파일커맨더/TUI 정체성 보존에 불리하다.

### Why chosen

Tauri는 Rust로 실제 파일 작업 안전 경계를 만들 수 있고, React/TypeScript는 복잡한 패널/선택/메뉴 상태와 테스트 생태계가 강하다. TanStack/Radix/Zustand/i18next/dnd-kit 조합은 파일 매니저 UI에 필요한 table, overlay, state, locale, drag/drop 요구를 과도한 디자인 프레임워크 없이 충족한다.

### Consequences

- Rust와 TypeScript 사이 DTO/command 계약을 명확히 관리해야 한다.
- Tauri capability와 plugin permission 설정이 아키텍처의 일부가 된다.
- WebView/OS별 차이를 숨기지 않고 테스트 매트릭스에 포함해야 한다.
- 스타일링은 직접 관리해야 하므로 design token과 visual acceptance가 중요하다.

### Follow-ups

- Tauri 프로젝트 scaffold 후 `src-tauri/capabilities/default.json`의 최소 권한 기준 확정.
- `list_dir`/`OperationId`/`OperationProgress` DTO를 먼저 설계.
- 7z 지원은 `sevenz-rust2` provider로 독립 PoC와 fixture를 작성하고, 실패 시 libarchive 계열 대안 ADR을 작성.
- `navigation/path-controls`의 compact header/dropdown UI를 목업 acceptance와 연결.
- `docs/architecture/`의 이 문서를 scaffold 이후 실제 파일 경로에 맞게 갱신.

## 14. 외부 공식 근거

- Tauri architecture: Tauri는 VM이 아니라 OS WebView 앱 툴킷이며 WRY/TAO를 통해 OS 연동을 수행한다. <https://v2.tauri.app/concept/architecture/>
- Tauri 2 release: desktop macOS/Linux/Windows와 mobile 플랫폼을 목표로 하고, Rust backend와 HTML/CSS/JS frontend 조합을 허용한다. <https://v2.tauri.app/blog/tauri-20/>
- Tauri frontend/Vite: Tauri 문서는 SPA 프레임워크에 Vite를 권장한다. <https://v2.tauri.app/start/frontend/>
- Tauri commands: frontend에서 Rust command를 호출하고 async/error를 반환할 수 있다. <https://v2.tauri.app/develop/calling-rust/>
- Tauri capabilities/permissions: frontend에 노출되는 command/plugin 권한은 capabilities로 제한한다. <https://v2.tauri.app/security/capabilities/>
- React: 컴포넌트 기반 UI 구성. <https://react.dev/>
- Vite: 빠른 frontend build/dev tooling. <https://vite.dev/>
- TanStack Table/Virtual: table은 virtualization을 내장하지 않고 TanStack Virtual과 조합한다. <https://tanstack.com/table/v8/docs/guide/virtualization>
- Radix Context Menu/Dialog/Dropdown/Menu primitives: keyboard navigation/focus/layering 지원. <https://www.radix-ui.com/primitives/docs/components/context-menu>
- Zustand: 작고 빠르며 hooks 기반의 상태 관리. <https://zustand.docs.pmnd.rs/>
- i18next/react-i18next: React i18n 통합. <https://react.i18next.com/>
- dnd kit: TypeScript 기반 drag/drop toolkit, React 통합과 접근성/성능을 강조. <https://dndkit.com/>
- Tokio: Rust async runtime. <https://tokio.rs/>
- notify/trash/zip/tar/flate2/zstd/serde/thiserror/anyhow/tracing/tempfile/assert_fs: Rust 파일 매니저 backend 후보 crate 공식 docs.rs 문서 참고.

## 15. Available-Agent-Types Roster

- `architect`: command boundary, service/module 구조, OS adapter 검토.
- `critic`: 계획 품질, 대안 공정성, 리스크/검증 누락 점검.
- `dependency-expert`: 7z/preview/installer 등 추가 dependency 선택 전 검증.
- `executor`: scaffold/구현 작업.
- `test-engineer`: Rust fixture, Playwright, OS matrix 테스트 설계.
- `designer`: TUI commander identity를 React component/style로 이전.
- `verifier`: 최종 산출물/테스트/문서 근거 검증.
- `code-reviewer`: 구현 후 security/data-loss 관점 코드 리뷰.

## 16. Follow-up Staffing Guidance

### `$ultragoal` 기본 후속

- 권장: 아키텍처 scaffold와 기존 TUI 기능 동등성 구현 기반을 순차 목표로 쪼개 진행.
- lane: `executor` 중심, `test-engineer`가 테스트 골격을 병행 검토, `verifier`가 goal checkpoint 검증.
- reasoning: executor medium, test-engineer medium, verifier high.

### `$team` 병렬 후속

- Team lane 1 (`executor`): Tauri/React/Vite scaffold와 command bridge.
- Team lane 2 (`designer` 또는 `executor`): commander shell/component/style tokens.
- Team lane 3 (`test-engineer`): Vitest/Playwright/Rust fixture 테스트 골격.
- Team lane 4 (`architect`): Rust service boundary와 capability policy 리뷰.

Launch hint:

```bash
# 예시: 아키텍처 문서를 컨텍스트로 팀 실행
omx team --brief ".omx/plans/architecture-definition-tauri-react-rust-architecture-20260613T065406Z.md 기준으로 BokslDirGUI Tauri scaffold와 기존 TUI 기능 동등성 구현 기반을 구축"
```

Team verification path:

1. `npm test` 또는 `pnpm test` 계열 frontend unit 통과.
2. `cargo test` Rust unit/integration 통과.
3. `cargo tauri dev` smoke 또는 `cargo tauri build` 가능성 확인.
4. Playwright로 기본 dual-panel 화면, 메뉴/컨텍스트, no-persistent-sidebar default 검증.
5. Ultragoal ledger에는 scaffold commit, 테스트 결과, OS별 미검증 항목을 checkpoint로 기록.

### `$ralph` fallback

Ralph는 기본 추천이 아니다. 단일 소유자가 scaffold→검증까지 끈질기게 반복해야 하는 좁은 작업에서만 명시적으로 선택한다.

## 17. Goal-Mode Follow-up Suggestions

- `$ultragoal`: 기본 추천. 이 아키텍처 문서를 기준으로 scaffold, read-only listing, operation service 순서의 durable goal을 만든다.
- `$team`: scaffold/UI/test를 병렬로 빨리 진행해야 할 때 사용한다. 병렬 결과는 `$ultragoal` checkpoint에 흡수하는 구성이 좋다.
- `$performance-goal`: 대량 디렉토리 10,000+ 항목 렌더링/메타데이터 처리 성능 목표가 별도 최적화 주제가 될 때 사용한다.
- `$autoresearch-goal`: 7z/installer/OS별 DnD처럼 외부 조사와 PoC 평가가 중심인 경우에만 사용한다.

## 18. RALPLAN 검토 적용 기록

- 초안 작성: 2026-06-13, requirements + 공식 문서 근거 반영.
- Architect 1차 검토 반영: `navigation/path-controls` 모듈을 추가해 FR-4.8/FR-4.9를 명시했고, 7z를 `sevenz-rust2` 기반 `archive-7z` provider로 승격하되 PoC/fixture 게이트를 요구했다.
- Architect 2차 검토: APPROVE. 파일커맨더 정체성, 파일 작업 안전성, 테스트 가능성, 라이브러리 제약 보존 확인.
- Critic 검토: APPROVE. 원칙-선택지 일관성, 공정한 대안 검토, 리스크 완화, 테스트 가능 수용 기준, 구현 handoff readiness 확인.
- Critic 비차단 권고 반영: 상태를 approved/final로 변경, 중복 heading 제거, 7z PoC 종료 기준과 OS별 drive/mount enumeration 기준 보강.

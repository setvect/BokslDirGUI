# BokslDir GUI 기능 요구사항 인덱스

- 작성일: 2026-06-13
- 개정일: 2026-06-13
- 목적: 기존 터미널/TUI 기반 BokslDir 개발 내용을 바탕으로 신규 GUI 파일 매니저의 기능 요구사항을 주제별로 분리한다.
- 범위: 언어/프레임워크 결정 전 제품 기능 요구사항. 기존 로직 재사용 여부는 전제하지 않는다.

## 문서 구조

| 문서 | 주제 |
| --- | --- |
| [`requirements/README.md`](requirements/README.md) | 전체 목표, 근거 원칙, 우선순위 맵 |
| [`requirements/01-core-experience.md`](requirements/01-core-experience.md) | 앱 시작, 듀얼 패널, 파일 목록, 탐색, 선택, 정렬/필터 |
| [`requirements/02-file-operations.md`](requirements/02-file-operations.md) | 복사/이동/삭제/새 폴더/이름 변경/속성/압축/외부 앱 |
| [`requirements/03-navigation-search-organization.md`](requirements/03-navigation-search-organization.md) | 탭, 히스토리, 북마크, 경로 입력, 검색/필터 고도화, 사이드바 |
| [`requirements/04-gui-desktop-interactions.md`](requirements/04-gui-desktop-interactions.md) | 마우스 이벤트, 컨텍스트 메뉴, 드래그 앤 드롭, 보기 모드, 미리보기, 작업 큐, 듀얼 패널 고급 기능 |
| [`requirements/05-customization-platform-quality.md`](requirements/05-customization-platform-quality.md) | 테마, i18n, 설정, 보안, 플랫폼, 성능/안정성/접근성 |
| [`requirements/06-validation-evidence.md`](requirements/06-validation-evidence.md) | 검증 시나리오, 회귀 테스트, 근거 파일 요약, 미확정 사항 |

## 우선순위 표기

- **Must**: 1차 GUI MVP 또는 데이터 안전성에 필수
- **Should**: 제품 완성도와 파일 매니저 경험에 중요하나 MVP 후순위 가능
- **Could**: 후속 고도화 후보
- **Must if implemented**: 기능 자체는 선택 사항이나 구현한다면 반드시 지켜야 하는 제약

## 이번 개정에서 추가한 GUI 전용 요구사항

- 더블클릭, 우클릭 컨텍스트 메뉴, Shift/Cmd/Ctrl 클릭, 드래그 박스 선택
- 패널 간/폴더 간/외부 앱 간 드래그 앤 드롭
- 사이드바, breadcrumb, 주소창, splitter, 보기 모드
- 미리보기 패널과 빠른 보기
- 작업 큐, 일시정지/재개, Undo 후보, 완료 알림
- 폴더 비교, 패널 동기화, 좌우 경로 스왑
- 명령 팔레트, 인라인 이름 변경, 일괄 이름 변경, 클립보드 연동

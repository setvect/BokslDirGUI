# Windows 지원 분석과 작업 계획

- 작성일: 2026-10-17
- 분석 기준: 커밋 `4969651`, 작업 시작 시 변경 파일 없음
- 목표: 하나의 저장소·공통 React 화면·Rust 작업 엔진을 유지하면서 macOS와 Windows 기능 동등성 확보
- 최초 구현 상태(2026-10-17): W0~W2의 Mac 구현·회귀 검증 완료, 당시 Windows 컴파일·실행·설치 검증 미실행
- 후속 상태(2026-10-18): CI 설치·프론트·Windows 컴파일 검증 확인, Windows 테스트 실행 환경 보완과 최종 결과는 후속 검증 문서 참조
- 후속 구현과 실제 검증 범위: [Windows W0~W2 검증](windows-validation.md) 참조
- 최초 계획 작성 범위: 계획 문서와 구현 문서 인덱스만 변경, 당시 제품 코드·테스트·빌드 설정 변경 없음
- 기본 방향: 공통 작업 상태와 액션 실행 경로 유지, OS API 접점에만 플랫폼별 구현 추가

## 후속 구현 현황

- 아래 단계별 체크리스트는 최초 계획 기준 유지, 실제 구현·검증 증거는 [후속 검증 기록](windows-validation.md) 참조

| 단계 | 2026-10-18 로컬 구현 | 남은 검증 |
| --- | --- | --- |
| W3 | 압축 도구 동봉·ZIP/7z provider·TAR 코덱·자식 프로세스 취소 구현 | Windows 설치본의 포맷별 왕복·암호·취소 |
| W4 | 기본 앱·등록 앱·Explorer·터미널·명령 확인/진행/취소 구현 | Windows 네이티브 실행과 출력·경로 호환 |
| W5 | 파일 클립보드·휴지통 영수증/복원·Ctrl+Z 구현 | Explorer 클립보드 왕복·Recycle Bin 복원·취소·실제 경합 |

- 위 구현 상태를 Windows 실기 검증 완료로 해석 금지, 사용자 지시에 따른 push·이번 원격 CI 실행 없음

## 1. 범위와 구조 원칙

- 공통 유지: 듀얼 패널, 탭, 선택, 히스토리, 설정 모델, action registry, 작업 확인·충돌·진행률·취소·요약
- Rust 플랫폼 경계: 사용자·설정 경로, 드라이브, 파일 속성·식별, 파일 관리자·연결 앱·터미널, 클립보드, 휴지통
- 기존 기능 모듈 안의 작은 OS 분기 유지 허용, 독립 책임과 검증이 필요한 부분만 하위 플랫폼 모듈 분리
- `CommanderShell`·operation store의 Windows 전용 복제 금지
- OS별 장기 브랜치·별도 제품 저장소 분리 불필요
- Linux 목표와 기존 분기 유지, 이번 Windows 검증 결과로 Linux 지원 완료 주장 금지
- 제안 검증 기준: Windows 11 x64 우선 실행 환경, ARM64·추가 Windows 버전의 지원 범위는 W0에서 별도 기록
- CPU 아키텍처별 검증 순서와 기능 축소의 구분 필수, 지원 대상으로 선언한 환경에서는 동일 기능 완료 기준 적용

### 기존 요구사항과 확장 항목

| 구분 | 현재 기준 | 계획 반영 |
| --- | --- | --- |
| 공통 플랫폼 요구 | [FR-24](../requirements/05-customization-platform-quality.md): OS별 경로·권한·실행 파일·휴지통·드라이브·외부 연동 | Windows 미구현과 미검증 해소 필수 |
| 앱 내부 복사·이동 | [FR-7.11·FR-7.12](../requirements/02-file-operations.md): Windows Ctrl+C/X/V 포함 | 기존 공통 동작 보존 |
| 휴지통 복원 | [FR-9.9](../requirements/02-file-operations.md): macOS 최근 20개 작업의 세션 내 복원 | Windows 동등 기능 추가 계획, 기존 위반과 구분 |
| 연결 앱·OS 파일 클립보드 | [macOS 다음으로 열기·Finder 파일 클립보드](../requirements/04-gui-desktop-interactions.md): macOS 우선, 다른 OS는 내부 클립보드 유지 | Explorer 연동과 Windows 연결 앱 요구사항 확장 |
| 과거 완료 기록 | macOS·브라우저 검증 증거 포함 | 과거 상태 보존, Windows 증거 별도 기록 |

## 2. 현재 구현과 수정 대상

- 아래 표와 재현 결과: 분석 기준 커밋 `4969651`의 작업 전 상태, 후속 구현 결과는 [Windows W0~W2 검증](windows-validation.md) 참조

- 상태 구분: `재현`은 현 환경에서 해당 입력의 잘못된 결과 확인, `코드 확인`은 분기·조건·미지원 구현 확인, `검증 필요`는 Windows 실행 후 판단 항목
- 우선순위: `선행`은 빌드·기본 탐색·파일 안전성, `필수`는 지원 완료 전 기능 동등성, `배포`는 설치·실행 환경 검증

| 영역 | 확인한 상태와 근거 | 필요한 작업 | 우선순위 |
| --- | --- | --- | --- |
| 테스트 컴파일 | [archive.rs](../../src-tauri/src/archive.rs)의 `parse_zipinfo_long_output_for_test`는 모든 테스트 빌드에서 `success_status_for_test` 호출, 함수 정의는 `cfg(all(test, unix))`뿐인 코드 확인 | Windows용 종료 상태 생성 추가 또는 테스트 파서의 프로세스 상태 의존 제거, `cargo test --no-run`으로 검증 | 선행 |
| 검증 도구 경로 | [verify-full-scope.mjs](../../scripts/verify-full-scope.mjs)의 URL `.pathname` 사용으로 `/C:/...`·`%20` 경로 생성 재현 | [load-feature-metadata.mjs](../../scripts/load-feature-metadata.mjs)의 `projectRoot` 재사용 또는 `fileURLToPath` 적용 | 선행 |
| 홈·드라이브 | [navigation.rs](../../src-tauri/src/navigation.rs)의 `HOME`·현재 작업 폴더 fallback, 루트 `/`, macOS `/Volumes` 열거 확인 | Windows 사용자 홈·논리 드라이브·네트워크 경로 처리, 연결 해제·접근 거부 오류 처리 | 선행 |
| 설정 경로 | [settings_service.rs](../../src-tauri/src/settings_service.rs)에 `APPDATA` 분기 존재, 공통 홈 함수는 `HOME`·현재 작업 폴더 사용 | OS별 경로 조회 통합, 환경 변수 누락 시 안전한 fallback, 저장·재시작·동시 저장 검증 | 선행 |
| 경로 계약 | [path_text.rs](../../src-tauri/src/path_text.rs)는 OS 경로를 그대로 문자열화, [panelState.ts](../../src/ui/panelState.ts)의 UNC·확장 루트 부모 계산 오류 재현 | Rust 내부 경로·UI 표시·외부 앱 전달의 경계 정의, UNC·드라이브 루트 보존, 임의 trim·구분자 치환 방지 | 선행 |
| 드라이브 간 이동 | [file_io.rs](../../src-tauri/src/operation/file_io.rs)의 `is_cross_device_error`가 오류 번호 18만 허용, [transfer.rs](../../src-tauri/src/operation/transfer.rs)가 이 조건에서만 복사 후 원본 제거 | Windows 오류 17 처리, 복사 완료 전 원본 유지, 중간 취소·부분 실패·원본 제거 실패 검증 | 선행 |
| 파일 이름·동일 항목 | [mutation.rs](../../src-tauri/src/mutation.rs)의 빈 이름·구분자 검사 외 Windows 예약어·끝 점 등 전용 검사 없음, [bulk_rename.rs](../../src-tauri/src/bulk_rename.rs)는 Windows 충돌 키를 소문자로 변환 | 생성 대상의 예약 이름·금지 문자·ADS 표기 정책, 대소문자만 변경·동일 파일·중첩 원본·재파싱 지점 검증 | 선행 |
| 삭제 보호 | [file_io.rs](../../src-tauri/src/operation/file_io.rs)의 보호 목록이 Unix 경로·`HOME` 기준 | Windows 루트·공유 루트·실제 사용자 홈·OS 주요 폴더 보호, 표현·대소문자·링크 우회 검증 | 선행 |
| 링크·속성 | [file_io.rs](../../src-tauri/src/operation/file_io.rs)의 비-Unix 링크 복사 미지원, [filesystem.rs](../../src-tauri/src/filesystem.rs)의 숨김은 점 이름·비-Unix 실행 파일 판별은 false | 심볼릭 링크·junction·`.lnk` 의미 구분, 숨김·시스템·읽기 전용·실행 파일 판별, 권한 실패와 보존 범위 명시 | 필수 |
| 파일 열기·Explorer | [external.rs](../../src-tauri/src/external.rs)에 Explorer 분기 존재, 현재 폴더 Finder·Terminal 열기는 macOS 전용 | 기본 앱 실행과 위치 선택의 의미 분리 검증, 현재 폴더·터미널 열기 일반화, 특수 문자·UNC·긴 경로 인수 검증 | 필수 |
| 연결 프로그램 | [open_with.rs](../../src-tauri/src/open_with.rs)의 비-macOS 미지원 반환, 앱을 디렉터리로 요구하는 `.app` 중심 검증 | Windows 연결 앱 열거·실행, 실행 파일 경로뿐 아니라 OS 등록 앱 식별자를 표현할 계약 검토 | 필수 |
| 기능 노출·키보드 | [registry.ts](../../src/actions/registry.ts)의 `mac/other`와 macOS 전용 숨김, [client.ts](../../src/tauri/client.ts)는 등록 명령 전체를 구현됨으로 취급 | OS 정보와 실제 기능 지원 정보 분리, 모든 입력 경로의 동일 가용성 검사, Ctrl+Z 등 표시·실행·도움말 동기화 | 필수 |
| OS 파일 클립보드 | [file_clipboard.rs](../../src-tauri/src/file_clipboard.rs)의 비-macOS 읽기·쓰기·해제 미지원, [useFileClipboard.ts](../../src/ui/useFileClipboard.ts)의 native 사용을 macOS로 제한 | Windows 파일 목록·복사/이동 의도·변경 버전 계약, Explorer 양방향 연결, 늦은 응답·외부 변경·부분 성공 처리 | 필수 |
| 휴지통·복원 | [trash_restore.rs](../../src-tauri/src/operation/trash_restore.rs)의 비-macOS는 `trash::delete` 뒤 `None`, 복원 영수증 미생성 | Windows 삭제 결과 식별·복원 구현 검증, OS 휴지통 메타데이터와 충돌 처리, 기존 최근 20개·세션 범위 유지 | 필수 |
| 압축 도구 | [archive.rs](../../src-tauri/src/archive.rs)·[archive_ops.rs](../../src-tauri/src/operation/archive_ops.rs)의 zip/unzip/zipinfo/tar/7z 의존, 두 탐색 함수가 확장자 없는 파일만 조회 | `.exe`·설치 위치·번들 도구 탐색 통합, 포맷별 provider 선정·동봉, 목록·생성·추가·선택 해제·암호·취소 검증 | 필수 |
| 드래그 앤 드롭 | [useFileDrag.ts](../../src/ui/useFileDrag.ts)·[commands.rs](../../src-tauri/src/commands.rs)의 투명 overlay와 네이티브 plugin, [nativeDropPosition.ts](../../src/ui/nativeDropPosition.ts)의 비-macOS 배율 변환 존재 | WebView2·Explorer 실기 검증 후 필요 부분만 보정, DPI·모니터 간 이동·취소·중복 작업 검사 | 필수 |
| 명령 실행 | [shell_command.rs](../../src-tauri/src/shell_command.rs)는 실행 파일 직접 실행, [fileActionPlans.ts](../../src/ui/fileActionPlans.ts)는 단순 인수 파싱 | 직접 실행과 cmd/PowerShell 내장 명령 정책 구분, 따옴표·역슬래시·공백·출력 인코딩·취소 지원 경계 검토 | 필수 |
| 자동화·패키징 | `.github` 디렉터리 없음, [tauri.conf.json](../../src-tauri/tauri.conf.json)에 macOS 설정과 공통 `targets: all`·Windows 아이콘 존재 | OS별 CI, Windows NSIS 설치 후보, WebView2·압축 도구 배포·서명 정책, 깨끗한 환경 설치 검증 | 배포 |

### 파일 안전성에서 유지할 기존 구현

- [mutation.rs](../../src-tauri/src/mutation.rs)의 Windows `MoveFileExW` 기반 덮어쓰기 없는 이동 분기 재사용·검증
- [file_io.rs](../../src-tauri/src/operation/file_io.rs)의 새 파일 생성·임시 복사·백업·교체 실패 시 복구 흐름 유지
- [transfer.rs](../../src-tauri/src/operation/transfer.rs)의 원본·대상 사전 검사와 기존 operation 상태·이벤트 경로 유지
- 휴지통 실패를 영구 삭제로 전환하는 fallback 금지
- 권한 확보를 위한 앱 전체 관리자 실행 기본값 금지, 항목별 실패·재시도·요약 제공
- Windows ACL·소유자·ADS·시간·특수 속성 보존 요구를 명확히 정의한 뒤 구현·검증, 일반 바이트 복사를 전체 메타데이터 보존으로 표현 금지

### 재현 결과와 기술 근거

| 입력 또는 조건 | 현재 결과 | 필요한 결과 |
| --- | --- | --- |
| `parentPathOf('C:\')` | `C:\` | 기존 정상 동작 유지 |
| `parentPathOf('\\server\share')` | `\\server` | 공유 루트 유지 또는 상위 이동 없음 |
| `parentPathOf('\\?\C:\')` | `\\?` | 드라이브 루트 유지 또는 상위 이동 없음 |
| `parentPathOf('\\?\UNC\server\share')` | `\\?\UNC\server` | 공유 루트 유지 또는 상위 이동 없음 |
| Windows 저장소 URL의 `.pathname` | `/C:/Users/Test%20User/BokslDirGUI/` | `C:\Users\Test User\BokslDirGUI\` |

- 재현 방식: 기존 TypeScript 모듈을 메모리에서 변환 후 Node로 호출, Windows 형식 문자열 입력만 사용, Windows 실행 검증과 구분
- Rust `canonicalize`는 Windows에서 확장 길이 경로를 반환하며 외부 앱 호환성에 차이 발생 가능: [Rust 공식 문서](https://doc.rust-lang.org/std/fs/fn.canonicalize.html)
- 다른 디스크 이동 오류의 Windows 코드는 17: [Microsoft 오류 코드](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-)
- 예약 이름·끝 점·끝 공백·경로 namespace 규칙: [Microsoft 파일 이름 규칙](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file)
- 확장 경로 접두사의 무조건 제거·전체 경로 소문자화 금지, 실제 파일 작업 경로와 화면 표시의 계약 분리 필수

## 3. 단계별 작업 계획

### W0 Windows 기준 빌드와 검증 환경

- [ ] Windows 지원 버전·x64/ARM64 대상과 테스트 환경 기록
- [ ] Node 24 이상·Rust MSVC toolchain·C++ Build Tools·WebView2 구성
- [ ] Windows에서 현재 코드의 `cargo check`, `cargo test --no-run`, Tauri 개발 실행·번들 빌드 결과 수집
- [x] 테스트 함수의 Unix 한정 정의와 검증 스크립트 URL 경로 문제 수정
- [ ] macOS·Windows CI 추가, 플랫폼별 테스트·빌드 결과와 설치 산출물 분리
- [x] 도구 미설치로 압축 테스트가 반환하는 경우를 검증 완료와 구분하도록 보고·실패 게이트 설계
- 완료 기준: 양쪽 OS의 빌드·테스트 진입 가능, 실제 실패와 미실행 목록 식별 가능
- 주 변경 파일: `archive.rs`, `scripts/verify-full-scope.mjs`, `scripts/load-feature-metadata.mjs`, `src-tauri/Cargo.toml`, 신규 `.github/workflows` 구성
- 의존성: 없음, 이 단계 통과를 Windows 기능 지원 완료로 취급 금지

### W1 공통 플랫폼 정보와 경로 계약

- [x] Rust에서 OS·기능 지원 정보를 제공하고 action context에 연결하는 작은 공통 계약 추가
- [x] 현재 `mac/other` 단축키 분류와 실제 OS 식별·기능 지원 여부 분리
- [ ] 홈·설정·보호 디렉터리 조회 기준 통합, Windows 드라이브 목록 구현
- [ ] 실제 파일 경로·화면 표시·외부 앱 인수·압축 내부 경로의 구분 확정
- [ ] UNC·확장 길이 경로·드라이브 루트·한글·공백·대소문자·존재하지 않는 경로 테스트 추가
- [ ] 주소 입력·상위 이동·탭·히스토리·북마크·재시작 경로 복원 검증
- 완료 기준: 일반 사용자 환경에서 시작 경로와 드라이브 탐색 정상, 루트 위 이동·파일 경로 손실 없음
- 주 변경 파일: `navigation.rs`, `path_text.rs`, `settings_service.rs`, `contracts.rs`, `commands.rs`, `lib.rs`, `src/domain/types.ts`, `src/tauri/*`, `panelState.ts`, `fileActionPlans.ts`, `archiveVirtual.ts`, `actionContext.ts`
- 의존성: W0

### W2 Windows 파일 작업과 안전성

- [ ] Windows 다른 볼륨 오류와 파일 사용 중·접근 거부 오류 구분
- [ ] 드라이브 간 이동의 복사 완료·취소·원본 제거 실패·재시도 검증
- [ ] 생성 이름 검증과 기존 원본 경로 보존 분리, 예약 이름·금지 문자·끝 점·ADS 처리 정책 적용
- [ ] 단일·일괄 이름 변경의 대소문자만 변경·충돌·외부 변경 재검증
- [ ] Windows 보호 경로 추가, 삭제 대상의 동일성·루트·링크 우회 검사
- [ ] 파일·디렉터리 심볼릭 링크, junction, 바로가기 정책 구현·문서화
- [ ] 숨김 속성·실행 파일·읽기 전용·권한 표시와 메타데이터 보존 기준 적용
- 완료 기준: Windows 임시 fixture에서 복사·이동·이름 변경·삭제·덮어쓰기·취소 검증, 실패 시 원본·기존 대상 보존
- 주 변경 파일: `mutation.rs`, `bulk_rename.rs`, `filesystem.rs`, `navigation.rs`, `operation/file_io.rs`, `operation/transfer.rs`, `operation/delete.rs`, 관련 테스트
- 의존성: W1

### W3 압축 provider와 외부 프로세스

- [ ] Windows에 우연히 설치된 Unix 도구에 의존하지 않는 배포 구상 확정
- [ ] 기존 외부 프로세스 경계 재사용을 우선으로 도구 동봉과 Rust 라이브러리 대안의 포맷·암호·라이선스·취소 지원 비교
- [ ] 7-Zip 계열·tar 계열 등 후보를 포맷별 fixture로 검증한 뒤 선정, 특정 후보의 전체 포맷 지원 사전 가정 금지
- [ ] 중복 실행 파일 탐색 통합, `.exe`·번들 절대 경로·도구 버전 처리
- [ ] zip/jar/war/tar/tar.gz/tgz/tar.zst/tzst/7z 생성·목록·전체/선택 해제·추가의 기존 지원 범위 유지
- [ ] 암호 지원 포맷·한글 이름·긴 경로·대량 목록·충돌·취소·비밀값 오류 요약 제외 검증
- [ ] `..`·절대 경로·드라이브·UNC·예약 이름·ADS·링크를 통한 압축 해제 경계 이탈 방지
- [ ] 자식 프로세스 종료와 임시 파일 정리 검증, Windows 자식 트리 제어가 필요한 경우 해당 경계에만 구현
- 완료 기준: 개발 도구가 없는 Windows에서 제공 포맷 정상 처리, 필수 압축 테스트의 도구 부재 건너뛰기 없음
- 주 변경 파일: `archive.rs`, `operation/archive_ops.rs`, `operation/process.rs`, `operation/runtime.rs`, `tauri.conf.json`, 관련 테스트
- 의존성: W1·W2, provider 후보의 타당성 검증은 W0 직후 조기 착수 가능

### W4 Windows 기본 앱과 데스크톱 명령

- [ ] `open_current_in_finder`의 의미를 공통 파일 관리자 열기로 일반화하는 계약 변경
- [ ] 공통 액션·command 명칭 변경 시 registry·wrapper·Rust 등록·번역·요구사항·생성 문서 동시 갱신
- [ ] 기본 앱 열기, Explorer 위치 선택, 현재 폴더 열기 각각의 결과 확인
- [ ] Windows 연결 프로그램 목록·기본 앱 표시·선택 실행 구현, OS 등록 앱 식별자와 임의 실행 경로 검증 유지
- [ ] 터미널 기본 실행 방식과 미설치 fallback 정의, 공백·특수 문자 인수 보존
- [ ] 직접 프로그램 실행과 셸 내장 명령의 입력 계약 명시, 명령 문자열의 무조건 셸 전달 금지
- [ ] 외부 명령의 기본 비활성·확인 정책을 기존 지침과 대조, 진행·취소·오류 요약 미충족은 별도 공통 결함으로 기록·해결
- 완료 기준: 동일 메뉴·컨텍스트 메뉴·키보드 경로에서 Windows 기능 실행, macOS 기존 동작 보존
- 주 변경 파일: `external.rs`, `open_with.rs`, `shell_command.rs`, `src/actions/registry.ts`, `src/tauri/*`, `fileActionPlans.ts`, `OpenWithDialog.tsx`, `i18n-resources.ts`
- 의존성: W1, 명령 실행의 프로세스 관리 변경 시 W3 재사용

### W5 OS 클립보드와 휴지통 복원

- [ ] Windows 파일 클립보드의 목록·복사/이동 의도·변경 번호를 공통 DTO에 반영
- [ ] Explorer→앱·앱→Explorer의 복사/이동 및 앱 내부 압축 항목 복사 분리 검증
- [ ] 붙여넣기 요청 당시 대상 유지, 늦은 응답 무시, 변경 번호 일치 시 해제, 부분 완료 정책 검증
- [ ] 휴지통 삭제 성공 결과에서 복원 가능한 항목 식별자를 확보하는 Windows API 후보 검증
- [ ] 기존 macOS 영수증의 경로 기반 구조를 무조건 Windows에 재사용하지 않고 OS 식별자·복원 호출 경계 정의
- [ ] 휴지통 비움·원본 부모 교체·이름 충돌·네트워크/외부 볼륨·부분 취소·복원 실패 검증
- [ ] 일반 사용자 권한에서 복원 지원 확인, 생성 시각만으로 파일 동일성 판단하는 비-Unix 경계 보완
- [ ] Windows Ctrl+Z와 메뉴·도움말 노출 연결, 최근 20개 작업·세션 범위 및 기존 macOS Cmd+Z 유지
- 완료 기준: Windows OS 클립보드 왕복과 이 앱의 휴지통 작업 복원 왕복 검증, 실패 시 영구 삭제 전환 없음
- 주 변경 파일: `file_clipboard.rs`, `operation/trash_restore.rs`, `useFileClipboard.ts`, `useTrashUndo.ts`, `registry.ts`, DTO·wrapper·관련 테스트
- 의존성: W1·W2, 휴지통 API 후보 검증은 W0 직후 조기 착수 권장

### W6 Windows 실제 UI와 네이티브 드래그

- [ ] WebView2에서 듀얼 패널·가상 목록·한글 IME·폰트·고대비·메뉴 포커스 검증
- [ ] Tab·방향키·PageUp/Down·Home/End·Space·Enter 및 입력창·다이얼로그의 키보드 소유권 검증
- [ ] 내부 패널 드래그·Explorer 왕복·외부 앱 내보내기·파일/폴더·다중 선택 검증
- [ ] 배율 100/125/150/200%, 서로 다른 배율의 다중 모니터, 최대화·창 크기 복원 검증
- [ ] overlay 포커스·위치·잔류 창·Escape 취소·중복 drop·리소스 정리 검증
- [ ] 기존 pointer 세션과 operation store 유지, 실제 Windows 증거가 있는 부분만 수정
- 완료 기준: 실제 Tauri 창에서 대상 패널 오류·중복 파일 작업 없음, 입력 경로별 공통 액션·취소·오류 처리 일치
- 주 변경 파일: `useFileDrag.ts`, `nativeDropPosition.ts`, `src/drop-overlay.ts`, `commands.rs`, `window_session.rs`, `styles.css`, 필요한 Tauri 설정·권한
- 의존성: W2·W4·W5, 화면·overlay 초기 점검은 W0부터 가능

### W7 설치와 지원 완료 판정

- [ ] Windows 전용 설정이 필요한 부분만 별도 설정 파일로 분리, macOS private API 설정을 Windows 결함으로 단정 금지
- [ ] NSIS 설치 파일 우선 후보 검증, MSI 필요 여부는 실제 배포 요구에 따라 확정
- [ ] WebView2 설치 정책, 압축 도구 동봉·버전·라이선스 고지, 설치 경로 공백·한글 검증
- [ ] 서명 유무에 따른 배포 절차·사용자 경험 기록, 공개 배포 전 서명 적용 여부 확정
- [ ] 개발 도구와 별도 압축 프로그램이 없는 일반 사용자 Windows 환경에서 설치·재실행·업그레이드·제거 검증
- [ ] 설치 제거와 설정·사용자 파일 보존 정책 검증, 관리자 권한 없이 일반 파일 작업 확인
- [ ] macOS 회귀와 Windows 필수 항목의 실행 증거 연결, 미실행·미지원 항목을 완료와 구분
- 완료 기준: 설치 패키지로 모든 필수 기능 검증 완료, 지원 OS·아키텍처별 실행 증거 확보
- 주 변경 파일: Tauri 설정·번들 리소스·CI·README·플랫폼 검증 문서
- 의존성: W0~W6

## 4. 검증 방법과 완료 조건

| 계층 | 실행 환경 | 검증 기준 |
| --- | --- | --- |
| 순수 계산·UI | macOS와 Windows | 경로 문자열·액션 노출·단축키·비동기 요청·DTO·작업 상태 테스트 |
| Rust 빌드·파일 작업 | 각 OS 네이티브 runner | 컴파일·실제 임시 파일 작업·OS별 오류·링크·취소 검증 |
| OS 연동 | 각 OS의 데스크톱 세션 | Explorer/Finder·연결 앱·클립보드·휴지통·드래그 검증 |
| 배포 | 개발 도구 없는 Windows | 설치·WebView2·동봉 도구·기본 실행·재시작·제거 검증 |
| macOS 회귀 | 기존 지원 Mac 환경 | 같은 변경에 대한 공통·macOS 기능 회귀 검증 |

- 공통 명령: `npm run typecheck`, `npm test`, `npm run rust:test`, `npm run verify:scope`, `npm run docs:check`
- 빌드 진입 확인: `cargo check --manifest-path src-tauri/Cargo.toml`, `cargo test --manifest-path src-tauri/Cargo.toml --no-run`
- 단계 통합 시 양쪽 OS에서 `npm run verify`, 설치 산출물 검증 시 `npm run tauri:build` 실행
- 키보드·액션 변경 시 `npx vitest run src/actions/registry.test.ts src/ui/CommanderShell.test.tsx` 우선 실행, 영향받은 개별 테스트 추가
- 제품 코드·테스트·빌드 설정 변경 마무리 시 [change-review](../../.agents/skills/change-review/SKILL.md) 검토 필수
- `npm run verify` 통과와 실제 네이티브 UI·설치 검증 완료의 구분 필수
- 현재 `tests.rs`의 외부 `echo` 실행과 `test_support.rs`의 `sleep` 의존을 OS 독립 테스트 도우미 또는 명시적 플랫폼 fixture로 교체
- `cfg(unix)` 테스트의 이름만 남기는 방식 금지, Windows 의미에 맞는 링크·권한·프로세스 회귀 검증 추가
- 필수 provider 미설치로 조기 반환한 압축 테스트의 통과 처리 금지, CI의 사전 의존성 확인과 실행 여부 기록 필수
- 다른 볼륨·네트워크 공유·실제 Recycle Bin 검증 환경이 없으면 해당 항목 미검증 유지
- `.lnk`를 심볼릭 링크와 동일하게 취급하거나 ACL을 Unix 권한 문자열로 임의 변환하는 정책 금지
- 공통 미완료 기능은 Windows 전용 문제와 구분, 기존 기능 동등성 범위의 누락 은폐 금지

## 5. 주요 결정과 위험 관리

| 결정 또는 위험 | 권장 처리 | 확정 시점 |
| --- | --- | --- |
| Windows 버전·아키텍처 | Windows 11 x64 기준 시작, 추가 지원 대상별 테스트 환경 명시 | W0 |
| Windows 압축 도구 구성 | 기존 프로세스 실행 경계 재사용·동봉 우선 검토, 포맷·암호·라이선스 증거로 최종 선정 | W3 구현 전 |
| 휴지통 복원 API | 실제 삭제·복원 식별자 확보와 외부 볼륨 지원을 소규모 검증으로 확인 | W5 구현 전 |
| 플랫폼 기능 정보 | 백엔드가 실제 지원 정보를 제공, UI의 명령 등록 여부와 구분 | W1 |
| 경로 변경 범위 | 문자열만 일괄 치환하지 않고 Rust·UI·외부 앱 경계별 계약 정의 | W1 |
| 파일 메타데이터 보존 | 기존 제한과 Windows 추가 요구를 구분하고 실패 동작까지 명시 | W2 |
| 작업 기간 | W0 결과와 압축·휴지통 API 검증 전 고정 일정 산정 유보 | W0 및 후보 검증 후 |

- 가장 큰 불확실성: 압축 도구 배포, Windows 휴지통 복원, 네이티브 드래그의 실제 창 동작
- 권장 착수: W0 빌드·테스트 진입 정리 → W1 경로·플랫폼 계약 → W2 파일 안전성
- 압축·휴지통 후보 검증의 조기 수행으로 후반 재설계 위험 축소
- Windows 메뉴를 숨기는 것만으로 기능 동등성 완료 판정 금지

## 6. 관련 문서 갱신 계획

- 요구사항: [파일 작업](../requirements/02-file-operations.md), [GUI 상호작용](../requirements/04-gui-desktop-interactions.md), [플랫폼 품질](../requirements/05-customization-platform-quality.md)
- 계약·상태: [Tauri command API](tauri-command-api.md), [파일 작업 상태 머신](file-operation-state-machine.md), [드래그 앤 드롭](drag-and-drop.md)
- 기능 대응: [action registry](action-registry.md), [TUI 동등성 원본](tui-parity-matrix.json), [전체 테스트 명세](full-scope-test-spec.md)
- 액션·명령 변경 시 실제 공통 정의와 독립 요구사항 동시 수정 후 `npm run docs:generate`·`npm run docs:check` 실행
- 과거 macOS 완료 항목을 Windows 완료로 재해석하거나 역사적 검증 수치 변경 금지

## 7. 외부 기술 기준

- [Tauri 개발 환경](https://tauri.app/start/prerequisites/): Windows C++ Build Tools·WebView2·Rust 구성
- [Tauri Windows 설치](https://tauri.app/distribute/windows-installer/): Windows 설치 패키지·WebView2 배포·교차 빌드 제약
- [Tauri GitHub 빌드](https://tauri.app/distribute/pipelines/github/): OS별 자동 빌드와 산출물 생성
- [Rust canonicalize](https://doc.rust-lang.org/std/fs/fn.canonicalize.html): Windows 확장 길이 경로와 외부 앱 전달 제약
- [Microsoft 경로 규칙](https://learn.microsoft.com/en-us/windows/win32/fileio/naming-a-file): 예약 이름·문자·경로 namespace
- [Microsoft 오류 코드](https://learn.microsoft.com/en-us/windows/win32/debug/system-error-codes--0-499-): 다른 디스크 이동 오류 17

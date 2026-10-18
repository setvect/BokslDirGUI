# Windows W0부터 W2까지 구현과 검증

- 기준일: 2026-10-17
- 작업 전 태그: `before-windows-w0-w2-20261017`, 기준 커밋 `4969651`
- 기본 검증 대상: Windows 11 x64 사용자 환경, CI 빌드 대상은 Windows Server 2022 x64 runner
- ARM64·다른 Windows 버전: 지원 판정 전 별도 실행 증거 필요, 현재 미검증
- W0~W2 후속 상태: `933d8ac`의 Mac·Windows CI 테스트와 앱·NSIS 빌드 통과, 실제 Windows 데스크톱 수동 검증 미실행
- 전체 계획: [Windows 지원 분석과 작업 계획](windows-support-plan.md)

## 1. 이번 구현 범위

| 단계 | 변경 | 확인 범위 |
| --- | --- | --- |
| W0 | Unix 한정 테스트 종료 상태의 Windows 구현, 파일 URL 경로 수정, Windows 테스트용 셸·junction fixture | Mac 테스트·소스 검사, Windows 실행 대기 |
| W0 | macOS·Windows CI, 설치 산출물 업로드, provider 가용성 보고·엄격 검사 | 설정 작성 완료, 원격 workflow 실행 전 |
| W1 | `get_platform_info`와 공통 DTO, action context·실행·클립보드·복원 가용성 연결 | Mac UI·계약·늦은 응답 테스트 |
| W1 | OS 사용자 홈·설정 경로, Windows 논리 드라이브 조회, UNC·확장 경로의 루트 보존 | 순수 경로 계산은 Mac 검증, Windows OS 조회 대기 |
| W2 | Windows 예약 이름·끝 점/공백·ADS·장치 경로 검사, 다른 볼륨 오류 17·파일 잠금 오류 구분 | 순수 규칙·모의 오류 테스트, 실제 Windows 오류 대기 |
| W2 | 파일 동일성 기반 자기 복사·중첩 검사, Windows 파일 ID 기반 이름 변경 사전 재검증 | Mac 파일 작업 회귀, Windows ID·대소문자 이름 변경 대기 |
| W2 | 보호 디렉터리 조회, 파일·디렉터리 심볼릭 링크 복사/삭제, 미지원 재파싱 지점 차단 | Mac 공통 경로 회귀, Windows 링크·권한 대기 |
| W2 | Windows 숨김/시스템 속성·실행 파일 판별, 일반 파일 속성 보존 | Windows 전용 회귀 추가, 실제 실행 대기 |

- Windows 미구현 기능의 지원 정보: 연결 앱·현재 폴더 파일 관리자/터미널·네이티브 파일 클립보드·휴지통 복원은 false 유지
- Windows 앱 내부 Ctrl+C/X/V와 공통 파일 작업 유지, W4·W5의 OS 연동 완료와 구분
- 공통 operation store·작업 확인·진행률·충돌·취소·요약의 소유권 유지
- 태그 이후 구현 변경의 커밋·브랜치 push 미수행

## 2. 경로와 파일 정책

- Rust 실제 파일 경로: `Path`·`PathBuf`와 OS canonical 경로 유지, Windows 확장 경로 접두사 무조건 제거 금지
- React 경로: 전달받은 원문 유지, 부모 경계 계산에만 구분자 정규화, 경로 전체 trim·소문자화 금지
- Windows 입력: 절대 드라이브·UNC·그 확장 길이 경로만 허용, 드라이브 상대 경로·장치 namespace·ADS 입력 거부
- 압축 내부 경로: 기존 `/` 기반 가상 경로 유지, 실제 OS 경로와 분리
- 외부 앱에 확장 경로를 전달하는 호환성: W4 실제 앱 검증 대상, 이번 단계에서 완료 주장 없음
- 생성 대상 이름: Windows 예약어·금지 문자·끝 점·끝 공백 거부
- 기존 원본 이름: 정확한 항목 식별자 유지, 새 이름의 정규화로 원본 경로 변경 금지
- 대소문자만 변경: 같은 파일 ID와 디렉터리 항목을 확인한 경우만 기존 no-replace 이동 시도
- 심볼릭 링크: 파일·디렉터리 링크의 대상을 복사하거나 삭제하지 않고 링크 항목 자체 처리
- junction·알 수 없는 재파싱 지점: 변경 작업 전 명시적 미지원 오류, 대상 재귀 변경 금지
- 디렉터리 크기 계산: Windows 재파싱 지점의 하위 대상 추적 제외
- `.lnk`: 일반 파일로 복사·이동·삭제, 심볼릭 링크로 간주 금지
- 일반 파일의 Windows 보존 범위: 파일 내용·읽기 전용·숨김·시스템·archive 속성
- ACL·소유자·ADS·시간·디렉터리 메타데이터·압축/희소 속성의 전체 보존: 미구현 범위 명시, 무손실 전체 메타데이터 복사 주장 금지
- 권한 부족: 항목별 오류 표시, 앱 전체 관리자 권한 실행으로 우회 금지
- 이동 취소·복사 경합 실패: 원본 유지, 기존 대상 덮어쓰기 금지

## 3. Windows에서 직접 실행할 명령

- 전제: Windows 네이티브 터미널, Node 24 이상, Rust 1.93.0 MSVC, C++ Build Tools, WebView2 준비
- 전제: 작업 변경을 포함한 동일 소스와 lockfile 사용, 기준 태그만 checkout한 상태와 구분
- 실행 위치: 저장소 루트

```powershell
npm ci
npm run typecheck
npm test
cargo check --manifest-path src-tauri/Cargo.toml --locked
cargo test --manifest-path src-tauri/Cargo.toml --locked --no-run
cargo test --manifest-path src-tauri/Cargo.toml --locked -- --nocapture
npm run verify
npm run tauri:build -- --bundles nsis
```

- 자동 Windows 테스트: 예약 이름, 파일 속성·잠금, 대소문자 이름 변경, 홈 보호, 드라이브 형식, 설정 반복 저장, 파일 ID 교체, junction 차단, 장치/ADS 경로 거부
- 심볼릭 링크 테스트: 개발자 모드 또는 생성 권한이 있는 전용 환경에서 명시 실행

```powershell
cargo test --manifest-path src-tauri/Cargo.toml windows_symlink_policy_preserves_link_identity -- --ignored --nocapture
```

- 테스트는 임시 fixture만 사용, 사용자 데이터·실제 OS 주요 디렉터리를 삭제하는 검증 금지
- 보호 경로 테스트는 guard 반환값만 검사, 실제 보호 디렉터리 변경 금지

### 압축 도구 미실행 구분

```powershell
npm run verify:providers -- --report-only
npm run verify:providers
$env:BOKSLDIRGUI_REQUIRE_PROVIDERS = '1'
cargo test --manifest-path src-tauri/Cargo.toml -- --nocapture
Remove-Item Env:BOKSLDIRGUI_REQUIRE_PROVIDERS
```

- `--report-only`: 도구 부재를 포함해 `temp/verification/platform-providers.json` 저장, 결과 수집 목적
- 기본 `verify:providers`: 필요한 도구가 하나라도 없으면 실패
- `BOKSLDIRGUI_REQUIRE_PROVIDERS=1`: provider 의존 테스트의 도구 부재 조기 반환을 실패로 처리
- 도구 가용성 통과와 포맷별 처리 성공의 구분 필수
- CI의 Windows 도구 보고만으로 압축 기능 완료 판정 금지, 동봉 도구와 엄격 테스트의 후속 구현은 8절 참조
- 최초 로컬 Mac 검증은 `7z/7zz` 미설치로 실제 7z 왕복 미검증, 임시 도구를 이용한 후속 검증은 7절 참조

## 4. Windows 수동 체크리스트

| 항목 | 확인 방법과 기대 결과 | 상태 |
| --- | --- | --- |
| 시작·설정 | Explorer에서 실행 후 사용자 홈 기준 탐색, AppData 설정 저장·재시작 복원 | 미실행 |
| 드라이브 | C/D 드라이브 표시, 연결 해제·비어 있는 드라이브·접근 거부 오류 표시 | 미실행 |
| UNC 공유 | 공유 루트 상위 이동 제한, 하위 폴더·주소 입력·북마크·탭 복원 | 미실행 |
| 긴 경로 | 실제 긴 디렉터리에서 목록·복사·이름 변경, 확장 경로와 일반 경로 동일 항목 검사 | 미실행 |
| 이름 | 한글·이모지·공백, 대소문자만 변경, 예약 이름·끝 점/공백 거부 | 미실행 |
| 파일 동일성 | hardlink·대소문자 구분 디렉터리·대소문자 별칭의 동일 원본 덮어쓰기 방지 | 미실행 |
| 다른 볼륨 이동 | 별도 임시 볼륨 사이 성공·취소·복사 실패·원본 제거 실패, 원본과 대상 상태·요약 확인 | 미실행 |
| 사용 중인 파일 | 공유 삭제 권한 없는 핸들로 잠근 파일의 이동·삭제 실패와 원인 안내 | 미실행 |
| 읽기 전용 | 복사 속성 보존, 덮어쓰기·취소·정리 실패 시 원본·복구 경로 보존 | 미실행 |
| 링크 | 파일·디렉터리·끊긴 링크의 복사·이름 변경·삭제, 생성 권한 부족 오류 | 미실행 |
| 재파싱 지점 | junction·OneDrive 등 미지원 지점이 대상 재귀 변경 없이 중단되는지 확인 | 미실행 |
| 삭제 보호 | 사용자 홈·OS 주요 폴더·드라이브/공유 루트 guard 거부, 실제 삭제 실행 금지 | 미실행 |
| 기본 GUI | Tab·방향키·Space·Enter·입력창 소유권·한글 입력·배율·창 복원 | 미실행 |
| 설치 | NSIS 설치·일반 권한 실행·재시작·제거, WebView2 환경 | 미실행 |

- 실제 Explorer/Finder 연동·OS 클립보드·휴지통 복원·드래그 완성은 W4~W7에서 추가 검증
- Windows 체크리스트의 미실행을 Mac 테스트 통과로 대체 금지

## 5. 설계 선택과 후속 작업

- `dirs 6.0.0`: 기존 Tauri 전이 의존성을 직접 사용하여 OS 홈·설정 경로 조회 일원화
- `same-file 1.0.6`: 기존 lockfile의 검증된 라이브러리 재사용, 경로 문자열만으로 파일 동일성 판단 방지
- `windows-sys 0.61.2`: 기존 lockfile 버전 재사용, 드라이브·파일 ID·재파싱 태그·파일 속성 API의 Windows 대상 의존성만 추가
- `.github/workflows/desktop.yml`: macOS 14·Windows Server 2022 x64 빌드/테스트, 결과·패키지 artifact 저장, 외부 릴리스 발행 없음
- CI provider 사전 검사와 실제 압축 회귀를 별도 실행, 도구 존재만으로 모든 압축 기능의 검증 성공 주장 금지
- Windows 실제 실행 후 오류가 확인되면 W0~W2 잔여 결함으로 추적, W3~W7 완료로 잘못 분류 금지
- junction·클라우드 재파싱 지점 지원 확대와 전체 메타데이터 보존은 별도 Windows 실증 후 정책 확정 필요

## 6. Mac 검증 결과와 변경 검토

- 실행 환경: macOS, 2026-10-17 로컬 작업 트리
- `npm run verify`: 통과, TypeScript·프론트 빌드·Rust check·생성 문서 정합성 포함
- 프론트 테스트: 34개 파일, 328개 테스트 통과, 검증 스크립트 테스트 통과
- Rust 테스트: 96개 통과·1개 명시 제외, 제외 항목은 실제 macOS 휴지통 복원 테스트
- 압축 provider 부재 조기 반환: 7z 관련 실제 왕복 미실행, 위 Rust 통과 집계와 별도 해석 필수
- 전체 범위 스모크: 261개 검사 통과
- 마지막 경로 검사 보완 후 `npm run rust:test`: 96개 통과·1개 명시 제외 재확인
- 다른 볼륨 이동 모의 회귀: 성공 후 원본 제거·복사 경합 실패 시 원본 보존·취소 시 원본 보존 통과
- `git diff --check`·신규 파일 공백·문서 로컬 링크·CI YAML 구문 검사 통과
- 변경 검토: 공통 action registry·operation store 소유권·플랫폼 응답 수명주기·파일 변경 진입점 확인
- 검토 중 보완: 부모/파일명 분리 전 Windows 원본 전체 경로 검사 추가, 단일·일괄 이름 변경과 파일 작업의 ADS 경로 우회 차단
- 구조 정리: 플랫폼 API와 파일 동일성 판정의 공통 경계 재사용, 관련 없는 모듈 재설계 없음
- Windows 전용 테스트·CI 실제 실행·설치 패키지·실제 GUI 동작: 미실행, 이 문서의 수동 체크리스트로 후속 확인 필요

## 7. 2026-10-18 CI 후속 보완 기록

- 설치 실패 해결: 누락된 `@emnapi/core`·`@emnapi/runtime`과 `wasi-threads` 잠금 정합성 보완, npm 11.19.0의 별도 소스 복사본 `npm ci` 및 전체 검증 통과
- 시간대 회귀 해결: 한국 시각 고정 fixture를 현지 시각 fixture로 변경, UTC 전체 검증 통과
- 빌드 경로 보완: Vite 진입 파일 URL을 `fileURLToPath`로 변환, Windows 드라이브와 인코딩된 경로 보존
- 문서 검사 회귀 해결: 생성 구간의 기존 CRLF 보존, 도구 테스트 14개 통과
- Windows 테스트 컴파일 해결: 내부 함수 재공개 제거, ADS 원본 경로 검사의 내부 테스트 모듈 이동
- `d3f246c` [CI 실행](https://github.com/setvect/BokslDirGUI/actions/runs/39076112886): Mac 테스트·앱 빌드·산출물 업로드 성공, Windows 프론트·문서·Rust 컴파일 성공
- 같은 실행의 Windows 테스트: 실행 파일 시작 전 `STATUS_ENTRYPOINT_NOT_FOUND` 종료, 테스트 본문 실행 성공과 구분
- manifest 보완: Tauri 2.6.2 기본 Common Controls v6 선언을 그대로 보존하여 MSVC의 앱·라이브러리 테스트 실행 파일에 포함, 다른 대상 빌드 유지
- 보완 근거: [Tauri 공식 이슈와 유지보수자 해결책](https://github.com/tauri-apps/tauri/issues/13419), 로컬 `tauri-winres 0.3.6`의 앱 바이너리 한정 리소스 연결 확인
- Windows 최종 테스트·설치 파일 결과: manifest 보완 후 CI 실행 증거로 별도 판정, 기존 수동 체크리스트의 미실행 상태 유지
- manifest 후속 결과: Windows 테스트 본문 실행 확인, Unix 루트 고정 기대값을 OS별 루트 계약 검사로 보완
- 파일 동일성 보완: Windows 휴지통 receipt 검사에 기존 볼륨·파일 ID 조회 재사용, 생성 시각이 같은 교체 파일의 잘못된 복원 차단
- 7z 경로 보완: Windows 목록의 역슬래시를 가상 경로 구분자로 통일, 상위 경로·절대 경로의 추출 거부 회귀 유지
- 로컬 실제 7z 검증: 공식 7-Zip 26.04 macOS 배포본의 SHA-256 확인 후 임시 경로에서 실행, 시스템 설치 변경 없음
- 후속 검증: UTC `npm run verify` 통과, 프론트 328개·도구 14개·Rust 97개 통과·실제 macOS 휴지통 1개 명시 제외, 스모크 261개 통과
- 엄격 provider 검증: `npm run verify:providers` 및 `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 cargo test --manifest-path src-tauri/Cargo.toml --locked -- --nocapture` 통과, 7z 실제 목록·추가·덮어쓰기·추출·암호·대용량 목록 포함
- 변경 검토: 기존 플랫폼 파일 식별 경계와 압축 가상 경로 계약 재사용, 추가 상태 소유자·우회 실행 경로·관련 없는 구조 정리 없음
- 최종 W0~W2 [CI 실행](https://github.com/setvect/BokslDirGUI/actions/runs/39077724386): Mac·Windows 성공, 프론트 각 328개·Rust Mac 97개/Windows 86개 통과, 각 1개 명시 제외
- 같은 실행의 Windows 압축 제한: `zip` 도구 부재에 따른 일부 테스트 조기 반환, W3에서 도구 배포와 실제 실행 검증 보완 필요

## 8. W3~W5 후속 구현

- 작업 범위: 압축 도구·외부 프로세스, Windows 앱 연동, OS 파일 클립보드·휴지통 복원
- 커밋 정책: 주요 구현 지점의 관련 테스트·전체 회귀·변경 검토 후 로컬 커밋, 사용자 지시에 따른 push 금지
- 압축 도구 선정: 공식 7-Zip 26.04 독립 실행 파일, Windows x64 `7za.exe`·macOS universal `7zz` 동봉
- 선정 근거: 기존 7z 프로세스·진행률·취소 경계 재사용, ZIP 암호와 7z 호환성 유지, 버전·SHA-256 고정으로 설치 환경 의존 축소
- Rust 압축 라이브러리 일괄 교체 대안: ZIP·7z 암호 호환성과 진행률 계약의 동시 변경 부담으로 미선정, TAR 계열의 별도 구현 검토 유지
- 도구 준비: `npm run archive:prepare`, 공식 배포본 해시 검사 후 실행 파일·원본 라이선스·원본 소스 위치 고지 동봉
- 배포 출처: [7-Zip 공식 다운로드](https://www.7-zip.org/download.html), [고정 버전 원본 소스](https://github.com/ip7z/7zip/releases/download/26.04/7z2604-src.tar.xz)
- 지원 대상: Windows x64·macOS arm64/x64, Windows ARM64의 잘못된 바이너리 자동 대체 금지
- 탐색 경계: 앱 리소스 절대 경로 우선, Windows 배포판의 현재 작업 폴더·PATH 의존 제거, 개발·테스트의 저장소 리소스 사용 허용
- 도구 동봉 검증: `npm run verify` 통과, 프론트 328개·도구 16개·Rust 97개 통과·1개 명시 제외, 스모크 261개 통과
- 실제 번들 검증: `npm run tauri:build -- --bundles app` 성공, 앱 내부 `archive-tools/7zz` 26.04 실행 및 라이선스·소스 안내·manifest 포함 확인
- 도구 경계 변경 검토: 기존 프로세스 취소·작업 상태 유지, 배포 리소스 위치만 공통화, Windows 도구 준비 스크립트의 네이티브 실행은 미검증
- Windows ZIP 경로: ZIP·JAR·WAR 목록·생성·추가·덮어쓰기·선택 추출을 동봉 7-Zip에 연결, 기존 macOS Info-ZIP 경로 유지
- 파일명 처리: `@`·옵션 형태·한글·선행 공백·대괄호 이름의 문자 그대로 선택, 7z 상대 경로 접두사에 따른 폴더 손실 방지
- 압축 안전성: Windows 예약 이름·ADS·절대 경로·상위 경로 거부, 7z 목록에서 심볼릭/하드 링크 사전 거부, 생성·해제 대상 경로의 쓰기 전 검증
- Windows 경로의 Mac 실행 검증: `BOKSLDIRGUI_TEST_WINDOWS_ARCHIVES=1 BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run rust:test` 통과, 101개 통과·실제 macOS 휴지통 1개 명시 제외
- 실행 범위: ZIP 암호·추가·덮어쓰기·취소·실패 시 원본 보존, ZIP/JAR/WAR/7z 특수 이름 선택 추출, 실제 링크 압축 파일의 경계 이탈 차단 포함
- 변경 검토: 테스트 전용 provider 주입을 제품 실행에서 제외, 공통 operation 상태·충돌 처리·게시 전 임시 파일 경로 유지
- TAR 계열 구현: `tar`·`tar.gz/tgz`·`tar.zst/tzst` 생성·목록·선택 해제의 외부 도구 의존 제거, 스트림 읽기 중 취소와 생성 처리량 갱신 연결
- 라이브러리 선택: [tar 0.4.46](https://docs.rs/tar/0.4.46/tar/)의 TAR 헤더·긴 이름 지원, 기존 `flate2` 의존성의 GZIP 스트림, [zstd 0.13.3](https://docs.rs/zstd/0.13.3/zstd/)의 Zstandard 스트림 사용
- 선택 근거: 독립 7-Zip의 Zstandard 생성 지원을 가정하지 않고 전용 코덱 사용, 시스템 `tar` 버전 차이와 별도 프로그램 설치 제거, 메모리에 압축 전체를 적재하지 않는 처리
- TAR 안전성: 전체 항목 사전 검사·링크/특수 항목 거부·추출 중 경로 재검사, 기존 임시 추출·충돌 처리·게시 경계 유지
- 검증 항목: 한글·선행 공백의 선택 추출, Mac 시스템 tar의 생성물 판독, 큰 단일 파일 내부의 생성·목록 취소, 손상 스트림·절대/상위 경로·심볼릭 링크 거부
- CI 보완: 필수 도구 검사와 `BOKSLDIRGUI_REQUIRE_PROVIDERS=1` 강제, Mac에서도 Windows ZIP 구현 경로 추가 실행, 변경 workflow의 원격 실행은 push 금지로 미실행
- 기존 Linux 빌드 경로 보존: 공식 x64/arm64 압축 실행 파일 준비 분기 추가, Linux 지원 완료 검증과 구분
- 남은 검증: Windows 네이티브의 압축 도구 준비·포맷별 실제 왕복, 앱 설치 후 도구 탐색과 취소 확인
- TAR 통합 검증: 필수 도구를 강제한 `npm run verify` 및 Windows ZIP 경로 Rust 회귀 통과, 프론트 328개·도구 16개·Rust 104개·스모크 261개 통과, 실제 macOS 휴지통 1개 명시 제외
- TAR 변경 검토: 스트림·코덱 모듈과 작업 상태 소유자의 분리, 중간 취소·코덱 종료 오류의 기존 요약/임시 파일 정리 경로 연결, 관련 없는 구조 정리 없음

### W4 파일 관리자·연결 앱·터미널

- 공통 명칭: `external.openCurrentInFileManager`·`open_current_in_file_manager`로 일반화, registry·wrapper·등록·번역·요구사항·생성 문서 동시 갱신
- Windows 파일 열기: Shell 항목 식별자와 `ShellExecuteExW` 사용, Explorer 위치 선택은 `SHOpenFolderAndSelectItems` 사용
- 연결 앱: `SHAssocEnumHandlers`의 등록 항목 열거·실행 전 재조회·`IAssocHandler.Invoke` 연결, 임의 실행 파일 경로 거부
- 기본 앱 표시: `AssocQueryStringW`의 현재 연결 정보 사용, 추천 여부와 기본 앱 여부 구분, 기본 연결 변경 없음
- DTO 변경: `OpenWithApp.id`·표시용 nullable `path`, 실행 입력 `applicationId`, 경로 없는 Windows 등록 앱 허용
- Windows 터미널: 시스템 디렉터리의 Windows PowerShell 우선, 미설치 시 Windows Terminal 별칭 사용, 둘 다 없으면 명시 오류
- 경로 인수: PowerShell의 UTF-16 인코딩과 단일 인용부호 이스케이프·`LiteralPath` 사용, PATH·현재 폴더의 임의 프로그램 대체 금지
- UI 정합성: 메뉴·컨텍스트 메뉴·도움말의 실제 기능 지원 정보 공유, Windows 앱 연동 3개 기능 활성화, 클립보드·휴지통 복원은 W5 구현 전 비활성 유지
- 실행 수명주기: 외부 command의 blocking worker 사용, Windows COM 객체의 전용 STA 생성·사용·해제 유지
- Mac 검증: 필수 압축 도구를 강제한 `npm run verify` 통과, 프론트 331개·도구 16개·Rust 105개·스모크 261개 통과, 실제 macOS 휴지통 1개 명시 제외
- Windows 컴파일: `cargo xwin check --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --tests --locked` 통과, Microsoft SDK·MSVC CRT 사용, Windows 실행 검증과 구분
- 추가 회귀: Mac·Windows 기능 정보에 따른 현재 패널 전달, Windows 등록 앱 식별자 실행 요청, 경로 없는 앱 표시, 터미널 한글·공백·따옴표·특수 문자 보존
- 변경 검토: 공통 액션·상태 소유권 유지, 불투명 앱 식별자의 OS 재조회 검증, COM 메모리 해제·늦은 UI 응답 무시 확인, 관련 없는 구조 정리 없음
- 남은 W4 구현: 직접 명령과 셸 입력 계약, 실행 진행·취소·자식 프로세스 종료 보완
- Windows 실기 확인: 실제 기본 앱·등록 앱 실행, Explorer 항목 선택, 터미널의 UNC·긴 경로 진입, 기본 연결 변경 후 재조회, UI 응답성 확인 필요
- 원격 CI: 사용자 push 금지에 따라 이번 변경의 GitHub Actions 실행 없음
- API 근거: [항목 위치 선택](https://learn.microsoft.com/en-us/windows/win32/api/shlobj_core/nf-shlobj_core-shopenfolderandselectitems), [Shell 실행 정보](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/ns-shellapi-shellexecuteinfow), [등록 앱 실행](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-iassochandler-invoke)

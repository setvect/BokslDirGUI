# Windows W0부터 W2까지 구현과 검증

- 기준일: 2026-10-17
- 작업 전 태그: `before-windows-w0-w2-20261017`, 기준 커밋 `4969651`
- 기본 검증 대상: Windows 11 x64 사용자 환경, CI 빌드 대상은 Windows Server 2022 x64 runner
- ARM64·다른 Windows 버전: 지원 판정 전 별도 실행 증거 필요, 현재 미검증
- W0~W2 후속 상태: `933d8ac`의 Mac·Windows CI 테스트와 앱·NSIS 빌드 통과, 실제 Windows 데스크톱 수동 검증 미실행
- 전체 계획: [Windows 지원 분석과 작업 계획](windows-support-plan.md)
- 1~9절: 각 구현 시점의 기록 유지, Windows VM 실행 결과는 10절 이후 참조
- 최신 설치본·파일 예외 검증: 22절 참조, 드래그 검증은 21절·사용자 지정 최종 3개 검증 결과는 23절 참조, 과거 미완료 기록과 후속 결과의 구분 유지

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

### W4 명령 입력·실행 확인

- 입력 계약: 작은/큰따옴표 묶기·빈 인수·인용 구간 결합 지원, Windows 역슬래시·UNC·끝 역슬래시 보존
- 잘못된 입력: 닫히지 않은 따옴표·빈 프로그램·NUL 거부, UI 검증과 실행 파서의 공통 계산 사용
- 셸 구분: 직접 실행에서 환경 변수·와일드카드·파이프·리다이렉션의 자동 해석 없음, Windows 배치 파일의 암묵적 셸 실행 거부
- 확인 정책: 기존 실행 버튼으로 확정한 입력에 단회 토큰 발급·소비, 추가 확인 다이얼로그 없음, 기본 비활성 설정 유지
- 토큰 계약: 누락·만료·재사용·변경된 인수 거부, 작업 폴더·프로그램·인수의 구분 가능한 JSON 직렬화로 fingerprint 생성, 프로그램의 임의 trim 제거
- 토큰 정리: 새 발급 시 만료·소비된 토큰 정리, 장시간 실행의 레지스트리 누적 축소
- 회귀 검증: 토큰 조회 실패·비활성 정책의 실행 중단, 비동기 조회 중 입력 변경에도 확정한 요청 유지, 따옴표·Windows 경로·셸 리터럴 입력 테스트 추가
- Mac 전체 검증: 필수 압축 도구를 강제한 `npm run verify` 통과, 프론트 342개·도구 16개·Rust 107개·스모크 261개 통과, 실제 macOS 휴지통 1개 명시 제외
- Windows 컴파일: MSVC 대상 제품 코드·테스트 `cargo xwin check --tests --locked` 통과, 실제 명령 실행 검증과 구분
- 변경 검토: 순수 파서의 UI·Tauri·store 의존 없음, 기존 실행 버튼과 작업 상태 소유권 유지, 명령 확정 시점의 요청 유지와 필수 토큰 검증 확인
- 남은 작업: 공통 장기 작업 상태의 명령 실행 연결, 출력 상한·진행·취소·시간 제한·자식 프로세스 트리 종료 구현

### W4 명령 진행·취소·출력 요약

- 실행 계약: `run_shell_command`의 `OperationStarted` 반환과 기존 operation 이벤트·store 연결, 작업 폴더·종료 코드·표준 출력·오류 출력을 `operation_summary.commandResult`에 보존
- 취소 경계: 실행 토큰 준비 중 취소 시 프로세스 생성 중단, 시작 이후 기존 작업 취소 경로로 자식 트리 종료, 부분 출력과 취소 상태 유지
- 실행 제한: 표준 입력 닫기, 최대 5분 실행, 표준 출력·오류 각각 16KiB 보존과 초과 알림, 상한 이후에도 파이프 읽기로 교착 방지
- 출력 해석: UTF-8·BOM이 있는 UTF-16 처리, Windows 비 UTF-8 출력의 OEM 코드 페이지 fallback, 모든 외부 프로그램의 인코딩 자동 판별 보장 없음
- 프로세스 경계: 압축 도구와 명령의 공통 capture 재사용, Unix 프로세스 그룹·Windows Job Object로 취소, 정상 완료 후 독립 백그라운드 작업과 앱 비정상 종료의 정리 보장 제외
- 라이브러리 선정: [Watchexec process-wrap 10.0.1](https://docs.rs/process-wrap/10.0.1/process_wrap/)의 플랫폼별 자식 트리 관리 사용, 직접 Job Object·프로세스 그룹 구현 중복 방지
- 빌드 기준: 새 라이브러리의 최소 Rust 1.87 요구를 반영하여 프로젝트 지원 기준을 기존 CI와 같은 Rust 1.93으로 통일
- 실제 프로세스 회귀: 양쪽 출력 2MiB 배출과 상한, 비정상 종료 코드, 시간 제한, 자식·부모 종료 후 자식 취소, 실행 전 취소 검증 통과
- UI 회귀: 공통 취소 버튼·토큰 준비 중 취소·취소 후 부분 출력·출력 초과 안내·요약 닫기 검증 통과
- Mac 전체 검증: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 345개·도구 16개·Rust 114개·스모크 261개 통과, 실제 macOS 휴지통 1개 명시 제외
- 전체 검증 후 추가한 공통 DTO fixture: 프론트 계약 테스트 4개와 Rust 명령 요약 직렬화 테스트 1개 통과, 일반 파일 작업 요약의 추가 필드 생략 확인
- Windows 컴파일: MSVC 대상 제품 코드·테스트 `cargo xwin check --tests --locked` 통과, Windows 런타임 검증과 구분
- 변경 검토: 기존 operation 상태 소유권 유지, reader·프로세스 등록 해제·취소·실패 요약 경계 확인, 별도 상태 컨테이너와 관련 없는 구조 변경 없음
- 남은 검증: Windows Job Object의 실제 자식 종료·명령 출력 인코딩·UI 응답성과 압축 취소 재확인, 사용자 push 금지에 따라 이번 원격 CI 미실행

### W5 Windows 파일 클립보드

- 네이티브 구현: `CF_HDROP`의 절대 파일 목록·`Preferred DropEffect`의 복사/이동 의도·`GetClipboardSequenceNumber` 변경 번호 사용, Windows 기능 지원 정보 활성화
- 메모리 경계: `GlobalSize` 상한 16MiB와 `DROPFILES` 오프셋·종료 문자·UTF-16 검사, ANSI 코드 페이지 변환, 링크 전용 의도의 복사/이동 오해석 거부
- 소유권: 별도 메시지 창으로 클립보드 소유권 확보, 성공한 메모리 블록만 OS에 이전, 잠금·창·실패 할당의 RAII 해제, 초기화하지 않은 할당 여유 공간의 외부 노출 방지
- 쓰기 검증: 전체 원본 존재와 두 형식의 할당 확인 후 교체, 실패한 형식 쌍의 노출 방지, 심볼릭 링크 자체 경로 보존
- 공통 계약: `NativeFileClipboard.intent`와 쓰기 입력 `intent` 추가, macOS 파일 URL 읽기의 복사 의도와 기존 Move Here 유지, Windows 잘라내기의 공통 이동 확인 연결
- 비동기 경계: OS 클립보드·원본 조회를 blocking worker에서 실행, 요청 대상 변경·더 최신 복사·컴포넌트 종료 후 응답 무시, 원본 조회 도중 클립보드 버전 변경 시 실행 중단
- 부분 완료: 이동 전 취소·실패 시 기존 목록 유지, 하나 이상 완료된 이동의 실패·취소 뒤 기존 변경 번호만 해제, 작업 중 새로 복사한 내용 유지
- 압축 경계: 가상 압축 항목의 내부 snapshot 유지, Explorer 클립보드 덮어쓰기 없음, 외부 변경 감지 유지
- 형식 회귀: 한글·이모지·공백·UNC·확장 경로·ANSI 왕복, 잘못된 오프셋·잘린 메모리·미종료 이름·고립 surrogate·잘못된 이동 형식 거부 통과
- UI 회귀: Explorer 이동 의도·Windows copy/cut 쓰기·조회 중 버전 변경·부분 완료 뒤 새 복사 보존·내부 압축 클립보드·미지원 플랫폼 fallback 통과
- Mac 전체 검증: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 353개·도구 16개·Rust 120개·스모크 261개 통과, 실제 macOS 휴지통 1개 명시 제외
- Windows 컴파일: MSVC 대상 제품·테스트 코드 `cargo xwin check --tests --locked` 통과, 실제 Windows 클립보드 실행과 구분
- 네이티브 테스트: `native_file_clipboard_round_trip_and_stale_clear`의 파일/폴더·copy/cut·소유 창 종료 후 읽기·오래된 해제·없는 원본 검증 추가, 일반 로컬 실행에서는 시스템 클립보드 보호를 위해 명시 제외
- CI 연결: 폐기 가능한 Windows runner에서 위 네이티브 테스트를 `--ignored --nocapture`로 별도 실행, 사용자 push 금지에 따른 원격 실행 미실행
- 변경 검토: 기존 파일 클립보드 hook·공통 액션·operation store 유지, OS 메모리 처리와 순수 형식 검증 분리, 관련 없는 재설계 없음
- Windows 실기 확인: Explorer 양방향 복사·잘라내기, 텍스트 복사로 선택 해제, 클립보드 점유·한글/긴/UNC 경로·부분 이동 후 재복사 확인 필요
- 다음 구현: W5 휴지통 삭제 결과 식별·Windows 복원 API·Ctrl+Z 연결
- API 근거: [Shell 클립보드 형식](https://learn.microsoft.com/en-us/windows/win32/shell/clipboard), [메모리 소유권 이전](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setclipboarddata), [변경 번호](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getclipboardsequencenumber)

### W5 Windows 휴지통 복원

- 삭제 영수증: Windows `IFileOperation`의 실제 `PostDeleteItem` 결과에서 Shell 항목 ID·휴지통 경로 수집, 원래 파일·부모 폴더의 볼륨/파일 ID·생성 시각과 함께 Rust 세션 이력에 보관
- 삭제 안전성: 휴지통 전용 플래그와 `PreDeleteItem`의 재활용 가능 플래그 검사, 영구 삭제 fallback 거부, 원본 교체·취소 재검사, 선택하지 않은 HTML 연결 리소스 동반 삭제 방지
- 복원 경계: 기록한 Shell 항목 ID로 `IFileOperation.MoveItem` 실행, `$Recycle.Bin` 내부 파일의 직접 rename과 메타데이터 잔류 방지
- 복원 안전성: 실행 직전 원본·부모 동일성·대상 존재 재검사, 덮어쓰기 플래그 거부와 충돌 이름 변경 플래그 적용
- 경합 복구: 검사 뒤 새 이름 충돌로 다른 보관 위치가 생성되면 그 실제 위치를 이력에 먼저 반영, 보관 경로 안내와 기존 원자적 no-replace 이동을 통한 재시도 유지
- 취소·상태: 공통 작업 레지스트리·진행·취소·요약과 최근 20개 세션 이력 유지, native callback 구독 해제와 COM STA 수명주기 관리, 늦은 취소 뒤 실제 완료 영수증 보존
- 경로 호환: Shell이 확장 경로 표기를 거부한 경우에만 일반 표기로 재시도, 변환 전후의 링크 자체 파일 ID 일치 검사로 다른 항목 대체 방지
- UI 연결: Windows `Ctrl+Z`와 메뉴·도움말 노출, backend 기능 지원 정보 공유, 기존 macOS `Cmd+Z`와 입력 필드의 자체 Undo 유지
- 의존성: COM callback 매크로가 직접 참조하는 `windows-core 0.61.2`를 기존 잠금 버전으로 명시, 새 바인딩 버전 추가 없음
- 공통 회귀: 파일/폴더/링크 복원·충돌 후 재시도·부모 교체·휴지통 항목 소실/교체·부분 취소·20개 이력·경합 보관 위치 재시도 통과
- Mac 전체 검증: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 354개·도구 16개·Rust 121개·스모크 261개 통과
- Mac 네이티브 검증: 명시 실행 `native_macos_trash_roundtrip -- --ignored` 통과, 테스트 임시 파일의 실제 휴지통 이동·복원 확인, 기존 사용자 파일·휴지통 항목 변경 없음
- Windows 컴파일: 제품·테스트 코드의 MSVC 대상 `cargo xwin check --tests --locked` 통과, Windows 실제 실행과 구분
- Windows 네이티브 테스트: 확장 경로의 한글 파일·폴더 왕복, 기존 대상 보존·재시도, 연결 HTML 리소스 보존, 테스트가 만든 휴지통 항목만 선택 제거 후 소실 오류 확인 추가
- Windows callback 테스트: 휴지통 플래그 없는 삭제·실행 전 취소를 OS 변경 전에 거부하는 회귀 추가, native 왕복 테스트는 일반 로컬 실행에서 명시 제외
- CI 연결: 임시 Windows runner에서 휴지통 왕복 테스트 별도 실행, 사용자 push 금지에 따른 이번 원격 CI 미실행
- 검증 중 수정: 병렬 TAR 테스트의 같은 시각 임시 폴더 충돌 재현, 시각·프로세스 ID에 원자적 순번 추가 후 전체 검증 통과
- 변경 검토: 영수증·이력의 기존 소유권과 command DTO 유지, Windows Shell callback 모듈에 OS 실행 책임 제한, 취소·부분 완료·복구 위치·COM 자원 해제 확인
- Windows 실기 잔여: 실제 Recycle Bin 왕복·휴지통 비움·부모 교체·큰 폴더 취소·UNC/외부 볼륨 미지원 오류·긴 경로 확인 필요, Mac 성공을 Windows 실행 증거로 대체 금지
- API 근거: [삭제 전 중단](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-predeleteitem), [삭제 결과의 휴지통 항목](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperationprogresssink-postdeleteitem), [Shell 작업 플래그](https://learn.microsoft.com/en-us/windows/win32/api/shobjidl_core/nf-shobjidl_core-ifileoperation-setoperationflags)
- W3~W5 통합 회귀: `BOKSLDIRGUI_TEST_WINDOWS_ARCHIVES=1 BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run rust:test` 통과, Windows ZIP 구현 경로를 Mac의 실제 동봉 도구로 실행하여 Rust 121개 통과·Mac 휴지통 1개 명시 제외 확인

## 9. W3~W5 완료 판정과 Windows 인계

- 대조 기준: [W3~W5 계획](windows-support-plan.md)의 구현 항목과 플랫폼별 완료 기준, 로컬 구현 커밋 `8f97bb1`~`ca34f30`
- 현재 판정: 주요 구현·Mac 회귀·Windows 대상 컴파일/링크 완료, Windows 네이티브 실행과 설치본 검증 미완료
- 지원 완료 판정 제한: 아래 미실행 항목을 Mac 테스트·Windows 실행 파일 생성으로 대체 금지

| 계획 범위 | 확보한 근거 | 아직 필요한 근거 |
| --- | --- | --- |
| W3 도구 선정·동봉·버전·탐색 | 고정 해시 준비 스크립트·라이선스 고지·Mac 앱 번들 검사 | 개발 도구 없는 Windows 설치본의 동봉 도구 실행 |
| W3 포맷·암호·선택 추출·추가 | 포맷별 실제 왕복·Mac의 Windows ZIP 경로 회귀 | Windows 실제 포맷별 왕복·긴 경로·암호 처리 |
| W3 경로 이탈·실패·취소 | 공통 안전성 회귀·손상/악성 항목 거부·임시 파일 및 원본 보존 테스트 | Windows 재파싱 지점·파일 잠금·Job Object 실제 취소 |
| W4 공통 액션·입력 계약 | 명칭/DTO 정합성·등록 앱 식별자·명령 파서·필수 확인 토큰 회귀 | Windows 기본 앱/등록 앱·Explorer·터미널 실제 결과 |
| W4 진행·출력·시간 제한 | 공통 작업 UI·실제 자식 프로세스·대량 출력·취소·시간 제한 테스트 | Windows 자식 트리 종료·OEM 출력·UNC/긴 경로 실행 |
| W5 파일 클립보드 | 공통 DTO·형식/메모리 검사·copy/cut 의도·버전/대상/부분 완료 회귀 | Explorer 양방향 파일 복사/이동·클립보드 점유·실제 native 왕복 |
| W5 휴지통 식별자·복원 | Shell ID/파일 ID 경계·실제 Mac 왕복·공통 충돌/부모 교체/부분 취소/복구 위치 회귀 | 일반 사용자 Windows Recycle Bin 왕복·네트워크/외부 볼륨 오류·실제 취소 |
| W5 Ctrl+Z·최근 20개 이력 | Windows 단축키/메뉴/도움말·입력 Undo·세션 이력 회귀 | Windows 실제 앱에서 삭제 후 확인·복원·재시도 |

### Windows 실행 파일 링크 검증

- 명령: `cargo xwin test --manifest-path src-tauri/Cargo.toml --target x86_64-pc-windows-msvc --locked --no-run`
- 결과: 라이브러리·앱 테스트의 PE32+ x86-64 실행 파일 링크 성공, Microsoft SDK·MSVC CRT 사용
- manifest 검사: 두 실행 파일의 실제 `RT_MANIFEST` 리소스에서 Common Controls v6 의존성 확인
- 경계: 실행 파일 생성과 manifest 검사만 완료, Windows 테스트 본문 실행 성공 주장 없음
- 현재 실행 환경: macOS, 연결된 Windows 실행 환경 없음, 사용자 push 금지에 따른 새 원격 CI 미실행

### Windows PC에서 수행할 검증

- 사전 조건: Windows x64·Node 24·Rust 1.93 이상 MSVC toolchain·C++ Build Tools·WebView2, 일반 사용자 실행
- 소스 전달: 현재 로컬 커밋의 소스 복사본 사용, Mac의 `node_modules`·Rust `target`·Mac용 압축 리소스 재사용 금지
- 아래 PowerShell 명령의 각 단계 성공 확인 후 다음 단계 진행, 최초 실패 출력 보존

```powershell
npm ci
npm run archive:prepare
npm run verify:providers
$env:BOKSLDIRGUI_REQUIRE_PROVIDERS = '1'
npm run verify
cargo test --manifest-path src-tauri/Cargo.toml --locked native_file_clipboard_round_trip_and_stale_clear -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --locked native_windows_trash_roundtrip_conflicts_and_missing_items -- --ignored --nocapture
npm run tauri:build -- --bundles nsis
```

- 클립보드 명시 테스트: 시스템 클립보드 내용 교체 포함, 보관할 클립보드가 없는 테스트 세션에서 실행 필수
- 휴지통 명시 테스트: 테스트가 만든 임시 항목만 이동·복원·선택 제거, 전체 휴지통 비우기 없음
- 설치본 실행: 일반 권한에서 압축 도구가 별도 설치되지 않은 환경의 포맷 왕복, 기본 앱/Explorer/터미널, Ctrl+C/X/V·Ctrl+Z 확인
- 파일 안전성 실기: 별도 테스트 파일만 사용하여 같은 이름·부모 교체·잠금·부분 취소·UNC·외부 볼륨 확인, 실제 사용자 파일 변경 제외
- 결과 기록: Windows 버전·소스 커밋·명령 종료 코드·최초 실패 로그·미실행 항목 구분 필수

## 10. 2026-10-18 Windows VM 설치본 검증

### 환경과 증거

- 호스트: Apple M4 Mac, VirtualBox 7.2.20·Guest Additions 7.2.20
- 게스트: Windows 11 Home ARM64, 빌드 `26300.9711`, 일반 사용자 실행
- 실행 대상: x64 앱의 Windows ARM 에뮬레이션, Intel/AMD x64 네이티브 검증 및 ARM64 전용 빌드와 구분
- 설치본 기준: `9461f8a077e021d40943c134d83f3b916fe03625`, [Mac·Windows 성공 CI](https://github.com/setvect/BokslDirGUI/actions/runs/39088071984)의 `desktop-windows-2022` 산출물
- 설치 파일: `BokslDir_0.1.0_x64-setup.exe`, SHA-256 `a680fd35a927c8b8d9a61ecac8b6df8d1949b6b644215f4372ec2c1c347093a4`
- 작업 전 스냅샷: `before-boksldirgui-test-20261018`, UUID `3ccde92c-b22e-410c-9dac-27ed30e89226`
- 테스트 범위: `C:\BokslDirGUI-Test\run-20261018-9461f8a`의 폐기 가능한 파일, OneDrive·사용자 실제 문서 변경 없음
- 환경 격리: Mac 공유 폴더·공유 클립보드 비활성 유지, 읽기 전용 ISO로 설치 파일과 테스트 도구 전달
- 검증 도구: VirtualBox 공식 CLI·SDK의 게스트 입력·스크린샷, 게스트 PowerShell의 파일 해시·테스트 종료 코드 수집
- 로컬 증거: `temp/verification/windows-vm-20261018/`의 환경·해시 JSON·스크린샷·로그, Git 추적 제외

### 설치본 실행 결과

| 항목 | 결과와 근거 |
| --- | --- |
| NSIS 설치·실행 | 개발 도구·별도 7-Zip 설치 없이 일반 사용자 설치·첫 실행 통과 |
| 기본 탐색 | 경로 입력·Tab 패널 전환·Enter 하위 폴더 진입·Backspace 상위 이동 통과 |
| 파일 복사 | 폴더 포함 네 파일 복사, 원본 유지 및 대상 SHA-256 전부 일치 |
| 이름 변경 | `alpha.txt` → `ALPHA.txt` 통과, 예약 이름 `CON` 거부 |
| 이름 충돌 | 대소문자 차이의 기존 파일 충돌 표시·취소 통과, 원본/대상 해시 유지 |
| 휴지통·복원 | 한글·공백 이름 파일 삭제 확인·목록 제거·Ctrl+Z 복원 확인·원본 해시 일치 |
| ZIP | 폴더·한글·공백·바이너리 파일 생성·목록 탐색·자동 해제 통과, 네 파일 해시 일치 |
| 7z | 폴더 압축 생성·자동 해제 통과, 하위 파일 해시 일치 |
| 탐색기 → 앱 | 탐색기에서 잘라내기·앱 붙여넣기의 대상 경로 확인·이동 실행 통과, 원본 제거와 대상 해시 일치 |
| 앱 → 탐색기 | 최초 설치본에서 실패 재현, 아래 수정본에서 영문·한글 파일 복사 및 바이너리 파일 잘라내기 재검증 통과 |
| 기본 앱 | 테스트 텍스트 파일의 메모장 실행과 내용 표시 통과 |
| 터미널 | 현재 테스트 폴더에서 PowerShell 실행·`pwd` 경로 확인 통과 |
| 재시작 | 정상 종료·재실행 후 양쪽 경로·왼쪽 두 탭 복원 확인 |
| 물리 키보드·IME·Mac 전환 | 사용자 직접 확인: Tab·방향키·Space, 이름 입력창 한글 입력·Esc 취소, 오른쪽 Command 해제 후 Finder의 Rectangle 단축키 모두 정상 |

### 클립보드 결함과 보완

- 재현: 앱의 Ctrl+C 후 탐색기 Ctrl+V 및 붙여넣기 버튼 모두 파일 생성 없음
- 관측: Windows `DragQueryFile`에서 `\\?\C:\...\left\alpha.txt` 확인, Windows Forms 파일 드롭 목록은 빈 목록
- 비교: 동일 파일을 일반 `C:\...` 경로로 전달하면 탐색기 붙여넣기 성공
- 수정 경계: Windows 파일 클립보드에 게시하는 경로만 Shell 호환 표기로 변환
- 안전성: 기존 `windows_shell`의 링크 자체 파일 ID 비교 재사용, 같은 항목으로 확인된 경우에만 접두사 변환
- 회귀: 끝 점 때문에 다른 파일을 가리키는 경로·존재하지 않는 경로의 원문 유지, 실제 클립보드 테스트의 canonical 경로 입력 추가
- 초기 재검증 빌드: 동적 CRT 로컬 테스트 실행 파일이 `0xC0000135`로 본문 실행 전 종료, 테스트 통과 집계에서 제외
- 수정본 빌드: Mac의 `cargo xwin`·Microsoft SDK, `-C target-feature=+crt-static` 및 `tauri/custom-protocol` 적용, VM 개발 도구·런타임 추가 설치 없음
- 수정본 분리: 설치 원본 보존, 테스트 루트의 `patched-app`에서 별도 debug 실행 파일 검증, 정식 NSIS 재빌드 통과 주장 없음
- 수정 앱 SHA-256: `e063a9dec2c8485f70b8f485235fa8bda21bf55d58252aa9966d5cddfbc54270`, 게스트 복사 후 동일 해시 확인
- Windows VM 테스트: 파일 ID 경로 회귀 1개·실제 클립보드 명시 회귀 1개·형식/계약 5개 통과, 세 실행의 종료 코드 모두 0
- 수정본 GUI: 앱 Ctrl+C → 탐색기 Ctrl+V의 영문·한글 파일 복사, 앱 Ctrl+X → 탐색기 Ctrl+V의 바이너리 파일 이동 성공
- 수정본 파일 상태: 탐색기 대상 세 파일의 SHA-256 원본 일치, 이동한 원본 경로 제거 확인
- Mac 회귀: `cargo test --manifest-path src-tauri/Cargo.toml --locked file_clipboard -- --nocapture` 6개 통과, 일반 클립보드 대신 테스트 전용 pasteboard 사용
- 추가 검사: `npm run build`의 TypeScript·프런트 빌드, `npm run docs:check`, `git diff --check` 통과
- 변경 검토: `change-review` 기준으로 Windows Shell/클립보드 경계·파일 ID 비교·입력 검증·clipboard 소유권 확인, 공통 operation 상태·Mac 구현 변경 없음
- 최초 VM 검증 종료 시점의 커밋·push·새 원격 CI: 미수행, 이후 로컬 커밋과 통합 검증은 아래 후속 기록 참조

### 아직 별도 확인이 필요한 범위

- 이번 사용자 확인 외의 Command/Option 조합·외부 키보드·다양한 IME 설정
- 실제 Intel/AMD Windows x64 PC, ARM64 전용 앱 빌드
- UNC 공유·다른 볼륨 이동·긴 경로·링크/재파싱 지점·잠긴 파일·권한 부족의 실제 GUI 실패 경로
- 대용량 작업 중 취소·전원 중단·외부 프로세스 트리 종료·외부 앱과 드래그 앤 드롭
- 압축 암호·나머지 포맷·손상 압축·압축 작업 취소의 설치본 GUI 검증
- 설치 제거·재설치·업데이트, 다양한 화면 배율·모니터 구성
- 작은 화면 관측: 1280×800 게스트에서 초기 1280×820 창 하단 일부 가림, 최대화 후 검증 수행, 화면 작업 영역에 맞춘 초기 크기 보완은 후속 항목
- 위 미검증 항목의 CI 자동 테스트 또는 이번 소규모 파일 왕복으로 대체 금지

## 11. Windows 패널 주소 표시 보완

- 재현: 주소 표시줄에 내부 canonical 접두사 `\\?\` 노출
- 변경 범위: 패널 주소 표시줄과 전체 경로 툴팁의 표시 전용 변환
- 표시 형식: `\\?\C:\...` → `C:\...`, `\\?\UNC\server\share\...` → `\\server\share\...`
- 보존 범위: 패널 상태·탐색 요청·파일 작업 경로 원문 유지, Mac 경로·알 수 없는 Windows namespace 표시 유지
- 자동 검증: `PanelHeader.test.tsx`·`CommanderShell.navigation.test.tsx` 30개 및 `npm run build` 통과
- VM 검증: 별도 `display-app` 검증용 빌드에서 `C:\Windows`·`C:\BokslDirGUI-Test\...` 표시와 기존 목록 복원 확인, 실제 UNC 공유 실행은 미검증 유지
- 수정 앱 SHA-256: `e091931d1756c3c075aec990c44434d6bb11c5daf74742b1c519464380c62ab5`, 게스트 복사 후 동일 해시 확인
- 변경 검토: 표시 전용 순수 함수와 기존 패널 상태의 경계 확인, 탐색 콜백·파일 작업·상태 소유권 변경 없음, 추가 구조 정리 불필요

## 12. W3~W5 구현 및 VM 보완의 통합 확인

- 대조 범위: 최초 W3~W5 계획, 8~9절의 구현 기록, 현재 압축 provider·프로세스·Shell·클립보드·휴지통 코드와 CI 구성
- 구현 판정: W3 압축 도구/코덱·취소, W4 앱 연동/명령 실행, W5 클립보드/휴지통 복원 구현 완료
- 후속 결함 수정: VM에서 재현한 탐색기 붙여넣기 결함의 로컬 커밋 `3764f40`, 패널 주소 표시 보완과 검증 기록의 별도 커밋
- 최종 Mac 검증: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 종료 코드 0, 프론트 358개·도구 16개·Rust 121개·스모크 261개 통과
- 명시 제외: 일반 회귀 실행의 실제 macOS 휴지통 테스트 1개, 위 과거 명시 실행 결과와 구분
- 검토 결과: 기존 `change-review` 기록과 최종 변경의 일치 확인, 공통 operation 상태·파일 동일성·OS 메모리 소유권 보존, 관련 없는 정리 없음
- 지원 완료 판정: 구현 완료와 전체 Windows 환경 검증의 구분 유지, 10절의 미검증 항목은 별도 후속 검증 대상
- 배포 상태: 이번 로컬 수정의 push·새 GitHub Actions 실행 없음, VM의 별도 검증용 앱 사용 유지, 수정된 정식 설치본 검증은 후속 작업
- 변경 검토: `change-review` 기준의 표시/실행 경계 확인, 상태 소유권·파일 작업 계약 변경 없음, 커밋·push 미수행

## 13. 2026-10-19 CI 및 잔여 Windows 검증 진행

- 기준 커밋: `d1e3226`, [Mac·Windows 전체 성공 CI](https://github.com/setvect/BokslDirGUI/actions/runs/39186552594)
- CI 결과: 양쪽 OS 테스트·Mac `.app`·Windows NSIS `.exe` 빌드 및 산출물 업로드 통과, Windows 클립보드·휴지통 명시 테스트 포함
- 이전 CI 실패: 임시 경로의 `RUNNER~1` 표기와 정규 경로 문자열 비교 오탐, 경로 개수·순서·절대 경로·파일 ID·접두사 제거 검사로 보완
- VM 작업 전 스냅샷: `before-windows-final-validation-20261019`, UUID `c04163e8-b5cf-45e6-98f1-49d9c16d3483`
- 테스트 루트: `C:\BokslDirGUI-Test\final-20261019`, 실제 사용자 문서 변경 없음
- 로컬 증거: `temp/verification/windows-final-20261019/`의 해시·창 좌표 JSON·화면, Git 추적 제외
- 최신 설치본 적용: 일반 사용자 NSIS 실행 종료 코드 0, 기존 탭·경로 유지와 일반 Windows 주소 표시 확인
- 설치 파일 SHA-256: `98832d6f4a59ce491f6390f93fd5a8525bf15183b066b6d9bf8fc42b4aa5713d`
- 설치 앱 SHA-256: `5978826f99e6268e28b18b7d1d3f13c542fa33791385d4fccf61117713a3cc5c`

### W6 드래그 검증과 발견 결함

- 내부 복사: 단일 파일·폴더와 한글 파일의 다중 선택 드래그 통과, 원본 유지·대상 해시 일치
- 내부 취소·이동: Escape 드래그 취소 시 대상 파일 생성 없음, Shift 드래그의 명시 이동 확인·원본 제거·해시 일치
- 외부 내보내기: 앱 → 탐색기 파일 드래그 복사·원본 유지·대상 해시 일치
- 외부 수신 결함: 탐색기 → 앱에서 가져오기 안내는 표시되지만 파일 작업 없음, 투명 드롭 창이 메인 창 뒤에 표시된 상태 확인
- 원인 비교: 동일 실행 파일의 드롭 창만 최상위로 올리면 오른쪽 패널 수신·해시 일치·드롭 후 창 숨김 성공
- 수정 경계: Windows에서 드롭 창을 표시할 때 최상위 설정, 기존 이벤트·대상 판정·공통 작업 실행·drop/leave 숨김 경로 유지
- 창 크기 보완: 초기·저장 크기를 모니터 작업 영역과 창 테두리·배율 기준으로 제한, 작업 영역 안의 위치 계산 적용
- 진행 상태: 수정본 네이티브 회귀·다양한 배율·설치 수명주기·파일 작업 예외 검증 진행 중, W6~W7 완료 판정 없음


### 창 크기·배율 보완과 추가 검증

- 추가 재현: Windows 1920×1080·150%에서 기존 최소 높이 680 논리 픽셀 때문에 상태·단축키 영역 잘림
- 변경 경계: Tauri 최소 창 크기·CSS 최소 크기·설정 유효성·창 저장 기준의 800×400 논리 픽셀 일치, 기본 창 크기 1280×820 유지
- 초기 크기: 작업 표시줄을 제외한 작업 영역에서 창 테두리 크기와 배율을 반영한 client 크기 계산
- 창 위치: 전체 창 크기를 기준으로 작업 영역 중앙 배치, 저장된 최대화 상태 유지
- 100%·1280×800: 전체 창 좌표 `(0, 0)–(1280, 752)`, 하단 상태·단축키와 작업 표시줄 겹침 없음
- 125%: 실제 창 DPI 120, 탐색기 → 오른쪽 패널 복사·대상 해시 일치·왼쪽 미생성·overlay 숨김 확인
- 150%: 실제 창 DPI 144, 1920×1080 작업 영역 높이 1008에서 초기 창 하단 1007·상태·단축키 표시 확인
- 150% 드롭: 탐색기 → 오른쪽 패널 복사·대상 해시 일치·왼쪽 미생성·overlay 숨김 확인
- 최대화·재시작·복원: 일반 창 852×635 유지, 최대화 저장 후 재실행과 일반 창 복원 확인
- 최소 크기: 800×400 논리 픽셀에서 패널 목록 스크롤·상태·단축키·이름 변경 입력창과 취소 버튼 표시 확인
- 최신 별도 검증 앱 SHA-256: `3ef61fbc41acaf355b2a86cd3e1e50a78f7efea82cd02d96a8c8dae071b064e7`
- 검증 경계: 최신 별도 앱의 NSIS 재패키징 미수행, 200%와 서로 다른 배율의 다중 모니터 검증 미완료

### 회귀 검사와 변경 검토

- 배율 보완 전 Windows VM Rust 전체 실행: 114개 통과·실패 0개·명시 제외 3개, 테스트 로그의 성공 요약 및 실행 종료 확인
- Windows 제외 항목 중 명시 실행: 실제 파일 클립보드·휴지통 테스트 2개 통과, 종료 코드 0
- Windows 남은 제외 항목: 심볼릭 링크 생성 권한을 요구하는 전용 테스트 1개, 권한 없는 일반 실행을 통과로 집계하지 않음
- 배율 보완 후 Mac 전체 검사: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 종료 코드 0, 프론트 358개·도구 16개·Rust 122개·스모크 261개 통과
- Mac 실행 조건: 샌드박스에서 소켓 생성·테스트 전용 pasteboard 접근 거부 5개 확인 후 정상 네이티브 권한 환경에서 재실행 통과, 제품 실패와 구분
- 배율 보완 후 Windows: `cargo xwin build` 성공 및 VM GUI 실행 확인, 수정된 설정 회귀의 Windows 테스트 실행은 후속 항목
- 변경 검토: `change-review` 기준의 창 상태 소유권·저장 하한·물리/논리 좌표·drop/leave 정리 검토, 공통 파일 작업 경로와 Mac 드롭 동작 유지
- 별도 정리: 관련 없는 상태 분리·전면 리팩토링 없음, 커밋·push·새 원격 CI 미수행

## 14. Windows 경로 표시의 전체 화면 적용

- 재현: 패널 주소는 일반 경로이나 파일 행 툴팁·이동 확인창 등에서 내부 `\\?\C:\...` 접두사 노출
- 공통 표시 함수: `src/domain/pathDisplay.ts`로 기존 주소 표시 규칙 이동, 알려진 드라이브·UNC 접두사만 표시용 변환
- 표시 범위: 파일·상태 툴팁, 복사/이동/삭제 등 작업 원본·대상, 충돌 비교, 진행 경로, 속성·미리보기, 압축·명령 결과의 위치, 연결 앱, 일괄 이름 변경 툴팁, 컨텍스트 메뉴, 위치·탭·히스토리·북마크·필터·암호창, 오류·상태 메시지의 구조화된 경로
- 경로 입력창: 초기 표시값만 일반 경로 사용, 편집 없이 제출할 경우 원래 내부 경로 유지, 사용자가 편집한 값은 입력 그대로 전달
- 축약 표시: Windows 드라이브 루트·UNC 공유 루트와 역슬래시 유지, Mac 표시 기존 동작 유지
- 안전성: 파일 작업·상태·DTO·선택 키의 원본 경로와 끝 점/공백 유지, 알 수 없는 namespace·파일 내용·명령 표준 출력 원문 보존
- 자동 회귀: `npm run typecheck`, `npm test`의 프론트 379개·도구 16개, `npm run build`, `npm run verify:scope`의 261개, `npm run docs:check`, `git diff --check` 통과
- 회귀 범위: 드라이브/UNC·한글·압축 가상 경로·알 수 없는 namespace, 툴팁·충돌·속성·진행·탭·입력창, 복사/이동 실행 시 원본 경로 전달 확인
- 스모크 실행 조건: 샌드박스의 로컬 소켓 접근 제한 후 정상 권한 환경에서 재실행 통과
- Windows 실행 파일: `cargo xwin build` 성공, SHA-256 `396874de976a68391c960666e72fa35b0fa530a74459a6070c21ac09be5c865e`
- VM 확인: 별도 `path-display-app`에서 `drag-in.txt` 파일 툴팁·이동창 원본/대상 표시 정상, 현재 화면의 경로 title/aria-label/code에서 확장 접두사 노출 없음
- VM 파일 안전성: 이동 확인창 취소, 실제 이동 실행 없음
- VM 증거: `temp/verification/windows-final-20261019/path-display-*` JSON·화면, Git 추적 제외
- 변경 검토: `change-review` 기준 표시 함수 의존성·원본 경로 보존·입력 제출 경계·실행 콜백 회귀 확인, 관련 없는 정리 없음
- 검증 경계: UNC 표시는 자동 테스트로 확인, 이번 VM의 실제 공유 서버 접근 검증 없음, 정식 NSIS 재패키징·커밋·push·새 CI 실행 없음

## 15. Windows 네이티브 드래그 복귀 검증

- 최초 결함: 파일을 앱 밖으로 끌었다가 되돌리면 파일 작업 없이 흰 수신 창 잔류
- 수정: 네이티브 드래그 전 수신 창 준비·종료 시 숨김, Windows 창 이벤트에서 메인 화면으로 직접 전달
- 중간 비교: 사전 표시·종료 정리만 적용하면 수신 창 잔류는 해소되나 보조 WebView 전달 지연으로 자체 세션 정보 소실·같은 패널에 외부 복사 요청 0개 완료 관측
- 최종 연결: `WebviewEvent` 비교에서 이벤트 미수신 확인 후 `WindowEvent::DragDrop` 연결, 실제 메인 화면의 drop 시 자체 세션 보존 확인
- 경로 판정: Windows가 돌려주는 일반 경로와 목록의 확장 경로를 백엔드 메타데이터의 정규 경로로 비교, 기존 원본과 복사/이동 의도 유지
- 비동기 안전성: 메타데이터 대기 중 중복 drop 차단, unmount·진행 중 작업·대상 변경 재검사
- 최종 VM 앱 SHA-256: `6a6f3c689d28e14ae42f4e4176e1d4f20d8393b3c495b9e093705614409c1d03`, 별도 `return-app` 실행
- 같은 패널 복귀: 취소 상태 표시·다른 패널 미생성·원본 해시 유지·수신 창 숨김 확인
- 반복 출입 복사: 창 안팎 두 차례 출입 후 반대 패널 복사 1개 완료·원본/대상 해시 일치·수신 창 숨김 확인
- Explorer 외부 수신: `drag-in.txt`를 왼쪽 패널로 가져오기·원본/대상 해시 일치·수신 창 숨김 확인
- 증거: `temp/verification/windows-final-20261019/native-return-v4-*.json`, Git 추적 제외
- 자동 회귀: Mac `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 388개·도구 16개·Rust 123개·명시 제외 1개·스모크 261개
- Windows 코드 연결 변경: Mac 검증 후 Windows 전용 이벤트 연결 위치 보정, Windows 재빌드·위 VM 동작 확인
- 좌표 단위 검증: 100%·125%·150%·200% 변환과 경로 공백 보존 테스트 통과, 200% 실제 GUI 검증과 구분
- 변경 검토: `change-review` 기준 공통 액션/operation 상태 유지·창 수명·경로 동일성·응답 세대 검사·이중 이벤트 전달 방지 확인
- 미해결 실제 이동: Shift 인계 후 반복 복귀에서 enter/leave만 수신하고 drop 누락, 원본 유지·대상 미생성 확인
- 이동 원인 근거: 현재 `drag 2.1.1`의 Move는 `DROPEFFECT_MOVE`만 허용, `wry 0.55.1`의 Windows 수신은 `DROPEFFECT_COPY` 고정, 지원 효과 불일치 확인
- 이동 회귀 경계: 합성 drop 입력에서 이동 확인·기존 원본 경로 전달은 통과, 실제 Windows Shift 네이티브 복귀 완료 판정 없음
- 취소 잔여: Escape 입력 비교에서 종료 상태가 Dropped로 남은 실행 확인, 실제 입력 전달·취소 재검증 필요
- 남은 범위: 이동 효과 협상 보완, 실제 네이티브 취소·배율·설치 수명주기·파일 예외 검증, 최신 Windows 테스트 실행 및 정식 설치본 검증
- 배포 상태: 커밋·push·새 CI 실행 없음, Windows 포팅 전체 완료 판정 없음


## 16. 네이티브 이동 협상·취소·목록 갱신 검증

- 기존 의존성 `drag 2.1.1`의 Windows 소스 한 곳만 로컬 패치, 버전 변경 없음
- 수정: Move의 허용 효과를 MOVE | COPY로 확장, 자체 복귀의 이동 의도·명시 확인·공통 작업 실행 유지
- 원본·패치·라이선스: `src-tauri/vendor/drag/PATCH.md`와 동봉 MIT/Apache-2.0, 번들 리소스의 라이선스·변경 고지 매핑 추가
- 제외한 중간 수정: 최종 효과 NONE을 취소로 판정하면 실제 Explorer 이동 완료를 취소로 오판, 원본 종료 판정 복원
- Shift 반복 복귀: 이동 확인창과 정상 경로 표시, 확인 후 원본 제거·대상 해시 일치 확인
- 최종 협상 패치 앱: SHA-256 `563e17b84015e0798b7c798c7829fb4e3e0e8d3e68b2504c6810afdd96f563ec`
- 위 앱의 Explorer 이동: 원본 제거·대상 해시 일치·외부 드래그 완료 표시·수신 창 숨김 확인
- 위 앱의 Explorer 복사: 원본 유지·대상 해시 일치·Dropped 상태·수신 창 숨김 확인
- 위 앱의 Escape: 키 누름 유지 후 해제 방식으로 Cancel 상태·원본 유지·대상 미생성·수신 창 숨김 확인, 과거 짧은 입력 실패와 구분
- 위 앱의 반복 복귀 취소: Shift 이동 확인창 취소 후 원본 유지·대상 미생성·수신 창 숨김 확인
- 추가 재현: 외부 이동 성공 후 앱 원본 목록에 사라진 파일 행 잔류
- 목록 수정: 외부 이동 완료 시 원본 폴더를 표시하는 패널만 기존 background refresh 경로로 갱신, 자체 복귀 작업·취소·복사와 구분
- 수명 보완: unmount 시 네이티브 소스 참조 해제, 늦은 종료 콜백의 갱신 방지
- 목록 수정 VM 앱: SHA-256 `47078c6ce4346e4e1b4b2c71b330dd37e9ed632b3410b3f06323e90abb910849`
- 목록 수정 VM 결과: 원본 제거·대상 해시 일치·원본 행 자동 제거·완료 상태·수신 창 숨김 확인
- 미수락 위치 관측: 창 제목 표시줄에 놓으면 원본 유지·수신 창 숨김이나 종료 콜백은 Dropped, 실제 파일 전달 성공과 구분 필요
- 증거 위치: `temp/verification/windows-final-20261019/native-effects-*`, `native-final-*`, `native-refresh-result.json`, Git 추적 제외

### 회귀 검증과 후속 범위

- Mac 전체 검증: 협상 패치·라이선스 설정 후 `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 388개·도구 16개·Rust 123개·명시 제외 1개·스모크 261개
- 목록 갱신 후 추가 검증: `npm test` 프론트 392개·도구 16개, 타입·프론트 빌드·Windows 교차 빌드·스모크 261개·문서 정합성·diff 검사 통과
- Windows 최신 Rust: 테스트 바이너리 SHA-256 `e2cd82cb3778db0d08dde9b81023931d10f93918ced7e342bbf88793acd60c77`, 필수 provider 활성 상태에서 115개 통과·3개 제외
- Windows 명시 실행: 클립보드·휴지통 2개 통과, 각각 종료 코드 0
- Windows 심볼릭 링크 명시 실행: fixture 생성에서 권한 오류 1314·종료 코드 101, 지원 검증 통과로 집계 금지
- 변경 검토: `change-review` 기준 원본 의존성과 한 파일 차이 확인, 공통 작업 상태·Mac/Linux 구현 유지, 기존 목록 상태 소유자의 갱신 경로 재사용
- 링크 후속: 네이티브 드래그 의존성의 `dunce::canonicalize`가 링크 대상을 해석하는 경계 검토·실기 검증 필요
- 배포 후속: 최신 NSIS 재패키징과 설치·업데이트·제거, 200%·다중 모니터·볼륨/UNC 예외 검증 미완료
- Mac NSIS 준비 시도: 교차 번들 진입 확인, 샌드박스 DNS 제한으로 도구 다운로드 미완료, Windows 압축 리소스를 포함한 정식 패키지 성공 근거 없음
- 배포 상태: 커밋·push·새 CI 실행 없음, Windows 전체 지원 완료 판정 없음


## 17. 링크 항목 보존과 네이티브 인계 사전 검증

- VM 재현: junction 항목의 외부 드래그에서 링크 이름 대신 연결 대상 폴더 복사, 의존성의 leaf canonicalize 원인 확인
- 공통 경로 처리: 기존 파일 작업의 부모만 정규화하는 함수를 navigation 계층으로 이동, 파일 작업 동작 유지
- 메타데이터: 선택한 심볼릭 링크·끊어진 링크·junction 항목의 이름·경로 유지, 연결 대상의 디렉터리 통계 계산 제외
- Windows 인계: `prepare_native_file_drag`에서 전체 원본 검증 후 overlay·Shell 실행, 미지원 재파싱 지점 차단·Shell 호환 경로의 항목 동일성 검사
- 의존성 패치: Windows Shell 전달 전 leaf 링크 추적 제거, 항목 생성 실패의 panic 대신 오류 반환
- 오류 처리: 구조화된 검증 오류의 번역 표시, 해당 오류 후 다음 정상 네이티브 드래그 허용
- VM 수정 결과: junction 인계 거부·연결 대상 해시 유지·overlay 숨김, 이어진 일반 파일 외부 복사와 해시 일치 확인
- Mac 전체 검증: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 394개·도구 16개·Rust 124개·명시 제외 1개·스모크 261개
- Windows 최신 Rust: 일반 실행 115개 통과·명시 제외 3개, 클립보드·휴지통 명시 실행 2개 통과
- Windows 심볼릭 링크: 사용자 UAC 승인 후 전용 테스트 1개 통과·종료 코드 0, 일반 권한의 과거 실패 기록과 구분
- 권한 경계: 앱은 일반 사용자 실행 유지, 개발자 모드 변경 없음, 관리자 테스트는 전용 임시 fixture 대상
- 검증 경계: 지원 심볼릭 링크의 메타데이터·인계 준비·복사/삭제 회귀 통과, 실제 Explorer 드롭의 링크 종류별 결과는 별도 검증 필요
- 증거: `native-link-*.json`, `rust-link-summary.json`, `symlink-admin-result.json`, Git 추적 제외

## 18. 최신 Windows 설치본과 설치 수명주기 검증

- 패키지: Windows x64 release 교차 빌드·NSIS 생성 성공, Windows용 7za·manifest·라이선스 동봉 확인
- 패키지 검사: provider 고정 해시 일치, drag MIT/Apache-2.0 라이선스·패치 고지의 원본과 번들 일치
- 기준 설치 파일 SHA-256: `ab3e700061ee5f6c413929a8ecdca145b7cdcf0aab4bed28df275dee8e94be0f`
- 기준 실행 파일 SHA-256: `3f3b6956689886973ed85149f81aadbc14a25a4157b10f3322ff2a7f968a8666`
- 기존 설치 덮어쓰기: 최신 실행 파일·동봉 도구 확인, 설정 파일 해시 유지·좌우 패널 복원 확인
- 기본 제거: 종료 코드 0·실행 파일 제거·설정 보존, 설치 폴더의 사용자 추가 파일과 외부 테스트 데이터 보존 확인
- 한글·공백 설치 경로: `C:\BokslDirGUI-Test\final-20261019\한글 설치 경로\BokslDir` 설치 종료 코드 0·앱 실행·설정 복원 확인
- 사용자 지정 경로의 리소스: 설치본의 암호화 7z 목록에서 한글 파일 확인, 설치 위치 기준 provider 탐색 성공
- 기본 위치 복원: 사용자 지정 설치 제거·기본 위치 재설치 각각 종료 코드 0, 설정 보존·일반 사용자 실행 확인
- 설치본 압축: zip/jar/war/tar/tar.gz/tgz/tar.zst/tzst/7z 9종 생성·목록·추출 완료, 추출된 한글 파일과 원본의 해시 일치
- 암호 검증: ZIP·7z의 테스트용 암호 설정·암호화 표시·추출 확인
- 압축 실행 경계: 실제 설치 앱의 Tauri 명령과 완료 이벤트 확인, 모든 GUI 버튼 흐름 검증과 구분
- 실행 환경: Windows 11 ARM VM에서 x64 설치본 실행, Intel/AMD PC 네이티브 검증과 구분
- 빌드 자원: 임시 Windows 압축 리소스로 패키징 후 Mac 개발용 리소스 복원 확인
- 배포 경계: 코드 서명 없음, 커밋·push·새 CI 실행 없음
- 발견 후속: 기본 NSIS의 앱 데이터 삭제 옵션과 실제 설정 경로 불일치, 선택 삭제 hook 보완·실제 제거 검증 필요
- 증거: `latest-installer-package.json`, `latest-install-result.json`, `installed-archive-roundtrip.json`, `install-uninstall-custom-path.json`, `install-custom-runtime.json`, `install-default-restored.json`, Git 추적 제외


## 19. 설치 제거의 선택적 설정 삭제 보완

- 실제 재현: 기존 설치본에서 `Delete the application data` 선택 후 앱·WebView 데이터 제거, `%APPDATA%\BokslDirGUI\settings.json` 잔류 확인
- 원인: 기본 NSIS의 bundle identifier 경로 정리와 settings_service의 설정 저장 위치 불일치
- 수정: `src-tauri/windows/installer-hooks.nsh`의 제거 후 hook 연결, 명시 삭제 선택·업데이트 아님 조건에서만 설정·임시 저장 파일 제거
- 보존 경계: 해당 설정 폴더의 재귀 삭제 금지, 무관 파일·사용자 지정 `BOKSLDIRGUI_SETTINGS_PATH` 위치 유지
- 실제 선택 삭제: 수정 설치본의 제거 화면에서 옵션 선택, 설정·임시 파일 제거 및 같은 폴더의 무관 fixture 파일 보존 확인
- 기본 제거 회귀: 수정본 설치·기본 제거 종료 코드 각각 0, 설정 해시·무관 파일 유지 확인
- 수정 패키지 SHA-256: `affc9c8d423fee6efcc0b0623be191dfc3ccc8579418002cfb135288c7342cbf`
- 수정 패키지 내부 실행 파일 SHA-256: `3c09c68f0d8a853ce45162c7812c727c8e5a78b1976bc8c662c8636fc0d37259`, VM 설치 파일과 일치
- 빌드 검증: Windows release 교차 빌드·NSIS 패키징 통과, 생성된 installer의 hook 포함 확인
- 증거: `uninstall-data-before.json`, `uninstall-hook-upgrade.json`, `uninstall-data-fixed.json`, `uninstall-hook-preserve.json`, Git 추적 제외
- 변경 검토: `change-review` 기준 설정 경로 계약·옵트인 삭제·업데이트 제외·비재귀 삭제·원본 경로 유지 확인, 추가 구조 정리 없음

- 환경 복원: 최신 수정 설치본 재설치 종료 코드 0·백업 설정 해시 일치·WebView 데이터 복원·테스트용 무관 파일 정리 확인
- Mac 보완 검증: `npm run check` 통과, `git diff --check` 통과

## 20. 200% 배율과 투명 수신 창 입력 경계

- 환경: Windows 1920×1200·200%, 실제 창 DPI 192·WebView devicePixelRatio 2 확인
- 창 맞춤: 재실행한 일반 창 `(1, 0)–(1919, 1103)`, 작업 영역 하단 1104 안의 상태·단축키 표시 확인
- 최초 설치본 드롭: HTML dragover/drop 수신·네이티브 drop 미수신·대상 미생성·수신 창 잔류 확인, 통과 판정 없음
- 비교 실험: 수신 창의 완전 투명 배경을 alpha 0.01로만 변경, 같은 200% 드롭에서 native enter/drop·오른쪽 복사 완료 확인
- 비교 파일 안전성: 원본/대상 해시 일치·왼쪽 미생성·수신 창 숨김 확인
- 중간 수정: Windows 수신 창 초기화에서 alpha 0.01 적용, Mac 배경과 이벤트 전달 경로 유지
- 회귀 검증: 드래그·클라이언트·배율 관련 테스트 40개, 프론트 타입/빌드·Windows release 빌드·NSIS 패키징 통과
- 패키지 검사: Windows 압축 provider 해시·동봉 drag 라이선스/고지 일치 확인
- 수정 설치 파일 SHA-256: `0a9f69e2f086bc25fa162184327d8bad35c403c88825ac3408ac5f11d5f1e8bf`
- 수정 설치 파일 내부 앱 SHA-256: `55202daa6066db8bbc90f72c42b38915903231062750e816a0c9fc78b8908101`
- 비교 증거: `dpi200-before.json`, `dpi200-fit.json`, `dpi200-diagnostic.json`, `dpi200-alpha-probe.json`, `dpi200-alpha-hash.json`, Git 추적 제외

- 중간 수정 재검증: 새 설치본의 첫 드롭·20초 유지·이미 표시된 수신 창에서도 대상 미생성 확인, alpha만의 원인 확정 철회·제품 배경 수정 제거
- 관측 경계: Windows 창 조회에서 수신 창은 가시·hit 대상이나 native 이벤트 미수신, Wry 보조 창 전달 경로의 불안정성 확인

## 21. Windows 주 창 직접 수신 보완

- 변경: Windows에서 주 창의 `drag_drop_enabled` 활성화·보조 수신 창 생성 제외, Mac 시작 설정 유지
- 이벤트: 주 창의 native drop을 기존 공통 이벤트로 전달, HTML dragover 이후 별도 창을 표시하는 Windows 경로 제거
- 정리: 보조 창의 Windows 세션 플래그·사전 표시/종료 숨김·불필요한 내부 hide 명령 제거
- 상태 소유권: 기존 포인터 세션·공통 액션·operation store·확인/취소 경로 유지
- 최초 비교 실행: 200% 첫 Explorer 드롭의 오른쪽 파일 생성·원본/대상 해시 일치·왼쪽 미생성 확인
- Mac 전체 회귀: `BOKSLDIRGUI_REQUIRE_PROVIDERS=1 npm run verify` 통과, 프론트 394개·도구 16개·Rust 125개·명시 제외 1개·스모크 261개
- 회귀 추가: Windows 시작 설정이 주 창 수신만 활성화하고 보조 창 생성을 끄며 무관 창 설정을 유지하는 검사
- Windows 빌드 보완: 정리 중 누락한 `Manager` trait import의 컴파일 오류 확인 후 복원, Mac 통과만으로 Windows 통과 판정 금지

- 최종 Windows release 빌드·NSIS 생성 통과, 설치 종료 코드 0·기존 설정 해시 유지 확인
- 최종 설치 파일 SHA-256: `097b1fe4d918ebe0c87b2dbfe911850beada583ef9636e786b8fb0e0c3c8408e`
- 최종 패키지 내부 앱 SHA-256: `a892567aee77c82f8ee2f23d1945352bb51593622c61a4bdbcb1199bb88ffa39`, VM 설치 파일과 일치
- 동봉 검사: Windows provider 고정 해시·drag 라이선스/패치 고지 일치, Mac 리소스 복원 확인
- 최종 Windows Rust 실행: 116개 통과·실패 0개·명시 제외 3개, 필수 provider 활성·종료 코드 0
- 제외 테스트 경계: 링크·클립보드·휴지통의 앞선 명시 실행 근거 유지, 이번 직접 수신 변경 후 관리자 링크 테스트 재실행 없음
- 최종 설치본 내부 드래그: 200%에서 좌우 패널 복사·원본/대상 해시 일치·보조 창 0개 확인
- 최종 설치본 Shift 복귀: 200%에서 창 안팎 2차례 출입·이동 확인창 표시·명시 실행·원본 제거·대상 해시 일치 확인
- Escape 자동 입력: 원본 유지·오른쪽/바탕화면 미생성이나 완료 문구 표시, 취소 통과로 집계 금지·실제 키 입력 추가 확인 필요
- 최종 설치본 외부 수신: 100% 복원 후 첫 Explorer 드롭의 오른쪽 생성·원본/대상 해시 일치·왼쪽 미생성·보조 창 0개 확인
- 환경 복원: 100%·DPI 96, 테스트 진단 저장값 제거·디버깅 옵션 없는 설치 앱 재실행·탐색기 최상위 해제
- 변경 검토: `change-review` 기준 Windows 시작 설정·Mac 보존·공통 작업 상태·비동기 중복 방지·링크 항목 보존·선택 삭제 경계 확인
- 구조 정리: 검증으로 불안정성이 확인된 Windows 보조 수신 창·세션 플래그·미사용 명령 제거, 관련 없는 정리 없음
- 배포 경계: 커밋·push·새 CI 실행 없음, Windows 전체 지원 완료 판정 없음
- 증거: `direct-installer-package.json`, `direct-installer-upgrade.json`, `direct-internal-copy.json`, `direct-return-before.json`, `direct-return-after.json`, `direct-escape.json`, `direct-final100-drop.json`, Git 추적 제외

- 사용자 실제 키 검증: `direct-cancel.txt`를 창 밖으로 끈 상태에서 Esc를 누른 뒤 버튼 해제, ‘외부 드래그 취소’ 표시 확인
- Escape 판정: 최종 설치본의 사용자 실제 입력 통과, 앞선 자동 입력의 불확실한 완료 표시와 구분

### 현재 남은 지원 검증

- 서로 다른 배율의 다중 모니터·외부 키보드·추가 IME·고대비 환경 검증
- 실제 UNC 공유·다른 볼륨의 설치본 파일 작업 검증 미완료, 긴 경로·잠금·쓰기 거부 결과는 22절·대용량 복사 취소 결과는 23절 참조
- 등록 앱 선택과 손상 압축·압축 추가/선택 추출/취소의 설치본 GUI 검증 완료, 23절 참조·OEM 출력과 프로세스 트리 취소 결과는 22절 참조
- WebView2 미설치 환경의 bootstrapper 설치·공개 배포 시 코드 서명 정책 확정
- 실제 Intel/AMD Windows x64 PC와 별도 ARM64 전용 빌드 검증, 현재 ARM VM의 x64 에뮬레이션 결과와 구분
- 최신 변경의 커밋·push·Mac/Windows 원격 CI는 사용자 명시 요청 전 미수행

## 22. 긴 경로·파일 예외·명령 실행의 설치본 검증

- 테스트 경계: `C:\BokslDirGUI-Test\final-20261019\path-edge` 전용 fixture, 사용자 파일 변경 없음
- 긴 경로: 한글 파일명을 포함한 357자 경로에서 일반·확장 표기의 목록 결과 동일, 메타데이터·복사·이름 변경 성공 확인
- 파일 무결성: 원본과 이름 변경된 복사본 SHA-256 일치, `8204627a7af7cd26968ff9b39c8e2f73ddbff44d8ccfba4a17c7fe67ff81c639`
- 긴 경로 GUI: 경로 이동 대화상자로 실제 목록 진입, 주소·파일 툴팁에서 `\\?\` 접두사 없는 일반 경로 확인
- 파일 잠금: 삭제 공유 권한 없는 실제 핸들 유지 중 이름 변경·이동·영구 삭제의 `file_in_use`·OS 코드 32 확인
- 잠금 안전성: 원본 유지·변경 이름/이동 대상 미생성, 이름 변경 GUI에서 한국어 사용 중 안내·정상 경로 표시 확인
- 쓰기 거부: 테스트 대상 폴더에만 임시 ACL 적용, 복사의 `permission_denied`·GUI 원인 안내·원본 유지·대상 미생성 확인
- 권한 복원: 잠금 핸들 해제·ACL SDDL 원상 복구 확인, 앱 관리자 실행 없음
- 명령 출력: 실제 OEM 코드 페이지 949의 `한글 OEM 출력`, 일반 작업 경로의 `한글 UTF-8 출력`과 작업 위치 확인
- 자식 취소: 테스트 부모·자식 PID의 실제 실행 확인 후 앱 취소 명령 호출, `cancelled` 요약·두 PID 모두 종료 확인
- 명령 검증 경계: 설치 앱의 실제 Tauri 명령·작업 이벤트 사용, 모든 명령 입력 GUI 조합의 통과 판정과 구분
- 초기 자식 검증: 자식 준비 전 취소 및 진단 연결 10초 제한 확인, 종료 상태 확인 후 별도 실행에서 두 프로세스 생성·종료 검증 완료
- 설정 안전성: 명령 실행 기본 비활성 값을 성공·실패 모두 복원, 설정 파일에서도 `enabled: false` 확인

### 긴 작업 경로의 오류 안내 수정

- 재현: 260자 초과 작업 위치에서 프로그램 시작 시 일반 `io_error`·`NotADirectory` 표시 확인
- OS 경계: 파일 API의 긴 경로 지원과 `CreateProcessW`의 작업 디렉터리 제한 구분, [Microsoft 현재 디렉터리 문서](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-setcurrentdirectory) 근거
- 수정: 공통 프로세스 생성 실패 경계에서 Windows 오류 87/267·UTF-16 작업 경로 260자 이상 조건의 전용 오류 변환
- 사용자 안내: `working_directory_too_long`·한국어/영어 원인·폴더 경로 축소 후 재시도 안내 추가
- 동작 보존: 실행 위치의 임의 대체·임시 드라이브 연결 없음, 다른 오류·Mac 처리·공통 작업 취소 경로 유지
- 회귀: UTF-16 길이·두 OS 코드·권한 오류 보존·짧은 경로/작업 위치 미지정 구분 검사 추가
- 실제 수정본: 설치 앱에서 OS 코드 267·전용 오류·일반 경로·한국어 안내·줄바꿈과 닫기 버튼 표시 확인
- 지원 경계: 긴 경로 파일 조회/복사/이름 변경 통과, 긴 작업 디렉터리의 외부 명령 실행 성공으로 집계 금지

### 최신 빌드·검증·복원

- Mac: 타입 검사·프론트 빌드·관련 UI 30개·프로세스 회귀 5개·스모크 261개·문서 정합성·`git diff --check` 통과
- Windows: 제품 release·테스트 실행 파일 교차 빌드·NSIS 생성 성공, 필수 압축 provider 사용 재검증 117개 통과·실패 0개·명시 제외 3개
- 첫 Windows 실행: 테스트 도구 환경 변수 이름 오류로 provider 미탐색·96개 통과/21개 실패 확인, 종료 후 올바른 `BOKSLDIRGUI_TEST_7ZIP`으로 재실행 통과
- 제외 테스트 경계: 관리자 링크·클립보드·휴지통은 앞선 명시 실행 근거 유지, 이번 오류 안내 변경 후 명시 재실행 없음
- 최신 설치 파일 SHA-256: `a8dfa30c7228c868f797ae0776bf981e3b2ded649c5e2d3fff11e3685f70a77a`
- 최신 패키지 내부 앱 SHA-256: `cb66f3ad30b2263e88761c6b2b9547243f16fd21faaea7e63eb57d38c319926e`, VM 설치본과 일치
- 패키지: 압축 provider 고정 해시·drag 라이선스/패치 고지 일치, Mac 리소스 복원 확인
- 설치: 종료 코드 0·기존 설정 해시 보존 확인, 좌우 테스트 폴더 복원·진단 옵션 없는 일반 앱 재실행
- 변경 검토: `change-review` 기준 Windows 한정 오류 분기·Mac 오류 보존·실제 작업 위치·기존 상태 소유권 확인, 추가 구조 정리 없음
- 배포 경계: 커밋·push·새 원격 CI 실행 없음, 전체 Windows 지원 완료 판정 없음
- 증거: `longpath-*.json`, `locked-*.json`, `permission-copy.json`, `shell-output.json`, `shell-tree-*.json`, `edge-*.json`, `longpath-shell-fixed.png`, Git 추적 제외

## 23. 사용자 지정 최종 검증 범위

- 종료 범위: 2026-10-19 사용자 지시에 따라 압축 실패/취소·대용량 복사 취소·연결 앱 선택 실행의 3개 묶음으로 한정
- 범위 확장 금지: 별도 환경이 필요한 검증은 미검증 유지, 이번 마무리에서 새 테스트 종류 추가 없음
- 기존 압축 GUI 결과: ZIP 생성 2개 완료·선택한 한글 파일 1개만 추출·파일 추가 후 기존 2개와 추가 1개 해시 일치 확인
- 손상 ZIP 열기: 오류 안내·기존 폴더 유지 확인
- 손상 ZIP 추출: `failed`·실패 1개·원본 유지·대상 폴더 비어 있음 확인
- VM 중단: 15:23:42 KST VirtualBox `aborted` 확인, 원인 미확정·앱 결함으로 단정 금지
- 중단 경계: 손상 압축 결과 확보 후 압축 취소 준비 요청의 완료 근거 없음, 취소 검증 통과 판정 금지
- 복구: 스냅샷 복원 없이 기존 디스크 재시작, 미완료 요청 재실행 방지·사용자 Windows 로그인 완료 후 남은 3개 검증 재개
- 증거: `archive-gui-created.json`, `archive-gui-selected-extract.json`, `archive-gui-added.json`, `archive-gui-corrupt-open.json`, `archive-gui-corrupt-extract.json`, Git 추적 제외

### 최종 3개 검증 결과

| 검증 묶음 | 실행 및 확인 | 판정 |
| --- | --- | --- |
| 압축 실패·취소 | 손상 ZIP 실패 결과 유지, 512MiB 난수 파일의 ZIP 생성 중 진행창 취소 버튼 실행·`cancelled` 확인 | 통과 |
| 대용량 복사 취소 | 512MiB 파일의 복사 진행 중 382,730,240바이트 처리 시점에서 진행창 취소 버튼 실행·`cancelled` 확인 | 통과 |
| 연결 앱 선택 실행 | 파일 컨텍스트 메뉴의 다음으로 열기·등록 앱 목록과 기본 표시 확인·메모장 선택·한글 파일명과 실제 내용 표시 확인 | 통과 |

- 압축 취소: `op-archive-create-1792391623176-0`, 완료/실패 0개·오류 없음·최종 `cancel.zip`과 같은 폴더의 임시 파일 미잔류·7za 프로세스 종료 확인
- 복사 취소: `op-copy-1792391654390-2`, 완료/실패 0개·오류 없음·숨김 파일을 포함한 대상 폴더의 파일/하위 항목 0개 확인
- 원본 보존: 두 취소 후 각각 536,870,912바이트 원본 유지·SHA-256 `5EC1FE4995D880C0770326324994447F80ED44206071D0494A66AD7308DC6385` 일치 확인
- 연결 앱: `선택 파일.txt - 메모장` 창·본문 `selected archive member` 확인, 앱 선택 대화상자 정상 종료·오류 없음
- 연결 설정: 기본 앱 변경 없이 등록된 메모장 실행, 확인 후 해당 테스트 문서 탭만 닫기·기존 `alpha.txt` 탭 유지
- 검증 방식: Windows 설치 앱의 실제 GUI 액션·작업 이벤트·파일 해시·화면 확인 사용, 별도 테스트용 제품 코드 변경 없음
- 복원: 좌우 `final-20261019\left`·`right` 이동 후 앱 정상 종료·진단 환경 변수 없이 재실행, 설치 앱 해시의 22절 최종 패키지 일치 확인
- 증거 위치: `temp/verification/windows-final-20261019/`, Git 추적 제외
- 취소 증거: `archive-gui-cancel-request.json`, `archive-cancel-integrity.json`, `copy-gui-cancel-request.json`, `copy-cancel-integrity.json`
- 연결·복원 증거: `open-with-app-list.json`, `open-with-launch.json`, `open-with-final.png`, `final-three-restored.json`

### 종료 범위와 미검증 항목

- 사용자 지정 최종 범위: 3개 묶음 완료, 추가 테스트 종류로 확장 없음
- 별도 환경 미검증: 실제 UNC 공유·다른 볼륨·혼합 배율 다중 모니터·외부 키보드·추가 IME·고대비·WebView2 미설치 환경 유지
- 아키텍처 경계: 현재 Windows 11 ARM64 VM의 x64 앱 실행 검증, 실제 Intel/AMD x64 PC·별도 ARM64 전용 빌드 미검증 유지
- 공개 배포 정책: 코드 서명 정책 확정은 별도 후속 항목 유지
- VM 비정상 종료: 원인 미확정 유지, 재로그인 후 지정 검증 완료와 구분
- 변경 범위: 이번 마무리는 검증 기록 문서만 갱신, 기존 제품 변경 검토·22절 최신 자동 검증 근거 재사용
- 최종 확인: `npm run docs:check`·`git diff --check` 통과, 임시 Windows 테스트 연결 `stopped` 확인
- 배포 상태: 사용자 요청 전 커밋·push·새 원격 CI 실행 없음

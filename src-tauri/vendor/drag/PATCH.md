# drag 2.1.1 Windows 호환성 패치

- 원본: crates.io `drag` 2.1.1, 기존 `tauri-plugin-drag` 전이 의존성과 동일 버전
- 원본 패키지 체크섬: `7e90b4a25ace5ce0561534b073943594cbcd21af936e64d09aec444568411f8c`
- 원본 Git 출처: 동봉 `.cargo_vcs_info.json` 참조
- 포함 범위: 원본 `src`·Cargo manifest·라이선스·Git 출처 보존, 패키지 캐시 표시와 독립 개발용 Cargo.lock 제외
- 적용 방식: 상위 Cargo.toml의 `[patch.crates-io]`, 상위 Cargo.lock으로 기존 의존성 버전 고정
- 변경 파일: `src/platform_impl/windows/mod.rs`만 제품 코드 수정

## 변경 근거와 동작

- 재현: Wry 0.55.1의 Windows 수신 효과는 COPY 고정, 기존 Move 소스는 MOVE만 허용하여 앱 밖으로 나갔다 돌아온 Shift 드래그의 drop 누락
- 이동 모드의 허용 효과에 COPY 추가, Explorer의 MOVE 수락 유지 및 복사 전용 수신자의 파일 목록 수신 허용
- 자체 복귀는 앱이 보관한 이동 의도와 원본 경로로 명시 확인 후 공통 파일 작업 실행
- 외부 복사 전용 대상은 복사로 수락 가능, 드래그 라이브러리가 원본을 별도로 삭제하지 않음
- 파일 목록 전달 시 절대 경로·존재 여부 검증 후 `dunce::simplified`만 적용, 마지막 링크의 대상을 canonicalize하여 내보내는 동작 제거
- Shell이 항목을 만들지 못한 경우 panic 대신 기존 시작 실패 오류 반환
- 앱의 `prepare_native_file_drag`에서 기존 junction/알 수 없는 재파싱 지점 정책 검사 후 Shell 호환 경로 전달
- COPY 모드의 허용 효과와 Mac/Linux 동작 유지
- 종료 상태 판정은 원본 `DRAGDROP_S_DROP` 기준 유지, 최종 효과 NONE 추가 판정은 실제 Explorer 이동을 취소로 오판하여 제외
- 원본 라이선스 Apache-2.0/MIT 보존, 변경일 2026-10-19

## 유지보수와 검증

- 업데이트 시 원본과 로컬 수정의 비교 및 패치 제거 가능성 재평가 필수
- 원본 패키지와 비교 시 위 Windows 파일 외 소스 변경 금지
- 검증 대상: 실제 Windows 자체 복귀 이동·확인 취소, Explorer 외부 이동/복사, 링크 자체 보존·junction 거부, Escape 취소, 미수락 대상, Mac 전체 회귀
- 실제 결과: 저장소 `docs/implementation/windows-validation.md`의 후속 검증 기록 참조

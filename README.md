# BokslDirGUI

- BokslDirGUI는 기존 터미널 기반 BokslDir의 파일 커맨더 경험을 GUI 데스크톱 앱으로 옮기는 프로젝트
- 현재 구현은 **Tauri 2 + React + TypeScript + Rust** 기반이며, TUI 느낌의 듀얼 패널 파일 매니저 UI, action registry, read-only Rust 파일 탐색 command, 파일 작업 dialog/state shell, 검증 harness 포함

> - 현재 단계에서는 실제 파일 변경 작업(copy/move/delete 등)은 안전하게 stub 처리되어 있음
> - Rust backend에는 read-only 탐색 command 중심으로 연결되어 있음

## 필요 환경

- Node.js `>= 24`
- npm
- Rust toolchain
- Tauri 개발에 필요한 OS별 시스템 의존성

- macOS 기준으로는 보통 Rust와 Xcode Command Line Tools가 필요

## 설치

```bash
npm install
```

## 실행

### 웹 브라우저에서 개발 서버 실행

```bash
npm run dev
```

- 출력된 주소, 예: `http://127.0.0.1:5173/` 로 브라우저에서 확인

### Tauri 데스크톱 앱으로 실행

```bash
npm run tauri:dev
```

## 빌드

```bash
npm run build
```

- Tauri 앱 패키징이 필요하면:

```bash
npm run tauri:build
```

## 검증

- 전체 검증:

```bash
npm run verify
```

- 주요 개별 명령:

```bash
npm run typecheck   # TypeScript 타입 체크
npm test            # Vitest 테스트
npm run rust:test   # Rust 테스트
npm run verify:scope # full-scope smoke 검증
```

## 주요 디렉터리

- `src/` — React/TypeScript GUI, action registry, operation store, 테스트
- `src-tauri/` — Tauri/Rust backend command
- `scripts/` — 검증 스크립트
- `docs/implementation/` — 구현 기준 설계 문서
- `mockups/clickable-prototype/` — GUI 목업 참고 자료

# VM E2E 입력 도구

- 용도: macOS 게스트(Tart VM)에서 앱을 실제 입력 이벤트로 조작하는 E2E 확인 보조 도구
- 배경: `cliclick`의 기능 키(Esc·방향키·Tab·Return)와 드래그가 버튼·수정자 상태 없이 전달되어 유실·취소되는 현상 관찰
  - 2026-10-30 D08 재조사: 상단 메뉴로 연 대화상자의 Esc 미닫힘이 앱 결함이 아닌 입력 유실로 판명
  - 2026-10-30 같은 패널 폴더 드롭 E2E: `cliclick` 드래그는 놓기 전 취소·글자 선택으로 끝남, 아래 도구로는 정상 실행
- 관련 기록: [전체 소스 리뷰 · 2026-10-30](../../docs/implementation/code-review-2026-10-30.md)

| 도구 | 용도 | 사용 예 |
| --- | --- | --- |
| `vmkey.swift` | 수정자 상태를 비운 키 한 번 입력 | `vmkey esc`, `vmkey space`, `vmkey 99`(F3) |
| `vmdrag.swift` | 버튼·수정자 상태를 이벤트마다 지정한 드래그 | `vmdrag 610 258 621 232 shift 400` |

- 빌드: VM 안에서 `swiftc -O vmkey.swift -o vmkey`, `swiftc -O vmdrag.swift -o vmdrag`
- 좌표: 화면 포인트 기준, Retina 캡처(2048x1536)를 1024x768로 줄인 이미지 좌표와 일치
- 놓기 직전 화면: `VMDRAG_SHOT=/tmp/hover.png vmdrag …`로 드래그 중 상태 캡처
- 글자 입력과 단순 클릭: `cliclick t:`·`cliclick c:` 사용 가능, 공백·한글 입력은 신뢰하지 않음
- 권한: 손쉬운 사용·화면 기록 허용 창은 사용자가 VM 창에서 직접 허용

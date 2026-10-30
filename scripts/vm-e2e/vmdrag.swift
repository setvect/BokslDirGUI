// VM E2E용 마우스 드래그: 버튼 상태와 수정자 키를 이벤트마다 명시한 CGEvent 시퀀스.
// 사용: vmdrag x1 y1 x2 y2 [shift] [hold-ms], 환경 변수 VMDRAG_SHOT이 있으면 놓기 직전 화면 캡처.
import CoreGraphics
import Foundation

let args = CommandLine.arguments
guard args.count >= 5, let x1 = Double(args[1]), let y1 = Double(args[2]),
      let x2 = Double(args[3]), let y2 = Double(args[4]) else {
    print("usage: vmdrag x1 y1 x2 y2 [shift] [hold-ms]")
    exit(2)
}
let options = args.dropFirst(5)
let shift = options.contains("shift")
let holdMs = options.compactMap { Int($0) }.first ?? 400
let source = CGEventSource(stateID: .privateState)
let flags: CGEventFlags = shift ? .maskShift : []

func post(_ type: CGEventType, _ x: Double, _ y: Double) {
    guard let event = CGEvent(mouseEventSource: source, mouseType: type,
                              mouseCursorPosition: CGPoint(x: x, y: y), mouseButton: .left) else { return }
    event.flags = flags
    if type == .leftMouseDown || type == .leftMouseUp || type == .leftMouseDragged {
        event.setIntegerValueField(.mouseEventClickState, value: 1)
    }
    event.post(tap: .cghidEventTap)
}

post(.mouseMoved, x1, y1)
usleep(150_000)
post(.leftMouseDown, x1, y1)
usleep(180_000)
let steps = 14
for step in 1...steps {
    let t = Double(step) / Double(steps)
    post(.leftMouseDragged, x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)
    usleep(45_000)
}
usleep(useconds_t(holdMs * 1000))
if let shot = ProcessInfo.processInfo.environment["VMDRAG_SHOT"] {
    let capture = Process()
    capture.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    capture.arguments = ["-x", shot]
    try? capture.run()
    capture.waitUntilExit()
}
post(.leftMouseUp, x2, y2)
usleep(150_000)

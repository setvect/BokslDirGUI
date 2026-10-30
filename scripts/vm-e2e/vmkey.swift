// Posts one key press with no modifier flags, independent of any leftover modifier state.
import CoreGraphics
import Foundation

let names: [String: CGKeyCode] = ["esc": 53, "return": 36, "tab": 48, "left": 123, "right": 124, "down": 125, "up": 126, "space": 49, "backspace": 51]
guard CommandLine.arguments.count > 1, let code = names[CommandLine.arguments[1]] ?? CGKeyCode(CommandLine.arguments[1]) else {
  FileHandle.standardError.write("usage: vmkey <name|keycode>\n".data(using: .utf8)!)
  exit(2)
}
let source = CGEventSource(stateID: .privateState)
for keyDown in [true, false] {
  let event = CGEvent(keyboardEventSource: source, virtualKey: code, keyDown: keyDown)!
  event.flags = []
  event.post(tap: .cghidEventTap)
  usleep(30_000)
}

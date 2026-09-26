// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { beginPointerFileDrag } from './pointerFileDrag';

describe('file drag text selection ownership', () => {
  it.each(['release', 'cancel', 'blur', 'unmount'] as const)('blocks selection only during the gesture (%s)', (ending) => {
    const cleanup = beginPointerFileDrag({ pointerId: 1, clientX: 10, clientY: 10 }, {
      start: vi.fn(), update: vi.fn(), drop: vi.fn(), external: vi.fn(), cancel: vi.fn(),
    });
    const selection = new Event('selectstart', { bubbles: true, cancelable: true });
    document.dispatchEvent(selection);
    expect(selection.defaultPrevented).toBe(true);
    expect(document.documentElement.classList.contains('is-file-dragging')).toBe(true);
    if (ending === 'unmount') cleanup();
    else if (ending === 'blur') window.dispatchEvent(new Event('blur'));
    else {
      const event = new Event(ending === 'release' ? 'pointerup' : 'pointercancel');
      Object.assign(event, { pointerId: 1, button: 0 });
      window.dispatchEvent(event);
    }
    expect(document.documentElement.classList.contains('is-file-dragging')).toBe(false);
    const after = new Event('selectstart', { cancelable: true });
    document.dispatchEvent(after);
    expect(after.defaultPrevented).toBe(false);
  });
});

// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { startDrag } from '@crabnebula/tauri-plugin-drag';
import { invoke } from '@tauri-apps/api/core';
import { TAURI_NATIVE_FILE_DRAG_CLIENT } from './commanderClients';

vi.mock('@crabnebula/tauri-plugin-drag', () => ({ startDrag: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); vi.resetAllMocks(); });

it('validates Windows sources before native drag without creating a second drop target', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  const order: string[] = [];
  vi.mocked(invoke).mockImplementation(async command => { order.push(command); return command === 'prepare_native_file_drag' ? ['C:\\validated'] : undefined; });
  vi.mocked(startDrag).mockImplementation(async (_options, done) => {
    order.push('drag'); done?.({ result: 'Dropped', cursorPos: { x: 100, y: 100 } });
  });
  const done = vi.fn();
  await TAURI_NATIVE_FILE_DRAG_CLIENT.start(['C:\\fixture'], 'move', 'icon', done);
  expect(order).toEqual(['prepare_native_file_drag', 'drag']);
  expect(done).toHaveBeenCalledWith({ result: 'Dropped' });
  expect(startDrag).toHaveBeenCalledWith({ item: ['C:\\validated'], icon: 'icon', mode: 'move' }, expect.any(Function));
});

it('propagates native startup failure without opening a Windows overlay', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  vi.mocked(startDrag).mockRejectedValue(new Error('native failure'));
  await expect(TAURI_NATIVE_FILE_DRAG_CLIENT.start([], 'copy', 'icon', vi.fn())).rejects.toThrow('native failure');
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('prepare_native_file_drag', expect.anything());
});

it('keeps the existing macOS native drag lifecycle', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)');
  await TAURI_NATIVE_FILE_DRAG_CLIENT.start(['/tmp/fixture'], 'copy', 'icon', vi.fn());
  expect(startDrag).toHaveBeenCalledOnce();
  expect(invoke).not.toHaveBeenCalled();
});

it('rejects invalid Windows sources before showing the overlay or starting the native drag', async () => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');
  const error = { code: 'unsupported', messageKey: 'errors.reparsePointUnsupported', recoverable: true };
  vi.mocked(invoke).mockImplementation(async command => { if (command === 'prepare_native_file_drag') throw error; });
  await expect(TAURI_NATIVE_FILE_DRAG_CLIENT.start(['C:\\junction'], 'move', 'icon', vi.fn())).rejects.toBe(error);
  expect(startDrag).not.toHaveBeenCalled();
  expect(invoke).not.toHaveBeenCalledWith('show_drop_overlay', expect.anything());
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke).toHaveBeenCalledWith('prepare_native_file_drag', expect.anything());
});

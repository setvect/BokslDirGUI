// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PanelId } from '../domain/types';
import { useOperationStore } from '../operations/operationStore';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource } from './panelDataSource';
import './testing/commanderTestSetup';
import { rowByText } from './testing/commanderTestSupport';

describe('CommanderShell drag', () => {

  describe('app-local pointer file dragging', () => {
    const originalElementFromPoint = document.elementFromPoint;
    afterEach(() => {
      Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalElementFromPoint });
    });

    const setupDrag = (selectedLeft: string[] = [], listings = SAMPLE_LISTINGS) => {
      let finishNative: ((completion: { result: 'Dropped' | 'Cancelled'; clientPosition?: { x: number; y: number } | null }) => void) | undefined;
      const nativeFileDragClient = { start: vi.fn(async (_paths: string[], _mode: 'copy' | 'move', _preview: string, done: NonNullable<typeof finishNative>) => { finishNative = done; }) };
      const operationClient = {
        startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'drag-copy', kind: 'copy' as const, state: 'queued' as const } })),
        startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'drag-move', kind: 'move' as const, state: 'queued' as const } })),
        startDelete: vi.fn(), cancelOperation: vi.fn(), resolveConflict: vi.fn(),
      };
      const rendered = render(<CommanderShell
        dataSource={createFixturePanelDataSource(listings)}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn() }}
        operationClient={operationClient}
        nativeFileDragClient={nativeFileDragClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ ...INITIAL_SELECTED_PATHS, left: selectedLeft }}
        runtimeBackendAvailable
      />);
      const panels = {
        left: rendered.container.querySelector<HTMLElement>('.file-panel[data-panel-id="left"]')!,
        right: rendered.container.querySelector<HTMLElement>('.file-panel[data-panel-id="right"]')!,
      };
      const rows = {
        left: [...panels.left.querySelectorAll<HTMLElement>('.file-row')].find((row) => row.textContent?.includes('Architecture.md'))!,
        right: rowByText(rendered.container, 'generic-array-7534a23a150ae5e7')!,
      };
      Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        value: vi.fn((x: number, y: number) => y > 500 ? null : x < 400 ? panels.left : panels.right),
      });
      const x = (panel: PanelId) => panel === 'left' ? 100 : 700;
      const down = (panel: PanelId) => fireEvent.pointerDown(rows[panel], { pointerId: 7, button: 0, clientX: x(panel), clientY: 200 });
      const move = (panel: PanelId, shiftKey = false) => fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: x(panel) + 10, clientY: 210, shiftKey });
      const up = (panel: PanelId, shiftKey = false) => fireEvent.pointerUp(window, { pointerId: 7, button: 0, clientX: x(panel) + 10, clientY: 210, shiftKey });
      return { ...rendered, panels, rows, down, move, up, operationClient, nativeFileDragClient, finishNative: () => finishNative };
    };

    it.each([
      ['left', 'right', false], ['right', 'left', false],
      ['left', 'right', true], ['right', 'left', true],
    ] as const)('drops %s to %s with Shift=%s using the actual target', async (source, target, shift) => {
      const fixture = setupDrag();
      expect(fixture.rows[source].draggable).toBe(false);
      fixture.down(source);
      fixture.move(target, shift);
      expect(fixture.panels[target].className).toContain(shift ? 'is-drop-move' : 'is-drop-copy');
      fixture.up(target, shift);
      expect(fixture.nativeFileDragClient.start).not.toHaveBeenCalled();
      if (shift) {
        expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
        expect(fixture.operationClient.startMove).not.toHaveBeenCalled();
        fireEvent.click(screen.getByRole('button', { name: '이동' }));
      }
      const execute = shift ? fixture.operationClient.startMove : fixture.operationClient.startCopy;
      await waitFor(() => expect(execute).toHaveBeenCalledOnce());
      expect(execute).toHaveBeenCalledWith({
        sources: [expect.stringContaining(source === 'left' ? 'Architecture.md' : 'generic-array-7534a23a150ae5e7')],
        targetDir: SAMPLE_LISTINGS[target].path, policy: 'skip',
      });
      fixture.up(target, shift);
      expect(execute).toHaveBeenCalledTimes(1);
    });

    it.each(['left', 'right'] as const)('blocks a drop on its own %s panel after crossing the other panel', (source) => {
      const f = setupDrag();
      f.down(source);
      f.move(source === 'left' ? 'right' : 'left');
      f.move(source);
      expect(f.panels[source].className).toContain('is-drop-blocked');
      f.up(source);
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
      expect(f.operationClient.startMove).not.toHaveBeenCalled();
      expect(useOperationStore.getState().dialog).toBeNull();
    });

    it('updates Shift while stationary and uses the modifier at release', async () => {
      const f = setupDrag();
      f.down('left'); f.move('right');
      fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
      expect(f.panels.right.className).toContain('is-drop-move');
      expect(f.container.querySelector('.file-drag-preview strong')?.textContent).toBe('이동');
      fireEvent.keyUp(window, { key: 'Shift', shiftKey: false });
      expect(f.panels.right.className).toContain('is-drop-copy');
      f.up('right', true);
      expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
    });

    it.each(['Escape', 'pointercancel', 'blur', 'outside-panel'] as const)('cancels safely on %s', (reason) => {
      const f = setupDrag(); f.down('right'); f.move('left');
      if (reason === 'Escape') fireEvent.keyDown(window, { key: 'Escape' });
      if (reason === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 7 });
      if (reason === 'blur') fireEvent.blur(window);
      if (reason === 'outside-panel') fireEvent.pointerUp(window, { pointerId: 7, button: 0, clientX: 100, clientY: 600 });
      f.up('left');
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
      expect(f.operationClient.startMove).not.toHaveBeenCalled();
      expect(f.container.querySelector('.file-drag-preview')).toBeNull();
    });

    it('ignores a click, tiny movement and another pointer', () => {
      const f = setupDrag(); f.down('left');
      fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: 102, clientY: 202 });
      fireEvent.pointerUp(window, { pointerId: 8, button: 0, clientX: 700, clientY: 210 });
      f.up('right');
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
      expect(f.nativeFileDragClient.start).not.toHaveBeenCalled();
    });

    it('hands off only when leaving the window; native cancellation never copies into a panel', async () => {
      const f = setupDrag(); f.down('right'); f.move('left');
      expect(f.nativeFileDragClient.start).not.toHaveBeenCalled();
      fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: window.innerWidth + 10, clientY: 200 });
      await waitFor(() => expect(f.nativeFileDragClient.start).toHaveBeenCalledOnce());
      act(() => f.finishNative()?.({ result: 'Cancelled', clientPosition: { x: 100, y: 200 } }));
      expect(await screen.findByText('외부 드래그가 취소되었습니다.')).toBeTruthy();
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
      expect(f.operationClient.startMove).not.toHaveBeenCalled();
    });

    it('keeps the selected source snapshot when another row becomes selected during the gesture', async () => {
      const selected = ['Architecture.md', 'PRD.md'].map((name) => `${SAMPLE_LISTINGS.left.path}/${name}`);
      const f = setupDrag(selected); f.down('left'); f.move('right');
      fireEvent.click([...f.panels.left.querySelectorAll<HTMLElement>('.file-row')].find((row) => row.textContent?.includes('Requirements.md'))!);
      f.up('right');
      await waitFor(() => expect(f.operationClient.startCopy).toHaveBeenCalledWith({ sources: selected, targetDir: SAMPLE_LISTINGS.right.path, policy: 'skip' }));
    });

    it('uses the release position even when no final pointermove was delivered', () => {
      const f = setupDrag(); f.down('right'); f.move('left'); f.up('right');
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
      expect(f.operationClient.startMove).not.toHaveBeenCalled();
    });

    it('rechecks busy state at release', () => {
      const f = setupDrag(); f.down('left'); f.move('right');
      act(() => useOperationStore.setState({
        progress: {
          operationId: 'busy-during-drag', kind: 'copy', state: 'running', totalFiles: 1,
          completedFiles: 0, totalBytes: null, completedBytes: 0, currentPath: null,
          bytesPerSecond: null, etaSeconds: null, recentErrorCount: 0,
        }
      }));
      f.up('right');
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
    });

    it('blocks a different panel that shows the same directory', () => {
      const f = setupDrag([], { ...SAMPLE_LISTINGS, right: { ...SAMPLE_LISTINGS.right, path: SAMPLE_LISTINGS.left.path } });
      f.down('left'); f.move('right');
      expect(f.panels.right.className).toContain('is-drop-blocked');
      f.up('right');
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
    });

    it('keeps internal dragging available after an external handoff fails', async () => {
      const f = setupDrag();
      f.nativeFileDragClient.start.mockRejectedValueOnce(new Error('test native failure'));
      f.down('right');
      fireEvent.pointerMove(window, { pointerId: 7, buttons: 1, clientX: window.innerWidth + 10, clientY: 200 });
      expect(await screen.findByText(/외부 드래그 실패:.*test native failure/)).toBeTruthy();
      f.down('left'); f.move('right'); f.up('right');
      await waitFor(() => expect(f.operationClient.startCopy).toHaveBeenCalledOnce());
    });

    it('removes pending gesture listeners on unmount', () => {
      const f = setupDrag(); f.down('left'); f.move('right'); f.unmount(); f.up('right');
      expect(f.operationClient.startCopy).not.toHaveBeenCalled();
    });
  });
});

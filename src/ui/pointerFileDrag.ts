export interface DragPoint { x: number; y: number }
export type FileDragMode = 'copy' | 'move';

interface PointerDragStart {
  pointerId: number;
  clientX: number;
  clientY: number;
}

interface PointerDragHandlers {
  start(): void;
  update(point: DragPoint, mode: FileDragMode): void;
  drop(point: DragPoint, mode: FileDragMode): void;
  external(mode: FileDragMode): void;
  cancel(): void;
}

/** One owner for an in-window gesture. Only pointerup commits a local drop. */
export function beginPointerFileDrag(start: PointerDragStart, handlers: PointerDragHandlers): () => void {
  let active = false;
  let ended = false;
  let point = { x: start.clientX, y: start.clientY };
  let mode: FileDragMode = 'copy';
  // WebKit needs the prefixed CSS rule; selectstart also blocks Shift-extended selection.
  const preventSelection = (event: Event) => event.preventDefault();
  document.documentElement.classList.add('is-file-dragging');
  document.addEventListener('selectstart', preventSelection, true);
  const outside = () => point.x < 0 || point.y < 0 || point.x >= window.innerWidth || point.y >= window.innerHeight;
  const cleanup = () => {
    ended = true;
    document.documentElement.classList.remove('is-file-dragging');
    document.removeEventListener('selectstart', preventSelection, true);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', up, true);
    window.removeEventListener('pointercancel', cancelPointer, true);
    window.removeEventListener('pointerout', out, true);
    window.removeEventListener('keydown', key, true);
    window.removeEventListener('keyup', key, true);
    window.removeEventListener('blur', cancel);
  };
  const cancel = () => {
    if (ended) return;
    cleanup();
    if (active) handlers.cancel();
  };
  const cancelPointer = (event: PointerEvent) => {
    if (event.pointerId === start.pointerId) cancel();
  };
  const move = (event: PointerEvent) => {
    if (ended || event.pointerId !== start.pointerId) return;
    if ((event.buttons & 1) === 0) { cancel(); return; }
    point = { x: event.clientX, y: event.clientY };
    mode = event.shiftKey ? 'move' : 'copy';
    if (!active) {
      if (Math.hypot(point.x - start.clientX, point.y - start.clientY) < 6) return;
      active = true;
      window.getSelection()?.removeAllRanges();
      handlers.start();
    }
    event.preventDefault();
    if (outside()) {
      cleanup();
      handlers.external(mode);
    } else {
      handlers.update(point, mode);
    }
  };
  const out = (event: PointerEvent) => {
    if (event.relatedTarget === null && active) move(event);
  };
  const up = (event: PointerEvent) => {
    if (ended || event.pointerId !== start.pointerId || event.button !== 0) return;
    cleanup();
    if (!active) return;
    point = { x: event.clientX, y: event.clientY };
    mode = event.shiftKey ? 'move' : 'copy';
    // A completed drag must not also click a row or a newly opened dialog.
    const suppressClick = (click: MouseEvent) => { click.preventDefault(); click.stopImmediatePropagation(); };
    window.addEventListener('click', suppressClick, { capture: true, once: true });
    window.setTimeout(() => window.removeEventListener('click', suppressClick, true), 0);
    if (outside()) handlers.cancel();
    else handlers.drop(point, mode);
  };
  const key = (event: KeyboardEvent) => {
    if (!active || ended) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (event.key === 'Escape' && event.type === 'keydown') { cancel(); return; }
    mode = event.shiftKey ? 'move' : 'copy';
    handlers.update(point, mode);
  };
  window.addEventListener('pointermove', move, true);
  window.addEventListener('pointerup', up, true);
  window.addEventListener('pointercancel', cancelPointer, true);
  window.addEventListener('pointerout', out, true);
  window.addEventListener('keydown', key, true);
  window.addEventListener('keyup', key, true);
  window.addEventListener('blur', cancel);
  return cancel;
}

/** Opt-in diagnostics, excluding paths and file names. */
export function traceFileDrag(event: string, detail: Record<string, unknown>) {
  try {
    if (sessionStorage.getItem('boksldir.debugDrag') === '1') {
      console.debug('[file-drag]', event, detail);
    }
  } catch { /* Diagnostics must never interfere with a gesture. */ }
}

import type { DragPoint } from './pointerFileDrag';

/** Wry 0.55's AppKit backend emits points; preserve the existing pixel conversion elsewhere. */
export const nativeDropPosition = (point: DragPoint, pixelRatio: number, platform: string): DragPoint => {
  const scale = /Mac/i.test(platform) ? 1 : Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  return { x: point.x / scale, y: point.y / scale };
};

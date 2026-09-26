import type { FileEntry } from '../domain/types';
import { entryIcon } from './format';

const WIDTH = 360;
const ROW_HEIGHT = 34;
const MAX_VISIBLE_ROWS = 3;

/** The native drag plugin needs a PNG, so draw the selected file rows as its image. */
export const nativeDragPreview = (entries: FileEntry[]): string => {
  const visible = entries.slice(0, MAX_VISIBLE_ROWS);
  const hasOverflow = entries.length > visible.length;
  const height = 12 + ROW_HEIGHT * (visible.length + Number(hasOverflow)) + 12;
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is unavailable for the native drag preview');
  }

  context.fillStyle = '#17191c';
  context.strokeStyle = '#308ed0';
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(0.5, 0.5, WIDTH - 1, height - 1, 5);
  context.fill();
  context.stroke();
  context.font = '16px ui-monospace, Menlo, monospace';
  context.textBaseline = 'middle';

  visible.forEach((entry, index) => {
    const y = 12 + index * ROW_HEIGHT;
    context.fillStyle = '#075b96';
    context.fillRect(8, y, WIDTH - 16, ROW_HEIGHT - 2);
    context.fillStyle = entry.kind === 'directory' ? '#8bd3ff' : '#f2f5f8';
    context.fillText(entryIcon(entry.kind), 18, y + 16);
    context.fillStyle = '#f2f5f8';
    const availableWidth = WIDTH - 70;
    let name = entry.name;
    while (name.length > 1 && context.measureText(name).width > availableWidth) {
      name = name.slice(0, -2) + '…';
    }
    context.fillText(name, 48, y + 16);
  });

  if (hasOverflow) {
    context.fillStyle = '#b8c5d0';
    context.fillText(`+${entries.length - visible.length}`, 18, 12 + visible.length * ROW_HEIGHT + 16);
  }

  return canvas.toDataURL('image/png');
};

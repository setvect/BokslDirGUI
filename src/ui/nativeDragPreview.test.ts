// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import type { FileEntry } from '../domain/types';
import { nativeDragPreview } from './nativeDragPreview';

const entry = (name: string, kind: FileEntry['kind']): FileEntry => ({
  path: `/tmp/${name}`,
  name,
  kind,
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: false,
  isVirtual: false,
});

afterEach(() => vi.restoreAllMocks());

it('renders selected file names and a remaining count into the native PNG preview', () => {
  const text = vi.fn();
  const context = {
    beginPath: vi.fn(),
    roundRect: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    fillText: text,
    measureText: (value: string) => ({ width: value.length * 8 }),
  };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,cHJldmlldw==');

  expect(nativeDragPreview([
    entry('한글 폴더', 'directory'),
    entry('첫째.txt', 'file'),
    entry('둘째.txt', 'file'),
    entry('셋째.txt', 'file'),
  ])).toBe('data:image/png;base64,cHJldmlldw==');
  expect(text.mock.calls.map(([value]) => value)).toEqual([
    '▰', '한글 폴더', '▱', '첫째.txt', '▱', '둘째.txt', '+1',
  ]);
});

import { expect, it } from 'vitest';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { hotkeyStripActionsForWidth } from './hotkeyStripLayout';
import { columnLayoutForPanelWidth, pageMovementForViewport } from './panelPresentation';
import { zoomPercentForStep, zoomScaleForStep } from './settingsModel';
import { testEntry } from './testing/fileEntryFixture';
import { splitMiddleEllipsisParts } from './textLayout';

it('shows more hotkey hints as horizontal space grows', () => {
  const narrow = hotkeyStripActionsForWidth(520, 1).map((action) => action.id);
  const wide = hotkeyStripActionsForWidth(1600, 1).map((action) => action.id);
  const zoomed = hotkeyStripActionsForWidth(1600, 1.5).map((action) => action.id);

  expect(narrow).toEqual([
    'panel.switchActive',
    'nav.enter',
    'selection.toggle',
    'file.copy',
    'file.move',
    'file.mkdir',
  ]);
  expect(wide.length).toBeGreaterThan(narrow.length);
  expect(wide).toContain('filter.start');
  expect(wide).toContain('nav.refresh');
  expect(zoomed.length).toBeLessThan(wide.length);
});

it('handles the maximum archive listing size without spreading entries into function arguments', () => {
  const entries = Array.from({ length: 200_000 }, () => testEntry('/large', 'same.txt'));
  expect(columnLayoutForPanelWidth(170 * 8, 1, entries).gridTemplateColumns).toContain('minmax');
});

it('uses the TUI width-based metadata column policy', () => {
  expect(columnLayoutForPanelWidth(29 * 8)).toMatchObject({ showModified: false, showSize: false });
  expect(columnLayoutForPanelWidth(40 * 8)).toMatchObject({ showModified: false, showSize: false });
  expect(columnLayoutForPanelWidth(48 * 8)).toMatchObject({ showModified: true, showSize: false, dateFormat: 'short' });
  expect(columnLayoutForPanelWidth(61 * 8)).toMatchObject({ showSize: true, showPermissions: false, dateFormat: 'short' });
  expect(columnLayoutForPanelWidth(87 * 8)).toMatchObject({ showSize: true, showPermissions: false, showCreated: false });
  expect(columnLayoutForPanelWidth(100 * 8)).toMatchObject({ showPermissions: true, showCreated: false, dateFormat: 'long' });
  expect(columnLayoutForPanelWidth(135 * 8)).toMatchObject({ showPermissions: true, showCreated: true, showOwner: false });
  expect(columnLayoutForPanelWidth(170 * 8)).toMatchObject({ showCreated: true, showOwner: true });
  expect(columnLayoutForPanelWidth(70 * 8, 1)).toMatchObject({ showSize: true, showPermissions: false });
  expect(columnLayoutForPanelWidth(70 * 8, 1.5)).toMatchObject({ showPermissions: false });
  expect(columnLayoutForPanelWidth(100 * 8).gridTemplateColumns).toContain('calc(');
  expect(columnLayoutForPanelWidth(100 * 8).gridTemplateColumns).toContain('var(--cell-padding-x)');

  const longOwnerEntry = {
    ...testEntry(SAMPLE_LISTINGS.right.path, 'long-owner.txt'),
    owner: 'very-long-local-account-name',
    group: 'staff',
    createdAt: '2026-02-17T10:15:00+09:00',
    modifiedAt: '2026-02-18T11:42:00+09:00',
  };
  const longPermissionEntry = {
    ...testEntry(SAMPLE_LISTINGS.right.path, 'long-permission.txt'),
    permissions: 'drwxrwxrwx+ extended-acl',
    modifiedAt: '2026-02-18T11:42:00+09:00',
  };
  expect(columnLayoutForPanelWidth(170 * 8, 1, [longOwnerEntry])).toMatchObject({ showOwner: false });
  expect(columnLayoutForPanelWidth(100 * 8, 1, [longPermissionEntry])).toMatchObject({ showPermissions: false });
});

it('uses predictable preset zoom scales and keeps filename suffixes for middle ellipsis', () => {
  expect(zoomScaleForStep(-3)).toBe(0.75);
  expect(zoomScaleForStep(0)).toBe(1);
  expect(zoomScaleForStep(1)).toBe(1.1);
  expect(zoomScaleForStep(2)).toBe(1.25);
  expect(zoomScaleForStep(3)).toBe(1.5);
  expect(zoomScaleForStep(99)).toBe(2);
  expect(zoomPercentForStep(1)).toBe(110);
  expect(zoomPercentForStep(2)).toBe(125);
  expect(zoomPercentForStep(3)).toBe(150);

  expect(splitMiddleEllipsisParts('short.txt')).toEqual({ start: 'short.txt', end: null });
  expect(splitMiddleEllipsisParts('very-long-project-configuration-file.generated.json')).toMatchObject({
    end: expect.stringMatching(/\.json$/),
  });
  const unicodeName = `파일-${'👩‍💻-'.repeat(12)}설정.config.json`;
  const unicodeSplit = splitMiddleEllipsisParts(unicodeName);
  expect(`${unicodeSplit.start}${unicodeSplit.end ?? ''}`).toBe(unicodeName);
  expect(unicodeSplit.end).toMatch(/\.json$/);
  expect(unicodeSplit.start).not.toMatch(/\u200d$/u);
  expect(unicodeSplit.end ?? '').not.toMatch(/^\u200d/u);

  const originalSegmenter = Intl.Segmenter;
  try {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: undefined });
    const fallbackName = `emoji-${'👨‍👩‍👧‍👦-'.repeat(8)}cafe\u0301-report.txt`;
    const fallbackSplit = splitMiddleEllipsisParts(fallbackName);
    expect(`${fallbackSplit.start}${fallbackSplit.end ?? ''}`).toBe(fallbackName);
    expect(fallbackSplit.start).not.toMatch(/\u200d$/u);
    expect(fallbackSplit.end ?? '').not.toMatch(/^\u200d/u);
    expect(fallbackSplit.end).toMatch(/\.txt$/);
  } finally {
    Object.defineProperty(Intl, 'Segmenter', { configurable: true, writable: true, value: originalSegmenter });
  }
});


it('pages by visible rows minus one and preserves the cursor position inside the viewport', () => {
  const view = { direction: 1 as const, focusedIndex: 4, rowCount: 100, rowHeight: 25, viewportHeight: 525, scrollTop: 0 };
  expect(pageMovementForViewport(view)).toEqual({ focusedIndex: 24, scrollTop: 500 });
  expect(pageMovementForViewport({ ...view, direction: -1, focusedIndex: 24, scrollTop: 500 })).toEqual({ focusedIndex: 4, scrollTop: 0 });
  expect(pageMovementForViewport({ ...view, rowHeight: 50 })).toEqual({ focusedIndex: 13, scrollTop: 450 });
  expect(pageMovementForViewport({ ...view, viewportHeight: 249 })).toEqual({ focusedIndex: 12, scrollTop: 200 });
});

it('clamps page focus and scrolling at list boundaries and supports tiny or empty lists', () => {
  const view = { direction: 1 as const, focusedIndex: 28, rowCount: 30, rowHeight: 25, viewportHeight: 250, scrollTop: 500 };
  expect(pageMovementForViewport(view)).toEqual({ focusedIndex: 29, scrollTop: 500 });
  expect(pageMovementForViewport({ ...view, direction: -1, focusedIndex: 2, scrollTop: 0 })).toEqual({ focusedIndex: 0, scrollTop: 0 });
  expect(pageMovementForViewport({ ...view, rowCount: 3, focusedIndex: 0, scrollTop: 0 })).toEqual({ focusedIndex: 2, scrollTop: 0 });
  expect(pageMovementForViewport({ ...view, focusedIndex: 0, viewportHeight: 20, scrollTop: 0 })).toEqual({ focusedIndex: 1, scrollTop: 25 });
  expect(pageMovementForViewport({ ...view, rowCount: 0 })).toBeNull();
  expect(pageMovementForViewport({ ...view, viewportHeight: 0 })).toBeNull();
});

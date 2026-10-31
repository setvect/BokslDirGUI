import { expect, it } from 'vitest';
import { hotkeyLabelForAction, hotkeyStripActionsFromRegistry, shortcutLabelForAction } from '../actions/registry';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { hotkeyStripActionsForWidth } from './hotkeyStripLayout';
import { columnLayoutForPanelWidth, fileColorGroup, pageMovementForViewport } from './panelPresentation';
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

it('keeps every visible hint and the hidden-count button inside the strip', () => {
  // 실제 렌더링 폭 모델(15px 고정폭 글꼴 실측): 영문·숫자 최대 9.27px(SF Mono), 한글 최대 15px,
  // 항목마다 좌우 여백 22px(배율 적용)+간격·구분선 5px, "+N" 버튼은 여백 22px만
  const rendered = (text: string, scale: number, fixed: number) =>
    Array.from(text).reduce((width, char) => width + (/[\uac00-\ud7a3]/u.test(char) ? 15 : 9.27) * scale, 22 * scale + fixed);
  for (const language of ['ko', 'en'] as const) {
    for (const [scale, from] of [[1, 720], [1.5, 1080]] as const) {
      for (let stripWidth = from; stripWidth <= 2560; stripWidth += 1) {
        const visible = hotkeyStripActionsForWidth(stripWidth, scale, undefined, language);
        const hidden = hotkeyStripActionsFromRegistry().length - visible.length;
        const used = visible.reduce(
          (total, action) => total + rendered(`${shortcutLabelForAction(action)}:${hotkeyLabelForAction(action, language)}`, scale, 5), 0,
        ) + (hidden > 0 ? rendered(`+${hidden}`, scale, 0) : 0);
        if (used > stripWidth - 24 * scale) {
          throw new Error(`${language} ×${scale} ${stripWidth}px: ${Math.round(used)}px > ${stripWidth - 24 * scale}px`);
        }
      }
    }
  }
  // 1280px 한국어 창: 일부만 보이고 나머지는 "+N"으로 남음
  expect(hotkeyStripActionsForWidth(1280, 1, undefined, 'ko').length).toBeLessThan(hotkeyStripActionsFromRegistry().length);
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

it('classifies display colors without changing filesystem kinds or following link suffixes', () => {
  const cases = [
    ['사진.PNG', 'file', 'image'], ['.photo.JpEg', 'file', 'image'],
    ['report.DOCX', 'file', 'document'], ['한글.hwpx', 'file', 'document'],
    ['table.xlsx', 'file', 'document'], ['notes.md', 'file', 'document'],
    ['tool.EXE', 'file', 'executable'], ['run', 'executable', 'executable'],
    ['START.BAT', 'executable', 'script'], ['deploy.ps1', 'file', 'script'],
    ['backup.tar.gz', 'file', 'archive'], ['backup.ZIP', 'archive', 'archive'],
    ['track.flac', 'file', 'media'], ['movie.MP4', 'file', 'media'],
    ['app.tsx', 'file', 'source'],
    ['image.png', 'symlink', 'symlink'], ['archive.zip', 'symlink', 'symlink'],
    ['folder.pdf', 'directory', 'directory'], ['..', 'directory', 'directory'],
    ['program.png', 'executable', 'executable'],
    ['file.unknown', 'file', 'file'], ['no-extension', 'unknown', 'file'],
    ['.png', 'file', 'file'], ['document.txt.exe', 'file', 'executable'],
  ] as const;
  for (const [name, kind, expected] of cases) {
    const entry = Object.freeze({ name, kind });
    expect(fileColorGroup(entry), `${kind}: ${name}`).toBe(expected);
    expect(entry).toEqual({ name, kind });
  }
});

import { describe, expect, it } from 'vitest';
import type { FileEntry } from '../domain/types';
import { createDirectoryListing, createPanelStateFromListing, parentPathOf, replacePanelListing } from './panelState';

describe('panel state path helpers', () => {
  it('normalizes POSIX and Windows parent paths without losing drive roots', () => {
    expect(parentPathOf('/')).toBe('/');
    expect(parentPathOf('/demo/BokslDir/docs')).toBe('/demo/BokslDir');
    expect(parentPathOf('/demo/BokslDir/docs/')).toBe('/demo/BokslDir');
    expect(parentPathOf('C:\\')).toBe('C:\\');
    expect(parentPathOf('C:\\Users\\boksl')).toBe('C:\\Users');
    expect(parentPathOf('C:/')).toBe('C:/');
    expect(parentPathOf('C:/Users')).toBe('C:/');
    expect(parentPathOf('C:/Users/boksl')).toBe('C:/Users');
  });

  it('keeps UNC and extended Windows roots and exact whitespace', () => {
    expect(parentPathOf("\\\\server\\share")).toBe("\\\\server\\share");
    expect(parentPathOf("\\\\server\\share\\")).toBe("\\\\server\\share\\");
    expect(parentPathOf("\\\\?\\C:\\")).toBe("\\\\?\\C:\\");
    expect(parentPathOf("\\\\?\\UNC\\server\\share")).toBe("\\\\?\\UNC\\server\\share");
    expect(parentPathOf("\\\\server\\share\\한글 폴더\\child")).toBe("\\\\server\\share\\한글 폴더");
    expect(parentPathOf("\\\\?\\C:\\한글 폴더\\child")).toBe("\\\\?\\C:\\한글 폴더");
    expect(parentPathOf("/folder with spaces /child ")).toBe("/folder with spaces ");
    expect(parentPathOf("C:\\folder with spaces \\child ")).toBe("C:\\folder with spaces ");
  });

  it('focuses the first concrete row when a child directory is opened', () => {
    const current = createPanelStateFromListing(
      createDirectoryListing('left', '/Users/boksl/IdeaProjects', [
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslDir'),
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslDirGUI'),
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslHome'),
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslPlanningPoker'),
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslRunning'),
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslSpell'),
        directoryEntry('/Users/boksl/IdeaProjects', 'BokslStock2'),
      ]),
      { focusedIndex: 6 },
    );
    const childListing = createDirectoryListing('left', '/Users/boksl/IdeaProjects/BokslDirGUI', [
      virtualParent('/Users/boksl/IdeaProjects'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'dist'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'docs'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'mockups'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'node_modules'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'scripts'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'src'),
      directoryEntry('/Users/boksl/IdeaProjects/BokslDirGUI', 'src-tauri'),
    ]);

    const next = replacePanelListing(current, childListing, { focusFallback: 'first-concrete' });

    expect(next.focusedIndex).toBe(1);
    expect(next.listing.entries[next.focusedIndex]?.name).toBe('dist');
  });

  it('preserves the current row index by default for refresh-like listing replacement', () => {
    const current = createPanelStateFromListing(
      createDirectoryListing('left', '/workspace', [
        directoryEntry('/workspace', 'one'),
        directoryEntry('/workspace', 'two'),
        directoryEntry('/workspace', 'three'),
      ]),
      { focusedIndex: 2 },
    );
    const replacement = createDirectoryListing('left', '/workspace', [
      directoryEntry('/workspace', 'alpha'),
      directoryEntry('/workspace', 'beta'),
      directoryEntry('/workspace', 'gamma'),
    ]);

    const next = replacePanelListing(current, replacement);

    expect(next.focusedIndex).toBe(2);
    expect(next.listing.entries[next.focusedIndex]?.name).toBe('gamma');
  });
});

const directoryEntry = (parent: string, name: string): FileEntry => ({
  path: `${parent}/${name}`,
  name,
  kind: 'directory',
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: 'drwxr-xr-x',
  owner: 'boksl',
  group: 'staff',
  isHidden: false,
  isVirtual: false,
});

const virtualParent = (path: string): FileEntry => ({
  path,
  name: '..',
  kind: 'directory',
  sizeBytes: null,
  modifiedAt: null,
  createdAt: null,
  permissions: null,
  owner: null,
  group: null,
  isHidden: false,
  isVirtual: true,
});

it('bounds navigation history to the most recent 100 paths', () => {
  let panel = createPanelStateFromListing(createDirectoryListing('left', '/0'));
  for (let index = 1; index <= 150; index++) {
    panel = replacePanelListing(panel, createDirectoryListing('left', `/${index}`), { pushHistory: true });
  }
  expect(panel.historyBack).toHaveLength(100);
  expect(panel.historyBack[0]).toBe('/50');
  expect(panel.historyBack.at(-1)).toBe('/149');
});

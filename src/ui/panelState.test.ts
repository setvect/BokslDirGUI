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

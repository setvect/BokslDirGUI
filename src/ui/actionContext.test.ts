import { describe, expect, it } from 'vitest';
import { ACTION_BY_ID, isActionAvailable, menuRootsFromRegistry } from '../actions/registry';
import { createActionContext, filterEnabledActions } from './actionContext';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { contextMenuActions } from './CommanderShell';

describe('action context helpers', () => {
  it('marks virtual parent entries as navigation-only context menu targets', () => {
    const virtualParent = SAMPLE_LISTINGS.left.entries[0];
    const context = createActionContext({
      activePanel: 'left',
      focusedEntry: virtualParent,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });

    expect(virtualParent.isVirtual).toBe(true);
    expect(context.selectedCount).toBe(0);
    expect(contextMenuActions(virtualParent, context).map((action) => action.id)).toEqual(['nav.enter']);
  });

  it('uses the same enablement predicate for menu and context actions', () => {
    const entry = SAMPLE_LISTINGS.left.entries.find((candidate) => candidate.name === 'Architecture.md');
    if (!entry) {
      throw new Error('fixture entry is required');
    }
    const context = createActionContext({
      activePanel: 'left',
      focusedEntry: entry,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });
    const copyAction = ACTION_BY_ID.get('file.copy');
    const shellAction = ACTION_BY_ID.get('external.runShellCommand');
    if (!copyAction || !shellAction) {
      throw new Error('registry actions are required');
    }

    expect(filterEnabledActions([copyAction], context, entry).map((action) => action.id)).toEqual(['file.copy']);
    expect(filterEnabledActions([shellAction], context, entry)).toEqual([]);
  });

  it('keeps archive actions scoped to archive entries through the registry selector', () => {
    const regularFile = SAMPLE_LISTINGS.left.entries.find((candidate) => candidate.name === 'Architecture.md');
    const archiveEntry = SAMPLE_LISTINGS.left.entries.find((candidate) => candidate.name === 'release-bundle.zip');
    const archivePreview = ACTION_BY_ID.get('archive.preview');
    if (!regularFile || !archiveEntry || !archivePreview) {
      throw new Error('fixture archive and registry action are required');
    }

    const fileContext = createActionContext({
      activePanel: 'left',
      focusedEntry: regularFile,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });
    const archiveContext = createActionContext({
      activePanel: 'left',
      focusedEntry: archiveEntry,
      selectedCount: 1,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });

    expect(isActionAvailable(archivePreview, fileContext)).toBe(false);
    expect(isActionAvailable(archivePreview, archiveContext)).toBe(true);
    expect(contextMenuActions(archiveEntry, archiveContext).map((action) => action.id)).toEqual(
      expect.arrayContaining(['archive.preview', 'archive.list', 'archive.extract']),
    );
  });

  it('derives top-level menu roots from registry metadata', () => {
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Archive', 'Tools', 'Settings', 'Help']);
  });
});

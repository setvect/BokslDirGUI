import { describe, expect, it } from 'vitest';
import { ACTION_BY_ID, isActionAvailable, menuRootsFromRegistry } from '../actions/registry';
import { createActionContext, filterEnabledActions, resolveActionTargets } from './actionContext';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { contextMenuActions } from './menuModel';

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
    expect(context.hasConcreteFocus).toBe(false);
    expect(contextMenuActions(virtualParent, context).map((action) => action.id)).toEqual(['nav.enter']);
    expect(isActionAvailable(ACTION_BY_ID.get('file.rename')!, context)).toBe(false);
    expect(isActionAvailable(ACTION_BY_ID.get('file.properties')!, context)).toBe(false);
    expect(isActionAvailable(ACTION_BY_ID.get('external.reveal')!, context)).toBe(false);
  });

  it('treats a focused concrete row as the effective file-operation target without explicit selection', () => {
    const focusedIndex = SAMPLE_LISTINGS.right.entries.findIndex((candidate) => !candidate.isVirtual);
    const entry = SAMPLE_LISTINGS.right.entries[focusedIndex];
    const copyAction = ACTION_BY_ID.get('file.copy');
    const archiveCreateAction = ACTION_BY_ID.get('archive.create');
    if (!entry || !copyAction || !archiveCreateAction) {
      throw new Error('fixture entry and registry actions are required');
    }
    const targets = resolveActionTargets({
      focusedIndex,
      selectedPaths: [],
      listing: SAMPLE_LISTINGS.right,
    });

    const context = createActionContext({
      activePanel: 'right',
      focusedEntry: targets.focusedEntry,
      selectedCount: targets.selectedCount,
      hasConcreteFocus: targets.hasConcreteFocus,
      effectiveTargetCount: targets.effectiveTargetCount,
      hasOppositePanel: true,
      shellCommandEnabled: false,
      operationBusy: false,
    });

    expect(targets.effectiveSources).toEqual([entry]);
    expect(context.effectiveTargetCount).toBe(1);
    expect(isActionAvailable(copyAction, context)).toBe(true);
    expect(isActionAvailable(archiveCreateAction, context)).toBe(true);
  });

  it('uses every selected concrete row in listing order and excludes the virtual parent', () => {
    const listing = SAMPLE_LISTINGS.left;
    const virtualParent = listing.entries[0];
    const directory = listing.entries.find((entry) => entry.kind === 'directory' && !entry.isVirtual);
    const file = listing.entries.find((entry) => entry.kind === 'file');
    if (!virtualParent || !directory || !file) {
      throw new Error('mixed selection fixtures are required');
    }

    const targets = resolveActionTargets({
      focusedIndex: listing.entries.findIndex((entry) => entry.path === file.path),
      selectedPaths: [file.path, virtualParent.path, directory.path],
      listing,
    });

    expect(targets.focusedEntry).toBe(file);
    expect(targets.selectedEntries).toEqual([directory, file]);
    expect(targets.effectiveSources).toEqual([directory, file]);
    expect(targets.selectedCount).toBe(2);
    expect(targets.effectiveTargetCount).toBe(2);
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
    const archiveOpen = ACTION_BY_ID.get('archive.list');
    if (!regularFile || !archiveEntry || !archiveOpen) {
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

    expect(isActionAvailable(archiveOpen, fileContext)).toBe(false);
    expect(isActionAvailable(archiveOpen, archiveContext)).toBe(true);
    expect(contextMenuActions(archiveEntry, archiveContext).map((action) => action.id)).toEqual(
      expect.arrayContaining(['archive.list', 'archive.extract', 'archive.extractAuto']),
    );
  });

  it('derives top-level menu roots from registry metadata', () => {
    expect(menuRootsFromRegistry()).toEqual(['File', 'Edit', 'View', 'Go', 'Archive', 'Settings', 'Help']);
  });
});

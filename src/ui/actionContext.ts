import { isActionAvailable, type ActionContext, type ActionId, type AppAction, type ContextScope } from '../actions/registry';
import type { FileEntry, PanelId } from '../domain/types';

export interface ActionContextInput {
  activePanel: PanelId;
  focusedEntry: FileEntry | null;
  selectedCount: number;
  hasConcreteFocus?: boolean;
  effectiveTargetCount?: number;
  hasOppositePanel: boolean;
  shellCommandEnabled: boolean;
  operationBusy: boolean;
  backendAvailable?: boolean;
}

interface ActionTargetPanel {
  focusedIndex: number;
  selectedPaths: readonly string[];
  listing: {
    entries: readonly FileEntry[];
  };
}

export interface ActionTargetSnapshot {
  focusedEntry: FileEntry | null;
  selectedEntries: FileEntry[];
  effectiveSources: FileEntry[];
  selectedCount: number;
  hasConcreteFocus: boolean;
  effectiveTargetCount: number;
}

export const resolveActionTargets = (panel: ActionTargetPanel): ActionTargetSnapshot => {
  const focusedEntry = panel.listing.entries[panel.focusedIndex] ?? null;
  const selectedSet = new Set(panel.selectedPaths);
  const selectedEntries = panel.listing.entries
    .filter((entry) => selectedSet.has(entry.path) && !entry.isVirtual);
  const hasConcreteFocus = Boolean(focusedEntry && !focusedEntry.isVirtual);
  const effectiveSources = selectedEntries.length > 0
    ? selectedEntries
    : hasConcreteFocus && focusedEntry
    ? [focusedEntry]
    : [];

  return {
    focusedEntry,
    selectedEntries,
    effectiveSources,
    selectedCount: selectedEntries.length,
    hasConcreteFocus,
    effectiveTargetCount: effectiveSources.length,
  };
};

export const contextScopeForEntry = (entry: FileEntry | null): ContextScope | null => {
  if (!entry) {
    return null;
  }
  if (entry.kind === 'archive') {
    return 'archive';
  }
  if (entry.kind === 'directory') {
    return 'directory';
  }
  return 'file';
};

export const createActionContext = ({
  activePanel,
  focusedEntry,
  selectedCount,
  hasConcreteFocus: hasConcreteFocusOverride,
  effectiveTargetCount,
  hasOppositePanel,
  shellCommandEnabled,
  operationBusy,
  backendAvailable = true,
}: ActionContextInput): ActionContext => {
  const hasConcreteFocus = hasConcreteFocusOverride ?? Boolean(focusedEntry && !focusedEntry.isVirtual);
  return {
    activePanel,
    focusedEntryKind: contextScopeForEntry(focusedEntry),
    selectedCount,
    hasConcreteFocus,
    effectiveTargetCount: effectiveTargetCount ?? (selectedCount > 0 ? selectedCount : hasConcreteFocus ? 1 : 0),
    hasOppositePanel,
    shellCommandEnabled,
    operationBusy,
    backendAvailable,
  };
};

export const blocksVirtualEntryTarget = (action: AppAction, entry: FileEntry) =>
  entry.isVirtual && action.id !== 'nav.enter';

const actionCanTargetEntry = (action: AppAction, entry: FileEntry, context: ActionContext) => {
  if (!action.contextScopes?.length) {
    return true;
  }
  const entryScope = contextScopeForEntry(entry);
  return action.contextScopes.some((scope) => {
    if (scope === 'selection') {
      return context.effectiveTargetCount > 0;
    }
    return scope === entryScope;
  });
};

export const filterEnabledActions = (actions: AppAction[], context: ActionContext, entry?: FileEntry) =>
  actions.filter(
    (action) =>
      isActionAvailable(action, context) &&
      (!entry || (!blocksVirtualEntryTarget(action, entry) && actionCanTargetEntry(action, entry, context))),
  );

const SOURCE_REQUIRED_ACTIONS = new Set<ActionId>([
  'file.copy',
  'file.move',
  'file.trash',
  'file.deletePermanent',
  'file.rename',
  'file.properties',
  'archive.list',
  'archive.extract',
  'archive.extractAuto',
  'archive.create',
  'external.openDefault',
  'external.reveal',
  'external.openEditor',
]);

export const actionNeedsConcreteSources = (actionId: ActionId) =>
  SOURCE_REQUIRED_ACTIONS.has(actionId);

import { isActionAvailable, type ActionContext, type ActionId, type AppAction, type ContextScope } from '../actions/registry';
import type { FileEntry, PanelId } from '../domain/types';

export interface ActionContextInput {
  activePanel: PanelId;
  focusedEntry: FileEntry | null;
  selectedCount: number;
  hasOppositePanel: boolean;
  shellCommandEnabled: boolean;
  operationBusy: boolean;
}

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
  hasOppositePanel,
  shellCommandEnabled,
  operationBusy,
}: ActionContextInput): ActionContext => ({
  activePanel,
  focusedEntryKind: contextScopeForEntry(focusedEntry),
  selectedCount: focusedEntry?.isVirtual ? 0 : selectedCount,
  hasOppositePanel,
  shellCommandEnabled,
  operationBusy,
});

export const blocksVirtualEntryTarget = (action: AppAction, entry: FileEntry) =>
  entry.isVirtual && action.id !== 'nav.enter';

const actionCanTargetEntry = (action: AppAction, entry: FileEntry, context: ActionContext) => {
  if (!action.contextScopes?.length) {
    return true;
  }
  const entryScope = contextScopeForEntry(entry);
  return action.contextScopes.some((scope) => {
    if (scope === 'selection') {
      return context.selectedCount > 0;
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
  'archive.preview',
  'archive.list',
  'archive.extract',
  'archive.create',
  'external.openDefault',
  'external.reveal',
  'external.openEditor',
]);

export const actionNeedsConcreteSources = (actionId: ActionId) =>
  SOURCE_REQUIRED_ACTIONS.has(actionId);

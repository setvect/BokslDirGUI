import { ACTION_BY_ID, fileShortcutPlatform, isActionAvailable, type ActionContext, type ActionId, type AppAction, type ContextScope, type FileShortcutPlatform } from '../actions/registry';
import type { FileEntry, PanelId, PlatformInfo } from '../domain/types';
import { isArchiveVirtualPath } from './archiveVirtual';

export interface ActionContextInput {
  activePanel: PanelId;
  focusedEntry: FileEntry | null;
  selectedCount: number;
  hasConcreteFocus?: boolean;
  effectiveTargetCount?: number;
  clipboardCount?: number;
  trashUndoAvailable?: boolean;
  clipboardMode?: 'copy' | 'move' | null;
  clipboardCanMove?: boolean;
  platform?: FileShortcutPlatform;
  platformInfo?: PlatformInfo;
  hasOppositePanel: boolean;
  shellCommandEnabled: boolean;
  operationBusy: boolean;
  backendAvailable?: boolean;
  activePathIsArchive?: boolean;
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
  clipboardCount = 0,
  trashUndoAvailable = false,
  clipboardMode = null,
  clipboardCanMove = false,
  platform = fileShortcutPlatform(),
  platformInfo,
  hasOppositePanel,
  shellCommandEnabled,
  operationBusy,
  backendAvailable = true,
  activePathIsArchive = false,
}: ActionContextInput): ActionContext => {
  const hasConcreteFocus = hasConcreteFocusOverride ?? Boolean(focusedEntry && !focusedEntry.isVirtual);
  return {
    activePanel,
    focusedEntryKind: contextScopeForEntry(focusedEntry),
    selectedCount,
    hasConcreteFocus,
    effectiveTargetCount: effectiveTargetCount ?? (selectedCount > 0 ? selectedCount : hasConcreteFocus ? 1 : 0),
    clipboardCount,
    trashUndoAvailable,
    clipboardMode,
    clipboardCanMove,
    platform: platformInfo && platformInfo.os !== 'unknown' ? (platformInfo.os === 'macos' ? 'mac' : 'other') : platform,
    platformInfo,
    hasOppositePanel,
    shellCommandEnabled,
    operationBusy,
    backendAvailable,
    activePathIsArchive,
  };
};

// 단축키·상단 메뉴·컨텍스트 메뉴가 함께 쓰는 패널 무관 상태
export type SharedActionState = Pick<
  ActionContextInput,
  'clipboardCount' | 'trashUndoAvailable' | 'clipboardMode' | 'clipboardCanMove' | 'platformInfo' | 'shellCommandEnabled' | 'operationBusy' | 'backendAvailable'
>;

export const createPanelActionContext = (
  shared: SharedActionState,
  panel: { panelId: PanelId; path: string },
  targets: Pick<ActionTargetSnapshot, 'focusedEntry' | 'selectedCount' | 'hasConcreteFocus' | 'effectiveTargetCount'>,
): ActionContext => {
  const activePathIsArchive = isArchiveVirtualPath(panel.path);
  return createActionContext({
    ...shared,
    activePanel: panel.panelId,
    focusedEntry: targets.focusedEntry,
    selectedCount: targets.selectedCount,
    hasConcreteFocus: targets.hasConcreteFocus,
    effectiveTargetCount: targets.effectiveTargetCount,
    // 압축 가상 경로는 읽기 전용이라 이동 붙여넣기 대상 제외
    clipboardCanMove: Boolean(shared.clipboardCanMove) && !activePathIsArchive,
    hasOppositePanel: true,
    activePathIsArchive,
  });
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

export const actionNeedsConcreteSources = (actionId: ActionId) =>
  ACTION_BY_ID.get(actionId)?.requiresConcreteSources ?? false;

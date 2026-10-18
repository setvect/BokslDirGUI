import { isSettingChecked } from '../actions/settingActions';
import {
  ACTIONS,
  actionVisibleOnPlatform,
  actionsForMenu,
  isActionAvailable,
  labelForAction,
  menuPathSegmentsForAction,
  menuRootAcceleratorFromRegistry,
  menuRootsFromRegistry,
  shortcutLabelForAction,
  type ActionContext,
  type ActionId,
  type AppAction
} from '../actions/registry';
import type { FileEntry, Settings } from '../domain/types';
import { filterEnabledActions } from './actionContext';

export interface TopMenuState {
  rootIndex: number;
  itemIndex: number;
  submenuIndex: number | null;
  menuOpen: boolean;
}

interface MenuActionNode {
  kind: 'action';
  id: string;
  label: string;
  accelerator: string | null;
  action: AppAction;
  enabled: boolean;
  checkable: boolean;
  checked: boolean;
}

interface MenuSubmenuNode {
  kind: 'submenu';
  id: string;
  label: string;
  accelerator: string | null;
  children: MenuActionNode[];
}

export type MenuNode = MenuActionNode | MenuSubmenuNode;

export interface TopMenuKeyboardRuntime {
  context: ActionContext;
  settings: Settings;
  getState(): TopMenuState | null;
  open(rootIndex?: number, menuOpen?: boolean): void;
  close(): void;
  setState(next: TopMenuState): void;
  execute(action: AppAction): void;
}

export const menuNodesForRoot = (root: string, context: ActionContext, settings: Settings): MenuNode[] => {
  const language = settings.language;
  const nodes: MenuNode[] = [];
  const submenuByLabel = new Map<string, MenuSubmenuNode>();

  for (const action of actionsForMenu(root, context.platform, context.platformInfo)) {
    const segments = menuPathSegmentsForAction(action, language)?.slice(1) ?? [];
    const acceleratorSegments = action.menuPath?.slice(1) ?? [];
    if (segments.length > 1) {
      const submenuLabel = segments[0];
      let submenu = submenuByLabel.get(submenuLabel);
      if (!submenu) {
        submenu = {
          kind: 'submenu',
          id: `${root}/${submenuLabel}`,
          label: submenuLabel,
          accelerator: menuLabelAccelerator(acceleratorSegments[0] ?? submenuLabel),
          children: [],
        };
        submenuByLabel.set(submenuLabel, submenu);
        nodes.push(submenu);
      }
      submenu.children.push({
        kind: 'action',
        id: action.id,
        label: segments.at(-1) ?? labelForAction(action, language),
        accelerator: menuLabelAccelerator(acceleratorSegments.at(-1) ?? action.displayLabel),
        action,
        enabled: isActionAvailable(action, context),
        checkable: Boolean(action.setting),
        checked: action.setting ? isSettingChecked(action.setting, settings) : false,
      });
      continue;
    }

    nodes.push({
      kind: 'action',
      id: action.id,
      label: segments[0] ?? labelForAction(action, language),
      accelerator: menuLabelAccelerator(acceleratorSegments[0] ?? action.displayLabel),
      action,
      enabled: isActionAvailable(action, context),
      checkable: Boolean(action.setting),
      checked: action.setting ? isSettingChecked(action.setting, settings) : false,
    });
  }

  return nodes;
};

export const handleTopMenuKeyDown = (event: KeyboardEvent, runtime: TopMenuKeyboardRuntime | null) => {
  if (!runtime) {
    return false;
  }

  const roots = menuRootsFromRegistry();
  const openFromClosed = event.key === 'F9';
  const accelerator = menuAcceleratorFromKeyboardEvent(event);
  const acceleratedRootIndex = accelerator ? rootIndexForAccelerator(roots, accelerator) : -1;
  let state = runtime.getState();
  if (!state) {
    if (openFromClosed || (event.altKey && acceleratedRootIndex >= 0)) {
      event.preventDefault();
      event.stopPropagation();
      runtime.open(openFromClosed ? 0 : acceleratedRootIndex, !openFromClosed);
      return true;
    }
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  const applyMenuState = (next: TopMenuState) => {
    state = next;
    runtime.setState(next);
  };

  if (event.key === 'Escape' || event.key === 'F9') {
    runtime.close();
    return true;
  }

  const moveRoot = (delta: number) => {
    const nextRootIndex = (state!.rootIndex + delta + roots.length) % roots.length;
    applyMenuState({ rootIndex: nextRootIndex, itemIndex: 0, submenuIndex: null, menuOpen: state!.menuOpen });
  };
  const nodes = menuNodesForRoot(roots[state.rootIndex], runtime.context, runtime.settings);
  const selectedNode = nodes[state.itemIndex];
  if (nodes.length === 0 && state.menuOpen) {
    return true;
  }

  if (accelerator) {
    if (acceleratedRootIndex >= 0) {
      applyMenuState({ rootIndex: acceleratedRootIndex, itemIndex: 0, submenuIndex: null, menuOpen: state.menuOpen });
      return true;
    }

    if (!state.menuOpen) {
      return true;
    }

    if (state.submenuIndex !== null && selectedNode?.kind === 'submenu') {
      const childIndex = selectedNode.children.findIndex((child) => child.accelerator === accelerator);
      const child = childIndex >= 0 ? selectedNode.children[childIndex] : null;
      if (child) {
        applyMenuState({ ...state, submenuIndex: childIndex });
        if (child.enabled) {
          runtime.execute(child.action);
        }
        return true;
      }
    }

    const nodeIndex = nodes.findIndex((node) => node.accelerator === accelerator);
    const node = nodeIndex >= 0 ? nodes[nodeIndex] : null;
    if (node) {
      if (node.kind === 'submenu') {
        applyMenuState({ ...state, itemIndex: nodeIndex, submenuIndex: 0 });
        return true;
      }
      applyMenuState({ ...state, itemIndex: nodeIndex, submenuIndex: null });
      if (node.enabled) {
        runtime.execute(node.action);
      }
      return true;
    }
  }

  if (event.key === 'ArrowRight') {
    if (!state.menuOpen) {
      moveRoot(1);
      return true;
    }
    if (selectedNode?.kind === 'submenu' && state.submenuIndex === null) {
      applyMenuState({ ...state, submenuIndex: 0 });
      return true;
    }
    moveRoot(1);
    return true;
  }

  if (event.key === 'ArrowLeft') {
    if (!state.menuOpen) {
      moveRoot(-1);
      return true;
    }
    if (state.submenuIndex !== null) {
      applyMenuState({ ...state, submenuIndex: null });
      return true;
    }
    moveRoot(-1);
    return true;
  }

  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!state.menuOpen) {
      applyMenuState({ ...state, itemIndex: event.key === 'ArrowUp' ? Math.max(0, nodes.length - 1) : 0, submenuIndex: null, menuOpen: true });
      return true;
    }
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    if (state.submenuIndex !== null && selectedNode?.kind === 'submenu') {
      const childCount = selectedNode.children.length;
      applyMenuState({
        ...state,
        submenuIndex: (state.submenuIndex + delta + childCount) % childCount,
      });
      return true;
    }
    applyMenuState({
      ...state,
      itemIndex: (state.itemIndex + delta + nodes.length) % nodes.length,
      submenuIndex: null,
    });
    return true;
  }

  if (event.key === 'Home') {
    applyMenuState(state.menuOpen ? { ...state, itemIndex: 0, submenuIndex: null } : { ...state, rootIndex: 0, itemIndex: 0, submenuIndex: null });
    return true;
  }

  if (event.key === 'End') {
    applyMenuState(state.menuOpen
      ? { ...state, itemIndex: Math.max(0, nodes.length - 1), submenuIndex: null }
      : { ...state, rootIndex: Math.max(0, roots.length - 1), itemIndex: 0, submenuIndex: null });
    return true;
  }

  if (event.key === 'Enter' || event.key === ' ') {
    if (!state.menuOpen) {
      applyMenuState({ ...state, itemIndex: 0, submenuIndex: null, menuOpen: true });
      return true;
    }
    if (selectedNode?.kind === 'submenu') {
      if (state.submenuIndex === null) {
        applyMenuState({ ...state, submenuIndex: 0 });
        return true;
      }
      const child = selectedNode.children[state.submenuIndex];
      if (child?.enabled) {
        runtime.execute(child.action);
      }
      return true;
    }
    if (selectedNode?.kind === 'action' && selectedNode.enabled) {
      runtime.execute(selectedNode.action);
    }
    return true;
  }

  return true;
};

const menuAcceleratorFromKeyboardEvent = (event: KeyboardEvent) => {
  if (event.ctrlKey || event.metaKey) {
    return null;
  }
  if (event.code.startsWith('Key')) {
    return event.code.slice(3).toUpperCase();
  }
  return Array.from(event.key).length === 1 ? menuLabelAccelerator(event.key) : null;
};

const rootIndexForAccelerator = (roots: readonly string[], accelerator: string) =>
  roots.findIndex((root) => menuRootAcceleratorFromRegistry(root) === accelerator);

const menuLabelAccelerator = (label: string) => {
  const first = Array.from(label.trim()).find((character) => /[A-Za-z0-9]/.test(character));
  return first ? first.toUpperCase() : null;
};

export const menuShortcutLabel = (action: AppAction) => {
  if (!action.shortcutLabel && !action.keyboardBindings?.length) {
    return '';
  }
  return shortcutLabelForAction(action);
};

const BLANK_CONTEXT_ACTION_IDS = new Set<ActionId>([
  'file.mkdir',
  'file.clipboardPaste',
  'file.clipboardMovePaste',
  'nav.refresh',
  'nav.gotoPath',
  'external.openCurrentInFileManager',
  'external.openCurrentInTerminal',
  'filter.start',
  'filter.clear',
  'view.sortName',
  'view.sortSize',
  'view.sortDate',
  'view.sortExt',
  'view.toggleHidden',
]);

export const blankContextMenuActions = (context: ActionContext, hasFilter: boolean) => filterEnabledActions(
  ACTIONS.filter((action) => actionVisibleOnPlatform(action, context.platform, context.platformInfo) && BLANK_CONTEXT_ACTION_IDS.has(action.id as ActionId))
    .filter((action) => hasFilter || action.id !== 'filter.clear'),
  context,
);

export const contextMenuActions = (entry: FileEntry, context: ActionContext) => {
  const actions = entry.isVirtual
    ? ACTIONS.filter((action) => action.id === 'nav.enter')
    : ACTIONS.filter((action) => actionVisibleOnPlatform(action, context.platform, context.platformInfo) && action.contextScopes?.some((scope) => scope !== 'blank'));
  return filterEnabledActions(actions, context, entry);
};

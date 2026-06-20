import { useEffect } from 'react';

export const COMMANDER_SHORTCUTS_DISABLED_ATTRIBUTE = 'data-commander-shortcuts-disabled';
export const COMMANDER_SHORTCUTS_DISABLED_SELECTOR = `[${COMMANDER_SHORTCUTS_DISABLED_ATTRIBUTE}="true"]`;
export const commanderShortcutsDisabledProps = {
  [COMMANDER_SHORTCUTS_DISABLED_ATTRIBUTE]: 'true',
} as const;
const commanderShortcutsEnabledProps = {};

export type CommanderKeyboardOwner =
  | 'operation-dialog'
  | 'operation-attention-dialog'
  | 'operation-progress-dialog'
  | 'menu-popover'
  | 'context-menu'
  | 'filter-prompt'
  | 'path-prompt'
  | 'shortcut-help'
  | 'help-search'
  | 'about-dialog'
  | `navigation-list-${string}`;

// BokslDirGUI currently renders one commander shell per Tauri window.
// This singleton intentionally models that product invariant: any modal
// owner in the shell suspends commander-wide shortcuts for the whole window.
// If the app grows multiple independent commander shells in one renderer,
// replace this module-level registry with a per-shell React context.
const activeCommanderKeyboardOwnerCounts = new Map<CommanderKeyboardOwner, number>();

export const commanderKeyboardOwners = () => [...activeCommanderKeyboardOwnerCounts.keys()];

// Commander keyboard ownership is intentionally coarse and modal-only:
// any active owner fully suspends global commander shortcuts so dialogs,
// menus, context menus, and prompts can keep native keyboard behavior.
// Do not use this boundary for partially interactive surfaces that should
// still allow row movement or file-operation hotkeys to pass through.
export const commanderKeyboardHasOwner = () => activeCommanderKeyboardOwnerCounts.size > 0;

export const useCommanderKeyboardOwner = (owner: CommanderKeyboardOwner, active = true) => {
  useEffect(() => {
    if (!active) {
      return;
    }

    activeCommanderKeyboardOwnerCounts.set(owner, (activeCommanderKeyboardOwnerCounts.get(owner) ?? 0) + 1);
    return () => {
      const currentCount = activeCommanderKeyboardOwnerCounts.get(owner) ?? 0;
      if (currentCount <= 1) {
        activeCommanderKeyboardOwnerCounts.delete(owner);
        return;
      }

      activeCommanderKeyboardOwnerCounts.set(owner, currentCount - 1);
    };
  }, [owner, active]);
};

export const useCommanderKeyboardBoundaryProps = (owner: CommanderKeyboardOwner, active = true) => {
  useCommanderKeyboardOwner(owner, active);
  return active ? commanderShortcutsDisabledProps : commanderShortcutsEnabledProps;
};

export const elementOwnsTextKeyboard = (target: HTMLElement) =>
  target.isContentEditable
  || Boolean(target.closest('[contenteditable="true"]'))
  || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);

export const elementOwnsNativeKeyboardActivation = (target: HTMLElement) => {
  if (target.classList.contains('commander-shell')) {
    return false;
  }

  return Boolean(target.closest([
    'button',
    'a[href]',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="menuitem"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
  ].join(',')));
};

export const commanderKeyboardIsSuspended = (target: EventTarget | null) => {
  if (commanderKeyboardHasOwner()) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.closest(COMMANDER_SHORTCUTS_DISABLED_SELECTOR)) {
    return true;
  }

  return elementOwnsTextKeyboard(target) || elementOwnsNativeKeyboardActivation(target);
};

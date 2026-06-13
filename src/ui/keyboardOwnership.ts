import { useEffect } from 'react';

export const COMMANDER_SHORTCUTS_DISABLED_ATTRIBUTE = 'data-commander-shortcuts-disabled';
export const COMMANDER_SHORTCUTS_DISABLED_SELECTOR = `[${COMMANDER_SHORTCUTS_DISABLED_ATTRIBUTE}="true"]`;
export const commanderShortcutsDisabledProps = {
  [COMMANDER_SHORTCUTS_DISABLED_ATTRIBUTE]: 'true',
} as const;
const commanderShortcutsEnabledProps = {};

export type CommanderKeyboardOwner = 'operation-dialog' | 'menu-popover' | 'context-menu';

const activeCommanderKeyboardOwnerCounts = new Map<CommanderKeyboardOwner, number>();

export const commanderKeyboardOwners = () => [...activeCommanderKeyboardOwnerCounts.keys()];

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

import type { Dispatch, RefObject, SetStateAction } from 'react';
import { useEffect, useRef } from 'react';
import type { ActionContext } from '../actions/registry';
import {
  isActionAvailable,
  labelForAction,
  matchKeyboardShortcut,
  type AppAction
} from '../actions/registry';
import type { PanelId, Settings } from '../domain/types';
import type { CommanderStatusText } from '../i18n-resources';
import type { ExecuteAction } from './actionRequest';
import { KEYBOARD_SEQUENCE_TIMEOUT_MS, KeyboardRuntime, handleMovementKey, handleZoomKey } from './keyboardDispatch';
import { commanderKeyboardIsSuspended, commanderKeyboardOwners } from './keyboardOwnership';
import { TopMenuKeyboardRuntime, TopMenuState, handleTopMenuKeyDown } from './menuModel';
import { rowDomId } from './panelPresentation';
import type { PanelStateById } from './panelState';
import type { ZoomCommand } from './settingsModel';

interface CommanderKeyboardDependencies {
  readonly activePanel: PanelId;
  readonly panelState: PanelStateById;
  readonly context: ActionContext;
  readonly operationDialogOpen: boolean;
  readonly moveFocusedEntry: (delta: number, extendSelection?: boolean) => void;
  readonly focusBoundaryEntry: (boundary: "first" | "last", extendSelection?: boolean) => void;
  readonly handleAction: ExecuteAction;
  readonly applyZoom: (command: ZoomCommand) => void;
  readonly settings: Settings;
  readonly topMenuStateRef: RefObject<TopMenuState | null>;
  readonly openTopMenu: (rootIndex?: number, menuOpen?: boolean) => void;
  readonly closeTopMenu: () => void;
  readonly setTopMenuState: (next: TopMenuState | null) => void;
  readonly shellRef: RefObject<HTMLElement | null>;
  readonly shortcutSequenceRef: RefObject<readonly string[]>;
  readonly shortcutSequenceTimeoutRef: RefObject<number | null>;
  readonly setStatusMessage: Dispatch<SetStateAction<string | null>>;
  readonly statusText: CommanderStatusText;
}
export function useCommanderKeyboard(dependencies: CommanderKeyboardDependencies) {

  const keyboardRuntimeRef = useRef<KeyboardRuntime | null>(null);

  const topMenuKeyboardRuntimeRef = useRef<TopMenuKeyboardRuntime | null>(null);

  const openFocusedRowContextMenu = () => {
    const row = document.getElementById(rowDomId(dependencies.activePanel, dependencies.panelState[dependencies.activePanel].focusedIndex));
    if (!row) {
      return;
    }
    const rect = row.getBoundingClientRect();
    row.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(48, Math.max(12, rect.width / 3)),
      clientY: rect.top + rect.height / 2,
    }));
  };

  keyboardRuntimeRef.current = {
    context: dependencies.context,
    operationDialogOpen: dependencies.operationDialogOpen,
    moveFocusedEntry: dependencies.moveFocusedEntry,
    focusBoundaryEntry: dependencies.focusBoundaryEntry,
    handleAction: dependencies.handleAction,
    handleZoom: dependencies.applyZoom,
  };

  topMenuKeyboardRuntimeRef.current = {
    context: dependencies.context,
    settings: dependencies.settings,
    getState: () => dependencies.topMenuStateRef.current,
    open: dependencies.openTopMenu,
    close: dependencies.closeTopMenu,
    setState: dependencies.setTopMenuState,
    execute: (action) => {
      dependencies.setTopMenuState(null);
      dependencies.handleAction({ actionId: (action).id });
      dependencies.shellRef.current?.focus({ preventScroll: true });
    },
  };

  useEffect(() => {
    const clearShortcutSequence = () => {
      dependencies.shortcutSequenceRef.current = [];
      if (dependencies.shortcutSequenceTimeoutRef.current) {
        window.clearTimeout(dependencies.shortcutSequenceTimeoutRef.current);
        dependencies.shortcutSequenceTimeoutRef.current = null;
      }
    };

    const runShortcutAction = (shortcutAction: AppAction) => {
      const runtime = keyboardRuntimeRef.current;
      if (!runtime || runtime.operationDialogOpen || commanderKeyboardIsSuspended(document.activeElement)) {
        clearShortcutSequence();
        return;
      }

      if (!isActionAvailable(shortcutAction, runtime.context)) {
        dependencies.setStatusMessage(dependencies.statusText.unavailableInContext(labelForAction(shortcutAction, dependencies.settings.language)));
        dependencies.shellRef.current?.focus({ preventScroll: true });
        return;
      }

      runtime.handleAction({ actionId: (shortcutAction).id });
      dependencies.shellRef.current?.focus({ preventScroll: true });
    };

    const holdShortcutSequence = (sequence: readonly string[], pendingAction: AppAction | null) => {
      dependencies.shortcutSequenceRef.current = sequence;
      if (dependencies.shortcutSequenceTimeoutRef.current) {
        window.clearTimeout(dependencies.shortcutSequenceTimeoutRef.current);
      }
      dependencies.shortcutSequenceTimeoutRef.current = window.setTimeout(() => {
        dependencies.shortcutSequenceRef.current = [];
        dependencies.shortcutSequenceTimeoutRef.current = null;
        if (pendingAction) {
          runShortcutAction(pendingAction);
        }
      }, KEYBOARD_SEQUENCE_TIMEOUT_MS);
    };

    const handleDocumentKeyDown = (event: KeyboardEvent) => {
      const runtime = keyboardRuntimeRef.current;
      if (!runtime || event.defaultPrevented) {
        return;
      }

      const topMenuRuntime = topMenuKeyboardRuntimeRef.current;
      const topMenuOpen = Boolean(topMenuRuntime?.getState());
      const activeKeyboardOwners = commanderKeyboardOwners();
      const onlyTopMenuOwnsKeyboard = activeKeyboardOwners.length === 0
        || activeKeyboardOwners.every((owner) => owner === 'menu-popover');

      const topMenuGlobalShortcutMatch = topMenuOpen && onlyTopMenuOwnsKeyboard && (event.ctrlKey || event.metaKey)
        ? matchKeyboardShortcut(event, [])
        : null;
      if (
        topMenuGlobalShortcutMatch?.status === 'matched'
        && topMenuGlobalShortcutMatch.action.id === 'app.quit'
      ) {
        event.preventDefault();
        event.stopPropagation();
        clearShortcutSequence();
        dependencies.setTopMenuState(null);
        runtime.handleAction({ actionId: (topMenuGlobalShortcutMatch.action).id });
        dependencies.shellRef.current?.focus({ preventScroll: true });
        return;
      }

      if (topMenuOpen && onlyTopMenuOwnsKeyboard && handleTopMenuKeyDown(event, topMenuRuntime)) {
        clearShortcutSequence();
        return;
      }

      if (runtime.operationDialogOpen || commanderKeyboardIsSuspended(event.target)) {
        // Do not call the generic top-menu close helper here: it restores focus
        // to the commander shell and steals keyboard ownership from prompts,
        // inputs, and modal operation controls. Only clear a genuinely open
        // menu state while leaving the current owner focused.
        if (topMenuOpen) {
          dependencies.setTopMenuState(null);
        }
        clearShortcutSequence();
        return;
      }

      if (handleTopMenuKeyDown(event, topMenuRuntime)) {
        clearShortcutSequence();
        return;
      }

      if (handleZoomKey(event, runtime.handleZoom)) {
        clearShortcutSequence();
        dependencies.shellRef.current?.focus({ preventScroll: true });
        return;
      }

      if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
        event.preventDefault();
        event.stopPropagation();
        clearShortcutSequence();
        openFocusedRowContextMenu();
        return;
      }

      const handledByMovement = handleMovementKey(event, {
        moveFocusedEntry: runtime.moveFocusedEntry,
        focusBoundaryEntry: runtime.focusBoundaryEntry,
      });
      if (handledByMovement) {
        clearShortcutSequence();
        dependencies.shellRef.current?.focus({ preventScroll: true });
        return;
      }

      const shortcutMatch = matchKeyboardShortcut(event, dependencies.shortcutSequenceRef.current);
      if (shortcutMatch.status === 'none') {
        clearShortcutSequence();
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      if (shortcutMatch.status === 'pending') {
        holdShortcutSequence(shortcutMatch.sequence, shortcutMatch.action);
        dependencies.shellRef.current?.focus({ preventScroll: true });
        return;
      }

      clearShortcutSequence();
      runShortcutAction(shortcutMatch.action);
    };

    document.addEventListener('keydown', handleDocumentKeyDown, { capture: true });
    return () => {
      document.removeEventListener('keydown', handleDocumentKeyDown, { capture: true });
      clearShortcutSequence();
    };
  }, []);
  return {};
}

import {
  type ActionContext
} from '../actions/registry';
import type { ExecuteAction } from './actionRequest';
import { ZoomCommand } from './settingsModel';

export const KEYBOARD_SEQUENCE_TIMEOUT_MS = 900;

export interface KeyboardRuntime {
  context: ActionContext;
  operationDialogOpen: boolean;
  moveFocusedEntry(delta: number, extendSelection?: boolean): void;
  moveFocusedPage(direction: -1 | 1, extendSelection?: boolean): void;
  focusBoundaryEntry(boundary: 'first' | 'last', extendSelection?: boolean): void;
  handleAction: ExecuteAction;
  handleZoom(command: ZoomCommand): void;
  // 폴더 트리에 키보드가 있을 때의 키(FR-42.6), 커서 줄 DOM id
  handleFolderTreeKey(event: KeyboardEvent, sequencePending: boolean): boolean;
  activeRowDomId: string;
}

export const handleZoomKey = (
  event: KeyboardEvent,
  handleZoom: (command: ZoomCommand) => void,
) => {
  if (!(event.metaKey || event.ctrlKey)) {
    return false;
  }
  if (event.key === '=' || event.key === '+') {
    event.preventDefault();
    event.stopPropagation();
    handleZoom('in');
    return true;
  }
  if (event.key === '-') {
    event.preventDefault();
    event.stopPropagation();
    handleZoom('out');
    return true;
  }
  if (event.key === '0') {
    event.preventDefault();
    event.stopPropagation();
    handleZoom('reset');
    return true;
  }
  return false;
};

interface MovementHandlers {
  moveFocusedEntry(delta: number, extendSelection?: boolean): void;
  moveFocusedPage(direction: -1 | 1, extendSelection?: boolean): void;
  focusBoundaryEntry(boundary: 'first' | 'last', extendSelection?: boolean): void;
}

export const handleMovementKey = (event: KeyboardEvent, handlers: MovementHandlers) => {
  const extendSelection = event.shiftKey;
  const keyHandlers: Partial<Record<string, () => void>> = {
    ArrowUp: () => handlers.moveFocusedEntry(-1, extendSelection),
    ArrowDown: () => handlers.moveFocusedEntry(1, extendSelection),
    PageUp: () => handlers.moveFocusedPage(-1, extendSelection),
    PageDown: () => handlers.moveFocusedPage(1, extendSelection),
    Home: () => handlers.focusBoundaryEntry('first', extendSelection),
    End: () => handlers.focusBoundaryEntry('last', extendSelection),
  };
  const physicalKey = physicalLetterKey(event) ?? event.key.toLowerCase();
  const vimLikeKey = event.ctrlKey || event.metaKey || event.altKey ? null : physicalKey;
  const handler = keyHandlers[event.key]
    ?? (vimLikeKey === 'j' ? () => handlers.moveFocusedEntry(1, false) : undefined)
    ?? (vimLikeKey === 'k' ? () => handlers.moveFocusedEntry(-1, false) : undefined)
    ?? ((event.ctrlKey || event.metaKey) && physicalKey === 'u'
      ? () => handlers.moveFocusedPage(-1, extendSelection)
      : undefined)
    ?? ((event.ctrlKey || event.metaKey) && physicalKey === 'd'
      ? () => handlers.moveFocusedPage(1, extendSelection)
      : undefined);
  if (!handler) {
    return false;
  }

  event.preventDefault();
  event.stopPropagation();
  handler();
  return true;
};

const physicalLetterKey = (event: KeyboardEvent) =>
  /^Key[A-Z]$/.test(event.code) ? event.code.slice(3).toLowerCase() : null;

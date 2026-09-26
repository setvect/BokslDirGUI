import {
  hotkeyLabelForAction,
  hotkeyStripActionsFromRegistry,
  shortcutLabelForAction,
  type AppAction
} from '../actions/registry';
import type { Settings } from '../domain/types';

const HOTKEY_STRIP_HORIZONTAL_PADDING_PX = 24;
const HOTKEY_STRIP_ITEM_PADDING_PX = 22;
const HOTKEY_STRIP_CHAR_WIDTH_PX = 9;
const HOTKEY_STRIP_MIN_VISIBLE = 6;

export const hotkeyStripActionsForWidth = (
  widthPx: number,
  scale = 1,
  actions: readonly AppAction[] = hotkeyStripActionsFromRegistry(),
  language: Settings['language'] = 'en',
) => {
  const availableWidth = Math.max(0, widthPx - HOTKEY_STRIP_HORIZONTAL_PADDING_PX * scale);
  const estimateActionWidth = (action: AppAction) => {
    const shortcut = shortcutLabelForAction(action);
    const label = hotkeyLabelForAction(action, language);
    return Math.ceil((shortcut.length + label.length + 2) * HOTKEY_STRIP_CHAR_WIDTH_PX * scale)
      + HOTKEY_STRIP_ITEM_PADDING_PX * scale;
  };

  let usedWidth = 0;
  const visible: AppAction[] = [];
  for (const action of actions) {
    const itemWidth = estimateActionWidth(action);
    if (visible.length < HOTKEY_STRIP_MIN_VISIBLE || usedWidth + itemWidth <= availableWidth) {
      visible.push(action);
      usedWidth += itemWidth;
    }
  }
  return visible;
};

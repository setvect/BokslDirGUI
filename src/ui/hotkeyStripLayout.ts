import {
  hotkeyLabelForAction,
  hotkeyStripActionsFromRegistry,
  shortcutLabelForAction,
  type AppAction
} from '../actions/registry';
import type { Settings } from '../domain/types';

const HOTKEY_STRIP_HORIZONTAL_PADDING_PX = 24;
const HOTKEY_STRIP_ITEM_PADDING_PX = 22;
// 고정폭 글꼴 15px 기준 실측: 영문·숫자·기호 약 9.03px, 한글·한자 등 넓은 글자는 대체 글꼴로 약 15px
const HOTKEY_STRIP_CHAR_WIDTH_PX = 9.1;
const HOTKEY_STRIP_WIDE_CHAR_WIDTH_PX = 16;
const HOTKEY_STRIP_MIN_VISIBLE = 6;

const WIDE_CHARACTER = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

const textWidth = (text: string) =>
  Array.from(text).reduce((width, char) => width + (WIDE_CHARACTER.test(char) ? HOTKEY_STRIP_WIDE_CHAR_WIDTH_PX : HOTKEY_STRIP_CHAR_WIDTH_PX), 0);

const itemWidth = (text: string, scale: number) =>
  Math.ceil(textWidth(text) * scale) + HOTKEY_STRIP_ITEM_PADDING_PX * scale;

export const hotkeyStripActionsForWidth = (
  widthPx: number,
  scale = 1,
  actions: readonly AppAction[] = hotkeyStripActionsFromRegistry(),
  language: Settings['language'] = 'en',
) => {
  const availableWidth = Math.max(0, widthPx - HOTKEY_STRIP_HORIZONTAL_PADDING_PX * scale);
  const widths = actions.map((action) =>
    itemWidth(`${shortcutLabelForAction(action)}:${hotkeyLabelForAction(action, language)}`, scale));
  if (widths.reduce((total, width) => total + width, 0) <= availableWidth) return [...actions];

  // 다 보이지 않으면 끝의 "+N"(숨긴 개수) 자리를 먼저 남겨 그 버튼이 화면 밖으로 밀리지 않게 함
  const budget = availableWidth - itemWidth(`+${actions.length}`, scale);
  let usedWidth = 0;
  const visible: AppAction[] = [];
  actions.forEach((action, index) => {
    if (visible.length < HOTKEY_STRIP_MIN_VISIBLE || usedWidth + widths[index] <= budget) {
      visible.push(action);
      usedWidth += widths[index];
    }
  });
  return visible;
};

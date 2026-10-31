import {
  hotkeyLabelForAction,
  hotkeyStripActionsFromRegistry,
  shortcutLabelForAction,
  type AppAction
} from '../actions/registry';
import type { Settings } from '../domain/types';

const HOTKEY_STRIP_HORIZONTAL_PADDING_PX = 24;
// 항목 하나의 글자 밖 폭(styles.css `.hotkey`): 좌우 여백 22px(배율 적용) + 키·":"·이름 사이 간격 2px×2와 오른쪽 구분선 1px(배율 미적용)
const HOTKEY_STRIP_ITEM_PADDING_PX = 22;
const HOTKEY_STRIP_ITEM_FIXED_PX = 5;
// 고정폭 글꼴 15px 기준 실측: 영문·숫자·기호 9.03px(Menlo)~9.27px(macOS 앱의 SF Mono), 한글 등 넓은 글자는 대체 글꼴로 약 12.5~15px
const HOTKEY_STRIP_CHAR_WIDTH_PX = 9.3;
const HOTKEY_STRIP_WIDE_CHAR_WIDTH_PX = 16;
const HOTKEY_STRIP_MIN_VISIBLE = 6;

const WIDE_CHARACTER = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]/u;

const textWidth = (text: string) =>
  Array.from(text).reduce((width, char) => width + (WIDE_CHARACTER.test(char) ? HOTKEY_STRIP_WIDE_CHAR_WIDTH_PX : HOTKEY_STRIP_CHAR_WIDTH_PX), 0);

const itemWidth = (text: string, scale: number, fixedPx: number) =>
  Math.ceil(textWidth(text) * scale) + HOTKEY_STRIP_ITEM_PADDING_PX * scale + fixedPx;

export const hotkeyStripActionsForWidth = (
  widthPx: number,
  scale = 1,
  actions: readonly AppAction[] = hotkeyStripActionsFromRegistry(),
  language: Settings['language'] = 'en',
) => {
  const availableWidth = Math.max(0, widthPx - HOTKEY_STRIP_HORIZONTAL_PADDING_PX * scale);
  const widths = actions.map((action) =>
    itemWidth(`${shortcutLabelForAction(action)}:${hotkeyLabelForAction(action, language)}`, scale, HOTKEY_STRIP_ITEM_FIXED_PX));
  if (widths.reduce((total, width) => total + width, 0) <= availableWidth) return [...actions];

  // 다 보이지 않으면 끝의 "+N"(숨긴 개수) 버튼 자리를 먼저 남겨 화면 밖으로 밀리지 않게 함(버튼은 구분선·간격 없음)
  const budget = availableWidth - itemWidth(`+${actions.length}`, scale, 0);
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

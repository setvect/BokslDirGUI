import type { FileShortcutPlatform } from '../domain/runtimePlatform';
import { menuRootAcceleratorFromRegistry, menuRootsFromRegistry } from './registry';

// 레지스트리 액션이 아니라 전용 처리기가 맡는 키의 단축키 도움말 표시 정의(표시 전용, FR-17.5).
// 실제 처리: 목록 이동·확대 `src/ui/keyboardDispatch.ts`, 메뉴 `src/ui/menuModel.ts`, 폴더 트리 `src/ui/useFolderTrees.ts`,
// 우클릭 메뉴 키 `src/ui/useCommanderKeyboard.ts`, 끌기 `src/ui/pointerFileDrag.ts`, 창·목록은 각 대화상자.
// 표시한 키와 처리기의 일치는 `keyGuide.test.ts`(목록 이동·확대·메뉴)와 화면 테스트가 확인
export type KeyGuideGroupId = 'listMovement' | 'folderTree' | 'dialogs' | 'zoom' | 'contextDrag' | 'menu';

type KeyGuideKeys =
  | string
  | Readonly<Record<FileShortcutPlatform, string>>
  | ((platform: FileShortcutPlatform) => string);

export interface KeyGuideEntry {
  readonly id: string;
  readonly keys: KeyGuideKeys;
}

export interface KeyGuideGroup {
  readonly id: KeyGuideGroupId;
  readonly entries: readonly KeyGuideEntry[];
}

const command = (keys: string) => ({ mac: `Cmd+${keys}`, other: `Ctrl+${keys}` });

export const KEY_GUIDE: readonly KeyGuideGroup[] = [
  {
    id: 'listMovement',
    entries: [
      { id: 'list.line', keys: '↑/↓/k/j' },
      { id: 'list.page', keys: 'PageUp/PageDown' },
      { id: 'list.vimPage', keys: { mac: 'Cmd+U/Cmd+D', other: 'Ctrl+U/Ctrl+D' } },
      { id: 'list.edge', keys: 'Home/End' },
      { id: 'list.extend', keys: 'Shift+↑/↓' },
    ],
  },
  {
    id: 'folderTree',
    entries: [
      { id: 'tree.move', keys: '↑/↓/k/j' },
      { id: 'tree.expand', keys: '→/l' },
      { id: 'tree.collapse', keys: '←/h' },
      { id: 'tree.page', keys: 'PageUp/PageDown' },
      { id: 'tree.edge', keys: 'Home/End' },
      { id: 'tree.enter', keys: 'Enter' },
      { id: 'tree.escape', keys: 'Esc' },
    ],
  },
  {
    id: 'dialogs',
    entries: [
      { id: 'dialog.close', keys: 'Esc' },
      { id: 'dialog.confirm', keys: 'Enter' },
      { id: 'dialog.buttons', keys: '←/→' },
      { id: 'dialog.list', keys: '↑/↓' },
      { id: 'dialog.page', keys: 'PageUp/PageDown' },
      { id: 'dialog.edge', keys: 'Home/End' },
      { id: 'dialog.delete', keys: 'Delete/Backspace' },
    ],
  },
  {
    id: 'zoom',
    entries: [
      { id: 'zoom.in', keys: command('=') },
      { id: 'zoom.out', keys: command('-') },
      { id: 'zoom.reset', keys: command('0') },
    ],
  },
  {
    id: 'contextDrag',
    entries: [
      { id: 'context.menu', keys: 'Shift+F10' },
      { id: 'drag.move', keys: 'Shift' },
      { id: 'drag.cancel', keys: 'Esc' },
    ],
  },
  {
    id: 'menu',
    entries: [
      // 메뉴 이름의 밑줄 글자(F·E·V…)는 레지스트리 메뉴 정의에서 가져옴
      {
        id: 'menu.direct',
        keys: (platform) => `${platform === 'mac' ? 'Opt' : 'Alt'}+${menuRootsFromRegistry()
          .map(menuRootAcceleratorFromRegistry)
          .filter(Boolean)
          .join('/')}`,
      },
      { id: 'menu.side', keys: '←/→' },
      { id: 'menu.items', keys: '↑/↓/Home/End' },
      { id: 'menu.run', keys: 'Enter/Space' },
      { id: 'menu.letter', keys: 'A–Z' },
      { id: 'menu.close', keys: 'Esc/F9' },
    ],
  },
];

export const KEY_GUIDE_GROUP_BY_ID: ReadonlyMap<KeyGuideGroupId, KeyGuideGroup> = new Map(KEY_GUIDE.map((group) => [group.id, group]));

export const keyGuideLabel = (entry: KeyGuideEntry, platform: FileShortcutPlatform) => {
  if (typeof entry.keys === 'string') return entry.keys;
  return typeof entry.keys === 'function' ? entry.keys(platform) : entry.keys[platform];
};

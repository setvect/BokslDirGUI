// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { KEY_GUIDE_TEXT } from '../i18n-resources';
import { createActionContext } from '../ui/actionContext';
import { handleMovementKey, handleZoomKey } from '../ui/keyboardDispatch';
import { handleTopMenuKeyDown, menuNodesForRoot, type TopMenuState } from '../ui/menuModel';
import { DEFAULT_SETTINGS, type ZoomCommand } from '../ui/settingsModel';
import { testEntry } from '../ui/testing/fileEntryFixture';
import { KEY_GUIDE, KEY_GUIDE_GROUP_BY_ID, keyGuideLabel } from './keyGuide';
import { menuRootsFromRegistry } from './registry';

const keydown = (init: KeyboardEventInit) => new KeyboardEvent('keydown', { cancelable: true, ...init });
const entryById = (id: string) => KEY_GUIDE.flatMap((group) => group.entries).find((entry) => entry.id === id)!;
const groupEntryIds = (groupId: Parameters<typeof KEY_GUIDE_GROUP_BY_ID.get>[0]) =>
  KEY_GUIDE_GROUP_BY_ID.get(groupId)!.entries.map((entry) => entry.id).sort();

describe('key guide for keys outside the action registry', () => {
  it('describes every entry in both languages with unique ids', () => {
    const ids = KEY_GUIDE.flatMap((group) => group.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const language of ['ko', 'en'] as const) {
      for (const group of KEY_GUIDE) expect(KEY_GUIDE_TEXT[language].groups[group.id]).toBeTruthy();
      expect(Object.keys(KEY_GUIDE_TEXT[language].entries).sort()).toEqual([...ids].sort());
    }
  });

  it('shows platform modifiers and the menu letters from the registry', () => {
    expect(keyGuideLabel(entryById('zoom.in'), 'mac')).toBe('Cmd+=');
    expect(keyGuideLabel(entryById('zoom.in'), 'other')).toBe('Ctrl+=');
    expect(keyGuideLabel(entryById('list.vimPage'), 'other')).toBe('Ctrl+U/Ctrl+D');
    expect(keyGuideLabel(entryById('menu.direct'), 'mac')).toBe('Opt+F/E/V/G/R/A/S/H');
    expect(keyGuideLabel(entryById('menu.direct'), 'other')).toBe('Alt+F/E/V/G/R/A/S/H');
  });

  // 표시한 키를 실제 처리기가 처리하는지 대조. 항목을 추가하면 여기에도 처리 확인 추가 필요
  it('matches the list movement keys handled by the list key handler', () => {
    const checks: Record<string, Array<[KeyboardEventInit, string]>> = {
      'list.line': [[{ key: 'ArrowUp' }, 'entry:-1'], [{ key: 'ArrowDown' }, 'entry:1'], [{ key: 'k', code: 'KeyK' }, 'entry:-1'], [{ key: 'j', code: 'KeyJ' }, 'entry:1']],
      'list.page': [[{ key: 'PageUp' }, 'page:-1'], [{ key: 'PageDown' }, 'page:1']],
      'list.vimPage': [[{ key: 'u', code: 'KeyU', metaKey: true }, 'page:-1'], [{ key: 'd', code: 'KeyD', ctrlKey: true }, 'page:1']],
      'list.edge': [[{ key: 'Home' }, 'edge:first'], [{ key: 'End' }, 'edge:last']],
      'list.extend': [
        [{ key: 'ArrowUp', shiftKey: true }, 'entry:-1:extend'],
        [{ key: 'PageDown', shiftKey: true }, 'page:1:extend'],
        [{ key: 'Home', shiftKey: true }, 'edge:first:extend'],
        [{ key: 'End', shiftKey: true }, 'edge:last:extend'],
      ],
    };
    expect(groupEntryIds('listMovement')).toEqual(Object.keys(checks).sort());
    for (const cases of Object.values(checks)) {
      for (const [init, expected] of cases) {
        const calls: string[] = [];
        const handled = handleMovementKey(keydown(init), {
          moveFocusedEntry: (delta, extend) => calls.push(`entry:${delta}${extend ? ':extend' : ''}`),
          moveFocusedPage: (direction, extend) => calls.push(`page:${direction}${extend ? ':extend' : ''}`),
          focusBoundaryEntry: (boundary, extend) => calls.push(`edge:${boundary}${extend ? ':extend' : ''}`),
        });
        expect(handled, JSON.stringify(init)).toBe(true);
        expect(calls).toEqual([expected]);
      }
    }
  });

  it('matches the zoom keys handled by the zoom key handler', () => {
    const checks: Record<string, Array<[KeyboardEventInit, ZoomCommand]>> = {
      'zoom.in': [[{ key: '=', metaKey: true }, 'in'], [{ key: '+', ctrlKey: true }, 'in']],
      'zoom.out': [[{ key: '-', metaKey: true }, 'out'], [{ key: '-', ctrlKey: true }, 'out']],
      'zoom.reset': [[{ key: '0', metaKey: true }, 'reset'], [{ key: '0', ctrlKey: true }, 'reset']],
    };
    expect(groupEntryIds('zoom')).toEqual(Object.keys(checks).sort());
    for (const cases of Object.values(checks)) {
      for (const [init, expected] of cases) {
        const commands: ZoomCommand[] = [];
        expect(handleZoomKey(keydown(init), (command) => commands.push(command))).toBe(true);
        expect(commands).toEqual([expected]);
      }
    }
  });

  it('matches the menu keys handled by the menu key handler', () => {
    const context = createActionContext({
      activePanel: 'left', focusedEntry: testEntry('/work', 'readme.md'), selectedCount: 0,
      hasOppositePanel: true, shellCommandEnabled: false, operationBusy: false,
    });
    const roots = menuRootsFromRegistry();
    const fileNodes = menuNodesForRoot(roots[0], context, DEFAULT_SETTINGS);
    const press = (init: KeyboardEventInit, state: TopMenuState | null) => {
      const runtime = {
        context, settings: DEFAULT_SETTINGS, getState: () => state,
        open: vi.fn(), close: vi.fn(), setState: vi.fn(), execute: vi.fn(),
      };
      expect(handleTopMenuKeyDown(keydown(init), runtime), JSON.stringify(init)).toBe(true);
      return runtime;
    };
    const open: TopMenuState = { rootIndex: 0, itemIndex: 0, submenuIndex: null, menuOpen: true };
    const checks: Record<string, () => void> = {
      'menu.direct': () => {
        expect(press({ key: 'v', code: 'KeyV', altKey: true }, null).open).toHaveBeenCalledWith(roots.indexOf('View'), true);
      },
      'menu.side': () => {
        expect(press({ key: 'ArrowRight' }, open).setState).toHaveBeenCalledWith(expect.objectContaining({ rootIndex: 1 }));
        expect(press({ key: 'ArrowLeft' }, open).setState).toHaveBeenCalledWith(expect.objectContaining({ rootIndex: roots.length - 1 }));
      },
      'menu.items': () => {
        expect(press({ key: 'ArrowDown' }, open).setState).toHaveBeenCalledWith(expect.objectContaining({ itemIndex: 1 }));
        expect(press({ key: 'End' }, open).setState).toHaveBeenCalledWith(expect.objectContaining({ itemIndex: fileNodes.length - 1 }));
      },
      'menu.run': () => {
        expect(press({ key: 'Enter' }, open).execute).toHaveBeenCalledOnce();
        expect(press({ key: ' ' }, open).execute).toHaveBeenCalledOnce();
      },
      'menu.letter': () => {
        const item = fileNodes.find((node) => node.kind === 'action' && node.enabled && node.accelerator)!;
        expect(press({ key: item.accelerator!.toLowerCase(), code: `Key${item.accelerator}` }, open).execute).toHaveBeenCalledOnce();
      },
      'menu.close': () => {
        expect(press({ key: 'Escape' }, open).close).toHaveBeenCalledOnce();
        expect(press({ key: 'F9' }, open).close).toHaveBeenCalledOnce();
      },
    };
    expect(groupEntryIds('menu')).toEqual(Object.keys(checks).sort());
    for (const check of Object.values(checks)) check();
  });
});

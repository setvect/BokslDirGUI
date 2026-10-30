// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CommanderShell } from './CommanderShell';
import { ShortcutHelpDialog } from './CommanderOverlays';
import { createFixturePanelDataSource } from './panelDataSource';
import { useOperationStore } from '../operations/operationStore';
import { platformInfoFixture, runningProgress } from './testing/clientStubs';
import './testing/commanderTestSetup';

beforeEach(() => vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (Windows NT 10.0)'));
afterEach(() => vi.restoreAllMocks());

it.each(['ko', 'en'] as const)('shows Windows-only shortcut labels throughout %s help', language => {
  render(<ShortcutHelpDialog language={language} platformInfo={platformInfoFixture('windows')} onClose={vi.fn()} />);
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('Alt+F4')).toBeTruthy();
  for (const label of ['Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+Z']) expect(within(dialog).getByText(label)).toBeTruthy();
  expect(dialog.textContent).not.toMatch(/Cmd\+|Opt\+|⌘|⌥/);
});

it('shows the same Windows quit label in the File menu and removes the Command-like path icon', async () => {
  render(<CommanderShell dataSource={createFixturePanelDataSource()} />);
  await userEvent.keyboard('{F9}{ArrowDown}');
  const menu = await screen.findByRole('menu', { name: '파일(F) menu' });
  expect(within(menu).getByText('Alt+F4')).toBeTruthy();
  expect(menu.textContent).not.toContain('Cmd');
  for (const button of screen.getAllByRole('button', { name: '경로 이동' })) {
    expect(button.textContent).toBe('↗');
  }
});

it.each(['panel', 'menubar', 'popover'] as const)('routes Windows Alt+F4 through the quit action from %s', async owner => {
  const quit = vi.fn(async () => undefined);
  render(<CommanderShell dataSource={createFixturePanelDataSource()} appController={{ quit }} />);
  if (owner !== 'panel') await userEvent.keyboard(owner === 'menubar' ? '{F9}' : '{F9}{ArrowDown}');
  fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true });
  expect(quit).not.toHaveBeenCalled();
  expect(fireEvent.keyDown(document, { key: 'F4', code: 'F4', altKey: true })).toBe(false);
  await waitFor(() => expect(quit).toHaveBeenCalledOnce());
});

it('keeps the existing busy-operation guard for the Windows quit action', async () => {
  const quit = vi.fn(async () => undefined);
  useOperationStore.setState({ progress: runningProgress({
    operationId: 'windows-shortcut-copy', totalFiles: 2, completedFiles: 1, currentPath: '/tmp/sample.txt',
  }) });
  render(<CommanderShell dataSource={createFixturePanelDataSource()} appController={{ quit }} />);
  fireEvent.keyDown(document, { key: 'F4', code: 'F4', altKey: true });
  expect(quit).not.toHaveBeenCalled();
  expect(await screen.findByText(/종료 차단/)).toBeTruthy();
});

// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import type { NativeFileClipboard } from '../domain/types';
import { COMMANDER_STATUS_TEXT } from '../i18n-resources';
import { createPanelStates } from './panelState';
import { SAMPLE_LISTINGS } from './commanderFixture';
import { DEFAULT_SETTINGS } from './settingsModel';
import { testEntry } from './testing/fileEntryFixture';
import { renderCommander } from './testing/commanderTestSupport';
import { createFixturePanelDataSource } from './panelDataSource';
import { useOperationStore } from '../operations/operationStore';
import './testing/commanderTestSetup';
import { useFileClipboard } from './useFileClipboard';
vi.mock('../tauri/client', async importOriginal => ({ ...await importOriginal<object>(), isTauriRuntime: () => true }));
vi.mock('../actions/registry', async importOriginal => ({ ...await importOriginal<object>(), fileShortcutPlatform: () => 'mac' }));
afterEach(cleanup);
const file = testEntry('/finder', 'sample.json');
const setup = () => {
  let content: NativeFileClipboard = { changeCount: 10, paths: [file.path], entries: [file] };
  const client = { createDir: vi.fn(), renameEntry: vi.fn(),
    readFileClipboard: vi.fn(async (_: { resolve: boolean }) => ({ ok: true as const, data: content })),
    writeFileClipboard: vi.fn(async (_: { paths: string[] }) => ({ ok: true as const, data: content.changeCount })),
    clearFileClipboard: vi.fn(async (_: { changeCount: number }) => ({ ok: true as const, data: undefined })),
  };
  const dependencies = { settings: DEFAULT_SETTINGS, panelState: createPanelStates(SAMPLE_LISTINGS), statusText: COMMANDER_STATUS_TEXT.ko,
    setStatusMessage: vi.fn(), runtimeBackendAvailable: true, dispatch: vi.fn(), mutationClient: client, operationBusy: false };
  return { client, dependencies, replace: (next: NativeFileClipboard) => { content = next; } };
};
it('reads Finder files and dispatches paste through the existing copy action with the requested destination', async () => {
  const { dependencies, client } = setup();
  const { result } = renderHook(() => useFileClipboard(dependencies));
  await waitFor(() => expect(result.current.clipboardCount).toBe(1));
  act(() => result.current.pasteClipboard('file.clipboardPaste', 'left'));
  await waitFor(() => expect(dependencies.dispatch).toHaveBeenCalledWith(expect.objectContaining({ actionId: 'file.copy', sources: [file], targetDir: SAMPLE_LISTINGS.left.path })));
  expect(client.readFileClipboard).toHaveBeenCalledWith({ resolve: true });
});
it('writes native file URLs on copy and discards the local snapshot when another app copies text', async () => {
  const { dependencies, client, replace } = setup();
  const { result } = renderHook(() => useFileClipboard(dependencies));
  await act(async () => result.current.captureClipboard(ACTION_BY_ID.get('file.clipboardCopy')!, [file], 'right', SAMPLE_LISTINGS.right));
  expect(client.writeFileClipboard).toHaveBeenCalledWith({ paths: [file.path] });
  replace({ changeCount: 11, paths: [], entries: [] });
  await act(async () => result.current.pasteClipboard('file.clipboardPaste', 'left'));
  expect(dependencies.dispatch).not.toHaveBeenCalled();
  expect(result.current.clipboardCount).toBe(0);
});
it('ignores a late native read when the destination has changed', async () => {
  const { dependencies, client } = setup();
  const { result, rerender } = renderHook(() => useFileClipboard(dependencies));
  await waitFor(() => expect(result.current.clipboardCount).toBe(1));
  let resolve!: (value: Awaited<ReturnType<typeof client.readFileClipboard>>) => void;
  client.readFileClipboard.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await act(async () => result.current.pasteClipboard('file.clipboardPaste', 'left'));
  dependencies.panelState = { ...dependencies.panelState, left: { ...dependencies.panelState.left, path: '/changed' } };
  rerender();
  await act(async () => resolve({ ok: true, data: { changeCount: 10, paths: [file.path], entries: [file] } }));
  expect(dependencies.dispatch).not.toHaveBeenCalled();
});
it('moves through confirmation and clears only the clipboard version used by that operation', async () => {
  const { dependencies, client } = setup();
  const { result } = renderHook(() => useFileClipboard(dependencies));
  await act(async () => result.current.pasteClipboard('file.clipboardMovePaste', 'left'));
  const request = dependencies.dispatch.mock.lastCall?.[0];
  expect(request.actionId).toBe('file.move');
  act(() => result.current.completeClipboardMove(request.clipboardMoveSnapshot, { operationId: 'move', kind: 'move', state: 'completed', completedFiles: 1, failedFiles: 0, errors: [] }));
  expect(client.clearFileClipboard).toHaveBeenCalledWith({ changeCount: 10 });
});

it('accepts Finder move sources in the shell and waits for the common move confirmation', async () => {
  const { client } = setup();
  const operations = { startCopy: vi.fn(), startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'finder-move', kind: 'move' as const, state: 'queued' as const } })),
    startDelete: vi.fn(), cancelOperation: vi.fn(), resolveConflict: vi.fn() };
  renderCommander(createFixturePanelDataSource(), client, operations);
  await waitFor(() => expect(client.readFileClipboard).toHaveBeenCalled());
  const shell = screen.getByRole('application');
  shell.focus();
  fireEvent.keyDown(shell, { key: 'v', code: 'KeyV', metaKey: true, altKey: true });
  await waitFor(() => expect(useOperationStore.getState().dialog?.dialogKind).toBe('move'));
  expect(operations.startMove).not.toHaveBeenCalled();
  await act(async () => useOperationStore.getState().confirmDialog());
  expect(operations.startMove).toHaveBeenCalledWith(expect.objectContaining({ sources: [file.path], targetDir: SAMPLE_LISTINGS.right.path }));
});

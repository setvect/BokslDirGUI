// @vitest-environment jsdom
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ACTION_BY_ID, actionsForMenu, fileShortcutPlatform, isActionAvailable, matchKeyboardShortcut, shortcutLabelForAction, shortcutHelpLabelForAction } from '../actions/registry';
import type { TrashUndoPreview } from '../domain/types';
import { useOperationStore } from '../operations/operationStore';
import { createActionContext } from './actionContext';
import { createFixturePanelDataSource } from './panelDataSource';
import { mutationClientStub, operationClientStub, platformInfoFixture } from './testing/clientStubs';
import { renderCommander } from './testing/commanderTestSupport';
import { testEntry } from './testing/fileEntryFixture';
import { useTrashUndo } from './useTrashUndo';
import './testing/commanderTestSetup';
vi.mock('../actions/registry', async original => ({ ...await original<object>(), fileShortcutPlatform: vi.fn(() => 'mac') }));
afterEach(() => vi.mocked(fileShortcutPlatform).mockReturnValue('mac'));
const entry = testEntry('/original', 'deleted.json');
const setup = () => {
  const preview: TrashUndoPreview = { id: 'deleted-batch', entries: [entry] };
  const mutationClient = mutationClientStub({ previewTrashUndo: vi.fn(async () => ({ ok: true as const, data: preview as TrashUndoPreview | null })) });
  const operationClient = operationClientStub({
    startTrashUndo: vi.fn(async (_: { id: string }) => ({ ok: true as const, data: { operationId: 'restore-id', kind: 'restoreTrash' as const, state: 'queued' as const } })) });
  return { preview, mutationClient, operationClient };
};
it('offers Cmd+Z only for available macOS trash receipts, independently of the focused row', () => {
  const action = ACTION_BY_ID.get('file.undoTrash')!;
  const context = createActionContext({ activePanel: 'left', focusedEntry: null, selectedCount: 0, hasOppositePanel: true,
    shellCommandEnabled: false, operationBusy: false, platform: 'mac', trashUndoAvailable: true });
  expect(isActionAvailable(action, context)).toBe(true);
  expect(isActionAvailable(action, { ...context, trashUndoAvailable: false })).toBe(false);
  expect(isActionAvailable(action, { ...context, operationBusy: true })).toBe(false);
  expect(actionsForMenu('Edit', 'other').some(a => a.id === action.id)).toBe(false);
  expect(matchKeyboardShortcut({ key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false }, []).action?.id).toBe(action.id);
});
it('opens a confirmation for recorded sources, starts once, supports cancel, and refreshes both panels', async () => {
  const { mutationClient, operationClient } = setup();
  const dataSource = createFixturePanelDataSource();
  const listDir = vi.spyOn(dataSource, 'listDir');
  renderCommander(dataSource, mutationClient, operationClient);
  await act(async () => {});
  const shell = screen.getByRole('application');
  shell.focus();
  fireEvent.keyDown(shell, { key: 'z', code: 'KeyZ', metaKey: true });
  expect(await screen.findByRole('dialog', { name: '휴지통에서 복원' })).toBeTruthy();
  expect(useOperationStore.getState().dialog?.sources).toEqual([entry]);
  expect(operationClient.startTrashUndo).not.toHaveBeenCalled();
  await act(async () => { await useOperationStore.getState().confirmDialog(); });
  expect(operationClient.startTrashUndo).toHaveBeenCalledExactlyOnceWith({ id: 'deleted-batch' });
  act(() => useOperationStore.getState().cancelOperation());
  expect(operationClient.cancelOperation).toHaveBeenCalledWith({ operationId: 'restore-id' });
  mutationClient.previewTrashUndo.mockResolvedValue({ ok: true, data: null });
  act(() => useOperationStore.getState().applyOperationSummary({ operationId: 'restore-id', kind: 'restoreTrash', state: 'cancelled', completedFiles: 0, failedFiles: 0, errors: [] }));
  await waitFor(() => expect(listDir).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'left' })));
  await waitFor(() => expect(listDir).toHaveBeenCalledWith(expect.objectContaining({ panelId: 'right' })));
  await waitFor(() => expect(mutationClient.previewTrashUndo.mock.calls.length).toBeGreaterThan(1));
});
it('preserves input undo and cancellation before confirmation does not restore files', async () => {
  const { mutationClient, operationClient } = setup();
  renderCommander(createFixturePanelDataSource(), mutationClient, operationClient);
  await act(async () => {});
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  const event = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
  expect(useOperationStore.getState().dialog).toBeNull();
  input.remove();
  const shell = screen.getByRole('application');
  shell.focus();
  fireEvent.keyDown(shell, { key: 'z', code: 'KeyZ', metaKey: true });
  await screen.findByRole('dialog', { name: '휴지통에서 복원' });
  act(() => useOperationStore.getState().cancelOperation());
  expect(operationClient.startTrashUndo).not.toHaveBeenCalled();
  expect(useOperationStore.getState().dialog).toBeNull();
});
it('ignores a late history response once another operation has started', async () => {
  const { mutationClient, operationClient, preview } = setup();
  let resolve!: (result: { ok: true; data: TrashUndoPreview }) => void;
  mutationClient.previewTrashUndo.mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const dependencies = { mutationClient, operationClient, runtimeBackendAvailable: true, operationBusy: false, language: 'ko' as const,
    openOperationDialog: vi.fn(), refreshPanel: vi.fn(), setStatusMessage: vi.fn() };
  const { result, rerender } = renderHook(() => useTrashUndo(dependencies));
  dependencies.operationBusy = true;
  rerender();
  await act(async () => resolve({ ok: true, data: preview }));
  expect(result.current.trashUndoAvailable).toBe(false);
  act(() => result.current.openTrashUndo('left', '/different'));
  expect(dependencies.openOperationDialog).not.toHaveBeenCalled();
});
it('dismisses a stale confirmation and fetches the updated receipt after start rejection', async () => {
  const { mutationClient, operationClient } = setup();
  const dependencies = { mutationClient, operationClient, runtimeBackendAvailable: true, operationBusy: false, language: 'ko' as const,
    openOperationDialog: vi.fn(), refreshPanel: vi.fn(), setStatusMessage: vi.fn() };
  const { result } = renderHook(() => useTrashUndo(dependencies));
  await waitFor(() => expect(result.current.trashUndoAvailable).toBe(true));
  act(() => result.current.openTrashUndo('right', '/other'));
  const request = dependencies.openOperationDialog.mock.lastCall![0];
  mutationClient.previewTrashUndo.mockResolvedValue({ ok: true, data: null });
  await act(async () => expect(request.onOperationStartError({ code: 'trash_undo_stale', messageKey: 'errors.trashUndoStale' })).toBe('dismiss'));
  await waitFor(() => expect(result.current.trashUndoAvailable).toBe(false));
  expect(dependencies.setStatusMessage).toHaveBeenCalled();
});

it('refreshes undo receipts after a deletion completes within one render batch', async () => {
  const { mutationClient, operationClient, preview } = setup();
  mutationClient.previewTrashUndo.mockResolvedValue({ ok: true, data: null });
  operationClient.startDelete.mockResolvedValue({ ok: true, data: { operationId: 'fast-delete', kind: 'trash', state: 'queued' } });
  renderCommander(createFixturePanelDataSource(), mutationClient, operationClient);
  await act(async () => {});
  const shell = screen.getByRole('application');
  shell.focus();
  fireEvent.keyDown(shell, { key: 'd', code: 'KeyD' });
  await screen.findByRole('dialog', { name: '휴지통으로 이동' });
  await act(async () => {
    await useOperationStore.getState().confirmDialog();
    mutationClient.previewTrashUndo.mockResolvedValue({ ok: true, data: preview });
    useOperationStore.getState().applyOperationSummary({ operationId: 'fast-delete', kind: 'trash', state: 'completed', completedFiles: 1, failedFiles: 0, errors: [] });
  });
  await waitFor(() => expect(mutationClient.previewTrashUndo.mock.calls.length).toBeGreaterThan(1));
  await act(async () => {});
  shell.focus();
  fireEvent.keyDown(shell, { key: 'z', code: 'KeyZ', metaKey: true });
  expect(await screen.findByRole('dialog', { name: '휴지통에서 복원' })).toBeTruthy();
  expect(useOperationStore.getState().dialog?.sources).toEqual([entry]);
});

it('connects Windows Ctrl+Z, menu and help to the same receipt confirmation while preserving input undo', async () => {
  vi.mocked(fileShortcutPlatform).mockReturnValue('other');
  const platform = platformInfoFixture('windows');
  const { mutationClient, operationClient } = setup();
  const client = { ...mutationClient, getPlatformInfo: vi.fn(async () => ({ ok: true as const, data: platform })) };
  renderCommander(createFixturePanelDataSource(), client, operationClient);
  await waitFor(() => expect(mutationClient.previewTrashUndo).toHaveBeenCalled());
  await act(async () => {});
  const action = ACTION_BY_ID.get('file.undoTrash')!;
  expect(actionsForMenu('Edit', 'other', platform)).toContain(action);
  expect(shortcutLabelForAction(action, 'other')).toBe('Ctrl+Z');
  expect(shortcutHelpLabelForAction(action, 'other')).toBe('Ctrl+Z');
  const input = document.createElement('input');
  document.body.append(input);
  input.focus();
  const inputUndo = new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', ctrlKey: true, bubbles: true, cancelable: true });
  input.dispatchEvent(inputUndo);
  expect(inputUndo.defaultPrevented).toBe(false);
  expect(useOperationStore.getState().dialog).toBeNull();
  input.remove();
  const shell = screen.getByRole('application');
  shell.focus();
  fireEvent.keyDown(shell, { key: 'z', code: 'KeyZ', ctrlKey: true });
  await screen.findByRole('dialog', { name: '휴지통에서 복원' });
  expect(operationClient.startTrashUndo).not.toHaveBeenCalled();
  await act(async () => useOperationStore.getState().confirmDialog());
  expect(operationClient.startTrashUndo).toHaveBeenCalledExactlyOnceWith({ id: 'deleted-batch' });
});

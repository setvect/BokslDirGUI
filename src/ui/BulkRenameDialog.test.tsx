// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { BulkRenameDialog } from './BulkRenameDialog';
import type { RenamePreview } from '../domain/types';
import { testEntry } from './testing/fileEntryFixture';
import { commanderKeyboardOwners } from './keyboardOwnership';
import { useOperationStore } from '../operations/operationStore';
import { createFixturePanelDataSource } from './panelDataSource';
import { mutationClientStub, operationClientStub } from './testing/clientStubs';
import { renderCommander } from './testing/commanderTestSupport';
import './testing/commanderTestSetup';
afterEach(cleanup);
const source = testEntry('/work', 'old.json');
const row: RenamePreview = { item: { source: source.path, newName: 'new.json', stamp: 'identity' }, changed: true, error: null };
it('requires a current conflict-free preview, owns input keys, and submits only the reviewed plan once', async () => {
  const user = userEvent.setup();
  let resolve!: (value: { ok: true; data: RenamePreview[] }) => void;
  const client = mutationClientStub({ previewBulkRename: vi.fn(() => new Promise<{ ok: true; data: RenamePreview[] }>(done => { resolve = done; })) });
  const onConfirm = vi.fn();
  render(<BulkRenameDialog sources={[source]} language="ko" client={client} onClose={vi.fn()} onConfirm={onConfirm} />);
  expect(commanderKeyboardOwners()).toContain('bulk-rename');
  expect((screen.getByRole('button', { name: '변경 적용' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(client.previewBulkRename).toHaveBeenCalledOnce());
  await act(async () => resolve({ ok: true, data: [row] }));
  await user.type(screen.getByLabelText('접두사'), 'x');
  expect((screen.getByRole('button', { name: '변경 적용' }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(client.previewBulkRename).toHaveBeenCalledTimes(2));
  await act(async () => resolve({ ok: true, data: [{ ...row, error: { code: 'already_exists', messageKey: 'errors.alreadyExists', path: source.path, details: null, recoverable: true } }] }));
  expect((screen.getByRole('button', { name: '변경 적용' }) as HTMLButtonElement).disabled).toBe(true);
  await user.type(screen.getByLabelText('접두사'), 'y');
  await waitFor(() => expect(client.previewBulkRename).toHaveBeenCalledTimes(3));
  await act(async () => resolve({ ok: true, data: [row] }));
  fireEvent.click(screen.getByRole('button', { name: '변경 적용' }));
  fireEvent.click(screen.getByRole('button', { name: '변경 적용' }));
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith([row.item]);
});
it('ignores a stale preview response after the rules change', async () => {
  let stale!: (value: { ok: true; data: RenamePreview[] }) => void;
  const client = mutationClientStub({ previewBulkRename: vi.fn(() => new Promise<{ ok: true; data: RenamePreview[] }>(done => { stale = done; })) });
  render(<BulkRenameDialog sources={[source]} language="ko" client={client} onClose={vi.fn()} onConfirm={vi.fn()} />);
  await waitFor(() => expect(client.previewBulkRename).toHaveBeenCalledOnce());
  const first = stale;
  fireEvent.change(screen.getByLabelText('접두사'), { target: { value: 'changed' } });
  await act(async () => first({ ok: true, data: [row] }));
  expect((screen.getByRole('button', { name: '변경 적용' }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByText('new.json')).toBeNull();
});
it('opens from the file menu and runs through the common operation store with cancellation', async () => {
  const user = userEvent.setup();
  const client = mutationClientStub({ previewBulkRename: vi.fn(async ({ sources }: { sources: string[] }) => ({ ok: true as const,
    data: sources.map(source => ({ ...row, item: { ...row.item, source } })) })) });
  const operations = operationClientStub({
    startBulkRename: vi.fn(async () => ({ ok: true as const, data: { operationId: 'bulk-op', kind: 'rename' as const, state: 'queued' as const } })), cancelOperation: vi.fn(async () => ({ ok: true as const, data: { operationId: 'bulk-op', state: 'cancelling' as const } })) });
  renderCommander(createFixturePanelDataSource(), client, operations);
  await user.click(screen.getByRole('button', { name: '파일(F)' }));
  await user.click(screen.getByRole('menuitem', { name: '다중 이름 변경…' }));
  await waitFor(() => expect((screen.getByRole('button', { name: '변경 적용' }) as HTMLButtonElement).disabled).toBe(false));
  await user.click(screen.getByRole('button', { name: '변경 적용' }));
  await waitFor(() => expect(operations.startBulkRename).toHaveBeenCalledOnce());
  expect(useOperationStore.getState().activeOperationController?.operationId).toBe('bulk-op');
  act(() => useOperationStore.getState().cancelOperation());
  expect(operations.cancelOperation).toHaveBeenCalledWith({ operationId: 'bulk-op' });
  act(() => useOperationStore.getState().applyOperationSummary({
    operationId: 'bulk-op', kind: 'rename', state: 'cancelled', completedFiles: 0, failedFiles: 0, errors: [],
  }));
  // 다른 장기 작업과 같은 "액션 이름 결과" 상태 메시지.
  expect(await screen.findByText('다중 이름 변경 취소됨')).toBeTruthy();
});

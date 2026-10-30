// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useRuntimePlatform } from './useRuntimePlatform';
import type { PlatformInfo } from '../domain/types';
import type { SafeMutationClient } from '../tauri/commanderClients';
import { mutationClientStub } from './testing/clientStubs';

const windows: PlatformInfo = { os: 'windows', features: { openWith: false, currentFolderManager: false, currentFolderTerminal: false, nativeFileClipboard: false, trashUndo: false } };
const client = (getPlatformInfo: SafeMutationClient['getPlatformInfo']): SafeMutationClient => mutationClientStub({ getPlatformInfo });
it('loads backend capabilities and rejects a late result from the previous client', async () => {
  let finish!: (value: { ok: true; data: PlatformInfo }) => void;
  const first = client(() => new Promise(resolve => { finish = resolve; }));
  const second = client(vi.fn(async () => ({ ok: true as const, data: windows })));
  const { result, rerender } = renderHook(({ source }) => useRuntimePlatform(source, true), { initialProps: { source: first } });
  expect(result.current?.features.openWith).toBe(false);
  rerender({ source: second });
  await waitFor(() => expect(result.current?.os).toBe('windows'));
  await act(async () => finish({ ok: true, data: { ...windows, os: 'macos' } }));
  expect(result.current?.os).toBe('windows');
});
it('fails closed when the platform command fails and does not call it in preview', async () => {
  const source = client(vi.fn(async () => { throw new Error('unavailable'); }));
  const { result, rerender } = renderHook(({ available }) => useRuntimePlatform(source, available), { initialProps: { available: false } });
  expect(source.getPlatformInfo).not.toHaveBeenCalled();
  rerender({ available: true });
  await waitFor(() => expect(source.getPlatformInfo).toHaveBeenCalledOnce());
  expect(result.current?.features.trashUndo).toBe(false);
});

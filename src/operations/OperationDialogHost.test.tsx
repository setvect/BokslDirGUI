// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import type { FileEntry } from '../domain/types';
import { tauriClient } from '../tauri/client';
import { OperationDialogHost } from './OperationDialogHost';
import { useOperationStore } from './operationStore';

const sampleEntry: FileEntry = {
  path: '/tmp/source.txt',
  name: 'source.txt',
  kind: 'file',
  sizeBytes: 10,
  modifiedAt: null,
  createdAt: null,
  permissions: '-rw-r--r--',
  owner: 'boksl',
  group: 'staff',
  isHidden: false,
  isVirtual: false,
};

const longOperationPath = '/tmp/BokslDirGUI/src-tauri/target/debug/deps/boksldir_gui_lib-36e5791722219a68.abcdefghijklmnopqrstuvwxyz0123456789.rcgu.o';

describe('OperationDialogHost', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.spyOn(tauriClient, 'listenOperationEvents').mockResolvedValue(() => {});
    useOperationStore.setState({
      dialog: null,
      progress: null,
      conflictPrompt: null,
      summary: null,
      operationHistory: [],
      lastError: null,
      lastConflictDecision: null,
      applyAllConflictDecision: null,
      activeOperationController: null,
    });
  });

  it('renders a safe destructive-operation shell without executing files', () => {
    const action = ACTION_BY_ID.get('file.move');
    if (!action) {
      throw new Error('file.move action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Move to opposite panel')).toBeTruthy();
    expect(screen.getByText('source.txt')).toBeTruthy();
    expect(screen.getByText(/실제 파일 변경은 아직 연결하지 않았습니다/)).toBeTruthy();
    expect(screen.getByText('start_move')).toBeTruthy();
  });

  it('warns when unconnected file-mutation dialogs are backend stubs', () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Copy to opposite panel')).toBeTruthy();
    expect(screen.getByText(/실제 파일 변경은 아직 연결하지 않았습니다/)).toBeTruthy();
    expect(screen.getByText(/operations.backendExecution.stubbedUntilCommandWiring/)).toBeTruthy();
  });

  it('labels delete source paths as delete targets instead of a generic target directory', () => {
    const action = ACTION_BY_ID.get('file.trash');
    if (!action) {
      throw new Error('file.trash action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [sampleEntry],
      targetDir: sampleEntry.path,
      workingDir: '/tmp',
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Delete target')).toBeTruthy();
    expect(screen.getAllByText(sampleEntry.path)).toHaveLength(2);
  });

  it('renders connected create directory input validation without stub warning', async () => {
    const user = userEvent.setup();
    const action = ACTION_BY_ID.get('file.mkdir');
    if (!action) {
      throw new Error('file.mkdir action is required');
    }
    const atomicExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { ...sampleEntry, path: '/tmp/New Folder', name: 'New Folder', kind: 'directory' as const },
    }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor,
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Create Directory')).toBeTruthy();
    expect(screen.queryByText(/실제 파일 변경은 아직 연결하지 않았습니다/)).toBeNull();
    const input = screen.getByLabelText('새 폴더 이름');
    expect(screen.getByText('errors.invalidName')).toBeTruthy();
    await user.type(input, 'New Folder');

    expect(screen.queryByText('errors.invalidName')).toBeNull();
    await user.click(screen.getByRole('button', { name: '확인' }));

    expect(atomicExecutor).toHaveBeenCalledOnce();
  });

  it('disables the primary button while an atomic command is pending', async () => {
    const user = userEvent.setup();
    const action = ACTION_BY_ID.get('file.mkdir');
    if (!action) {
      throw new Error('file.mkdir action is required');
    }
    const atomicExecutor = vi.fn(() => new Promise<{ ok: true; data: FileEntry }>(() => {}));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor,
    });

    render(<OperationDialogHost />);

    await user.type(screen.getByLabelText('새 폴더 이름'), 'New Folder');
    await user.click(screen.getByRole('button', { name: '확인' }));

    const pendingButton = await screen.findByRole('button', { name: '실행 중…' });
    expect(pendingButton).toHaveProperty('disabled', true);
    await user.click(pendingButton);
    expect(atomicExecutor).toHaveBeenCalledOnce();
  });

  it('delays modal progress for short operations and renders details only after the grace period', () => {
    vi.useFakeTimers();
    useOperationStore.setState({
      dialog: null,
      progress: {
        operationId: 'op-progress-detail',
        kind: 'copy',
        state: 'running',
        totalFiles: 4,
        completedFiles: 2,
        totalBytes: 4096,
        completedBytes: 2048,
        currentPath: longOperationPath,
        bytesPerSecond: 1024,
        etaSeconds: 75,
        recentErrorCount: 0,
      },
      conflictPrompt: null,
      summary: null,
      lastError: null,
    });

    render(<OperationDialogHost />);

    expect(screen.queryByLabelText('Operation status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(451);
    });

    expect(screen.getByLabelText('Operation status').className).toContain('is-progress');
    expect(screen.getByLabelText('Operation status').getAttribute('data-commander-shortcuts-disabled')).toBe('true');
    expect(screen.getByTitle(longOperationPath).className).toContain('operation-progress-path');
    expect(screen.getByText(/2\.0 KB \/ 4\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/1\.0 KB\/s/)).toBeTruthy();
    expect(screen.getByText(/ETA 1m 15s/)).toBeTruthy();
  });

  it('does not keep a popup for successful completed operations and auto-clears the terminal summary', () => {
    vi.useFakeTimers();
    useOperationStore.setState({
      dialog: null,
      progress: {
        operationId: 'op-success-auto-clear',
        kind: 'copy',
        state: 'completed',
        totalFiles: 1,
        completedFiles: 1,
        totalBytes: 10,
        completedBytes: 10,
        currentPath: sampleEntry.path,
        bytesPerSecond: 10,
        etaSeconds: 0,
        recentErrorCount: 0,
      },
      conflictPrompt: null,
      summary: {
        operationId: 'op-success-auto-clear',
        kind: 'copy',
        state: 'completed',
        completedFiles: 1,
        failedFiles: 0,
        errors: [],
      },
      lastError: null,
    });

    render(<OperationDialogHost />);

    expect(screen.queryByLabelText('Operation status')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(1201);
    });

    expect(useOperationStore.getState().summary).toBeNull();
    expect(useOperationStore.getState().progress).toBeNull();
  });

  it('renders conflict resolution choices when an operation waits for conflict', () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
    });
    useOperationStore.setState({
      progress: {
        operationId: 'op-conflict',
        kind: 'copy',
        state: 'waitingForConflict',
        totalFiles: 1,
        completedFiles: 0,
        totalBytes: null,
        completedBytes: 0,
        currentPath: sampleEntry.path,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      conflictPrompt: {
        operationId: 'op-conflict',
        source: sampleEntry,
        destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
        defaultDecision: 'skip',
        availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
      },
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Conflict resolution')).toBeTruthy();
    expect(screen.queryByText('Progress')).toBeNull();
    expect(screen.queryByText(/waitingForConflict/)).toBeNull();
    expect(screen.getByText('allOverwrite')).toBeTruthy();
    expect(screen.getByText('cancel')).toBeTruthy();
  });

  it('centers conflict attention when no operation dialog is open', () => {
    useOperationStore.setState({
      dialog: null,
      progress: {
        operationId: 'op-conflict-surface',
        kind: 'copy',
        state: 'waitingForConflict',
        totalFiles: 1,
        completedFiles: 0,
        totalBytes: null,
        completedBytes: 0,
        currentPath: sampleEntry.path,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      conflictPrompt: {
        operationId: 'op-conflict-surface',
        source: sampleEntry,
        destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
        defaultDecision: 'skip',
        availableDecisions: ['overwrite', 'skip', 'cancel'],
      },
      summary: null,
      lastError: null,
    });

    render(<OperationDialogHost />);

    expect(screen.getByLabelText('Operation status').className).toContain('is-attention');
    expect(screen.getByLabelText('Operation status').getAttribute('data-commander-shortcuts-disabled')).toBe('true');
    expect(screen.getByText('Conflict resolution')).toBeTruthy();
    expect(screen.queryByText('Operation progress')).toBeNull();
  });

  it('starts showing progress only after a conflict decision resumes the operation', () => {
    vi.useFakeTimers();
    useOperationStore.setState({
      dialog: null,
      progress: {
        operationId: 'op-conflict-then-progress',
        kind: 'copy',
        state: 'waitingForConflict',
        totalFiles: 1,
        completedFiles: 0,
        totalBytes: 10,
        completedBytes: 0,
        currentPath: sampleEntry.path,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      conflictPrompt: {
        operationId: 'op-conflict-then-progress',
        source: sampleEntry,
        destination: { ...sampleEntry, path: '/tmp/target/source.txt' },
        defaultDecision: 'skip',
        availableDecisions: ['overwrite', 'skip', 'cancel'],
      },
      summary: null,
      lastError: null,
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Conflict resolution')).toBeTruthy();
    expect(screen.queryByText('Operation progress')).toBeNull();

    act(() => {
      screen.getByRole('button', { name: 'overwrite' }).click();
    });

    expect(useOperationStore.getState().conflictPrompt).toBeNull();
    expect(useOperationStore.getState().progress?.state).toBe('running');
    expect(screen.queryByText('Operation progress')).toBeNull();

    act(() => {
      vi.advanceTimersByTime(451);
    });

    expect(screen.getByLabelText('Operation status').className).toContain('is-progress');
    expect(screen.getByLabelText('Operation status').getAttribute('data-commander-shortcuts-disabled')).toBe('true');
    expect(screen.getByText('Operation progress')).toBeTruthy();
  });

  it('dismisses an atomic dialog without cancelling an unrelated active operation', async () => {
    const user = userEvent.setup();
    const copyAction = ACTION_BY_ID.get('file.copy');
    const propertiesAction = ACTION_BY_ID.get('file.properties');
    if (!copyAction || !propertiesAction) {
      throw new Error('copy and properties actions are required');
    }
    const cancelExecutor = vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-background', state: 'cancelling' as const } }));

    await useOperationStore.getState().startLongRunningOperation({
      action: copyAction,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'op-copy-background', kind: 'copy' as const, state: 'queued' as const },
      })),
      cancelExecutor,
    });

    useOperationStore.getState().openDialog({
      action: propertiesAction,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor: vi.fn(async () => ({ ok: true as const, data: sampleEntry })),
    });

    render(<OperationDialogHost />);

    await user.click(screen.getByRole('button', { name: '취소' }));

    expect(cancelExecutor).not.toHaveBeenCalled();
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-copy-background');
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-background',
      state: 'queued',
    });
  });

});

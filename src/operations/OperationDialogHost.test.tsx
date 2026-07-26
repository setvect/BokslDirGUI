// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import type { FileEntry } from '../domain/types';
import { tauriClient } from '../tauri/client';
import { OperationDialogHost, splitOperationProgressPath } from './OperationDialogHost';
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

  it('renders a safe destructive-operation shell without duplicate close/cancel controls', async () => {
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

    expect(screen.getByRole('dialog', { name: 'Move' })).toBeTruthy();
    expect(screen.getByText(sampleEntry.path)).toBeTruthy();
    expect(screen.getByText(/This screen is a preview before running the action/)).toBeTruthy();
    expect(screen.queryByText('start_move')).toBeNull();
    expect(screen.queryByText('file.move')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Move' })).toBeTruthy();
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })));
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

    expect(screen.getByRole('dialog', { name: 'Copy' })).toBeTruthy();
    expect(screen.getByText(/This screen is a preview before running the action/)).toBeTruthy();
    expect(screen.queryByText(/operations.backendExecution.stubbedUntilCommandWiring/)).toBeNull();
  });

  it('describes delete targets without exposing command metadata', () => {
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

    expect(screen.getByRole('dialog', { name: 'Move to Trash' })).toBeTruthy();
    expect(screen.getAllByText(sampleEntry.path)).toHaveLength(1);
    expect(screen.queryByText('Current location')).toBeNull();
    expect(screen.queryByText('source.txt')).toBeNull();
    expect(screen.queryByText('start_delete trash')).toBeNull();
    expect(screen.queryByText('skip')).toBeNull();
  });

  it('shows a multi-item source list once per path without repeating the overview sentence', () => {
    const action = ACTION_BY_ID.get('file.move');
    if (!action) {
      throw new Error('file.move action is required');
    }
    const secondEntry = { ...sampleEntry, path: '/tmp/second.txt', name: 'second.txt' };
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [sampleEntry, secondEntry],
      targetDir: '/tmp/target',
      workingDir: '/tmp',
    });

    render(<OperationDialogHost language="ko" />);

    expect(screen.getByText('2개 항목을 반대 패널로 이동합니다.')).toBeTruthy();
    expect(screen.queryByText('2개 항목을 대상 위치로 이동합니다.')).toBeNull();
    expect(screen.getAllByText(sampleEntry.path)).toHaveLength(1);
    expect(screen.getAllByText(secondEntry.path)).toHaveLength(1);
    expect(screen.getAllByText('/tmp/target')).toHaveLength(1);
  });

  it('keeps hundreds of selected sources inside one bounded source-list region', () => {
    const action = ACTION_BY_ID.get('file.copy');
    if (!action) {
      throw new Error('file.copy action is required');
    }
    const sources = Array.from({ length: 300 }, (_, index) => ({
      ...sampleEntry,
      path: `/tmp/batch/item-${String(index).padStart(3, '0')}.txt`,
      name: `item-${String(index).padStart(3, '0')}.txt`,
    }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources,
      targetDir: '/tmp/target',
      workingDir: '/tmp',
    });

    render(<OperationDialogHost language="ko" />);
    const sourceList = document.querySelector('.operation-source-list');

    expect(screen.getByText('300개 항목을 반대 패널로 복사합니다.')).toBeTruthy();
    expect(sourceList).toBeTruthy();
    expect(sourceList?.querySelectorAll('li')).toHaveLength(300);
    expect(sourceList?.textContent).toContain('/tmp/batch/item-000.txt');
    expect(sourceList?.textContent).toContain('/tmp/batch/item-299.txt');
  });

  it('does not render an empty source section for current-folder operations', () => {
    const action = ACTION_BY_ID.get('file.mkdir');
    if (!action) {
      throw new Error('file.mkdir action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor: vi.fn(),
    });

    render(<OperationDialogHost language="ko" />);

    expect(screen.queryByText('대상 항목')).toBeNull();
    expect(screen.queryByText('현재 폴더 자체를 대상으로 하는 작업입니다.')).toBeNull();
    expect(screen.getByText('현재 위치')).toBeTruthy();
    expect(screen.getByText('/tmp')).toBeTruthy();
  });

  it('closes the delete confirmation dialog after the trash operation starts', async () => {
    const user = userEvent.setup();
    const action = ACTION_BY_ID.get('file.trash');
    if (!action) {
      throw new Error('file.trash action is required');
    }
    const longRunningExecutor = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'op-trash-started', kind: 'delete' as const, state: 'queued' as const },
    }));
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [sampleEntry],
      targetDir: sampleEntry.path,
      workingDir: '/tmp',
      longRunningExecutor,
    });

    render(<OperationDialogHost language="ko" />);

    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '휴지통으로 이동' })).toBeNull());
    expect(longRunningExecutor).toHaveBeenCalledOnce();
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-trash-started',
      kind: 'delete',
      state: 'queued',
    });
  });

  it('splits long operation paths with a middle ellipsis while preserving the full path metadata', () => {
    const display = splitOperationProgressPath(longOperationPath, 64);

    expect(display.full).toBe(longOperationPath);
    expect(display.start.length + (display.end?.length ?? 0)).toBeLessThan(longOperationPath.length);
    expect(display.start).toBe(longOperationPath.slice(0, display.start.length));
    expect(longOperationPath.endsWith(display.end ?? '')).toBe(true);
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

    expect(screen.getByText('New Folder')).toBeTruthy();
    expect(screen.queryByText(/실제 파일 변경은 아직 연결하지 않았습니다/)).toBeNull();
    const input = screen.getByLabelText('New folder name');
    await waitFor(() => expect(document.activeElement).toBe(input));
    expect(screen.getByText('The name is invalid.')).toBeTruthy();
    await user.type(input, 'New Folder');

    expect(screen.queryByText('The name is invalid.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Create Folder' }));

    expect(atomicExecutor).toHaveBeenCalledOnce();
  });

  it('masks archive passwords and keeps them out of operation history', async () => {
    const user = userEvent.setup();
    const action = ACTION_BY_ID.get('archive.create');
    if (!action) {
      throw new Error('archive.create action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'right',
      sources: [sampleEntry],
      targetDir: '/tmp',
      workingDir: '/tmp',
      longRunningExecutor: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'archive-password-test', kind: 'archiveCreate' as const, state: 'queued' as const },
      })),
    });

    render(<OperationDialogHost />);

    const passwordInput = screen.getByLabelText('Password (optional)');
    expect(passwordInput.getAttribute('type')).toBe('password');
    await user.type(passwordInput, 'private-password');
    expect(screen.queryByText('private-password')).toBeNull();
    expect(JSON.stringify(useOperationStore.getState().operationHistory)).not.toContain('private-password');
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

    await user.type(screen.getByLabelText('New folder name'), 'New Folder');
    await user.click(screen.getByRole('button', { name: 'Create Folder' }));

    const pendingButton = await screen.findByRole('button', { name: 'Running…' });
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
    const progressPath = screen.getByTitle(longOperationPath);
    expect(progressPath.className).toContain('operation-progress-path');
    expect(progressPath.getAttribute('aria-label')).toBe(longOperationPath);
    expect(progressPath.textContent).not.toBe(longOperationPath);
    expect(progressPath.textContent).toContain('…');
    expect(progressPath.querySelector('.operation-progress-path-start')).toBeTruthy();
    expect(progressPath.querySelector('.operation-progress-path-end')).toBeTruthy();
    expect(screen.getByText('Operation progress').closest('.operation-progress-layout')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel' }).closest('.operation-progress-actions')).toBeTruthy();
    expect(screen.getByText(/2\.0 KB \/ 4\.0 KB/)).toBeTruthy();
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getByText(/1\.0 KB\/s/)).toBeTruthy();
    expect(screen.getByText(/ETA 1m 15s/)).toBeTruthy();
  });

  it('uses byte progress for the progress bar and percent label when byte totals are known', () => {
    vi.useFakeTimers();
    useOperationStore.setState({
      dialog: null,
      progress: {
        operationId: 'op-progress-byte-percent',
        kind: 'copy',
        state: 'running',
        totalFiles: 100,
        completedFiles: 50,
        totalBytes: 1000,
        completedBytes: 100,
        currentPath: sampleEntry.path,
        bytesPerSecond: 50,
        etaSeconds: 18,
        recentErrorCount: 0,
      },
      conflictPrompt: null,
      summary: null,
      lastError: null,
    });

    render(<OperationDialogHost />);

    act(() => {
      vi.advanceTimersByTime(451);
    });

    const progressBar = screen.getByLabelText('operation progress');
    expect((progressBar.querySelector('span') as HTMLSpanElement | null)?.style.width).toBe('10%');
    expect(screen.getByText(/100 B \/ 1000 B · 10%/)).toBeTruthy();
    expect(screen.queryByText(/100 B \/ 1000 B · 50%/)).toBeNull();
  });

  it('keeps the progress modal visible across non-terminal state transitions for the same operation', () => {
    vi.useFakeTimers();
    useOperationStore.setState({
      dialog: null,
      progress: {
        operationId: 'op-progress-stable',
        kind: 'copy',
        state: 'validating',
        totalFiles: 20622,
        completedFiles: 0,
        totalBytes: 252 * 1024 * 1024,
        completedBytes: 0,
        currentPath: longOperationPath,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
      conflictPrompt: null,
      summary: null,
      lastError: null,
    });

    render(<OperationDialogHost />);

    act(() => {
      vi.advanceTimersByTime(451);
    });

    expect(screen.getByLabelText('Operation status')).toBeTruthy();

    act(() => {
      useOperationStore.getState().applyOperationProgress({
        operationId: 'op-progress-stable',
        kind: 'copy',
        state: 'queued',
        totalFiles: 20622,
        completedFiles: 0,
        totalBytes: 252 * 1024 * 1024,
        completedBytes: 0,
        currentPath: longOperationPath,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      });
    });

    expect(screen.getByLabelText('Operation status')).toBeTruthy();

    act(() => {
      useOperationStore.getState().applyOperationProgress({
        operationId: 'op-progress-stable',
        kind: 'copy',
        state: 'running',
        totalFiles: 20622,
        completedFiles: 10138,
        totalBytes: 252 * 1024 * 1024,
        completedBytes: 165 * 1024 * 1024,
        currentPath: longOperationPath,
        bytesPerSecond: 83 * 1024 * 1024,
        etaSeconds: 1,
        recentErrorCount: 0,
      });
    });

    expect(screen.getByLabelText('Operation status')).toBeTruthy();
    expect(screen.getByText(/10138\/20622/)).toBeTruthy();
    expect(screen.getByText(/165 MB \/ 252 MB · 65%/)).toBeTruthy();
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

  it('uses the selected language for operation status and translated errors', () => {
    useOperationStore.setState({
      lastError: {
        code: 'event_listen_failed',
        messageKey: 'errors.operationEventListenFailed',
        path: null,
        details: {},
        recoverable: true,
      },
    });

    render(<OperationDialogHost language="ko" />);

    expect(screen.getByText('작업 오류')).toBeTruthy();
    expect(screen.getByText(/파일 작업 진행 상태를 확인하지 못했습니다/)).toBeTruthy();
    expect(screen.getByRole('button', { name: '닫기' })).toBeTruthy();
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
        source: { ...sampleEntry, modifiedAt: '2026-07-25T10:00:00+09:00' },
        destination: {
          ...sampleEntry,
          path: '/tmp/target/source.txt',
          sizeBytes: 25,
          modifiedAt: '2026-07-26T10:00:00+09:00',
        },
        defaultDecision: 'skip',
        availableDecisions: ['overwrite', 'skip', 'allOverwrite', 'allSkip', 'cancel'],
      },
    });

    render(<OperationDialogHost />);

    expect(screen.getByText('Conflict resolution')).toBeTruthy();
    expect(screen.queryByText('Progress')).toBeNull();
    expect(screen.queryByText(/waitingForConflict/)).toBeNull();
    expect(screen.getByText('Overwrite All')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Source' }).textContent).toContain('/tmp/source.txt');
    expect(screen.getByRole('region', { name: 'Source' }).textContent).toContain('10 B');
    expect(screen.getByRole('region', { name: 'Destination' }).textContent).toContain('/tmp/target/source.txt');
    expect(screen.getByRole('region', { name: 'Destination' }).textContent).toContain('25 B');
    expect(screen.getByRole('region', { name: 'Destination' }).textContent).toContain('2026-07-26T10:00:00+09:00');
    expect(screen.getAllByRole('button', { name: 'Cancel' })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Skip' }).className).toContain('safe-default');
    expect(screen.getByRole('button', { name: 'Overwrite' }).className).toContain('danger');
  });

  it('shows only a close action after an atomic information result is loaded', async () => {
    const user = userEvent.setup();
    const action = ACTION_BY_ID.get('file.properties');
    if (!action) {
      throw new Error('file.properties action is required');
    }
    useOperationStore.getState().openDialog({
      action,
      panelId: 'left',
      sources: [sampleEntry],
      targetDir: null,
      workingDir: '/tmp',
      atomicExecutor: vi.fn(async () => ({
        ok: true as const,
        data: {
          ...sampleEntry,
          absolutePath: sampleEntry.path,
          extension: 'txt',
          mimeType: 'text/plain',
          readonly: false,
        },
      })),
    });

    render(<OperationDialogHost />);

    await user.click(screen.getByRole('button', { name: 'Show Info' }));

    expect(await screen.findByText('File information')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show Info' })).toBeNull();
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
      screen.getByRole('button', { name: 'Overwrite' }).click();
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
      atomicExecutor: vi.fn(async () => ({
        ok: true as const,
        data: {
          ...sampleEntry,
          absolutePath: sampleEntry.path,
          extension: 'txt',
          mimeType: 'text/plain',
          readonly: false,
        },
      })),
    });

    render(<OperationDialogHost />);

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(cancelExecutor).not.toHaveBeenCalled();
    expect(useOperationStore.getState().dialog).toBeNull();
    expect(useOperationStore.getState().activeOperationController?.operationId).toBe('op-copy-background');
    expect(useOperationStore.getState().progress).toMatchObject({
      operationId: 'op-copy-background',
      state: 'queued',
    });
  });

});

// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTION_BY_ID } from '../actions/registry';
import type { FileEntry } from '../domain/types';
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

describe('OperationDialogHost', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    useOperationStore.setState({
      dialog: null,
      progress: null,
      conflictPrompt: null,
      summary: null,
      lastError: null,
      lastConflictDecision: null,
      applyAllConflictDecision: null,
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
    expect(screen.getByText('allOverwrite')).toBeTruthy();
    expect(screen.getByText('cancel')).toBeTruthy();
  });

});

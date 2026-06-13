// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  it('also warns when safe file-mutation dialogs are backend stubs', () => {
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

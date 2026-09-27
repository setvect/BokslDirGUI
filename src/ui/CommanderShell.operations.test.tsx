// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useOperationStore } from '../operations/operationStore';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing } from './panelState';
import './testing/commanderTestSetup';
import { activePanelLabel, focusedRowText, renderCommander, rowByText, testEntry } from './testing/commanderTestSupport';

describe('CommanderShell operations', () => {

  it('keeps boundary filenames and metadata distinguishable through accessible row details', () => {
    const edgeEntries = [
      testEntry('/edge', '한글-English-123-📦.txt'),
      testEntry('/edge', 'cafe\u0301-조합형'),
      testEntry('/edge', 'README'),
      testEntry('/edge', 'archive.backup.2026.07.tar.gz'),
      { ...testEntry('/edge', '.숨김파일'), isHidden: true },
      { ...testEntry('/edge', 'report-final.txt'), permissions: '-r--r--r--' },
      testEntry('/edge', 'report-finaI.txt'),
    ];
    const dataSource = createFixturePanelDataSource({
      left: createDirectoryListing('left', '/empty', []),
      right: createDirectoryListing('right', '/edge', edgeEntries),
    });
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [] }}
      />,
    );

    for (const entry of edgeEntries) {
      const row = [...container.querySelectorAll<HTMLElement>('.file-panel.is-active .file-row')]
        .find((candidate) => candidate.getAttribute('title')?.includes(`이름: ${entry.name}`));
      expect(row, entry.name).toBeTruthy();
      expect(row?.getAttribute('aria-label')).toContain(entry.name);
      expect(row?.getAttribute('aria-description')).toContain(`경로: ${entry.path}`);
      expect(row?.getAttribute('aria-description')).toContain(`권한: ${entry.permissions}`);
    }
  });

  it('dispatches the copy shortcut directly to the operation client without a preflight dialog', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-shortcut', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(screen.queryByText('Copy to opposite panel')).toBeNull();
    expect(screen.queryByLabelText('Operation status')).toBeNull();
    expect(await screen.findByLabelText('Operation status', {}, { timeout: 1000 })).toBeTruthy();
  });

  it('blocks file-operation shortcuts while another operation is in flight', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    useOperationStore.setState({
      progress: {
        operationId: 'op-busy',
        kind: 'copy',
        state: 'running',
        totalFiles: 1,
        completedFiles: 0,
        totalBytes: null,
        completedBytes: 0,
        currentPath: SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right]?.path ?? null,
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
    });
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('y');

    expect(operationClient.startCopy).not.toHaveBeenCalled();
    expect(await screen.findByText(/현재 컨텍스트에서는 사용할 수 없습니다/)).toBeTruthy();
  });

  it('requires explicit confirmation before a move reaches the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-move-confirmed', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('x');

    expect(await screen.findByRole('dialog', { name: '이동' })).toBeTruthy();
    expect(operationClient.startMove).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '이동' }));

    await waitFor(() => expect(operationClient.startMove).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
  });

  it('moves operation dialog button focus with arrow keys', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-trash-arrow-nav', kind: 'trash' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '휴지통으로 이동' })).toBeTruthy();

    const cancelButton = screen.getByRole('button', { name: '취소' });
    const confirmButton = screen.getByRole('button', { name: '휴지통으로 이동' });
    await waitFor(() => expect(document.activeElement).toBe(cancelButton));

    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(confirmButton);

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cancelButton);

    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(confirmButton);
  });

  it('uses the focused row as the file-operation source when nothing is explicitly selected', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-focused-copy', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(screen.queryByText('Copy to opposite panel')).toBeNull();
  });

  it('clears source selection after a fully successful copy summary', async () => {
    const user = userEvent.setup();
    const selectedPaths = SAMPLE_LISTINGS.right.entries.slice(8, 11).map((entry) => entry.path);
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-clear-selection', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: selectedPaths }}
      />,
    );

    expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(3);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: selectedPaths,
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-clear-selection',
      kind: 'copy',
      state: 'completed',
      completedFiles: 3,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(0));
  });

  it('keeps source selection when a copy summary reports skipped items', async () => {
    const user = userEvent.setup();
    const selectedPaths = SAMPLE_LISTINGS.right.entries.slice(8, 11).map((entry) => entry.path);
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-skipped-selection', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: selectedPaths }}
      />,
    );

    await user.keyboard('y');
    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalled());

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-skipped-selection',
      kind: 'copy',
      state: 'completed',
      completedFiles: 0,
      failedFiles: 0,
      skippedFiles: 3,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(3));
  });

  it('refreshes both panels when a partially completed copy is cancelled', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-cancelled', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(dataSource, undefined, operationClient);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-copy-cancelled',
      kind: 'copy',
      state: 'cancelled',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: SAMPLE_LISTINGS.left.path,
    })));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
  });

  it('uses the focused concrete row for delete and refreshes panels after the backend summary', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-trash-focused', kind: 'trash' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '휴지통으로 이동' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [expect.stringContaining('generic-array-6de08afde610f112')],
      mode: 'trash',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-trash-focused',
      kind: 'trash',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: SAMPLE_LISTINGS.left.path,
    })));
  });

  it('dismisses stale delete dialogs and refreshes the source panel when the backend reports not_found before start', async () => {
    const user = userEvent.setup();
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const stalePath = SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path;
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({
        ok: false as const,
        error: {
          code: 'not_found',
          messageKey: 'errors.notFound',
          path: stalePath,
          details: {},
          recoverable: true,
        },
      })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');
    expect(await screen.findByRole('dialog', { name: '휴지통으로 이동' })).toBeTruthy();
    expect(screen.getAllByText(stalePath).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: '휴지통으로 이동' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [stalePath],
      mode: 'trash',
    }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '휴지통으로 이동' })).toBeNull());
    expect(screen.queryByText(/not_found: errors.notFound/)).toBeNull();
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'right',
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText(/삭제 대상이 이미 없습니다/)).toBeTruthy();
  });

  it('blocks delete on the virtual parent row before it reaches the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={{ left: 0, right: 0 }}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('d');

    expect(operationClient.startDelete).not.toHaveBeenCalled();
    expect(screen.queryByText('휴지통으로 이동')).toBeNull();
    expect(await screen.findByText(/현재 컨텍스트에서는 사용할 수 없습니다/)).toBeTruthy();
  });

  it('requires typed confirmation before permanent delete reaches the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-permanent-ui', kind: 'delete' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        operationClient={operationClient}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={{ left: [], right: [] }}
      />,
    );

    await user.keyboard('{Shift>}d{/Shift}');
    expect(await screen.findByRole('dialog', { name: '영구 삭제' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '영구 삭제' })).toHaveProperty('disabled', true);
    expect(screen.queryByText(/PERMANENT_DELETE/)).toBeNull();
    expect(screen.getByText(/계속하려면 “generic-array-6de08afde610f112”를 입력하세요/)).toBeTruthy();

    await user.type(screen.getByLabelText('영구 삭제 확인 문구'), 'generic-array-6de08afde610f112');
    await user.click(screen.getByRole('button', { name: '영구 삭제' }));

    await waitFor(() => expect(operationClient.startDelete).toHaveBeenCalledWith({
      targets: [expect.stringContaining('generic-array-6de08afde610f112')],
      mode: 'permanent',
      confirmToken: 'PERMANENT_DELETE',
    }));
  });

  it('starts connected long-running copy through the operation client', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-ui', kind: 'copy' as const, state: 'queued' as const } })),
      startMove: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-move-ui', kind: 'move' as const, state: 'queued' as const } })),
      startDelete: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-delete-ui', kind: 'delete' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-ui', state: 'cancelling' as const } })),
      resolveConflict: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-copy-ui', decision: 'skip' as const } })),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.startCopy).toHaveBeenCalledWith({
      sources: expect.any(Array),
      targetDir: SAMPLE_LISTINGS.left.path,
      policy: 'skip',
    }));
    expect(screen.queryByText('Copy to opposite panel')).toBeNull();
    expect(screen.queryByLabelText('Operation status')).toBeNull();
    expect(await screen.findByLabelText('Operation status', {}, { timeout: 1000 })).toBeTruthy();
    expect(useOperationStore.getState().progress).toMatchObject({ operationId: 'op-copy-ui', kind: 'copy' });
  });

  it('creates a directory through the connected atomic command path and refreshes focus', async () => {
    const user = userEvent.setup();
    const created = { ...testEntry(SAMPLE_LISTINGS.right.path, 'New Folder'), kind: 'directory' as const };
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir').mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(
        input.panelId,
        input.path,
        [created, testEntry(input.path, 'sibling.txt')],
        input.sort,
        input.filter,
        7,
      ),
    }));
    const mutationClient = {
      createDir: vi.fn(async () => ({ ok: true as const, data: created })),
      renameEntry: vi.fn(async () => ({ ok: true as const, data: created })),
    };
    const { container } = renderCommander(dataSource, mutationClient);

    await user.keyboard('a');
    const input = await screen.findByLabelText('새 폴더 이름');
    await user.type(input, 'New Folder');
    await user.click(screen.getByRole('button', { name: '새 폴더 만들기' }));

    await waitFor(() => expect(mutationClient.createDir).toHaveBeenCalledWith({
      parent: SAMPLE_LISTINGS.right.path,
      name: 'New Folder',
    }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText('New Folder')).toBeTruthy();
    expect(focusedRowText(container)).toContain('New Folder');
  });

  it('renames the focused entry through the connected atomic command path and keeps row focus', async () => {
    const user = userEvent.setup();
    const renamed = { ...testEntry(SAMPLE_LISTINGS.right.path, '한글-이름-📦') };
    const original = SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right];
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir').mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(
        input.panelId,
        input.path,
        [renamed, testEntry(input.path, 'other.txt')],
        input.sort,
        input.filter,
        8,
      ),
    }));
    const mutationClient = {
      createDir: vi.fn(async () => ({ ok: true as const, data: renamed })),
      renameEntry: vi.fn(async () => ({ ok: true as const, data: renamed })),
    };
    const { container } = renderCommander(dataSource, mutationClient);

    await user.keyboard('{F2}');
    const input = await screen.findByLabelText('새 이름');
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: '한글-이름-📦' } });
    fireEvent.compositionEnd(input, { data: '한글-이름-📦' });
    await user.click(screen.getByRole('button', { name: '이름 변경' }));

    await waitFor(() => expect(mutationClient.renameEntry).toHaveBeenCalledWith({
      path: original.path,
      newName: '한글-이름-📦',
    }));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      path: SAMPLE_LISTINGS.right.path,
    })));
    expect(await screen.findByText('한글-이름-📦')).toBeTruthy();
    expect(focusedRowText(container)).toContain('한글-이름-📦');
  });

  it('opens files through default app and configured external editor command paths', async () => {
    const user = userEvent.setup();
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      loadSettings: vi.fn(async () => ({
        ok: true as const,
        data: {
          schemaVersion: 1,
          theme: 'dark' as const,
          language: 'ko' as const,
          sizeFormat: 'binary' as const,
          external: { editorId: 'vim', shellCommand: { enabled: false } },
          bookmarks: [],
          layout: { singlePanel: false, ratio: '50:50' as const },
          session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
          view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
        },
      })),
      openDefault: vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } })),
      openExternalEditor: vi.fn(async () => ({ ok: true as const, data: { ok: true, messageKey: 'external.dryRun' } })),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClient);
    await screen.findByText('Architecture.md');
    await user.keyboard('{Tab}');
    const fileRow = rowByText(container, 'Architecture.md');
    if (!fileRow) {
      throw new Error('file row is required');
    }

    await waitFor(() => expect(mutationClient.loadSettings).toHaveBeenCalled());
    await user.click(fileRow);
    await user.keyboard('o');
    expect(await screen.findByRole('dialog', { name: '기본 앱으로 열기' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '기본 앱으로 열기' }));
    await waitFor(() => expect(mutationClient.openDefault).toHaveBeenCalledWith({
      path: expect.stringContaining('Architecture.md'),
    }));
    useOperationStore.getState().closeDialog();

    await user.keyboard('e');
    expect(await screen.findByRole('dialog', { name: '터미널 편집기로 열기' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '편집기로 열기' }));
    await waitFor(() => expect(mutationClient.openExternalEditor).toHaveBeenCalledWith({
      path: expect.stringContaining('Architecture.md'),
      editorId: 'vim',
    }));
  });

  it('runs an enabled shell command directly from the input dialog', async () => {
    const user = userEvent.setup();
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      loadSettings: vi.fn(async () => ({
        ok: true as const,
        data: {
          schemaVersion: 1,
          theme: 'dark' as const,
          language: 'ko' as const,
          sizeFormat: 'binary' as const,
          external: { editorId: null, shellCommand: { enabled: true } },
          bookmarks: [],
          layout: { singlePanel: false, ratio: '50:50' as const },
          session: { leftPath: null, rightPath: null, activePanel: 'right' as const },
          view: { zoomStep: 0, density: 'compact' as const, showIcons: true },
        },
      })),
      prepareShellCommand: vi.fn(),
      runShellCommand: vi.fn(async () => ({
        ok: true as const,
        data: {
          exitCode: 0,
          stdout: 'hello\n',
          stderr: '',
          timedOut: false,
        },
      })),
    };
    renderCommander(createFixturePanelDataSource(), mutationClient);

    await waitFor(() => expect(mutationClient.loadSettings).toHaveBeenCalled());
    await user.keyboard(':');
    const input = await screen.findByLabelText('실행할 명령');
    await user.type(input, 'echo hello');
    expect(screen.queryByRole('button', { name: '실행 확인' })).toBeNull();
    await user.click(screen.getByRole('button', { name: '실행' }));

    await waitFor(() => expect(mutationClient.runShellCommand).toHaveBeenCalledWith({
      workingDir: SAMPLE_LISTINGS.right.path,
      command: 'echo',
      args: ['hello'],
    }));
    expect(mutationClient.prepareShellCommand).not.toHaveBeenCalled();
    expect(screen.getByText(/hello/)).toBeTruthy();
  });

  it('blocks Quit while a file operation is in flight', async () => {
    const appController = { quit: vi.fn(async () => undefined) };
    useOperationStore.setState({
      progress: {
        operationId: 'op-copy-active',
        kind: 'copy',
        state: 'running',
        totalFiles: 2,
        completedFiles: 1,
        totalBytes: null,
        completedBytes: 0,
        currentPath: '/tmp/source.txt',
        bytesPerSecond: null,
        etaSeconds: null,
        recentErrorCount: 0,
      },
    });

    render(
      <CommanderShell
        dataSource={createFixturePanelDataSource()}
        appController={appController}
        initialFocusIndex={INITIAL_FOCUS_INDEX}
        initialSelectedPaths={INITIAL_SELECTED_PATHS}
      />,
    );

    expect(fireEvent.keyDown(document, { key: 'q', code: 'KeyQ', metaKey: true })).toBe(false);

    expect(appController.quit).not.toHaveBeenCalled();
    expect(await screen.findByText(/종료 차단/)).toBeTruthy();
  });

  it('does not capture commander Tab while an operation dialog owns focus', async () => {
    const user = userEvent.setup();
    const { container } = renderCommander();

    await user.keyboard('a');
    expect(await screen.findByText('새 폴더')).toBeTruthy();

    await user.keyboard('{Tab}');

    expect(activePanelLabel(container)).toContain('right panel');
  });
});

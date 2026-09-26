// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useOperationStore } from '../operations/operationStore';
import { INITIAL_FOCUS_INDEX, SAMPLE_LISTINGS } from './commanderFixture';
import { CommanderShell } from './CommanderShell';
import { createFixturePanelDataSource } from './panelDataSource';
import { createDirectoryListing } from './panelState';
import './testing/commanderTestSetup';
import { activePanelLabel, focusedRowText, mockedPanelDataSource, renderCommander, rowByText, testEntry } from './testing/commanderTestSupport';

describe('CommanderShell archives', () => {

  it('copies selected entries from an archive virtual directory by extracting only those entries', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveFile = `${archivePath}:/BokslAsset/eslint.config.js`;
    const leftPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', leftPath, []),
        right: createDirectoryListing('right', `${archivePath}:/BokslAsset`, [{
          ...testEntry(`${archivePath}:/BokslAsset`, 'eslint.config.js'),
          path: archiveFile,
          sizeBytes: 737,
          modifiedAt: '2026-06-28T12:33:00',
        }]),
      },
    });
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: { archivePath, encrypted: false, totalEntries: 0, truncated: false, entries: [] },
      })),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-copy', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={mutationClient}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [archiveFile] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: leftPath,
      policy: 'skip',
      entries: ['BokslAsset/eslint.config.js'],
      stripPrefix: 'BokslAsset',
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-copy',
      kind: 'archiveExtract',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(0));
    await waitFor(() => expect(listDirSpy).toHaveBeenCalledWith(expect.objectContaining({
      panelId: 'left',
      path: leftPath,
    })));
    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath,
      password: undefined,
      limit: 50_000,
    }));

  });

  it('asks for an encrypted archive password before copying a member and cancels without starting', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/secret.zip';
    const archiveEntry = { ...testEntry('/tmp', 'secret.zip'), path: archivePath, kind: 'archive' as const };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp/target', []),
        right: createDirectoryListing('right', '/tmp', [archiveEntry]),
      },
    });
    const archiveList = vi.fn(async () => ({
      ok: true as const,
      data: {
        archivePath,
        encrypted: true,
        totalEntries: 1,
        truncated: false,
        entries: [{ ...testEntry(archivePath, 'secret.txt'), path: `${archivePath}!secret.txt` }],
      },
    }));
    const archiveExtract = vi.fn(async () => ({
      ok: true as const,
      data: { operationId: 'encrypted-archive-copy', kind: 'archiveExtract' as const, state: 'queued' as const },
    }));
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract,
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList }}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
      />,
    );

    await user.keyboard('{Enter}');
    await waitFor(() => expect(rowByText(container, 'secret.txt')).not.toBeNull());
    await user.keyboard('y');
    expect(await screen.findByRole('dialog', { name: '압축 파일 암호' })).toBeTruthy();
    expect(archiveExtract).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: '취소' }));
    expect(screen.queryByRole('dialog', { name: '압축 파일 암호' })).toBeNull();
    expect(archiveExtract).not.toHaveBeenCalled();

    await user.keyboard('y');
    const passwordInput = await screen.findByLabelText('암호');
    expect(passwordInput.getAttribute('type')).toBe('password');
    await user.type(passwordInput, 'secret');
    expect(screen.queryByText('secret')).toBeNull();
    await user.click(screen.getByRole('button', { name: '복사' }));

    await waitFor(() => expect(archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: '/tmp/target',
      password: 'secret',
      policy: 'skip',
      entries: ['secret.txt'],
      stripPrefix: '',
    }));
  });

  it('copies a selected archive directory to the opposite normal panel', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveDirectory = `${archivePath}:/BokslAsset/docs`;
    const leftPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', leftPath, []),
        right: createDirectoryListing('right', `${archivePath}:/BokslAsset`, [{
          ...testEntry(`${archivePath}:/BokslAsset`, 'docs'),
          path: archiveDirectory,
          kind: 'directory',
          sizeBytes: null,
        }]),
      },
    });
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-directory-copy', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [archiveDirectory] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: leftPath,
      policy: 'skip',
      entries: ['BokslAsset/docs'],
      stripPrefix: 'BokslAsset',
    }));
  });

  it('copies multiple selected archive entries in one extract operation', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const currentArchivePath = `${archivePath}:/BokslAsset`;
    const archiveDirectory = `${currentArchivePath}/docs`;
    const archiveFile = `${currentArchivePath}/README.md`;
    const leftPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', leftPath, []),
        right: createDirectoryListing('right', currentArchivePath, [
          {
            ...testEntry(currentArchivePath, 'docs'),
            path: archiveDirectory,
            kind: 'directory',
            sizeBytes: null,
          },
          {
            ...testEntry(currentArchivePath, 'README.md'),
            path: archiveFile,
          },
        ]),
      },
    });
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-multi-copy', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [archiveDirectory, archiveFile] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: leftPath,
      policy: 'skip',
      entries: ['BokslAsset/docs', 'BokslAsset/README.md'],
      stripPrefix: 'BokslAsset',
    }));
  });

  it('copies normal entries into an archive virtual directory through archive_add', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveTarget = `${archivePath}:/BokslAsset`;
    const sourcePath = '/tmp/source';
    const sourceFile = `${sourcePath}/README.md`;
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', archiveTarget, []),
        right: createDirectoryListing('right', sourcePath, [{
          ...testEntry(sourcePath, 'README.md'),
          path: sourceFile,
          sizeBytes: 2048,
        }]),
      },
    });
    vi.mocked(dataSource.listDir).mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(input.panelId, input.path, input.path === sourcePath ? [{
        ...testEntry(sourcePath, 'README.md'),
        path: sourceFile,
      }] : [], input.sort, input.filter, 4),
    }));
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: {
          archivePath,
          encrypted: false,
          entries: [],
          totalEntries: 0,
          truncated: false,
        },
      })),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveAdd: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-add', kind: 'archiveAdd' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={mutationClient}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [sourceFile] }}
      />,
    );

    await user.keyboard('y');

    await waitFor(() => expect(operationClient.archiveAdd).toHaveBeenCalledWith({
      sources: [sourceFile],
      archivePath,
      targetInnerDir: 'BokslAsset',
      policy: 'skip',
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-add',
      kind: 'archiveAdd',
      state: 'completed',
      completedFiles: 1,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(0));
    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath,
      password: undefined,
      limit: 50_000,
    }));
  });

  it('refreshes the archive target and keeps selection after a cancelled archive_add', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/archive.zip';
    const archiveTarget = `${archivePath}:/BokslAsset`;
    const sourcePath = '/tmp/source';
    const sourceFile = `${sourcePath}/README.md`;
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', archiveTarget, []),
        right: createDirectoryListing('right', sourcePath, [{
          ...testEntry(sourcePath, 'README.md'),
          path: sourceFile,
        }]),
      },
    });
    vi.mocked(dataSource.listDir).mockImplementation(async (input) => ({
      ok: true as const,
      data: createDirectoryListing(input.panelId, input.path, input.path === sourcePath ? [{
        ...testEntry(sourcePath, 'README.md'),
        path: sourceFile,
      }] : [], input.sort, input.filter, 4),
    }));
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: { archivePath, encrypted: false, totalEntries: 0, truncated: false, entries: [] },
      })),
    };
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveAdd: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-add-cancelled', kind: 'archiveAdd' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={mutationClient}
        operationClient={operationClient}
        initialFocusIndex={{ right: 0 }}
        initialSelectedPaths={{ right: [sourceFile] }}
      />,
    );

    await user.keyboard('y');
    await waitFor(() => expect(operationClient.archiveAdd).toHaveBeenCalled());

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-add-cancelled',
      kind: 'archiveAdd',
      state: 'cancelled',
      completedFiles: 1,
      failedFiles: 0,
      skippedFiles: 0,
      errors: [],
    }));

    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath,
      password: undefined,
      limit: 50_000,
    }));
    expect(container.querySelectorAll('.file-row[aria-selected="true"]')).toHaveLength(1);
  });

  it('opens properties and enters archives as virtual directories', async () => {
    const user = userEvent.setup();
    const archiveEntry = SAMPLE_LISTINGS.left.entries.find((entry) => entry.name === 'release-bundle.zip');
    if (!archiveEntry) {
      throw new Error('archive fixture is required');
    }
    const mutationClient = {
      createDir: vi.fn(),
      renameEntry: vi.fn(),
      getMetadata: vi.fn(async () => ({
        ok: true as const,
        data: {
          ...SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right],
          absolutePath: SAMPLE_LISTINGS.right.entries[INITIAL_FOCUS_INDEX.right].path,
          extension: null,
          mimeType: null,
          readonly: false,
          directoryStats: null,
        },
      })),
      archiveList: vi.fn(async () => ({
        ok: true as const,
        data: {
          archivePath: archiveEntry.path,
          encrypted: false,
          totalEntries: 1,
          truncated: false,
          entries: [{
            ...testEntry(archiveEntry.path, 'inside.txt'),
            path: `${archiveEntry.path}!inside.txt`,
            sizeBytes: 2048,
            modifiedAt: '2026-07-02T23:30:28',
          }],
        },
      })),
    };
    const { container } = renderCommander(createFixturePanelDataSource(), mutationClient);

    await user.keyboard('i');
    expect(await screen.findByRole('dialog', { name: '파일 정보' })).toBeTruthy();
    await waitFor(() => expect(mutationClient.getMetadata).toHaveBeenCalledOnce());
    expect(screen.queryByRole('button', { name: '정보 보기' })).toBeNull();
    expect(screen.queryByText(/absolutePath/)).toBeNull();
    expect(screen.getByText(/Architecture.md/)).toBeTruthy();
    useOperationStore.getState().closeDialog();

    await user.keyboard('{Tab}');
    const archiveRow = rowByText(container, 'release-bundle.zip');
    if (!archiveRow) {
      throw new Error('archive row is required');
    }
    fireEvent.doubleClick(archiveRow);

    await waitFor(() => expect(mutationClient.archiveList).toHaveBeenCalledWith({
      archivePath: archiveEntry.path,
      password: undefined,
      limit: 50_000,
    }));
    await waitFor(() => expect(rowByText(container, 'inside.txt')).not.toBeNull());
    expect(rowByText(container, 'inside.txt')?.textContent).toContain('2.0 KB');
    expect(rowByText(container, 'inside.txt')?.textContent).toContain('07-02 23:30');
    expect(screen.queryByRole('dialog', { name: /압축/ })).toBeNull();
  });

  it('shows archive virtual directories as read-only and reports truncated listings', () => {
    const archiveListing = {
      ...createDirectoryListing('left', '/tmp/large.zip:/', []),
      totalEntries: 80_000,
      truncated: true,
    };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: archiveListing,
        right: createDirectoryListing('right', '/tmp/target', []),
      },
    });

    render(<CommanderShell dataSource={dataSource} />);

    expect(screen.getByText('압축 내부 읽기 전용')).toBeTruthy();
    const partial = screen.getByText('일부만 표시됨');
    expect(partial.getAttribute('title')).toBe('0/80000');
  });

  it('requests a masked password and retries encrypted archive listing without exposing the secret', async () => {
    const user = userEvent.setup();
    const archiveEntry = {
      ...testEntry('/tmp', 'encrypted.7z'),
      path: '/tmp/encrypted.7z',
      kind: 'archive' as const,
    };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp', [archiveEntry]),
        right: createDirectoryListing('right', '/tmp/target', []),
      },
    });
    const archiveList = vi.fn()
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: 'password_required',
          messageKey: 'errors.archivePasswordRequired',
          path: archiveEntry.path,
          details: {},
          recoverable: true,
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        data: {
          archivePath: archiveEntry.path,
          encrypted: true,
          totalEntries: 1,
          truncated: false,
          entries: [{
            ...testEntry(archiveEntry.path, 'secret.txt'),
            path: `${archiveEntry.path}!secret.txt`,
          }],
        },
      });
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList }}
        initialFocusIndex={{ left: 0 }}
      />,
    );

    await user.keyboard('{Tab}');
    await waitFor(() => expect(rowByText(container, 'encrypted.7z')).not.toBeNull());
    fireEvent.doubleClick(rowByText(container, 'encrypted.7z')!);

    const passwordInput = await screen.findByLabelText('암호');
    expect(passwordInput.getAttribute('type')).toBe('password');
    await user.type(passwordInput, 'top-secret');
    expect(screen.queryByText('top-secret')).toBeNull();
    await user.click(screen.getByRole('button', { name: '열기' }));

    await waitFor(() => expect(archiveList).toHaveBeenLastCalledWith({
      archivePath: archiveEntry.path,
      password: 'top-secret',
      limit: 50_000,
    }));
    await waitFor(() => expect(rowByText(container, 'secret.txt')).not.toBeNull());
    expect(screen.queryByRole('dialog', { name: '압축 파일 암호' })).toBeNull();
  });

  it('navigates archive folders with Enter and returns to the archive root with Backspace', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/navigation.zip';
    const archiveEntry = {
      ...testEntry('/tmp', 'navigation.zip'),
      path: archivePath,
      kind: 'archive' as const,
    };
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp', [archiveEntry]),
        right: createDirectoryListing('right', '/tmp/target', []),
      },
    });
    let modifiedAt = '2026-09-25T12:00:00Z';
    const getMetadata = vi.fn(async () => ({
      ok: true as const,
      data: {
        ...archiveEntry,
        modifiedAt,
        absolutePath: archivePath,
        extension: 'zip',
        mimeType: 'application/zip',
        readonly: false,
        directoryStats: null,
      },
    }));
    const archiveList = vi.fn(async () => ({
      ok: true as const,
      data: {
        archivePath,
        encrypted: false,
        totalEntries: 2,
        truncated: false,
        entries: [
          { ...testEntry(archivePath, 'folder'), path: `${archivePath}!folder/`, kind: 'directory' as const },
          { ...testEntry(archivePath, 'nested.txt'), path: `${archivePath}!folder/nested.txt` },
        ],
      },
    }));
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList, getMetadata }}
        initialFocusIndex={{ left: 0 }}
      />,
    );

    await user.keyboard('{Tab}{Enter}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/`));
    await waitFor(() => expect(focusedRowText(container)).toContain('folder'));

    await user.keyboard('{Enter}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/folder`));
    expect(rowByText(container, 'nested.txt')).not.toBeNull();

    await user.keyboard('{Backspace}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/`));
    expect(activePanelLabel(container)).not.toContain(`${archivePath}:/folder`);
    expect(archiveList).toHaveBeenCalledTimes(1);

    modifiedAt = '2026-09-25T12:00:01Z';
    await user.keyboard('{Enter}');
    await waitFor(() => expect(activePanelLabel(container)).toContain(`${archivePath}:/folder`));
    expect(archiveList).toHaveBeenCalledTimes(2);

    await user.keyboard('{Control>}r{/Control}');
    await waitFor(() => expect(archiveList).toHaveBeenCalledTimes(3));
  });

  it('selects multiple archive entries with Space and copies them to the normal panel', async () => {
    const user = userEvent.setup();
    const archivePath = '/tmp/multi.zip';
    const archiveEntry = {
      ...testEntry('/tmp', 'multi.zip'),
      path: archivePath,
      kind: 'archive' as const,
    };
    const targetPath = '/tmp/target';
    const dataSource = mockedPanelDataSource({
      loadInitialOnMount: false,
      initial: {
        left: createDirectoryListing('left', '/tmp', [archiveEntry]),
        right: createDirectoryListing('right', targetPath, []),
      },
    });
    const archiveList = vi.fn(async () => ({
      ok: true as const,
      data: {
        archivePath,
        encrypted: false,
        totalEntries: 2,
        truncated: false,
        entries: [
          { ...testEntry(archivePath, 'one.txt'), path: `${archivePath}!one.txt` },
          { ...testEntry(archivePath, 'two.txt'), path: `${archivePath}!two.txt` },
        ],
      },
    }));
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveExtract: vi.fn(async () => ({
        ok: true as const,
        data: { operationId: 'archive-space-copy', kind: 'archiveExtract' as const, state: 'queued' as const },
      })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    const { container } = render(
      <CommanderShell
        dataSource={dataSource}
        mutationClient={{ createDir: vi.fn(), renameEntry: vi.fn(), archiveList }}
        operationClient={operationClient}
        initialFocusIndex={{ left: 0 }}
      />,
    );

    await user.keyboard('{Tab}{Enter}');
    await waitFor(() => expect(rowByText(container, 'one.txt')).not.toBeNull());
    await user.keyboard('{Space}{Space}y');

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath,
      targetDir: targetPath,
      policy: 'skip',
      entries: ['one.txt', 'two.txt'],
      stripPrefix: '',
      password: undefined,
    }));
    expect(operationClient.startCopy).not.toHaveBeenCalled();
  });

  it('starts archive creation through the connected operation client in the source panel directory', async () => {
    const user = userEvent.setup();
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveCreate: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-create', kind: 'archiveCreate' as const, state: 'queued' as const } })),
      archiveExtract: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(createFixturePanelDataSource(), undefined, operationClient);

    await user.keyboard('zc');
    expect(await screen.findByRole('dialog', { name: '압축 생성' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '압축 생성' }));

    await waitFor(() => expect(operationClient.archiveCreate).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetArchive: `${SAMPLE_LISTINGS.right.path}/generic-array-6de08afde610f112.zip`,
      format: 'zip',
    }));
  });

  it('numbers a new archive against names in the source panel directory', async () => {
    const user = userEvent.setup();
    const archiveName = 'generic-array-6de08afde610f112.zip';
    const rightListing = {
      ...SAMPLE_LISTINGS.right,
      entries: [...SAMPLE_LISTINGS.right.entries, testEntry(SAMPLE_LISTINGS.right.path, archiveName)],
    };
    const dataSource = createFixturePanelDataSource({ ...SAMPLE_LISTINGS, right: rightListing });
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveCreate: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-numbered', kind: 'archiveCreate' as const, state: 'queued' as const } })),
      archiveExtract: vi.fn(),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    renderCommander(dataSource, undefined, operationClient);

    await user.keyboard('zc');
    expect(await screen.findByRole('dialog', { name: '압축 생성' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '압축 생성' }));

    await waitFor(() => expect(operationClient.archiveCreate).toHaveBeenCalledWith({
      sources: [expect.stringContaining('generic-array-6de08afde610f112')],
      targetArchive: `${SAMPLE_LISTINGS.right.path}/generic-array-6de08afde610f112 (2).zip`,
      format: 'zip',
    }));
  });

  it('uses auto-extract to derive a target folder from the archive name and refresh panels', async () => {
    const user = userEvent.setup();
    const archiveEntry = SAMPLE_LISTINGS.left.entries.find((entry) => entry.name === 'release-bundle.zip');
    if (!archiveEntry) {
      throw new Error('archive fixture is required');
    }
    const dataSource = createFixturePanelDataSource();
    const listDirSpy = vi.spyOn(dataSource, 'listDir');
    const operationClient = {
      startCopy: vi.fn(),
      startMove: vi.fn(),
      startDelete: vi.fn(),
      archiveCreate: vi.fn(),
      archiveExtract: vi.fn(async () => ({ ok: true as const, data: { operationId: 'op-archive-extract-auto', kind: 'archiveExtract' as const, state: 'queued' as const } })),
      cancelOperation: vi.fn(),
      resolveConflict: vi.fn(),
    };
    render(
      <CommanderShell
        dataSource={dataSource}
        operationClient={operationClient}
        initialFocusIndex={{ left: 4, right: INITIAL_FOCUS_INDEX.right }}
        initialSelectedPaths={{ left: [archiveEntry.path], right: [] }}
      />,
    );

    await user.keyboard('{Tab}');
    await user.keyboard('za');
    expect(await screen.findByRole('dialog', { name: '압축 해제' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: '압축 해제' }));

    await waitFor(() => expect(operationClient.archiveExtract).toHaveBeenCalledWith({
      archivePath: expect.stringContaining('release-bundle.zip'),
      targetDir: `${SAMPLE_LISTINGS.right.path}/release-bundle`,
      policy: 'skip',
    }));

    act(() => useOperationStore.getState().applyOperationSummary({
      operationId: 'op-archive-extract-auto',
      kind: 'archiveExtract',
      state: 'completed',
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
});

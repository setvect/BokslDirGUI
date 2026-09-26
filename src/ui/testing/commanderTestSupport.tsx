import { render } from '@testing-library/react';
import { type ComponentProps } from 'react';
import { vi } from 'vitest';
import type { AppError, DirectoryListing } from '../../domain/types';
import { INITIAL_FOCUS_INDEX, INITIAL_SELECTED_PATHS } from '../commanderFixture';
import { CommanderShell } from '../CommanderShell';
import { useCommanderKeyboardOwner } from '../keyboardOwnership';
import type { PanelDataSource } from '../panelDataSource';
import { createFixturePanelDataSource } from '../panelDataSource';
import { createDirectoryListing, DEFAULT_SORT } from '../panelState';
import { testEntry } from './fileEntryFixture';

export const commanderElement = (
  dataSource: PanelDataSource = createFixturePanelDataSource(),
  mutationClient?: ComponentProps<typeof CommanderShell>['mutationClient'],
  operationClient?: ComponentProps<typeof CommanderShell>['operationClient'],
  runtimeBackendAvailable = true,
) => (
  <CommanderShell
    dataSource={dataSource}
    mutationClient={mutationClient}
    operationClient={operationClient}
    runtimeBackendAvailable={runtimeBackendAvailable}
    initialFocusIndex={INITIAL_FOCUS_INDEX}
    initialSelectedPaths={INITIAL_SELECTED_PATHS}
  />
);

export const renderCommander = (
  dataSource: PanelDataSource = createFixturePanelDataSource(),
  mutationClient?: ComponentProps<typeof CommanderShell>['mutationClient'],
  operationClient?: ComponentProps<typeof CommanderShell>['operationClient'],
  runtimeBackendAvailable = true,
) => render(commanderElement(dataSource, mutationClient, operationClient, runtimeBackendAvailable));

export const activePanelLabel = (container: HTMLElement) =>
  container.querySelector('.file-panel.is-active')?.getAttribute('aria-label') ?? '';

export const focusedRow = (container: HTMLElement) => container.querySelector('.file-panel.is-active .file-row.is-focused');

export const focusedRowText = (container: HTMLElement) => focusedRow(container)?.textContent ?? '';

export const rowByText = (container: HTMLElement, text: string) =>
  [...container.querySelectorAll<HTMLElement>('.file-panel.is-active .file-row')]
    .find((row) => row.textContent?.includes(text)) ?? null;

interface MockedPanelDataSourceOptions {
  initial: Record<'left' | 'right', DirectoryListing>;
  loadInitialOnMount: boolean;
  loadResult?: Record<'left' | 'right', DirectoryListing>;
  loadError?: AppError;
}

export const mockedPanelDataSource = ({
  initial,
  loadInitialOnMount,
  loadResult = initial,
  loadError,
}: MockedPanelDataSourceOptions): PanelDataSource => ({
  initialListings: initial,
  loadInitialOnMount,
  loadInitialListings: vi.fn(async () => loadError
    ? ({ left: { ok: false as const, error: loadError }, right: { ok: false as const, error: loadError } })
    : ({ left: { ok: true as const, data: loadResult.left }, right: { ok: true as const, data: loadResult.right } })),
  listDir: vi.fn(async (input) => ({
    ok: true as const,
    data: createDirectoryListing(input.panelId, input.path, [testEntry(input.path, 'child.txt')], input.sort, input.filter, 3),
  })),
  gotoPath: vi.fn(async (input) => ({
    ok: true as const,
    data: createDirectoryListing(input.panelId, input.path, [testEntry(input.path, 'goto-child.txt')], DEFAULT_SORT, null, 3),
  })),
  listLocations: vi.fn(async () => ({
    ok: true as const,
    data: { home: loadResult.right.path, roots: [loadResult.left.path], recent: [loadResult.right.path], bookmarks: [] },
  })),
});

export const emptyListings = (leftPath: string, rightPath: string): Record<'left' | 'right', DirectoryListing> => ({
  left: createDirectoryListing('left', leftPath, []),
  right: createDirectoryListing('right', rightPath, []),
});

export { testEntry } from './fileEntryFixture';

export function KeyboardOwnerProbe({ label }: { label: string }) {
  useCommanderKeyboardOwner('menu-popover');
  return <div>{label}</div>;
}

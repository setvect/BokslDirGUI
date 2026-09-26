import type { DirectoryListing, FileEntry, OperationSummary, PanelId } from '../domain/types';
import { type DialogKind } from '../operations/operationTypes';
import {
  type PanelNavigationState
} from './panelState';

export type PanelUiPatch = Partial<Pick<PanelNavigationState, 'focusedIndex' | 'selectedPaths'>>;
export type SelectionMode = 'replace' | 'additive' | 'range';

export const contextMenuSources = (entry: FileEntry, listing: DirectoryListing, selectedPaths: readonly string[]) => {
  if (entry.isVirtual) {
    return [];
  }
  const selectedSet = new Set(selectedPaths);
  if (!selectedSet.has(entry.path)) {
    return [entry];
  }
  const selectedEntries = listing.entries.filter((candidate) => selectedSet.has(candidate.path) && !candidate.isVirtual);
  return selectedEntries.length > 0 ? selectedEntries : [entry];
};

export const shouldClearSourceSelectionAfterOperation = (
  summary: OperationSummary,
  dialogKind: DialogKind,
) => {
  const skippedFiles = summary.skippedFiles ?? 0;
  return summary.state === 'completed' && summary.failedFiles === 0 && skippedFiles === 0 && sourceSelectionConsumingDialogKinds.has(dialogKind);
};

const sourceSelectionConsumingDialogKinds = new Set<DialogKind>([
  'copy',
  'move',
  'trash',
  'deletePermanent',
  'archiveCreate',
  'archiveExtract',
]);

export const sourcesBelongToListing = (sources: readonly FileEntry[], listing: DirectoryListing) => {
  const listingPaths = new Set(listing.entries.filter((entry) => !entry.isVirtual).map((entry) => entry.path));
  return sources.every((source) => listingPaths.has(source.path));
};

export const oppositePanelOf = (panelId: PanelId): PanelId => (panelId === 'left' ? 'right' : 'left');

export const reassignPanelState = (panel: PanelNavigationState, panelId: PanelId): PanelNavigationState => ({
  ...panel,
  listing: { ...panel.listing, panelId },
});

export const selectedPathsInRange = (entries: readonly FileEntry[], anchorIndex: number, focusIndex: number) => {
  const start = Math.max(0, Math.min(anchorIndex, focusIndex));
  const end = Math.min(entries.length - 1, Math.max(anchorIndex, focusIndex));
  return entries
    .slice(start, end + 1)
    .filter((entry) => !entry.isVirtual)
    .map((entry) => entry.path);
};

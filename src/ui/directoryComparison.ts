import type { DirectoryListing, FileEntry, PanelId, Settings } from '../domain/types';

export type DirectoryComparisonState = 'same' | 'different' | 'left-only' | 'right-only';
export interface DirectoryComparison {
  byPanel: Record<PanelId, Record<string, DirectoryComparisonState>>;
  same: number;
  different: number;
  leftOnly: number;
  rightOnly: number;
}

export const compareDirectoryListings = (left: DirectoryListing, right: DirectoryListing): DirectoryComparison => {
  const leftEntries = new Map(left.entries.filter((entry) => !entry.isVirtual).map((entry) => [entry.name, entry]));
  const rightEntries = new Map(right.entries.filter((entry) => !entry.isVirtual).map((entry) => [entry.name, entry]));
  const byPanel: DirectoryComparison['byPanel'] = { left: {}, right: {} };
  let same = 0;
  let different = 0;
  let leftOnly = 0;
  let rightOnly = 0;

  for (const [name, leftEntry] of leftEntries) {
    const rightEntry = rightEntries.get(name);
    if (!rightEntry) {
      byPanel.left[leftEntry.path] = 'left-only';
      leftOnly += 1;
      continue;
    }
    const state: DirectoryComparisonState = entriesMatchForComparison(leftEntry, rightEntry) ? 'same' : 'different';
    byPanel.left[leftEntry.path] = state;
    byPanel.right[rightEntry.path] = state;
    if (state === 'same') same += 1;
    else different += 1;
  }

  for (const [name, rightEntry] of rightEntries) {
    if (!leftEntries.has(name)) {
      byPanel.right[rightEntry.path] = 'right-only';
      rightOnly += 1;
    }
  }

  return { byPanel, same, different, leftOnly, rightOnly };
};

const entriesMatchForComparison = (left: FileEntry, right: FileEntry) => {
  if (left.kind !== right.kind) return false;
  if (left.kind === 'directory') return true;
  return left.sizeBytes === right.sizeBytes && left.modifiedAt === right.modifiedAt;
};

export const directoryComparisonLabel = (state: DirectoryComparisonState, language: Settings['language']) => {
  const labels: Record<Settings['language'], Record<DirectoryComparisonState, string>> = {
    ko: { same: '폴더 비교: 동일', different: '폴더 비교: 내용 다름', 'left-only': '폴더 비교: 왼쪽에만 있음', 'right-only': '폴더 비교: 오른쪽에만 있음' },
    en: { same: 'Directory compare: same', different: 'Directory compare: different', 'left-only': 'Directory compare: left only', 'right-only': 'Directory compare: right only' },
  };
  return labels[language][state];
};

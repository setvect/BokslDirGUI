import type { FileEntry, SortSpec } from '../domain/types';
import {
  isArchiveVirtualPath,
  parseArchiveVirtualPath
} from './archiveVirtual';

export interface ArchiveCopyPlan {
  archivePath: string;
  entries: string[];
  stripPrefix: string;
  password?: string;
}

export interface ArchiveAddPlan {
  archivePath: string;
  targetInnerDir: string;
}

export const archiveCopyPlanForSources = (
  sources: readonly FileEntry[],
  workingDir: string,
  targetDir: string,
  password?: string,
): ArchiveCopyPlan | null => {
  if (sources.length === 0 || isArchiveVirtualPath(targetDir)) {
    return null;
  }
  const workingArchive = parseArchiveVirtualPath(workingDir);
  if (!workingArchive) {
    return null;
  }
  const parsedSources = sources.map((source) => parseArchiveVirtualPath(source.path));
  if (parsedSources.some((source) => !source || !source.innerPath || source.archivePath !== workingArchive.archivePath)) {
    return null;
  }
  return {
    archivePath: workingArchive.archivePath,
    entries: [...new Set(parsedSources.map((source) => source?.innerPath).filter(Boolean) as string[])],
    stripPrefix: workingArchive.innerPath,
    password,
  };
};

export const archiveAddPlanForTarget = (
  sources: readonly FileEntry[],
  targetDir: string,
): ArchiveAddPlan | null => {
  const target = parseArchiveVirtualPath(targetDir);
  if (!target || sources.length === 0 || sources.some((source) => source.isVirtual || isArchiveVirtualPath(source.path))) {
    return null;
  }
  return {
    archivePath: target.archivePath,
    targetInnerDir: target.innerPath,
  };
};

type SortActionId = 'view.sortName' | 'view.sortSize' | 'view.sortDate' | 'view.sortExt';

export const sortFieldForAction = (actionId: SortActionId): SortSpec['field'] => {
  const mapping: Record<SortActionId, SortSpec['field']> = {
    'view.sortName': 'name',
    'view.sortSize': 'size',
    'view.sortDate': 'modifiedAt',
    'view.sortExt': 'extension',
  };
  return mapping[actionId];
};

export const archiveFormatForPath = (path: string) => {
  const lowered = path.toLowerCase();
  if (lowered.endsWith('.tar.gz') || lowered.endsWith('.tgz')) return 'tar.gz';
  if (lowered.endsWith('.tar.zst') || lowered.endsWith('.tzst')) return 'tar.zst';
  if (lowered.endsWith('.jar')) return 'jar';
  if (lowered.endsWith('.war')) return 'war';
  if (lowered.endsWith('.tar')) return 'tar';
  if (lowered.endsWith('.7z')) return '7z';
  return 'zip';
};

export const parseShellCommandInput = (value: string): { command: string; args: string[] } | null => {
  const parts = value.trim().match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) =>
    part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part,
  ) ?? [];
  const [command, ...args] = parts;
  return command ? { command, args } : null;
};

export const archiveAutoExtractFolderName = (archiveName: string) => {
  const trimmed = archiveName.trim();
  const stripped = trimmed.replace(/(\.tar\.gz|\.tar\.bz2|\.tar\.xz|\.zip|\.7z|\.rar|\.tgz|\.tbz2|\.txz)$/i, '');
  return stripped && stripped !== trimmed ? stripped : `${trimmed || 'archive'}-extracted`;
};

export const basenameFromPath = (path: string) =>
  path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;

export const joinPath = (directory: string, name: string) => {
  const separator = directory.includes('\\') ? '\\' : '/';
  return directory.endsWith('/') || directory.endsWith('\\') ? `${directory}${name}` : `${directory}${separator}${name}`;
};

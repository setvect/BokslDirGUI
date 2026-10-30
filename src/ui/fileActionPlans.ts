import { archiveFileSuffix, archiveFormatForName } from '../domain/archiveFormats';
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

// 압축 내부 추가 대상은 이미 압축으로 판정된 경로, 형식을 알 수 없으면 기존처럼 zip 처리.
export const archiveFormatForPath = (path: string) => archiveFormatForName(path) ?? 'zip';

export { parseShellCommandInput } from '../actions/commandInput';

export const archiveAutoExtractFolderName = (archiveName: string) => {
  const trimmed = archiveName.trim();
  const suffix = archiveFileSuffix(trimmed);
  const stripped = suffix ? trimmed.slice(0, -suffix.length) : '';
  return stripped || `${trimmed || 'archive'}-extracted`;
};

export const basenameFromPath = (path: string) =>
  path.replace(/\\/g, '/').split('/').filter(Boolean).at(-1) ?? path;

export const joinPath = (directory: string, name: string) => {
  const separator = directory.includes('\\') ? '\\' : '/';
  return directory.endsWith('/') || directory.endsWith('\\') ? `${directory}${name}` : `${directory}${separator}${name}`;
};

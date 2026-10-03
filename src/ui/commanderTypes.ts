import type { ArchiveListing, DirectoryListing, FileEntry, PanelId, SortSpec } from '../domain/types';
import type { OpenDialogRequest } from '../operations/operationTypes';
import { NativeFileDropEvent } from '../tauri/commanderClients';
import type { ArchiveCopyPlan } from './fileActionPlans';
import type { FocusFallbackMode } from './panelState';

export const ARCHIVE_LIST_LIMIT = 50_000;

export interface NativeFileDropRuntime {
  handle(event: NativeFileDropEvent): void;
  handleListenError(error: unknown): void;
}

export interface ListPanelOptions {
  pushHistory?: boolean;
  replaceBack?: string[];
  replaceForward?: string[];
  preserveSelection?: boolean;
  preserveFocusPath?: string | null;
  focusPath?: string | null;
  focusFallback?: FocusFallbackMode;
  sort?: SortSpec;
  filter?: string | null;
  showHidden?: boolean;
  statusAfterSuccess?: string | null;
  background?: boolean;
  forceArchiveReload?: boolean;
}

export interface CachedArchiveListing {
  listing: ArchiveListing;
  password: string | undefined;
  fileSignature: string | null;
}

export type ArchivePasswordRequest =
  | { kind: 'open'; panelId: PanelId; virtualPath: string; archivePath: string }
  | { kind: 'copy'; archivePath: string };

export interface PendingArchiveCopy {
  request: OpenDialogRequest;
  plan: ArchiveCopyPlan;
  status: string;
}

export interface FileClipboardSnapshot {
  nativeVersion?: number;
  intent: 'copy' | 'move';
  panelId: PanelId;
  listing: DirectoryListing;
  entries: FileEntry[];
}
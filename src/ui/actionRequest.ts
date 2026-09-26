import type { ActionId } from '../actions/registry';
import type { DirectoryListing, FileEntry, PanelId } from '../domain/types';
import type { FileClipboardSnapshot } from './commanderTypes';

/** 입력 경로와 무관하게 요청 시점의 출발·대상을 전달한다. */
export interface ActionRequest {
  actionId: ActionId;
  panelId?: PanelId;
  sources?: FileEntry[];
  targetDir?: string;
  sourceListing?: DirectoryListing;
  clipboardMoveSnapshot?: FileClipboardSnapshot;
}
export type ExecuteAction = (request: ActionRequest) => void;

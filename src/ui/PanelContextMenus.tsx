import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  labelForAction,
  shortcutHelpLabelForAction,
  shortcutLabelForAction,
  type AppAction
} from '../actions/registry';
import type { DirectoryListing, FileEntry, Settings } from '../domain/types';
import { createActionContext } from './actionContext';
import {
  isArchiveVirtualPath
} from './archiveVirtual';
import { useCommanderKeyboardBoundaryProps } from './keyboardOwnership';
import { blankContextMenuActions, contextMenuActions } from './menuModel';
import { contextMenuSources } from './selectionModel';

export function BlankContextMenuContent({ language, listing, operationBusy, backendAvailable, onOpenAction }: {
  language: Settings['language'];
  listing: DirectoryListing;
  operationBusy: boolean;
  backendAvailable: boolean;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const context = createActionContext({
    activePanel: listing.panelId,
    focusedEntry: null,
    selectedCount: 0,
    hasConcreteFocus: false,
    effectiveTargetCount: 0,
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy,
    backendAvailable,
    activePathIsArchive: isArchiveVirtualPath(listing.path),
  });
  const actions = blankContextMenuActions(context, Boolean(listing.filter));

  return (
    <ContextMenu.Content className="context-menu" {...keyboardBoundaryProps}>
      <ContextMenu.Label className="context-label">{listing.path}</ContextMenu.Label>
      {actions.map((action) => (
        <ContextMenu.Item
          key={action.id}
          className="context-item"
          onSelect={() => onOpenAction(action, [])}
        >
          <span>{labelForAction(action, language)}</span>
          {action.shortcutLabel ? <kbd>{shortcutHelpLabelForAction(action)}</kbd> : null}
        </ContextMenu.Item>
      ))}
    </ContextMenu.Content>
  );
}

export function EntryContextMenuContent({ language, entry, listing, selectedPaths, operationBusy, backendAvailable, onOpenAction }: {
  language: Settings['language'];
  entry: FileEntry;
  listing: DirectoryListing;
  selectedPaths: readonly string[];
  operationBusy: boolean;
  backendAvailable: boolean;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const contextSources = contextMenuSources(entry, listing, selectedPaths);
  const context = createActionContext({
    activePanel: listing.panelId,
    focusedEntry: entry,
    selectedCount: contextSources.length,
    hasConcreteFocus: !entry.isVirtual,
    effectiveTargetCount: contextSources.length,
    hasOppositePanel: true,
    shellCommandEnabled: false,
    operationBusy,
    backendAvailable,
    activePathIsArchive: isArchiveVirtualPath(listing.path),
  });

  return (
    <ContextMenu.Content className="context-menu" {...keyboardBoundaryProps}>
      <ContextMenu.Label className="context-label">{entry.name}</ContextMenu.Label>
      {contextMenuActions(entry, context).map((action) => (
        <ContextMenu.Item
          key={action.id}
          className="context-item"
          onSelect={() => onOpenAction(action, contextSources)}
        >
          <span>{labelForAction(action, language)}</span>
          {shortcutHelpLabelForAction(action) ? <kbd>{shortcutLabelForAction(action)}</kbd> : null}
        </ContextMenu.Item>
      ))}
    </ContextMenu.Content>
  );
}

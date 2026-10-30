import { displayPath } from '../domain/pathDisplay';
import * as ContextMenu from '@radix-ui/react-context-menu';
import {
  labelForAction,
  shortcutHelpLabelForAction,
  shortcutLabelForAction,
  type AppAction
} from '../actions/registry';
import type { DirectoryListing, FileEntry, Settings } from '../domain/types';
import { createPanelActionContext, type SharedActionState } from './actionContext';
import { useCommanderKeyboardBoundaryProps } from './keyboardOwnership';
import { blankContextMenuActions, contextMenuActions } from './menuModel';
import { contextMenuSources } from './selectionModel';

export function BlankContextMenuContent({ language, listing, actionState, onOpenAction }: {
  language: Settings['language'];
  listing: DirectoryListing;
  actionState: SharedActionState;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const context = createPanelActionContext(actionState, listing, {
    focusedEntry: null,
    selectedCount: 0,
    hasConcreteFocus: false,
    effectiveTargetCount: 0,
  });
  const actions = blankContextMenuActions(context, Boolean(listing.filter));

  return (
    <ContextMenu.Content className="context-menu" {...keyboardBoundaryProps}>
      <ContextMenu.Label className="context-label">{displayPath(listing.path)}</ContextMenu.Label>
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

export function EntryContextMenuContent({ language, entry, listing, selectedPaths, actionState, onOpenAction }: {
  language: Settings['language'];
  entry: FileEntry;
  listing: DirectoryListing;
  selectedPaths: readonly string[];
  actionState: SharedActionState;
  onOpenAction(action: AppAction, sources: FileEntry[]): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('context-menu');
  const contextSources = contextMenuSources(entry, listing, selectedPaths);
  const context = createPanelActionContext(actionState, listing, {
    focusedEntry: entry,
    selectedCount: contextSources.length,
    hasConcreteFocus: !entry.isVirtual,
    effectiveTargetCount: contextSources.length,
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

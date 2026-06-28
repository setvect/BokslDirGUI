import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ACTIONS, labelForAction, menuPathSegmentsForAction, shortcutLabelForAction } from '../actions/registry';
import type { PanelId } from '../domain/types';
import { ACTION_CATEGORY_LABELS, OVERLAY_TEXT, type SupportedLanguage } from '../i18n-resources';
import type { PanelNavigationState } from './panelState';
import { useCommanderKeyboardBoundaryProps, type CommanderKeyboardOwner } from './keyboardOwnership';

export interface NavigationListItem {
  id: string;
  label: string;
  path: string;
  group: string;
}

export interface NavigationListState {
  kind: 'locations' | 'history' | 'bookmarks' | 'tabs' | 'archive';
  panelId: PanelId;
  title: string;
  items: NavigationListItem[];
}

export function ShortcutHelpDialog({ language, onClose }: { language: SupportedLanguage; onClose(): void }) {
  const text = OVERLAY_TEXT[language];
  return (
    <CommanderOverlayDialog owner="shortcut-help" title={text.keyboardShortcuts} ariaLabel={text.keyboardShortcuts} onClose={onClose}>
      <div className="filter-form">
        <div className="shortcut-help-list" role="list">
          {ACTIONS.filter((action) => action.shortcutLabel || action.keyboardBindings?.length).map((action) => (
            <div className="shortcut-help-row" role="listitem" key={action.id}>
              <kbd>{shortcutLabelForAction(action)}</kbd>
              <span>{labelForAction(action, language)}</span>
              <small>{categoryLabelForAction(action, language)}</small>
            </div>
          ))}
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function HelpSearchDialog({ language, onClose }: { language: SupportedLanguage; onClose(): void }) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const results = ACTIONS.filter((action) => {
    if (!normalizedQuery) {
      return true;
    }
    return [
      labelForAction(action, language),
      categoryLabelForAction(action, language),
      action.shortcutLabel ?? '',
      ...(menuPathSegmentsForAction(action, language) ?? []),
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <CommanderOverlayDialog owner="help-search" title={text.helpSearch} ariaLabel={text.helpSearch} onClose={onClose}>
      <div className="filter-form">
        <label>
          <span>{text.helpSearchPlaceholder}</span>
          <input
            ref={inputRef}
            aria-label={text.helpSearchQuery}
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
        </label>
        <div className="shortcut-help-list" role="list">
          {results.map((action) => (
            <div className="shortcut-help-row" role="listitem" key={action.id}>
              <kbd>{shortcutLabelForAction(action)}</kbd>
              <span>{labelForAction(action, language)}</span>
              <small>{categoryLabelForAction(action, language)}</small>
            </div>
          ))}
          {results.length === 0 ? <p className="dialog-empty">{text.noSearchResults}</p> : null}
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

type AppActionCategory = (typeof ACTIONS)[number]['category'];

const categoryLabelForAction = (action: (typeof ACTIONS)[number], language: SupportedLanguage) =>
  ACTION_CATEGORY_LABELS[language][action.category] ?? action.category;

export function AboutDialog({ language, onClose }: { language: SupportedLanguage; onClose(): void }) {
  const text = OVERLAY_TEXT[language];
  return (
    <CommanderOverlayDialog owner="about-dialog" title="BokslDirGUI" ariaLabel="about BokslDirGUI" onClose={onClose} className="about-dialog">
      <div className="filter-form">
        <p>{text.aboutLine1}</p>
        <p>{text.aboutLine2}</p>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function NavigationListDialog({ language, state, onChoose, onClose }: {
  language: SupportedLanguage;
  state: NavigationListState;
  onChoose(item: NavigationListItem): void;
  onClose(): void;
}) {
  const text = OVERLAY_TEXT[language];
  return (
    <CommanderOverlayDialog owner={`navigation-list-${state.kind}`} title={state.title} ariaLabel={state.title} onClose={onClose} className="navigation-list-dialog">
      <div className="filter-form">
        <div className="navigation-list" role="list">
          {state.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className="navigation-list-item"
              onClick={() => onChoose(item)}
            >
              <span>{item.label}</span>
              <code>{item.path}</code>
              <small>{item.group}</small>
            </button>
          ))}
          {state.items.length === 0 ? <p className="dialog-empty">{text.emptyList}</p> : null}
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function PathPrompt({ language, panel, onApply, onCancel }: {
  language: SupportedLanguage;
  panel: PanelNavigationState;
  onApply(pathValue: string): void;
  onCancel(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(panel.path);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply(value);
  };

  return (
    <CommanderOverlayDialog owner="path-prompt" title={text.goToPath} ariaLabel={text.goToPath} onClose={onCancel}>
      <form className="filter-form" onSubmit={handleSubmit}>
        <label>
          <span>{text.goToPath} · {panel.listing.panelId.toUpperCase()}</span>
          <input
            ref={inputRef}
            aria-label={text.path}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        <div className="filter-actions">
          <button type="button" onClick={onCancel}>{text.cancel}</button>
          <button type="submit" className="primary">{text.move}</button>
        </div>
      </form>
    </CommanderOverlayDialog>
  );
}

export function FilterPrompt({ language, panel, onApply, onCancel }: {
  language: SupportedLanguage;
  panel: PanelNavigationState;
  onApply(filterValue: string): void;
  onCancel(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(panel.filter ?? '');

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onApply(value);
  };

  return (
    <CommanderOverlayDialog owner="filter-prompt" title={text.filter} ariaLabel={text.filter} onClose={onCancel}>
      <form className="filter-form" onSubmit={handleSubmit}>
        <label>
          <span>{text.filter} · {panel.path}</span>
          <input
            ref={inputRef}
            aria-label={text.filterPattern}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                onCancel();
              }
            }}
          />
        </label>
        <div className="filter-actions">
          <button type="button" onClick={onCancel}>{text.cancel}</button>
          {panel.filter ? <button type="button" onClick={() => onApply('')}>{text.clearFilter}</button> : null}
          <button type="submit" className="primary">{text.applyFilter}</button>
        </div>
      </form>
    </CommanderOverlayDialog>
  );
}

function CommanderOverlayDialog({
  owner,
  title,
  ariaLabel,
  onClose,
  className,
  children,
}: {
  owner: CommanderKeyboardOwner;
  title: string;
  ariaLabel: string;
  onClose(): void;
  className?: string;
  children: ReactNode;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps(owner);
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content
          className={`overlay-dialog ${className ?? ''}`.trim()}
          aria-label={ariaLabel}
          aria-describedby={undefined}
          {...keyboardBoundaryProps}
        >
          <Dialog.Title className="overlay-title">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

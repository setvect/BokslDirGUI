import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { ACTIONS, labelForAction, menuPathSegmentsForAction, shortcutHelpLabelForAction } from '../actions/registry';
import type { FilePreview, PanelId } from '../domain/types';
import {
  ACTION_CATEGORY_LABELS,
  NAVIGATION_GROUP_LABELS,
  OVERLAY_TEXT,
  PANEL_ID_LABELS,
  type SupportedLanguage,
} from '../i18n-resources';
import type { PanelNavigationState } from './panelState';
import { useCommanderKeyboardBoundaryProps, type CommanderKeyboardOwner } from './keyboardOwnership';

export interface NavigationListItem {
  id: string;
  label: string;
  path: string;
  group: string;
}

export interface NavigationListState {
  kind: 'locations' | 'history' | 'bookmarks' | 'tabs';
  panelId: PanelId;
  title: string;
  items: NavigationListItem[];
}

export function QuickPreviewDialog({ language, preview, loading, onClose }: {
  language: SupportedLanguage;
  preview: FilePreview | null;
  loading: boolean;
  onClose(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const scrollRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!loading && preview?.kind === 'text') {
      scrollRef.current?.focus({ preventScroll: true });
    }
  }, [loading, preview]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollArea = scrollRef.current;
    if (!scrollArea || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }
    const lineHeight = Number.parseFloat(window.getComputedStyle(scrollArea).lineHeight) || 28;
    const pageHeight = Math.max(lineHeight, scrollArea.clientHeight - lineHeight);
    const distance = {
      ArrowDown: lineHeight,
      ArrowUp: -lineHeight,
      PageDown: pageHeight,
      PageUp: -pageHeight,
    }[event.key];
    if (distance === undefined && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') {
      scrollArea.scrollTop = 0;
    } else if (event.key === 'End') {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    } else if (distance !== undefined) {
      scrollArea.scrollTop += distance;
    }
  };

  return (
    <CommanderOverlayDialog
      owner="quick-preview"
      title={text.quickView}
      ariaLabel={text.quickView}
      onClose={onClose}
      className="quick-preview-dialog"
      onOpenAutoFocus={(event) => {
        if (scrollRef.current) {
          event.preventDefault();
          scrollRef.current.focus({ preventScroll: true });
        }
      }}
    >
      <div className="quick-preview-content" onKeyDown={handleKeyDown}>
        {loading ? <p>{text.previewLoading}</p> : null}
        {!loading && preview ? (
          <>
            <div className="quick-preview-meta">
              <strong title={preview.path}>{preview.name}</strong>
              <span>{preview.sizeBytes.toLocaleString()} {text.bytes}</span>
              {preview.mimeType ? <span>{preview.mimeType}</span> : null}
            </div>
            {preview.kind === 'image' && preview.dataUrl ? (
              <img src={preview.dataUrl} alt={preview.name} className="quick-preview-image" />
            ) : null}
            {preview.kind === 'text' ? (
              <>
                {preview.truncated ? <p className="operation-warning">{text.previewTruncated}</p> : null}
                <pre
                  className="quick-preview-text"
                  ref={scrollRef}
                  role="region"
                  aria-label={`${text.quickView}: ${preview.name}`}
                  tabIndex={0}
                >{preview.text}</pre>
              </>
            ) : null}
            {preview.kind === 'unsupported' ? <p>{text.previewUnsupported}</p> : null}
            {preview.kind === 'tooLarge' ? <p>{text.previewTooLarge}</p> : null}
          </>
        ) : null}
        <div className="filter-actions">
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

const SHORTCUT_HELP_COLUMNS: readonly (readonly AppActionCategory[])[] = [
  ['navigation'],
  ['panel', 'selection'],
  ['file', 'help'],
  ['view', 'archive', 'settings'],
];

export function ShortcutHelpDialog({ language, onClose }: { language: SupportedLanguage; onClose(): void }) {
  const text = OVERLAY_TEXT[language];
  const scrollRef = useRef<HTMLDivElement>(null);
  const shortcutGroups = new Map<AppActionCategory, (typeof ACTIONS)[number][]>();
  for (const action of ACTIONS) {
    if (!action.shortcutLabel && !action.keyboardBindings?.length) {
      continue;
    }
    const group = shortcutGroups.get(action.category) ?? [];
    group.push(action);
    shortcutGroups.set(action.category, group);
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const scrollArea = scrollRef.current;
    if (!scrollArea || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return;
    }

    const rowHeight = scrollArea.querySelector<HTMLElement>('.shortcut-help-entry')?.getBoundingClientRect().height || 28;
    const pageHeight = Math.max(rowHeight, scrollArea.clientHeight - rowHeight);
    const distance = {
      ArrowDown: rowHeight,
      ArrowUp: -rowHeight,
      PageDown: pageHeight,
      PageUp: -pageHeight,
    }[event.key];
    if (distance === undefined && event.key !== 'Home' && event.key !== 'End') {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Home') {
      scrollArea.scrollTop = 0;
    } else if (event.key === 'End') {
      scrollArea.scrollTop = scrollArea.scrollHeight;
    } else if (distance !== undefined) {
      scrollArea.scrollTop += distance;
    }
  };

  return (
    <CommanderOverlayDialog
      owner="shortcut-help"
      title={text.keyboardShortcuts}
      ariaLabel={text.keyboardShortcuts}
      onClose={onClose}
      className="shortcut-help-dialog"
      onOpenAutoFocus={(event) => {
        if (scrollRef.current) {
          event.preventDefault();
          scrollRef.current.focus({ preventScroll: true });
        }
      }}
    >
      <div className="shortcut-help-content" onKeyDown={handleKeyDown}>
        <div className="shortcut-help-scroll" ref={scrollRef} role="region" aria-label={text.shortcutListLabel} tabIndex={0}>
          <div className="shortcut-help-groups">
            {SHORTCUT_HELP_COLUMNS.map((column) => (
              <div className="shortcut-help-column" key={column[0]}>
                {column.map((category) => {
                  const actions = shortcutGroups.get(category);
                  return actions ? (
                    <section className="shortcut-help-group" aria-labelledby={'shortcut-group-' + category} key={category}>
                      <h3 className="shortcut-help-group-title" id={'shortcut-group-' + category}>
                        {ACTION_CATEGORY_LABELS[language][category]}
                      </h3>
                      <div className="shortcut-help-entries" role="list">
                        {actions.map((action) => (
                          <div className="shortcut-help-entry" role="listitem" key={action.id}>
                            <kbd>{shortcutHelpLabelForAction(action)}</kbd>
                            <span>{labelForAction(action, language)}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null;
                })}
              </div>
            ))}
          </div>
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
          {results.map((action) => <HelpSearchResult action={action} language={language} key={action.id} />)}
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

function HelpSearchResult({
  action,
  language,
}: {
  action: (typeof ACTIONS)[number];
  language: SupportedLanguage;
}) {
  const shortcut = shortcutHelpLabelForAction(action);
  const menuPath = menuPathSegmentsForAction(action, language)?.join(' › ');
  return (
    <div className="shortcut-help-row" role="listitem">
      <kbd>{shortcut || OVERLAY_TEXT[language].noShortcut}</kbd>
      <span>{labelForAction(action, language)}</span>
      <small>{menuPath ?? categoryLabelForAction(action, language)}</small>
    </div>
  );
}

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
              <small>{NAVIGATION_GROUP_LABELS[language][item.group] ?? item.group}</small>
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
          <span>{text.goToPath} · {PANEL_ID_LABELS[language][panel.listing.panelId]}</span>
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

export function ArchivePasswordPrompt({ language, archivePath, mode = 'open', onApply, onCancel }: {
  language: SupportedLanguage;
  archivePath: string;
  mode?: 'open' | 'copy';
  onApply(password: string): void;
  onCancel(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <CommanderOverlayDialog owner="archive-password" title={text.archivePasswordTitle} ariaLabel={text.archivePasswordTitle} onClose={onCancel}>
      <form className="filter-form" onSubmit={(event) => {
        event.preventDefault();
        if (value) onApply(value);
      }}>
        <p>{archivePath}</p>
        <label>
          <span>{text.archivePassword}</span>
          <input
            ref={inputRef}
            type="password"
            autoComplete="current-password"
            aria-label={text.archivePassword}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        <div className="filter-actions">
          <button type="button" onClick={onCancel}>{text.cancel}</button>
          <button type="submit" className="primary" disabled={!value}>{mode === 'copy' ? text.copy : text.open}</button>
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

export function BookmarkRenamePrompt({ language, initialValue, onApply, onCancel }: {
  language: SupportedLanguage;
  initialValue: string;
  onApply(value: string): void;
  onCancel(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
  }, []);

  return (
    <CommanderOverlayDialog owner="bookmark-rename" title={text.renameBookmark} ariaLabel={text.renameBookmark} onClose={onCancel}>
      <form className="filter-form" onSubmit={(event) => {
        event.preventDefault();
        const trimmed = value.trim();
        if (trimmed) {
          onApply(trimmed);
        }
      }}>
        <label>
          <span>{text.bookmarkName}</span>
          <input
            ref={inputRef}
            aria-label={text.bookmarkName}
            value={value}
            onChange={(event) => setValue(event.currentTarget.value)}
          />
        </label>
        <div className="filter-actions">
          <button type="button" onClick={onCancel}>{text.cancel}</button>
          <button type="submit" className="primary" disabled={!value.trim()}>{text.save}</button>
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
  onOpenAutoFocus,
  className,
  children,
}: {
  owner: CommanderKeyboardOwner;
  title: string;
  ariaLabel: string;
  onClose(): void;
  onOpenAutoFocus?: (event: Event) => void;
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
          onOpenAutoFocus={onOpenAutoFocus}
          {...keyboardBoundaryProps}
        >
          <Dialog.Title className="overlay-title">{title}</Dialog.Title>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

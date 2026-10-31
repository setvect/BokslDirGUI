import { displayPath } from '../domain/pathDisplay';
import * as Dialog from '@radix-ui/react-dialog';
import appPackage from '../../package.json';
import aboutMascot from '../assets/about-mascot.png';
import { APP_NAME } from '../foundation';
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { ACTIONS, actionVisibleOnPlatform, labelForAction, menuPathSegmentsForAction, shortcutHelpLabelForAction } from '../actions/registry';
import type { PanelId, PlatformInfo } from '../domain/types';
import {
  ACTION_CATEGORY_LABELS,
  NAVIGATION_GROUP_LABELS,
  OVERLAY_TEXT,
  PANEL_ID_LABELS,
  type SupportedLanguage,
} from '../i18n-resources';
import type { PanelNavigationState } from './panelState';
import { useCommanderKeyboardBoundaryProps, type CommanderKeyboardOwner } from './keyboardOwnership';
import { shortenPath } from './textLayout';
import { formatDateTime } from './format';
import { LITERAL_TEXT_INPUT_PROPS } from './textInputProps';

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

const SHORTCUT_HELP_COLUMNS: readonly (readonly AppActionCategory[])[] = [
  ['navigation'],
  ['panel', 'selection'],
  ['file', 'help'],
  ['view', 'archive', 'settings'],
];

export function ShortcutHelpDialog({ language, platformInfo, onClose }: { language: SupportedLanguage; platformInfo?: PlatformInfo; onClose(): void }) {
  const text = OVERLAY_TEXT[language];
  const scrollRef = useRef<HTMLDivElement>(null);
  const shortcutGroups = new Map<AppActionCategory, (typeof ACTIONS)[number][]>();
  for (const action of ACTIONS) {
    if ((!action.shortcutLabel && !action.keyboardBindings?.length) || !actionVisibleOnPlatform(action, undefined, platformInfo)) {
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

export function HelpSearchDialog({ language, platformInfo, onClose }: { language: SupportedLanguage; platformInfo?: PlatformInfo; onClose(): void }) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const results = ACTIONS.filter((action) => {
    if (!actionVisibleOnPlatform(action, undefined, platformInfo)) return false;
    if (!normalizedQuery) {
      return true;
    }
    return [
      labelForAction(action, language),
      categoryLabelForAction(action, language),
      shortcutHelpLabelForAction(action),
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
    <CommanderOverlayDialog owner="about-dialog" title={`${APP_NAME} ${appPackage.version}`} ariaLabel={text.aboutDialogLabel} onClose={onClose} className="about-dialog">
      <div className="filter-form">
        <div className="about-content">
          <img className="about-mascot" src={aboutMascot} alt={text.aboutMascotAlt} />
          <div className="about-copy">
            <p>{text.aboutLine1}</p>
            <p>{text.aboutLine2}</p>
            <p>{text.aboutBuildDate}: <time dateTime={__APP_BUILD_TIME__}>{formatDateTime(__APP_BUILD_TIME__)}</time></p>
          </div>
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function NavigationListDialog({ language, state, onChoose, onCloseTab, onDeleteBookmark, onClose }: {
  language: SupportedLanguage;
  state: NavigationListState;
  onChoose(item: NavigationListItem): void;
  onCloseTab(item: NavigationListItem): void;
  onDeleteBookmark(item: NavigationListItem): void;
  onClose(): void;
}) {
  const text = OVERLAY_TEXT[language];
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const isPathList = state.kind !== 'locations';
  return (
    <CommanderOverlayDialog
      owner={`navigation-list-${state.kind}`}
      title={state.title}
      ariaLabel={state.title}
      onClose={onClose}
      className={isPathList ? 'navigation-list-dialog navigation-path-dialog' : 'navigation-list-dialog'}
      onOpenAutoFocus={isPathList && state.items.length > 0 ? (event) => {
        event.preventDefault();
        initialFocusRef.current?.focus({ preventScroll: true });
      } : undefined}
    >
      <div className="filter-form">
        {isPathList ? (
          <PathNavigationListContent
            language={language}
            state={state}
            initialFocusRef={initialFocusRef}
            closeButtonRef={closeButtonRef}
            onChoose={onChoose}
            onCloseTab={onCloseTab}
            onDeleteBookmark={onDeleteBookmark}
          />
        ) : (
          <div className="navigation-list" role="list">
            {state.items.map((item) => (
              <button
                key={item.id}
                type="button"
                className="navigation-list-item"
                title={`${displayPath(item.label)}\n${displayPath(item.path)}`}
                onClick={() => onChoose(item)}
              >
                <span className="navigation-list-label">{displayPath(item.label)}</span>
                <code>{displayPath(item.path)}</code>
                <small>{NAVIGATION_GROUP_LABELS[language][item.group] ?? item.group}</small>
              </button>
            ))}
            {state.items.length === 0 ? <p className="dialog-empty">{text.emptyList}</p> : null}
          </div>
        )}
        <div className="filter-actions">
          <button ref={closeButtonRef} type="button" onClick={onClose}>{text.close}</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

function PathNavigationListContent({ language, state, initialFocusRef, closeButtonRef, onChoose, onCloseTab, onDeleteBookmark }: {
  language: SupportedLanguage;
  state: NavigationListState;
  initialFocusRef: RefObject<HTMLButtonElement | null>;
  closeButtonRef: RefObject<HTMLButtonElement | null>;
  onChoose(item: NavigationListItem): void;
  onCloseTab(item: NavigationListItem): void;
  onDeleteBookmark(item: NavigationListItem): void;
}) {
  const text = OVERLAY_TEXT[language];
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const focusedIndexRef = useRef(Math.max(0, state.items.findIndex((item) => item.group === 'active tab' || item.group === 'current')));

  useEffect(() => {
    if (state.items.length === 0) {
      closeButtonRef.current?.focus({ preventScroll: true });
      return;
    }
    const nextIndex = Math.min(focusedIndexRef.current, state.items.length - 1);
    focusedIndexRef.current = nextIndex;
    itemRefs.current[nextIndex]?.focus({ preventScroll: true });
  }, [state.items.length]);

  const focusItem = (index: number) => {
    const nextIndex = Math.max(0, Math.min(index, state.items.length - 1));
    focusedIndexRef.current = nextIndex;
    const item = itemRefs.current[nextIndex];
    item?.focus({ preventScroll: true });
    item?.scrollIntoView?.({ block: 'nearest' });
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || state.items.length === 0) return;
    const focusedButtonIndex = itemRefs.current.findIndex((item) => item === document.activeElement);
    const index = focusedButtonIndex >= 0 ? focusedButtonIndex : focusedIndexRef.current;
    const rowHeight = itemRefs.current[index]?.offsetHeight || 40;
    const pageSize = Math.max(1, Math.floor((listRef.current?.clientHeight || rowHeight) / rowHeight));
    const targetIndex = {
      ArrowDown: index + 1,
      ArrowUp: index - 1,
      PageDown: index + pageSize,
      PageUp: index - pageSize,
      Home: 0,
      End: state.items.length - 1,
    }[event.key];
    if (targetIndex !== undefined) {
      event.preventDefault();
      event.stopPropagation();
      focusItem(targetIndex);
      return;
    }

    if (event.key === 'Enter' && !(event.target instanceof HTMLElement && event.target.closest('.navigation-path-remove'))) {
      event.preventDefault();
      event.stopPropagation();
      onChoose(state.items[index]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      if (state.kind === 'tabs' && state.items.length > 1) {
        event.preventDefault();
        event.stopPropagation();
        onCloseTab(state.items[index]);
      } else if (state.kind === 'bookmarks') {
        event.preventDefault();
        event.stopPropagation();
        onDeleteBookmark(state.items[index]);
      }
    }
  };

  return (
    <div className={'navigation-list navigation-path-list' + (state.kind === 'tabs' ? ' navigation-tab-list' : '')} role="list" ref={listRef} onKeyDown={handleKeyDown}>
      {state.items.map((item, index) => {
        const hasCustomLabel = state.kind === 'bookmarks' && item.label !== item.path && item.label !== shortenPath(item.path);
        return (
          <div className="navigation-path-row" role="listitem" key={item.id}>
            <button
              type="button"
              className={'navigation-path-choice' + (state.kind === 'tabs' ? ' navigation-tab-choice' : '')}
              aria-current={item.group === 'active tab' || item.group === 'current' ? 'true' : undefined}
              title={displayPath(item.path)}
              ref={(element) => {
                itemRefs.current[index] = element;
                if (index === focusedIndexRef.current) initialFocusRef.current = element;
              }}
              onFocus={() => { focusedIndexRef.current = index; }}
              onClick={() => onChoose(item)}
            >
              <span className="navigation-path-index">{index + 1}.</span>
              <span className="navigation-path-main">
                {hasCustomLabel ? <span className="navigation-path-label">{displayPath(item.label)}</span> : null}
                <span className={'navigation-path-value' + (state.kind === 'tabs' ? ' navigation-tab-path' : '') + (hasCustomLabel ? ' is-secondary' : '')}>{displayPath(item.path)}</span>
              </span>
              <small>{NAVIGATION_GROUP_LABELS[language][item.group] ?? item.group}</small>
            </button>
            {state.kind === 'tabs' || state.kind === 'bookmarks' ? <button
              type="button"
              className={'navigation-path-remove' + (state.kind === 'tabs' ? ' navigation-tab-close' : '')}
              aria-label={(state.kind === 'tabs' ? text.closeTab : text.deleteBookmark) + ' ' + (index + 1) + ': ' + displayPath(item.path)}
              title={state.kind === 'tabs' ? text.closeTab : text.deleteBookmark}
              disabled={state.kind === 'tabs' && state.items.length <= 1}
              onFocus={() => { focusedIndexRef.current = index; }}
              onClick={() => state.kind === 'tabs' ? onCloseTab(item) : onDeleteBookmark(item)}
            >{state.kind === 'tabs' ? text.close : text.delete}</button> : null}
          </div>
        );
      })}
      {state.items.length === 0 ? <p className="dialog-empty">{text.emptyList}</p> : null}
    </div>
  );
}

export function PathPrompt({ language, panel, onApply, onCompleted, onCancel }: {
  language: SupportedLanguage;
  panel: PanelNavigationState;
  onApply(pathValue: string): Promise<string | null | undefined>;
  onCompleted(): void;
  onCancel(pending: boolean): void;
}) {
  const text = OVERLAY_TEXT[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [value, setValue] = useState(displayPath(panel.path));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
    inputRef.current?.select();
    return () => { requestRef.current += 1; };
  }, []);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    if (!value.trim()) {
      setError(text.pathRequired);
      inputRef.current?.focus({ preventScroll: true });
      return;
    }
    const requestId = ++requestRef.current;
    setPending(true);
    setError(null);
    const result = await onApply(value === displayPath(panel.path) ? panel.path : value);
    if (requestId !== requestRef.current) return;
    setPending(false);
    if (result === null) {
      onCompleted();
    } else if (result !== undefined) {
      setError(result);
      inputRef.current?.focus({ preventScroll: true });
    }
  };

  const cancel = () => onCancel(pending);

  return (
    <CommanderOverlayDialog owner="path-prompt" title={text.goToPath} ariaLabel={text.goToPath} onClose={cancel}>
      <form className="filter-form" onSubmit={(event) => { void handleSubmit(event); }}>
        <label>
          <span>{text.goToPath} · {PANEL_ID_LABELS[language][panel.listing.panelId]}</span>
          <input
            {...LITERAL_TEXT_INPUT_PROPS}
            ref={inputRef}
            aria-label={text.path}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? 'path-prompt-error' : undefined}
            value={value}
            disabled={pending}
            onChange={(event) => {
              setValue(event.currentTarget.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                cancel();
              }
            }}
          />
        </label>
        {error ? <p id="path-prompt-error" className="operation-error" role="alert">{error}</p> : null}
        <div className="filter-actions">
          <button type="button" onClick={cancel}>{text.cancel}</button>
          <button type="submit" className="primary" disabled={pending}>{text.move}</button>
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
        <p>{displayPath(archivePath)}</p>
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
          <span>{text.filter} · {displayPath(panel.path)}</span>
          <input
            {...LITERAL_TEXT_INPUT_PROPS}
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

export function CommanderOverlayDialog({
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

import * as Dialog from '@radix-ui/react-dialog';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ACTIONS, labelForAction, shortcutLabelForAction } from '../actions/registry';
import type { PanelId } from '../domain/types';
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

export function ShortcutHelpDialog({ onClose }: { onClose(): void }) {
  return (
    <CommanderOverlayDialog owner="shortcut-help" title="Keyboard Shortcuts" ariaLabel="keyboard shortcuts" onClose={onClose}>
      <div className="filter-form">
        <div className="shortcut-help-list" role="list">
          {ACTIONS.filter((action) => action.shortcutLabel || action.keyboardBindings?.length).map((action) => (
            <div className="shortcut-help-row" role="listitem" key={action.id}>
              <kbd>{shortcutLabelForAction(action)}</kbd>
              <span>{labelForAction(action)}</span>
              <code>{action.id}</code>
            </div>
          ))}
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function HelpSearchDialog({ onClose }: { onClose(): void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const normalizedQuery = query.trim().toLowerCase();
  const results = ACTIONS.filter((action) => {
    if (!normalizedQuery) {
      return true;
    }
    return [
      action.id,
      labelForAction(action),
      action.category,
      action.shortcutLabel ?? '',
      action.runPath,
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <CommanderOverlayDialog owner="help-search" title="Help Search" ariaLabel="help search" onClose={onClose}>
      <div className="filter-form">
        <label>
          <span>Help Search · action registry</span>
          <input
            ref={inputRef}
            aria-label="Help search query"
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
              <span>{labelForAction(action)}</span>
              <code>{action.id}</code>
            </div>
          ))}
          {results.length === 0 ? <p className="dialog-empty">검색 결과가 없습니다.</p> : null}
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function AboutDialog({ onClose }: { onClose(): void }) {
  return (
    <CommanderOverlayDialog owner="about-dialog" title="BokslDirGUI" ariaLabel="about BokslDirGUI" onClose={onClose} className="about-dialog">
      <div className="filter-form">
        <p>Tauri 2 + React + Rust 기반 dual-panel file commander.</p>
        <p>목표: 기존 터미널 BokslDir의 키보드 중심 조작감과 기능 동등성 유지.</p>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function NavigationListDialog({ state, onChoose, onClose }: {
  state: NavigationListState;
  onChoose(item: NavigationListItem): void;
  onClose(): void;
}) {
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
          {state.items.length === 0 ? <p className="dialog-empty">표시할 항목이 없습니다.</p> : null}
        </div>
        <div className="filter-actions">
          <button type="button" onClick={onClose}>닫기</button>
        </div>
      </div>
    </CommanderOverlayDialog>
  );
}

export function PathPrompt({ panel, onApply, onCancel }: {
  panel: PanelNavigationState;
  onApply(pathValue: string): void;
  onCancel(): void;
}) {
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
    <CommanderOverlayDialog owner="path-prompt" title="Go to Path" ariaLabel="go to path" onClose={onCancel}>
      <form className="filter-form" onSubmit={handleSubmit}>
        <label>
          <span>Go to Path · {panel.listing.panelId.toUpperCase()}</span>
          <input
            ref={inputRef}
            aria-label="Path"
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
          <button type="submit">이동</button>
          <button type="button" onClick={onCancel}>취소</button>
        </div>
      </form>
    </CommanderOverlayDialog>
  );
}

export function FilterPrompt({ panel, onApply, onCancel }: {
  panel: PanelNavigationState;
  onApply(filterValue: string): void;
  onCancel(): void;
}) {
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
    <CommanderOverlayDialog owner="filter-prompt" title="Filter" ariaLabel="filter entries" onClose={onCancel}>
      <form className="filter-form" onSubmit={handleSubmit}>
        <label>
          <span>Filter · {panel.path}</span>
          <input
            ref={inputRef}
            aria-label="Filter pattern"
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
          <button type="submit">Apply filter</button>
          {panel.filter ? <button type="button" onClick={() => onApply('')}>Clear filter</button> : null}
          <button type="button" onClick={onCancel}>Cancel</button>
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

import { type CSSProperties } from 'react';
import {
  menuRootLabelFromRegistry,
  menuRootsFromRegistry,
  type AppAction
} from '../actions/registry';
import type { Settings } from '../domain/types';
import {
  COMMANDER_UI_TEXT
} from '../i18n-resources';
import { useCommanderKeyboardBoundaryProps } from './keyboardOwnership';
import { MenuNode, TopMenuState, menuNodesForRoot, menuShortcutLabel } from './menuModel';
import { formatLocalClock, useLocalClock } from './useLocalClock';

interface TopMenuBarProps {
  language: Settings['language'];
  settings: Settings;
  context: Parameters<AppAction['isEnabled']>[0];
  state: TopMenuState | null;
  onOpenRoot(rootIndex?: number, menuOpen?: boolean): void;
  onClose(): void;
  onStateChange(next: TopMenuState): void;
  onOpenAction(action: AppAction): void;
}

export function TopMenuBar({ language, settings, context, state, onOpenRoot, onClose, onStateChange, onOpenAction }: TopMenuBarProps) {
  const now = useLocalClock();
  const roots = menuRootsFromRegistry();
  const activeRoot = state ? roots[state.rootIndex] : null;
  const activeNodes = activeRoot && state?.menuOpen ? menuNodesForRoot(activeRoot, context, settings) : [];

  return (
    <header className="top-menu" aria-label="application menu">
      <div className="brand" aria-label="application name">{COMMANDER_UI_TEXT[language].brand}</div>
      <nav className="menu-list" aria-label="primary actions">
        {roots.map((root, rootIndex) => {
          const isActiveRoot = state?.rootIndex === rootIndex;
          const isMenuOpen = Boolean(isActiveRoot && state?.menuOpen);
          return (
            <button
              key={root}
              type="button"
              className="menu-trigger"
              aria-haspopup="menu"
              aria-expanded={isMenuOpen}
              data-state={isActiveRoot ? (isMenuOpen ? 'open' : 'focused') : 'closed'}
              onClick={() => (isMenuOpen ? onClose() : onOpenRoot(rootIndex, true))}
              onMouseEnter={() => {
                if (state) {
                  onOpenRoot(rootIndex, state.menuOpen);
                }
              }}
            >
              {menuRootLabelFromRegistry(root, language)}
            </button>
          );
        })}
      </nav>
      <time className="clock" dateTime={now.toISOString()}>{formatLocalClock(now)}</time>
      {state?.menuOpen && activeRoot ? (
        <MenuPopoverContent
          language={language}
          root={activeRoot}
          rootIndex={state.rootIndex}
          nodes={activeNodes}
          state={state}
          onStateChange={onStateChange}
          onOpenAction={onOpenAction}
        />
      ) : null}
    </header>
  );
}

function MenuPopoverContent({ language, root, rootIndex, nodes, state, onStateChange, onOpenAction }: {
  language: Settings['language'];
  root: string;
  rootIndex: number;
  nodes: readonly MenuNode[];
  state: TopMenuState;
  onStateChange(next: TopMenuState): void;
  onOpenAction(action: AppAction): void;
}) {
  const keyboardBoundaryProps = useCommanderKeyboardBoundaryProps('menu-popover');

  return (
    <div
      className="menu-popover"
      role="menu"
      aria-label={`${menuRootLabelFromRegistry(root, language)} menu`}
      style={{ '--menu-root-index': rootIndex } as CSSProperties}
      {...keyboardBoundaryProps}
    >
      {nodes.map((node, itemIndex) => {
        const focused = state.itemIndex === itemIndex;
        if (node.kind === 'submenu') {
          const submenuOpen = focused && state.submenuIndex !== null;
          return (
            <div key={node.id} className="menu-entry-with-submenu">
              <button
                type="button"
                role="menuitem"
                aria-haspopup="menu"
                aria-expanded={submenuOpen}
                className={`menu-item ${focused ? 'is-focused' : ''}`}
                onMouseEnter={() => onStateChange({ ...state, itemIndex, submenuIndex: 0 })}
                onClick={() => onStateChange({ ...state, itemIndex, submenuIndex: submenuOpen ? null : 0 })}
              >
                <span>{node.label}</span>
                <kbd>›</kbd>
              </button>
              {submenuOpen ? (
                <div className="menu-submenu" role="menu" aria-label={`${node.label} submenu`}>
                  {node.children.map((child, submenuIndex) => (
                    <button
                      key={child.id}
                      type="button"
                      role="menuitem"
                      className={`menu-item ${child.checkable ? 'is-checkable' : ''} ${state.submenuIndex === submenuIndex ? 'is-focused' : ''}`}
                      disabled={!child.enabled}
                      onMouseEnter={() => onStateChange({ ...state, itemIndex, submenuIndex })}
                      onClick={() => {
                        if (child.enabled) {
                          onOpenAction(child.action);
                        }
                      }}
                      data-checked={child.checkable ? (child.checked ? 'true' : 'false') : undefined}
                      aria-checked={child.checkable ? child.checked : undefined}
                    >
                      {child.checkable ? <span className="menu-checkmark" aria-hidden="true">{child.checked ? '✓' : ''}</span> : null}
                      <span>{child.label}</span>
                      <kbd>{menuShortcutLabel(child.action)}</kbd>
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          );
        }

        return (
          <button
            key={node.id}
            type="button"
            role="menuitem"
            className={`menu-item ${focused ? 'is-focused' : ''}`}
            disabled={!node.enabled}
            onMouseEnter={() => onStateChange({ ...state, itemIndex, submenuIndex: null })}
            onClick={() => {
              if (node.enabled) {
                onOpenAction(node.action);
              }
            }}
            data-checked={node.checkable ? (node.checked ? 'true' : 'false') : undefined}
            aria-checked={node.checkable ? node.checked : undefined}
          >
            <span>{node.label}</span>
            {node.checkable ? (
              <kbd className="menu-checkmark-inline" aria-hidden="true">{node.checked ? '✓' : ''}</kbd>
            ) : (
              <kbd>{menuShortcutLabel(node.action)}</kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}

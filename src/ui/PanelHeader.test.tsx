// @vitest-environment jsdom
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PanelHeader } from './PanelHeader';
import { createDirectoryListing, createPanelStateFromListing } from './panelState';

describe('PanelHeader', () => {
  it('keeps the right-side status layout stable while a directory loads', () => {
    const panel = createPanelStateFromListing(createDirectoryListing('right', '/tmp/project'));
    const props = {
      tabCount: 2,
      language: 'ko' as const,
      onClearFilter: () => {},
      onNavigateBack: () => {},
      onNavigateForward: () => {},
      onNavigateUp: () => {},
      onGotoPath: () => {},
      onRestoreFocus: () => {},
    };
    const { container, rerender } = render(<PanelHeader panel={panel} {...props} />);
    const status = container.querySelector('.panel-header-status');
    const tabs = container.querySelector('.panel-tabs');
    const loading = container.querySelector('.panel-loading');

    expect(status?.children).toHaveLength(2);
    expect(loading?.getAttribute('aria-hidden')).toBe('true');

    rerender(<PanelHeader panel={{ ...panel, loading: true }} {...props} />);
    expect(container.querySelector('.panel-header-status')).toBe(status);
    expect(container.querySelector('.panel-tabs')).toBe(tabs);
    expect(container.querySelector('.panel-loading')).toBe(loading);
    expect(loading?.getAttribute('aria-hidden')).toBe('false');
    expect(loading?.classList.contains('is-loading')).toBe(true);

    rerender(<PanelHeader panel={panel} {...props} />);
    expect(container.querySelector('.panel-loading')).toBe(loading);
    expect(loading?.getAttribute('aria-hidden')).toBe('true');
    expect(loading?.classList.contains('is-loading')).toBe(false);
  });
});

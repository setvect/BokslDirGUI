// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CommanderShell } from './CommanderShell';

describe('CommanderShell', () => {
  it('renders a TUI-faithful dual-panel commander canvas', () => {
    const { container } = render(<CommanderShell />);

    expect(screen.getByText('[복슬Dir]')).toBeTruthy();
    expect(screen.getByLabelText('dual file panels')).toBeTruthy();
    expect(screen.getAllByRole('table')).toHaveLength(2);
    expect(screen.getByText('Architecture.md')).toBeTruthy();
    expect(screen.getByText('generic-array-7534a23a150ae5e7')).toBeTruthy();
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('Copy');
    expect(screen.getByLabelText('hotkey hints').textContent).toContain('PermDel');

    expect(container.querySelector('.file-panel.is-active')).not.toBeNull();
    expect(container.querySelector('.persistent-sidebar')).toBeNull();
    expect(container.querySelector('.persistent-inspector')).toBeNull();
    expect(container.querySelector('.large-toolbar')).toBeNull();
  });
});

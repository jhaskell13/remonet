import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from '../../../src/components/WorkspaceSwitcher.tsx';
import { organizations } from '../helpers/fixtures.ts';

function renderSwitcher(organizationId: string) {
  const onSelect = vi.fn();
  const onCreate = vi.fn();
  render(
    <WorkspaceSwitcher
      organizations={organizations}
      organizationId={organizationId}
      email="admin@northstar.test"
      onSelect={onSelect}
      onCreate={onCreate}
    />,
  );
  return { onSelect, onCreate };
}

describe('WorkspaceSwitcher', () => {
  it('shows the current organization with the engineer’s role in it', () => {
    renderSwitcher('org-demo');
    const trigger = screen.getByRole('button', { name: /northstar engineering/i });
    expect(within(trigger).getByText('Admin')).toBeTruthy();
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('lists every organization with its role and switches on selection', async () => {
    const { onSelect } = renderSwitcher('org-demo');
    await userEvent.click(screen.getByRole('button', { name: /northstar engineering/i }));
    const menu = screen.getByRole('listbox', { name: /switch organization/i });
    const options = within(menu).getAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      'Acme ManufacturingOperator',
      'Northstar EngineeringAdmin',
      'All organizations',
    ]);
    expect(options[1]?.getAttribute('aria-selected')).toBe('true');
    await userEvent.click(options[0]!);
    expect(onSelect).toHaveBeenCalledWith('org-acme');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('offers the cross-organization view and creating a new organization', async () => {
    const { onSelect, onCreate } = renderSwitcher('');
    const trigger = screen.getByRole('button', { name: /all organizations/i });
    expect(within(trigger).getByText('admin@northstar.test')).toBeTruthy();
    await userEvent.click(trigger);
    await userEvent.click(screen.getByRole('button', { name: /new organization/i }));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('closes when clicking elsewhere and toggles from the trigger', async () => {
    renderSwitcher('org-demo');
    const trigger = screen.getByRole('button', { name: /northstar engineering/i });
    await userEvent.click(trigger);
    expect(screen.getByRole('listbox')).toBeTruthy();
    await userEvent.click(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    await userEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    await userEvent.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('selecting the cross-organization entry clears the selection', async () => {
    const { onSelect } = renderSwitcher('org-demo');
    await userEvent.click(screen.getByRole('button', { name: /northstar engineering/i }));
    await userEvent.click(screen.getByRole('option', { name: 'All organizations' }));
    expect(onSelect).toHaveBeenCalledWith('');
  });
});

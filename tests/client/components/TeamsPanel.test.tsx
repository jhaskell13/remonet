import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { TeamsPanel } from '../../../src/components/TeamsPanel.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { members, organizationId, teams } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderPanel(role: 'owner' | 'admin' | 'operator' | 'viewer') {
  const api = apiMock.reset();
  const onChanged = vi.fn();
  render(
    <TeamsPanel
      organizationId={organizationId}
      role={role}
      teams={teams}
      members={members}
      onChanged={onChanged}
    />,
  );
  return { api, onChanged };
}
const row = (name: string) => screen.getByText(name).closest('.network-management-row') as HTMLElement;

describe('TeamsPanel', () => {
  it('shows each team with its member count', () => {
    renderPanel('viewer');
    expect(within(row('Network Operations')).getByText('4 members')).toBeTruthy();
    expect(within(row('Field Engineering')).getByText('0 members')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('admins create and rename teams but cannot delete them', async () => {
    const { api, onChanged } = renderPanel('admin');
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: /add team/i }));
    await userEvent.type(screen.getByLabelText(/team name/i), '  Night Shift ');
    await userEvent.click(screen.getByRole('button', { name: /create team/i }));
    expect(api.createTeam).toHaveBeenCalledWith({ organizationId, name: 'Night Shift' });
    expect(onChanged).toHaveBeenCalledTimes(1);

    await userEvent.click(within(row('Field Engineering')).getByRole('button', { name: 'Rename' }));
    const name = screen.getByLabelText(/team name/i) as HTMLInputElement;
    expect(name.value).toBe('Field Engineering');
    await userEvent.clear(name);
    await userEvent.type(name, 'Field Services');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(api.updateTeam).toHaveBeenCalledWith('team-field', { organizationId, name: 'Field Services' });
  });

  it('owners delete empty teams after confirmation; occupied teams are disabled', async () => {
    const { api, onChanged } = renderPanel('owner');
    const occupied = within(row('Network Operations')).getByRole('button', {
      name: 'Delete',
    }) as HTMLButtonElement;
    expect(occupied.disabled).toBe(true);
    expect(occupied.title).toBe('Remove the members of this team before deleting it');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const empty = within(row('Field Engineering')).getByRole('button', { name: 'Delete' });
    await userEvent.click(empty);
    expect(api.deleteTeam).not.toHaveBeenCalled();
    await userEvent.click(empty);
    expect(api.deleteTeam).toHaveBeenCalledWith('team-field', organizationId);
    expect(onChanged).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('translates a duplicate name and shows other refusals verbatim', async () => {
    const { api } = renderPanel('owner');
    api.createTeam.mockRejectedValueOnce(new ApiError('A team with this name already exists', 409));
    await userEvent.click(screen.getByRole('button', { name: /add team/i }));
    await userEvent.type(screen.getByLabelText(/team name/i), 'Network Operations');
    await userEvent.click(screen.getByRole('button', { name: /create team/i }));
    expect(
      await screen.findByText('A team with that name already exists in this organization.'),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    api.deleteTeam.mockRejectedValueOnce(
      new ApiError('Remove the members of this team before deleting it', 409),
    );
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await userEvent.click(within(row('Field Engineering')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Remove the members of this team before deleting it')).toBeTruthy();
  });
});

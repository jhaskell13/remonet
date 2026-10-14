import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MembersPanel } from '../../../src/components/MembersPanel.tsx';
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

function renderPanel(role: 'owner' | 'admin' | 'operator' | 'viewer', currentUserId: string) {
  const api = apiMock.reset();
  const onChanged = vi.fn();
  render(
    <MembersPanel
      organizationId={organizationId}
      role={role}
      currentUserId={currentUserId}
      members={members}
      teams={teams}
      onChanged={onChanged}
    />,
  );
  return { onChanged, api };
}
const rowFor = (name: string) => screen.getByText(name).closest('.member-row') as HTMLElement;

describe('MembersPanel', () => {
  it('shows every member once with their effective role', () => {
    renderPanel('viewer', 'user-viewer');
    for (const member of members) {
      const row = rowFor(member.displayName);
      expect(within(row).getByText(member.email)).toBeTruthy();
      expect(within(row).getAllByText(member.role, { exact: false }).length).toBeGreaterThan(0);
    }
    expect(within(rowFor('Northstar Viewer')).getByText('you')).toBeTruthy();
  });

  it('as a viewer: no management controls, only the option to leave', () => {
    renderPanel('viewer', 'user-viewer');
    expect(screen.queryAllByRole('combobox')).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /remove/i })).toHaveLength(0);
    expect(screen.queryAllByRole('button', { name: /add to team/i })).toHaveLength(0);
    expect(within(rowFor('Northstar Viewer')).getByRole('button', { name: 'Leave' })).toBeTruthy();
  });

  it('as an admin: manages operators and viewers with operator/viewer roles only', () => {
    renderPanel('admin', 'user-admin');
    const operatorSelect = within(rowFor('Northstar Operator')).getByRole('combobox', {
      name: /role of northstar operator/i,
    });
    expect(
      within(operatorSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Operator', 'Viewer']);
    expect(within(rowFor('Northstar Operator')).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(within(rowFor('Northstar Operator')).getByRole('button', { name: /add to team/i })).toBeTruthy();

    // Owners and fellow admins are off limits; the admin can still leave their own team.
    expect(within(rowFor('Northstar Owner')).queryByRole('combobox')).toBeNull();
    expect(within(rowFor('Northstar Owner')).queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(within(rowFor('Northstar Owner')).queryByRole('button', { name: /add to team/i })).toBeNull();
    expect(within(rowFor('Northstar Admin')).queryByRole('combobox')).toBeNull();
    expect(within(rowFor('Northstar Admin')).getByRole('button', { name: 'Leave' })).toBeTruthy();
  });

  it('as an owner: manages everyone and may grant admin or owner', () => {
    renderPanel('owner', 'user-owner');
    const adminSelect = within(rowFor('Northstar Admin')).getByRole('combobox', {
      name: /role of northstar admin/i,
    });
    expect(
      within(adminSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Owner', 'Admin', 'Operator', 'Viewer']);
    expect(within(rowFor('Northstar Admin')).getByRole('button', { name: 'Remove' })).toBeTruthy();
    expect(within(rowFor('Northstar Owner')).getByRole('button', { name: 'Leave' })).toBeTruthy();
  });

  it('changing a role calls the API for that team membership and reloads', async () => {
    const { api, onChanged } = renderPanel('owner', 'user-owner');
    const select = within(rowFor('Northstar Viewer')).getByRole('combobox', {
      name: /role of northstar viewer/i,
    });
    await userEvent.selectOptions(select, 'operator');
    expect(api.changeMemberRole).toHaveBeenCalledWith('team-ops', 'user-viewer', {
      organizationId,
      role: 'operator',
    });
    expect(onChanged).toHaveBeenCalledWith(false);
  });

  it('changing your own role tells the page to refresh the session', async () => {
    const { onChanged } = renderPanel('owner', 'user-owner');
    const select = within(rowFor('Northstar Owner')).getByRole('combobox', {
      name: /role of northstar owner/i,
    });
    await userEvent.selectOptions(select, 'admin');
    expect(onChanged).toHaveBeenCalledWith(true);
  });

  it('removal asks for confirmation and respects a cancel', async () => {
    const { api } = renderPanel('admin', 'user-admin');
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const remove = within(rowFor('Northstar Viewer')).getByRole('button', { name: 'Remove' });
    await userEvent.click(remove);
    expect(api.removeMember).not.toHaveBeenCalled();
    await userEvent.click(remove);
    expect(api.removeMember).toHaveBeenCalledWith('team-ops', 'user-viewer', organizationId);
    confirm.mockRestore();
  });

  it('adds an existing member to another team with an assignable role', async () => {
    const { api } = renderPanel('admin', 'user-admin');
    await userEvent.click(within(rowFor('Northstar Viewer')).getByRole('button', { name: /add to team/i }));
    const row = rowFor('Northstar Viewer');
    const teamSelect = within(row).getByRole('combobox', { name: 'Team' });
    expect(
      within(teamSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Field Engineering']);
    const roleSelect = within(row).getByRole('combobox', { name: 'Role' });
    expect(
      within(roleSelect)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Operator', 'Viewer']);
    await userEvent.selectOptions(roleSelect, 'operator');
    await userEvent.click(within(row).getByRole('button', { name: 'Add' }));
    expect(api.addMember).toHaveBeenCalledWith('team-field', {
      organizationId,
      userId: 'user-viewer',
      role: 'operator',
    });
  });

  it('surfaces API refusals such as the last-owner safeguard', async () => {
    const { api } = renderPanel('owner', 'user-owner');
    api.changeMemberRole.mockRejectedValueOnce(
      new Error('An organization must keep at least one owner. Promote another owner first.'),
    );
    const select = within(rowFor('Northstar Owner')).getByRole('combobox', {
      name: /role of northstar owner/i,
    });
    await userEvent.selectOptions(select, 'viewer');
    expect(
      await screen.findByText('An organization must keep at least one owner. Promote another owner first.'),
    ).toBeTruthy();
  });

  it('reports a refused team addition and allows cancelling', async () => {
    const { api, onChanged } = renderPanel('admin', 'user-admin');
    api.addMember.mockRejectedValueOnce(new Error('This person is already a member of the team'));
    await userEvent.click(within(rowFor('Northstar Viewer')).getByRole('button', { name: /add to team/i }));
    await userEvent.click(within(rowFor('Northstar Viewer')).getByRole('button', { name: 'Add' }));
    expect(await screen.findByText('This person is already a member of the team')).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
    await userEvent.click(within(rowFor('Northstar Viewer')).getByRole('button', { name: 'Cancel' }));
    expect(within(rowFor('Northstar Viewer')).queryByRole('combobox', { name: 'Team' })).toBeNull();
  });

  it('offers no team addition when the member already belongs to every team', () => {
    renderPanel('owner', 'user-owner');
    const everywhere = {
      ...members[3]!,
      teams: [
        ...members[3]!.teams,
        {
          teamId: 'team-field',
          teamName: 'Field Engineering',
          role: 'viewer' as const,
          since: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    render(
      <MembersPanel
        organizationId={organizationId}
        role="owner"
        currentUserId="user-owner"
        members={[everywhere]}
        teams={teams}
        onChanged={vi.fn()}
      />,
    );
    const rows = screen
      .getAllByText('Northstar Viewer')
      .map((node) => node.closest('.member-row') as HTMLElement);
    expect(within(rows[rows.length - 1]!).queryByRole('button', { name: /add to team/i })).toBeNull();
  });

  it('marks deactivated accounts', () => {
    apiMock.reset();
    render(
      <MembersPanel
        organizationId={organizationId}
        role="owner"
        currentUserId="user-owner"
        members={[{ ...members[3]!, isActive: false }]}
        teams={teams}
        onChanged={vi.fn()}
      />,
    );
    expect(screen.getByText('deactivated')).toBeTruthy();
  });
});

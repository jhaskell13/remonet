import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { InvitePanel } from '../../../src/components/InvitePanel.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { organizationId } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderPanel(role: 'owner' | 'admin' | 'operator' | 'viewer', selected = organizationId) {
  const api = apiMock.reset();
  const onInvited = vi.fn();
  render(<InvitePanel organizationId={selected} role={role} onInvited={onInvited} />);
  return { api, onInvited };
}

describe('InvitePanel', () => {
  it('tells operators and viewers that an admin handles invitations', () => {
    const { api } = renderPanel('operator');
    expect(screen.getByText(/an organization admin can invite engineers/i)).toBeTruthy();
    expect(screen.queryByRole('form')).toBeNull();
    expect(api.teams).not.toHaveBeenCalled();
  });

  it('loads the organization’s teams and lets an owner pick any invitable role', async () => {
    const { api } = renderPanel('owner');
    const team = (await screen.findByLabelText(/^team$/i)) as HTMLSelectElement;
    expect(api.teams).toHaveBeenCalledWith(organizationId);
    expect(
      within(team)
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Field Engineering', 'Network Operations']);
    expect(
      within(screen.getByLabelText(/^role$/i))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Admin', 'Operator', 'Viewer']);
  });

  it('does not offer the admin role to admins', async () => {
    renderPanel('admin');
    await screen.findByLabelText(/^team$/i);
    expect(
      within(screen.getByLabelText(/^role$/i))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Operator', 'Viewer']);
  });

  it('creates an invitation and shows the link to copy', async () => {
    const { api, onInvited } = renderPanel('owner');
    api.createInvitation.mockResolvedValueOnce({
      inviteUrl: 'http://127.0.0.1:5173/#invite=secret',
      email: 'x',
      expiresAt: '',
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    await screen.findByLabelText(/^team$/i);
    await userEvent.type(screen.getByLabelText(/email address/i), 'newcomer@northstar.test');
    await userEvent.selectOptions(screen.getByLabelText(/^team$/i), 'team-ops');
    await userEvent.selectOptions(screen.getByLabelText(/^role$/i), 'operator');
    await userEvent.click(screen.getByRole('button', { name: /create invite link/i }));
    expect(api.createInvitation).toHaveBeenCalledWith({
      organizationId,
      teamId: 'team-ops',
      email: 'newcomer@northstar.test',
      role: 'operator',
    });
    expect(await screen.findByText(/invitation link created/i)).toBeTruthy();
    expect(
      (screen.getByDisplayValue('http://127.0.0.1:5173/#invite=secret') as HTMLInputElement).readOnly,
    ).toBe(true);
    await userEvent.click(screen.getByRole('button', { name: /copy link/i }));
    expect(writeText).toHaveBeenCalledWith('http://127.0.0.1:5173/#invite=secret');
    expect(onInvited).toHaveBeenCalled();
    expect((screen.getByLabelText(/email address/i) as HTMLInputElement).value).toBe('');
  });

  it('shows refusals such as an existing member', async () => {
    const { api, onInvited } = renderPanel('admin');
    api.createInvitation.mockRejectedValueOnce(
      new ApiError('This person is already a member of the team', 409),
    );
    await screen.findByLabelText(/^team$/i);
    await userEvent.type(screen.getByLabelText(/email address/i), 'viewer@northstar.test');
    await userEvent.click(screen.getByRole('button', { name: /create invite link/i }));
    expect(await screen.findByText('This person is already a member of the team')).toBeTruthy();
    expect(onInvited).not.toHaveBeenCalled();
  });

  it('needs an organization and reports when teams cannot be loaded', async () => {
    const none = renderPanel('owner', '');
    expect(screen.getByText(/select an organization above before creating an invite/i)).toBeTruthy();
    expect((screen.getByRole('button', { name: /create invite link/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(none.api.teams).not.toHaveBeenCalled();
  });

  it('reports a failure to load teams', async () => {
    const api = apiMock.reset();
    api.teams.mockRejectedValueOnce(new ApiError('Organization access denied', 403));
    render(<InvitePanel organizationId={organizationId} role="owner" />);
    expect(await screen.findByText('Could not load teams.')).toBeTruthy();
    expect((screen.getByRole('button', { name: /create invite link/i }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});

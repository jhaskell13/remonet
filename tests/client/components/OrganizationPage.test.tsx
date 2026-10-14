import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { OrganizationPage } from '../../../src/components/OrganizationPage.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { organizationId, sessionFor } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderPage(
  userId: string,
  role: 'owner' | 'admin' | 'operator' | 'viewer',
  selected = organizationId,
  createRequest = 0,
  prepare: (api: ReturnType<typeof apiMock.reset>) => void = () => undefined,
) {
  const api = apiMock.reset();
  prepare(api);
  const session = sessionFor(userId, role);
  const onSelectOrganization = vi.fn();
  const onSessionChanged = vi.fn().mockResolvedValue(undefined);
  const onLogout = vi.fn();
  render(
    <OrganizationPage
      user={session.user}
      organizations={session.organizations}
      organizationId={selected}
      onSelectOrganization={onSelectOrganization}
      onSessionChanged={onSessionChanged}
      onLogout={onLogout}
      createRequest={createRequest}
    />,
  );
  return { api, onSelectOrganization, onSessionChanged, onLogout };
}
const panel = (heading: RegExp) =>
  screen.getByRole('heading', { name: heading }).closest('section') as HTMLElement;

describe('OrganizationPage', () => {
  it('shows ownership context: the organization, your role, its owners, and counts', async () => {
    renderPage('user-admin', 'admin');
    expect(await screen.findByText('owner@northstar.test')).toBeTruthy();
    const header = panel(/northstar engineering/i);
    expect(within(header).getByText(/your role/i).textContent).toContain('Admin');
    const owners = within(header).getByText('owner').previousElementSibling;
    expect(owners?.textContent).toBe('Northstar Owner');
    expect(within(header).getByText('members').previousElementSibling?.textContent).toBe('4');
    expect(within(header).getByText('teams').previousElementSibling?.textContent).toBe('2');
  });

  it('only owners see the rename control', async () => {
    renderPage('user-admin', 'admin');
    await screen.findByText('owner@northstar.test');
    expect(within(panel(/northstar engineering/i)).queryByRole('button', { name: 'Rename' })).toBeNull();
  });

  it('an owner can rename the organization, which refreshes the session', async () => {
    const { api, onSessionChanged } = renderPage('user-owner', 'owner');
    await screen.findByText('admin@northstar.test');
    await userEvent.click(within(panel(/northstar engineering/i)).getByRole('button', { name: 'Rename' }));
    const input = screen.getByLabelText(/organization name/i);
    await userEvent.clear(input);
    await userEvent.type(input, 'Northstar Ltd');
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(api.updateOrganization).toHaveBeenCalledWith(organizationId, { name: 'Northstar Ltd' });
    expect(onSessionChanged).toHaveBeenCalled();
  });

  it('admins and owners see pending invitations and the invite form; others do not', async () => {
    const { api } = renderPage('user-admin', 'admin');
    expect(await screen.findByText('newcomer@northstar.test')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /invite an engineer/i })).toBeTruthy();
    expect(api.pendingInvitations).toHaveBeenCalledWith(organizationId);
  });

  it('operators see the roster and teams but no administration', async () => {
    const { api } = renderPage('user-operator', 'operator');
    expect(await screen.findByText('owner@northstar.test')).toBeTruthy();
    expect(api.pendingInvitations).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: /pending invitations/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /add team/i })).toBeNull();
    expect(screen.getByText(/an organization admin can invite engineers/i)).toBeTruthy();
  });

  it('revokes a pending invitation after confirmation', async () => {
    const { api } = renderPage('user-owner', 'owner');
    await screen.findByText('newcomer@northstar.test');
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(api.revokeInvitation).toHaveBeenCalledWith('inv-1', organizationId);
  });

  it('team deletion is owner-only and blocked while the team has members', async () => {
    renderPage('user-owner', 'owner');
    await screen.findByText('owner@northstar.test');
    const teams = panel(/^teams/i);
    const deleteButtons = within(teams).getAllByRole('button', { name: 'Delete' }) as HTMLButtonElement[];
    expect(deleteButtons).toHaveLength(2);
    // Network Operations has four members; Field Engineering has none.
    const rows = within(teams)
      .getAllByText(/members?$/)
      .map((node) => node.textContent);
    expect(rows).toEqual(['0 members', '4 members']);
    expect(deleteButtons.map((button) => button.disabled)).toEqual([false, true]);
  });

  it('without a selected organization it lists the engineer’s organizations with their roles', async () => {
    const { onSelectOrganization } = renderPage('user-admin', 'admin', '');
    expect(screen.getByRole('heading', { name: /your organizations/i })).toBeTruthy();
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
    const acme = screen.getByText('Acme Manufacturing').closest('.network-management-row') as HTMLElement;
    expect(within(acme).getByText('Operator')).toBeTruthy();
    await userEvent.click(within(acme).getByRole('button', { name: /open/i }));
    expect(onSelectOrganization).toHaveBeenCalledWith('org-acme');
  });

  it('creates a new organization from the same panel and switches to it', async () => {
    const { api, onSelectOrganization, onSessionChanged } = renderPage('user-admin', 'admin', '');
    await userEvent.click(screen.getByRole('button', { name: /new organization/i }));
    await userEvent.type(screen.getByLabelText(/organization name/i), 'Harbor Networks');
    await userEvent.click(screen.getByRole('button', { name: /create organization/i }));
    expect(api.createOrganization).toHaveBeenCalledWith({ name: 'Harbor Networks', teamName: 'Owners' });
    expect(onSessionChanged).toHaveBeenCalled();
    expect(onSelectOrganization).toHaveBeenLastCalledWith('org-new');
  });

  it('opens the creation form directly when creation was requested', () => {
    renderPage('user-admin', 'admin', '', 1);
    expect(screen.getByLabelText(/organization name/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /new organization/i })).toBeNull();
  });

  it('the selected-organization view stays focused on that organization', async () => {
    renderPage('user-owner', 'owner');
    await screen.findByText('owner@northstar.test');
    expect(screen.queryByRole('heading', { name: /your organizations/i })).toBeNull();
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
  });

  it('shows a load failure without hiding the ownership header', async () => {
    renderPage('user-owner', 'owner', organizationId, 0, (api) => {
      api.members.mockRejectedValueOnce(new ApiError('Organization access denied', 403));
    });
    expect(await screen.findByText('Organization access denied')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /northstar engineering/i })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^members/i })).toBeNull();
  });

  it('signs out when the session has expired', async () => {
    const { onLogout } = renderPage('user-owner', 'owner', organizationId, 0, (api) => {
      api.teams.mockRejectedValueOnce(new ApiError('Unauthorized', 401));
    });
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
  });

  it('reports a failed rename and keeps the form open', async () => {
    const { api } = renderPage('user-owner', 'owner');
    api.updateOrganization.mockRejectedValueOnce(new ApiError('Organization owner access required', 403));
    await screen.findByText('admin@northstar.test');
    await userEvent.click(within(panel(/northstar engineering/i)).getByRole('button', { name: 'Rename' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save name' }));
    expect(await screen.findByText('Organization owner access required')).toBeTruthy();
    expect(screen.getByLabelText(/organization name/i)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
  });

  it('reports a failed revocation and leaves the invitation listed', async () => {
    const { api } = renderPage('user-owner', 'owner');
    api.revokeInvitation.mockRejectedValueOnce(new ApiError('Invitation not found', 404));
    await screen.findByText('newcomer@northstar.test');
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('Invitation not found')).toBeTruthy();
    expect(screen.getByText('newcomer@northstar.test')).toBeTruthy();
  });

  it('shows an empty pending list', async () => {
    renderPage('user-owner', 'owner', organizationId, 0, (api) => {
      api.pendingInvitations.mockResolvedValue({ data: [] });
    });
    expect(await screen.findByText(/no pending invitations/i)).toBeTruthy();
  });

  it('reports a failed organization creation and allows cancelling', async () => {
    const { api, onSessionChanged } = renderPage('user-admin', 'admin', '', 1);
    api.createOrganization.mockRejectedValueOnce(new ApiError('Organization name is required', 400));
    await userEvent.type(screen.getByLabelText(/organization name/i), 'x');
    await userEvent.click(screen.getByRole('button', { name: /create organization/i }));
    expect(await screen.findByText('Organization name is required')).toBeTruthy();
    expect(onSessionChanged).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
    expect(screen.getByRole('button', { name: /new organization/i })).toBeTruthy();
  });
});

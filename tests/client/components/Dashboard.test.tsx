import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import Dashboard from '../../../src/components/Dashboard.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { devices, sessionFor } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderDashboard(role: 'owner' | 'admin' | 'operator' | 'viewer' = 'admin') {
  const api = apiMock.reset();
  const session = sessionFor('user-admin', role);
  const onLogout = vi.fn();
  render(
    <Dashboard
      user={session.user}
      organizations={session.organizations}
      onLogout={onLogout}
      onSessionChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  return { api, onLogout };
}
const page = (name: RegExp) => screen.getByRole('button', { name });
const breadcrumbs = () => document.querySelector('.breadcrumbs')!.textContent ?? '';
const roleContext = () => (document.querySelector('.top-actions .live-indicator')!.textContent ?? '').trim();
async function switchTo(name: RegExp) {
  await userEvent.click(document.querySelector('.workspace-switcher button')!);
  const menu = screen.getByRole('listbox', { name: /switch organization/i });
  await userEvent.click(within(menu).getByRole('option', { name }));
}

describe('Dashboard organization context', () => {
  it('starts in the first organization and shows the engineer’s role there', async () => {
    const { api } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    expect(breadcrumbs()).toContain('Acme Manufacturing');
    expect(roleContext()).toBe('Operator in Acme Manufacturing');
    expect(screen.getByText('Operator controls')).toBeTruthy();
    expect(api.networks).toHaveBeenLastCalledWith({ organizationId: 'org-acme' });
  });

  it('switching organizations updates the context, the data scope, and is remembered', async () => {
    const { api } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await switchTo(/northstar engineering/i);
    expect(breadcrumbs()).toContain('Northstar Engineering');
    expect(roleContext()).toBe('Admin in Northstar Engineering');
    expect(screen.getByText('Admin controls')).toBeTruthy();
    expect(api.networks).toHaveBeenLastCalledWith({ organizationId: 'org-demo' });
    expect(window.localStorage.getItem('remonet.organization.user-admin')).toBe('org-demo');
  });

  it('restores the remembered organization for the same account', async () => {
    window.localStorage.setItem('remonet.organization.user-admin', 'org-demo');
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    expect(breadcrumbs()).toContain('Northstar Engineering');
  });

  it('ignores a remembered organization the account no longer belongs to', async () => {
    window.localStorage.setItem('remonet.organization.user-admin', 'org-gone');
    const { api } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    expect(breadcrumbs()).toContain('Acme Manufacturing');
    expect(api.networks).toHaveBeenLastCalledWith({ organizationId: 'org-acme' });
  });

  it('the cross-organization view is read only and the organization page offers creation', async () => {
    const { api } = renderDashboard('viewer');
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), '');
    expect(screen.getByText('Read only')).toBeTruthy();
    expect(roleContext()).toBe('2 organizations');
    expect(api.networks).toHaveBeenLastCalledWith({});
    await userEvent.click(screen.getByRole('button', { name: /◎Organization/ }));
    expect(screen.getByRole('heading', { name: /your organizations/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /new organization/i })).toBeTruthy();
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
  });

  it('“New organization” in the switcher jumps straight to the creation form', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(document.querySelector('.workspace-switcher button')!);
    await userEvent.click(screen.getByRole('button', { name: /new organization/i }));
    expect(screen.getByRole('heading', { name: /your organizations/i })).toBeTruthy();
    expect(screen.getByLabelText(/organization name/i)).toBeTruthy();
    // Leaving the page and coming back shows the list in its normal, collapsed state.
    await userEvent.click(screen.getByRole('button', { name: /◫Overview/ }));
    await userEvent.click(screen.getByRole('button', { name: /◎Organization/ }));
    expect(screen.queryByLabelText(/organization name/i)).toBeNull();
  });
});

describe('Dashboard pages', () => {
  it('overview shows the API overview figures and the first devices and areas', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    const stat = (label: string) =>
      [...document.querySelectorAll('.stat-card')].find(
        (card) => card.querySelector('.stat-label')?.textContent === label,
      )!;
    expect(stat('Total devices').querySelector('.stat-value')?.textContent).toBe('4');
    expect(stat('Needs attention').querySelector('.stat-value')?.textContent).toBe('3');
    expect(stat('Needs attention').querySelector('.stat-detail')?.textContent).toBe(
      '1 pending · 1 warnings · 1 offline',
    );
    expect(stat('Network health').querySelector('.stat-value')?.textContent).toBe('33.33%');
    expect(screen.getByText('3 devices need review.')).toBeTruthy();
    expect(screen.getAllByText('Data Center').length).toBeGreaterThan(0);
  });

  it('devices page searches by name, id, area, or type and filters by status', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(page(/▤Devices/));
    expect(screen.getByRole('heading', { name: /all devices/i }).textContent).toContain(
      String(devices.length),
    );
    const rows = () => screen.getAllByRole('row').slice(1);
    expect(rows()).toHaveLength(4);
    await userEvent.type(screen.getByPlaceholderText(/search devices/i), 'data center');
    expect(rows()).toHaveLength(3);
    await userEvent.clear(screen.getByPlaceholderText(/search devices/i));
    await userEvent.type(screen.getByPlaceholderText(/search devices/i), 'firewall');
    expect(rows()).toHaveLength(1);
    await userEvent.clear(screen.getByPlaceholderText(/search devices/i));
    await userEvent.selectOptions(screen.getByDisplayValue('All devices'), 'Pending');
    expect(rows()).toHaveLength(1);
    expect(within(rows()[0]!).getByText('New Switch')).toBeTruthy();
    await userEvent.selectOptions(screen.getByDisplayValue('Pending'), 'Healthy');
    expect(within(rows()[0]!).getByText('Core Router 01')).toBeTruthy();
  });

  it('"Review issues" jumps to the devices page filtered on warnings', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(screen.getByRole('button', { name: /review issues/i }));
    expect(screen.getByRole('heading', { name: /all devices/i })).toBeTruthy();
    expect((screen.getByDisplayValue('Warning') as HTMLSelectElement).value).toBe('Warning');
    expect(screen.getAllByRole('row').slice(1)).toHaveLength(1);
  });

  it('topology and activity pages render their illustrative content', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(page(/⌘Topology/));
    expect(screen.getByRole('heading', { name: 'Topology' })).toBeTruthy();
    expect(screen.getByText(/device connections are illustrative/i)).toBeTruthy();
    await userEvent.click(page(/◷Activity/));
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
    expect(screen.getByText('Configuration backup completed')).toBeTruthy();
    await userEvent.click(page(/◫Overview/));
    await userEvent.click(screen.getByRole('button', { name: /view activity/i }));
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeTruthy();
  });

  it('areas page shows per-area health', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(page(/⌖Areas/));
    const card = screen.getByRole('heading', { name: 'Data Center' }).closest('section') as HTMLElement;
    expect(within(card).getByText('Degraded')).toBeTruthy();
    expect(within(card).getByText('Total devices').previousElementSibling?.textContent).toBe('3');
    const healthy = screen.getByRole('heading', { name: 'North Campus' }).closest('section') as HTMLElement;
    expect(within(healthy).getByText('Operational')).toBeTruthy();
  });

  it('selecting a network narrows every inventory request and enables device administration', async () => {
    const { api } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Network' }), 'net-core');
    await waitFor(() =>
      expect(api.devices).toHaveBeenLastCalledWith({ organizationId: 'org-acme', networkId: 'net-core' }),
    );
    expect(api.areas).toHaveBeenLastCalledWith({ organizationId: 'org-acme', networkId: 'net-core' });
    expect(api.overview).toHaveBeenLastCalledWith({ organizationId: 'org-acme', networkId: 'net-core' });
    expect(api.networks).toHaveBeenLastCalledWith({ organizationId: 'org-acme' });
    await userEvent.click(page(/⚙Settings/));
    expect(screen.getByRole('heading', { name: /enroll a device/i })).toBeTruthy();
    expect(screen.getByText(/register hardware in core network/i)).toBeTruthy();
  });

  it('settings page gates administration by the role in the selected organization', async () => {
    renderDashboard('viewer');
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.click(page(/⚙Settings/));
    // The viewer's first organization (Acme) grants operator: devices yes, networks no.
    expect(screen.queryByRole('button', { name: /add network/i })).toBeNull();
    expect(screen.getByText(/select a network to manage its areas/i)).toBeTruthy();
    expect(screen.getByText(/2 organizations/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: /2 organizations/ }));
    expect(await screen.findByRole('heading', { name: /acme manufacturing/i })).toBeTruthy();
  });

  it('shows a data error without losing the shell', async () => {
    const { api, onLogout } = renderDashboard();
    api.devices.mockRejectedValueOnce(new ApiError('Organization access denied', 403));
    await screen.findByRole('heading', { name: /welcome/i });
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), 'org-demo');
    expect(await screen.findByText('Organization access denied')).toBeTruthy();
    expect(onLogout).not.toHaveBeenCalled();
  });

  it('signs out when the session is no longer valid', async () => {
    const { api, onLogout } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    api.networks.mockRejectedValueOnce(new ApiError('Unauthorized', 401));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), 'org-demo');
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
  });
});

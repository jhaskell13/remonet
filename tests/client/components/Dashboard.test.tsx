import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import Dashboard from '../../../src/components/Dashboard.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { devices, overview, sessionFor } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderDashboard(
  role: 'owner' | 'admin' | 'operator' | 'viewer' = 'admin',
  prepare: (api: ReturnType<typeof apiMock.reset>) => void = () => {},
) {
  const api = apiMock.reset();
  prepare(api);
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
    expect(screen.getByText(/^Data last updated .* ago$/).getAttribute('title')).toContain('2026');
  });

  it('overview says so when nothing has been collected yet', async () => {
    renderDashboard('admin', (api) =>
      api.overview.mockResolvedValue({ data: { ...overview, updatedAt: null } }),
    );
    await screen.findByRole('heading', { name: /welcome/i });
    expect(screen.getByText('No checks collected yet')).toBeTruthy();
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

  it('signs out when the session is no longer valid', async () => {
    const { api, onLogout } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    api.networks.mockRejectedValueOnce(new ApiError('Unauthorized', 401));
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), 'org-demo');
    await waitFor(() => expect(onLogout).toHaveBeenCalled());
  });
});

/** jsdom has no EventSource; this one lets the test play the server's part. */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
  }
  push(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? [])
      listener({ data: JSON.stringify(data) } as MessageEvent<string>);
  }
}

describe('Dashboard live updates', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeEventSource.instances = [];
  });

  it('reports when the stream is unavailable and still loads data', async () => {
    renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    expect(screen.getByRole('status').textContent).toContain('Live updates unavailable');
  });

  it('subscribes to the selected organization and refreshes the moment a check lands', async () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    const { api } = renderDashboard();
    await screen.findByRole('heading', { name: /welcome/i });
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/monitoring/events?organizationId=org-acme');
    expect(screen.getByRole('status').textContent).toContain('Connecting live updates…');
    act(() => source.onopen?.());
    expect(screen.getByRole('status').textContent).toContain('Live updates');
    expect(api.devices).toHaveBeenCalledTimes(1);

    // A cycle delivers one event per device; the dashboard refreshes once for the burst.
    act(() => {
      source.push('observation', { type: 'observation', organizationId: 'org-acme', deviceId: 'RTR-001' });
      source.push('observation', { type: 'observation', organizationId: 'org-acme', deviceId: 'FW-002' });
      source.push('cycle', { type: 'cycle', organizationId: 'org-acme', networkId: 'net-acme' });
    });
    await waitFor(() => expect(api.devices).toHaveBeenCalledTimes(2));
    expect(api.overview).toHaveBeenCalledTimes(2);
    act(() => {
      source.readyState = FakeEventSource.CONNECTING;
      source.onerror?.();
    });
    expect(screen.getByRole('status').textContent).toContain('Reconnecting live updates…');

    // Switching organizations re-subscribes with the new scope and closes the old stream.
    await switchTo(/northstar engineering/i);
    expect(source.closed).toBe(true);
    expect(FakeEventSource.instances[1]?.url).toBe('/api/monitoring/events?organizationId=org-demo');
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Organization' }), '');
    expect(FakeEventSource.instances[2]?.url).toBe('/api/monitoring/events');
  });
});

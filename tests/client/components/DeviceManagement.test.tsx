import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { DeviceManagement } from '../../../src/components/DeviceManagement.tsx';
import { checkFollowUp } from '../../../src/lib/live-updates.ts';
import { apiMock } from '../helpers/api-mock.ts';
import { areas, devices, networks, observations, organizationId } from '../helpers/fixtures.ts';

const followUpDefaults = { ...checkFollowUp };
afterEach(() => Object.assign(checkFollowUp, followUpDefaults));

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

const network = networks[0]!;
function renderPanel(props: Partial<Parameters<typeof DeviceManagement>[0]> = {}) {
  const api = apiMock.reset();
  const onChanged = vi.fn();
  const view = render(
    <DeviceManagement
      devices={devices}
      areas={areas}
      network={network}
      canEdit
      canDelete
      onChanged={onChanged}
      {...props}
    />,
  );
  return { api, onChanged, view };
}
const row = (name: string) => screen.getByText(name).closest('.network-management-row') as HTMLElement;

describe('DeviceManagement', () => {
  it('lists devices with type, address, area, status, and the reason for the status', () => {
    renderPanel();
    const firewall = row('Edge Firewall');
    expect(within(firewall).getByText('Firewall · 10.10.0.2 · Data Center')).toBeTruthy();
    expect(within(firewall).getByText('Warning').className).toContain('status-pill warning');
    expect(within(firewall).getByText('latency 28 ms is above the 25 ms limit')).toBeTruthy();
    expect(within(row('New Switch')).getByText('Pending')).toBeTruthy();
    expect(within(row('New Switch')).getByText('Waiting for the first check')).toBeTruthy();
    expect(within(row('Lobby Access Point')).getByText('The last check got no answer')).toBeTruthy();
  });

  it('asks for a network before devices can be changed', () => {
    renderPanel({ network: undefined });
    expect(screen.getByText(/select a network in the dashboard filters/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('separates editing (operators) from removal (admins)', () => {
    renderPanel({ canDelete: false });
    expect(screen.getAllByRole('button', { name: 'Edit' })).toHaveLength(devices.length);
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('hides all management actions from viewers but lets them read the history', () => {
    renderPanel({ canEdit: false, canDelete: false });
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    expect(screen.getAllByRole('button', { name: /^History/ })).toHaveLength(devices.length);
  });

  it('shows when each device last answered a check', () => {
    renderPanel();
    expect(within(row('Core Router 01')).getByText(/^Last answered /)).toBeTruthy();
    expect(
      within(row('Core Router 01'))
        .getByText(/^Last answered /)
        .getAttribute('title'),
    ).toContain('2026');
    expect(within(row('New Switch')).getByText('Never checked · waiting for the first check')).toBeTruthy();
  });

  it('lets operators ask for a check now and follows it through to the recorded result', async () => {
    checkFollowUp.intervalMs = 5;
    checkFollowUp.attempts = 3;
    const { api } = renderPanel({ canDelete: false });
    // The first look finds only old history; the second finds the check that just landed.
    api.deviceObservations.mockResolvedValueOnce({ data: observations }).mockResolvedValueOnce({
      data: [
        {
          ...observations[0]!,
          id: 'obs-new',
          deviceId: 'SW-050',
          latencyMs: 4,
          loadPercent: 21,
          collectedAt: new Date().toISOString(),
          createdAt: new Date(Date.now() + 1_000).toISOString(),
        },
      ],
    });
    await userEvent.click(within(row('New Switch')).getByRole('button', { name: 'Check now' }));
    expect(api.requestDeviceCheck).toHaveBeenCalledWith('SW-050', organizationId);
    expect(
      await within(row('New Switch')).findByText(/Check requested from the simulator collector/),
    ).toBeTruthy();
    expect(
      await within(row('New Switch')).findByText('Checked just now: Healthy — answered in 4 ms at 21% load'),
    ).toBeTruthy();
    expect(api.deviceObservations).toHaveBeenCalledTimes(2);

    // A failed check reads as such; when nothing arrives in time the engineer is told where to look.
    api.deviceObservations.mockResolvedValueOnce({
      data: [{ ...observations[1]!, id: 'obs-fail', createdAt: new Date(Date.now() + 1_000).toISOString() }],
    });
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: 'Check now' }));
    expect(await within(row('Core Router 01')).findByText(/Timed out — Check timed out$/)).toBeTruthy();
    expect(within(row('New Switch')).queryByRole('status')).toBeNull();
    api.deviceObservations
      .mockRejectedValueOnce(new Error('flaky'))
      .mockResolvedValue({ data: observations });
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: 'Check now' }));
    expect(
      await within(row('Edge Firewall')).findByText('No result arrived; see the history for the outcome.'),
    ).toBeTruthy();

    api.requestDeviceCheck.mockRejectedValueOnce(new ApiError('No collector is running', 409));
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: 'Check now' }));
    expect(await within(row('Core Router 01')).findByText('No collector is running')).toBeTruthy();
    api.requestDeviceCheck.mockRejectedValueOnce('boom');
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: 'Check now' }));
    expect(await within(row('Edge Firewall')).findByText('Could not request a check.')).toBeTruthy();
  });

  it('keeps an open history in step with the refreshed device list', async () => {
    const { api, view } = renderPanel();
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: /^History/ }));
    await screen.findByRole('region', { name: 'Check history for Edge Firewall' });
    api.deviceObservations.mockResolvedValueOnce({ data: [observations[0]!] });
    view.rerender(
      <DeviceManagement
        devices={devices.map((device) => ({ ...device }))}
        areas={areas}
        network={network}
        canEdit
        canDelete
        onChanged={vi.fn()}
      />,
    );
    await waitFor(() => expect(api.deviceObservations).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(
        within(screen.getByRole('region', { name: 'Check history for Edge Firewall' })).getAllByRole('row'),
      ).toHaveLength(2),
    );
  });

  it('expands a titled, tabular check history directly under the selected device', async () => {
    const { api } = renderPanel();
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: /^History/ }));
    expect(api.deviceObservations).toHaveBeenCalledWith('FW-002', { organizationId, limit: 10 });
    const history = await screen.findByRole('region', { name: 'Check history for Edge Firewall' });
    // The panel sits immediately after the device it belongs to and names it.
    expect(row('Edge Firewall').nextElementSibling).toBe(history);
    expect(history.textContent).toContain('Check history · Edge Firewall');
    expect(history.textContent).toContain('10.10.0.2');
    const table = within(history).getByRole('table');
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Checked at', 'Status', 'Latency', 'Load', 'Why', 'Source']);
    const cells = (index: number) =>
      within(within(table).getAllByRole('row')[index + 1]!)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(0)).toEqual([
      expect.stringContaining('2026'),
      'Warning',
      '28 ms',
      '76%',
      'latency 28 ms is above the 25 ms limit and load 76% is above the 70% limit',
      'simulator',
    ]);
    expect(cells(1)).toEqual([
      expect.stringContaining('2026'),
      'Timed out',
      '—',
      '—',
      'Check timed out',
      'simulator',
    ]);
    expect(within(table).getAllByRole('row')[2]?.querySelector('.status-pill')?.className).toContain(
      'offline',
    );
    expect(within(table).getAllByRole('row')[1]?.querySelector('.mono')?.getAttribute('title')).toBe(
      '2026-10-12T13:39:00.000Z',
    );
    const toggle = within(row('Edge Firewall')).getByRole('button', { name: /^Hide history/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe(history.id);
    // One device's history at a time; hiding it removes the panel without another request.
    expect(screen.getAllByRole('button', { name: /^History/ })).toHaveLength(devices.length - 1);
    await userEvent.click(toggle);
    expect(screen.queryByRole('region', { name: /check history/i })).toBeNull();
    expect(api.deviceObservations).toHaveBeenCalledTimes(1);
  });

  it('switches the open history to another device', async () => {
    const { api } = renderPanel();
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: /^History/ }));
    await screen.findByRole('region', { name: 'Check history for Edge Firewall' });
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: /^History/ }));
    expect(await screen.findByRole('region', { name: 'Check history for Core Router 01' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Check history for Edge Firewall' })).toBeNull();
    expect(api.deviceObservations).toHaveBeenLastCalledWith('RTR-001', { organizationId, limit: 10 });
  });

  it('explains an empty history and surfaces load failures', async () => {
    const { api } = renderPanel();
    api.deviceObservations.mockResolvedValueOnce({ data: [] });
    await userEvent.click(within(row('New Switch')).getByRole('button', { name: /^History/ }));
    expect(await screen.findByText(/no checks have been recorded/i)).toBeTruthy();
    api.deviceObservations.mockRejectedValueOnce(new ApiError('Organization access denied', 403));
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: /^History/ }));
    expect(await screen.findByText('Organization access denied')).toBeTruthy();
    api.deviceObservations.mockRejectedValueOnce('boom');
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: /^History/ }));
    expect(await screen.findByText('Could not load the check history.')).toBeTruthy();
  });

  it('hides the history controls while a device is being edited', async () => {
    renderPanel();
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: /^History/ }));
    await screen.findByRole('region', { name: /check history/i });
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: 'Edit' }));
    expect(screen.queryByRole('region', { name: /check history/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /history/i })).toBeNull();
  });

  it('moves a device to another area and updates its metadata', async () => {
    const { api, onChanged } = renderPanel();
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: 'Edit' }));
    expect((screen.getByLabelText(/^area$/i) as HTMLSelectElement).value).toBe('area-north');
    await userEvent.selectOptions(screen.getByLabelText(/^area$/i), 'area-dc');
    const address = screen.getByLabelText(/management address/i) as HTMLInputElement;
    await userEvent.clear(address);
    await userEvent.type(address, ' 10.20.0.254 ');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(api.updateDevice).toHaveBeenCalledWith('RTR-001', {
      organizationId,
      networkId: 'net-core',
      areaId: 'area-dc',
      name: 'Core Router 01',
      type: 'Router',
      address: '10.20.0.254',
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it('removes a device only after confirmation', async () => {
    const { api, onChanged } = renderPanel();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const remove = within(row('Lobby Access Point')).getByRole('button', { name: 'Remove' });
    await userEvent.click(remove);
    expect(api.deleteDevice).not.toHaveBeenCalled();
    await userEvent.click(remove);
    expect(api.deleteDevice).toHaveBeenCalledWith('AP-037', organizationId);
    expect(onChanged).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('translates an address conflict and shows other refusals verbatim', async () => {
    const { api } = renderPanel();
    api.updateDevice.mockRejectedValueOnce(
      new ApiError('A device with this address already exists in the network', 409),
    );
    await userEvent.click(within(row('Core Router 01')).getByRole('button', { name: 'Edit' }));
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(
      await screen.findByText('A device with that address already exists in this network.'),
    ).toBeTruthy();

    api.deleteDevice.mockRejectedValueOnce(new ApiError('Organization admin access required', 403));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await userEvent.click(within(row('Edge Firewall')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Organization admin access required')).toBeTruthy();
  });
});

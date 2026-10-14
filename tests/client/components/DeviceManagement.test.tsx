import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { DeviceManagement } from '../../../src/components/DeviceManagement.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { areas, devices, networks, organizationId } from '../helpers/fixtures.ts';

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
  render(
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
  return { api, onChanged };
}
const row = (name: string) => screen.getByText(name).closest('.network-management-row') as HTMLElement;

describe('DeviceManagement', () => {
  it('lists devices with type, address, area, and status', () => {
    renderPanel();
    expect(
      within(row('Edge Firewall')).getByText('Firewall · 10.10.0.2 · Data Center · Warning'),
    ).toBeTruthy();
    expect(within(row('New Switch')).getByText(/Pending$/)).toBeTruthy();
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

  it('hides all actions from viewers', () => {
    renderPanel({ canEdit: false, canDelete: false });
    expect(screen.queryByRole('button')).toBeNull();
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

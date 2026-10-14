import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { AreaManagement } from '../../../src/components/AreaManagement.tsx';
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
function renderPanel(props: Partial<Parameters<typeof AreaManagement>[0]> = {}) {
  const api = apiMock.reset();
  const onChanged = vi.fn();
  render(
    <AreaManagement
      areas={areas}
      devices={devices}
      network={network}
      canManage
      onChanged={onChanged}
      {...props}
    />,
  );
  return { api, onChanged };
}
const row = (name: string) => screen.getByText(name).closest('.network-management-row') as HTMLElement;

describe('AreaManagement', () => {
  it('lists areas with their device counts', () => {
    renderPanel();
    expect(within(row('Data Center')).getByText(/3 devices assigned/)).toBeTruthy();
    expect(within(row('Spare Rack')).queryByText(/devices assigned/)).toBeNull();
  });

  it('requires a selected network and management rights', () => {
    renderPanel({ network: undefined });
    expect(screen.getByText(/select a network to manage its areas/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add area/i })).toBeNull();
  });

  it('hides controls from non-managers', () => {
    renderPanel({ canManage: false });
    expect(screen.queryByRole('button', { name: /add area/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('only allows deleting empty areas, after confirmation', async () => {
    const { api, onChanged } = renderPanel();
    const occupied = within(row('Data Center')).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(occupied.disabled).toBe(true);
    expect(occupied.title).toBe('Move or remove assigned devices first');
    const empty = within(row('Spare Rack')).getByRole('button', { name: 'Delete' }) as HTMLButtonElement;
    expect(empty.disabled).toBe(false);
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await userEvent.click(empty);
    expect(api.deleteArea).not.toHaveBeenCalled();
    await userEvent.click(empty);
    expect(api.deleteArea).toHaveBeenCalledWith('area-empty', { organizationId, networkId: 'net-core' });
    expect(onChanged).toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('explains a deletion refused by the server because devices were added meanwhile', async () => {
    const { api } = renderPanel();
    api.deleteArea.mockRejectedValueOnce(
      new ApiError('Move or remove the devices in this area before deleting it', 409),
    );
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true);
    await userEvent.click(within(row('Spare Rack')).getByRole('button', { name: 'Delete' }));
    expect(
      await screen.findByText(
        'This area still contains devices. Move or remove them before deleting the area.',
      ),
    ).toBeTruthy();
  });

  it('creates and edits areas within the selected network', async () => {
    const { api } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /add area/i }));
    await userEvent.type(screen.getByLabelText(/area name/i), ' Lab ');
    await userEvent.type(screen.getByLabelText(/region or location/i), ' Austin, US ');
    await userEvent.click(screen.getByRole('button', { name: /create area/i }));
    expect(api.createArea).toHaveBeenCalledWith({
      organizationId,
      networkId: 'net-core',
      name: 'Lab',
      region: 'Austin, US',
    });

    await userEvent.click(within(row('North Campus')).getByRole('button', { name: 'Edit' }));
    const region = screen.getByLabelText(/region or location/i) as HTMLInputElement;
    expect(region.value).toBe('Boston, US');
    await userEvent.clear(region);
    await userEvent.type(region, 'Cambridge, US');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(api.updateArea).toHaveBeenCalledWith('area-north', {
      organizationId,
      networkId: 'net-core',
      name: 'North Campus',
      region: 'Cambridge, US',
    });
  });

  it('translates a duplicate name into a clear message', async () => {
    const { api } = renderPanel();
    api.createArea.mockRejectedValueOnce(
      new ApiError('An area with this name already exists in the network', 409),
    );
    await userEvent.click(screen.getByRole('button', { name: /add area/i }));
    await userEvent.type(screen.getByLabelText(/area name/i), 'Data Center');
    await userEvent.type(screen.getByLabelText(/region or location/i), 'NY');
    await userEvent.click(screen.getByRole('button', { name: /create area/i }));
    expect(await screen.findByText('An area with that name already exists in this network.')).toBeTruthy();
  });
});

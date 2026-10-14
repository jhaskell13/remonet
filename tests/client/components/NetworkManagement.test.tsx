import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { NetworkManagement } from '../../../src/components/NetworkManagement.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { networks, organizationId } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderPanel(props: Partial<Parameters<typeof NetworkManagement>[0]> = {}) {
  const api = apiMock.reset();
  const onChanged = vi.fn();
  render(
    <NetworkManagement
      networks={networks}
      organizationId={organizationId}
      canManage
      onChanged={onChanged}
      {...props}
    />,
  );
  return { api, onChanged };
}

describe('NetworkManagement', () => {
  it('lists only the selected organization’s networks', () => {
    renderPanel();
    expect(screen.getByText('Core Network')).toBeTruthy();
    expect(screen.getByText('Branch Network')).toBeTruthy();
    expect(screen.queryByText('Plant Network')).toBeNull();
    expect(screen.getByText('No description')).toBeTruthy();
  });

  it('hides management controls from viewers and operators', () => {
    renderPanel({ canManage: false });
    expect(screen.queryByRole('button', { name: /add network/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('asks for an organization when none is selected', () => {
    renderPanel({ organizationId: '' });
    expect(screen.getByText(/select an organization to manage its networks/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /add network/i })).toBeNull();
  });

  it('creates a network with trimmed values and reloads', async () => {
    const { api, onChanged } = renderPanel();
    await userEvent.click(screen.getByRole('button', { name: /add network/i }));
    await userEvent.type(screen.getByLabelText(/network name/i), '  DMZ  ');
    await userEvent.type(screen.getByLabelText(/description/i), ' Public services ');
    await userEvent.click(screen.getByRole('button', { name: /create network/i }));
    expect(api.createNetwork).toHaveBeenCalledWith({
      organizationId,
      name: 'DMZ',
      description: 'Public services',
    });
    expect(onChanged).toHaveBeenCalled();
    expect(screen.queryByLabelText(/network name/i)).toBeNull();
  });

  it('edits an existing network in place', async () => {
    const { api } = renderPanel();
    const row = screen.getByText('Branch Network').closest('.network-management-row') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: 'Edit' }));
    const name = screen.getByLabelText(/network name/i) as HTMLInputElement;
    expect(name.value).toBe('Branch Network');
    await userEvent.clear(name);
    await userEvent.type(name, 'Branch Network v2');
    await userEvent.click(screen.getByRole('button', { name: /save changes/i }));
    expect(api.updateNetwork).toHaveBeenCalledWith('net-branch', {
      organizationId,
      name: 'Branch Network v2',
      description: '',
    });
  });

  it('translates a name conflict into a clear message and keeps the form open', async () => {
    const { api, onChanged } = renderPanel();
    api.createNetwork.mockRejectedValueOnce(new ApiError('A network with this name already exists', 409));
    await userEvent.click(screen.getByRole('button', { name: /add network/i }));
    await userEvent.type(screen.getByLabelText(/network name/i), 'Core Network');
    await userEvent.click(screen.getByRole('button', { name: /create network/i }));
    expect(
      await screen.findByText('A network with that name already exists in this organization.'),
    ).toBeTruthy();
    expect(screen.getByLabelText(/network name/i)).toBeTruthy();
    expect(onChanged).not.toHaveBeenCalled();
  });

  it('shows other failures verbatim and can be cancelled', async () => {
    const { api } = renderPanel();
    api.createNetwork.mockRejectedValueOnce(new ApiError('Organization admin access required', 403));
    await userEvent.click(screen.getByRole('button', { name: /add network/i }));
    await userEvent.type(screen.getByLabelText(/network name/i), 'X');
    await userEvent.click(screen.getByRole('button', { name: /create network/i }));
    expect(await screen.findByText('Organization admin access required')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText(/network name/i)).toBeNull();
  });
});

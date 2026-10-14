import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { DeviceEnrollment } from '../../../src/components/DeviceEnrollment.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { areas, networks, organizationId } from '../helpers/fixtures.ts';

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
function renderPanel(props: Partial<Parameters<typeof DeviceEnrollment>[0]> = {}) {
  const api = apiMock.reset();
  const onEnrolled = vi.fn();
  render(<DeviceEnrollment areas={areas} network={network} canEnroll onEnrolled={onEnrolled} {...props} />);
  return { api, onEnrolled };
}

describe('DeviceEnrollment', () => {
  it('enrolls a device into the chosen area with trimmed values and clears the form', async () => {
    const { api, onEnrolled } = renderPanel();
    await userEvent.type(screen.getByLabelText(/device name/i), '  Rack Switch ');
    await userEvent.selectOptions(screen.getByLabelText(/device type/i), 'Switch');
    await userEvent.type(screen.getByLabelText(/management address/i), ' 10.10.2.30 ');
    await userEvent.selectOptions(screen.getByLabelText(/^area$/i), 'area-north');
    await userEvent.click(screen.getByRole('button', { name: /enroll device/i }));
    expect(api.enrollDevice).toHaveBeenCalledWith({
      organizationId,
      networkId: 'net-core',
      areaId: 'area-north',
      name: 'Rack Switch',
      type: 'Switch',
      address: '10.10.2.30',
    });
    expect(onEnrolled).toHaveBeenCalled();
    expect((screen.getByLabelText(/device name/i) as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText(/management address/i) as HTMLInputElement).value).toBe('');
  });

  it('defaults to the first area and offers every supported type', () => {
    renderPanel();
    expect((screen.getByLabelText(/^area$/i) as HTMLSelectElement).value).toBe('area-dc');
    expect(
      within(screen.getByLabelText(/device type/i))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).toEqual(['Router', 'Switch', 'Firewall', 'Access point', 'Other']);
  });

  it('explains why enrollment is unavailable', () => {
    renderPanel({ network: undefined });
    expect(screen.getByText(/select a network to enroll a device/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /enroll device/i })).toBeNull();
  });

  it('needs an area before a device can be enrolled', () => {
    renderPanel({ areas: [] });
    expect(screen.getByText(/add an area to this network before enrolling a device/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /enroll device/i })).toBeNull();
  });

  it('tells viewers they lack operator access', () => {
    renderPanel({ canEnroll: false });
    expect(screen.getByText(/you need operator access or higher/i)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /enroll device/i })).toBeNull();
  });

  it('translates an address conflict and keeps the entered values', async () => {
    const { api, onEnrolled } = renderPanel();
    api.enrollDevice.mockRejectedValueOnce(
      new ApiError('A device with this address already exists in the network', 409),
    );
    await userEvent.type(screen.getByLabelText(/device name/i), 'Dup');
    await userEvent.type(screen.getByLabelText(/management address/i), '10.10.0.2');
    await userEvent.click(screen.getByRole('button', { name: /enroll device/i }));
    expect(
      await screen.findByText('A device with that address is already registered in this network.'),
    ).toBeTruthy();
    expect((screen.getByLabelText(/management address/i) as HTMLInputElement).value).toBe('10.10.0.2');
    expect(onEnrolled).not.toHaveBeenCalled();

    api.enrollDevice.mockRejectedValueOnce(new ApiError('Enter a valid IP address or hostname', 400));
    await userEvent.click(screen.getByRole('button', { name: /enroll device/i }));
    expect(await screen.findByText('Enter a valid IP address or hostname')).toBeTruthy();
  });
});

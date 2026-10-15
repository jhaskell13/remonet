import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '../../../src/api/client.ts';
import { CollectionStatus } from '../../../src/components/CollectionStatus.tsx';
import { apiMock } from '../helpers/api-mock.ts';
import { collectionStatus, organizationId } from '../helpers/fixtures.ts';

vi.mock('../../../src/api/client.ts', async (importOriginal) => {
  const { apiMock } = await import('../helpers/api-mock.ts');
  return {
    ...(await importOriginal<typeof import('../../../src/api/client.ts')>()),
    get api() {
      return apiMock.current;
    },
  };
});

function renderPanel(
  props: Partial<Parameters<typeof CollectionStatus>[0]> = {},
  prepare: (api: ReturnType<typeof apiMock.reset>) => void = () => {},
) {
  const api = apiMock.reset();
  prepare(api);
  const view = render(
    <CollectionStatus organizationId={organizationId} canManage dataVersion={0} {...props} />,
  );
  return { api, view };
}

describe('CollectionStatus', () => {
  it('shows the collector, each network’s schedule, and the outcome of its last cycle', async () => {
    const { api } = renderPanel();
    const panel = await screen.findByRole('region', { name: 'Collection' });
    expect(api.monitoringStatus).toHaveBeenCalledWith({ organizationId });
    expect(await within(panel).findByText('simulator collector · running · 1 checks in flight')).toBeTruthy();
    const rows = within(panel).getAllByRole('row').slice(1);
    const cells = (row: HTMLElement) =>
      within(row)
        .getAllByRole('cell')
        .map((cell) => cell.textContent);
    expect(cells(rows[0]!)).toEqual([
      'Core Network',
      'Every 30 s · running',
      'In progress',
      expect.stringMatching(/ago$/),
      '2 ok · 1 timed out · 1 failed · 10000 ms',
    ]);
    expect(cells(rows[1]!)).toEqual(['Branch Network', 'Paused', '—', 'Not yet', 'database is locked']);
  });

  it('explains when nothing collects and when no network is scheduled', async () => {
    renderPanel({}, (api) =>
      api.monitoringStatus.mockResolvedValue({
        data: { collector: 'off', running: false, inFlight: 0, networks: [] },
      }),
    );
    expect(await screen.findByText(/no collector is running/i)).toBeTruthy();
    expect(screen.getByText(/no networks are scheduled/i)).toBeTruthy();
  });

  it('shows the next scheduled cycle and reloads when the dashboard data changes', async () => {
    const { api, view } = renderPanel();
    api.monitoringStatus.mockResolvedValue({
      data: {
        ...collectionStatus,
        inFlight: 0,
        networks: [
          { ...collectionStatus.networks[0]!, running: false, nextRunAt: '2026-10-12T13:40:30.000Z' },
        ],
      },
    });
    view.rerender(<CollectionStatus organizationId={organizationId} canManage dataVersion={1} />);
    expect(await screen.findByText(/2026/)).toBeTruthy();
    expect(api.monitoringStatus).toHaveBeenCalledTimes(2);
  });

  it('surfaces failures and renders nothing for non-admins or without an organization', async () => {
    const { api, view } = renderPanel();
    api.monitoringStatus.mockRejectedValueOnce(new ApiError('Organization admin access required', 403));
    view.rerender(<CollectionStatus organizationId={organizationId} canManage dataVersion={5} />);
    expect(await screen.findByText('Organization admin access required')).toBeTruthy();
    api.monitoringStatus.mockRejectedValueOnce('boom');
    view.rerender(<CollectionStatus organizationId={organizationId} canManage dataVersion={6} />);
    expect(await screen.findByText('Could not load collection state.')).toBeTruthy();
    view.rerender(<CollectionStatus organizationId={organizationId} canManage={false} dataVersion={7} />);
    expect(screen.queryByRole('region', { name: 'Collection' })).toBeNull();
    view.rerender(<CollectionStatus organizationId="" canManage dataVersion={8} />);
    expect(screen.queryByRole('region', { name: 'Collection' })).toBeNull();
    expect(api.monitoringStatus).toHaveBeenCalledTimes(3);
  });
});

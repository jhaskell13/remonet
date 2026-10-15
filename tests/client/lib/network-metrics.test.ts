import { describe, expect, it } from 'vitest';
import { getAreaSummaries, getOverview } from '../../../src/lib/network-metrics.ts';
import { areas, devices } from '../helpers/fixtures.ts';

describe('network metrics', () => {
  it('summarises each area with its device count, healthy count, and status', () => {
    const summaries = getAreaSummaries(devices, areas);
    expect(
      summaries.map(({ id, totalDevices, healthy, status }) => ({ id, totalDevices, healthy, status })),
    ).toEqual([
      { id: 'area-dc', totalDevices: 3, healthy: 0, status: 'Degraded' },
      { id: 'area-north', totalDevices: 1, healthy: 1, status: 'Operational' },
      { id: 'area-empty', totalDevices: 0, healthy: 0, status: 'Operational' },
    ]);
    expect(summaries[0]).toMatchObject({ name: 'Data Center', region: 'New York, US' });
  });

  it('computes the overview the same way the API does', () => {
    const overview = getOverview(devices, areas);
    expect(overview).toMatchObject({
      totalDevices: 4,
      online: 1,
      healthy: 1,
      warning: 1,
      offline: 1,
      pending: 1,
      needsAttention: 3,
      healthScore: 33.33,
      areas: 3,
    });
    expect(overview.updatedAt).toBe('2026-10-12T13:40:00.000Z');
  });

  it('reports the newest last-seen time as the data freshness, or null without any', () => {
    expect(getOverview([], []).updatedAt).toBeNull();
    expect(
      getOverview(
        devices.filter((device) => device.status === 'Pending'),
        areas,
      ).updatedAt,
    ).toBeNull();
    const [router, firewall] = devices;
    expect(
      getOverview([{ ...firewall!, lastSeen: '2026-10-12T13:39:00.000Z' }, router!], areas).updatedAt,
    ).toBe('2026-10-12T13:40:00.000Z');
  });

  it('excludes pending devices from the health score and handles empty inventories', () => {
    expect(getOverview([], []).healthScore).toBe(0);
    expect(
      getOverview(
        devices.filter((device) => device.status === 'Pending'),
        areas,
      ).healthScore,
    ).toBe(0);
    const healthyOnly = devices.filter(
      (device) => device.status === 'Healthy' || device.status === 'Pending',
    );
    expect(getOverview(healthyOnly, areas)).toMatchObject({ healthScore: 100, needsAttention: 1 });
  });
});

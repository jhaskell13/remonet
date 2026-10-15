import { describe, expect, it } from 'vitest';
import type { Device, NetworkOverview } from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import { useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo } = fixtures;
type One<T> = { data: T };
type Many<T> = { data: T[] };

const setLastSeen = (deviceId: string, lastSeen: string | null) =>
  db.prepare('UPDATE devices SET last_seen = ? WHERE id = ?').run(lastSeen, deviceId);
const storedStatus = (deviceId: string) =>
  (db.prepare('SELECT status FROM devices WHERE id = ?').get(deviceId) as { status: string }).status;
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

describe('device status as reported by the API', () => {
  const api = useTestApp();

  it('reports the seeded inventory with its illustrative statuses while the data is fresh', async () => {
    const response = await api.as(users.nsViewer).get<Many<Device>>('/api/devices', {
      query: { organizationId: demo.organizationId },
    });
    expect(Object.fromEntries(response.body.data.map((device) => [device.id, device.status]))).toEqual({
      'RTR-001': 'Healthy',
      'SW-014': 'Healthy',
      'FW-002': 'Warning',
      'AP-037': 'Offline',
      'RTR-008': 'Healthy',
      'SW-021': 'Healthy',
    });
  });

  it('demotes a device that stopped answering to Offline without rewriting the inventory', async () => {
    setLastSeen(demo.coreRouterId, minutesAgo(5.1));
    setLastSeen(demo.edgeFirewallId, minutesAgo(4.9));
    const response = await api.as(users.nsViewer).get<Many<Device>>('/api/devices', {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    const byId = Object.fromEntries(response.body.data.map((device) => [device.id, device]));
    expect(byId['RTR-001']).toMatchObject({
      status: 'Offline',
      statusReason: 'No successful check for 5 min (limit 5 min)',
      latency: 4,
      load: 32,
    });
    expect(byId['FW-002']).toMatchObject({
      status: 'Warning',
      statusReason: 'latency 28 ms is above the 25 ms limit and load 76% is above the 70% limit',
    });
    expect(byId['SW-021']).toMatchObject({ status: 'Healthy', statusReason: 'answered in 3 ms at 41% load' });
    // The cached snapshot still says Healthy; only the reported status changed with time.
    expect(storedStatus(demo.coreRouterId)).toBe('Healthy');
  });

  it('keeps Pending and Offline devices as they are, however old their data is', async () => {
    setLastSeen('AP-037', minutesAgo(60 * 24 * 30));
    const enrolled = await api.as(users.nsOperator).post<One<Device>>('/api/devices', {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.dataCenterAreaId,
      name: 'Rack Switch',
      type: 'Switch',
      address: '10.10.2.30',
    });
    const response = await api.as(users.nsViewer).get<Many<Device>>('/api/devices', {
      query: { organizationId: demo.organizationId },
    });
    const byId = Object.fromEntries(response.body.data.map((device) => [device.id, device]));
    expect(byId['AP-037']).toMatchObject({ status: 'Offline', statusReason: 'The last check got no answer' });
    expect(byId[enrolled.body.data.id]).toMatchObject({
      status: 'Pending',
      statusReason: 'Waiting for the first check',
    });
  });

  it('applies the same rule to single-device responses and to the overview counts', async () => {
    setLastSeen(demo.coreRouterId, minutesAgo(10));
    setLastSeen('SW-014', minutesAgo(10));
    const renamed = await api.as(users.nsOperator).patch<One<Device>>(`/api/devices/${demo.coreRouterId}`, {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.northCampusAreaId,
      name: 'Core Router 01 (stale)',
      type: 'Router',
      address: '10.20.0.1',
    });
    expect(renamed.body.data.status).toBe('Offline');
    const overview = await api.as(users.nsViewer).get<One<NetworkOverview>>('/api/overview', {
      query: { organizationId: demo.organizationId },
    });
    expect(overview.body.data).toMatchObject({
      totalDevices: 6,
      healthy: 2,
      warning: 1,
      offline: 3,
      pending: 0,
      needsAttention: 4,
      healthScore: 33.33,
    });
  });
});

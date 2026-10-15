import { describe, expect, it } from 'vitest';
import type { Device, DeviceObservation, NetworkOverview } from '../../../shared/network.ts';
import { recordObservation } from '../../../server/modules/monitoring/monitoring.service.ts';
import { expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
type One<T> = { data: T };
type Many<T> = { data: T[] };
const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

function observe(
  deviceId: string,
  minutes: number,
  extra: Partial<Parameters<typeof recordObservation>[0]> = {},
) {
  return recordObservation({
    deviceId,
    organizationId: demo.organizationId,
    source: 'simulator',
    result: 'success',
    latencyMs: 5,
    loadPercent: 40,
    uptimeSeconds: 86_400,
    collectedAt: minutesAgo(minutes),
    ...extra,
  }).observation;
}

describe('GET /api/devices/:deviceId/observations', () => {
  const api = useTestApp();
  const path = `/api/devices/${demo.coreRouterId}/observations`;
  const scope = { organizationId: demo.organizationId };

  it('returns the device history newest first, with every recorded detail', async () => {
    const older = observe(demo.coreRouterId, 3);
    const failed = observe(demo.coreRouterId, 2, { result: 'error', errorMessage: 'SNMP auth failure' });
    const newest = observe(demo.coreRouterId, 1, { latencyMs: 31 });
    const response = await api.as(users.nsViewer).get<Many<DeviceObservation>>(path, { query: scope });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([newest, failed, older]);
    expect(response.body.data[1]).toMatchObject({
      source: 'simulator',
      result: 'error',
      errorMessage: 'SNMP auth failure',
      latencyMs: null,
    });
  });

  it('is empty for a device that has never been checked', async () => {
    const response = await api.as(users.nsViewer).get<Many<DeviceObservation>>(path, { query: scope });
    expect(response.body.data).toEqual([]);
  });

  it('honours the limit and caps it at 200', async () => {
    for (let minute = 0; minute < 3; minute += 1) observe(demo.coreRouterId, minute);
    const limited = await api.as(users.nsViewer).get<Many<DeviceObservation>>(path, {
      query: { ...scope, limit: 2 },
    });
    expect(limited.body.data).toHaveLength(2);
    expectError(
      await api.as(users.nsViewer).get(path, { query: { ...scope, limit: 201 } }),
      400,
      'Invalid request',
    );
    expectError(
      await api.as(users.nsViewer).get(path, { query: { ...scope, limit: 0 } }),
      400,
      'Invalid request',
    );
  });

  it('requires the organization and refuses anything outside the caller’s memberships', async () => {
    expectError(await api.as(users.nsViewer).get(path), 400, 'Invalid request');
    expectError(
      await api.as(users.nsViewer).get(path, { query: { organizationId: acme.organizationId } }),
      403,
      'Organization access denied',
    );
    expectError(
      await api.as(users.acmeOwner).get(path, { query: { organizationId: acme.organizationId } }),
      404,
      'Device not found',
    );
    expectError(
      await api.as(users.nsViewer).get('/api/devices/dev-missing/observations', { query: scope }),
      404,
      'Device not found',
    );
    expect((await api.anonymous.get(path, { query: scope })).status).toBe(401);
  });

  it('is readable with the integration token inside its organizations', async () => {
    observe(demo.coreRouterId, 1);
    const allowed = await api.asService().get<Many<DeviceObservation>>(path, { query: scope });
    expect(allowed.status).toBe(200);
    expect(allowed.body.data).toHaveLength(1);
    const denied = await api
      .asService()
      .get(`/api/devices/${acme.routerId}/observations`, { query: { organizationId: acme.organizationId } });
    expect(denied.status).toBe(403);
  });
});

describe('overview freshness', () => {
  const api = useTestApp();
  const overviewFor = async (query: Record<string, string>) =>
    (await api.as(users.nsOwner).get<One<NetworkOverview>>('/api/overview', { query })).body.data;

  it('reports the newest collection time in scope, not the time of the request', async () => {
    const seeded = fixtures.devices
      .filter((device) => device.organizationId === demo.organizationId)
      .map((device) => device.lastSeen!)
      .sort()
      .at(-1)!;
    expect((await overviewFor({ organizationId: demo.organizationId })).updatedAt).toBe(seeded);
    // A failed check does not move `lastSeen`, but it is still the newest data collected.
    const timeout = observe(demo.branchGatewayId, 0, { result: 'timeout', collectedAt: undefined });
    expect((await overviewFor({ organizationId: demo.organizationId })).updatedAt).toBe(timeout.collectedAt);
    expect((await overviewFor({ networkId: demo.coreNetworkId })).updatedAt).toBe(seeded);
  });

  it('is null while nothing in scope has ever reported', async () => {
    const network = await api.as(users.nsOwner).post<One<{ id: string }>>('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Quiet',
      description: '',
    });
    const area = await api.as(users.nsOwner).post<One<{ id: string }>>('/api/areas', {
      organizationId: demo.organizationId,
      networkId: network.body.data.id,
      name: 'Rack',
      region: 'Lab',
    });
    const device = await api.as(users.nsOwner).post<One<Device>>('/api/devices', {
      organizationId: demo.organizationId,
      networkId: network.body.data.id,
      areaId: area.body.data.id,
      name: 'Quiet Switch',
      type: 'Switch',
      address: '10.99.0.1',
    });
    const quiet = await overviewFor({ networkId: network.body.data.id });
    expect(quiet).toMatchObject({ totalDevices: 1, pending: 1, updatedAt: null });
    observe(device.body.data.id, 0, { result: 'timeout', collectedAt: undefined });
    expect((await overviewFor({ networkId: network.body.data.id })).updatedAt).not.toBeNull();
  });
});

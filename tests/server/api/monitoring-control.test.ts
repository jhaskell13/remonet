import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Device } from '../../../shared/network.ts';
import { getActiveScheduler, setActiveScheduler } from '../../../server/collectors/runtime.ts';
import { CollectorScheduler } from '../../../server/collectors/scheduler.ts';
import { SimulatorCollector } from '../../../server/collectors/simulator.ts';
import {
  publishMonitoringEvent,
  subscribeToMonitoringEvents,
  type MonitoringEvent,
} from '../../../server/modules/monitoring/events.ts';
import { recordObservation } from '../../../server/modules/monitoring/monitoring.service.ts';
import type { CollectionStatus } from '../../../server/modules/monitoring/collection.service.ts';
import { listDevices, listNetworks } from '../../../server/persistence/repositories/network-repository.ts';
import { expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
type One<T> = { data: T };
type Many<T> = { data: T[] };
const silent = { info() {}, warn() {}, error() {} };

/** A scheduler wired like production but never started: checks only happen on demand. */
function installScheduler(personalities: Record<string, 'steady' | 'down'> = {}) {
  const scheduler = new CollectorScheduler({
    collector: new SimulatorCollector({ personalities, delayFactor: 0 }),
    logger: silent,
    listNetworks: () => listNetworks(),
    listDevices: (network) => listDevices({ networkId: network.id }),
    record: (input) => void recordObservation(input),
    checkTimeoutMs: 1_000,
    maxConcurrentChecks: 2,
    retry: { attempts: 1, baseDelayMs: 1, maxDelayMs: 1 },
  });
  setActiveScheduler(scheduler);
  return scheduler;
}

describe('collection state and on-demand checks', () => {
  const api = useTestApp();
  afterEach(async () => {
    await getActiveScheduler()?.stop();
    setActiveScheduler(undefined);
  });

  it('reports that nothing collects in the test configuration', async () => {
    const response = await api.as(users.nsOwner).get<One<CollectionStatus>>('/api/monitoring/status');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ collector: 'off', running: false, inFlight: 0, networks: [] });
    expectError(
      await api.as(users.nsOwner).post(`/api/devices/${demo.coreRouterId}/check`, {
        organizationId: demo.organizationId,
      }),
      409,
      'No collector is running',
    );
  });

  it('shows collection state only for networks the caller administers', async () => {
    const scheduler = installScheduler();
    scheduler.start();
    // Admin in org-demo, operator in org-acme: sees Northstar's networks, not Acme's.
    const consultant = await api.as(users.multiOrg).get<One<CollectionStatus>>('/api/monitoring/status');
    expect(consultant.body.data).toMatchObject({ collector: 'simulator', running: true });
    expect(consultant.body.data.networks.map((network) => network.networkId).sort()).toEqual([
      demo.branchNetworkId,
      demo.coreNetworkId,
    ]);
    expect(consultant.body.data.networks[0]).toMatchObject({
      enabled: true,
      pollIntervalSeconds: expect.any(Number),
      nextRunAt: expect.any(String),
      lastCycle: null,
      lastError: null,
    });
    const filtered = await api.as(users.nsOwner).get<One<CollectionStatus>>('/api/monitoring/status', {
      query: { organizationId: demo.organizationId },
    });
    expect(filtered.body.data.networks).toHaveLength(2);
    expectError(
      await api
        .as(users.multiOrg)
        .get('/api/monitoring/status', { query: { organizationId: acme.organizationId } }),
      403,
      'Organization admin access required',
    );
    const viewer = await api.as(users.nsViewer).get<One<CollectionStatus>>('/api/monitoring/status');
    expect(viewer.body.data.networks).toEqual([]);
    expectError(await api.asService().get('/api/monitoring/status'), 403);
    expect((await api.anonymous.get('/api/monitoring/status')).status).toBe(401);
  });

  it('lets operators ask for a check now and the result lands without waiting for a cycle', async () => {
    installScheduler({ [demo.coreRouterId]: 'down' });
    const operator = api.as(users.nsOperator);
    const accepted = await operator.post<One<{ requested: true; deviceId: string; collector: string }>>(
      `/api/devices/${demo.coreRouterId}/check`,
      { organizationId: demo.organizationId },
    );
    expect(accepted.status).toBe(202);
    expect(accepted.body.data).toEqual({
      requested: true,
      deviceId: demo.coreRouterId,
      collector: 'simulator',
    });
    await vi.waitFor(async () => {
      const device = await operator.get<Many<Device>>('/api/devices', {
        query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
      });
      expect(device.body.data.find((candidate) => candidate.id === demo.coreRouterId)?.status).toBe(
        'Offline',
      );
    });
    expectError(
      await api.as(users.nsViewer).post(`/api/devices/${demo.coreRouterId}/check`, {
        organizationId: demo.organizationId,
      }),
      403,
      'Organization operator access required',
    );
    expectError(
      await operator.post('/api/devices/dev-missing/check', { organizationId: demo.organizationId }),
      404,
      'Device not found',
    );
    expectError(
      await operator.post(`/api/devices/${acme.routerId}/check`, { organizationId: acme.organizationId }),
      403,
      'Organization access denied',
    );
    expectError(
      await api
        .asService()
        .post(`/api/devices/${demo.coreRouterId}/check`, { organizationId: demo.organizationId }),
      403,
      'Organization access denied',
    );
  });

  it('checks a newly enrolled device immediately so it leaves Pending on its own', async () => {
    installScheduler();
    const operator = api.as(users.nsOperator);
    const enrolled = await operator.post<One<Device>>('/api/devices', {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.dataCenterAreaId,
      name: 'Rack Router',
      type: 'Router',
      address: '10.10.2.40',
    });
    expect(enrolled.body.data.status).toBe('Pending');
    await vi.waitFor(async () => {
      const devices = await operator.get<Many<Device>>('/api/devices', {
        query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
      });
      const device = devices.body.data.find((candidate) => candidate.id === enrolled.body.data.id);
      expect(device?.status).not.toBe('Pending');
      expect(device?.lastSeen ?? device?.status).toBeTruthy();
    });
  });

  it('re-checks a device as soon as its address changes, but not on a plain rename', async () => {
    const scheduler = installScheduler();
    const checks = vi.spyOn(scheduler, 'checkDevice');
    const operator = api.as(users.nsOperator);
    const base = {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.northCampusAreaId,
      type: 'Router',
    };
    await operator.patch(`/api/devices/${demo.coreRouterId}`, {
      ...base,
      name: 'Core Router 01 (renamed)',
      address: '10.20.0.1',
    });
    expect(checks).not.toHaveBeenCalled();
    const readdressed = await operator.patch<One<Device>>(`/api/devices/${demo.coreRouterId}`, {
      ...base,
      name: 'Core Router 01 (renamed)',
      address: '10.20.0.254',
    });
    expect(readdressed.body.data.status).toBe('Pending');
    expect(checks).toHaveBeenCalledWith(
      expect.objectContaining({ id: demo.coreRouterId, address: '10.20.0.254' }),
    );
    await vi.waitFor(async () => {
      const devices = await operator.get<Many<Device>>('/api/devices', {
        query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
      });
      expect(devices.body.data.find((candidate) => candidate.id === demo.coreRouterId)?.status).not.toBe(
        'Pending',
      );
    });
  });

  it('announces inventory changes after they are committed', async () => {
    const events: MonitoringEvent[] = [];
    const unsubscribe = subscribeToMonitoringEvents((event) => events.push(event));
    try {
      const owner = api.as(users.nsOwner);
      const network = await owner.post<One<{ id: string }>>('/api/networks', {
        organizationId: demo.organizationId,
        name: 'Events',
        description: '',
      });
      await owner.patch(`/api/networks/${network.body.data.id}`, {
        organizationId: demo.organizationId,
        name: 'Events v2',
        description: '',
      });
      const area = await owner.post<One<{ id: string }>>('/api/areas', {
        organizationId: demo.organizationId,
        networkId: network.body.data.id,
        name: 'Rack',
        region: 'Lab',
      });
      await owner.patch(`/api/areas/${area.body.data.id}`, {
        organizationId: demo.organizationId,
        networkId: network.body.data.id,
        name: 'Rack 2',
        region: 'Lab',
      });
      const device = await owner.post<One<Device>>('/api/devices', {
        organizationId: demo.organizationId,
        networkId: network.body.data.id,
        areaId: area.body.data.id,
        name: 'Switch',
        type: 'Switch',
        address: '10.77.0.1',
      });
      await owner.delete(`/api/devices/${device.body.data.id}`, {
        query: { organizationId: demo.organizationId },
      });
      await owner.delete(`/api/areas/${area.body.data.id}`, {
        query: { organizationId: demo.organizationId, networkId: network.body.data.id },
      });
      // A refused change announces nothing.
      await owner.delete('/api/devices/dev-missing', { query: { organizationId: demo.organizationId } });
      expect(
        events.map((event) =>
          event.type === 'inventory' ? `${event.entityType}.${event.action}` : event.type,
        ),
      ).toEqual([
        'network.created',
        'network.updated',
        'area.created',
        'area.updated',
        'device.created',
        'device.deleted',
        'area.deleted',
      ]);
      expect(events[4]).toMatchObject({
        organizationId: demo.organizationId,
        networkId: network.body.data.id,
        entityId: device.body.data.id,
      });
    } finally {
      unsubscribe();
    }
    publishMonitoringEvent({
      type: 'cycle',
      organizationId: 'x',
      networkId: 'y',
      devices: 0,
      success: 0,
      timeout: 0,
      error: 0,
      completedAt: '',
    });
    expect(events).toHaveLength(7);
  });
});

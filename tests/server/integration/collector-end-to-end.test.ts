import { describe, expect, it } from 'vitest';
import type { Device, DeviceObservation, NetworkOverview } from '../../../shared/network.ts';
import { CollectorScheduler, type SchedulerLogger } from '../../../server/collectors/scheduler.ts';
import { SimulatorCollector } from '../../../server/collectors/simulator.ts';
import { recordObservation } from '../../../server/modules/monitoring/monitoring.service.ts';
import { listDevices, listNetworks } from '../../../server/persistence/repositories/network-repository.ts';
import { useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo } = fixtures;
type One<T> = { data: T };
type Many<T> = { data: T[] };

/**
 * The whole collection path without any hardware: the real API enrolls a device, the scheduler
 * drives the simulator against the real inventory, results land through the monitoring service,
 * and the API reports the new status, history, and freshness.
 */
describe('end-to-end collection with the simulator', () => {
  const api = useTestApp();
  const lines: { level: string; fields: Record<string, unknown>; message: string }[] = [];
  const logger: SchedulerLogger = {
    info: (fields, message) => void lines.push({ level: 'info', fields, message }),
    warn: (fields, message) => void lines.push({ level: 'warn', fields, message }),
    error: (fields, message) => void lines.push({ level: 'error', fields, message }),
  };
  function scheduler(personalities: Record<string, 'steady' | 'busy' | 'down'>) {
    lines.length = 0;
    return new CollectorScheduler({
      collector: new SimulatorCollector({ personalities, delayFactor: 0.05 }),
      logger,
      listNetworks: () => listNetworks(),
      listDevices: (network) => listDevices({ networkId: network.id }),
      record: (input) => void recordObservation(input),
      checkTimeoutMs: 1_000,
      maxConcurrentChecks: 4,
      retry: { attempts: 2, baseDelayMs: 1, maxDelayMs: 1 },
    });
  }

  it('takes an enrolled device from Pending to a collected status with a timestamped history', async () => {
    const operator = api.as(users.nsOperator);
    const enrolled = await operator.post<One<Device>>('/api/devices', {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.dataCenterAreaId,
      name: 'Rack Switch',
      type: 'Switch',
      address: '10.10.2.30',
    });
    const deviceId = enrolled.body.data.id;
    expect(enrolled.body.data).toMatchObject({ status: 'Pending', lastSeen: null });

    const startedAt = Date.now();
    const runner = scheduler({
      [deviceId]: 'steady',
      'RTR-001': 'steady',
      'SW-014': 'steady',
      'FW-002': 'busy',
      'SW-021': 'down',
    });
    const cycle = await runner.runNetwork(demo.coreNetworkId);
    expect(cycle).toMatchObject({
      networkId: demo.coreNetworkId,
      devices: 5,
      success: 4,
      retries: 1,
      dropped: 0,
    });
    expect(cycle.timeout + cycle.error).toBe(1);

    const devices = await operator.get<Many<Device>>('/api/devices', {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    const byId = Object.fromEntries(devices.body.data.map((device) => [device.id, device]));
    expect(byId[deviceId]).toMatchObject({
      status: 'Healthy',
      uptime: expect.stringMatching(/^\d+d \d\dh$/),
    });
    expect(byId[deviceId]!.latency).toBeGreaterThan(0);
    expect(Date.parse(byId[deviceId]!.lastSeen!)).toBeGreaterThanOrEqual(startedAt);
    expect(byId['FW-002']).toMatchObject({ status: 'Warning' });
    expect(byId['FW-002']!.load).toBeGreaterThan(70);
    expect(byId['SW-021']).toMatchObject({ status: 'Offline', latency: 0, load: 0 });

    const history = await operator.get<Many<DeviceObservation>>(`/api/devices/${deviceId}/observations`, {
      query: { organizationId: demo.organizationId },
    });
    expect(history.body.data).toHaveLength(1);
    expect(history.body.data[0]).toMatchObject({
      deviceId,
      source: 'simulator',
      result: 'success',
      errorMessage: null,
      loadPercent: expect.any(Number),
      uptimeSeconds: expect.any(Number),
    });
    const outage = await operator.get<Many<DeviceObservation>>('/api/devices/SW-021/observations', {
      query: { organizationId: demo.organizationId },
    });
    expect(outage.body.data[0]).toMatchObject({
      source: 'simulator',
      errorMessage: expect.stringContaining('10.10.2.21'),
    });
    expect(['timeout', 'error']).toContain(outage.body.data[0]?.result);

    const overview = await operator.get<One<NetworkOverview>>('/api/overview', {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    expect(overview.body.data).toMatchObject({ totalDevices: 5, pending: 0, warning: 1, offline: 1 });
    expect(Date.parse(overview.body.data.updatedAt!)).toBeGreaterThanOrEqual(startedAt);

    // Every check produced a structured log line and the scheduler remembers the cycle.
    const checked = lines.filter((line) => line.message === 'Device checked');
    expect(checked.map((line) => line.fields.deviceId).sort()).toEqual(
      ['FW-002', 'RTR-001', 'SW-014', 'SW-021', deviceId].sort(),
    );
    expect(checked.find((line) => line.fields.deviceId === 'SW-021')?.fields).toMatchObject({
      source: 'simulator',
      attempts: 2,
      error: expect.stringContaining('10.10.2.21'),
    });
    expect(runner.getState().networks.find((state) => state.networkId === demo.coreNetworkId)).toMatchObject({
      running: false,
      lastCycle: cycle,
      lastError: null,
    });
    await runner.stop();
  });

  it('accumulates history across cycles, newest first, and leaves other networks untouched', async () => {
    const viewer = api.as(users.nsViewer);
    const runner = scheduler({ 'RTR-001': 'steady' });
    await runner.runNetwork(demo.coreNetworkId);
    await runner.runNetwork(demo.coreNetworkId);
    await runner.runNetwork(demo.coreNetworkId);
    const history = await viewer.get<Many<DeviceObservation>>('/api/devices/RTR-001/observations', {
      query: { organizationId: demo.organizationId },
    });
    expect(history.body.data).toHaveLength(3);
    const times = history.body.data.map((observation) => observation.collectedAt);
    expect([...times].sort().reverse()).toEqual(times);
    expect(new Set(history.body.data.map((observation) => observation.id)).size).toBe(3);
    const branch = await viewer.get<Many<DeviceObservation>>('/api/devices/RTR-008/observations', {
      query: { organizationId: demo.organizationId },
    });
    expect(branch.body.data).toEqual([]);
    await runner.stop();
  });

  it('skips networks whose monitoring is paused when started on the real schedule', async () => {
    const owner = api.as(users.nsOwner);
    await owner.patch(`/api/networks/${demo.coreNetworkId}`, {
      organizationId: demo.organizationId,
      name: 'Core Network',
      description: 'Data center and campus infrastructure',
      monitoringEnabled: false,
    });
    const runner = scheduler({});
    runner.start();
    const state = runner.getState();
    expect(state.networks.find((network) => network.networkId === demo.coreNetworkId)).toMatchObject({
      enabled: false,
      nextRunAt: null,
    });
    expect(state.networks.find((network) => network.networkId === demo.branchNetworkId)).toMatchObject({
      enabled: true,
      nextRunAt: expect.any(String),
    });
    await runner.stop();
    expect(lines.map((line) => line.message)).toContain('Collector scheduler stopped');
  });
});

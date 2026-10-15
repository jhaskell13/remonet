import { describe, expect, it, vi } from 'vitest';
import type { Device, DeviceObservation } from '../../../shared/network.ts';

// The collector is off for the rest of the suite so background cycles never race the per-test
// transactions. This file turns the simulator on before any server module loads, then boots the
// real application exactly as `server/index.ts` does.
process.env.REMONET_COLLECTOR = 'simulator';
process.env.REMONET_CHECK_TIMEOUT_MS = '500';

const { createApp } = await import('../../../server/app.ts');
const { createSession } = await import('../../../server/auth.ts');
const { getActiveScheduler } = await import('../../../server/collectors/runtime.ts');
const { db } = await import('../../../server/persistence/database.ts');
const { seedTestData, fixtures, users } = await import('../helpers/fixtures.ts');

const { demo } = fixtures;
type One<T> = { data: T };
type Many<T> = { data: T[] };

describe('the application with the simulator configured', () => {
  it('starts collecting when ready, checks enrollments at once, and stops cleanly on close', async () => {
    const app = await createApp();
    seedTestData();
    // Nothing collects before the server is ready.
    expect(getActiveScheduler()?.getState().running).toBe(false);
    await app.ready();
    const scheduler = getActiveScheduler()!;
    expect(scheduler.getState()).toMatchObject({ running: true, source: 'simulator' });
    expect(
      scheduler
        .getState()
        .networks.map((network) => network.networkId)
        .sort(),
    ).toEqual(['net-acme', 'net-branch', 'net-core', 'net-solo']);

    const cookies = { remonet_session: createSession(users.nsOperator.id).token };
    const enrolled = await app.inject({
      method: 'POST',
      url: '/api/devices',
      cookies,
      payload: {
        organizationId: demo.organizationId,
        networkId: demo.coreNetworkId,
        areaId: demo.dataCenterAreaId,
        name: 'Fresh Router',
        type: 'Router',
        address: '10.10.2.99',
      },
    });
    expect(enrolled.statusCode).toBe(201);
    const device = (enrolled.json() as One<Device>).data;
    expect(device.status).toBe('Pending');

    await vi.waitFor(
      async () => {
        const response = await app.inject({
          method: 'GET',
          url: `/api/devices/${device.id}/observations?organizationId=${demo.organizationId}`,
          cookies,
        });
        const history = (response.json() as Many<DeviceObservation>).data;
        expect(history.length).toBeGreaterThan(0);
        expect(history[0]).toMatchObject({ source: 'simulator', deviceId: device.id });
      },
      { timeout: 5_000 },
    );
    const listed = await app.inject({
      method: 'GET',
      url: `/api/devices?organizationId=${demo.organizationId}&networkId=${demo.coreNetworkId}`,
      cookies,
    });
    const current = (listed.json() as Many<Device>).data.find((candidate) => candidate.id === device.id);
    expect(current?.status).not.toBe('Pending');

    // The first scheduled cycles run against the seeded inventory as well.
    await vi.waitFor(
      () => {
        const core = scheduler
          .getState()
          .networks.find((network) => network.networkId === demo.coreNetworkId);
        expect(core?.lastCycle?.devices).toBe(5);
      },
      { timeout: 5_000 },
    );

    await app.close();
    expect(scheduler.getState().running).toBe(false);
    expect(getActiveScheduler()).toBeUndefined();
    expect(() => db.prepare('SELECT 1').get()).toThrow(/not open/);
  });
});

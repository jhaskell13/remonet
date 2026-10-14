import { describe, expect, it } from 'vitest';
import type { Area, Device, Network } from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import { expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
type One<T> = { data: T };
type Many<T> = { data: T[] };

describe('networks', () => {
  const api = useTestApp();

  it('creates a network inside the caller’s organization with a server-generated id', async () => {
    const owner = api.as(users.nsOwner);
    const created = await owner.post<One<Network>>('/api/networks', {
      organizationId: demo.organizationId,
      name: 'DMZ',
      description: 'Public services',
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      organizationId: demo.organizationId,
      name: 'DMZ',
      description: 'Public services',
    });
    const listed = await owner.get<Many<Network>>('/api/networks', {
      query: { organizationId: demo.organizationId },
    });
    expect(listed.body.data.map((network) => network.name)).toEqual([
      'Branch Network',
      'Core Network',
      'DMZ',
    ]);
  });

  it('enforces unique names per organization, case-insensitively, while allowing reuse elsewhere', async () => {
    const owner = api.as(users.nsOwner);
    expectError(
      await owner.post('/api/networks', {
        organizationId: demo.organizationId,
        name: 'core network',
        description: '',
      }),
      409,
      'A network with this name already exists',
    );
    expectError(
      await owner.patch(`/api/networks/${demo.branchNetworkId}`, {
        organizationId: demo.organizationId,
        name: 'CORE NETWORK',
        description: '',
      }),
      409,
    );
    // The same name in a different organization is fine.
    const acmeOwner = api.as(users.acmeOwner);
    const created = await acmeOwner.post('/api/networks', {
      organizationId: acme.organizationId,
      name: 'Core Network',
      description: '',
    });
    expect(created.status).toBe(201);
  });

  it('updates name and description but never the organization', async () => {
    const updated = await api.as(users.nsAdmin).patch<One<Network>>(`/api/networks/${demo.branchNetworkId}`, {
      organizationId: demo.organizationId,
      name: 'Branch Network v2',
      description: 'Renamed',
    });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toEqual({
      id: demo.branchNetworkId,
      organizationId: demo.organizationId,
      name: 'Branch Network v2',
      description: 'Renamed',
    });
  });

  it('returns 404 for unknown network ids without leaking other organizations', async () => {
    expectError(
      await api.as(users.nsAdmin).patch('/api/networks/net-missing', {
        organizationId: demo.organizationId,
        name: 'X',
        description: '',
      }),
      404,
      'Network not found',
    );
  });
});

describe('areas', () => {
  const api = useTestApp();
  const body = {
    organizationId: demo.organizationId,
    networkId: demo.coreNetworkId,
    name: 'Lab Rack',
    region: 'Austin, US',
  };

  it('creates an area inside a network of the caller’s organization', async () => {
    const created = await api.as(users.nsAdmin).post<One<Area>>('/api/areas', body);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ ...body, id: expect.any(String) });
  });

  it('requires the network to exist in the stated organization', async () => {
    expectError(
      await api.as(users.nsAdmin).post('/api/areas', { ...body, networkId: acme.networkId }),
      404,
      'Network not found',
    );
    expectError(
      await api.as(users.nsAdmin).post('/api/areas', { ...body, networkId: 'net-missing' }),
      404,
      'Network not found',
    );
  });

  it('enforces unique names per network, case-insensitively, while allowing reuse across networks', async () => {
    const admin = api.as(users.nsAdmin);
    expectError(
      await admin.post('/api/areas', { ...body, name: 'data center' }),
      409,
      'An area with this name already exists in the network',
    );
    expectError(
      await admin.patch(`/api/areas/${demo.northCampusAreaId}`, { ...body, name: 'DATA CENTER' }),
      409,
    );
    const other = await admin.post('/api/areas', {
      ...body,
      networkId: demo.branchNetworkId,
      name: 'Data Center',
    });
    expect(other.status).toBe(201);
  });

  it('cannot move an area to another network through an update', async () => {
    const response = await api.as(users.nsAdmin).patch(`/api/areas/${demo.dataCenterAreaId}`, {
      ...body,
      networkId: demo.branchNetworkId,
      name: 'Data Center',
    });
    expectError(response, 404, 'Area not found');
    expect(
      db.prepare('SELECT network_id AS networkId FROM areas WHERE id = ?').get(demo.dataCenterAreaId),
    ).toEqual({
      networkId: demo.coreNetworkId,
    });
  });

  it('deletes an empty area', async () => {
    const admin = api.as(users.nsAdmin);
    const created = await admin.post<One<Area>>('/api/areas', body);
    const removed = await admin.delete<One<{ ok: true }>>(`/api/areas/${created.body.data.id}`, {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ ok: true });
    expect(db.prepare('SELECT 1 FROM areas WHERE id = ?').get(created.body.data.id)).toBeUndefined();
  });

  it('refuses to delete an area that still contains devices', async () => {
    const response = await api.as(users.nsOwner).delete(`/api/areas/${demo.dataCenterAreaId}`, {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    expectError(response, 409, 'Move or remove the devices in this area before deleting it');
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM devices WHERE area_id = ?').get(demo.dataCenterAreaId),
    ).toEqual({ count: 2 });
  });

  it('refuses to delete an area through the wrong network even inside the same organization', async () => {
    const response = await api.as(users.nsOwner).delete(`/api/areas/${demo.dataCenterAreaId}`, {
      query: { organizationId: demo.organizationId, networkId: demo.branchNetworkId },
    });
    expectError(response, 404, 'Area not found');
    expect(db.prepare('SELECT 1 FROM areas WHERE id = ?').get(demo.dataCenterAreaId)).toBeDefined();
  });

  it('becomes deletable once its devices were moved away', async () => {
    const owner = api.as(users.nsOwner);
    for (const deviceId of ['FW-002', 'SW-021']) {
      const moved = await owner.patch(`/api/devices/${deviceId}`, {
        organizationId: demo.organizationId,
        networkId: demo.coreNetworkId,
        areaId: demo.northCampusAreaId,
        name: deviceId,
        type: 'Switch',
        address: deviceId === 'FW-002' ? '10.10.0.2' : '10.10.2.21',
      });
      expect(moved.status).toBe(200);
    }
    const removed = await owner.delete(`/api/areas/${demo.dataCenterAreaId}`, {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    expect(removed.status).toBe(200);
  });
});

describe('devices', () => {
  const api = useTestApp();
  const body = {
    organizationId: demo.organizationId,
    networkId: demo.coreNetworkId,
    areaId: demo.dataCenterAreaId,
    name: 'Rack Switch',
    type: 'Switch',
    address: '10.10.2.30',
  };

  it('enrolls a device as Pending with no telemetry', async () => {
    const created = await api.as(users.nsOperator).post<One<Device>>('/api/devices', body);
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({
      id: expect.any(String),
      ...body,
      status: 'Pending',
      uptime: 'Not measured',
      latency: 0,
      load: 0,
      lastSeen: null,
    });
  });

  it('requires the area to belong to the stated network', async () => {
    const operator = api.as(users.nsOperator);
    expectError(
      await operator.post('/api/devices', { ...body, areaId: demo.westWarehouseAreaId }),
      404,
      'Area not found in this network',
    );
    expectError(
      await operator.post('/api/devices', { ...body, networkId: demo.branchNetworkId }),
      404,
      'Area not found in this network',
    );
  });

  it('enforces one management address per network, case-insensitively, while allowing reuse across networks', async () => {
    const operator = api.as(users.nsOperator);
    expectError(
      await operator.post('/api/devices', { ...body, address: '10.10.0.2' }),
      409,
      'A device with this address already exists in the network',
    );
    expect((await operator.post('/api/devices', { ...body, address: 'Core-SW.Example.NET' })).status).toBe(
      201,
    );
    expectError(await operator.post('/api/devices', { ...body, address: 'core-sw.example.net' }), 409);
    const branch = await operator.post('/api/devices', {
      ...body,
      networkId: demo.branchNetworkId,
      areaId: demo.westWarehouseAreaId,
      address: '10.10.0.2',
    });
    expect(branch.status).toBe(201);
  });

  it('keeps telemetry when metadata changes but resets it when the address changes', async () => {
    const operator = api.as(users.nsOperator);
    const renamed = await operator.patch<One<Device>>(`/api/devices/${demo.coreRouterId}`, {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.northCampusAreaId,
      name: 'Core Router 01 (primary)',
      type: 'Router',
      address: '10.20.0.1',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toMatchObject({
      name: 'Core Router 01 (primary)',
      status: 'Healthy',
      uptime: '42d 06h',
      latency: 4,
      load: 32,
      lastSeen: '2026-10-12T13:40:00.000Z',
    });

    const readdressed = await operator.patch<One<Device>>(`/api/devices/${demo.coreRouterId}`, {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.northCampusAreaId,
      name: 'Core Router 01 (primary)',
      type: 'Router',
      address: '10.20.0.254',
    });
    expect(readdressed.body.data).toMatchObject({
      address: '10.20.0.254',
      status: 'Pending',
      uptime: 'Not measured',
      latency: 0,
      load: 0,
      lastSeen: null,
    });
  });

  it('moves a device between areas of the same network but never across networks', async () => {
    const operator = api.as(users.nsOperator);
    const moved = await operator.patch<One<Device>>(`/api/devices/${demo.coreRouterId}`, {
      ...body,
      areaId: demo.dataCenterAreaId,
      name: 'Core Router 01',
      type: 'Router',
      address: '10.20.0.1',
    });
    expect(moved.status).toBe(200);
    expect(moved.body.data.areaId).toBe(demo.dataCenterAreaId);

    const crossNetwork = await operator.patch(`/api/devices/${demo.coreRouterId}`, {
      ...body,
      networkId: demo.branchNetworkId,
      areaId: demo.westWarehouseAreaId,
      name: 'Core Router 01',
      type: 'Router',
      address: '10.20.0.1',
    });
    expectError(crossNetwork, 404, 'Device not found');
    expect(
      db
        .prepare('SELECT network_id AS networkId, area_id AS areaId FROM devices WHERE id = ?')
        .get(demo.coreRouterId),
    ).toEqual({
      networkId: demo.coreNetworkId,
      areaId: demo.dataCenterAreaId,
    });
  });

  it('deletes a device and returns 404 on a second attempt', async () => {
    const owner = api.as(users.nsOwner);
    const removed = await owner.delete<One<{ ok: true }>>(`/api/devices/${demo.branchGatewayId}`, {
      query: { organizationId: demo.organizationId },
    });
    expect(removed.status).toBe(200);
    expect(removed.body.data).toEqual({ ok: true });
    expectError(
      await owner.delete(`/api/devices/${demo.branchGatewayId}`, {
        query: { organizationId: demo.organizationId },
      }),
      404,
    );
    const listed = await owner.get<Many<Device>>('/api/devices', {
      query: { organizationId: demo.organizationId },
    });
    expect(listed.body.data.map((device) => device.id)).not.toContain(demo.branchGatewayId);
  });

  it('overview counts follow enrollment and deletion', async () => {
    const owner = api.as(users.nsOwner);
    const before = await owner.get<One<{ totalDevices: number; pending: number; needsAttention: number }>>(
      '/api/overview',
      {
        query: { organizationId: demo.organizationId },
      },
    );
    await owner.post('/api/devices', body);
    const after = await owner.get<One<{ totalDevices: number; pending: number; needsAttention: number }>>(
      '/api/overview',
      {
        query: { organizationId: demo.organizationId },
      },
    );
    expect(after.body.data.totalDevices).toBe(before.body.data.totalDevices + 1);
    expect(after.body.data.pending).toBe(before.body.data.pending + 1);
    expect(after.body.data.needsAttention).toBe(before.body.data.needsAttention + 1);
  });
});

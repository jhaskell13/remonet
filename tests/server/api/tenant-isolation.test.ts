import { describe, expect, it } from 'vitest';
import type { Area, Device, Network, Organization, Team } from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import { expectError, useTestApp, type ApiClient } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

type Listing<T> = { data: T[] };
const { demo, acme, solo } = fixtures;

function organizationIds(rows: { organizationId: string }[]) {
  return [...new Set(rows.map((row) => row.organizationId))].sort();
}

describe('tenant isolation: reads', () => {
  const api = useTestApp();

  it('lists only the organizations an engineer belongs to', async () => {
    const soloOrganizations = await api.as(users.soloOwner).get<Listing<Organization>>('/api/organizations');
    expect(soloOrganizations.body.data.map((org) => org.id)).toEqual([solo.organizationId]);

    const consultantOrganizations = await api
      .as(users.multiOrg)
      .get<Listing<Organization>>('/api/organizations');
    expect(consultantOrganizations.body.data.map((org) => org.id).sort()).toEqual([
      acme.organizationId,
      demo.organizationId,
    ]);
  });

  it.each(['/api/networks', '/api/areas', '/api/devices'])(
    'GET %s without filters returns rows from member organizations only',
    async (path) => {
      const solo = await api.as(users.soloOwner).get<Listing<{ organizationId: string }>>(path);
      expect(solo.status).toBe(200);
      expect(solo.body.data.length).toBeGreaterThan(0);
      expect(organizationIds(solo.body.data)).toEqual(['org-solo']);

      const consultant = await api.as(users.multiOrg).get<Listing<{ organizationId: string }>>(path);
      expect(organizationIds(consultant.body.data)).toEqual(['org-acme', 'org-demo']);
    },
  );

  it('returns the complete inventory of every organization the engineer belongs to', async () => {
    const devices = await api.as(users.multiOrg).get<Listing<Device>>('/api/devices');
    const expected = fixtures.devices
      .filter((device) => ['org-acme', 'org-demo'].includes(device.organizationId))
      .map((device) => device.id)
      .sort();
    expect(devices.body.data.map((device) => device.id).sort()).toEqual(expected);
  });

  it.each(['/api/networks', '/api/areas', '/api/devices', '/api/overview'])(
    'GET %s?organizationId=<foreign> is refused with 403',
    async (path) => {
      const response = await api
        .as(users.nsOwner)
        .get(path, { query: { organizationId: solo.organizationId } });
      expectError(response, 403, 'Organization access denied');
    },
  );

  it('returns 403 for unknown organization ids instead of revealing whether they exist', async () => {
    const response = await api
      .as(users.nsOwner)
      .get('/api/networks', { query: { organizationId: 'org-does-not-exist' } });
    expectError(response, 403, 'Organization access denied');
  });

  it('never leaks rows when foreign network or area ids are used as filters', async () => {
    const owner = api.as(users.nsOwner);
    const byNetwork = await owner.get<Listing<Device>>('/api/devices', {
      query: { networkId: solo.networkId },
    });
    expect(byNetwork.status).toBe(200);
    expect(byNetwork.body.data).toEqual([]);

    const byArea = await owner.get<Listing<Device>>('/api/devices', { query: { areaId: acme.plantAreaId } });
    expect(byArea.body.data).toEqual([]);

    const areas = await owner.get<Listing<Area>>('/api/areas', { query: { networkId: acme.networkId } });
    expect(areas.body.data).toEqual([]);

    const networks = await owner.get<Listing<Network>>('/api/networks', {
      query: { areaId: solo.labAreaId },
    });
    expect(networks.body.data).toEqual([]);

    const overview = await owner.get<{ data: { totalDevices: number; areas: number } }>('/api/overview', {
      query: { networkId: acme.networkId },
    });
    expect(overview.body.data).toMatchObject({ totalDevices: 0, areas: 0 });
  });

  it('cannot combine an allowed organization with a foreign network to widen the scope', async () => {
    const response = await api.as(users.nsOwner).get<Listing<Device>>('/api/devices', {
      query: { organizationId: demo.organizationId, networkId: acme.networkId },
    });
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('overview aggregates only the organizations in scope', async () => {
    const soloOverview = await api
      .as(users.soloOwner)
      .get<{ data: { totalDevices: number; areas: number } }>('/api/overview');
    expect(soloOverview.body.data).toMatchObject({ totalDevices: 2, areas: 1, healthy: 2, pending: 0 });

    const demoOverview = await api
      .as(users.nsViewer)
      .get<{ data: { totalDevices: number; areas: number } }>('/api/overview');
    expect(demoOverview.body.data).toMatchObject({ totalDevices: 6, areas: 4, warning: 1, offline: 1 });
  });

  it('lists teams for member organizations only and returns nothing for foreign filters', async () => {
    const own = await api.as(users.acmeOwner).get<Listing<Team>>('/api/teams');
    expect(own.body.data.map((team) => team.id)).toEqual([acme.teamId]);

    const foreign = await api.as(users.acmeOwner).get<Listing<Team>>('/api/teams', {
      query: { organizationId: demo.organizationId },
    });
    expect(foreign.status).toBe(200);
    expect(foreign.body.data).toEqual([]);
  });

  it('restricts the integration token to its configured organizations', async () => {
    const service = api.asService();
    const networks = await service.get<Listing<Network>>('/api/networks');
    expect(organizationIds(networks.body.data)).toEqual(['org-demo']);
    expectError(await service.get('/api/networks', { query: { organizationId: acme.organizationId } }), 403);
  });
});

describe('tenant isolation: writes', () => {
  const api = useTestApp();

  const foreignNetworkBody = { organizationId: solo.organizationId, name: 'Intruder', description: '' };
  const foreignAreaBody = {
    organizationId: solo.organizationId,
    networkId: solo.networkId,
    name: 'Intruder',
    region: 'X',
  };
  const foreignDeviceBody = {
    organizationId: solo.organizationId,
    networkId: solo.networkId,
    areaId: solo.labAreaId,
    name: 'Intruder',
    type: 'Router',
    address: '192.168.1.250',
  };

  async function snapshot() {
    const table = (name: string, order: string) =>
      db.prepare(`SELECT * FROM ${name} ORDER BY ${order}`).all();
    return {
      organizations: table('organizations', 'id'),
      teams: table('teams', 'id'),
      memberships: table('team_memberships', 'user_id, team_id'),
      invitations: table('invitations', 'id'),
      networks: table('networks', 'id'),
      areas: table('areas', 'id'),
      devices: table('devices', 'id'),
      audit: table('audit_log', 'id'),
    };
  }

  const foreignRequests: [string, (client: ApiClient) => Promise<{ status: number; body: unknown }>][] = [
    ['POST /api/networks', (c) => c.post('/api/networks', foreignNetworkBody)],
    ['PATCH /api/networks/:id', (c) => c.patch(`/api/networks/${solo.networkId}`, foreignNetworkBody)],
    ['POST /api/areas', (c) => c.post('/api/areas', foreignAreaBody)],
    ['PATCH /api/areas/:id', (c) => c.patch(`/api/areas/${solo.labAreaId}`, foreignAreaBody)],
    [
      'DELETE /api/areas/:id',
      (c) =>
        c.delete(`/api/areas/${solo.labAreaId}`, {
          query: { organizationId: solo.organizationId, networkId: solo.networkId },
        }),
    ],
    ['POST /api/devices', (c) => c.post('/api/devices', foreignDeviceBody)],
    ['PATCH /api/devices/:id', (c) => c.patch(`/api/devices/${solo.routerId}`, foreignDeviceBody)],
    [
      'DELETE /api/devices/:id',
      (c) => c.delete(`/api/devices/${solo.routerId}`, { query: { organizationId: solo.organizationId } }),
    ],
    [
      'POST /api/invitations',
      (c) =>
        c.post('/api/invitations', {
          email: 'mole@northstar.test',
          organizationId: solo.organizationId,
          teamId: solo.teamId,
          role: 'viewer',
        }),
    ],
    [
      'GET /api/invitations',
      (c) => c.get('/api/invitations', { query: { organizationId: solo.organizationId } }),
    ],
    [
      'DELETE /api/invitations/:id',
      (c) => c.delete('/api/invitations/any', { query: { organizationId: solo.organizationId } }),
    ],
    [
      'PATCH /api/organizations/:id',
      (c) => c.patch(`/api/organizations/${solo.organizationId}`, { name: 'Taken over' }),
    ],
    ['GET /api/organizations/:id/members', (c) => c.get(`/api/organizations/${solo.organizationId}/members`)],
    [
      'POST /api/teams',
      (c) => c.post('/api/teams', { organizationId: solo.organizationId, name: 'Intruders' }),
    ],
    [
      'PATCH /api/teams/:id',
      (c) => c.patch(`/api/teams/${solo.teamId}`, { organizationId: solo.organizationId, name: 'Renamed' }),
    ],
    [
      'DELETE /api/teams/:id',
      (c) => c.delete(`/api/teams/${solo.teamId}`, { query: { organizationId: solo.organizationId } }),
    ],
    [
      'POST /api/teams/:id/members',
      (c) =>
        c.post(`/api/teams/${solo.teamId}/members`, {
          organizationId: solo.organizationId,
          userId: users.nsOwner.id,
          role: 'owner',
        }),
    ],
    [
      'PATCH /api/teams/:id/members/:userId',
      (c) =>
        c.patch(`/api/teams/${solo.teamId}/members/${users.soloOwner.id}`, {
          organizationId: solo.organizationId,
          role: 'viewer',
        }),
    ],
    [
      'DELETE /api/teams/:id/members/:userId',
      (c) =>
        c.delete(`/api/teams/${solo.teamId}/members/${users.soloOwner.id}`, {
          query: { organizationId: solo.organizationId },
        }),
    ],
  ];

  it.each(foreignRequests)(
    '%s targeting a foreign organization is refused and changes nothing',
    async (_name, send) => {
      const before = await snapshot();
      const response = await send(api.as(users.nsOwner));
      expect(response.status).toBe(403);
      expect(await snapshot()).toEqual(before);
    },
  );

  it.each(foreignRequests)('%s with the integration token is refused', async (_name, send) => {
    const before = await snapshot();
    const response = await send(api.asService());
    expect([401, 403]).toContain(response.status);
    expect(await snapshot()).toEqual(before);
  });

  it('cannot update or delete a foreign network by claiming it belongs to an allowed organization', async () => {
    const owner = api.as(users.nsOwner);
    const update = await owner.patch(`/api/networks/${solo.networkId}`, {
      organizationId: demo.organizationId,
      name: 'Hijacked',
      description: '',
    });
    expectError(update, 404, 'Network not found');
    expect(db.prepare('SELECT name FROM networks WHERE id = ?').get(solo.networkId)).toEqual({
      name: 'Home Lab',
    });
  });

  it('cannot update or delete a foreign area by claiming it belongs to an allowed network', async () => {
    const owner = api.as(users.nsOwner);
    const body = {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      name: 'Hijacked',
      region: 'X',
    };
    expectError(await owner.patch(`/api/areas/${solo.labAreaId}`, body), 404, 'Area not found');
    expectError(
      await owner.delete(`/api/areas/${acme.officeAreaId}`, {
        query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
      }),
      404,
      'Area not found',
    );
    expect(db.prepare('SELECT COUNT(*) AS count FROM areas').get()).toEqual({ count: fixtures.areas.length });
  });

  it('cannot enroll into or move devices to a foreign area', async () => {
    const owner = api.as(users.nsOwner);
    const enroll = await owner.post('/api/devices', {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: solo.labAreaId,
      name: 'Planted',
      type: 'Switch',
      address: '10.99.0.1',
    });
    expectError(enroll, 404, 'Area not found in this network');

    const move = await owner.patch(`/api/devices/${demo.coreRouterId}`, {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: acme.plantAreaId,
      name: 'Core Router 01',
      type: 'Router',
      address: '10.20.0.1',
    });
    expectError(move, 404, 'Area not found in this network');
    expect(db.prepare('SELECT area_id AS areaId FROM devices WHERE id = ?').get(demo.coreRouterId)).toEqual({
      areaId: demo.northCampusAreaId,
    });
  });

  it('cannot update or delete a foreign device by claiming it belongs to an allowed organization', async () => {
    const owner = api.as(users.nsOwner);
    const update = await owner.patch(`/api/devices/${solo.routerId}`, {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.northCampusAreaId,
      name: 'Hijacked',
      type: 'Router',
      address: '10.20.0.99',
    });
    expectError(update, 404, 'Device not found');

    const remove = await owner.delete(`/api/devices/${acme.routerId}`, {
      query: { organizationId: demo.organizationId },
    });
    expectError(remove, 404, 'Device not found');
    expect(db.prepare('SELECT COUNT(*) AS count FROM devices').get()).toEqual({
      count: fixtures.devices.length,
    });
  });

  it('cannot invite into a foreign team through an allowed organization', async () => {
    const response = await api.as(users.nsOwner).post('/api/invitations', {
      email: 'mole@northstar.test',
      organizationId: demo.organizationId,
      teamId: acme.teamId,
      role: 'viewer',
    });
    expectError(response, 400, 'Team does not belong to this organization');
    expect(db.prepare('SELECT COUNT(*) AS count FROM invitations').get()).toEqual({ count: 0 });
  });

  it('a multi-organization engineer is bound by the role held in each organization separately', async () => {
    const consultant = api.as(users.multiOrg);
    // Admin in org-demo: may manage networks there.
    const created = await consultant.post<{ data: Network }>('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Consultant Net',
      description: '',
    });
    expect(created.status).toBe(201);
    // Operator in org-acme: may read, may not manage networks, may not delete devices.
    expect(
      (await consultant.get('/api/networks', { query: { organizationId: acme.organizationId } })).status,
    ).toBe(200);
    expectError(
      await consultant.post('/api/networks', {
        organizationId: acme.organizationId,
        name: 'Nope',
        description: '',
      }),
      403,
      'Organization admin access required',
    );
    expectError(
      await consultant.delete(`/api/devices/${acme.routerId}`, {
        query: { organizationId: acme.organizationId },
      }),
      403,
      'Organization admin access required',
    );
    // No membership in org-solo at all.
    expectError(
      await consultant.get('/api/devices', { query: { organizationId: solo.organizationId } }),
      403,
    );
  });
});

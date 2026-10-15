import { describe, expect, it } from 'vitest';
import { db } from '../../../server/persistence/database.ts';
import { expectError, useTestApp, type ApiResponse } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo } = fixtures;

describe('request validation', () => {
  const api = useTestApp();

  const validNetwork = { organizationId: demo.organizationId, name: 'Valid', description: 'ok' };
  const validArea = {
    organizationId: demo.organizationId,
    networkId: demo.coreNetworkId,
    name: 'Valid',
    region: 'Lab',
  };
  const validDevice = {
    organizationId: demo.organizationId,
    networkId: demo.coreNetworkId,
    areaId: demo.dataCenterAreaId,
    name: 'Valid',
    type: 'Router',
    address: '10.10.5.5',
  };

  describe('schema validation returns a generic 400', () => {
    const cases: [string, () => Promise<ApiResponse>][] = [
      ['login without password', () => api.anonymous.post('/api/auth/login', { email: 'a@b.co' })],
      [
        'login with malformed email',
        () => api.anonymous.post('/api/auth/login', { email: 'not-an-email', password: 'x' }),
      ],
      [
        'login with empty password',
        () => api.anonymous.post('/api/auth/login', { email: 'a@b.co', password: '' }),
      ],
      [
        'network without name',
        () =>
          api
            .as(users.nsOwner)
            .post('/api/networks', { organizationId: demo.organizationId, description: '' }),
      ],
      [
        'network with object name',
        () => api.as(users.nsOwner).post('/api/networks', { ...validNetwork, name: { $ne: '' } }),
      ],
      [
        'network with oversized name',
        () => api.as(users.nsOwner).post('/api/networks', { ...validNetwork, name: 'n'.repeat(121) }),
      ],
      [
        'network with oversized description',
        () => api.as(users.nsOwner).post('/api/networks', { ...validNetwork, description: 'd'.repeat(501) }),
      ],
      [
        'area without region',
        () => api.as(users.nsOwner).post('/api/areas', { ...validArea, region: undefined }),
      ],
      [
        'area with array region',
        () => api.as(users.nsOwner).post('/api/areas', { ...validArea, region: ['a', 'b'] }),
      ],
      [
        'device with unsupported type',
        () => api.as(users.nsOwner).post('/api/devices', { ...validDevice, type: 'Toaster' }),
      ],
      [
        'device without area',
        () => api.as(users.nsOwner).post('/api/devices', { ...validDevice, areaId: undefined }),
      ],
      [
        'device with oversized address',
        () => api.as(users.nsOwner).post('/api/devices', { ...validDevice, address: 'a'.repeat(254) }),
      ],
      [
        'device delete without organizationId',
        () => api.as(users.nsOwner).delete(`/api/devices/${demo.coreRouterId}`),
      ],
      [
        'area delete without networkId',
        () =>
          api.as(users.nsOwner).delete(`/api/areas/${demo.dataCenterAreaId}`, {
            query: { organizationId: demo.organizationId },
          }),
      ],
      [
        'invitation with unsupported role',
        () =>
          api.as(users.nsOwner).post('/api/invitations', {
            email: 'a@b.co',
            organizationId: demo.organizationId,
            teamId: demo.teamId,
            role: 'root',
          }),
      ],
      [
        'invitation with malformed email',
        () =>
          api.as(users.nsOwner).post('/api/invitations', {
            email: 'nope',
            organizationId: demo.organizationId,
            teamId: demo.teamId,
            role: 'viewer',
          }),
      ],
      ['invitation inspect without token', () => api.anonymous.post('/api/invitations/inspect', {})],
      [
        'invitation accept with oversized password',
        () =>
          api.anonymous.post('/api/invitations/accept', {
            token: 'x',
            displayName: 'A',
            password: 'p'.repeat(257),
          }),
      ],
      [
        'list filter with empty organizationId',
        () => api.as(users.nsOwner).get('/api/devices', { query: { organizationId: '' } }),
      ],
      [
        'audit with non-integer limit',
        () => api.as(users.nsOwner).get('/api/audit', { query: { limit: 'many' } }),
      ],
      [
        'audit with limit above the cap',
        () => api.as(users.nsOwner).get('/api/audit', { query: { limit: 501 } }),
      ],
      [
        'audit with unknown entity type',
        () => api.as(users.nsOwner).get('/api/audit', { query: { entityType: 'user' } }),
      ],
      [
        'device history with a non-integer limit',
        () =>
          api.as(users.nsOwner).get(`/api/devices/${demo.coreRouterId}/observations`, {
            query: { organizationId: demo.organizationId, limit: 'many' },
          }),
      ],
      ['organization without a name', () => api.as(users.nsOwner).post('/api/organizations', {})],
      [
        'organization with an empty name',
        () => api.as(users.nsOwner).post('/api/organizations', { name: '' }),
      ],
      [
        'organization rename with an oversized name',
        () =>
          api.as(users.nsOwner).patch(`/api/organizations/${demo.organizationId}`, { name: 'n'.repeat(161) }),
      ],
      ['team without an organization', () => api.as(users.nsOwner).post('/api/teams', { name: 'Team' })],
      [
        'team delete without organizationId',
        () => api.as(users.nsOwner).delete(`/api/teams/${demo.secondTeamId}`),
      ],
      [
        'member add without a role',
        () =>
          api.as(users.nsOwner).post(`/api/teams/${demo.teamId}/members`, {
            organizationId: demo.organizationId,
            userId: users.nsViewer.id,
          }),
      ],
      [
        'member add with an unknown role',
        () =>
          api.as(users.nsOwner).post(`/api/teams/${demo.teamId}/members`, {
            organizationId: demo.organizationId,
            userId: users.nsViewer.id,
            role: 'superuser',
          }),
      ],
      [
        'role change without an organization',
        () =>
          api
            .as(users.nsOwner)
            .patch(`/api/teams/${demo.teamId}/members/${users.nsViewer.id}`, { role: 'viewer' }),
      ],
      [
        'member removal without organizationId',
        () => api.as(users.nsOwner).delete(`/api/teams/${demo.teamId}/members/${users.nsViewer.id}`),
      ],
      ['invitation list without organizationId', () => api.as(users.nsOwner).get('/api/invitations')],
      [
        'invitation revoke without organizationId',
        () => api.as(users.nsOwner).delete('/api/invitations/inv-1'),
      ],
    ];

    it.each(cases)('%s', async (_name, send) => {
      const response = await send();
      expectError(response, 400, 'Invalid request');
      expect(response.body).toHaveProperty('requestId');
    });
  });

  describe('unknown and server-owned fields', () => {
    // Fastify's default AJV configuration strips properties that a schema does not declare. The
    // important guarantee is that clients cannot smuggle server-owned values through those fields.
    it('ignores unknown properties instead of persisting them', async () => {
      const created = await api.as(users.nsOwner).post<{ data: Record<string, unknown> }>('/api/networks', {
        ...validNetwork,
        id: 'custom-id',
        organizationName: 'Spoofed',
      });
      expect(created.status).toBe(201);
      expect(created.body.data.id).not.toBe('custom-id');
      expect(created.body.data).not.toHaveProperty('organizationName');
    });

    it('a client cannot set monitoring state on enrollment', async () => {
      const created = await api.as(users.nsOperator).post<{ data: Record<string, unknown> }>('/api/devices', {
        ...validDevice,
        status: 'Healthy',
        lastSeen: '2030-01-01T00:00:00.000Z',
        uptime: '999d',
      });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({
        status: 'Pending',
        lastSeen: null,
        uptime: 'Not measured',
        latency: 0,
        load: 0,
      });
    });

    it('rejects malformed JSON bodies without a stack trace', async () => {
      const response = await api.anonymous.post('/api/auth/login', '{"email": "a@b.co", "password": ');
      expect(response.status).toBe(400);
      expect(response.body).toEqual({ error: expect.any(String), requestId: expect.any(String) });
      expect(JSON.stringify(response.body)).not.toMatch(/SyntaxError|at /);
    });

    it('ignores unknown list filters without changing the scope', async () => {
      const response = await api.as(users.nsOwner).get('/api/devices', { query: { status: 'Healthy' } });
      // Query strings are also subject to removeAdditional: the unknown filter is ignored rather
      // than widening or narrowing the scope.
      expect(response.status).toBe(200);
      expect((response.body as { data: unknown[] }).data.length).toBe(6);
    });
  });

  describe('domain validation after schema validation', () => {
    it('rejects whitespace-only names and regions', async () => {
      const owner = api.as(users.nsOwner);
      expectError(
        await owner.post('/api/networks', { ...validNetwork, name: '   ' }),
        400,
        'Network name is required',
      );
      expectError(
        await owner.post('/api/areas', { ...validArea, name: '\t ' }),
        400,
        'Area name is required',
      );
      expectError(
        await owner.post('/api/areas', { ...validArea, region: '  ' }),
        400,
        'Area region is required',
      );
      expectError(
        await owner.post('/api/devices', { ...validDevice, name: ' ' }),
        400,
        'Device name is required',
      );
    });

    it('trims surrounding whitespace before saving', async () => {
      const created = await api
        .as(users.nsOwner)
        .post<{ data: { name: string; description: string } }>('/api/networks', {
          ...validNetwork,
          name: '  Padded  ',
          description: '  trimmed too  ',
        });
      expect(created.status).toBe(201);
      expect(created.body.data).toMatchObject({ name: 'Padded', description: 'trimmed too' });
    });

    it.each([
      ['10.10.5.5', true],
      ['2001:db8::1', true],
      ['core-sw01.example.net', true],
      ['core-sw01.example.net.', true],
      ['localhost', true],
      ['999.1.1.1', false],
      ['10.10.5', false],
      ['-bad.example.net', false],
      ['bad_host.example.net', false],
      ['has space.example.net', false],
      ['http://10.10.5.5', false],
      ['10.10.5.5/24', false],
      [`${'a'.repeat(64)}.example.net`, false],
    ])('device address %s is %s', async (address, valid) => {
      const response = await api.as(users.nsOwner).post('/api/devices', { ...validDevice, address });
      if (valid) expect(response.status, JSON.stringify(response.body)).toBe(201);
      else expectError(response, 400, 'Enter a valid IP address or hostname');
    });

    it('authorization is checked before domain validation so errors never reveal scope details', async () => {
      const viewer = api.as(users.nsViewer);
      expectError(await viewer.post('/api/networks', { ...validNetwork, name: ' ' }), 403);
      expectError(await viewer.post('/api/devices', { ...validDevice, address: 'not valid' }), 403);
      const outsider = api.as(users.soloOwner);
      expectError(await outsider.post('/api/devices', { ...validDevice, address: 'not valid' }), 403);
    });

    it('validation failures never persist partial data', async () => {
      const countRows = () => ({
        networks: (db.prepare('SELECT COUNT(*) AS count FROM networks').get() as { count: number }).count,
        areas: (db.prepare('SELECT COUNT(*) AS count FROM areas').get() as { count: number }).count,
        devices: (db.prepare('SELECT COUNT(*) AS count FROM devices').get() as { count: number }).count,
        audit: (db.prepare('SELECT COUNT(*) AS count FROM audit_log').get() as { count: number }).count,
      });
      const before = countRows();
      const owner = api.as(users.nsOwner);
      await owner.post('/api/networks', { ...validNetwork, name: ' ' });
      await owner.post('/api/areas', { ...validArea, networkId: 'net-missing' });
      await owner.post('/api/devices', { ...validDevice, address: 'bad address' });
      await owner.post('/api/devices', { ...validDevice, areaId: demo.westWarehouseAreaId }); // area in another network
      expect(countRows()).toEqual(before);
    });
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../../../src/api/client.ts';

type Call = { url: string; init: RequestInit };
const calls: Call[] = [];

function respond(status: number, body: unknown, contentType = 'application/json') {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': contentType },
      });
    }),
  );
}
const lastCall = () => calls[calls.length - 1]!;
const headersOf = (call: Call) => call.init.headers as Record<string, string>;

afterEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('api client', () => {
  it('sends same-origin credentials and JSON headers only when there is a body', async () => {
    respond(200, { data: [] });
    await api.networks();
    expect(lastCall().url).toBe('/api/networks');
    expect(lastCall().init.credentials).toBe('same-origin');
    expect(headersOf(lastCall())).toEqual({ Accept: 'application/json' });

    await api.login('owner@northstar.test', 'secret');
    expect(lastCall().init.method).toBe('POST');
    expect(headersOf(lastCall())).toEqual({ Accept: 'application/json', 'Content-Type': 'application/json' });
    expect(JSON.parse(lastCall().init.body as string)).toEqual({
      email: 'owner@northstar.test',
      password: 'secret',
    });
  });

  it('returns the parsed body on success', async () => {
    respond(200, { user: { id: 'u' }, organizations: [] });
    expect(await api.currentSession()).toEqual({ user: { id: 'u' }, organizations: [] });
  });

  it('throws an ApiError carrying the server message and status', async () => {
    respond(403, { error: 'Organization access denied', requestId: 'req-1' });
    const failure = await api.networks({ organizationId: 'org-x' }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({ name: 'ApiError', message: 'Organization access denied', status: 403 });
  });

  it('falls back to a generic message when the error body is not JSON', async () => {
    respond(502, '<html>Bad gateway</html>', 'text/html');
    const failure = (await api.overview().catch((error: unknown) => error)) as ApiError;
    expect(failure.message).toBe('The request could not be completed.');
    expect(failure.status).toBe(502);
  });

  it('builds query strings from present filters only', async () => {
    respond(200, { data: [] });
    await api.devices({ organizationId: 'org-demo' });
    expect(lastCall().url).toBe('/api/devices?organizationId=org-demo');
    await api.areas({});
    expect(lastCall().url).toBe('/api/areas');
    await api.audit({ organizationId: 'org demo', limit: 5 });
    expect(lastCall().url).toBe('/api/audit?organizationId=org+demo&limit=5');
  });

  it('encodes identifiers in paths and pairs DELETE requests with their scope', async () => {
    respond(200, { data: { ok: true } });
    await api.deleteArea('area/one', { organizationId: 'org-demo', networkId: 'net-core' });
    expect(lastCall()).toMatchObject({
      url: '/api/areas/area%2Fone?organizationId=org-demo&networkId=net-core',
      init: { method: 'DELETE' },
    });
    await api.deleteDevice('RTR 001', 'org-demo');
    expect(lastCall().url).toBe('/api/devices/RTR%20001?organizationId=org-demo');
    await api.removeMember('team-ops', 'user#1', 'org-demo');
    expect(lastCall().url).toBe('/api/teams/team-ops/members/user%231?organizationId=org-demo');
    await api.revokeInvitation('inv-1', 'org-demo');
    expect(lastCall().url).toBe('/api/invitations/inv-1?organizationId=org-demo');
    await api.deleteTeam('team-ops', 'org-demo');
    expect(lastCall().url).toBe('/api/teams/team-ops?organizationId=org-demo');
  });

  it('uses PATCH for updates and POST for creation', async () => {
    respond(200, { data: {} });
    await api.updateNetwork('net-core', { organizationId: 'org-demo', name: 'Core', description: '' });
    expect(lastCall()).toMatchObject({ url: '/api/networks/net-core', init: { method: 'PATCH' } });
    await api.changeMemberRole('team-ops', 'user-1', { organizationId: 'org-demo', role: 'admin' });
    expect(lastCall()).toMatchObject({
      url: '/api/teams/team-ops/members/user-1',
      init: { method: 'PATCH' },
    });
    await api.updateOrganization('org-demo', { name: 'Renamed' });
    expect(lastCall()).toMatchObject({ url: '/api/organizations/org-demo', init: { method: 'PATCH' } });
    await api.createOrganization({ name: 'New' });
    expect(lastCall()).toMatchObject({ url: '/api/organizations', init: { method: 'POST' } });
    await api.addMember('team-ops', { organizationId: 'org-demo', userId: 'user-1', role: 'viewer' });
    expect(lastCall()).toMatchObject({ url: '/api/teams/team-ops/members', init: { method: 'POST' } });
    await api.acceptInvitation({ token: 't' });
    expect(lastCall()).toMatchObject({ url: '/api/invitations/accept', init: { method: 'POST' } });
    await api.logout();
    expect(lastCall()).toMatchObject({ url: '/api/auth/logout', init: { method: 'POST' } });
    expect(headersOf(lastCall())).toEqual({ Accept: 'application/json' });
  });

  it('maps every endpoint to the documented route and method', async () => {
    respond(200, { data: {} });
    const organizationId = 'org-demo';
    const contract: [() => Promise<unknown>, string, string][] = [
      [() => api.currentSession(), 'GET', '/api/auth/me'],
      [() => api.login('a@b.co', 'p'), 'POST', '/api/auth/login'],
      [() => api.logout(), 'POST', '/api/auth/logout'],
      [() => api.inspectInvitation('t'), 'POST', '/api/invitations/inspect'],
      [() => api.acceptInvitation({ token: 't' }), 'POST', '/api/invitations/accept'],
      [
        () => api.createInvitation({ organizationId, teamId: 't', email: 'a@b.co', role: 'viewer' }),
        'POST',
        '/api/invitations',
      ],
      [() => api.pendingInvitations(organizationId), 'GET', '/api/invitations?organizationId=org-demo'],
      [
        () => api.revokeInvitation('inv', organizationId),
        'DELETE',
        '/api/invitations/inv?organizationId=org-demo',
      ],
      [() => api.teams(organizationId), 'GET', '/api/teams?organizationId=org-demo'],
      [() => api.createTeam({ organizationId, name: 'T' }), 'POST', '/api/teams'],
      [() => api.updateTeam('team', { organizationId, name: 'T' }), 'PATCH', '/api/teams/team'],
      [() => api.deleteTeam('team', organizationId), 'DELETE', '/api/teams/team?organizationId=org-demo'],
      [() => api.organizations(), 'GET', '/api/organizations'],
      [() => api.createOrganization({ name: 'O' }), 'POST', '/api/organizations'],
      [() => api.updateOrganization(organizationId, { name: 'O' }), 'PATCH', '/api/organizations/org-demo'],
      [() => api.members(organizationId), 'GET', '/api/organizations/org-demo/members'],
      [
        () => api.addMember('team', { organizationId, userId: 'u', role: 'viewer' }),
        'POST',
        '/api/teams/team/members',
      ],
      [
        () => api.changeMemberRole('team', 'u', { organizationId, role: 'viewer' }),
        'PATCH',
        '/api/teams/team/members/u',
      ],
      [
        () => api.removeMember('team', 'u', organizationId),
        'DELETE',
        '/api/teams/team/members/u?organizationId=org-demo',
      ],
      [() => api.audit(), 'GET', '/api/audit'],
      [
        () => api.deviceObservations('dev', { organizationId, limit: 5 }),
        'GET',
        '/api/devices/dev/observations?organizationId=org-demo&limit=5',
      ],
      [() => api.networks({ organizationId }), 'GET', '/api/networks?organizationId=org-demo'],
      [() => api.createNetwork({ organizationId, name: 'N', description: '' }), 'POST', '/api/networks'],
      [
        () => api.updateNetwork('net', { organizationId, name: 'N', description: '' }),
        'PATCH',
        '/api/networks/net',
      ],
      [
        () => api.createArea({ organizationId, networkId: 'net', name: 'A', region: 'R' }),
        'POST',
        '/api/areas',
      ],
      [
        () => api.updateArea('area', { organizationId, networkId: 'net', name: 'A', region: 'R' }),
        'PATCH',
        '/api/areas/area',
      ],
      [
        () => api.deleteArea('area', { organizationId, networkId: 'net' }),
        'DELETE',
        '/api/areas/area?organizationId=org-demo&networkId=net',
      ],
      [
        () =>
          api.enrollDevice({
            organizationId,
            networkId: 'net',
            areaId: 'area',
            name: 'D',
            type: 'Router',
            address: '10.0.0.1',
          }),
        'POST',
        '/api/devices',
      ],
      [
        () =>
          api.updateDevice('dev', {
            organizationId,
            networkId: 'net',
            areaId: 'area',
            name: 'D',
            type: 'Router',
            address: '10.0.0.1',
          }),
        'PATCH',
        '/api/devices/dev',
      ],
      [() => api.deleteDevice('dev', organizationId), 'DELETE', '/api/devices/dev?organizationId=org-demo'],
      [() => api.requestDeviceCheck('dev', organizationId), 'POST', '/api/devices/dev/check'],
      [
        () => api.monitoringStatus({ organizationId }),
        'GET',
        '/api/monitoring/status?organizationId=org-demo',
      ],
      [() => api.areas({ networkId: 'net' }), 'GET', '/api/areas?networkId=net'],
      [() => api.devices(), 'GET', '/api/devices'],
      [
        () => api.overview({ organizationId, networkId: 'net' }),
        'GET',
        '/api/overview?organizationId=org-demo&networkId=net',
      ],
    ];
    for (const [send, method, url] of contract) {
      await send();
      expect(lastCall().url, url).toBe(url);
      expect(lastCall().init.method ?? 'GET', url).toBe(method);
    }
    expect(Object.keys(api)).toHaveLength(contract.length);
  });
});

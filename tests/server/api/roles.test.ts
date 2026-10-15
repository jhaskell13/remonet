import { describe, expect, it } from 'vitest';
import type { Network, OrganizationMembership } from '../../../shared/network.ts';
import { hasPermission } from '../../../shared/permissions.ts';
import { db } from '../../../server/persistence/database.ts';
import { getOrganizationRole } from '../../../server/persistence/repositories/membership-repository.ts';
import { listUserOrganizations } from '../../../server/persistence/repositories/user-repository.ts';
import { expectError, useTestApp, type ApiClient } from '../helpers/app.ts';
import { fixtures, users, type TestUser } from '../helpers/fixtures.ts';

const { demo } = fixtures;

type Operation = {
  name: string;
  send: (client: ApiClient) => Promise<{ status: number; body: unknown }>;
  /** Roles allowed to perform the operation inside their own organization. */
  allowed: ('owner' | 'admin' | 'operator' | 'viewer')[];
};

const networkBody = { organizationId: demo.organizationId, name: 'Role Matrix Net', description: 'rbac' };
const areaBody = {
  organizationId: demo.organizationId,
  networkId: demo.coreNetworkId,
  name: 'Role Matrix Area',
  region: 'Lab',
};
const deviceBody = {
  organizationId: demo.organizationId,
  networkId: demo.coreNetworkId,
  areaId: demo.dataCenterAreaId,
  name: 'Role Matrix Device',
  type: 'Switch',
  address: '10.10.9.9',
};

const operations: Operation[] = [
  {
    name: 'list networks',
    send: (c) => c.get('/api/networks'),
    allowed: ['owner', 'admin', 'operator', 'viewer'],
  },
  { name: 'list areas', send: (c) => c.get('/api/areas'), allowed: ['owner', 'admin', 'operator', 'viewer'] },
  {
    name: 'list devices',
    send: (c) => c.get('/api/devices'),
    allowed: ['owner', 'admin', 'operator', 'viewer'],
  },
  {
    name: 'read overview',
    send: (c) => c.get('/api/overview'),
    allowed: ['owner', 'admin', 'operator', 'viewer'],
  },
  {
    name: 'read device history',
    send: (c) =>
      c.get(`/api/devices/${demo.coreRouterId}/observations`, {
        query: { organizationId: demo.organizationId },
      }),
    allowed: ['owner', 'admin', 'operator', 'viewer'],
  },
  { name: 'list teams', send: (c) => c.get('/api/teams'), allowed: ['owner', 'admin', 'operator', 'viewer'] },
  { name: 'create network', send: (c) => c.post('/api/networks', networkBody), allowed: ['owner', 'admin'] },
  {
    name: 'update network',
    send: (c) => c.patch(`/api/networks/${demo.coreNetworkId}`, { ...networkBody, name: 'Core Network' }),
    allowed: ['owner', 'admin'],
  },
  { name: 'create area', send: (c) => c.post('/api/areas', areaBody), allowed: ['owner', 'admin'] },
  {
    name: 'update area',
    send: (c) => c.patch(`/api/areas/${demo.dataCenterAreaId}`, { ...areaBody, name: 'Data Center' }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'delete empty area',
    send: async (c) => {
      db.prepare(
        "INSERT INTO areas (id, organization_id, network_id, name, region) VALUES ('area-rbac', ?, ?, 'Empty', 'Lab')",
      ).run(demo.organizationId, demo.coreNetworkId);
      return c.delete('/api/areas/area-rbac', {
        query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
      });
    },
    allowed: ['owner', 'admin'],
  },
  {
    name: 'enroll device',
    send: (c) => c.post('/api/devices', deviceBody),
    allowed: ['owner', 'admin', 'operator'],
  },
  {
    name: 'update device',
    send: (c) =>
      c.patch(`/api/devices/${demo.edgeFirewallId}`, {
        ...deviceBody,
        name: 'Edge Firewall',
        type: 'Firewall',
        address: '10.10.0.2',
      }),
    allowed: ['owner', 'admin', 'operator'],
  },
  {
    name: 'delete device',
    send: (c) =>
      c.delete(`/api/devices/${demo.edgeFirewallId}`, { query: { organizationId: demo.organizationId } }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'invite viewer',
    send: (c) =>
      c.post('/api/invitations', {
        email: 'new@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'viewer',
      }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'invite operator',
    send: (c) =>
      c.post('/api/invitations', {
        email: 'new@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'operator',
      }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'invite admin',
    send: (c) =>
      c.post('/api/invitations', {
        email: 'new@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'admin',
      }),
    allowed: ['owner'],
  },
  {
    name: 'read audit trail',
    send: (c) => c.get('/api/audit', { query: { organizationId: demo.organizationId } }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'list members',
    send: (c) => c.get(`/api/organizations/${demo.organizationId}/members`),
    allowed: ['owner', 'admin', 'operator', 'viewer'],
  },
  {
    name: 'rename organization',
    send: (c) => c.patch(`/api/organizations/${demo.organizationId}`, { name: 'Northstar Engineering' }),
    allowed: ['owner'],
  },
  {
    name: 'create team',
    send: (c) => c.post('/api/teams', { organizationId: demo.organizationId, name: 'RBAC Team' }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'rename team',
    send: (c) =>
      c.patch(`/api/teams/${demo.secondTeamId}`, {
        organizationId: demo.organizationId,
        name: 'Field Engineering',
      }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'delete empty team',
    send: async (c) => {
      db.prepare("INSERT INTO teams (id, organization_id, name) VALUES ('team-rbac', ?, 'Empty')").run(
        demo.organizationId,
      );
      return c.delete('/api/teams/team-rbac', { query: { organizationId: demo.organizationId } });
    },
    allowed: ['owner'],
  },
  {
    name: 'add viewer to a team',
    send: (c) =>
      c.post(`/api/teams/${demo.secondTeamId}/members`, {
        organizationId: demo.organizationId,
        userId: users.nsViewer.id,
        role: 'viewer',
      }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'change a viewer into an operator',
    send: (c) =>
      c.patch(`/api/teams/${demo.teamId}/members/${users.nsViewer.id}`, {
        organizationId: demo.organizationId,
        role: 'operator',
      }),
    allowed: ['owner', 'admin'],
  },
  {
    name: 'grant admin',
    send: (c) =>
      c.patch(`/api/teams/${demo.teamId}/members/${users.nsViewer.id}`, {
        organizationId: demo.organizationId,
        role: 'admin',
      }),
    allowed: ['owner'],
  },
  {
    name: 'remove another member',
    // Leaving a team is always allowed, so the target is never the acting principal.
    send: async (c) => {
      const me = await c.get<{ user: { id: string } }>('/api/auth/me');
      const target = me.body.user.id === users.nsViewer.id ? users.nsOperator : users.nsViewer;
      return c.delete(`/api/teams/${demo.teamId}/members/${target.id}`, {
        query: { organizationId: demo.organizationId },
      });
    },
    allowed: ['owner', 'admin'],
  },
  {
    name: 'list pending invitations',
    send: (c) => c.get('/api/invitations', { query: { organizationId: demo.organizationId } }),
    allowed: ['owner', 'admin'],
  },
];

const principals: { role: Operation['allowed'][number]; user: TestUser }[] = [
  { role: 'owner', user: users.nsOwner },
  { role: 'admin', user: users.nsAdmin },
  { role: 'operator', user: users.nsOperator },
  { role: 'viewer', user: users.nsViewer },
];

describe('role permissions within one organization', () => {
  const api = useTestApp();

  describe.each(principals)('$role', ({ role, user }) => {
    it.each(operations)('$name', async (operation) => {
      const response = await operation.send(api.as(user));
      if (operation.allowed.includes(role)) {
        expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
      } else {
        expect(response.status, JSON.stringify(response.body)).toBe(403);
      }
    });
  });

  it('explains each refusal with the required level', async () => {
    const viewer = api.as(users.nsViewer);
    expectError(await viewer.post('/api/networks', networkBody), 403, 'Organization admin access required');
    expectError(await viewer.post('/api/devices', deviceBody), 403, 'Organization operator access required');
    expectError(
      await api
        .as(users.nsOperator)
        .delete(`/api/devices/${demo.coreRouterId}`, { query: { organizationId: demo.organizationId } }),
      403,
      'Organization admin access required',
    );
    expectError(
      await api.as(users.nsAdmin).post('/api/invitations', {
        email: 'peer@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        role: 'admin',
      }),
      403,
      'Only an organization owner can invite another admin',
    );
  });

  it('nobody can invite an owner: the role is not accepted by the API', async () => {
    const response = await api.as(users.nsOwner).post('/api/invitations', {
      email: 'peer@northstar.test',
      organizationId: demo.organizationId,
      teamId: demo.teamId,
      role: 'owner',
    });
    expectError(response, 400, 'Invalid request');
  });

  it('the integration token is read-only and cannot act as an engineer', async () => {
    const service = api.asService();
    for (const operation of operations) {
      const response = await operation.send(service);
      if (
        operation.allowed.includes('viewer') &&
        !['read audit trail', 'list members'].includes(operation.name)
      ) {
        expect(response.status, operation.name).toBe(200);
      } else {
        expect([401, 403], operation.name).toContain(response.status);
      }
    }
  });
});

describe('role behaviour across multiple teams in one organization', () => {
  const api = useTestApp();

  it('resolves the highest role across all of the engineer’s teams in the organization', () => {
    expect(listUserOrganizations(users.nsMultiTeam.id)).toEqual([
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'admin' },
    ]);
    expect(getOrganizationRole(users.nsMultiTeam.id, demo.organizationId)).toBe('admin');
    expect(
      hasPermission(getOrganizationRole(users.nsMultiTeam.id, demo.organizationId), 'network.manage'),
    ).toBe(true);
  });

  it('a viewer in one team who is admin in another team manages the whole organization', async () => {
    const lead = api.as(users.nsMultiTeam);
    const me = await lead.get<{ organizations: OrganizationMembership[] }>('/api/auth/me');
    expect(me.body.organizations).toEqual([
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'admin' },
    ]);

    // Network management is organization-wide, not limited to resources "owned" by the admin team.
    const created = await lead.post<{ data: Network }>('/api/networks', {
      ...networkBody,
      name: 'Field Net',
    });
    expect(created.status).toBe(201);
    const renamed = await lead.patch(`/api/networks/${demo.branchNetworkId}`, {
      organizationId: demo.organizationId,
      name: 'Branch Network (renamed)',
      description: '',
    });
    expect(renamed.status).toBe(200);

    // Invitations may target either team of the organization.
    for (const teamId of [demo.teamId, demo.secondTeamId]) {
      const invite = await lead.post('/api/invitations', {
        email: `recruit-${teamId}@northstar.test`,
        organizationId: demo.organizationId,
        teamId,
        role: 'viewer',
      });
      expect(invite.status, teamId).toBe(200);
    }
  });

  it('losing the elevated team membership immediately downgrades the effective role', async () => {
    const lead = api.as(users.nsMultiTeam);
    db.prepare('DELETE FROM team_memberships WHERE user_id = ? AND team_id = ?').run(
      users.nsMultiTeam.id,
      demo.secondTeamId,
    );
    expect(listUserOrganizations(users.nsMultiTeam.id)).toEqual([
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'viewer' },
    ]);
    expectError(await lead.post('/api/networks', { ...networkBody, name: 'After demotion' }), 403);
    expect((await lead.get('/api/networks')).status).toBe(200);
  });

  it('a second membership in the same organization never lowers an existing role', async () => {
    db.prepare(
      "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, 'viewer', ?)",
    ).run(users.nsOwner.id, demo.secondTeamId, new Date().toISOString());
    expect(listUserOrganizations(users.nsOwner.id)[0]?.role).toBe('owner');
    const invite = await api.as(users.nsOwner).post('/api/invitations', {
      email: 'peer@northstar.test',
      organizationId: demo.organizationId,
      teamId: demo.secondTeamId,
      role: 'admin',
    });
    expect(invite.status).toBe(200);
  });

  it('teams of the organization are visible to every member regardless of team', async () => {
    const viewer = await api.as(users.nsViewer).get<{ data: { id: string }[] }>('/api/teams', {
      query: { organizationId: demo.organizationId },
    });
    expect(viewer.body.data.map((team) => team.id).sort()).toEqual([demo.secondTeamId, demo.teamId].sort());
  });
});

describe('role behaviour across multiple organizations per engineer', () => {
  const api = useTestApp();

  it('reports a distinct role per organization', () => {
    expect(listUserOrganizations(users.multiOrg.id)).toEqual([
      { id: 'org-acme', name: 'Acme Manufacturing', role: 'operator' },
      { id: 'org-demo', name: 'Northstar Engineering', role: 'admin' },
    ]);
    expect(hasPermission(getOrganizationRole(users.multiOrg.id, 'org-demo'), 'network.manage')).toBe(true);
    expect(hasPermission(getOrganizationRole(users.multiOrg.id, 'org-acme'), 'network.manage')).toBe(false);
    expect(getOrganizationRole(users.multiOrg.id, 'org-solo')).toBeUndefined();
  });

  it('the organization list reflects the role for each organization', async () => {
    const response = await api
      .as(users.multiOrg)
      .get<{ data: OrganizationMembership[] }>('/api/organizations');
    expect(response.body.data).toEqual([
      { id: 'org-acme', name: 'Acme Manufacturing', role: 'operator' },
      { id: 'org-demo', name: 'Northstar Engineering', role: 'admin' },
    ]);
  });

  it('an admin role in one organization grants nothing in another', async () => {
    const consultant = api.as(users.multiOrg);
    const acme = fixtures.acme;

    // Operator-level work in org-acme succeeds.
    const enrolled = await consultant.post('/api/devices', {
      organizationId: acme.organizationId,
      networkId: acme.networkId,
      areaId: acme.officeAreaId,
      name: 'Consultant AP',
      type: 'Access point',
      address: '10.50.9.1',
    });
    expect(enrolled.status).toBe(201);

    // Admin-level work in org-acme is refused even though the engineer is an admin elsewhere.
    expectError(
      await consultant.post('/api/areas', {
        organizationId: acme.organizationId,
        networkId: acme.networkId,
        name: 'X',
        region: 'Y',
      }),
      403,
    );
    expectError(
      await consultant.delete(`/api/areas/${acme.officeAreaId}`, {
        query: { organizationId: acme.organizationId, networkId: acme.networkId },
      }),
      403,
    );
    expectError(
      await consultant.post('/api/invitations', {
        email: 'x@acme.test',
        organizationId: acme.organizationId,
        teamId: acme.teamId,
        role: 'viewer',
      }),
      403,
      'Organization admin access required',
    );
    expectError(await consultant.get('/api/audit', { query: { organizationId: acme.organizationId } }), 403);

    // Unfiltered audit reads only include organizations where the engineer is owner or admin, even
    // though the enrollment above wrote an org-acme event on behalf of this very engineer.
    expect((await consultant.post('/api/networks', { ...networkBody, name: 'Consultant Net' })).status).toBe(
      201,
    );
    const audit = await consultant.get<{ data: { organizationId: string; action: string }[] }>('/api/audit');
    expect(audit.status).toBe(200);
    expect(audit.body.data.length).toBeGreaterThan(0);
    expect(new Set(audit.body.data.map((event) => event.organizationId))).toEqual(new Set(['org-demo']));
    expect(
      db.prepare("SELECT COUNT(*) AS count FROM audit_log WHERE organization_id = 'org-acme'").get(),
    ).toEqual({ count: 1 });
  });

  it('resources cannot be moved between organizations through mixed identifiers', async () => {
    const consultant = api.as(users.multiOrg);
    // Network belongs to org-acme, but the caller claims org-demo where they are admin.
    expectError(
      await consultant.patch(`/api/networks/${fixtures.acme.networkId}`, {
        organizationId: demo.organizationId,
        name: 'Moved',
        description: '',
      }),
      404,
    );
    // Area in org-acme paired with a network in org-demo.
    expectError(
      await consultant.patch(`/api/areas/${fixtures.acme.plantAreaId}`, {
        organizationId: demo.organizationId,
        networkId: demo.coreNetworkId,
        name: 'Moved',
        region: 'X',
      }),
      404,
    );
    // Device in org-demo moved into an org-acme area where the caller is only an operator.
    expectError(
      await consultant.patch(`/api/devices/${demo.coreRouterId}`, {
        organizationId: demo.organizationId,
        networkId: demo.coreNetworkId,
        areaId: fixtures.acme.plantAreaId,
        name: 'Core Router 01',
        type: 'Router',
        address: '10.20.0.1',
      }),
      404,
    );
    expect(
      db
        .prepare('SELECT organization_id AS organizationId FROM networks WHERE id = ?')
        .get(fixtures.acme.networkId),
    ).toEqual({
      organizationId: 'org-acme',
    });
  });
});

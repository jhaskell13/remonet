import { describe, expect, it } from 'vitest';
import type {
  Organization,
  OrganizationMember,
  OrganizationMembership,
  Team,
} from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import { expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme, solo } = fixtures;
type Created = { data: Organization & { role: 'owner'; team: Team } };
type Session = { organizations: OrganizationMembership[] };

describe('organizations: creation', () => {
  const api = useTestApp();

  it('any engineer can create an organization and becomes its first owner', async () => {
    const viewer = api.as(users.nsViewer);
    const created = await viewer.post<Created>('/api/organizations', { name: '  Harbor Networks  ' });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Harbor Networks',
      role: 'owner',
      team: { id: expect.any(String), organizationId: created.body.data.id, name: 'Owners' },
    });

    // The session reflects the new organization immediately, with the viewer as owner there only.
    const me = await viewer.get<Session>('/api/auth/me');
    expect(me.body.organizations).toEqual([
      { id: created.body.data.id, name: 'Harbor Networks', role: 'owner' },
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'viewer' },
    ]);
    const members = await viewer.get<{ data: OrganizationMember[] }>(
      `/api/organizations/${created.body.data.id}/members`,
    );
    expect(members.body.data).toEqual([
      expect.objectContaining({
        userId: users.nsViewer.id,
        role: 'owner',
        teams: [
          expect.objectContaining({ teamId: created.body.data.team.id, teamName: 'Owners', role: 'owner' }),
        ],
      }),
    ]);
  });

  it('the creator may name the first team', async () => {
    const created = await api
      .as(users.soloOwner)
      .post<Created>('/api/organizations', { name: 'Second', teamName: 'Core Ops' });
    expect(created.body.data.team.name).toBe('Core Ops');
  });

  it('uses one account across organizations instead of duplicating it', async () => {
    const owner = api.as(users.nsOwner);
    await owner.post('/api/organizations', { name: 'One' });
    await owner.post('/api/organizations', { name: 'Two' });
    expect(
      db.prepare('SELECT COUNT(*) AS count FROM users WHERE email = ?').get(users.nsOwner.email),
    ).toEqual({ count: 1 });
    const me = await owner.get<Session>('/api/auth/me');
    expect(me.body.organizations.filter((organization) => organization.role === 'owner')).toHaveLength(3);
  });

  it('a new organization starts empty and isolated from existing ones', async () => {
    const owner = api.as(users.nsOwner);
    const created = await owner.post<Created>('/api/organizations', { name: 'Empty' });
    const networks = await owner.get<{ data: unknown[] }>('/api/networks', {
      query: { organizationId: created.body.data.id },
    });
    expect(networks.body.data).toEqual([]);
    const teams = await owner.get<{ data: Team[] }>('/api/teams', {
      query: { organizationId: created.body.data.id },
    });
    expect(teams.body.data.map((team) => team.name)).toEqual(['Owners']);
    // Other engineers do not see it.
    expectError(
      await api.as(users.acmeOwner).get('/api/networks', { query: { organizationId: created.body.data.id } }),
      403,
    );
    expectError(await api.as(users.acmeOwner).get(`/api/organizations/${created.body.data.id}/members`), 403);
  });

  it('validates the name and rejects the integration token', async () => {
    expectError(
      await api.as(users.nsOwner).post('/api/organizations', { name: '   ' }),
      400,
      'Organization name is required',
    );
    expectError(
      await api.as(users.nsOwner).post('/api/organizations', { name: 'n'.repeat(161) }),
      400,
      'Invalid request',
    );
    expectError(
      await api.as(users.nsOwner).post('/api/organizations', { name: 'Ok', teamName: ' ' }),
      400,
      'Team name is required',
    );
    expectError(await api.asService().post('/api/organizations', { name: 'Service org' }), 401);
    expectError(await api.anonymous.post('/api/organizations', { name: 'Anon org' }), 401);
    expect(db.prepare('SELECT COUNT(*) AS count FROM organizations').get()).toEqual({ count: 3 });
  });

  it('records the creation in the new organization’s audit trail', async () => {
    const owner = api.as(users.nsOwner);
    const created = await owner.post<Created>('/api/organizations', { name: 'Audited' });
    const audit = await owner.get<{
      data: { action: string; entityId: string; details: Record<string, unknown> }[];
    }>('/api/audit', {
      query: { organizationId: created.body.data.id },
    });
    expect(audit.body.data).toEqual([
      expect.objectContaining({
        action: 'organization.created',
        entityType: 'organization',
        entityId: created.body.data.id,
        actorId: users.nsOwner.id,
        details: {
          after: { id: created.body.data.id, name: 'Audited' },
          team: created.body.data.team,
          owner: { userId: users.nsOwner.id, teamId: created.body.data.team.id, role: 'owner' },
        },
      }),
    ]);
  });
});

describe('organizations: renaming', () => {
  const api = useTestApp();

  it('owners can rename their organization', async () => {
    const renamed = await api
      .as(users.nsOwner)
      .patch<{ data: Organization }>(`/api/organizations/${demo.organizationId}`, {
        name: 'Northstar Engineering Ltd',
      });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data).toEqual({ id: demo.organizationId, name: 'Northstar Engineering Ltd' });
    const me = await api.as(users.nsViewer).get<Session>('/api/auth/me');
    expect(me.body.organizations[0]?.name).toBe('Northstar Engineering Ltd');
    expect(
      db.prepare('SELECT action FROM audit_log WHERE organization_id = ?').all(demo.organizationId),
    ).toEqual([{ action: 'organization.updated' }]);
  });

  it('admins, operators, and viewers cannot rename it', async () => {
    for (const user of [users.nsAdmin, users.nsMultiTeam, users.nsOperator, users.nsViewer]) {
      expectError(
        await api.as(user).patch(`/api/organizations/${demo.organizationId}`, { name: 'Hijacked' }),
        403,
        'Organization owner access required',
      );
    }
    expect(db.prepare('SELECT name FROM organizations WHERE id = ?').get(demo.organizationId)).toEqual({
      name: 'Northstar Engineering',
    });
  });

  it('owners of other organizations and unknown ids are refused identically', async () => {
    expectError(
      await api.as(users.acmeOwner).patch(`/api/organizations/${demo.organizationId}`, { name: 'X' }),
      403,
      'Organization access denied',
    );
    expectError(
      await api.as(users.acmeOwner).patch('/api/organizations/org-missing', { name: 'X' }),
      403,
      'Organization access denied',
    );
    expectError(await api.asService().patch(`/api/organizations/${demo.organizationId}`, { name: 'X' }), 401);
  });
});

describe('organizations: member roster', () => {
  const api = useTestApp();

  it('lists every member once with all of their team memberships and effective role', async () => {
    const response = await api
      .as(users.nsViewer)
      .get<{ data: OrganizationMember[] }>(`/api/organizations/${demo.organizationId}/members`);
    expect(response.status).toBe(200);
    const byId = new Map(response.body.data.map((member) => [member.userId, member]));
    expect([...byId.keys()].sort()).toEqual(
      [
        users.nsOwner,
        users.nsAdmin,
        users.nsOperator,
        users.nsViewer,
        users.nsMultiTeam,
        users.multiOrg,
        users.nsInactive,
      ]
        .map((user) => user.id)
        .sort(),
    );
    expect(byId.get(users.nsMultiTeam.id)).toEqual({
      userId: users.nsMultiTeam.id,
      email: users.nsMultiTeam.email,
      displayName: users.nsMultiTeam.displayName,
      isActive: true,
      role: 'admin',
      teams: [
        {
          teamId: demo.secondTeamId,
          teamName: 'Field Engineering',
          role: 'admin',
          since: expect.any(String),
        },
        { teamId: demo.teamId, teamName: 'Network Operations', role: 'viewer', since: expect.any(String) },
      ],
    });
    expect(byId.get(users.nsInactive.id)).toMatchObject({ isActive: false, role: 'owner' });
    // Memberships in other organizations are not part of this roster.
    expect(byId.get(users.multiOrg.id)?.teams.map((team) => team.teamId)).toEqual([demo.teamId]);
    for (const member of response.body.data) expect(member).not.toHaveProperty('passwordHash');
  });

  it('is visible to members of the organization only', async () => {
    expectError(
      await api.as(users.soloOwner).get(`/api/organizations/${demo.organizationId}/members`),
      403,
      'Organization access denied',
    );
    expectError(await api.asService().get(`/api/organizations/${demo.organizationId}/members`), 401);
    expectError(await api.anonymous.get(`/api/organizations/${demo.organizationId}/members`), 401);
    const acmeRoster = await api
      .as(users.multiOrg)
      .get<{ data: OrganizationMember[] }>(`/api/organizations/${acme.organizationId}/members`);
    expect(acmeRoster.body.data.map((member) => member.userId).sort()).toEqual(
      [users.acmeOwner.id, users.acmeViewer.id, users.multiOrg.id].sort(),
    );
    expect(solo.organizationId).toBeDefined();
  });
});

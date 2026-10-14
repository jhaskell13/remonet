import { describe, expect, it } from 'vitest';
import type {
  OrganizationMember,
  OrganizationMembership,
  PendingInvitation,
} from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import { listUserOrganizations } from '../../../server/persistence/repositories/user-repository.ts';
import { expectError, useTestApp, type ApiClient } from '../helpers/app.ts';
import { fixtures, users, type TestUser } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
type Member = { data: OrganizationMember };
const lastOwnerMessage = 'An organization must keep at least one owner. Promote another owner first.';

const membershipRole = (userId: string, teamId: string) =>
  (
    db.prepare('SELECT role FROM team_memberships WHERE user_id = ? AND team_id = ?').get(userId, teamId) as
      { role: string } | undefined
  )?.role;

function addToTeam(
  client: ApiClient,
  teamId: string,
  user: TestUser,
  role: string,
  organizationId: string = demo.organizationId,
) {
  return client.post<Member>(`/api/teams/${teamId}/members`, { organizationId, userId: user.id, role });
}
function changeRole(
  client: ApiClient,
  teamId: string,
  user: TestUser,
  role: string,
  organizationId: string = demo.organizationId,
) {
  return client.patch<Member>(`/api/teams/${teamId}/members/${user.id}`, { organizationId, role });
}
function remove(
  client: ApiClient,
  teamId: string,
  user: TestUser,
  organizationId: string = demo.organizationId,
) {
  return client.delete(`/api/teams/${teamId}/members/${user.id}`, { query: { organizationId } });
}

describe('memberships: adding existing members to teams', () => {
  const api = useTestApp();

  it('an admin adds an existing member of the organization to another team', async () => {
    const added = await addToTeam(api.as(users.nsAdmin), demo.secondTeamId, users.nsOperator, 'viewer');
    expect(added.status).toBe(201);
    expect(added.body.data).toMatchObject({
      userId: users.nsOperator.id,
      role: 'operator',
      teams: [
        expect.objectContaining({ teamId: demo.secondTeamId, role: 'viewer' }),
        expect.objectContaining({ teamId: demo.teamId, role: 'operator' }),
      ],
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get()).toEqual({
      count: Object.keys(users).length,
    });
  });

  it('people outside the organization cannot be added directly; they must be invited', async () => {
    expectError(
      await addToTeam(api.as(users.nsOwner), demo.teamId, users.soloOwner, 'viewer'),
      404,
      'This person is not a member of the organization. Send an invitation instead.',
    );
    expectError(
      await api.as(users.nsOwner).post(`/api/teams/${demo.teamId}/members`, {
        organizationId: demo.organizationId,
        userId: 'user-missing',
        role: 'viewer',
      }),
      404,
    );
    expect(membershipRole(users.soloOwner.id, demo.teamId)).toBeUndefined();
  });

  it('refuses duplicates and deactivated accounts', async () => {
    expectError(
      await addToTeam(api.as(users.nsOwner), demo.teamId, users.nsViewer, 'viewer'),
      409,
      'This person is already a member of the team',
    );
    expectError(
      await addToTeam(api.as(users.nsOwner), demo.secondTeamId, users.nsInactive, 'viewer'),
      409,
      'This account is deactivated',
    );
  });

  it('admins may grant operator and viewer only; owners may grant any role including owner', async () => {
    const admin = api.as(users.nsAdmin);
    expectError(
      await addToTeam(admin, demo.secondTeamId, users.nsOperator, 'admin'),
      403,
      'Only an organization owner can grant the admin role',
    );
    expectError(
      await addToTeam(admin, demo.secondTeamId, users.nsOperator, 'owner'),
      403,
      'Only an organization owner can grant the owner role',
    );
    expect((await addToTeam(admin, demo.secondTeamId, users.nsOperator, 'operator')).status).toBe(201);

    const owner = api.as(users.nsOwner);
    const promoted = await addToTeam(owner, demo.secondTeamId, users.nsViewer, 'owner');
    expect(promoted.status).toBe(201);
    expect(promoted.body.data.role).toBe('owner');
    expect(listUserOrganizations(users.nsViewer.id)).toEqual([
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'owner' },
    ]);
  });

  it('admins cannot act on admins or owners, even through a team where those people hold a lower role', async () => {
    const admin = api.as(users.nsAdmin);
    // The field lead is a viewer in Network Operations but an admin in Field Engineering.
    expectError(
      await addToTeam(admin, demo.secondTeamId, users.nsOwner, 'viewer'),
      403,
      'Organization owner access required to manage this member',
    );
    db.prepare('DELETE FROM team_memberships WHERE user_id = ? AND team_id = ?').run(
      users.nsMultiTeam.id,
      demo.teamId,
    );
    expectError(
      await addToTeam(admin, demo.teamId, users.nsMultiTeam, 'viewer'),
      403,
      'Organization owner access required to manage this member',
    );
    expect((await addToTeam(api.as(users.nsOwner), demo.teamId, users.nsMultiTeam, 'viewer')).status).toBe(
      201,
    );
  });

  it('operators, viewers, outsiders, and the integration token cannot add members', async () => {
    expectError(
      await addToTeam(api.as(users.nsOperator), demo.secondTeamId, users.nsViewer, 'viewer'),
      403,
      'Organization admin access required',
    );
    expectError(await addToTeam(api.as(users.nsViewer), demo.secondTeamId, users.nsOperator, 'viewer'), 403);
    expectError(
      await addToTeam(api.as(users.acmeOwner), demo.secondTeamId, users.nsOperator, 'viewer'),
      403,
      'Organization access denied',
    );
    expectError(
      await api.asService().post(`/api/teams/${demo.secondTeamId}/members`, {
        organizationId: demo.organizationId,
        userId: users.nsOperator.id,
        role: 'viewer',
      }),
      401,
    );
    expectError(
      await api.as(users.nsOwner).post(`/api/teams/${demo.secondTeamId}/members`, {
        organizationId: demo.organizationId,
        userId: users.nsOperator.id,
        role: 'root',
      }),
      400,
    );
  });

  it('team and organization must match', async () => {
    expectError(
      await addToTeam(api.as(users.nsOwner), acme.teamId, users.nsOperator, 'viewer'),
      404,
      'Team not found',
    );
    expectError(
      await addToTeam(api.as(users.multiOrg), acme.teamId, users.nsOperator, 'viewer', acme.organizationId),
      403,
      'Organization admin access required',
    );
  });
});

describe('memberships: role changes', () => {
  const api = useTestApp();

  it('takes effect on the next request without a new session', async () => {
    const viewer = api.as(users.nsViewer);
    expectError(
      await viewer.post('/api/devices', {
        organizationId: demo.organizationId,
        networkId: demo.coreNetworkId,
        areaId: demo.dataCenterAreaId,
        name: 'X',
        type: 'Switch',
        address: '10.10.9.9',
      }),
      403,
    );
    const changed = await changeRole(api.as(users.nsAdmin), demo.teamId, users.nsViewer, 'operator');
    expect(changed.status).toBe(200);
    expect(changed.body.data).toMatchObject({
      role: 'operator',
      teams: [expect.objectContaining({ teamId: demo.teamId, role: 'operator' })],
    });
    const me = await viewer.get<{ organizations: OrganizationMembership[] }>('/api/auth/me');
    expect(me.body.organizations[0]?.role).toBe('operator');
    expect(
      (
        await viewer.post('/api/devices', {
          organizationId: demo.organizationId,
          networkId: demo.coreNetworkId,
          areaId: demo.dataCenterAreaId,
          name: 'X',
          type: 'Switch',
          address: '10.10.9.9',
        })
      ).status,
    ).toBe(201);
  });

  it('admins can move people between operator and viewer but not to or from admin/owner', async () => {
    const admin = api.as(users.nsAdmin);
    expect((await changeRole(admin, demo.teamId, users.nsOperator, 'viewer')).status).toBe(200);
    expectError(
      await changeRole(admin, demo.teamId, users.nsOperator, 'admin'),
      403,
      'Only an organization owner can grant the admin role',
    );
    expectError(
      await changeRole(admin, demo.teamId, users.nsOwner, 'viewer'),
      403,
      'Organization owner access required to manage this member',
    );
    expectError(
      await changeRole(admin, demo.teamId, users.multiOrg, 'viewer'),
      403,
      'Organization owner access required to manage this member',
    );
    expectError(
      await changeRole(admin, demo.teamId, users.nsAdmin, 'owner'),
      403,
      'Organization owner access required to manage this member',
    );
    expect(membershipRole(users.nsOwner.id, demo.teamId)).toBe('owner');
    expect(membershipRole(users.nsAdmin.id, demo.teamId)).toBe('admin');
  });

  it('owners can promote co-owners and demote admins', async () => {
    const owner = api.as(users.nsOwner);
    expect((await changeRole(owner, demo.teamId, users.nsAdmin, 'owner')).body.data.role).toBe('owner');
    expect((await changeRole(owner, demo.teamId, users.multiOrg, 'viewer')).body.data.role).toBe('viewer');
    expect(listUserOrganizations(users.multiOrg.id)).toEqual([
      { id: 'org-acme', name: 'Acme Manufacturing', role: 'operator' },
      { id: 'org-demo', name: 'Northstar Engineering', role: 'viewer' },
    ]);
  });

  it('an owner may step down only when another active owner remains', async () => {
    const owner = api.as(users.nsOwner);
    // The only other owner membership in org-demo belongs to a deactivated account, which does not count.
    expectError(await changeRole(owner, demo.teamId, users.nsOwner, 'admin'), 409, lastOwnerMessage);
    expect(membershipRole(users.nsOwner.id, demo.teamId)).toBe('owner');

    await changeRole(owner, demo.teamId, users.nsAdmin, 'owner');
    expect((await changeRole(owner, demo.teamId, users.nsOwner, 'admin')).body.data.role).toBe('admin');
    // The former owner is now an admin and bound by admin limits.
    expectError(
      await changeRole(owner, demo.teamId, users.nsAdmin, 'admin'),
      403,
      'Organization owner access required to manage this member',
    );
  });

  it('an owner who holds the owner role in two teams can be demoted in one of them', async () => {
    const owner = api.as(users.nsOwner);
    await addToTeam(owner, demo.secondTeamId, users.nsOwner, 'owner');
    expect((await changeRole(owner, demo.secondTeamId, users.nsOwner, 'viewer')).body.data.role).toBe(
      'owner',
    );
    expect(membershipRole(users.nsOwner.id, demo.secondTeamId)).toBe('viewer');
    expectError(await changeRole(owner, demo.teamId, users.nsOwner, 'viewer'), 409, lastOwnerMessage);
  });

  it('setting the same role again is a no-op that leaves no audit event', async () => {
    const response = await changeRole(api.as(users.nsOwner), demo.teamId, users.nsViewer, 'viewer');
    expect(response.status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
  });

  it('refuses unknown memberships and cross-organization identifiers', async () => {
    const owner = api.as(users.nsOwner);
    expectError(
      await changeRole(owner, demo.secondTeamId, users.nsViewer, 'operator'),
      404,
      'Membership not found',
    );
    expectError(await changeRole(owner, acme.teamId, users.multiOrg, 'viewer'), 404);
    expectError(
      await changeRole(owner, acme.teamId, users.acmeViewer, 'viewer', acme.organizationId),
      403,
      'Organization access denied',
    );
    expect(membershipRole(users.acmeViewer.id, acme.teamId)).toBe('viewer');
  });
});

describe('memberships: removal and leaving', () => {
  const api = useTestApp();

  it('admins remove operators and viewers; access ends immediately', async () => {
    const viewer = api.as(users.nsViewer);
    expect(
      (await viewer.get('/api/networks', { query: { organizationId: demo.organizationId } })).status,
    ).toBe(200);
    const removed = await remove(api.as(users.nsAdmin), demo.teamId, users.nsViewer);
    expect(removed.status).toBe(200);
    expect(removed.body).toEqual({ data: { ok: true } });
    expectError(await viewer.get('/api/networks', { query: { organizationId: demo.organizationId } }), 403);
    const me = await viewer.get<{ organizations: OrganizationMembership[] }>('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.organizations).toEqual([]);
    // The account itself is untouched.
    expect(db.prepare('SELECT is_active AS isActive FROM users WHERE id = ?').get(users.nsViewer.id)).toEqual(
      { isActive: 1 },
    );
  });

  it('removing one team membership keeps the others', async () => {
    await remove(api.as(users.nsOwner), demo.teamId, users.nsMultiTeam);
    expect(listUserOrganizations(users.nsMultiTeam.id)).toEqual([
      { id: demo.organizationId, name: 'Northstar Engineering', role: 'admin' },
    ]);
  });

  it('admins cannot remove admins or owners', async () => {
    const admin = api.as(users.nsAdmin);
    expectError(
      await remove(admin, demo.teamId, users.nsOwner),
      403,
      'Organization owner access required to manage this member',
    );
    expectError(await remove(admin, demo.teamId, users.multiOrg), 403);
    expect(membershipRole(users.nsOwner.id, demo.teamId)).toBe('owner');
  });

  it('the last active owner cannot be removed by anyone, including themselves', async () => {
    expectError(await remove(api.as(users.nsOwner), demo.teamId, users.nsOwner), 409, lastOwnerMessage);
    await changeRole(api.as(users.nsOwner), demo.teamId, users.nsAdmin, 'owner');
    expect((await remove(api.as(users.nsOwner), demo.teamId, users.nsOwner)).status).toBe(200);
    expect(listUserOrganizations(users.nsOwner.id)).toEqual([]);
  });

  it('refuses to remove a membership that does not exist in that team', async () => {
    // The viewer belongs to the organization, but not to Field Engineering.
    expectError(
      await remove(api.as(users.nsOwner), demo.secondTeamId, users.nsViewer),
      404,
      'Membership not found',
    );
    expectError(
      await remove(api.as(users.nsViewer), demo.secondTeamId, users.nsViewer),
      404,
      'Membership not found',
    );
    expectError(
      await remove(api.as(users.nsOwner), 'team-missing', users.nsViewer),
      404,
      'Membership not found',
    );
  });

  it('anyone can leave a team without administrative rights', async () => {
    const operator = api.as(users.nsOperator);
    expect((await remove(operator, demo.teamId, users.nsOperator)).status).toBe(200);
    expect(membershipRole(users.nsOperator.id, demo.teamId)).toBeUndefined();
    const admin = api.as(users.nsAdmin);
    expect((await remove(admin, demo.teamId, users.nsAdmin)).status).toBe(200);
  });

  it('members cannot remove others and outsiders cannot touch the organization', async () => {
    expectError(
      await remove(api.as(users.nsOperator), demo.teamId, users.nsViewer),
      403,
      'Organization admin access required',
    );
    expectError(
      await remove(api.as(users.acmeOwner), demo.teamId, users.nsViewer),
      403,
      'Organization access denied',
    );
    expectError(
      await remove(api.as(users.acmeOwner), demo.teamId, users.acmeOwner),
      403,
      'Organization access denied',
    );
    expectError(
      await remove(api.as(users.nsOwner), acme.teamId, users.acmeViewer),
      404,
      'This person is not a member of the organization. Send an invitation instead.',
    );
    expectError(
      await api.asService().delete(`/api/teams/${demo.teamId}/members/${users.nsViewer.id}`, {
        query: { organizationId: demo.organizationId },
      }),
      401,
    );
    expect(membershipRole(users.nsViewer.id, demo.teamId)).toBe('viewer');
  });

  it('records membership changes with the acting account', async () => {
    const owner = api.as(users.nsOwner);
    await addToTeam(owner, demo.secondTeamId, users.nsViewer, 'viewer');
    await changeRole(owner, demo.secondTeamId, users.nsViewer, 'operator');
    await remove(owner, demo.secondTeamId, users.nsViewer);
    await remove(api.as(users.nsOperator), demo.teamId, users.nsOperator);
    const events = db
      .prepare(
        'SELECT actor_id AS actorId, action, entity_id AS entityId, details FROM audit_log WHERE organization_id = ? ORDER BY created_at, rowid',
      )
      .all(demo.organizationId)
      .map((row) => {
        const record = row as { actorId: string; action: string; entityId: string; details: string };
        return { ...record, details: JSON.parse(record.details) as Record<string, unknown> };
      });
    expect(events).toEqual([
      {
        actorId: users.nsOwner.id,
        action: 'membership.added',
        entityId: users.nsViewer.id,
        details: {
          userId: users.nsViewer.id,
          email: users.nsViewer.email,
          teamId: demo.secondTeamId,
          role: 'viewer',
        },
      },
      {
        actorId: users.nsOwner.id,
        action: 'membership.role_changed',
        entityId: users.nsViewer.id,
        details: {
          userId: users.nsViewer.id,
          teamId: demo.secondTeamId,
          before: 'viewer',
          after: 'operator',
        },
      },
      {
        actorId: users.nsOwner.id,
        action: 'membership.removed',
        entityId: users.nsViewer.id,
        details: { userId: users.nsViewer.id, teamId: demo.secondTeamId, role: 'operator', self: false },
      },
      {
        actorId: users.nsOperator.id,
        action: 'membership.removed',
        entityId: users.nsOperator.id,
        details: { userId: users.nsOperator.id, teamId: demo.teamId, role: 'operator', self: true },
      },
    ]);
  });
});

describe('memberships: pending invitations', () => {
  const api = useTestApp();

  async function invite(client: ApiClient, email: string, role: 'admin' | 'operator' | 'viewer') {
    const response = await client.post<{ inviteUrl: string }>('/api/invitations', {
      email,
      organizationId: demo.organizationId,
      teamId: demo.teamId,
      role,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return new URL(response.body.inviteUrl).hash.replace('#invite=', '');
  }

  it('lists pending invitations of the organization for owners and admins', async () => {
    await invite(api.as(users.nsOwner), 'first@northstar.test', 'admin');
    await invite(api.as(users.nsAdmin), 'second@northstar.test', 'viewer');
    await api.as(users.acmeOwner).post('/api/invitations', {
      email: 'acme@acme.test',
      organizationId: acme.organizationId,
      teamId: acme.teamId,
      role: 'viewer',
    });

    const listed = await api.as(users.nsAdmin).get<{ data: PendingInvitation[] }>('/api/invitations', {
      query: { organizationId: demo.organizationId },
    });
    expect(listed.status).toBe(200);
    expect(listed.body.data).toEqual([
      {
        id: expect.any(String),
        email: 'second@northstar.test',
        organizationId: demo.organizationId,
        teamId: demo.teamId,
        teamName: 'Network Operations',
        role: 'viewer',
        invitedBy: { id: users.nsAdmin.id, displayName: users.nsAdmin.displayName },
        createdAt: expect.any(String),
        expiresAt: expect.any(String),
      },
      expect.objectContaining({
        email: 'first@northstar.test',
        role: 'admin',
        invitedBy: { id: users.nsOwner.id, displayName: users.nsOwner.displayName },
      }),
    ]);
    for (const invitation of listed.body.data) expect(invitation).not.toHaveProperty('tokenHash');
    expectError(
      await api
        .as(users.nsOperator)
        .get('/api/invitations', { query: { organizationId: demo.organizationId } }),
      403,
    );
    expectError(
      await api.as(users.nsOwner).get('/api/invitations', { query: { organizationId: acme.organizationId } }),
      403,
    );
    expectError(await api.as(users.nsOwner).get('/api/invitations'), 400);
  });

  it('revoking an invitation invalidates its link', async () => {
    const token = await invite(api.as(users.nsOwner), 'revoked@northstar.test', 'viewer');
    const [invitation] = (
      await api.as(users.nsOwner).get<{ data: PendingInvitation[] }>('/api/invitations', {
        query: { organizationId: demo.organizationId },
      })
    ).body.data;
    const revoked = await api
      .as(users.nsAdmin)
      .delete(`/api/invitations/${invitation!.id}`, { query: { organizationId: demo.organizationId } });
    expect(revoked.status).toBe(200);
    expectError(await api.anonymous.post('/api/invitations/inspect', { token }), 404);
    expectError(
      await api.anonymous.post('/api/invitations/accept', {
        token,
        displayName: 'Late',
        password: 'LongEnoughPassword!',
      }),
      404,
    );
    expectError(
      await api
        .as(users.nsAdmin)
        .delete(`/api/invitations/${invitation!.id}`, { query: { organizationId: demo.organizationId } }),
      404,
      'Invitation not found',
    );
    expect(
      db
        .prepare("SELECT action, details FROM audit_log WHERE action = 'membership.invitation_revoked'")
        .get(),
    ).toEqual({
      action: 'membership.invitation_revoked',
      details: JSON.stringify({ email: 'revoked@northstar.test', teamId: demo.teamId, role: 'viewer' }),
    });
  });

  it('accepted invitations disappear from the pending list and cannot be revoked', async () => {
    const token = await invite(api.as(users.nsOwner), users.acmeViewer.email, 'viewer');
    const [invitation] = (
      await api.as(users.nsOwner).get<{ data: PendingInvitation[] }>('/api/invitations', {
        query: { organizationId: demo.organizationId },
      })
    ).body.data;
    await api.as(users.acmeViewer).post('/api/invitations/accept', { token });
    const listed = await api.as(users.nsOwner).get<{ data: PendingInvitation[] }>('/api/invitations', {
      query: { organizationId: demo.organizationId },
    });
    expect(listed.body.data).toEqual([]);
    expectError(
      await api
        .as(users.nsOwner)
        .delete(`/api/invitations/${invitation!.id}`, { query: { organizationId: demo.organizationId } }),
      404,
    );
    expect(membershipRole(users.acmeViewer.id, demo.teamId)).toBe('viewer');
  });

  it('invitations cannot be revoked through another organization', async () => {
    await invite(api.as(users.nsOwner), 'target@northstar.test', 'viewer');
    const [invitation] = (
      await api.as(users.nsOwner).get<{ data: PendingInvitation[] }>('/api/invitations', {
        query: { organizationId: demo.organizationId },
      })
    ).body.data;
    expectError(
      await api
        .as(users.acmeOwner)
        .delete(`/api/invitations/${invitation!.id}`, { query: { organizationId: acme.organizationId } }),
      404,
    );
    expectError(
      await api
        .as(users.acmeOwner)
        .delete(`/api/invitations/${invitation!.id}`, { query: { organizationId: demo.organizationId } }),
      403,
    );
    expect(db.prepare('SELECT 1 FROM invitations WHERE id = ?').get(invitation!.id)).toBeDefined();
  });
});

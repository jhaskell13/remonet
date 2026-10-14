import { describe, expect, it } from 'vitest';
import type { Team } from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import { expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
const count = (sql: string, ...values: unknown[]) =>
  (db.prepare(sql).get(...values) as { count: number }).count;

describe('teams', () => {
  const api = useTestApp();

  it('owners and admins create teams; names are unique per organization', async () => {
    const created = await api
      .as(users.nsAdmin)
      .post<{ data: Team }>('/api/teams', { organizationId: demo.organizationId, name: '  Night Shift ' });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual({
      id: expect.any(String),
      organizationId: demo.organizationId,
      name: 'Night Shift',
    });
    expectError(
      await api
        .as(users.nsOwner)
        .post('/api/teams', { organizationId: demo.organizationId, name: 'night shift' }),
      409,
      'A team with this name already exists',
    );
    // The same name is fine in another organization.
    expect(
      (
        await api
          .as(users.acmeOwner)
          .post('/api/teams', { organizationId: acme.organizationId, name: 'Night Shift' })
      ).status,
    ).toBe(201);
    const teams = await api
      .as(users.nsViewer)
      .get<{ data: Team[] }>('/api/teams', { query: { organizationId: demo.organizationId } });
    expect(teams.body.data.map((team) => team.name)).toEqual([
      'Field Engineering',
      'Network Operations',
      'Night Shift',
    ]);
  });

  it('operators and viewers cannot create teams, and nobody can create them elsewhere', async () => {
    expectError(
      await api.as(users.nsOperator).post('/api/teams', { organizationId: demo.organizationId, name: 'X' }),
      403,
      'Organization admin access required',
    );
    expectError(
      await api.as(users.nsViewer).post('/api/teams', { organizationId: demo.organizationId, name: 'X' }),
      403,
    );
    expectError(
      await api.as(users.nsOwner).post('/api/teams', { organizationId: acme.organizationId, name: 'X' }),
      403,
      'Organization access denied',
    );
    expectError(
      await api.as(users.multiOrg).post('/api/teams', { organizationId: acme.organizationId, name: 'X' }),
      403,
      'Organization admin access required',
    );
    expectError(
      await api.asService().post('/api/teams', { organizationId: demo.organizationId, name: 'X' }),
      401,
    );
    expectError(
      await api.as(users.nsOwner).post('/api/teams', { organizationId: demo.organizationId, name: '  ' }),
      400,
      'Team name is required',
    );
    expect(count('SELECT COUNT(*) AS count FROM teams')).toBe(4);
  });

  it('renames a team within its organization only', async () => {
    const renamed = await api.as(users.nsAdmin).patch<{ data: Team }>(`/api/teams/${demo.secondTeamId}`, {
      organizationId: demo.organizationId,
      name: 'Field Services',
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.data.name).toBe('Field Services');
    expectError(
      await api.as(users.nsAdmin).patch(`/api/teams/${demo.secondTeamId}`, {
        organizationId: demo.organizationId,
        name: 'Network Operations',
      }),
      409,
    );
    expectError(
      await api
        .as(users.nsAdmin)
        .patch(`/api/teams/${acme.teamId}`, { organizationId: demo.organizationId, name: 'Moved' }),
      404,
      'Team not found',
    );
    expectError(
      await api
        .as(users.nsAdmin)
        .patch(`/api/teams/${acme.teamId}`, { organizationId: acme.organizationId, name: 'Moved' }),
      403,
    );
    expect(db.prepare('SELECT name FROM teams WHERE id = ?').get(acme.teamId)).toEqual({
      name: 'Infrastructure Team',
    });
  });

  it('only owners delete teams, and only empty ones', async () => {
    const owner = api.as(users.nsOwner);
    const created = await owner.post<{ data: Team }>('/api/teams', {
      organizationId: demo.organizationId,
      name: 'Temporary',
    });
    const teamId = created.body.data.id;

    expectError(
      await api
        .as(users.nsAdmin)
        .delete(`/api/teams/${teamId}`, { query: { organizationId: demo.organizationId } }),
      403,
      'Organization owner access required',
    );
    expectError(
      await owner.delete(`/api/teams/${demo.secondTeamId}`, {
        query: { organizationId: demo.organizationId },
      }),
      409,
      'Remove the members of this team before deleting it',
    );
    expect(db.prepare('SELECT 1 FROM teams WHERE id = ?').get(demo.secondTeamId)).toBeDefined();

    // Pending invitations for the team are discarded with it.
    await owner.post('/api/invitations', {
      email: 'pending@northstar.test',
      organizationId: demo.organizationId,
      teamId,
      role: 'viewer',
    });
    const removed = await owner.delete<{ data: { ok: true } }>(`/api/teams/${teamId}`, {
      query: { organizationId: demo.organizationId },
    });
    expect(removed.status).toBe(200);
    expect(db.prepare('SELECT 1 FROM teams WHERE id = ?').get(teamId)).toBeUndefined();
    expect(count('SELECT COUNT(*) AS count FROM invitations WHERE team_id = ?', teamId)).toBe(0);
    expectError(
      await owner.delete(`/api/teams/${teamId}`, { query: { organizationId: demo.organizationId } }),
      404,
      'Team not found',
    );
  });

  it('cannot delete a team through another organization', async () => {
    db.prepare(
      "INSERT INTO teams (id, organization_id, name) VALUES ('team-acme-empty', 'org-acme', 'Empty')",
    ).run();
    expectError(
      await api
        .as(users.nsOwner)
        .delete('/api/teams/team-acme-empty', { query: { organizationId: demo.organizationId } }),
      404,
    );
    expectError(
      await api
        .as(users.nsOwner)
        .delete('/api/teams/team-acme-empty', { query: { organizationId: acme.organizationId } }),
      403,
    );
    expect(db.prepare("SELECT 1 FROM teams WHERE id = 'team-acme-empty'").get()).toBeDefined();
  });

  it('records team changes in the audit trail', async () => {
    const owner = api.as(users.nsOwner);
    const created = await owner.post<{ data: Team }>('/api/teams', {
      organizationId: demo.organizationId,
      name: 'Trail',
    });
    await owner.patch(`/api/teams/${created.body.data.id}`, {
      organizationId: demo.organizationId,
      name: 'Trail 2',
    });
    await owner.delete(`/api/teams/${created.body.data.id}`, {
      query: { organizationId: demo.organizationId },
    });
    const events = db
      .prepare(
        'SELECT action, entity_type AS entityType, entity_id AS entityId FROM audit_log WHERE organization_id = ? ORDER BY created_at, rowid',
      )
      .all(demo.organizationId);
    expect(events).toEqual([
      { action: 'team.created', entityType: 'team', entityId: created.body.data.id },
      { action: 'team.updated', entityType: 'team', entityId: created.body.data.id },
      { action: 'team.deleted', entityType: 'team', entityId: created.body.data.id },
    ]);
  });
});

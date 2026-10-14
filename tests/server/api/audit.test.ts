import { describe, expect, it, vi } from 'vitest';
import type { Area, AuditEvent, Device, Network } from '../../../shared/network.ts';
import { db } from '../../../server/persistence/database.ts';
import * as auditRepository from '../../../server/persistence/repositories/audit-repository.ts';
import { allowedOrigin, expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
type One<T> = { data: T };
type Trail = { data: AuditEvent[] };

function trail(organizationId = demo.organizationId) {
  return db
    .prepare(
      'SELECT id, organization_id AS organizationId, actor_id AS actorId, actor_email AS actorEmail, action, entity_type AS entityType, entity_id AS entityId, details, created_at AS createdAt FROM audit_log WHERE organization_id = ? ORDER BY created_at, rowid',
    )
    .all(organizationId)
    .map((row) => {
      const record = row as Omit<AuditEvent, 'details'> & { details: string };
      return { ...record, details: JSON.parse(record.details) as Record<string, unknown> };
    });
}

describe('audit trail: recorded changes', () => {
  const api = useTestApp();

  it('records network creation and updates with before/after snapshots', async () => {
    const admin = api.as(users.nsAdmin);
    const created = await admin.post<One<Network>>('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Audit Net',
      description: 'v1',
    });
    const updated = await admin.patch<One<Network>>(`/api/networks/${created.body.data.id}`, {
      organizationId: demo.organizationId,
      name: 'Audit Net',
      description: 'v2',
    });
    expect(trail()).toEqual([
      expect.objectContaining({
        actorId: users.nsAdmin.id,
        actorEmail: users.nsAdmin.email,
        action: 'network.created',
        entityType: 'network',
        entityId: created.body.data.id,
        details: { after: created.body.data },
      }),
      expect.objectContaining({
        action: 'network.updated',
        entityId: created.body.data.id,
        details: { before: created.body.data, after: updated.body.data },
      }),
    ]);
  });

  it('records the area lifecycle including deletion', async () => {
    const owner = api.as(users.nsOwner);
    const body = {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      name: 'Audit Area',
      region: 'Lab',
    };
    const created = await owner.post<One<Area>>('/api/areas', body);
    await owner.patch(`/api/areas/${created.body.data.id}`, { ...body, region: 'Lab 2' });
    await owner.delete(`/api/areas/${created.body.data.id}`, {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    expect(trail().map((event) => event.action)).toEqual(['area.created', 'area.updated', 'area.deleted']);
    const deleted = trail()[2]!;
    expect(deleted.entityId).toBe(created.body.data.id);
    expect(deleted.details).toEqual({ before: { ...created.body.data, region: 'Lab 2' } });
  });

  it('records device enrollment, updates, and deletion with the acting operator', async () => {
    const operator = api.as(users.nsOperator);
    const body = {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      areaId: demo.dataCenterAreaId,
      name: 'Audit Device',
      type: 'Firewall',
      address: '10.10.0.77',
    };
    const created = await operator.post<One<Device>>('/api/devices', body);
    await operator.patch(`/api/devices/${created.body.data.id}`, { ...body, address: '10.10.0.78' });
    await api
      .as(users.nsOwner)
      .delete(`/api/devices/${created.body.data.id}`, { query: { organizationId: demo.organizationId } });

    const events = trail();
    expect(events.map((event) => [event.action, event.actorId])).toEqual([
      ['device.enrolled', users.nsOperator.id],
      ['device.updated', users.nsOperator.id],
      ['device.deleted', users.nsOwner.id],
    ]);
    expect(events[1]!.details).toMatchObject({
      before: { address: '10.10.0.77', status: 'Pending' },
      after: { address: '10.10.0.78', status: 'Pending' },
    });
    expect(events[2]!.details).toEqual({
      before: expect.objectContaining({ id: created.body.data.id, address: '10.10.0.78' }),
    });
  });

  it('records invitations and their acceptance as membership events', async () => {
    const invite = await api
      .as(users.nsOwner)
      .post<{ inviteUrl: string; expiresAt: string }>('/api/invitations', {
        email: users.acmeViewer.email,
        organizationId: demo.organizationId,
        teamId: demo.secondTeamId,
        role: 'operator',
      });
    const token = new URL(invite.body.inviteUrl).hash.replace('#invite=', '');
    await api
      .as(users.acmeViewer)
      .post('/api/invitations/accept', { token }, { headers: { origin: allowedOrigin } });

    const invitationId = (db.prepare('SELECT id FROM invitations').get() as { id: string }).id;
    expect(trail()).toEqual([
      expect.objectContaining({
        action: 'membership.invited',
        entityType: 'membership',
        entityId: invitationId,
        actorId: users.nsOwner.id,
        details: {
          email: users.acmeViewer.email,
          teamId: demo.secondTeamId,
          role: 'operator',
          expiresAt: invite.body.expiresAt,
        },
      }),
      expect.objectContaining({
        action: 'membership.accepted',
        entityType: 'membership',
        entityId: invitationId,
        actorId: users.acmeViewer.id,
        actorEmail: users.acmeViewer.email,
        details: {
          userId: users.acmeViewer.id,
          teamId: demo.secondTeamId,
          role: 'operator',
          membershipCreated: true,
          newAccount: false,
        },
      }),
    ]);
  });

  it('records registrations through invitations with the new account as actor', async () => {
    const invite = await api.as(users.nsOwner).post<{ inviteUrl: string }>('/api/invitations', {
      email: 'newcomer@northstar.test',
      organizationId: demo.organizationId,
      teamId: demo.teamId,
      role: 'viewer',
    });
    const token = new URL(invite.body.inviteUrl).hash.replace('#invite=', '');
    const accepted = await api.anonymous.post<{ user: { id: string } }>('/api/invitations/accept', {
      token,
      displayName: 'Newcomer',
      password: 'NewcomerPassword2026!',
    });
    expect(accepted.status).toBe(200);
    const event = trail().find((candidate) => candidate.action === 'membership.accepted')!;
    expect(event.actorId).toBe(accepted.body.user.id);
    expect(event.actorEmail).toBe('newcomer@northstar.test');
    expect(event.details).toMatchObject({ membershipCreated: true, newAccount: true, role: 'viewer' });
  });

  it('does not record refused or failed attempts', async () => {
    const viewer = api.as(users.nsViewer);
    await viewer.post('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Nope',
      description: '',
    });
    await api
      .as(users.nsOwner)
      .post('/api/networks', { organizationId: demo.organizationId, name: 'Core Network', description: '' });
    await api.as(users.nsOwner).delete(`/api/areas/${demo.dataCenterAreaId}`, {
      query: { organizationId: demo.organizationId, networkId: demo.coreNetworkId },
    });
    await api.as(users.soloOwner).patch(`/api/networks/${demo.coreNetworkId}`, {
      organizationId: demo.organizationId,
      name: 'X',
      description: '',
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM audit_log').get()).toEqual({ count: 0 });
  });

  it('rolls the change back when the audit record cannot be written', async () => {
    const spy = vi.spyOn(auditRepository, 'insertAuditEvent').mockImplementationOnce(() => {
      throw new Error('audit storage unavailable');
    });
    const logLevel = api.app.log.level;
    api.app.log.level = 'silent'; // the 500 below is expected; keep the test output readable
    try {
      const response = await api
        .as(users.nsOwner)
        .post('/api/networks', { organizationId: demo.organizationId, name: 'Ghost', description: '' });
      expect(response.status).toBe(500);
      expect(response.body).toEqual({ error: 'Internal server error', requestId: expect.any(String) });
      expect(db.prepare("SELECT 1 FROM networks WHERE name = 'Ghost'").get()).toBeUndefined();
    } finally {
      spy.mockRestore();
      api.app.log.level = logLevel;
    }
  });
});

describe('audit trail: reading', () => {
  const api = useTestApp();

  it('returns newest events first, scoped to the requested organization', async () => {
    const owner = api.as(users.nsOwner);
    await owner.post('/api/networks', {
      organizationId: demo.organizationId,
      name: 'First',
      description: '',
    });
    await owner.post('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Second',
      description: '',
    });
    await api
      .as(users.acmeOwner)
      .post('/api/networks', { organizationId: acme.organizationId, name: 'Elsewhere', description: '' });

    const response = await owner.get<Trail>('/api/audit', { query: { organizationId: demo.organizationId } });
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body.data.map((event) => (event.details.after as Network).name)).toEqual([
      'Second',
      'First',
    ]);
    expect(response.body.data.every((event) => event.organizationId === demo.organizationId)).toBe(true);
  });

  it('filters by entity and honours the limit', async () => {
    const owner = api.as(users.nsOwner);
    const created = await owner.post<One<Network>>('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Filtered',
      description: '',
    });
    await owner.patch(`/api/networks/${created.body.data.id}`, {
      organizationId: demo.organizationId,
      name: 'Filtered',
      description: 'x',
    });
    await owner.post('/api/areas', {
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      name: 'Other',
      region: 'r',
    });

    const byEntity = await owner.get<Trail>('/api/audit', {
      query: { entityType: 'network', entityId: created.body.data.id },
    });
    expect(byEntity.body.data.map((event) => event.action)).toEqual(['network.updated', 'network.created']);

    const limited = await owner.get<Trail>('/api/audit', {
      query: { organizationId: demo.organizationId, limit: 1 },
    });
    expect(limited.body.data).toHaveLength(1);
    expect(limited.body.data[0]!.action).toBe('area.created');
  });

  it('is readable by owners and admins only', async () => {
    expect((await api.as(users.nsOwner).get('/api/audit')).status).toBe(200);
    expect((await api.as(users.nsAdmin).get('/api/audit')).status).toBe(200);
    expect(
      (await api.as(users.nsMultiTeam).get('/api/audit', { query: { organizationId: demo.organizationId } }))
        .status,
    ).toBe(200);
    expectError(
      await api.as(users.nsOperator).get('/api/audit', { query: { organizationId: demo.organizationId } }),
      403,
    );
    expectError(
      await api.as(users.nsViewer).get('/api/audit', { query: { organizationId: demo.organizationId } }),
      403,
    );
    expectError(await api.asService().get('/api/audit'), 401);
    expectError(await api.anonymous.get('/api/audit'), 401);
  });

  it('members without a manageable organization receive an empty trail rather than other tenants’ events', async () => {
    await api.as(users.nsOwner).post('/api/networks', {
      organizationId: demo.organizationId,
      name: 'Visible to admins',
      description: '',
    });
    const response = await api.as(users.nsViewer).get<Trail>('/api/audit');
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual([]);
  });

  it('never returns another organization’s events', async () => {
    await api
      .as(users.acmeOwner)
      .post('/api/networks', { organizationId: acme.organizationId, name: 'Acme secret', description: '' });
    expectError(
      await api.as(users.nsOwner).get('/api/audit', { query: { organizationId: acme.organizationId } }),
      403,
    );
    const unfiltered = await api.as(users.nsOwner).get<Trail>('/api/audit');
    expect(unfiltered.body.data.some((event) => event.organizationId === acme.organizationId)).toBe(false);
  });
});

describe('audit trail: immutability', () => {
  useTestApp();

  it('rejects updates and deletes at the database level', () => {
    db.prepare(
      "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('evt-1', 'org-demo', 'user-ns-owner', 'owner@northstar.test', 'network.created', 'network', 'net-core', '{}', '2026-01-01T00:00:00.000Z')",
    ).run();
    expect(() =>
      db.prepare("UPDATE audit_log SET actor_id = 'someone-else' WHERE id = 'evt-1'").run(),
    ).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'evt-1'").run()).toThrow(/immutable/);
    expect(() => db.prepare('DELETE FROM audit_log').run()).toThrow(/immutable/);
    expect(db.prepare("SELECT actor_id AS actorId FROM audit_log WHERE id = 'evt-1'").get()).toEqual({
      actorId: 'user-ns-owner',
    });
  });

  it('keeps history even when the organization is removed', () => {
    db.prepare(
      "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('evt-2', 'org-solo', 'user-solo-owner', 'owner@solo.test', 'device.deleted', 'device', 'SOLO-RTR-01', '{}', '2026-01-01T00:00:00.000Z')",
    ).run();
    expect(() => db.prepare("DELETE FROM organizations WHERE id = 'org-solo'").run()).toThrow(
      /FOREIGN KEY|immutable/,
    );
    expect(db.prepare("SELECT 1 FROM organizations WHERE id = 'org-solo'").get()).toBeDefined();
  });

  it('rejects malformed detail payloads', () => {
    expect(() =>
      db
        .prepare(
          "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('evt-3', 'org-demo', 'x', 'x', 'network.created', 'network', 'net-core', 'not json', '2026-01-01T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/CHECK/);
    expect(() =>
      db
        .prepare(
          "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('evt-4', 'org-demo', 'x', 'x', 'user.created', 'user', 'u', '{}', '2026-01-01T00:00:00.000Z')",
        )
        .run(),
    ).toThrow(/CHECK/);
  });
});

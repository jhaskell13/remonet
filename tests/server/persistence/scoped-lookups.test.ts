import { describe, expect, it } from 'vitest';
import {
  insertAuditEvent,
  listAuditEvents,
} from '../../../server/persistence/repositories/audit-repository.ts';
import {
  getDevice,
  updateArea,
  updateDeviceSnapshot,
} from '../../../server/persistence/repositories/network-repository.ts';
import {
  createOrganization,
  getOrganization,
  listOrganizations,
  updateOrganization,
} from '../../../server/persistence/repositories/organization-repository.ts';
import { createTeam, getTeam, updateTeam } from '../../../server/persistence/repositories/team-repository.ts';
import { useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;

describe('scoped lookups', () => {
  useSeededDatabase();

  it('organizations can be listed wholesale, by id, or not at all', () => {
    // Ordered by name: Acme, Jordan's Personal Network, Northstar.
    expect(listOrganizations().map((organization) => organization.id)).toEqual([
      'org-acme',
      'org-solo',
      'org-demo',
    ]);
    expect(listOrganizations([]).map((organization) => organization.id)).toEqual([]);
    expect(listOrganizations(['org-solo', 'org-missing']).map((organization) => organization.id)).toEqual([
      'org-solo',
    ]);
    expect(getOrganization('org-missing')).toBeUndefined();
    expect(createOrganization({ id: 'org-new', name: 'New' })).toEqual({ id: 'org-new', name: 'New' });
    expect(updateOrganization('org-new', 'Renamed')).toEqual({ id: 'org-new', name: 'Renamed' });
    expect(updateOrganization('org-missing', 'Renamed')).toBeUndefined();
  });

  it('team updates are scoped to the organization', () => {
    expect(createTeam({ id: 'team-new', organizationId: demo.organizationId, name: 'New' })).toEqual({
      id: 'team-new',
      organizationId: demo.organizationId,
      name: 'New',
    });
    expect(updateTeam('team-new', acme.organizationId, 'Hijacked')).toBeUndefined();
    expect(updateTeam('team-new', demo.organizationId, 'Renamed')?.name).toBe('Renamed');
    expect(getTeam('team-new', acme.organizationId)).toBeUndefined();
  });

  it('area updates are scoped to organization and network', () => {
    expect(
      updateArea(demo.dataCenterAreaId, demo.organizationId, demo.branchNetworkId, 'X', 'Y'),
    ).toBeUndefined();
    expect(
      updateArea(demo.dataCenterAreaId, acme.organizationId, demo.coreNetworkId, 'X', 'Y'),
    ).toBeUndefined();
    expect(
      updateArea(demo.dataCenterAreaId, demo.organizationId, demo.coreNetworkId, 'Renamed', 'Region'),
    ).toMatchObject({
      id: demo.dataCenterAreaId,
      name: 'Renamed',
      region: 'Region',
    });
  });

  it('device snapshot refreshes are scoped to the organization', () => {
    const snapshot = {
      status: 'Offline' as const,
      uptime: '—',
      latency: 0,
      load: 0,
      lastSeen: '2026-10-13T00:00:00.000Z',
    };
    expect(updateDeviceSnapshot(demo.coreRouterId, acme.organizationId, snapshot)).toBeUndefined();
    expect(getDevice(demo.coreRouterId, demo.organizationId)?.status).toBe('Healthy');
    expect(updateDeviceSnapshot(demo.coreRouterId, demo.organizationId, snapshot)).toMatchObject(snapshot);
  });

  it('audit events filter by entity and honour the default limit', () => {
    const base = {
      organizationId: demo.organizationId,
      actorId: users.nsOwner.id,
      actorEmail: users.nsOwner.email,
      details: {},
    };
    for (let index = 0; index < 105; index += 1) {
      insertAuditEvent({
        ...base,
        id: `evt-${index}`,
        action: 'device.updated',
        entityType: 'device',
        entityId: index % 2 ? demo.coreRouterId : demo.edgeFirewallId,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString(),
      });
    }
    insertAuditEvent({
      ...base,
      id: 'evt-area',
      action: 'area.updated',
      entityType: 'area',
      entityId: demo.coreRouterId,
      createdAt: '2026-02-01T00:00:00.000Z',
    });

    expect(listAuditEvents({ organizationIds: [demo.organizationId] })).toHaveLength(100);
    expect(listAuditEvents({ organizationIds: [demo.organizationId], limit: 500 })).toHaveLength(106);
    expect(listAuditEvents({ organizationIds: [demo.organizationId], limit: 500 })[0]?.id).toBe('evt-area');
    expect(
      listAuditEvents({ organizationIds: [demo.organizationId], entityId: demo.coreRouterId, limit: 500 }),
    ).toHaveLength(53);
    expect(
      listAuditEvents({ organizationIds: [demo.organizationId], entityType: 'area', limit: 500 }).map(
        (event) => event.id,
      ),
    ).toEqual(['evt-area']);
    expect(
      listAuditEvents({
        organizationIds: [demo.organizationId],
        entityType: 'device',
        entityId: demo.coreRouterId,
        limit: 500,
      }),
    ).toHaveLength(52);
    expect(listAuditEvents({ organizationIds: [] })).toEqual([]);
    expect(listAuditEvents({ organizationIds: [acme.organizationId] })).toEqual([]);
  });
});

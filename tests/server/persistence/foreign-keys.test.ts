import { describe, expect, it } from 'vitest';
import {
  createArea,
  createDevice,
  createNetwork,
  updateDevice,
} from '../../../server/persistence/repositories/network-repository.ts';
import { saveSession } from '../../../server/persistence/repositories/session-repository.ts';
import { count, sqliteErrorCode, useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme, solo } = fixtures;
const FOREIGN_KEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

describe('foreign-key relationships', () => {
  const db = useSeededDatabase();

  it('networks must belong to an existing organization', () => {
    expect(
      sqliteErrorCode(() =>
        createNetwork({ id: 'net-x', organizationId: 'org-missing', name: 'X', description: '' }),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('areas must reference a network that belongs to the same organization', () => {
    const attempt = (organizationId: string, networkId: string) =>
      sqliteErrorCode(() =>
        createArea({
          id: `area-${organizationId}-${networkId}`,
          organizationId,
          networkId,
          name: 'X',
          region: 'R',
        }),
      );
    expect(attempt(demo.organizationId, acme.networkId), 'network of another organization').toBe(FOREIGN_KEY);
    expect(attempt(acme.organizationId, demo.coreNetworkId), 'organization of another network').toBe(
      FOREIGN_KEY,
    );
    expect(attempt(demo.organizationId, 'net-missing')).toBe(FOREIGN_KEY);
    expect(attempt(demo.organizationId, demo.coreNetworkId)).toBeUndefined();
  });

  it('devices must reference an area that belongs to the stated network and organization', () => {
    const attempt = (organizationId: string, networkId: string, areaId: string) =>
      sqliteErrorCode(() =>
        createDevice({
          id: `dev-${areaId}-${networkId}`,
          organizationId,
          networkId,
          areaId,
          name: 'D',
          type: 'Switch',
          address: '10.0.0.1',
        }),
      );
    expect(
      attempt(demo.organizationId, demo.coreNetworkId, demo.westWarehouseAreaId),
      'area of another network',
    ).toBe(FOREIGN_KEY);
    expect(
      attempt(demo.organizationId, demo.coreNetworkId, acme.plantAreaId),
      'area of another organization',
    ).toBe(FOREIGN_KEY);
    expect(
      attempt(demo.organizationId, acme.networkId, acme.plantAreaId),
      'network of another organization',
    ).toBe(FOREIGN_KEY);
    expect(attempt(demo.organizationId, demo.coreNetworkId, 'area-missing')).toBe(FOREIGN_KEY);
    expect(attempt(demo.organizationId, demo.coreNetworkId, demo.dataCenterAreaId)).toBeUndefined();
  });

  it('a device cannot be re-pointed at an area outside its network', () => {
    const base = {
      id: demo.coreRouterId,
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      name: 'Core Router 01',
      type: 'Router' as const,
      address: '10.20.0.1',
    };
    // The repository guards with an EXISTS check, so the update is a no-op rather than an FK error.
    expect(updateDevice({ ...base, areaId: demo.westWarehouseAreaId })).toBeUndefined();
    expect(updateDevice({ ...base, areaId: solo.labAreaId })).toBeUndefined();
    expect(db.prepare('SELECT area_id AS areaId FROM devices WHERE id = ?').get(demo.coreRouterId)).toEqual({
      areaId: demo.northCampusAreaId,
    });
    // Bypassing the repository still fails at the schema level.
    expect(
      sqliteErrorCode(() =>
        db
          .prepare('UPDATE devices SET area_id = ? WHERE id = ?')
          .run(demo.westWarehouseAreaId, demo.coreRouterId),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('an area cannot be re-pointed at a network of another organization', () => {
    expect(
      sqliteErrorCode(() =>
        db.prepare('UPDATE areas SET network_id = ? WHERE id = ?').run(acme.networkId, demo.dataCenterAreaId),
      ),
    ).toBe(FOREIGN_KEY);
    expect(
      sqliteErrorCode(() =>
        db
          .prepare('UPDATE areas SET organization_id = ? WHERE id = ?')
          .run(acme.organizationId, demo.dataCenterAreaId),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('a network cannot change organization while it has areas or devices', () => {
    expect(
      sqliteErrorCode(() =>
        db
          .prepare('UPDATE networks SET organization_id = ? WHERE id = ?')
          .run(acme.organizationId, demo.coreNetworkId),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('memberships need an existing user and team', () => {
    const insert = (userId: string, teamId: string) =>
      sqliteErrorCode(() =>
        db
          .prepare(
            "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, 'viewer', 'now')",
          )
          .run(userId, teamId),
      );
    expect(insert('user-missing', demo.teamId)).toBe(FOREIGN_KEY);
    expect(insert(users.nsOwner.id, 'team-missing')).toBe(FOREIGN_KEY);
  });

  it('teams must belong to an existing organization', () => {
    expect(
      sqliteErrorCode(() =>
        db.prepare("INSERT INTO teams (id, organization_id, name) VALUES ('t', 'org-missing', 'T')").run(),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('invitations must reference a team of the stated organization and a real inviter', () => {
    const insert = (organizationId: string, teamId: string, invitedBy: string) =>
      sqliteErrorCode(() =>
        db
          .prepare(
            "INSERT INTO invitations (id, email, organization_id, team_id, role, token_hash, invited_by, created_at, expires_at) VALUES (?, 'x@x.test', ?, ?, 'viewer', ?, ?, 'now', '2099-01-01T00:00:00.000Z')",
          )
          .run(
            `inv-${teamId}-${invitedBy}`,
            organizationId,
            teamId,
            `hash-${teamId}-${invitedBy}`,
            invitedBy,
          ),
      );
    expect(insert(demo.organizationId, acme.teamId, users.nsOwner.id), 'team of another organization').toBe(
      FOREIGN_KEY,
    );
    expect(insert(demo.organizationId, demo.teamId, 'user-missing'), 'unknown inviter').toBe(FOREIGN_KEY);
    expect(insert(demo.organizationId, demo.teamId, users.nsOwner.id)).toBeUndefined();
  });

  it('sessions need an existing user', () => {
    expect(sqliteErrorCode(() => saveSession('h', 'user-missing', '2099-01-01T00:00:00.000Z'))).toBe(
      FOREIGN_KEY,
    );
  });

  it('audit events need an existing organization', () => {
    expect(
      sqliteErrorCode(() =>
        db
          .prepare(
            "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('e', 'org-missing', 'a', 'a@x.test', 'network.created', 'network', 'n', '{}', 'now')",
          )
          .run(),
      ),
    ).toBe(FOREIGN_KEY);
  });

  it('the seeded graph satisfies every constraint', () => {
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(count('organizations')).toBe(3);
    expect(count('networks')).toBe(4);
    expect(count('areas')).toBe(7);
    expect(count('devices')).toBe(10);
    expect(count('teams')).toBe(4);
    expect(count('users')).toBe(Object.keys(users).length);
  });
});

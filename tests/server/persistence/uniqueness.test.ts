import { describe, expect, it } from 'vitest';
import { createInvitation } from '../../../server/persistence/repositories/invitation-repository.ts';
import {
  createArea,
  createDevice,
  createNetwork,
  updateArea,
  updateDevice,
  updateNetwork,
} from '../../../server/persistence/repositories/network-repository.ts';
import { saveSession } from '../../../server/persistence/repositories/session-repository.ts';
import { createUser } from '../../../server/persistence/repositories/user-repository.ts';
import { sqliteErrorCode, useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
const UNIQUE = 'SQLITE_CONSTRAINT_UNIQUE';
const PRIMARY_KEY = 'SQLITE_CONSTRAINT_PRIMARYKEY';

describe('uniqueness constraints', () => {
  const db = useSeededDatabase();

  describe('networks', () => {
    it('names are unique per organization regardless of case', () => {
      const attempt = (name: string, organizationId: string = demo.organizationId) =>
        sqliteErrorCode(() => createNetwork({ id: `net-${name}`, organizationId, name, description: '' }));
      expect(attempt('Core Network')).toBe(UNIQUE);
      expect(attempt('CORE network')).toBe(UNIQUE);
      expect(attempt('Core Network', acme.organizationId)).toBeUndefined();
      expect(attempt('Core Network 2')).toBeUndefined();
    });

    it('renaming onto an existing name is refused', () => {
      expect(
        sqliteErrorCode(() =>
          updateNetwork(demo.branchNetworkId, [demo.organizationId], {
            organizationId: demo.organizationId,
            name: 'core network',
            description: '',
          }),
        ),
      ).toBe(UNIQUE);
      expect(db.prepare('SELECT name FROM networks WHERE id = ?').get(demo.branchNetworkId)).toEqual({
        name: 'Branch Network',
      });
    });

    it('ids are globally unique', () => {
      expect(
        sqliteErrorCode(() =>
          createNetwork({
            id: demo.coreNetworkId,
            organizationId: acme.organizationId,
            name: 'Dup',
            description: '',
          }),
        ),
      ).toBe(PRIMARY_KEY);
    });
  });

  describe('areas', () => {
    it('names are unique per network regardless of case, and may repeat across networks', () => {
      const attempt = (name: string, networkId: string = demo.coreNetworkId) =>
        sqliteErrorCode(() =>
          createArea({
            id: `area-${name}-${networkId}`,
            organizationId: demo.organizationId,
            networkId,
            name,
            region: 'R',
          }),
        );
      expect(attempt('Data Center')).toBe(UNIQUE);
      expect(attempt('data CENTER')).toBe(UNIQUE);
      expect(attempt('Data Center', demo.branchNetworkId)).toBeUndefined();
    });

    it('renaming onto an existing name in the same network is refused', () => {
      expect(
        sqliteErrorCode(() =>
          updateArea(demo.northCampusAreaId, demo.organizationId, demo.coreNetworkId, 'DATA CENTER', 'R'),
        ),
      ).toBe(UNIQUE);
    });
  });

  describe('devices', () => {
    const device = (
      address: string,
      networkId: string = demo.coreNetworkId,
      areaId: string = demo.dataCenterAreaId,
    ) => ({
      id: `dev-${address}-${networkId}`,
      organizationId: demo.organizationId,
      networkId,
      areaId,
      name: 'D',
      type: 'Router' as const,
      address,
    });

    it('management addresses are unique per network regardless of case', () => {
      expect(sqliteErrorCode(() => createDevice(device('10.10.0.2')))).toBe(UNIQUE);
      createDevice(device('Core-GW.Example.NET'));
      expect(sqliteErrorCode(() => createDevice(device('core-gw.example.net')))).toBe(UNIQUE);
      expect(
        sqliteErrorCode(() =>
          createDevice(device('10.10.0.2', demo.branchNetworkId, demo.westWarehouseAreaId)),
        ),
      ).toBeUndefined();
    });

    it('re-addressing onto an address used elsewhere in the network is refused', () => {
      expect(
        sqliteErrorCode(() =>
          updateDevice({
            id: demo.coreRouterId,
            organizationId: demo.organizationId,
            networkId: demo.coreNetworkId,
            areaId: demo.northCampusAreaId,
            name: 'Core Router 01',
            type: 'Router',
            address: '10.10.0.2',
          }),
        ),
      ).toBe(UNIQUE);
      expect(db.prepare('SELECT address FROM devices WHERE id = ?').get(demo.coreRouterId)).toEqual({
        address: '10.20.0.1',
      });
    });

    it('names may repeat', () => {
      expect(
        sqliteErrorCode(() => createDevice({ ...device('10.10.9.1'), name: 'Core Router 01' })),
      ).toBeUndefined();
    });
  });

  describe('accounts and teams', () => {
    it('emails are unique regardless of case', () => {
      expect(
        sqliteErrorCode(() =>
          createUser({
            id: 'dup',
            email: users.nsOwner.email.toUpperCase(),
            displayName: 'Dup',
            passwordHash: 'h',
          }),
        ),
      ).toBe(UNIQUE);
      expect(
        db
          .prepare('SELECT COUNT(*) AS count FROM users WHERE email = ? COLLATE NOCASE')
          .get(users.nsOwner.email),
      ).toEqual({ count: 1 });
    });

    it('stores emails lower-cased so lookups are canonical', () => {
      createUser({ id: 'mixed', email: 'Mixed.Case@Example.TEST', displayName: 'Mixed', passwordHash: 'h' });
      expect(db.prepare("SELECT email FROM users WHERE id = 'mixed'").get()).toEqual({
        email: 'mixed.case@example.test',
      });
    });

    it('team names are unique per organization regardless of case', () => {
      expect(
        sqliteErrorCode(() =>
          db
            .prepare(
              "INSERT INTO teams (id, organization_id, name) VALUES ('t-dup', 'org-demo', 'Network Operations')",
            )
            .run(),
        ),
      ).toBe(UNIQUE);
      expect(
        sqliteErrorCode(() =>
          db
            .prepare(
              "INSERT INTO teams (id, organization_id, name) VALUES ('t-dup2', 'org-demo', 'NETWORK operations')",
            )
            .run(),
        ),
      ).toBe(UNIQUE);
      expect(
        sqliteErrorCode(() =>
          db
            .prepare(
              "INSERT INTO teams (id, organization_id, name) VALUES ('t-ok', 'org-acme', 'Network Operations')",
            )
            .run(),
        ),
      ).toBeUndefined();
    });

    it('an engineer holds at most one membership per team', () => {
      expect(
        sqliteErrorCode(() =>
          db
            .prepare(
              "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, 'team-northstar', 'viewer', 'now')",
            )
            .run(users.nsOwner.id),
        ),
      ).toBe(PRIMARY_KEY);
      expect(
        db
          .prepare('SELECT role FROM team_memberships WHERE user_id = ? AND team_id = ?')
          .get(users.nsOwner.id, 'team-northstar'),
      ).toEqual({ role: 'owner' });
    });

    it('membership roles are restricted to the four known roles', () => {
      expect(
        sqliteErrorCode(() =>
          db
            .prepare(
              "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, 'team-northstar-field', 'superuser', 'now')",
            )
            .run(users.nsOwner.id),
        ),
      ).toBe('SQLITE_CONSTRAINT_CHECK');
    });
  });

  describe('tokens', () => {
    it('invitation token hashes are unique', () => {
      const invite = (id: string) =>
        createInvitation({
          id,
          email: 'x@northstar.test',
          organizationId: demo.organizationId,
          teamId: demo.teamId,
          role: 'viewer',
          tokenHash: 'same-hash',
          invitedBy: users.nsOwner.id,
          expiresAt: '2099-01-01T00:00:00.000Z',
        });
      invite('inv-1');
      expect(sqliteErrorCode(() => invite('inv-2'))).toBe(UNIQUE);
    });

    it('invitation roles never include owner', () => {
      expect(
        sqliteErrorCode(() =>
          db
            .prepare(
              "INSERT INTO invitations (id, email, organization_id, team_id, role, token_hash, invited_by, created_at, expires_at) VALUES ('inv-o', 'x@northstar.test', 'org-demo', 'team-northstar', 'owner', 'h', ?, 'now', '2099-01-01T00:00:00.000Z')",
            )
            .run(users.nsOwner.id),
        ),
      ).toBe('SQLITE_CONSTRAINT_CHECK');
    });

    it('session token hashes are unique', () => {
      saveSession('hash-1', users.nsOwner.id, '2099-01-01T00:00:00.000Z');
      expect(sqliteErrorCode(() => saveSession('hash-1', users.nsAdmin.id, '2099-01-01T00:00:00.000Z'))).toBe(
        PRIMARY_KEY,
      );
      expect(db.prepare("SELECT user_id AS userId FROM sessions WHERE token_hash = 'hash-1'").get()).toEqual({
        userId: users.nsOwner.id,
      });
    });
  });
});

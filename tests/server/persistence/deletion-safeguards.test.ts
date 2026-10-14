import { describe, expect, it } from 'vitest';
import {
  deleteAreaIfEmpty,
  deleteDevice,
  getArea,
  getDevice,
  getNetwork,
  updateNetwork,
} from '../../../server/persistence/repositories/network-repository.ts';
import {
  countOtherActiveOwners,
  getOrganizationRole,
  removeMembership,
} from '../../../server/persistence/repositories/membership-repository.ts';
import { deleteTeamIfEmpty, getTeam } from '../../../server/persistence/repositories/team-repository.ts';
import {
  deleteSession,
  findSessionUser,
  saveSession,
} from '../../../server/persistence/repositories/session-repository.ts';
import { count, sqliteErrorCode, useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme, solo } = fixtures;

describe('deletion safeguards', () => {
  const db = useSeededDatabase();

  describe('areas', () => {
    it('deletes only when the area has no devices', () => {
      expect(deleteAreaIfEmpty(demo.dataCenterAreaId, demo.organizationId, demo.coreNetworkId)).toBe(0);
      expect(getArea(demo.dataCenterAreaId, demo.organizationId, demo.coreNetworkId)).toBeDefined();
      expect(count('devices', 'WHERE area_id = ?', demo.dataCenterAreaId)).toBe(2);

      db.prepare('DELETE FROM devices WHERE area_id = ?').run(demo.dataCenterAreaId);
      expect(deleteAreaIfEmpty(demo.dataCenterAreaId, demo.organizationId, demo.coreNetworkId)).toBe(1);
      expect(getArea(demo.dataCenterAreaId, demo.organizationId, demo.coreNetworkId)).toBeUndefined();
    });

    it('requires the organization and network to match', () => {
      db.prepare('DELETE FROM devices WHERE area_id = ?').run(demo.dataCenterAreaId);
      expect(deleteAreaIfEmpty(demo.dataCenterAreaId, acme.organizationId, demo.coreNetworkId)).toBe(0);
      expect(deleteAreaIfEmpty(demo.dataCenterAreaId, demo.organizationId, demo.branchNetworkId)).toBe(0);
      expect(getArea(demo.dataCenterAreaId, demo.organizationId, demo.coreNetworkId)).toBeDefined();
    });
  });

  describe('devices', () => {
    it('deletes only within the stated organization', () => {
      expect(deleteDevice(demo.coreRouterId, acme.organizationId)).toBe(0);
      expect(deleteDevice(demo.coreRouterId, solo.organizationId)).toBe(0);
      expect(getDevice(demo.coreRouterId, demo.organizationId)).toBeDefined();
      expect(deleteDevice(demo.coreRouterId, demo.organizationId)).toBe(1);
      expect(getDevice(demo.coreRouterId, demo.organizationId)).toBeUndefined();
      expect(deleteDevice(demo.coreRouterId, demo.organizationId)).toBe(0);
    });

    it('lookups are organization-scoped', () => {
      expect(getDevice(demo.coreRouterId, acme.organizationId)).toBeUndefined();
      expect(getNetwork(demo.coreNetworkId, [acme.organizationId, solo.organizationId])).toBeUndefined();
      expect(getNetwork(demo.coreNetworkId, [])).toBeUndefined();
      expect(getArea(demo.dataCenterAreaId, demo.organizationId, demo.branchNetworkId)).toBeUndefined();
    });
  });

  describe('networks', () => {
    it('updates only within the stated organizations', () => {
      expect(
        updateNetwork(demo.coreNetworkId, [acme.organizationId], {
          organizationId: acme.organizationId,
          name: 'Hijack',
          description: '',
        }),
      ).toBeUndefined();
      expect(
        updateNetwork(demo.coreNetworkId, [], {
          organizationId: demo.organizationId,
          name: 'Hijack',
          description: '',
        }),
      ).toBeUndefined();
      expect(getNetwork(demo.coreNetworkId, [demo.organizationId])?.name).toBe('Core Network');
    });

    it('removing a network cascades to its areas and devices but nothing else', () => {
      const before = { areas: count('areas'), devices: count('devices'), networks: count('networks') };
      db.prepare('DELETE FROM networks WHERE id = ?').run(demo.coreNetworkId);
      expect(count('networks')).toBe(before.networks - 1);
      expect(count('areas')).toBe(before.areas - 2);
      expect(count('devices')).toBe(before.devices - 4);
      expect(count('areas', 'WHERE organization_id = ?', demo.organizationId)).toBe(2);
      expect(count('devices', 'WHERE organization_id = ?', acme.organizationId)).toBe(2);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    });
  });

  describe('teams', () => {
    it('deletes only when nobody belongs to the team', () => {
      expect(count('team_memberships', 'WHERE team_id = ?', demo.secondTeamId)).toBe(1);
      expect(deleteTeamIfEmpty(demo.secondTeamId, demo.organizationId)).toBe(0);
      expect(getTeam(demo.secondTeamId, demo.organizationId)).toBeDefined();
      removeMembership(users.nsMultiTeam.id, demo.secondTeamId);
      expect(deleteTeamIfEmpty(demo.secondTeamId, demo.organizationId)).toBe(1);
      expect(getTeam(demo.secondTeamId, demo.organizationId)).toBeUndefined();
    });

    it('requires the organization to match', () => {
      db.prepare(
        "INSERT INTO teams (id, organization_id, name) VALUES ('team-empty', 'org-acme', 'Empty')",
      ).run();
      expect(deleteTeamIfEmpty('team-empty', demo.organizationId)).toBe(0);
      expect(getTeam('team-empty', demo.organizationId)).toBeUndefined();
      expect(getTeam('team-empty', acme.organizationId)).toBeDefined();
    });
  });

  describe('ownership', () => {
    it('counts the active owners that would remain without a given membership', () => {
      // org-demo has two owner memberships: the owner and a deactivated former owner.
      expect(
        countOtherActiveOwners(demo.organizationId, { userId: users.nsOwner.id, teamId: demo.teamId }),
      ).toBe(0);
      expect(
        countOtherActiveOwners(demo.organizationId, { userId: users.nsInactive.id, teamId: demo.teamId }),
      ).toBe(1);
      db.prepare(
        "INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, 'owner', 'now')",
      ).run(users.nsOwner.id, demo.secondTeamId);
      expect(
        countOtherActiveOwners(demo.organizationId, { userId: users.nsOwner.id, teamId: demo.teamId }),
      ).toBe(1);
      db.prepare("UPDATE team_memberships SET role = 'owner' WHERE user_id = ? AND team_id = ?").run(
        users.nsAdmin.id,
        demo.teamId,
      );
      expect(
        countOtherActiveOwners(demo.organizationId, { userId: users.nsOwner.id, teamId: demo.teamId }),
      ).toBe(2);
      expect(
        countOtherActiveOwners(acme.organizationId, { userId: users.nsOwner.id, teamId: demo.teamId }),
      ).toBe(1);
    });

    it('derives the organization role from the highest team membership', () => {
      expect(getOrganizationRole(users.nsMultiTeam.id, demo.organizationId)).toBe('admin');
      expect(getOrganizationRole(users.multiOrg.id, acme.organizationId)).toBe('operator');
      expect(getOrganizationRole(users.soloOwner.id, demo.organizationId)).toBeUndefined();
      expect(getOrganizationRole('user-missing', demo.organizationId)).toBeUndefined();
    });
  });

  describe('organizations and teams', () => {
    it('removing a team removes memberships and pending invitations but keeps the accounts', () => {
      db.prepare(
        "INSERT INTO invitations (id, email, organization_id, team_id, role, token_hash, invited_by, created_at, expires_at) VALUES ('inv', 'x@northstar.test', 'org-demo', 'team-northstar', 'viewer', 'h', ?, 'now', '2099-01-01T00:00:00.000Z')",
      ).run(users.nsOwner.id);
      const usersBefore = count('users');
      db.prepare('DELETE FROM teams WHERE id = ?').run(demo.teamId);
      expect(count('team_memberships', 'WHERE team_id = ?', demo.teamId)).toBe(0);
      expect(count('invitations')).toBe(0);
      expect(count('users')).toBe(usersBefore);
      // Members keep other memberships: the field lead still has the Field Engineering team.
      expect(count('team_memberships', 'WHERE user_id = ?', users.nsMultiTeam.id)).toBe(1);
    });

    it('removing an organization cascades through its inventory and teams', () => {
      db.prepare('DELETE FROM organizations WHERE id = ?').run(solo.organizationId);
      expect(count('networks', 'WHERE organization_id = ?', solo.organizationId)).toBe(0);
      expect(count('areas', 'WHERE organization_id = ?', solo.organizationId)).toBe(0);
      expect(count('devices', 'WHERE organization_id = ?', solo.organizationId)).toBe(0);
      expect(count('teams', 'WHERE organization_id = ?', solo.organizationId)).toBe(0);
      expect(count('team_memberships', 'WHERE user_id = ?', users.soloOwner.id)).toBe(0);
      expect(count('users', 'WHERE id = ?', users.soloOwner.id)).toBe(1);
      expect(db.pragma('foreign_key_check')).toEqual([]);
    });

    it('an organization with audit history cannot be removed', () => {
      db.prepare(
        "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('e', ?, ?, ?, 'network.created', 'network', 'net-solo', '{}', 'now')",
      ).run(solo.organizationId, users.soloOwner.id, users.soloOwner.email);
      expect(
        sqliteErrorCode(() => db.prepare('DELETE FROM organizations WHERE id = ?').run(solo.organizationId)),
      ).toBe('SQLITE_CONSTRAINT_FOREIGNKEY');
      expect(count('organizations', 'WHERE id = ?', solo.organizationId)).toBe(1);
      expect(count('networks', 'WHERE organization_id = ?', solo.organizationId)).toBe(1);
    });
  });

  describe('accounts', () => {
    it('removing an account revokes its sessions and memberships', () => {
      saveSession('session-hash', users.nsViewer.id, '2099-01-01T00:00:00.000Z');
      expect(findSessionUser('session-hash')?.id).toBe(users.nsViewer.id);
      db.prepare('DELETE FROM users WHERE id = ?').run(users.nsViewer.id);
      expect(findSessionUser('session-hash')).toBeNull();
      expect(count('sessions', 'WHERE token_hash = ?', 'session-hash')).toBe(0);
      expect(count('team_memberships', 'WHERE user_id = ?', users.nsViewer.id)).toBe(0);
    });

    it('an account that issued invitations cannot be removed while they exist', () => {
      db.prepare(
        "INSERT INTO invitations (id, email, organization_id, team_id, role, token_hash, invited_by, created_at, expires_at) VALUES ('inv', 'x@northstar.test', 'org-demo', 'team-northstar', 'viewer', 'h', ?, 'now', '2099-01-01T00:00:00.000Z')",
      ).run(users.nsOwner.id);
      expect(sqliteErrorCode(() => db.prepare('DELETE FROM users WHERE id = ?').run(users.nsOwner.id))).toBe(
        'SQLITE_CONSTRAINT_FOREIGNKEY',
      );
      expect(count('users', 'WHERE id = ?', users.nsOwner.id)).toBe(1);
    });

    it('deactivating an account keeps its data but disables sessions and memberships', () => {
      saveSession('session-hash', users.nsAdmin.id, '2099-01-01T00:00:00.000Z');
      db.prepare('UPDATE users SET is_active = 0 WHERE id = ?').run(users.nsAdmin.id);
      expect(findSessionUser('session-hash')).toBeNull();
      expect(count('team_memberships', 'WHERE user_id = ?', users.nsAdmin.id)).toBe(1);
    });

    it('session deletion is exact', () => {
      saveSession('keep', users.nsAdmin.id, '2099-01-01T00:00:00.000Z');
      saveSession('drop', users.nsAdmin.id, '2099-01-01T00:00:00.000Z');
      deleteSession('drop');
      expect(findSessionUser('drop')).toBeNull();
      expect(findSessionUser('keep')?.id).toBe(users.nsAdmin.id);
    });
  });

  describe('audit log', () => {
    it('entries cannot be altered or removed, even by cascade', () => {
      db.prepare(
        "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('e', 'org-demo', 'u', 'u@x.test', 'device.deleted', 'device', 'RTR-001', '{\"before\":{}}', 'now')",
      ).run();
      expect(() => db.prepare("UPDATE audit_log SET details = '{}' WHERE id = 'e'").run()).toThrow(
        /immutable/,
      );
      expect(() => db.prepare("DELETE FROM audit_log WHERE id = 'e'").run()).toThrow(/immutable/);
      // Removing the device the event describes is fine: the event is a historical snapshot.
      db.prepare("DELETE FROM devices WHERE id = 'RTR-001'").run();
      expect(count('audit_log')).toBe(1);
    });
  });
});

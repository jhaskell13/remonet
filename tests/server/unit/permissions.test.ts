import { describe, expect, it } from 'vitest';
import type { AccessRole } from '../../../shared/network.ts';
import {
  accessRoles,
  assignableRoles,
  canActOnRole,
  hasPermission,
  invitableRoles,
  permissionMatrix,
  roleRank,
  type Permission,
} from '../../../shared/permissions.ts';

// This table is the documented contract (see README "Permission matrix"). A change here is a
// deliberate change to who can do what, and must be reflected in the documentation.
const documentedMatrix: Record<Permission, Record<AccessRole, boolean>> = {
  'inventory.read': { owner: true, admin: true, operator: true, viewer: true },
  'teams.read': { owner: true, admin: true, operator: true, viewer: true },
  'members.read': { owner: true, admin: true, operator: true, viewer: true },
  'device.enroll': { owner: true, admin: true, operator: true, viewer: false },
  'device.delete': { owner: true, admin: true, operator: false, viewer: false },
  'network.manage': { owner: true, admin: true, operator: false, viewer: false },
  'audit.read': { owner: true, admin: true, operator: false, viewer: false },
  'team.manage': { owner: true, admin: true, operator: false, viewer: false },
  'members.manage': { owner: true, admin: true, operator: false, viewer: false },
  'organization.update': { owner: true, admin: false, operator: false, viewer: false },
  'team.delete': { owner: true, admin: false, operator: false, viewer: false },
};

describe('permission matrix', () => {
  it('matches the documented contract exactly', () => {
    const actual = Object.fromEntries(
      (Object.keys(permissionMatrix) as Permission[]).map((permission) => [
        permission,
        Object.fromEntries(accessRoles.map((role) => [role, hasPermission(role, permission)])),
      ]),
    );
    expect(actual).toEqual(documentedMatrix);
  });

  it('is monotonic: a higher role never loses a permission a lower role has', () => {
    const ordered = [...accessRoles].sort((a, b) => roleRank[a] - roleRank[b]);
    for (const permission of Object.keys(permissionMatrix) as Permission[]) {
      for (let index = 1; index < ordered.length; index += 1) {
        if (hasPermission(ordered[index - 1], permission))
          expect(hasPermission(ordered[index], permission), `${permission} for ${ordered[index]}`).toBe(true);
      }
    }
  });

  it('denies everything to a missing role', () => {
    for (const permission of Object.keys(permissionMatrix) as Permission[])
      expect(hasPermission(undefined, permission)).toBe(false);
  });

  it('owners manage every role, admins manage operators and viewers, others manage nobody', () => {
    expect(assignableRoles('owner')).toEqual(['owner', 'admin', 'operator', 'viewer']);
    expect(assignableRoles('admin')).toEqual(['operator', 'viewer']);
    expect(assignableRoles('operator')).toEqual([]);
    expect(assignableRoles('viewer')).toEqual([]);
    expect(assignableRoles(undefined)).toEqual([]);
    expect(canActOnRole('admin', 'admin')).toBe(false);
    expect(canActOnRole('admin', 'owner')).toBe(false);
    expect(canActOnRole('admin', 'operator')).toBe(true);
    expect(canActOnRole('owner', 'owner')).toBe(true);
  });

  it('ownership is never granted through an invitation link', () => {
    expect(invitableRoles).toEqual(['admin', 'operator', 'viewer']);
    expect(invitableRoles).not.toContain('owner');
  });
});

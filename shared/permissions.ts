import type { AccessRole } from './network.ts';

/**
 * The permission matrix for organization roles. The API enforces it in services and the UI uses it
 * to show or hide controls; both sides must read from this module rather than restating the rules.
 *
 * Roles are ordered: owner > admin > operator > viewer. An engineer's role in an organization is the
 * highest role across all of their team memberships in that organization.
 */
export const accessRoles = ['owner', 'admin', 'operator', 'viewer'] as const satisfies readonly AccessRole[];

export const roleRank: Record<AccessRole, number> = { owner: 4, admin: 3, operator: 2, viewer: 1 };

export type Permission =
  | 'inventory.read'
  | 'teams.read'
  | 'members.read'
  | 'device.enroll'
  | 'device.delete'
  | 'network.manage'
  | 'audit.read'
  | 'organization.update'
  | 'team.manage'
  | 'team.delete'
  | 'members.manage';

const everyone: AccessRole[] = ['owner', 'admin', 'operator', 'viewer'];
const operators: AccessRole[] = ['owner', 'admin', 'operator'];
const administrators: AccessRole[] = ['owner', 'admin'];
const owners: AccessRole[] = ['owner'];

export const permissionMatrix: Record<Permission, readonly AccessRole[]> = {
  /** Networks, areas, devices, and overview. */
  'inventory.read': everyone,
  /** Teams of the organization. */
  'teams.read': everyone,
  /** The member roster with team memberships and roles. */
  'members.read': everyone,
  /** Enroll devices and edit their metadata or area. */
  'device.enroll': operators,
  /** Remove devices. */
  'device.delete': administrators,
  /** Create, rename, and delete networks and areas. */
  'network.manage': administrators,
  /** Read the audit trail. */
  'audit.read': administrators,
  /** Rename the organization. */
  'organization.update': owners,
  /** Create and rename teams. */
  'team.manage': administrators,
  /** Delete empty teams. */
  'team.delete': owners,
  /** Invite people, add members to teams, change roles, and remove members, subject to `assignableRoles`. */
  'members.manage': administrators,
};

export function hasPermission(role: AccessRole | undefined, permission: Permission) {
  return role !== undefined && permissionMatrix[permission].includes(role);
}

/**
 * Roles an actor may grant, invite for, or act upon. Owners manage every role, including adding
 * co-owners; admins manage only operators and viewers; nobody else manages memberships.
 */
export function assignableRoles(actorRole: AccessRole | undefined): readonly AccessRole[] {
  if (actorRole === 'owner') return accessRoles;
  if (actorRole === 'admin') return ['operator', 'viewer'];
  return [];
}

/** Whether an actor may change or remove a membership that currently holds `targetRole`. */
export function canActOnRole(actorRole: AccessRole | undefined, targetRole: AccessRole) {
  return assignableRoles(actorRole).includes(targetRole);
}

/** Roles that can be carried by an invitation link. Ownership is granted explicitly after joining. */
export const invitableRoles = ['admin', 'operator', 'viewer'] as const satisfies readonly AccessRole[];

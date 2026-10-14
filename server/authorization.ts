import type { AccessRole } from '../shared/network.ts';
import { hasPermission, type Permission } from '../shared/permissions.ts';
import type { Principal } from './auth.ts';
import { AppError } from './http/app-error.ts';

/** Permissions the read-only integration token may exercise. Everything else needs an engineer. */
const serviceTokenPermissions: readonly Permission[] = ['inventory.read', 'teams.read'];

const requirementMessages: Record<Permission, string> = {
  'inventory.read': 'Organization access denied',
  'teams.read': 'Organization access denied',
  'members.read': 'Organization access denied',
  'device.enroll': 'Organization operator access required',
  'device.delete': 'Organization admin access required',
  'network.manage': 'Organization admin access required',
  'audit.read': 'Organization admin access required',
  'organization.update': 'Organization owner access required',
  'team.manage': 'Organization admin access required',
  'team.delete': 'Organization owner access required',
  'members.manage': 'Organization admin access required',
};

/** The principal's effective role in an organization, or undefined when they are not a member. */
export function organizationRole(principal: Principal, organizationId: string): AccessRole | undefined {
  return principal.organizations.find((organization) => organization.id === organizationId)?.role;
}

/**
 * Enforces the permission matrix for one organization and returns the principal's role there.
 * Non-members and unknown organizations are refused identically so ids cannot be probed.
 */
export function requirePermission(principal: Principal, organizationId: string, permission: Permission) {
  if (principal.serviceToken && !serviceTokenPermissions.includes(permission))
    throw new AppError(403, 'Engineer account required');
  const role = organizationRole(principal, organizationId);
  if (!role) throw new AppError(403, 'Organization access denied');
  if (!hasPermission(role, permission)) throw new AppError(403, requirementMessages[permission]);
  return role;
}

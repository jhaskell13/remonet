import { randomUUID } from 'node:crypto';
import type { AccessRole } from '../../../shared/network.ts';
import { assignableRoles, canActOnRole } from '../../../shared/permissions.ts';
import type { Principal } from '../../auth.ts';
import { organizationRole, requirePermission } from '../../authorization.ts';
import { AppError } from '../../http/app-error.ts';
import { db } from '../../persistence/database.ts';
import {
  addMembership,
  countOtherActiveOwners,
  createTeam,
  deleteTeamIfEmpty,
  getMembership,
  getOrganizationRole,
  getTeam,
  getUserById,
  listOrganizationMembers,
  removeMembership,
  updateMembershipRole,
  updateTeam,
} from '../../store.ts';
import { recordAudit } from '../audit/audit.service.ts';

export type TeamInput = { organizationId: string; name: string };
export type AddMemberInput = { organizationId: string; userId: string; role: AccessRole };
export type ChangeRoleInput = { organizationId: string; role: AccessRole };

const lastOwnerMessage = 'An organization must keep at least one owner. Promote another owner first.';

function isUniqueConstraint(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'SQLITE_CONSTRAINT_UNIQUE'
  );
}
function cleanTeamInput(input: TeamInput) {
  const name = input.name.trim();
  if (!name) throw new AppError(400, 'Team name is required');
  return { organizationId: input.organizationId, name };
}
function requireTeam(id: string, organizationId: string) {
  const team = getTeam(id, organizationId);
  if (!team) throw new AppError(404, 'Team not found');
  return team;
}
function memberOf(organizationId: string, userId: string) {
  const member = listOrganizationMembers(organizationId).find((candidate) => candidate.userId === userId);
  if (!member) throw new AppError(500, 'Member could not be loaded');
  return member;
}

export function createTeamFor(principal: Principal, input: TeamInput) {
  requirePermission(principal, input.organizationId, 'team.manage');
  const cleanInput = cleanTeamInput(input);
  try {
    return db.transaction(() => {
      const team = createTeam({ id: randomUUID(), ...cleanInput });
      recordAudit(principal, {
        organizationId: team.organizationId,
        action: 'team.created',
        entityType: 'team',
        entityId: team.id,
        details: { after: team },
      });
      return team;
    })();
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, 'A team with this name already exists');
    throw error;
  }
}

export function updateTeamFor(principal: Principal, id: string, input: TeamInput) {
  requirePermission(principal, input.organizationId, 'team.manage');
  const cleanInput = cleanTeamInput(input);
  try {
    return db.transaction(() => {
      const before = requireTeam(id, cleanInput.organizationId);
      const result = updateTeam(id, cleanInput.organizationId, cleanInput.name);
      if (!result) throw new AppError(404, 'Team not found');
      recordAudit(principal, {
        organizationId: result.organizationId,
        action: 'team.updated',
        entityType: 'team',
        entityId: result.id,
        details: { before, after: result },
      });
      return result;
    })();
  } catch (error) {
    if (isUniqueConstraint(error)) throw new AppError(409, 'A team with this name already exists');
    throw error;
  }
}

export function deleteTeamFor(principal: Principal, id: string, input: { organizationId: string }) {
  requirePermission(principal, input.organizationId, 'team.delete');
  return db.transaction(() => {
    const before = requireTeam(id, input.organizationId);
    if (!deleteTeamIfEmpty(id, input.organizationId))
      throw new AppError(409, 'Remove the members of this team before deleting it');
    recordAudit(principal, {
      organizationId: before.organizationId,
      action: 'team.deleted',
      entityType: 'team',
      entityId: before.id,
      details: { before },
    });
    return { ok: true as const };
  })();
}

/**
 * Who may act on whom: owners manage everyone; admins manage operators and viewers only, judged by
 * the target's effective role in the organization so a team-level viewer who is an admin elsewhere
 * in the organization is still protected.
 */
function requireAuthorityOver(principal: Principal, organizationId: string, targetUserId: string) {
  const actorRole = requirePermission(principal, organizationId, 'members.manage');
  const targetRole = getOrganizationRole(targetUserId, organizationId);
  if (!targetRole)
    throw new AppError(404, 'This person is not a member of the organization. Send an invitation instead.');
  if (!canActOnRole(actorRole, targetRole))
    throw new AppError(403, 'Organization owner access required to manage this member');
  return actorRole;
}
function requireGrantable(actorRole: AccessRole, role: AccessRole) {
  if (!assignableRoles(actorRole).includes(role))
    throw new AppError(403, `Only an organization owner can grant the ${role} role`);
}

/** Adds an existing member of the organization to another of its teams. Newcomers use invitations. */
export function addMemberFor(principal: Principal, teamId: string, input: AddMemberInput) {
  return db.transaction(() => {
    const actorRole = requireAuthorityOver(principal, input.organizationId, input.userId);
    requireGrantable(actorRole, input.role);
    const team = requireTeam(teamId, input.organizationId);
    if (getMembership(input.userId, team.id, input.organizationId))
      throw new AppError(409, 'This person is already a member of the team');
    const account = getUserById(input.userId);
    if (!account?.isActive) throw new AppError(409, 'This account is deactivated');
    addMembership({ userId: input.userId, teamId: team.id, role: input.role });
    recordAudit(principal, {
      organizationId: input.organizationId,
      action: 'membership.added',
      entityType: 'membership',
      entityId: input.userId,
      details: { userId: input.userId, email: account.email, teamId: team.id, role: input.role },
    });
    return memberOf(input.organizationId, input.userId);
  })();
}

export function changeRoleFor(principal: Principal, teamId: string, userId: string, input: ChangeRoleInput) {
  return db.transaction(() => {
    const actorRole = requireAuthorityOver(principal, input.organizationId, userId);
    requireGrantable(actorRole, input.role);
    const membership = getMembership(userId, teamId, input.organizationId);
    if (!membership) throw new AppError(404, 'Membership not found');
    if (membership.role === input.role) return memberOf(input.organizationId, userId);
    if (membership.role === 'owner' && countOtherActiveOwners(input.organizationId, { userId, teamId }) === 0)
      throw new AppError(409, lastOwnerMessage);
    updateMembershipRole(userId, teamId, input.role);
    recordAudit(principal, {
      organizationId: input.organizationId,
      action: 'membership.role_changed',
      entityType: 'membership',
      entityId: userId,
      details: { userId, teamId, before: membership.role, after: input.role },
    });
    return memberOf(input.organizationId, userId);
  })();
}

/** Removes a team membership. Members may remove themselves (leave) under the same owner safeguard. */
export function removeMemberFor(
  principal: Principal,
  teamId: string,
  userId: string,
  input: { organizationId: string },
) {
  return db.transaction(() => {
    const self = !principal.serviceToken && principal.id === userId;
    if (self) {
      if (!organizationRole(principal, input.organizationId))
        throw new AppError(403, 'Organization access denied');
    } else {
      requireAuthorityOver(principal, input.organizationId, userId);
    }
    const membership = getMembership(userId, teamId, input.organizationId);
    if (!membership) throw new AppError(404, 'Membership not found');
    if (membership.role === 'owner' && countOtherActiveOwners(input.organizationId, { userId, teamId }) === 0)
      throw new AppError(409, lastOwnerMessage);
    removeMembership(userId, teamId);
    recordAudit(principal, {
      organizationId: input.organizationId,
      action: 'membership.removed',
      entityType: 'membership',
      entityId: userId,
      details: { userId, teamId, role: membership.role, self },
    });
    return { ok: true as const };
  })();
}

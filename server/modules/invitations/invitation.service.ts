import { randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../../http/app-error.ts';
import { config } from '../../config.ts';
import type { Principal } from '../../auth.ts';
import { createSession, hashInvitationToken, sessionCookie } from '../../auth.ts';
import {
  acceptInvitation,
  createInvitation,
  findUserByEmail,
  getMembership,
  getUserById,
  inspectInvitation,
  listPendingInvitations,
  listTeams,
  listUserOrganizations,
  revokeInvitation,
} from '../../store.ts';
import { hashPassword } from '../../passwords.ts';
import { db } from '../../persistence/database.ts';
import { requirePermission } from '../../authorization.ts';
import { assignableRoles } from '../../../shared/permissions.ts';
import { recordAudit } from '../audit/audit.service.ts';

type InviteRole = 'admin' | 'operator' | 'viewer';
type CreateInvitationInput = { email: string; organizationId: string; teamId: string; role: InviteRole };
type AcceptInvitationInput = { token: string; displayName?: string; password?: string };

export function inspectInvite(token: string) {
  const invitation = inspectInvitation(hashInvitationToken(token));
  if (!invitation) throw new AppError(404, 'Invitation is invalid or expired');
  return invitation;
}

export function createInvite(principal: Principal, input: CreateInvitationInput) {
  const { email, organizationId, teamId, role } = input;
  const actorRole = requirePermission(principal, organizationId, 'members.manage');
  if (!assignableRoles(actorRole).includes(role))
    throw new AppError(403, 'Only an organization owner can invite another admin');
  if (!listTeams({ organizationIds: [organizationId], organizationId }).some((team) => team.id === teamId))
    throw new AppError(400, 'Team does not belong to this organization');
  const existing = findUserByEmail(email);
  if (existing && getMembership(existing.id, teamId, organizationId))
    throw new AppError(409, 'This person is already a member of the team');

  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invitationId = randomUUID();
  db.transaction(() => {
    createInvitation({
      id: invitationId,
      email,
      organizationId,
      teamId,
      role,
      tokenHash: hashInvitationToken(token),
      invitedBy: principal.id,
      expiresAt,
    });
    recordAudit(principal, {
      organizationId,
      action: 'membership.invited',
      entityType: 'membership',
      entityId: invitationId,
      details: { email, teamId, role, expiresAt },
    });
  })();
  return { email, expiresAt, inviteUrl: `${config.appOrigin}/#invite=${token}` };
}

export function pendingInvitesFor(principal: Principal, organizationId: string) {
  requirePermission(principal, organizationId, 'members.manage');
  return listPendingInvitations(organizationId);
}

export function revokeInvite(principal: Principal, id: string, input: { organizationId: string }) {
  requirePermission(principal, input.organizationId, 'members.manage');
  return db.transaction(() => {
    const invitation = revokeInvitation(id, input.organizationId);
    if (!invitation) throw new AppError(404, 'Invitation not found');
    recordAudit(principal, {
      organizationId: input.organizationId,
      action: 'membership.invitation_revoked',
      entityType: 'membership',
      entityId: invitation.id,
      details: { email: invitation.email, teamId: invitation.teamId, role: invitation.role },
    });
    return { ok: true as const };
  })();
}

export function acceptInvite(principal: Principal | null, input: AcceptInvitationInput) {
  const invitation = inspectInvite(input.token);
  if (principal?.serviceToken)
    throw new AppError(403, 'Sign in with an engineer account to accept this invitation');

  let userId: string;
  let newAccount = false;
  if (principal) {
    if (principal.email.toLowerCase() !== invitation.email.toLowerCase())
      throw new AppError(403, 'Sign in with the invited email address to accept this invitation');
    try {
      userId = acceptInvitationWithAudit(invitation.id, invitation.organizationId, {
        tokenHash: hashInvitationToken(input.token),
        existingUserId: principal.id,
      });
    } catch (error) {
      throw mapAcceptanceError(error);
    }
  } else {
    if (findUserByEmail(invitation.email))
      throw new AppError(409, 'This email already has an account. Sign in to accept the invitation.');
    if (
      !input.displayName?.trim() ||
      input.displayName.length > 100 ||
      !input.password ||
      input.password.length < 12 ||
      input.password.length > 256
    ) {
      throw new AppError(400, 'Choose a display name and a password of at least 12 characters');
    }
    const user = {
      id: randomUUID(),
      email: invitation.email,
      displayName: input.displayName.trim(),
      passwordHash: hashPassword(input.password),
    };
    try {
      userId = acceptInvitationWithAudit(invitation.id, invitation.organizationId, {
        tokenHash: hashInvitationToken(input.token),
        user,
      });
    } catch (error) {
      throw mapAcceptanceError(error);
    }
    newAccount = true;
  }

  const account = getUserById(userId);
  if (!account) throw new AppError(500, 'Account could not be loaded');
  const response = {
    user: { id: account.id, email: account.email, displayName: account.displayName },
    organizations: listUserOrganizations(userId),
  };
  if (!newAccount) return { ...response, cookie: undefined };
  return { ...response, cookie: sessionCookie(createSession(userId).token) };
}

function acceptInvitationWithAudit(
  invitationId: string,
  organizationId: string,
  input: Parameters<typeof acceptInvitation>[0],
) {
  return db.transaction(() => {
    const result = acceptInvitation(input);
    const account = getUserById(result.userId);
    if (!account) throw new Error('INVITATION_INVALID');
    recordAudit(account, {
      organizationId,
      action: 'membership.accepted',
      entityType: 'membership',
      entityId: invitationId,
      details: {
        userId: result.userId,
        teamId: result.teamId,
        role: result.role,
        membershipCreated: result.membershipCreated,
        newAccount: !input.existingUserId,
      },
    });
    return result.userId;
  })();
}

function mapAcceptanceError(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'ACCOUNT_EXISTS')
    return new AppError(409, 'This email already has an account. Sign in to accept the invitation.');
  if (code === 'INVITATION_EMAIL_MISMATCH')
    return new AppError(403, 'Sign in with the invited email address to accept this invitation');
  if (code === 'INVITATION_INVALID') return new AppError(404, 'Invitation is invalid or expired');
  return new AppError(409, 'Could not accept invitation');
}

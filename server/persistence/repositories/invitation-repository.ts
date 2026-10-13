import { db } from '../database.ts';
import type { AccessRole, InvitationRecord } from '../types.ts';

type InviteRole = Exclude<AccessRole, 'owner'>;
type NewInvitation = { id: string; email: string; organizationId: string; teamId: string; role: InviteRole; tokenHash: string; invitedBy: string; expiresAt: string };

export function createInvitation(invite: NewInvitation) {
  db.prepare(`INSERT INTO invitations (id, email, organization_id, team_id, role, token_hash, invited_by, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(invite.id, invite.email.toLowerCase(), invite.organizationId, invite.teamId, invite.role, invite.tokenHash, invite.invitedBy, new Date().toISOString(), invite.expiresAt);
}
export function inspectInvitation(tokenHash: string): InvitationRecord | null {
  const row = db.prepare(`
    SELECT invitations.id, invitations.email, invitations.organization_id AS organizationId,
      organizations.name AS organizationName, invitations.team_id AS teamId, teams.name AS teamName,
      invitations.role, invitations.expires_at AS expiresAt,
      EXISTS (SELECT 1 FROM users WHERE users.email = invitations.email COLLATE NOCASE) AS accountExists
    FROM invitations JOIN organizations ON organizations.id = invitations.organization_id
      JOIN teams ON teams.id = invitations.team_id
    WHERE invitations.token_hash = ? AND invitations.accepted_at IS NULL AND invitations.expires_at > ?
  `).get(tokenHash, new Date().toISOString()) as unknown as InvitationRecord | undefined;
  return row ?? null;
}
export function acceptInvitation(input: { tokenHash: string; user?: { id: string; email: string; displayName: string; passwordHash: string }; existingUserId?: string }) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const invite = db.prepare(`SELECT id, email, team_id AS teamId, role FROM invitations WHERE token_hash = ? AND accepted_at IS NULL AND expires_at > ?`).get(input.tokenHash, new Date().toISOString()) as { id: string; email: string; teamId: string; role: InviteRole } | undefined;
    if (!invite) throw new Error('INVITATION_INVALID');
    let userId = input.existingUserId;
    if (userId) {
      const user = db.prepare('SELECT id, email FROM users WHERE id = ? AND is_active = 1').get(userId) as { id: string; email: string } | undefined;
      if (!user || user.email.toLowerCase() !== invite.email.toLowerCase()) throw new Error('INVITATION_EMAIL_MISMATCH');
    } else {
      if (!input.user || input.user.email.toLowerCase() !== invite.email.toLowerCase()) throw new Error('INVITATION_EMAIL_MISMATCH');
      if (db.prepare('SELECT 1 FROM users WHERE email = ? COLLATE NOCASE').get(invite.email)) throw new Error('ACCOUNT_EXISTS');
      db.prepare('INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)').run(input.user.id, input.user.email.toLowerCase(), input.user.displayName, input.user.passwordHash, new Date().toISOString());
      userId = input.user.id;
    }
    db.prepare('INSERT OR IGNORE INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, ?, ?)').run(userId, invite.teamId, invite.role, new Date().toISOString());
    db.prepare('UPDATE invitations SET accepted_at = ? WHERE id = ?').run(new Date().toISOString(), invite.id);
    db.exec('COMMIT');
    return userId;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

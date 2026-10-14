import { roleRank } from '../../../shared/permissions.ts';
import { db } from '../database.ts';
import type { AccessRole, OrganizationMember, TeamMembership } from '../types.ts';

type MembershipRow = {
  userId: string;
  email: string;
  displayName: string;
  isActive: number;
  teamId: string;
  teamName: string;
  role: AccessRole;
  since: string;
};
const rank =
  "CASE team_memberships.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END";

/** Every account with at least one team membership in the organization, with all of its memberships. */
export function listOrganizationMembers(organizationId: string): OrganizationMember[] {
  const rows = db
    .prepare(
      `SELECT users.id AS userId, users.email, users.display_name AS displayName, users.is_active AS isActive,
         teams.id AS teamId, teams.name AS teamName, team_memberships.role, team_memberships.created_at AS since
       FROM team_memberships
       JOIN teams ON teams.id = team_memberships.team_id
       JOIN users ON users.id = team_memberships.user_id
       WHERE teams.organization_id = ?
       ORDER BY users.display_name, users.id, teams.name`,
    )
    .all(organizationId) as MembershipRow[];
  const members = new Map<string, OrganizationMember>();
  for (const row of rows) {
    const membership: TeamMembership = {
      teamId: row.teamId,
      teamName: row.teamName,
      role: row.role,
      since: row.since,
    };
    const member = members.get(row.userId);
    if (member) {
      member.teams.push(membership);
      if (roleRank[row.role] > roleRank[member.role]) member.role = row.role;
    } else {
      members.set(row.userId, {
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
        isActive: Boolean(row.isActive),
        role: row.role,
        teams: [membership],
      });
    }
  }
  return [...members.values()];
}

export function getMembership(userId: string, teamId: string, organizationId: string) {
  return db
    .prepare(
      `SELECT team_memberships.user_id AS userId, team_memberships.team_id AS teamId, team_memberships.role, team_memberships.created_at AS since
       FROM team_memberships JOIN teams ON teams.id = team_memberships.team_id
       WHERE team_memberships.user_id = ? AND team_memberships.team_id = ? AND teams.organization_id = ?`,
    )
    .get(userId, teamId, organizationId) as
    { userId: string; teamId: string; role: AccessRole; since: string } | undefined;
}

/** The highest role an account holds across the organization's teams, or undefined when not a member. */
export function getOrganizationRole(userId: string, organizationId: string): AccessRole | undefined {
  const row = db
    .prepare(
      `SELECT CASE MAX(${rank}) WHEN 4 THEN 'owner' WHEN 3 THEN 'admin' WHEN 2 THEN 'operator' WHEN 1 THEN 'viewer' END AS role
       FROM team_memberships JOIN teams ON teams.id = team_memberships.team_id
       WHERE team_memberships.user_id = ? AND teams.organization_id = ?`,
    )
    .get(userId, organizationId) as { role: AccessRole | null } | undefined;
  return row?.role ?? undefined;
}

export function addMembership(input: { userId: string; teamId: string; role: AccessRole }) {
  db.prepare('INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, ?, ?)').run(
    input.userId,
    input.teamId,
    input.role,
    new Date().toISOString(),
  );
}
export function updateMembershipRole(userId: string, teamId: string, role: AccessRole) {
  return db
    .prepare('UPDATE team_memberships SET role = ? WHERE user_id = ? AND team_id = ?')
    .run(role, userId, teamId).changes;
}
export function removeMembership(userId: string, teamId: string) {
  return db.prepare('DELETE FROM team_memberships WHERE user_id = ? AND team_id = ?').run(userId, teamId)
    .changes;
}

/**
 * Number of distinct active accounts that would still hold the owner role in the organization if the
 * given team membership were removed or demoted. Used to keep at least one owner per organization.
 */
export function countOtherActiveOwners(organizationId: string, excluded: { userId: string; teamId: string }) {
  return (
    db
      .prepare(
        `SELECT COUNT(DISTINCT team_memberships.user_id) AS count
         FROM team_memberships
         JOIN teams ON teams.id = team_memberships.team_id
         JOIN users ON users.id = team_memberships.user_id
         WHERE teams.organization_id = ? AND team_memberships.role = 'owner' AND users.is_active = 1
           AND NOT (team_memberships.user_id = ? AND team_memberships.team_id = ?)`,
      )
      .get(organizationId, excluded.userId, excluded.teamId) as { count: number }
  ).count;
}

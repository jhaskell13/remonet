import { db } from '../database.ts';
import { where } from '../query.ts';
import type { Scope, Team } from '../types.ts';

export function canManageOrganization(userId: string, organizationId: string) {
  return (
    db
      .prepare(
        `SELECT 1 FROM team_memberships JOIN teams ON teams.id = team_memberships.team_id WHERE team_memberships.user_id = ? AND teams.organization_id = ? AND team_memberships.role IN ('owner', 'admin') LIMIT 1`,
      )
      .get(userId, organizationId) !== undefined
  );
}
export function listTeams(scope: Scope = {}): Team[] {
  const { sql, values } = where(scope, 'teams');
  return db
    .prepare(`SELECT id, organization_id AS organizationId, name FROM teams${sql} ORDER BY name`)
    .all(...values) as unknown as Team[];
}

import { db } from '../database.ts';
import { where } from '../query.ts';
import type { Scope, Team } from '../types.ts';

export function listTeams(scope: Scope = {}): Team[] {
  const { sql, values } = where(scope, 'teams');
  return db
    .prepare(`SELECT id, organization_id AS organizationId, name FROM teams${sql} ORDER BY name`)
    .all(...values) as unknown as Team[];
}
export function getTeam(id: string, organizationId: string) {
  return db
    .prepare(
      'SELECT id, organization_id AS organizationId, name FROM teams WHERE id = ? AND organization_id = ?',
    )
    .get(id, organizationId) as Team | undefined;
}
export function createTeam(input: Team): Team {
  db.prepare('INSERT INTO teams (id, organization_id, name) VALUES (?, ?, ?)').run(
    input.id,
    input.organizationId,
    input.name,
  );
  return getTeam(input.id, input.organizationId)!;
}
export function updateTeam(id: string, organizationId: string, name: string) {
  const result = db
    .prepare('UPDATE teams SET name = ? WHERE id = ? AND organization_id = ?')
    .run(name, id, organizationId);
  return result.changes ? getTeam(id, organizationId) : undefined;
}
/** Deletes a team only when nobody belongs to it. Pending invitations for the team are removed with it. */
export function deleteTeamIfEmpty(id: string, organizationId: string) {
  return db
    .prepare(
      'DELETE FROM teams WHERE id = ? AND organization_id = ? AND NOT EXISTS (SELECT 1 FROM team_memberships WHERE team_id = ?)',
    )
    .run(id, organizationId, id).changes;
}

import { db } from '../database.ts';
import type { OrganizationAccess, UserRecord } from '../types.ts';

export function findUserByEmail(email: string): UserRecord | null {
  const row = db
    .prepare(
      'SELECT id, email, display_name AS displayName, password_hash AS passwordHash, is_active AS isActive FROM users WHERE email = ? COLLATE NOCASE',
    )
    .get(email) as UserRecord | undefined;
  return row ? { ...row, isActive: Boolean(row.isActive) } : null;
}
export const getUserByEmail = findUserByEmail;
export function getUserById(userId: string): UserRecord | null {
  const row = db
    .prepare(
      'SELECT id, email, display_name AS displayName, password_hash AS passwordHash, is_active AS isActive FROM users WHERE id = ?',
    )
    .get(userId) as UserRecord | undefined;
  return row ? { ...row, isActive: Boolean(row.isActive) } : null;
}
export function createUser(user: { id: string; email: string; displayName: string; passwordHash: string }) {
  db.prepare(
    'INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(user.id, user.email.toLowerCase(), user.displayName, user.passwordHash, new Date().toISOString());
}
export function listUserOrganizations(userId: string): OrganizationAccess[] {
  return db
    .prepare(
      `
    SELECT organizations.id, organizations.name,
      CASE MAX(CASE team_memberships.role WHEN 'owner' THEN 4 WHEN 'admin' THEN 3 WHEN 'operator' THEN 2 ELSE 1 END)
        WHEN 4 THEN 'owner' WHEN 3 THEN 'admin' WHEN 2 THEN 'operator' ELSE 'viewer' END AS role
    FROM team_memberships
    JOIN teams ON teams.id = team_memberships.team_id
    JOIN organizations ON organizations.id = teams.organization_id
    JOIN users ON users.id = team_memberships.user_id
    WHERE team_memberships.user_id = ? AND users.is_active = 1
    GROUP BY organizations.id
    ORDER BY organizations.name
  `,
    )
    .all(userId) as unknown as OrganizationAccess[];
}

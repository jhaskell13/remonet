import { db } from '../database.ts';
import { listUserOrganizations } from './user-repository.ts';

export function findSessionUser(tokenHash: string) {
  const session = db
    .prepare(
      `SELECT users.id, users.email, users.display_name AS displayName FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ? AND users.is_active = 1`,
    )
    .get(tokenHash, new Date().toISOString()) as
    { id: string; email: string; displayName: string } | undefined;
  if (!session) return null;
  return { ...session, organizations: listUserOrganizations(session.id) };
}
export function saveSession(tokenHash: string, userId: string, expiresAt: string) {
  const createdAt = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(createdAt);
  db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(
    tokenHash,
    userId,
    expiresAt,
    createdAt,
  );
}
export function deleteSession(tokenHash: string) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

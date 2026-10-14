import { db } from '../database.ts';
import type { Organization } from '../types.ts';

export function listOrganizations(organizationIds?: string[]): Organization[] {
  if (organizationIds && organizationIds.length === 0) return [];
  if (organizationIds) {
    const placeholders = organizationIds.map(() => '?').join(', ');
    return db
      .prepare(`SELECT id, name FROM organizations WHERE id IN (${placeholders}) ORDER BY name`)
      .all(...organizationIds) as unknown as Organization[];
  }
  return db.prepare('SELECT id, name FROM organizations ORDER BY name').all() as unknown as Organization[];
}
export function getOrganization(id: string) {
  return db.prepare('SELECT id, name FROM organizations WHERE id = ?').get(id) as Organization | undefined;
}
export function createOrganization(input: Organization): Organization {
  db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)').run(input.id, input.name);
  return getOrganization(input.id)!;
}
export function updateOrganization(id: string, name: string) {
  const result = db.prepare('UPDATE organizations SET name = ? WHERE id = ?').run(name, id);
  return result.changes ? getOrganization(id) : undefined;
}

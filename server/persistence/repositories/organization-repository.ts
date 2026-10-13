import { db } from '../database.ts';
import type { Organization } from '../types.ts';

export function listOrganizations(organizationIds?: string[]): Organization[] {
  if (organizationIds && organizationIds.length === 0) return [];
  if (organizationIds) {
    const placeholders = organizationIds.map(() => '?').join(', ');
    return db.prepare(`SELECT id, name FROM organizations WHERE id IN (${placeholders}) ORDER BY name`).all(...organizationIds) as unknown as Organization[];
  }
  return db.prepare('SELECT id, name FROM organizations ORDER BY name').all() as unknown as Organization[];
}

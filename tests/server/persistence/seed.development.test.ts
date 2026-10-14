import { describe, expect, it } from 'vitest';

// Demo fixtures and accounts are only seeded in development. The environment is switched before the
// server modules are imported so `config.ts` evaluates with NODE_ENV=development for this file only.
process.env.NODE_ENV = 'development';
process.env.REMONET_SEED_DEMO = 'true';

const { config } = await import('../../../server/config.ts');
const { db, migrateDatabase } = await import('../../../server/persistence/database.ts');
const { seedDatabase } = await import('../../../server/persistence/seed.ts');
const { signIn } = await import('../../../server/auth.ts');
const { listUserOrganizations } = await import('../../../server/persistence/repositories/user-repository.ts');

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

describe('development seeding', () => {
  it('runs with demo seeding enabled', () => {
    expect(config.nodeEnv).toBe('development');
    expect(config.seedDemoData).toBe(true);
  });

  it('seeds the demo inventory and the two documented accounts', () => {
    migrateDatabase();
    seedDatabase();
    expect(count('organizations')).toBe(3);
    expect(count('networks')).toBe(4);
    expect(count('areas')).toBe(7);
    expect(count('devices')).toBe(10);
    expect(count('teams')).toBe(3);
    expect(count('users')).toBe(2);
    expect(listUserOrganizations('user-solo')).toEqual([
      { id: 'org-solo', name: "Jordan's Personal Network", role: 'owner' },
    ]);
    expect(listUserOrganizations('user-engineer')).toEqual([
      { id: 'org-acme', name: 'Acme Manufacturing', role: 'operator' },
      { id: 'org-demo', name: 'Northstar Engineering', role: 'admin' },
    ]);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });

  it('the documented demo credentials sign in', () => {
    expect(signIn('solo@remonet.local', 'SoloNetwork2026!')?.id).toBe('user-solo');
    expect(signIn('engineer@remonet.local', 'EngineerNetwork2026!')?.id).toBe('user-engineer');
    expect(signIn('engineer@remonet.local', 'SoloNetwork2026!')).toBeNull();
  });

  it('is idempotent and preserves local changes to non-demo rows', () => {
    db.prepare(
      "INSERT INTO networks (id, organization_id, name, description) VALUES ('net-local', 'org-demo', 'Local only', '')",
    ).run();
    db.prepare("UPDATE networks SET description = 'edited locally' WHERE id = 'net-core'").run();
    seedDatabase();
    expect(count('networks')).toBe(5);
    expect(count('users')).toBe(2);
    expect(count('team_memberships')).toBe(3);
    expect(db.prepare("SELECT description FROM networks WHERE id = 'net-core'").get()).toEqual({
      description: 'edited locally',
    });
  });

  it('resets demo passwords to their documented values on every start', () => {
    db.prepare("UPDATE users SET password_hash = 'scrypt$broken' WHERE email = 'solo@remonet.local'").run();
    expect(signIn('solo@remonet.local', 'SoloNetwork2026!')).toBeNull();
    seedDatabase();
    expect(signIn('solo@remonet.local', 'SoloNetwork2026!')?.id).toBe('user-solo');
  });
});

import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'production';
process.env.REMONET_ALLOWED_ORIGIN = 'https://remonet.example';
process.env.REMONET_APP_ORIGIN = 'https://remonet.example';
process.env.REMONET_SEED_DEMO = 'true'; // ignored outside development
process.env.REMONET_BOOTSTRAP_EMAIL = 'Owner@Remonet.Example';
process.env.REMONET_BOOTSTRAP_PASSWORD = 'BootstrapPassword2026!';
process.env.REMONET_BOOTSTRAP_DISPLAY_NAME = 'First Owner';
process.env.REMONET_BOOTSTRAP_ORGANIZATION_ID = 'org-first';
process.env.REMONET_BOOTSTRAP_ORGANIZATION_NAME = 'First Organization';

const { config } = await import('../../../server/config.ts');
const { db, migrateDatabase } = await import('../../../server/persistence/database.ts');
const { seedDatabase } = await import('../../../server/persistence/seed.ts');
const { clearedSessionCookie, sessionCookie, signIn } = await import('../../../server/auth.ts');
const { listUserOrganizations } = await import('../../../server/persistence/repositories/user-repository.ts');

const count = (table: string) =>
  (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;

describe('production bootstrap seeding', () => {
  it('never seeds demo data in production', () => {
    expect(config.isProduction).toBe(true);
    expect(config.seedDemoData).toBe(false);
  });

  it('marks session cookies Secure in production', () => {
    expect(sessionCookie('abc')).toBe(
      `remonet_session=abc; HttpOnly; SameSite=Strict; Path=/; Max-Age=${config.sessionLifetimeMs / 1000}; Secure`,
    );
    expect(clearedSessionCookie()).toBe(
      'remonet_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0; Secure',
    );
  });

  it('creates exactly one organization, owner team, and owner account on an empty database', () => {
    migrateDatabase();
    seedDatabase();
    expect(count('organizations')).toBe(1);
    expect(count('teams')).toBe(1);
    expect(count('users')).toBe(1);
    expect(count('networks')).toBe(0);
    expect(count('devices')).toBe(0);
    expect(db.prepare('SELECT id, name FROM organizations').get()).toEqual({
      id: 'org-first',
      name: 'First Organization',
    });
    expect(listUserOrganizations('user-bootstrap')).toEqual([
      { id: 'org-first', name: 'First Organization', role: 'owner' },
    ]);
    const owner = signIn('owner@remonet.example', 'BootstrapPassword2026!');
    expect(owner).toMatchObject({
      id: 'user-bootstrap',
      email: 'owner@remonet.example',
      displayName: 'First Owner',
    });
  });

  it('does not repeat the bootstrap once accounts exist', () => {
    db.prepare("UPDATE users SET display_name = 'Renamed' WHERE id = 'user-bootstrap'").run();
    seedDatabase();
    expect(count('users')).toBe(1);
    expect(
      db.prepare("SELECT display_name AS displayName FROM users WHERE id = 'user-bootstrap'").get(),
    ).toEqual({ displayName: 'Renamed' });
  });

  it('refuses to start when demo organizations or accounts are present', () => {
    db.prepare("INSERT INTO organizations (id, name) VALUES ('org-demo', 'Leaked demo data')").run();
    expect(() => seedDatabase()).toThrow(
      'Development demo data or accounts exist in this database. Use a separate production database.',
    );
    db.prepare("DELETE FROM organizations WHERE id = 'org-demo'").run();
    db.prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u', 'solo@remonet.local', 'Demo', 'x', 'now')",
    ).run();
    expect(() => seedDatabase()).toThrow(/demo data or accounts/);
  });
});

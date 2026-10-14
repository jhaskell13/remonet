import { describe, expect, it } from 'vitest';

process.env.NODE_ENV = 'production';
process.env.REMONET_ALLOWED_ORIGIN = 'https://remonet.example';
process.env.REMONET_APP_ORIGIN = 'https://remonet.example';

const { config } = await import('../../../server/config.ts');
const { db, migrateDatabase } = await import('../../../server/persistence/database.ts');
const { seedDatabase } = await import('../../../server/persistence/seed.ts');

describe('production start without bootstrap credentials', () => {
  it('refuses to run against an empty database', () => {
    expect(config.bootstrap).toBeUndefined();
    migrateDatabase();
    expect(() => seedDatabase()).toThrow('A fresh production database requires bootstrap owner credentials');
    expect((db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count).toBe(0);
  });

  it('starts normally once an account exists', () => {
    db.prepare(
      "INSERT INTO users (id, email, display_name, password_hash, created_at) VALUES ('u', 'owner@remonet.example', 'Owner', 'x', 'now')",
    ).run();
    expect(() => seedDatabase()).not.toThrow();
  });
});

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
    expect(count('device_observations')).toBe(19);
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

  it('seeds a recent history that agrees with each device snapshot', () => {
    const rows = db
      .prepare(
        'SELECT device_id AS deviceId, result, latency_ms AS latencyMs, error_message AS errorMessage, collected_at AS collectedAt FROM device_observations ORDER BY device_id, collected_at',
      )
      .all() as {
      deviceId: string;
      result: string;
      latencyMs: number | null;
      errorMessage: string | null;
      collectedAt: string;
    }[];
    const router = rows.filter((row) => row.deviceId === 'RTR-001');
    expect(router.map((row) => row.result)).toEqual(['success', 'success', 'success']);
    expect(router[router.length - 1]?.latencyMs).toBe(4);
    const accessPoint = rows.filter((row) => row.deviceId === 'AP-037');
    expect(accessPoint.map((row) => [row.result, row.errorMessage])).toEqual([
      ['success', null],
      ['timeout', 'Check timed out'],
      ['error', 'EHOSTUNREACH 10.30.3.37'],
      ['timeout', 'Check timed out'],
    ]);
    for (const row of rows) expect(Date.parse(row.collectedAt)).toBeLessThanOrEqual(Date.now());
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

  it('refreshes demo telemetry on every start while keeping metadata edits', () => {
    db.prepare(
      "UPDATE devices SET name = 'Renamed locally', status = 'Offline', last_seen = '2020-01-01T00:00:00.000Z' WHERE id = 'RTR-001'",
    ).run();
    seedDatabase();
    const router = db
      .prepare('SELECT name, status, last_seen AS lastSeen FROM devices WHERE id = ?')
      .get('RTR-001') as { name: string; status: string; lastSeen: string };
    expect(router.name).toBe('Renamed locally');
    expect(router.status).toBe('Healthy');
    expect(Date.now() - Date.parse(router.lastSeen)).toBeLessThan(60_000);
  });

  it('resets demo passwords to their documented values on every start', () => {
    db.prepare("UPDATE users SET password_hash = 'scrypt$broken' WHERE email = 'solo@remonet.local'").run();
    expect(signIn('solo@remonet.local', 'SoloNetwork2026!')).toBeNull();
    seedDatabase();
    expect(signIn('solo@remonet.local', 'SoloNetwork2026!')?.id).toBe('user-solo');
  });
});

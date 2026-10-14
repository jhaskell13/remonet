import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { db, migrateDatabase } from '../../../server/persistence/database.ts';

const migrationsDirectory = fileURLToPath(
  new URL('../../../server/persistence/migrations/', import.meta.url),
);
const migrationFiles = readdirSync(migrationsDirectory)
  .filter((file) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(file))
  .sort();

type MigrationRow = { id: string; checksum: string; applied_at: string };
const appliedMigrations = () =>
  db.prepare('SELECT id, checksum, applied_at FROM migrations ORDER BY id').all() as MigrationRow[];
const tableNames = () =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);
const indexNames = () =>
  (
    db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as { name: string }[]
  ).map((row) => row.name);

// These tests run sequentially against a database that starts completely empty.
describe('migration runner', () => {
  it('connects with foreign keys enforced and WAL journaling', () => {
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
  });

  it('starts from an empty database', () => {
    expect(tableNames()).toEqual([]);
  });

  it('applies every migration in order and records a SHA-256 checksum for each', () => {
    migrateDatabase();
    const rows = appliedMigrations();
    expect(rows.map((row) => row.id)).toEqual(migrationFiles.map((file) => file.slice(0, -4)));
    expect(rows.map((row) => row.id)).toEqual([
      '001_initial_schema',
      '002_network_name_uniqueness',
      '003_area_name_uniqueness',
      '004_pending_device_status',
      '005_device_address_uniqueness',
      '006_audit_log',
      '007_audit_log_entity_types',
      '008_team_name_uniqueness',
    ]);
    for (const row of rows) {
      const sql = readFileSync(resolve(migrationsDirectory, `${row.id}.sql`), 'utf8').replace(/\r\n/g, '\n');
      expect(row.checksum).toBe(createHash('sha256').update(sql).digest('hex'));
      expect(Number.isNaN(Date.parse(row.applied_at))).toBe(false);
    }
  });

  it('creates the expected schema', () => {
    expect(tableNames()).toEqual([
      'areas',
      'audit_log',
      'devices',
      'invitations',
      'migrations',
      'networks',
      'organizations',
      'sessions',
      'team_memberships',
      'teams',
      'users',
    ]);
    expect(indexNames()).toEqual(
      expect.arrayContaining([
        'networks_organization_name',
        'areas_network_name',
        'teams_organization_name',
        'devices_network_address',
        'devices_org_network_area',
        'team_memberships_user',
        'invitations_email',
        'sessions_expiry',
        'audit_log_organization_created',
        'audit_log_entity',
      ]),
    );
    const uniqueIndexes = (
      db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND sql LIKE 'CREATE UNIQUE INDEX%'")
        .all() as { name: string }[]
    ).map((row) => row.name);
    expect(uniqueIndexes.sort()).toEqual([
      'areas_network_name',
      'devices_network_address',
      'networks_organization_name',
      'teams_organization_name',
    ]);
    const triggers = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(triggers).toEqual(['audit_log_no_delete', 'audit_log_no_update']);
  });

  it('uses STRICT tables so column types are enforced', () => {
    const strictTables = (
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND sql LIKE '%STRICT%'").all() as {
        name: string;
      }[]
    ).map((row) => row.name);
    expect(strictTables.sort()).toEqual(tableNames());
    expect(() =>
      db
        .prepare(
          "INSERT INTO users (id, email, display_name, password_hash, is_active, created_at) VALUES ('u', 'u@x.test', 'U', 'h', 'yes', 'now')",
        )
        .run(),
    ).toThrow(/cannot store TEXT value in INTEGER column/);
  });

  it('migrated the device status constraint to include Pending and a nullable last_seen', () => {
    const columns = db.prepare('PRAGMA table_info(devices)').all() as { name: string; notnull: number }[];
    expect(columns.find((column) => column.name === 'last_seen')?.notnull).toBe(0);
    db.prepare("INSERT INTO organizations (id, name) VALUES ('org-m', 'M')").run();
    db.prepare(
      "INSERT INTO networks (id, organization_id, name, description) VALUES ('net-m', 'org-m', 'N', '')",
    ).run();
    db.prepare(
      "INSERT INTO areas (id, organization_id, network_id, name, region) VALUES ('area-m', 'org-m', 'net-m', 'A', 'R')",
    ).run();
    const insert = (status: string) =>
      db
        .prepare(
          "INSERT INTO devices (id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen) VALUES (?, 'org-m', 'net-m', 'area-m', 'D', 'Router', ?, ?, 'Not measured', 0, 0, NULL)",
        )
        .run(`dev-${status}`, `10.0.0.${Math.floor(Math.random() * 200)}`, status);
    expect(() => insert('Pending')).not.toThrow();
    expect(() => insert('Unknown')).toThrow(/CHECK/);
    db.prepare("DELETE FROM organizations WHERE id = 'org-m'").run();
  });

  it('is idempotent', () => {
    const before = appliedMigrations();
    migrateDatabase();
    expect(appliedMigrations()).toEqual(before);
  });

  it('refuses to start when an applied migration was edited', () => {
    const target = appliedMigrations()[0]!;
    db.prepare('UPDATE migrations SET checksum = ? WHERE id = ?').run('0'.repeat(64), target.id);
    try {
      expect(() => migrateDatabase()).toThrow(
        `Applied migration ${target.id} was modified. Add a new migration instead.`,
      );
    } finally {
      db.prepare('UPDATE migrations SET checksum = ? WHERE id = ?').run(target.checksum, target.id);
    }
    expect(() => migrateDatabase()).not.toThrow();
  });

  it('refuses to start when the database knows a migration the codebase no longer has', () => {
    db.prepare(
      "INSERT INTO migrations (id, checksum, applied_at) VALUES ('099_from_the_future', 'abc', '2030-01-01T00:00:00.000Z')",
    ).run();
    try {
      expect(() => migrateDatabase()).toThrow(
        'Applied migrations are missing from the codebase: 099_from_the_future',
      );
    } finally {
      db.prepare("DELETE FROM migrations WHERE id = '099_from_the_future'").run();
    }
  });

  it('applies each migration atomically', () => {
    // A migration that fails half-way must leave no trace: neither its objects nor its record.
    const migrationId = '999_probe';
    expect(() =>
      db.transaction(() => {
        db.exec(
          'CREATE TABLE probe (id TEXT PRIMARY KEY) STRICT; CREATE TABLE probe (id TEXT PRIMARY KEY) STRICT;',
        );
        db.prepare('INSERT INTO migrations (id, checksum, applied_at) VALUES (?, ?, ?)').run(
          migrationId,
          'x',
          'now',
        );
      })(),
    ).toThrow(/already exists/);
    expect(tableNames()).not.toContain('probe');
    expect(appliedMigrations().some((row) => row.id === migrationId)).toBe(false);
  });

  it('007 rebuilds audit_log without losing history or its append-only guarantees', () => {
    // Upgrade path: a database that stopped at 006 with audit rows present.
    const upgrade = new Database(':memory:');
    upgrade.pragma('foreign_keys = ON');
    const apply = (file: string) => upgrade.exec(readFileSync(resolve(migrationsDirectory, file), 'utf8'));
    for (const file of migrationFiles.filter((candidate) => candidate < '007_')) apply(file);
    upgrade.prepare("INSERT INTO organizations (id, name) VALUES ('org-u', 'Upgrade')").run();
    upgrade
      .prepare(
        "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('evt', 'org-u', 'u', 'u@x.test', 'network.created', 'network', 'n', '{\"after\":1}', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    apply('007_audit_log_entity_types.sql');
    expect(upgrade.prepare('SELECT id, entity_type AS entityType, details FROM audit_log').all()).toEqual([
      { id: 'evt', entityType: 'network', details: '{"after":1}' },
    ]);
    expect(() => upgrade.prepare("DELETE FROM audit_log WHERE id = 'evt'").run()).toThrow(/immutable/);
    expect(() =>
      upgrade
        .prepare(
          "INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES ('evt2', 'org-u', 'u', 'u@x.test', 'team.created', 'team', 't', '{}', '2026-01-01T00:00:00.000Z')",
        )
        .run(),
    ).not.toThrow();
    expect(upgrade.pragma('foreign_key_check')).toEqual([]);
    upgrade.close();
  });
});

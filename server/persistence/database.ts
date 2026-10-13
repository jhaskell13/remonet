import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.ts';

const databasePath = resolve(config.databasePath);
mkdirSync(dirname(databasePath), { recursive: true });

export const db: InstanceType<typeof Database> = new Database(databasePath);
db.pragma('foreign_keys = ON');
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

const migrationsDirectory = fileURLToPath(new URL('./migrations/', import.meta.url));
export function migrateDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migrations (
      id TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const migrationFiles = readdirSync(migrationsDirectory)
    .filter((file) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(file))
    .sort();
  if (migrationFiles.some((file, index) => Number(file.slice(0, 3)) !== index + 1)) {
    throw new Error('Database migrations must use a continuous sequence starting at 001');
  }
  const migrationRecord = db.prepare('SELECT checksum FROM migrations WHERE id = ?');
  const recordMigration = db.prepare('INSERT INTO migrations (id, checksum, applied_at) VALUES (?, ?, ?)');
  const migrationIds = new Set(migrationFiles.map((file) => file.slice(0, -4)));
  const appliedMigrations = db.prepare('SELECT id FROM migrations').all() as { id: string }[];
  const missingFiles = appliedMigrations.filter(({ id }) => !migrationIds.has(id));
  if (missingFiles.length) {
    throw new Error(
      `Applied migrations are missing from the codebase: ${missingFiles.map(({ id }) => id).join(', ')}`,
    );
  }

  for (const file of migrationFiles) {
    const id = file.slice(0, -4);
    const sql = readFileSync(resolve(migrationsDirectory, file), 'utf8').replace(/\r\n/g, '\n');
    const checksum = createHash('sha256').update(sql).digest('hex');
    const applied = migrationRecord.get(id) as { checksum: string } | undefined;
    if (applied) {
      if (applied.checksum !== checksum)
        throw new Error(`Applied migration ${id} was modified. Add a new migration instead.`);
      continue;
    }
    db.transaction(() => {
      db.exec(sql);
      recordMigration.run(id, checksum, new Date().toISOString());
    })();
  }
}

export function closeDatabase() {
  db.close();
}

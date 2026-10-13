import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const databasePath = resolve(process.env.REMONET_DB_PATH ?? 'data/remonet.sqlite');
await mkdir(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS organizations (id TEXT PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS networks (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL,
    UNIQUE (id, organization_id), FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS areas (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, network_id TEXT NOT NULL, name TEXT NOT NULL, region TEXT NOT NULL,
    UNIQUE (id, organization_id, network_id),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (network_id, organization_id) REFERENCES networks(id, organization_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, network_id TEXT NOT NULL, area_id TEXT NOT NULL,
    name TEXT NOT NULL, type TEXT NOT NULL, address TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('Healthy', 'Warning', 'Offline')),
    uptime TEXT NOT NULL, latency REAL NOT NULL, load REAL NOT NULL, last_seen TEXT NOT NULL,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (network_id, organization_id) REFERENCES networks(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (area_id, organization_id, network_id) REFERENCES areas(id, organization_id, network_id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL, is_active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, name TEXT NOT NULL,
    UNIQUE (id, organization_id), UNIQUE (organization_id, name),
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS team_memberships (
    user_id TEXT NOT NULL, team_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'operator', 'viewer')),
    created_at TEXT NOT NULL, PRIMARY KEY (user_id, team_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE CASCADE
  );
  CREATE TABLE IF NOT EXISTS invitations (
    id TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, organization_id TEXT NOT NULL, team_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'operator', 'viewer')), token_hash TEXT NOT NULL UNIQUE,
    invited_by TEXT NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, accepted_at TEXT,
    FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
    FOREIGN KEY (team_id, organization_id) REFERENCES teams(id, organization_id) ON DELETE CASCADE,
    FOREIGN KEY (invited_by) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
  CREATE INDEX IF NOT EXISTS team_memberships_user ON team_memberships(user_id);
  CREATE INDEX IF NOT EXISTS invitations_email ON invitations(email, accepted_at, expires_at);
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS devices_org_network_area ON devices(organization_id, network_id, area_id);
`);

for (const version of [1, 2, 3]) {
  db.prepare('INSERT OR IGNORE INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(version, new Date().toISOString());
}

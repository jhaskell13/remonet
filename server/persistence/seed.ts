import { hashPassword } from '../passwords.ts';
import { areas, deviceObservations, devices, networks, organizations, teams } from './demo-fixtures.ts';
import { db } from './database.ts';
import { config } from '../config.ts';

export function seedDatabase() {
  const insertOrganization = db.prepare('INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)');
  const insertNetwork = db.prepare(
    'INSERT OR IGNORE INTO networks (id, organization_id, name, description, monitoring_enabled, poll_interval_seconds) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertArea = db.prepare(
    'INSERT OR IGNORE INTO areas (id, organization_id, network_id, name, region) VALUES (?, ?, ?, ?, ?)',
  );
  const insertDevice = db.prepare(
    'INSERT OR IGNORE INTO devices (id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertObservation = db.prepare(
    'INSERT OR IGNORE INTO device_observations (id, organization_id, network_id, device_id, source, result, latency_ms, load_percent, uptime_seconds, error_message, collected_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTeam = db.prepare('INSERT OR IGNORE INTO teams (id, organization_id, name) VALUES (?, ?, ?)');
  const insertUser = db.prepare(
    'INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  );
  const insertMembership = db.prepare(
    'INSERT OR IGNORE INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, ?, ?)',
  );
  const seededAt = new Date().toISOString();

  const isDevelopment = config.nodeEnv === 'development';
  if (isDevelopment) {
    for (const row of organizations) insertOrganization.run(row.id, row.name);
    for (const row of networks)
      insertNetwork.run(
        row.id,
        row.organizationId,
        row.name,
        row.description,
        row.monitoringEnabled ? 1 : 0,
        row.pollIntervalSeconds,
      );
    for (const row of areas) insertArea.run(row.id, row.organizationId, row.networkId, row.name, row.region);
    for (const row of devices)
      insertDevice.run(
        row.id,
        row.organizationId,
        row.networkId,
        row.areaId,
        row.name,
        row.type,
        row.address,
        row.status,
        row.uptime,
        row.latency,
        row.load,
        row.lastSeen,
      );
    // Like the demo passwords, demo telemetry is reset on every local start so the illustrative
    // snapshots and their history are fresh rather than stale. Metadata edits are preserved.
    const refreshTelemetry = db.prepare(
      'UPDATE devices SET status = ?, uptime = ?, latency = ?, load = ?, last_seen = ? WHERE id = ? AND organization_id = ?',
    );
    for (const row of devices)
      refreshTelemetry.run(
        row.status,
        row.uptime,
        row.latency,
        row.load,
        row.lastSeen,
        row.id,
        row.organizationId,
      );
    for (const row of deviceObservations)
      insertObservation.run(
        row.id,
        row.organizationId,
        row.networkId,
        row.deviceId,
        row.source,
        row.result,
        row.latencyMs,
        row.loadPercent,
        row.uptimeSeconds,
        row.errorMessage,
        row.collectedAt,
        row.createdAt,
      );
    for (const row of teams) insertTeam.run(row.id, row.organizationId, row.name);
  }

  const seedDemoAccounts = config.seedDemoData;
  if (seedDemoAccounts) {
    const demoUsers = [
      {
        id: 'user-solo',
        email: 'solo@remonet.local',
        name: 'Solo Engineer',
        passwordHash:
          'scrypt$32768$8$1$XP2zw9hasFdwiXwWcpbtHA$bghxDkHc1qTZ5UJkPjB7vT1AO8BHCCI6gnNggmgq6MKaCp0TRvfkGQmYui3ufyfGQUpMDU5Fjb2hbtWgOipl5w',
        team: 'team-solo',
        role: 'owner',
      },
      {
        id: 'user-engineer',
        email: 'engineer@remonet.local',
        name: 'Jordan Davis',
        passwordHash:
          'scrypt$32768$8$1$7RLufeycbH7T-968qp8IBg$3WBIFXUjytqERC3F25YnKaBC-jFxumTnQyHtRcrHQEIm5x_nfebq_elu3C1PQhTiJE87krAeY9v5E_835GpBVw',
        team: 'team-northstar',
        role: 'admin',
      },
    ] as const;
    for (const user of demoUsers) {
      insertUser.run(user.id, user.email, user.name, user.passwordHash, seededAt);
      // Demo credentials are intentionally reset to their documented values on local startup.
      db.prepare('UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE').run(
        user.passwordHash,
        user.email,
      );
      insertMembership.run(user.id, user.team, user.role, seededAt);
    }
    insertMembership.run('user-engineer', 'team-acme', 'operator', seededAt);
  }

  const userCount = Number(
    (db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }).count,
  );
  const developmentDataPresent =
    db
      .prepare("SELECT 1 FROM organizations WHERE id IN ('org-demo', 'org-acme', 'org-solo') LIMIT 1")
      .get() !== undefined;
  const demoAccountPresent =
    db
      .prepare("SELECT 1 FROM users WHERE email IN ('solo@remonet.local', 'engineer@remonet.local') LIMIT 1")
      .get() !== undefined;
  if (config.isProduction && (developmentDataPresent || demoAccountPresent)) {
    throw new Error(
      'Development demo data or accounts exist in this database. Use a separate production database.',
    );
  }
  if (config.isProduction && userCount === 0 && !config.bootstrap) {
    throw new Error('A fresh production database requires bootstrap owner credentials');
  }
  if (config.nodeEnv !== 'test' && !seedDemoAccounts && config.bootstrap && userCount === 0) {
    const { email, password, displayName, organizationId, organizationName } = config.bootstrap;
    insertOrganization.run(organizationId, organizationName);
    const teamId = `team-bootstrap-${organizationId}`;
    insertTeam.run(teamId, organizationId, 'Owners');
    insertUser.run('user-bootstrap', email, displayName, hashPassword(password), seededAt);
    insertMembership.run('user-bootstrap', teamId, 'owner', seededAt);
  }
}

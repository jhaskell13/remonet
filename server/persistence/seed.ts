import { hashPassword } from '../passwords.ts';
import { areas, devices, networks, organizations, teams } from '../../src/data.ts';
import { db } from './database.ts';

const insertOrganization = db.prepare('INSERT OR IGNORE INTO organizations (id, name) VALUES (?, ?)');
const insertNetwork = db.prepare('INSERT OR IGNORE INTO networks (id, organization_id, name, description) VALUES (?, ?, ?, ?)');
const insertArea = db.prepare('INSERT OR IGNORE INTO areas (id, organization_id, network_id, name, region) VALUES (?, ?, ?, ?, ?)');
const insertDevice = db.prepare('INSERT OR IGNORE INTO devices (id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
const insertTeam = db.prepare('INSERT OR IGNORE INTO teams (id, organization_id, name) VALUES (?, ?, ?)');
const insertUser = db.prepare('INSERT OR IGNORE INTO users (id, email, display_name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
const insertMembership = db.prepare('INSERT OR IGNORE INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, ?, ?)');
const seededAt = new Date().toISOString();

const isDevelopment = process.env.NODE_ENV !== 'production';
if (isDevelopment) {
  for (const row of organizations) insertOrganization.run(row.id, row.name);
  for (const row of networks) insertNetwork.run(row.id, row.organizationId, row.name, row.description);
  for (const row of areas) insertArea.run(row.id, row.organizationId, row.networkId, row.name, row.region);
  for (const row of devices) insertDevice.run(row.id, row.organizationId, row.networkId, row.areaId, row.name, row.type, row.address, row.status, row.uptime, row.latency, row.load, row.lastSeen);
  for (const row of teams) insertTeam.run(row.id, row.organizationId, row.name);
}

const seedDemoAccounts = isDevelopment && process.env.REMONET_SEED_DEMO !== 'false';
if (seedDemoAccounts) {
  const demoUsers = [
    { id: 'user-solo', email: 'solo@remonet.local', name: 'Solo Engineer', passwordHash: 'scrypt$32768$8$1$XP2zw9hasFdwiXwWcpbtHA$bghxDkHc1qTZ5UJkPjB7vT1AO8BHCCI6gnNggmgq6MKaCp0TRvfkGQmYui3ufyfGQUpMDU5Fjb2hbtWgOipl5w', team: 'team-solo', role: 'owner' },
    { id: 'user-engineer', email: 'engineer@remonet.local', name: 'Jordan Davis', passwordHash: 'scrypt$32768$8$1$7RLufeycbH7T-968qp8IBg$3WBIFXUjytqERC3F25YnKaBC-jFxumTnQyHtRcrHQEIm5x_nfebq_elu3C1PQhTiJE87krAeY9v5E_835GpBVw', team: 'team-northstar', role: 'admin' }
  ] as const;
  for (const user of demoUsers) {
    insertUser.run(user.id, user.email, user.name, user.passwordHash, seededAt);
    // Demo credentials are intentionally reset to their documented values on local startup.
    db.prepare('UPDATE users SET password_hash = ? WHERE email = ? COLLATE NOCASE').run(user.passwordHash, user.email);
    insertMembership.run(user.id, user.team, user.role, seededAt);
  }
  insertMembership.run('user-engineer', 'team-acme', 'operator', seededAt);
}

if (!seedDemoAccounts && process.env.REMONET_BOOTSTRAP_EMAIL && process.env.REMONET_BOOTSTRAP_PASSWORD && Number(db.prepare('SELECT COUNT(*) AS count FROM users').get()?.count ?? 0) === 0) {
  const email = process.env.REMONET_BOOTSTRAP_EMAIL.trim().toLowerCase();
  const password = process.env.REMONET_BOOTSTRAP_PASSWORD;
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('REMONET_BOOTSTRAP_EMAIL must be a valid email address');
  if (password.length < 12) throw new Error('REMONET_BOOTSTRAP_PASSWORD must contain at least 12 characters');
  const organizationId = process.env.REMONET_BOOTSTRAP_ORGANIZATION_ID ?? 'org-remonet';
  const organizationName = process.env.REMONET_BOOTSTRAP_ORGANIZATION_NAME ?? 'RemoNet Workspace';
  insertOrganization.run(organizationId, organizationName);
  const teamId = `team-bootstrap-${organizationId}`;
  insertTeam.run(teamId, organizationId, 'Owners');
  insertUser.run('user-bootstrap', email, process.env.REMONET_BOOTSTRAP_DISPLAY_NAME ?? email, hashPassword(password), seededAt);
  insertMembership.run('user-bootstrap', teamId, 'owner', seededAt);
}

export function closeStore() { db.close(); }

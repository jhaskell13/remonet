import type { AccessRole } from '../../../shared/network.ts';
import { hashPassword } from '../../../server/passwords.ts';
import { db } from '../../../server/persistence/database.ts';
import { areas, devices, networks, organizations, teams } from '../../../server/persistence/demo-fixtures.ts';

/**
 * Deterministic seed for the server test suite.
 *
 * Organizations, networks, areas, devices, and the primary team of each organization come from the
 * project's own demo fixtures so tests exercise the same shapes the UI renders. Accounts and
 * memberships are test-only and cover every role plus the two cross-cutting cases the authorization
 * model has to get right: one engineer in several teams of one organization, and one engineer in
 * several organizations with a different role in each.
 */
export const testPassword = 'TestPassword2026!';

export const extraTeams = [
  { id: 'team-northstar-field', organizationId: 'org-demo', name: 'Field Engineering' },
];

export const users = {
  nsOwner: { id: 'user-ns-owner', email: 'owner@northstar.test', displayName: 'Northstar Owner' },
  nsAdmin: { id: 'user-ns-admin', email: 'admin@northstar.test', displayName: 'Northstar Admin' },
  nsOperator: { id: 'user-ns-operator', email: 'operator@northstar.test', displayName: 'Northstar Operator' },
  nsViewer: { id: 'user-ns-viewer', email: 'viewer@northstar.test', displayName: 'Northstar Viewer' },
  /** Viewer in Network Operations but admin in Field Engineering (both org-demo). */
  nsMultiTeam: { id: 'user-ns-multi-team', email: 'field-lead@northstar.test', displayName: 'Field Lead' },
  /** Admin in org-demo and operator in org-acme; no access to org-solo. */
  multiOrg: { id: 'user-multi-org', email: 'consultant@remonet.test', displayName: 'Consultant' },
  acmeOwner: { id: 'user-acme-owner', email: 'owner@acme.test', displayName: 'Acme Owner' },
  acmeViewer: { id: 'user-acme-viewer', email: 'viewer@acme.test', displayName: 'Acme Viewer' },
  soloOwner: { id: 'user-solo-owner', email: 'owner@solo.test', displayName: 'Solo Owner' },
  /** Deactivated owner; must not be able to sign in or use a session. */
  nsInactive: { id: 'user-ns-inactive', email: 'inactive@northstar.test', displayName: 'Former Owner' },
} as const;

export type TestUser = (typeof users)[keyof typeof users];

export const memberships: { userId: string; teamId: string; role: AccessRole }[] = [
  { userId: users.nsOwner.id, teamId: 'team-northstar', role: 'owner' },
  { userId: users.nsAdmin.id, teamId: 'team-northstar', role: 'admin' },
  { userId: users.nsOperator.id, teamId: 'team-northstar', role: 'operator' },
  { userId: users.nsViewer.id, teamId: 'team-northstar', role: 'viewer' },
  { userId: users.nsMultiTeam.id, teamId: 'team-northstar', role: 'viewer' },
  { userId: users.nsMultiTeam.id, teamId: 'team-northstar-field', role: 'admin' },
  { userId: users.multiOrg.id, teamId: 'team-northstar', role: 'admin' },
  { userId: users.multiOrg.id, teamId: 'team-acme', role: 'operator' },
  { userId: users.acmeOwner.id, teamId: 'team-acme', role: 'owner' },
  { userId: users.acmeViewer.id, teamId: 'team-acme', role: 'viewer' },
  { userId: users.soloOwner.id, teamId: 'team-solo', role: 'owner' },
  { userId: users.nsInactive.id, teamId: 'team-northstar', role: 'owner' },
];

export const inactiveUserIds = new Set<string>([users.nsInactive.id]);

let passwordHash: string | undefined;
export function testPasswordHash() {
  passwordHash ??= hashPassword(testPassword);
  return passwordHash;
}

/** Inserts the fixture graph into an empty, migrated database. */
export function seedTestData() {
  const seededAt = '2026-01-01T00:00:00.000Z';
  const insertOrganization = db.prepare('INSERT INTO organizations (id, name) VALUES (?, ?)');
  const insertNetwork = db.prepare(
    'INSERT INTO networks (id, organization_id, name, description) VALUES (?, ?, ?, ?)',
  );
  const insertArea = db.prepare(
    'INSERT INTO areas (id, organization_id, network_id, name, region) VALUES (?, ?, ?, ?, ?)',
  );
  const insertDevice = db.prepare(
    'INSERT INTO devices (id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  );
  const insertTeam = db.prepare('INSERT INTO teams (id, organization_id, name) VALUES (?, ?, ?)');
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, display_name, password_hash, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  );
  const insertMembership = db.prepare(
    'INSERT INTO team_memberships (user_id, team_id, role, created_at) VALUES (?, ?, ?, ?)',
  );

  db.transaction(() => {
    for (const row of organizations) insertOrganization.run(row.id, row.name);
    for (const row of networks) insertNetwork.run(row.id, row.organizationId, row.name, row.description);
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
    for (const row of [...teams, ...extraTeams]) insertTeam.run(row.id, row.organizationId, row.name);
    for (const user of Object.values(users))
      insertUser.run(
        user.id,
        user.email,
        user.displayName,
        testPasswordHash(),
        inactiveUserIds.has(user.id) ? 0 : 1,
        seededAt,
      );
    for (const row of memberships) insertMembership.run(row.userId, row.teamId, row.role, seededAt);
  })();
}

/** Convenient lookups into the demo fixtures, by organization. */
export const fixtures = {
  organizations,
  networks,
  areas,
  devices,
  teams: [...teams, ...extraTeams],
  demo: {
    organizationId: 'org-demo',
    teamId: 'team-northstar',
    secondTeamId: 'team-northstar-field',
    coreNetworkId: 'net-core',
    branchNetworkId: 'net-branch',
    dataCenterAreaId: 'area-dc',
    northCampusAreaId: 'area-north',
    westWarehouseAreaId: 'area-west',
    eastOfficeAreaId: 'area-east',
    coreRouterId: 'RTR-001',
    edgeFirewallId: 'FW-002',
    branchGatewayId: 'RTR-008',
  },
  acme: {
    organizationId: 'org-acme',
    teamId: 'team-acme',
    networkId: 'net-acme',
    plantAreaId: 'area-acme-plant',
    officeAreaId: 'area-acme-office',
    routerId: 'AC-RTR-01',
    switchId: 'AC-SW-12',
  },
  solo: {
    organizationId: 'org-solo',
    teamId: 'team-solo',
    networkId: 'net-solo',
    labAreaId: 'area-solo-lab',
    routerId: 'SOLO-RTR-01',
    switchId: 'SOLO-SW-01',
  },
} as const;

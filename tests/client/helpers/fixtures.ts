import { vi } from 'vitest';
import type {
  Area,
  Device,
  Network,
  NetworkOverview,
  OrganizationMember,
  PendingInvitation,
  Team,
} from '../../../shared/network.ts';
import type { OrganizationMembership, Session } from '../../../src/types.ts';

/** A small organization with every role represented, mirroring the server fixtures' shape. */
export const organizationId = 'org-demo';

export const teams: Team[] = [
  { id: 'team-field', organizationId, name: 'Field Engineering' },
  { id: 'team-ops', organizationId, name: 'Network Operations' },
];

export const members: OrganizationMember[] = [
  {
    userId: 'user-owner',
    email: 'owner@northstar.test',
    displayName: 'Northstar Owner',
    isActive: true,
    role: 'owner',
    teams: [
      {
        teamId: 'team-ops',
        teamName: 'Network Operations',
        role: 'owner',
        since: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    userId: 'user-admin',
    email: 'admin@northstar.test',
    displayName: 'Northstar Admin',
    isActive: true,
    role: 'admin',
    teams: [
      {
        teamId: 'team-ops',
        teamName: 'Network Operations',
        role: 'admin',
        since: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    userId: 'user-operator',
    email: 'operator@northstar.test',
    displayName: 'Northstar Operator',
    isActive: true,
    role: 'operator',
    teams: [
      {
        teamId: 'team-ops',
        teamName: 'Network Operations',
        role: 'operator',
        since: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
  {
    userId: 'user-viewer',
    email: 'viewer@northstar.test',
    displayName: 'Northstar Viewer',
    isActive: true,
    role: 'viewer',
    teams: [
      {
        teamId: 'team-ops',
        teamName: 'Network Operations',
        role: 'viewer',
        since: '2026-01-01T00:00:00.000Z',
      },
    ],
  },
];

export const invitations: PendingInvitation[] = [
  {
    id: 'inv-1',
    email: 'newcomer@northstar.test',
    organizationId,
    teamId: 'team-ops',
    teamName: 'Network Operations',
    role: 'viewer',
    invitedBy: { id: 'user-owner', displayName: 'Northstar Owner' },
    createdAt: '2026-01-01T00:00:00.000Z',
    expiresAt: '2026-01-08T00:00:00.000Z',
  },
];

export const networks: Network[] = [
  { id: 'net-core', organizationId, name: 'Core Network', description: 'Data center and campus' },
  { id: 'net-branch', organizationId, name: 'Branch Network', description: '' },
  { id: 'net-acme', organizationId: 'org-acme', name: 'Plant Network', description: 'Manufacturing plant' },
];

export const areas: Area[] = [
  { id: 'area-dc', organizationId, networkId: 'net-core', name: 'Data Center', region: 'New York, US' },
  { id: 'area-north', organizationId, networkId: 'net-core', name: 'North Campus', region: 'Boston, US' },
  { id: 'area-empty', organizationId, networkId: 'net-core', name: 'Spare Rack', region: 'Boston, US' },
];

const telemetry = { uptime: '1d 00h', latency: 4, load: 10, lastSeen: '2026-10-12T13:40:00.000Z' };
export const devices: Device[] = [
  {
    id: 'RTR-001',
    organizationId,
    networkId: 'net-core',
    areaId: 'area-north',
    name: 'Core Router 01',
    type: 'Router',
    address: '10.20.0.1',
    status: 'Healthy',
    ...telemetry,
  },
  {
    id: 'FW-002',
    organizationId,
    networkId: 'net-core',
    areaId: 'area-dc',
    name: 'Edge Firewall',
    type: 'Firewall',
    address: '10.10.0.2',
    status: 'Warning',
    ...telemetry,
    latency: 28,
  },
  {
    id: 'AP-037',
    organizationId,
    networkId: 'net-core',
    areaId: 'area-dc',
    name: 'Lobby Access Point',
    type: 'Access point',
    address: '10.10.3.37',
    status: 'Offline',
    ...telemetry,
    latency: 0,
  },
  {
    id: 'SW-050',
    organizationId,
    networkId: 'net-core',
    areaId: 'area-dc',
    name: 'New Switch',
    type: 'Switch',
    address: '10.10.2.50',
    status: 'Pending',
    uptime: 'Not measured',
    latency: 0,
    load: 0,
    lastSeen: null,
  },
];

export const overview: NetworkOverview = {
  totalDevices: 4,
  online: 1,
  healthy: 1,
  warning: 1,
  needsAttention: 3,
  offline: 1,
  pending: 1,
  healthScore: 33.33,
  areas: 3,
  updatedAt: '2026-10-12T13:40:00.000Z',
};

export const organizations: OrganizationMembership[] = [
  { id: 'org-acme', name: 'Acme Manufacturing', role: 'operator' },
  { id: organizationId, name: 'Northstar Engineering', role: 'admin' },
];

export function sessionFor(userId: string, role: OrganizationMembership['role']): Session {
  const member = members.find((candidate) => candidate.userId === userId)!;
  return {
    user: { id: member.userId, email: member.email, displayName: member.displayName },
    organizations: organizations.map((organization) =>
      organization.id === organizationId ? { ...organization, role } : organization,
    ),
  };
}

/** A mocked `api` module with resolved defaults; tests override individual calls as needed. */
export function mockApi() {
  return {
    currentSession: vi.fn(),
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue({ ok: true }),
    inspectInvitation: vi.fn(),
    acceptInvitation: vi.fn(),
    createInvitation: vi
      .fn()
      .mockResolvedValue({ inviteUrl: 'http://127.0.0.1:5173/#invite=t', email: 'x', expiresAt: '' }),
    pendingInvitations: vi.fn().mockResolvedValue({ data: invitations }),
    revokeInvitation: vi.fn().mockResolvedValue({ data: { ok: true } }),
    teams: vi.fn().mockResolvedValue({ data: teams }),
    createTeam: vi.fn().mockResolvedValue({ data: teams[0] }),
    updateTeam: vi.fn().mockResolvedValue({ data: teams[0] }),
    deleteTeam: vi.fn().mockResolvedValue({ data: { ok: true } }),
    organizations: vi.fn().mockResolvedValue({ data: organizations }),
    createOrganization: vi.fn().mockResolvedValue({
      data: {
        id: 'org-new',
        name: 'New Org',
        role: 'owner',
        team: { id: 'team-new', organizationId: 'org-new', name: 'Owners' },
      },
    }),
    updateOrganization: vi.fn().mockResolvedValue({ data: { id: organizationId, name: 'Renamed' } }),
    members: vi.fn().mockResolvedValue({ data: members }),
    addMember: vi.fn().mockResolvedValue({ data: members[0] }),
    changeMemberRole: vi.fn().mockResolvedValue({ data: members[0] }),
    removeMember: vi.fn().mockResolvedValue({ data: { ok: true } }),
    audit: vi.fn().mockResolvedValue({ data: [] }),
    networks: vi
      .fn()
      .mockResolvedValue({ data: networks.filter((network) => network.organizationId === organizationId) }),
    createNetwork: vi.fn().mockResolvedValue({ data: networks[0] }),
    updateNetwork: vi.fn().mockResolvedValue({ data: networks[0] }),
    createArea: vi.fn().mockResolvedValue({ data: areas[0] }),
    updateArea: vi.fn().mockResolvedValue({ data: areas[0] }),
    deleteArea: vi.fn().mockResolvedValue({ data: { ok: true } }),
    enrollDevice: vi.fn().mockResolvedValue({ data: devices[0] }),
    updateDevice: vi.fn().mockResolvedValue({ data: devices[0] }),
    deleteDevice: vi.fn().mockResolvedValue({ data: { ok: true } }),
    areas: vi.fn().mockResolvedValue({ data: areas }),
    devices: vi.fn().mockResolvedValue({ data: devices }),
    overview: vi.fn().mockResolvedValue({ data: overview }),
  };
}

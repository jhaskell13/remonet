import type {
  AccessRole,
  Area,
  AuditEvent,
  Device,
  DeviceType,
  Network,
  NetworkOverview,
  Organization,
  OrganizationMember,
  PendingInvitation,
  Team,
} from '../../shared/network.ts';
import type { Invitation, Session } from '../types.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'same-origin',
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(body?.error ?? 'The request could not be completed.', response.status);
  return body as T;
}

function queryString(filters: Record<string, string | undefined>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value) query.set(key, value);
  }
  const serialized = query.toString();
  return serialized ? `?${serialized}` : '';
}

export const api = {
  currentSession: () => request<Session>('/api/auth/me'),
  login: (email: string, password: string) =>
    request<Session>('/api/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  logout: () => request<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  inspectInvitation: (token: string) =>
    request<{ data: Omit<Invitation, 'token'> & { id: string; organizationId: string; teamId: string } }>(
      '/api/invitations/inspect',
      { method: 'POST', body: JSON.stringify({ token }) },
    ),
  acceptInvitation: (input: { token: string; displayName?: string; password?: string }) =>
    request<Session>('/api/invitations/accept', { method: 'POST', body: JSON.stringify(input) }),
  createInvitation: (input: {
    organizationId: string;
    teamId: string;
    email: string;
    role: 'admin' | 'operator' | 'viewer';
  }) =>
    request<{ inviteUrl: string; email: string; expiresAt: string }>('/api/invitations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  pendingInvitations: (organizationId: string) =>
    request<{ data: PendingInvitation[] }>(`/api/invitations${queryString({ organizationId })}`),
  revokeInvitation: (invitationId: string, organizationId: string) =>
    request<{ data: { ok: true } }>(
      `/api/invitations/${encodeURIComponent(invitationId)}${queryString({ organizationId })}`,
      { method: 'DELETE' },
    ),
  teams: (organizationId: string) =>
    request<{ data: Team[] }>(`/api/teams${queryString({ organizationId })}`),
  createTeam: (input: { organizationId: string; name: string }) =>
    request<{ data: Team }>('/api/teams', { method: 'POST', body: JSON.stringify(input) }),
  updateTeam: (teamId: string, input: { organizationId: string; name: string }) =>
    request<{ data: Team }>(`/api/teams/${encodeURIComponent(teamId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteTeam: (teamId: string, organizationId: string) =>
    request<{ data: { ok: true } }>(
      `/api/teams/${encodeURIComponent(teamId)}${queryString({ organizationId })}`,
      {
        method: 'DELETE',
      },
    ),
  organizations: () => request<{ data: Organization[] }>('/api/organizations'),
  createOrganization: (input: { name: string; teamName?: string }) =>
    request<{ data: Organization & { role: 'owner'; team: Team } }>('/api/organizations', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateOrganization: (organizationId: string, input: { name: string }) =>
    request<{ data: Organization }>(`/api/organizations/${encodeURIComponent(organizationId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  members: (organizationId: string) =>
    request<{ data: OrganizationMember[] }>(
      `/api/organizations/${encodeURIComponent(organizationId)}/members`,
    ),
  addMember: (teamId: string, input: { organizationId: string; userId: string; role: AccessRole }) =>
    request<{ data: OrganizationMember }>(`/api/teams/${encodeURIComponent(teamId)}/members`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  changeMemberRole: (teamId: string, userId: string, input: { organizationId: string; role: AccessRole }) =>
    request<{ data: OrganizationMember }>(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`,
      { method: 'PATCH', body: JSON.stringify(input) },
    ),
  removeMember: (teamId: string, userId: string, organizationId: string) =>
    request<{ data: { ok: true } }>(
      `/api/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}${queryString({ organizationId })}`,
      { method: 'DELETE' },
    ),
  audit: (filters: { organizationId?: string; limit?: number } = {}) =>
    request<{ data: AuditEvent[] }>(
      `/api/audit${queryString({ organizationId: filters.organizationId, limit: filters.limit?.toString() })}`,
    ),
  networks: (filters: { organizationId?: string } = {}) =>
    request<{ data: Network[] }>(`/api/networks${queryString(filters)}`),
  createNetwork: (input: { organizationId: string; name: string; description: string }) =>
    request<{ data: Network }>('/api/networks', { method: 'POST', body: JSON.stringify(input) }),
  updateNetwork: (networkId: string, input: { organizationId: string; name: string; description: string }) =>
    request<{ data: Network }>(`/api/networks/${encodeURIComponent(networkId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  createArea: (input: { organizationId: string; networkId: string; name: string; region: string }) =>
    request<{ data: Area }>('/api/areas', { method: 'POST', body: JSON.stringify(input) }),
  updateArea: (
    areaId: string,
    input: { organizationId: string; networkId: string; name: string; region: string },
  ) =>
    request<{ data: Area }>(`/api/areas/${encodeURIComponent(areaId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteArea: (areaId: string, input: { organizationId: string; networkId: string }) =>
    request<{ data: { ok: true } }>(`/api/areas/${encodeURIComponent(areaId)}${queryString(input)}`, {
      method: 'DELETE',
    }),
  enrollDevice: (input: {
    organizationId: string;
    networkId: string;
    areaId: string;
    name: string;
    type: DeviceType;
    address: string;
  }) => request<{ data: Device }>('/api/devices', { method: 'POST', body: JSON.stringify(input) }),
  updateDevice: (
    deviceId: string,
    input: {
      organizationId: string;
      networkId: string;
      areaId: string;
      name: string;
      type: DeviceType;
      address: string;
    },
  ) =>
    request<{ data: Device }>(`/api/devices/${encodeURIComponent(deviceId)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteDevice: (deviceId: string, organizationId: string) =>
    request<{ data: { ok: true } }>(
      `/api/devices/${encodeURIComponent(deviceId)}${queryString({ organizationId })}`,
      { method: 'DELETE' },
    ),
  areas: (filters: { organizationId?: string; networkId?: string } = {}) =>
    request<{ data: Area[] }>(`/api/areas${queryString(filters)}`),
  devices: (filters: { organizationId?: string; networkId?: string } = {}) =>
    request<{ data: Device[] }>(`/api/devices${queryString(filters)}`),
  overview: (filters: { organizationId?: string; networkId?: string } = {}) =>
    request<{ data: NetworkOverview }>(`/api/overview${queryString(filters)}`),
};

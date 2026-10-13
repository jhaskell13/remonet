import type { Area, Device, Network, NetworkOverview, Organization, Team } from '../../shared/network.ts';
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
  teams: (organizationId: string) =>
    request<{ data: Team[] }>(`/api/teams${queryString({ organizationId })}`),
  organizations: () => request<{ data: Organization[] }>('/api/organizations'),
  networks: (filters: { organizationId?: string } = {}) =>
    request<{ data: Network[] }>(`/api/networks${queryString(filters)}`),
  areas: (filters: { organizationId?: string; networkId?: string } = {}) =>
    request<{ data: Area[] }>(`/api/areas${queryString(filters)}`),
  devices: (filters: { organizationId?: string; networkId?: string } = {}) =>
    request<{ data: Device[] }>(`/api/devices${queryString(filters)}`),
  overview: (filters: { organizationId?: string; networkId?: string } = {}) =>
    request<{ data: NetworkOverview }>(`/api/overview${queryString(filters)}`),
};

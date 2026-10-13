import type { Area, Device, Network, Organization, Team } from '../../src/data.ts';

export type Scope = { organizationIds?: string[]; organizationId?: string; networkId?: string; areaId?: string };
export type AccessRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type OrganizationAccess = Organization & { role: AccessRole };
export type UserRecord = { id: string; email: string; displayName: string; passwordHash: string; isActive: boolean };
export type InvitationRecord = { id: string; email: string; organizationId: string; organizationName: string; teamId: string; teamName: string; role: Exclude<AccessRole, 'owner'>; expiresAt: string; accountExists: boolean };
export type { Area, Device, Network, Organization, Team };

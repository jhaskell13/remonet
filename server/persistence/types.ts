import type {
  AccessRole,
  Area,
  Device,
  Network,
  Organization,
  OrganizationMembership,
  Team,
} from '../../shared/network.ts';

export type Scope = {
  organizationIds?: string[];
  organizationId?: string;
  networkId?: string;
  areaId?: string;
};
export type OrganizationAccess = OrganizationMembership;
export type UserRecord = {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  isActive: boolean;
};
export type InvitationRecord = {
  id: string;
  email: string;
  organizationId: string;
  organizationName: string;
  teamId: string;
  teamName: string;
  role: Exclude<AccessRole, 'owner'>;
  expiresAt: string;
  accountExists: boolean;
};
export type { AccessRole };
export type { Area, Device, Network, Organization, Team };

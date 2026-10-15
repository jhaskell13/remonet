import type {
  AccessRole,
  Area,
  AuditEvent,
  Device,
  DeviceObservation,
  Network,
  Organization,
  OrganizationMember,
  OrganizationMembership,
  PendingInvitation,
  Team,
  TeamMembership,
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
export type {
  Area,
  AuditEvent,
  Device,
  DeviceObservation,
  Network,
  Organization,
  OrganizationMember,
  PendingInvitation,
  Team,
  TeamMembership,
};

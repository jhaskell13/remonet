export type DeviceStatus = 'Pending' | 'Healthy' | 'Warning' | 'Offline';
export type DeviceType = 'Router' | 'Switch' | 'Firewall' | 'Access point' | 'Other';
export type Organization = { id: string; name: string };
export type Network = { id: string; organizationId: string; name: string; description: string };
export type Area = { id: string; organizationId: string; networkId: string; name: string; region: string };
export type Device = {
  id: string;
  organizationId: string;
  networkId: string;
  areaId: string;
  name: string;
  type: DeviceType;
  address: string;
  status: DeviceStatus;
  uptime: string;
  latency: number;
  load: number;
  lastSeen: string | null;
};
export type Team = { id: string; organizationId: string; name: string };
export type AccessRole = 'owner' | 'admin' | 'operator' | 'viewer';
export type OrganizationMembership = Organization & { role: AccessRole };
export type TeamMembership = { teamId: string; teamName: string; role: AccessRole; since: string };
/** One person in an organization: a single account, possibly in several teams. */
export type OrganizationMember = {
  userId: string;
  email: string;
  displayName: string;
  isActive: boolean;
  /** Highest role across the member's teams in this organization. */
  role: AccessRole;
  teams: TeamMembership[];
};
export type PendingInvitation = {
  id: string;
  email: string;
  organizationId: string;
  teamId: string;
  teamName: string;
  role: Exclude<AccessRole, 'owner'>;
  invitedBy: { id: string; displayName: string };
  createdAt: string;
  expiresAt: string;
};
export type AreaSummary = Area & {
  totalDevices: number;
  healthy: number;
  status: 'Operational' | 'Degraded';
};
export type NetworkOverview = {
  totalDevices: number;
  online: number;
  healthy: number;
  warning: number;
  needsAttention: number;
  offline: number;
  pending: number;
  healthScore: number;
  areas: number;
  updatedAt: string;
};
export type AuditAction =
  | 'organization.created'
  | 'organization.updated'
  | 'team.created'
  | 'team.updated'
  | 'team.deleted'
  | 'network.created'
  | 'network.updated'
  | 'area.created'
  | 'area.updated'
  | 'area.deleted'
  | 'device.enrolled'
  | 'device.updated'
  | 'device.deleted'
  | 'membership.invited'
  | 'membership.accepted'
  | 'membership.invitation_revoked'
  | 'membership.added'
  | 'membership.role_changed'
  | 'membership.removed';
export type AuditEntityType = 'organization' | 'team' | 'network' | 'area' | 'device' | 'membership';
export type AuditEvent = {
  id: string;
  organizationId: string;
  actorId: string;
  actorEmail: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  details: Record<string, unknown>;
  createdAt: string;
};

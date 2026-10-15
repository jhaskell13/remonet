export type DeviceStatus = 'Pending' | 'Healthy' | 'Warning' | 'Offline';
export type DeviceType = 'Router' | 'Switch' | 'Firewall' | 'Access point' | 'Other';
export type Organization = { id: string; name: string };
export type Network = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  /** Whether collectors check this network's devices. */
  monitoringEnabled: boolean;
  /** Seconds between collection cycles for this network (5–3600). */
  pollIntervalSeconds: number;
};
export const pollIntervalBounds = Object.freeze({ min: 5, max: 3_600, default: 60 });
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
  /** Why the device has its status right now, in one line. */
  statusReason: string;
  uptime: string;
  latency: number;
  load: number;
  lastSeen: string | null;
};
/** Where an observation came from. Each collector implementation reports under one source. */
export type ObservationSource = 'simulator' | 'manual';
export type ObservationResult = 'success' | 'timeout' | 'error';
/** One timestamped check of a device. Measurements are present only when the check succeeded. */
export type DeviceObservation = {
  id: string;
  organizationId: string;
  networkId: string;
  deviceId: string;
  source: ObservationSource;
  result: ObservationResult;
  latencyMs: number | null;
  loadPercent: number | null;
  uptimeSeconds: number | null;
  errorMessage: string | null;
  collectedAt: string;
  createdAt: string;
};
/** One completed collection cycle of a network. */
export type CollectionCycleSummary = {
  networkId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  devices: number;
  success: number;
  timeout: number;
  error: number;
  /** Extra attempts made beyond the first one per device. */
  retries: number;
  /** Results that could not be recorded (for example the device was deleted mid-cycle). */
  dropped: number;
};
export type NetworkCollectionState = {
  networkId: string;
  organizationId: string;
  name: string;
  enabled: boolean;
  pollIntervalSeconds: number;
  running: boolean;
  nextRunAt: string | null;
  lastCycle: CollectionCycleSummary | null;
  lastError: string | null;
};
export type CollectionStatus = {
  /** The configured collector, or `off` when nothing collects. */
  collector: string;
  running: boolean;
  inFlight: number;
  networks: NetworkCollectionState[];
};
/** Pushed to dashboards over `/api/monitoring/events` as server-sent events. */
export type MonitoringEvent =
  | {
      type: 'observation';
      organizationId: string;
      networkId: string;
      deviceId: string;
      device: Device;
      observation: DeviceObservation;
    }
  | {
      type: 'inventory';
      organizationId: string;
      networkId: string | null;
      entityType: 'network' | 'area' | 'device';
      entityId: string;
      action: 'created' | 'updated' | 'deleted';
    }
  | {
      type: 'cycle';
      organizationId: string;
      networkId: string;
      devices: number;
      success: number;
      timeout: number;
      error: number;
      completedAt: string;
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
  /** When the most recent check in scope was collected, or null when nothing has reported yet. */
  updatedAt: string | null;
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

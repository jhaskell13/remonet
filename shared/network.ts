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

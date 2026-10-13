export type DeviceStatus = 'Healthy' | 'Warning' | 'Offline';
export type Organization = { id: string; name: string };
export type Network = { id: string; organizationId: string; name: string; description: string };
export type Area = { id: string; organizationId: string; networkId: string; name: string; region: string };
export type Device = {
  id: string;
  organizationId: string;
  networkId: string;
  areaId: string;
  name: string;
  type: string;
  address: string;
  status: DeviceStatus;
  uptime: string;
  latency: number;
  load: number;
  lastSeen: string;
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
  healthScore: number;
  areas: number;
  updatedAt: string;
};

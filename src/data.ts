export type DeviceStatus = 'Healthy' | 'Warning' | 'Offline';
export type Organization = { id: string; name: string };
export type Network = { id: string; organizationId: string; name: string; description: string };
export type Area = { id: string; organizationId: string; networkId: string; name: string; region: string };
export type Device = { id: string; organizationId: string; networkId: string; areaId: string; name: string; type: string; address: string; status: DeviceStatus; uptime: string; latency: number; load: number; lastSeen: string };

export const organizations: Organization[] = [
  { id: 'org-demo', name: 'Northstar Engineering' },
  { id: 'org-acme', name: 'Acme Manufacturing' },
  { id: 'org-solo', name: "Jordan's Personal Network" }
];
export const networks: Network[] = [
  { id: 'net-core', organizationId: 'org-demo', name: 'Core Network', description: 'Data center and campus infrastructure' },
  { id: 'net-branch', organizationId: 'org-demo', name: 'Branch Network', description: 'Remote offices and warehouse' },
  { id: 'net-acme', organizationId: 'org-acme', name: 'Plant Network', description: 'Manufacturing plant and office' },
  { id: 'net-solo', organizationId: 'org-solo', name: 'Home Lab', description: 'Personal lab and remote access' }
];
export const areas: Area[] = [
  { id: 'area-dc', organizationId: 'org-demo', networkId: 'net-core', name: 'Data Center', region: 'New York, US' },
  { id: 'area-north', organizationId: 'org-demo', networkId: 'net-core', name: 'North Campus', region: 'Boston, US' },
  { id: 'area-west', organizationId: 'org-demo', networkId: 'net-branch', name: 'West Warehouse', region: 'Chicago, US' },
  { id: 'area-east', organizationId: 'org-demo', networkId: 'net-branch', name: 'East Office', region: 'London, UK' },
  { id: 'area-acme-plant', organizationId: 'org-acme', networkId: 'net-acme', name: 'Riverside Plant', region: 'Cleveland, US' },
  { id: 'area-acme-office', organizationId: 'org-acme', networkId: 'net-acme', name: 'Operations Office', region: 'Cleveland, US' },
  { id: 'area-solo-lab', organizationId: 'org-solo', networkId: 'net-solo', name: 'Home Lab', region: 'Personal' }
];
export const devices: Device[] = [
  { id: 'RTR-001', organizationId: 'org-demo', networkId: 'net-core', areaId: 'area-north', name: 'Core Router 01', type: 'Router', address: '10.20.0.1', status: 'Healthy', uptime: '42d 06h', latency: 4, load: 32, lastSeen: '2026-10-12T13:40:00.000Z' },
  { id: 'SW-014', organizationId: 'org-demo', networkId: 'net-core', areaId: 'area-north', name: 'Distribution Switch A', type: 'Switch', address: '10.20.1.14', status: 'Healthy', uptime: '18d 12h', latency: 8, load: 48, lastSeen: '2026-10-12T13:40:00.000Z' },
  { id: 'FW-002', organizationId: 'org-demo', networkId: 'net-core', areaId: 'area-dc', name: 'Edge Firewall', type: 'Firewall', address: '10.10.0.2', status: 'Warning', uptime: '9d 03h', latency: 28, load: 76, lastSeen: '2026-10-12T13:39:00.000Z' },
  { id: 'AP-037', organizationId: 'org-demo', networkId: 'net-branch', areaId: 'area-west', name: 'Warehouse Access Point', type: 'Access point', address: '10.30.3.37', status: 'Offline', uptime: '—', latency: 0, load: 0, lastSeen: '2026-10-12T10:40:00.000Z' },
  { id: 'RTR-008', organizationId: 'org-demo', networkId: 'net-branch', areaId: 'area-east', name: 'Branch Gateway', type: 'Router', address: '10.40.0.1', status: 'Healthy', uptime: '26d 19h', latency: 12, load: 24, lastSeen: '2026-10-12T13:40:00.000Z' },
  { id: 'SW-021', organizationId: 'org-demo', networkId: 'net-core', areaId: 'area-dc', name: 'Access Switch 21', type: 'Switch', address: '10.10.2.21', status: 'Healthy', uptime: '63d 02h', latency: 3, load: 41, lastSeen: '2026-10-12T13:40:00.000Z' },
  { id: 'AC-RTR-01', organizationId: 'org-acme', networkId: 'net-acme', areaId: 'area-acme-plant', name: 'Plant Edge Router', type: 'Router', address: '10.50.0.1', status: 'Healthy', uptime: '31d 08h', latency: 9, load: 38, lastSeen: '2026-10-12T13:40:00.000Z' },
  { id: 'AC-SW-12', organizationId: 'org-acme', networkId: 'net-acme', areaId: 'area-acme-office', name: 'Operations Switch', type: 'Switch', address: '10.50.2.12', status: 'Warning', uptime: '12d 01h', latency: 31, load: 72, lastSeen: '2026-10-12T13:38:00.000Z' },
  { id: 'SOLO-RTR-01', organizationId: 'org-solo', networkId: 'net-solo', areaId: 'area-solo-lab', name: 'Lab Gateway', type: 'Router', address: '192.168.1.1', status: 'Healthy', uptime: '7d 04h', latency: 2, load: 18, lastSeen: '2026-10-12T13:40:00.000Z' },
  { id: 'SOLO-SW-01', organizationId: 'org-solo', networkId: 'net-solo', areaId: 'area-solo-lab', name: 'Lab Switch', type: 'Switch', address: '192.168.1.2', status: 'Healthy', uptime: '7d 04h', latency: 1, load: 12, lastSeen: '2026-10-12T13:40:00.000Z' }
];

export type Team = { id: string; organizationId: string; name: string };
export const teams: Team[] = [
  { id: 'team-northstar', organizationId: 'org-demo', name: 'Network Operations' },
  { id: 'team-acme', organizationId: 'org-acme', name: 'Infrastructure Team' },
  { id: 'team-solo', organizationId: 'org-solo', name: 'Personal' }
];

export type AreaSummary = Area & { totalDevices: number; healthy: number; status: 'Operational' | 'Degraded' };
export function getAreaSummaries(deviceList: Device[] = devices, areaList: Area[] = areas): AreaSummary[] {
  return areaList.map(area => {
    const areaDevices = deviceList.filter(device => device.areaId === area.id);
    const healthy = areaDevices.filter(device => device.status === 'Healthy').length;
    return { ...area, totalDevices: areaDevices.length, healthy, status: healthy === areaDevices.length ? 'Operational' : 'Degraded' };
  });
}
export function getOverview(deviceList: Device[] = devices, areaList: Area[] = areas) {
  const healthy = deviceList.filter(device => device.status === 'Healthy').length;
  const warning = deviceList.filter(device => device.status === 'Warning').length;
  const offline = deviceList.filter(device => device.status === 'Offline').length;
  return { totalDevices: deviceList.length, online: healthy, healthy, warning, needsAttention: warning + offline, offline, healthScore: deviceList.length ? Number((healthy / deviceList.length * 100).toFixed(2)) : 0, areas: areaList.length, updatedAt: new Date().toISOString() };
}


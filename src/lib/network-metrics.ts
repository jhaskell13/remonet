import type { Area, AreaSummary, Device, NetworkOverview } from '../../shared/network.ts';

export function getAreaSummaries(deviceList: Device[], areaList: Area[]): AreaSummary[] {
  return areaList.map((area) => {
    const areaDevices = deviceList.filter((device) => device.areaId === area.id);
    const healthy = areaDevices.filter((device) => device.status === 'Healthy').length;
    return {
      ...area,
      totalDevices: areaDevices.length,
      healthy,
      status: healthy === areaDevices.length ? 'Operational' : 'Degraded',
    };
  });
}

export function getOverview(deviceList: Device[], areaList: Area[]): NetworkOverview {
  const healthy = deviceList.filter((device) => device.status === 'Healthy').length;
  const warning = deviceList.filter((device) => device.status === 'Warning').length;
  const offline = deviceList.filter((device) => device.status === 'Offline').length;
  const pending = deviceList.filter((device) => device.status === 'Pending').length;
  return {
    totalDevices: deviceList.length,
    online: healthy,
    healthy,
    warning,
    needsAttention: warning + offline + pending,
    offline,
    pending,
    healthScore:
      deviceList.length > pending ? Number(((healthy / (deviceList.length - pending)) * 100).toFixed(2)) : 0,
    areas: areaList.length,
    updatedAt: deviceList.reduce<string | null>(
      (latest, device) =>
        device.lastSeen !== null && (latest === null || device.lastSeen > latest) ? device.lastSeen : latest,
      null,
    ),
  };
}

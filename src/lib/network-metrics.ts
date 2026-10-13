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
  return {
    totalDevices: deviceList.length,
    online: healthy,
    healthy,
    warning,
    needsAttention: warning + offline,
    offline,
    healthScore: deviceList.length ? Number(((healthy / deviceList.length) * 100).toFixed(2)) : 0,
    areas: areaList.length,
    updatedAt: new Date().toISOString(),
  };
}

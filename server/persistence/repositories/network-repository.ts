import { db } from '../database.ts';
import { where } from '../query.ts';
import type { Area, Device, Network, Scope } from '../types.ts';

export function listNetworks(scope: Scope = {}): Network[] {
  const { sql, values } = where(scope, 'networks');
  return db
    .prepare(
      `SELECT id, organization_id AS organizationId, name, description FROM networks${sql} ORDER BY name`,
    )
    .all(...values) as unknown as Network[];
}
export function listAreas(scope: Scope = {}): Area[] {
  const { sql, values } = where(scope, 'areas');
  return db
    .prepare(
      `SELECT id, organization_id AS organizationId, network_id AS networkId, name, region FROM areas${sql} ORDER BY name`,
    )
    .all(...values) as unknown as Area[];
}
export function listDevices(scope: Scope = {}): Device[] {
  const { sql, values } = where(scope, 'devices');
  return db
    .prepare(
      `SELECT id, organization_id AS organizationId, network_id AS networkId, area_id AS areaId, name, type, address, status, uptime, latency, load, last_seen AS lastSeen FROM devices${sql} ORDER BY name`,
    )
    .all(...values) as unknown as Device[];
}
export function getOverview(scope: Scope = {}) {
  const deviceRows = listDevices(scope);
  const areaRows = listAreas(scope);
  const healthy = deviceRows.filter((device) => device.status === 'Healthy').length;
  const warning = deviceRows.filter((device) => device.status === 'Warning').length;
  const offline = deviceRows.filter((device) => device.status === 'Offline').length;
  return {
    totalDevices: deviceRows.length,
    online: healthy,
    healthy,
    warning,
    needsAttention: warning + offline,
    offline,
    healthScore: deviceRows.length ? Number(((healthy / deviceRows.length) * 100).toFixed(2)) : 0,
    areas: areaRows.length,
    updatedAt: new Date().toISOString(),
  };
}

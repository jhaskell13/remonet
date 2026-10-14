import { db } from '../database.ts';
import { where } from '../query.ts';
import type { Area, Device, Network, Scope } from '../types.ts';
import type { DeviceStatus, DeviceType } from '../../../shared/network.ts';

type NetworkInput = { id: string; organizationId: string; name: string; description: string };

export function listNetworks(scope: Scope = {}): Network[] {
  const { sql, values } = where(scope, 'networks');
  return db
    .prepare(
      `SELECT id, organization_id AS organizationId, name, description FROM networks${sql} ORDER BY name`,
    )
    .all(...values) as unknown as Network[];
}
export function createNetwork(input: NetworkInput): Network {
  db.prepare('INSERT INTO networks (id, organization_id, name, description) VALUES (?, ?, ?, ?)').run(
    input.id,
    input.organizationId,
    input.name,
    input.description,
  );
  return getNetwork(input.id, [input.organizationId])!;
}
export function updateNetwork(id: string, organizationIds: string[], input: Omit<NetworkInput, 'id'>) {
  const placeholders = organizationIds.map(() => '?').join(', ');
  const result = db
    .prepare(
      `UPDATE networks SET name = ?, description = ? WHERE id = ? AND organization_id IN (${placeholders})`,
    )
    .run(input.name, input.description, id, ...organizationIds);
  return result.changes ? getNetwork(id, organizationIds) : undefined;
}
export function getNetwork(id: string, organizationIds: string[]) {
  if (!organizationIds.length) return undefined;
  const placeholders = organizationIds.map(() => '?').join(', ');
  return db
    .prepare(
      `SELECT id, organization_id AS organizationId, name, description FROM networks WHERE id = ? AND organization_id IN (${placeholders})`,
    )
    .get(id, ...organizationIds) as Network | undefined;
}
type AreaInput = { id: string; organizationId: string; networkId: string; name: string; region: string };
export function createArea(input: AreaInput): Area {
  db.prepare('INSERT INTO areas (id, organization_id, network_id, name, region) VALUES (?, ?, ?, ?, ?)').run(
    input.id,
    input.organizationId,
    input.networkId,
    input.name,
    input.region,
  );
  return getArea(input.id, input.organizationId, input.networkId)!;
}
export function updateArea(
  id: string,
  organizationId: string,
  networkId: string,
  name: string,
  region: string,
) {
  const result = db
    .prepare('UPDATE areas SET name = ?, region = ? WHERE id = ? AND organization_id = ? AND network_id = ?')
    .run(name, region, id, organizationId, networkId);
  return result.changes ? getArea(id, organizationId, networkId) : undefined;
}
export function deleteAreaIfEmpty(id: string, organizationId: string, networkId: string) {
  return db
    .prepare(
      'DELETE FROM areas WHERE id = ? AND organization_id = ? AND network_id = ? AND NOT EXISTS (SELECT 1 FROM devices WHERE area_id = ? AND organization_id = ? AND network_id = ?)',
    )
    .run(id, organizationId, networkId, id, organizationId, networkId).changes;
}
export function getArea(id: string, organizationId: string, networkId: string) {
  return db
    .prepare(
      'SELECT id, organization_id AS organizationId, network_id AS networkId, name, region FROM areas WHERE id = ? AND organization_id = ? AND network_id = ?',
    )
    .get(id, organizationId, networkId) as Area | undefined;
}
type NewDevice = {
  id: string;
  organizationId: string;
  networkId: string;
  areaId: string;
  name: string;
  type: DeviceType;
  address: string;
};
export function createDevice(input: NewDevice): Device {
  const status: DeviceStatus = 'Pending';
  db.prepare(
    'INSERT INTO devices (id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)',
  ).run(
    input.id,
    input.organizationId,
    input.networkId,
    input.areaId,
    input.name,
    input.type,
    input.address,
    status,
    'Not measured',
    0,
    0,
  );
  return db
    .prepare(
      'SELECT id, organization_id AS organizationId, network_id AS networkId, area_id AS areaId, name, type, address, status, uptime, latency, load, last_seen AS lastSeen FROM devices WHERE id = ? AND organization_id = ? AND network_id = ? AND area_id = ?',
    )
    .get(input.id, input.organizationId, input.networkId, input.areaId) as Device;
}
export function updateDevice(input: Omit<NewDevice, 'id'> & { id: string }): Device | undefined {
  const result = db
    .prepare(
      "UPDATE devices SET area_id = ?, name = ?, type = ?, status = CASE WHEN address <> ? COLLATE NOCASE THEN 'Pending' ELSE status END, uptime = CASE WHEN address <> ? COLLATE NOCASE THEN 'Not measured' ELSE uptime END, latency = CASE WHEN address <> ? COLLATE NOCASE THEN 0 ELSE latency END, load = CASE WHEN address <> ? COLLATE NOCASE THEN 0 ELSE load END, last_seen = CASE WHEN address <> ? COLLATE NOCASE THEN NULL ELSE last_seen END, address = ? WHERE id = ? AND organization_id = ? AND network_id = ? AND EXISTS (SELECT 1 FROM areas WHERE id = ? AND organization_id = ? AND network_id = ?)",
    )
    .run(
      input.areaId,
      input.name,
      input.type,
      input.address,
      input.address,
      input.address,
      input.address,
      input.address,
      input.address,
      input.id,
      input.organizationId,
      input.networkId,
      input.areaId,
      input.organizationId,
      input.networkId,
    );
  if (!result.changes) return undefined;
  return db
    .prepare(
      'SELECT id, organization_id AS organizationId, network_id AS networkId, area_id AS areaId, name, type, address, status, uptime, latency, load, last_seen AS lastSeen FROM devices WHERE id = ? AND organization_id = ? AND network_id = ?',
    )
    .get(input.id, input.organizationId, input.networkId) as Device;
}
export function getDevice(id: string, organizationId: string) {
  return db
    .prepare(
      'SELECT id, organization_id AS organizationId, network_id AS networkId, area_id AS areaId, name, type, address, status, uptime, latency, load, last_seen AS lastSeen FROM devices WHERE id = ? AND organization_id = ?',
    )
    .get(id, organizationId) as Device | undefined;
}
export function deleteDevice(id: string, organizationId: string) {
  return db.prepare('DELETE FROM devices WHERE id = ? AND organization_id = ?').run(id, organizationId)
    .changes;
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
  const pending = deviceRows.filter((device) => device.status === 'Pending').length;
  const monitored = deviceRows.length - pending;
  return {
    totalDevices: deviceRows.length,
    online: healthy,
    healthy,
    warning,
    needsAttention: warning + offline + pending,
    offline,
    pending,
    healthScore: monitored ? Number(((healthy / monitored) * 100).toFixed(2)) : 0,
    areas: areaRows.length,
    updatedAt: new Date().toISOString(),
  };
}

import { config } from '../../config.ts';
import { db } from '../database.ts';
import { where } from '../query.ts';
import type { Area, Device, Network, Scope } from '../types.ts';
import { pollIntervalBounds, type DeviceStatus, type DeviceType } from '../../../shared/network.ts';
import { explainDeviceStatus } from '../../../shared/device-status.ts';

const deviceColumns =
  'id, organization_id AS organizationId, network_id AS networkId, area_id AS areaId, name, type, address, status, uptime, latency, load, last_seen AS lastSeen';

/**
 * Every device read passes through here so the status reflects the current time: a device whose
 * cached snapshot is Healthy or Warning but which has not answered within the staleness window is
 * reported Offline without waiting for a collector to write anything.
 */
function withCurrentStatus(row: Omit<Device, 'statusReason'>, now: Date): Device {
  const { status, reason } = explainDeviceStatus(row, now, config.monitoring.staleAfterMs);
  return { ...row, status, statusReason: reason };
}

type NetworkInput = {
  id: string;
  organizationId: string;
  name: string;
  description: string;
  monitoringEnabled?: boolean | undefined;
  pollIntervalSeconds?: number | undefined;
};
type NetworkRow = Omit<Network, 'monitoringEnabled'> & { monitoringEnabled: 0 | 1 };

const networkColumns =
  'id, organization_id AS organizationId, name, description, monitoring_enabled AS monitoringEnabled, poll_interval_seconds AS pollIntervalSeconds';
const toNetwork = (row: NetworkRow): Network => ({ ...row, monitoringEnabled: row.monitoringEnabled === 1 });

export function listNetworks(scope: Scope = {}): Network[] {
  const { sql, values } = where(scope, 'networks');
  return (
    db
      .prepare(`SELECT ${networkColumns} FROM networks${sql} ORDER BY name`)
      .all(...values) as unknown as NetworkRow[]
  ).map(toNetwork);
}
export function createNetwork(input: NetworkInput): Network {
  db.prepare(
    'INSERT INTO networks (id, organization_id, name, description, monitoring_enabled, poll_interval_seconds) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(
    input.id,
    input.organizationId,
    input.name,
    input.description,
    input.monitoringEnabled === false ? 0 : 1,
    input.pollIntervalSeconds ?? pollIntervalBounds.default,
  );
  return getNetwork(input.id, [input.organizationId])!;
}
/** Updates the name and description, plus whichever monitoring settings are supplied. */
export function updateNetwork(id: string, organizationIds: string[], input: Omit<NetworkInput, 'id'>) {
  const placeholders = organizationIds.map(() => '?').join(', ');
  const result = db
    .prepare(
      `UPDATE networks SET name = ?, description = ?, monitoring_enabled = COALESCE(?, monitoring_enabled), poll_interval_seconds = COALESCE(?, poll_interval_seconds) WHERE id = ? AND organization_id IN (${placeholders})`,
    )
    .run(
      input.name,
      input.description,
      input.monitoringEnabled === undefined ? null : input.monitoringEnabled ? 1 : 0,
      input.pollIntervalSeconds ?? null,
      id,
      ...organizationIds,
    );
  return result.changes ? getNetwork(id, organizationIds) : undefined;
}
export function getNetwork(id: string, organizationIds: string[]) {
  if (!organizationIds.length) return undefined;
  const placeholders = organizationIds.map(() => '?').join(', ');
  const row = db
    .prepare(`SELECT ${networkColumns} FROM networks WHERE id = ? AND organization_id IN (${placeholders})`)
    .get(id, ...organizationIds) as NetworkRow | undefined;
  return row && toNetwork(row);
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
  return getDevice(input.id, input.organizationId)!;
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
  return result.changes ? getDevice(input.id, input.organizationId) : undefined;
}
export type DeviceSnapshot = Pick<Device, 'status' | 'uptime' | 'latency' | 'load' | 'lastSeen'>;
/**
 * Refreshes the cached monitoring snapshot on the inventory row. Only the monitoring service writes
 * this; the history itself lives in device_observations.
 */
export function updateDeviceSnapshot(
  id: string,
  organizationId: string,
  snapshot: DeviceSnapshot,
  now = new Date(),
): Device | undefined {
  const result = db
    .prepare(
      'UPDATE devices SET status = ?, uptime = ?, latency = ?, load = ?, last_seen = ? WHERE id = ? AND organization_id = ?',
    )
    .run(
      snapshot.status,
      snapshot.uptime,
      snapshot.latency,
      snapshot.load,
      snapshot.lastSeen,
      id,
      organizationId,
    );
  return result.changes ? getDevice(id, organizationId, now) : undefined;
}
export function getDevice(id: string, organizationId: string, now = new Date()) {
  const row = db
    .prepare(`SELECT ${deviceColumns} FROM devices WHERE id = ? AND organization_id = ?`)
    .get(id, organizationId) as Omit<Device, 'statusReason'> | undefined;
  return row && withCurrentStatus(row, now);
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
export function listDevices(scope: Scope = {}, now = new Date()): Device[] {
  const { sql, values } = where(scope, 'devices');
  return (
    db
      .prepare(`SELECT ${deviceColumns} FROM devices${sql} ORDER BY name`)
      .all(...values) as unknown as Device[]
  ).map((row) => withCurrentStatus(row, now));
}
/** The newest collection time among the devices in scope: observations first, then the cached snapshot. */
export function latestCollectionTime(scope: Scope = {}): string | null {
  const { sql, values } = where(scope, 'devices');
  const row = db
    .prepare(
      `SELECT MAX(collected_at) AS observedAt FROM device_observations WHERE device_id IN (SELECT id FROM devices${sql})`,
    )
    .get(...values) as { observedAt: string | null };
  const cached = db.prepare(`SELECT MAX(last_seen) AS lastSeen FROM devices${sql}`).get(...values) as {
    lastSeen: string | null;
  };
  return [row.observedAt, cached.lastSeen].reduce<string | null>(
    (latest, candidate) =>
      candidate !== null && (latest === null || candidate > latest) ? candidate : latest,
    null,
  );
}
export function getOverview(scope: Scope = {}, now = new Date()) {
  const deviceRows = listDevices(scope, now);
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
    updatedAt: latestCollectionTime(scope),
  };
}

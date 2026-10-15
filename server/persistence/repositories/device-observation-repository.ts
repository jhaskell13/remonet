import { db } from '../database.ts';
import type { DeviceObservation } from '../types.ts';

export type NewObservation = Omit<DeviceObservation, 'createdAt'> & { createdAt?: string };

const columns =
  'id, organization_id AS organizationId, network_id AS networkId, device_id AS deviceId, source, result, latency_ms AS latencyMs, load_percent AS loadPercent, uptime_seconds AS uptimeSeconds, error_message AS errorMessage, collected_at AS collectedAt, created_at AS createdAt';

/** Appends one check result. The foreign key rejects devices outside the stated organization and network. */
export function insertObservation(observation: NewObservation): DeviceObservation {
  const createdAt = observation.createdAt ?? new Date().toISOString();
  db.prepare(
    'INSERT INTO device_observations (id, organization_id, network_id, device_id, source, result, latency_ms, load_percent, uptime_seconds, error_message, collected_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(
    observation.id,
    observation.organizationId,
    observation.networkId,
    observation.deviceId,
    observation.source,
    observation.result,
    observation.latencyMs,
    observation.loadPercent,
    observation.uptimeSeconds,
    observation.errorMessage,
    observation.collectedAt,
    createdAt,
  );
  return { ...observation, createdAt };
}

/** Newest first. Ties on `collected_at` resolve to the most recently inserted row. */
export function listObservationsForDevice(
  deviceId: string,
  organizationId: string,
  limit: number,
): DeviceObservation[] {
  return db
    .prepare(
      `SELECT ${columns} FROM device_observations WHERE device_id = ? AND organization_id = ? ORDER BY collected_at DESC, rowid DESC LIMIT ?`,
    )
    .all(deviceId, organizationId, limit) as unknown as DeviceObservation[];
}

export function getLatestObservation(deviceId: string, organizationId: string) {
  return listObservationsForDevice(deviceId, organizationId, 1)[0];
}

/** Keeps only the newest `keep` observations of a device and returns how many rows were removed. */
export function pruneObservations(deviceId: string, keep: number) {
  return db
    .prepare(
      'DELETE FROM device_observations WHERE device_id = ? AND id NOT IN (SELECT id FROM device_observations WHERE device_id = ? ORDER BY collected_at DESC, rowid DESC LIMIT ?)',
    )
    .run(deviceId, deviceId, keep).changes;
}

export function countObservations(deviceId: string) {
  return (
    db.prepare('SELECT COUNT(*) AS count FROM device_observations WHERE device_id = ?').get(deviceId) as {
      count: number;
    }
  ).count;
}

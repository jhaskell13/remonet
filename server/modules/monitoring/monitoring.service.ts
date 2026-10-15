import { randomUUID } from 'node:crypto';
import type {
  Device,
  DeviceObservation,
  ObservationResult,
  ObservationSource,
} from '../../../shared/network.ts';
import type { Principal } from '../../auth.ts';
import { requirePermission } from '../../authorization.ts';
import { config } from '../../config.ts';
import { AppError } from '../../http/app-error.ts';
import { db } from '../../persistence/database.ts';
import { getDevice, updateDeviceSnapshot } from '../../persistence/repositories/network-repository.ts';
import {
  getLatestObservation,
  insertObservation,
  listObservationsForDevice,
  pruneObservations,
} from '../../store.ts';
import { formatUptime, statusFromObservation } from '../../../shared/device-status.ts';
import { publishMonitoringEvent } from './events.ts';

export type ObservationInput = {
  deviceId: string;
  organizationId: string;
  source: ObservationSource;
  result: ObservationResult;
  /** Round-trip time of the check; required when the check succeeded. */
  latencyMs?: number | undefined;
  loadPercent?: number | undefined;
  uptimeSeconds?: number | undefined;
  /** What went wrong; required for `error`, defaulted for `timeout`, dropped for `success`. */
  errorMessage?: string | undefined;
  /** When the check happened; defaults to now. */
  collectedAt?: string | undefined;
};
export type RecordOptions = {
  /** Observations kept per device after this one is stored. */
  retention?: number;
  now?: () => Date;
};
export type RecordedObservation = { observation: DeviceObservation; device: Device };

export type ObservationQuery = { organizationId: string; limit?: number | undefined };

export const maxErrorMessageLength = 500;
export const defaultHistoryLimit = 50;
export const maxHistoryLimit = 200;

/** Recent checks of one device, newest first, for anyone who may read the organization's inventory. */
export function observationsFor(principal: Principal, deviceId: string, query: ObservationQuery) {
  requirePermission(principal, query.organizationId, 'inventory.read');
  if (!getDevice(deviceId, query.organizationId)) throw new AppError(404, 'Device not found');
  return listObservationsForDevice(
    deviceId,
    query.organizationId,
    Math.min(query.limit ?? defaultHistoryLimit, maxHistoryLimit),
  );
}

function finiteInRange(name: string, value: number | undefined, min: number, max: number) {
  if (value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max)
    throw new AppError(400, `${name} must be a number between ${min} and ${max}`);
  return value;
}

function cleanObservationInput(input: ObservationInput, now: () => Date) {
  const collectedAt = input.collectedAt ?? now().toISOString();
  if (Number.isNaN(Date.parse(collectedAt)))
    throw new AppError(400, 'collectedAt must be an ISO 8601 timestamp');
  const success = input.result === 'success';
  const latencyMs = finiteInRange('latencyMs', input.latencyMs, 0, 3_600_000);
  const loadPercent = finiteInRange('loadPercent', input.loadPercent, 0, 100);
  const uptimeSeconds = finiteInRange('uptimeSeconds', input.uptimeSeconds, 0, 10 * 365 * 86_400);
  if (success && latencyMs === null) throw new AppError(400, 'A successful check must report latencyMs');
  const errorMessage = input.errorMessage?.trim() ?? '';
  if (input.result === 'error' && !errorMessage)
    throw new AppError(400, 'An error result must include errorMessage');
  if (errorMessage.length > maxErrorMessageLength)
    throw new AppError(400, `errorMessage must be at most ${maxErrorMessageLength} characters`);
  return {
    collectedAt: new Date(collectedAt).toISOString(),
    // Measurements only mean something when the device answered.
    latencyMs: success ? latencyMs : null,
    loadPercent: success ? loadPercent : null,
    uptimeSeconds: success && uptimeSeconds !== null ? Math.floor(uptimeSeconds) : null,
    errorMessage: success ? null : errorMessage || 'Check timed out',
  };
}

/**
 * Stores one check result and refreshes the device's cached snapshot from its newest observation,
 * then trims the device's history to the retention bound. Everything happens in one transaction so
 * the history and the snapshot derived from it never disagree.
 *
 * Not audited: observations are routine telemetry written by collectors, not engineer actions.
 */
export function recordObservation(input: ObservationInput, options: RecordOptions = {}): RecordedObservation {
  const now = options.now ?? (() => new Date());
  const retention = options.retention ?? config.monitoring.observationRetentionPerDevice;
  const clean = cleanObservationInput(input, now);
  const recorded = db.transaction(() => {
    const device = getDevice(input.deviceId, input.organizationId);
    if (!device) throw new AppError(404, 'Device not found');
    const observation = insertObservation({
      id: randomUUID(),
      organizationId: device.organizationId,
      networkId: device.networkId,
      deviceId: device.id,
      source: input.source,
      result: input.result,
      ...clean,
      createdAt: now().toISOString(),
    });
    const latest = getLatestObservation(device.id, device.organizationId)!;
    const refreshed = updateDeviceSnapshot(
      device.id,
      device.organizationId,
      snapshotFrom(device, latest),
      now(),
    )!;
    pruneObservations(device.id, retention);
    return { observation, device: refreshed };
  })();
  // Published after the commit so subscribers never see a result that was rolled back.
  publishMonitoringEvent({
    type: 'observation',
    organizationId: recorded.device.organizationId,
    networkId: recorded.device.networkId,
    deviceId: recorded.device.id,
    device: recorded.device,
    observation: recorded.observation,
  });
  return recorded;
}

/**
 * The cached inventory view of a device's newest observation. A failed check marks the device
 * Offline but keeps `lastSeen`: it records the last time the device actually answered.
 */
export function snapshotFrom(device: Device, latest: DeviceObservation) {
  const status = statusFromObservation(latest.result, latest);
  if (latest.result !== 'success')
    return { status, uptime: '—', latency: 0, load: 0, lastSeen: device.lastSeen };
  return {
    status,
    uptime: formatUptime(latest.uptimeSeconds),
    latency: latest.latencyMs ?? 0,
    load: latest.loadPercent ?? 0,
    lastSeen: latest.collectedAt,
  };
}

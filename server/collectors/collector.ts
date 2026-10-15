import type { Device, DeviceType, ObservationSource } from '../../shared/network.ts';
import { maxErrorMessageLength, type ObservationInput } from '../modules/monitoring/monitoring.service.ts';

/**
 * The protocol-independent boundary between scheduling and collection.
 *
 * A collector knows how to ask one device one question ("are you there, and how are you doing?")
 * over some protocol; the scheduler decides when to ask, how long to wait, and what to do with the
 * answer. Collectors never touch the database: they return a `CollectorResult`, which the scheduler
 * turns into an observation through `observationFrom`. Cancellation travels as an `AbortSignal`, so
 * timeouts and shutdown use one mechanism regardless of protocol.
 */

/** What a collector needs to know about the device it is checking. */
export type CollectorTarget = {
  deviceId: string;
  organizationId: string;
  networkId: string;
  name: string;
  type: DeviceType;
  address: string;
};

export type CollectorMeasurements = {
  /** Round-trip time of the check in milliseconds. */
  latencyMs: number;
  loadPercent?: number | undefined;
  uptimeSeconds?: number | undefined;
};

export type CollectorResult =
  | { result: 'success'; measurements: CollectorMeasurements }
  | { result: 'timeout'; error?: string | undefined }
  | { result: 'error'; error: string };

export interface Collector {
  /** The source recorded on every observation this collector produces. */
  readonly source: ObservationSource;
  /**
   * Checks one device. Must settle promptly once `signal` aborts, either by resolving with a
   * `timeout`/`error` result or by rejecting; the scheduler treats an abort rejection as a timeout.
   */
  check(target: CollectorTarget, signal: AbortSignal): Promise<CollectorResult>;
}

/** Thrown by collectors (or `throwIfAborted`) when a check is cancelled. */
export class CollectorAbortedError extends Error {
  constructor(message = 'Check was cancelled') {
    super(message);
    this.name = 'AbortError';
  }
}

export function isAbortError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';
}

/** For collectors to call at await points so cancellation is honoured between steps. */
export function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw new CollectorAbortedError();
}

export function targetFor(device: Device): CollectorTarget {
  return {
    deviceId: device.id,
    organizationId: device.organizationId,
    networkId: device.networkId,
    name: device.name,
    type: device.type,
    address: device.address,
  };
}

const describeError = (error: unknown) => {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'Unknown collector failure';
  return (message.trim() || 'Unknown collector failure').slice(0, maxErrorMessageLength);
};

/** Normalises a rejected check into a result: cancellation is a timeout, anything else an error. */
export function failureFrom(error: unknown): CollectorResult {
  if (isAbortError(error)) return { result: 'timeout', error: describeError(error) };
  return { result: 'error', error: describeError(error) };
}

/** Translates a collector's answer into the input the monitoring service records. */
export function observationFrom(
  target: CollectorTarget,
  source: ObservationSource,
  result: CollectorResult,
  collectedAt: Date,
): ObservationInput {
  const base = {
    deviceId: target.deviceId,
    organizationId: target.organizationId,
    source,
    collectedAt: collectedAt.toISOString(),
  };
  if (result.result === 'success')
    return {
      ...base,
      result: 'success',
      latencyMs: result.measurements.latencyMs,
      loadPercent: result.measurements.loadPercent,
      uptimeSeconds: result.measurements.uptimeSeconds,
    };
  return { ...base, result: result.result, errorMessage: result.error?.slice(0, maxErrorMessageLength) };
}

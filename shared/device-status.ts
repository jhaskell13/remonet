import type { DeviceObservation, DeviceStatus, ObservationResult } from './network.ts';

/**
 * The single definition of what a device status means. The API applies it when an observation is
 * recorded and again whenever devices are read, so that a device which stopped reporting turns
 * Offline on its own; the UI reads the same rules to explain a status.
 *
 * - Pending: enrolled but never observed, or re-addressed and awaiting a fresh check.
 * - Healthy: the newest check succeeded recently and its measurements are within the thresholds.
 * - Warning: the newest check succeeded recently but latency or load exceed a threshold.
 * - Offline: the newest check failed (timeout or error), or the device has not answered a check
 *   within the staleness window, so the last known measurements can no longer be trusted.
 */

/** Measurement limits above which a reachable device is reported as Warning rather than Healthy. */
export const warningThresholds = Object.freeze({ latencyMs: 25, loadPercent: 70 });

/** How long a successful check stays trustworthy before its device is treated as Offline. */
export const defaultStaleAfterMs = 5 * 60 * 1000;

export type Measurements = { latencyMs: number | null; loadPercent: number | null };
/** What a read needs to know about a device: its cached status and when it last answered. */
export type StatusSnapshot = { status: DeviceStatus; lastSeen: string | null };

/** Healthy or Warning for a device that answered a check. */
export function classifyMeasurements(
  measurements: Measurements,
): Extract<DeviceStatus, 'Healthy' | 'Warning'> {
  const slow = measurements.latencyMs !== null && measurements.latencyMs > warningThresholds.latencyMs;
  const busy = measurements.loadPercent !== null && measurements.loadPercent > warningThresholds.loadPercent;
  return slow || busy ? 'Warning' : 'Healthy';
}

/** The status a fresh observation establishes for its device. */
export function statusFromObservation(result: ObservationResult, measurements: Measurements): DeviceStatus {
  return result === 'success' ? classifyMeasurements(measurements) : 'Offline';
}

/** Whether a last-seen time is too old to trust. A future time (clock skew) is never stale. */
export function isStale(lastSeen: string | null, now: Date, staleAfterMs = defaultStaleAfterMs) {
  if (lastSeen === null) return true;
  return now.getTime() - Date.parse(lastSeen) > staleAfterMs;
}

/** The status to report right now, given the cached snapshot and the current time. */
export function deriveDeviceStatus(
  snapshot: StatusSnapshot,
  now: Date,
  staleAfterMs = defaultStaleAfterMs,
): DeviceStatus {
  if (snapshot.status === 'Pending' || snapshot.status === 'Offline') return snapshot.status;
  return isStale(snapshot.lastSeen, now, staleAfterMs) ? 'Offline' : snapshot.status;
}

/** What a read needs in order to explain a status, not only derive it. */
export type StatusDetails = StatusSnapshot & { latency: number; load: number; uptime: string };
export type StatusExplanation = { status: DeviceStatus; reason: string };

/** Why a reachable device is Healthy or Warning, from its measurements. */
export function describeMeasurements(measurements: Measurements) {
  const problems: string[] = [];
  if (measurements.latencyMs !== null && measurements.latencyMs > warningThresholds.latencyMs)
    problems.push(
      `latency ${measurements.latencyMs} ms is above the ${warningThresholds.latencyMs} ms limit`,
    );
  if (measurements.loadPercent !== null && measurements.loadPercent > warningThresholds.loadPercent)
    problems.push(`load ${measurements.loadPercent}% is above the ${warningThresholds.loadPercent}% limit`);
  if (problems.length) return problems.join(' and ');
  const latency = measurements.latencyMs === null ? 'an unmeasured latency' : `${measurements.latencyMs} ms`;
  const load = measurements.loadPercent === null ? 'unmeasured load' : `${measurements.loadPercent}% load`;
  return `answered in ${latency} at ${load}`;
}

/** The status to report right now together with a one-line reason an engineer can act on. */
export function explainDeviceStatus(
  details: StatusDetails,
  now: Date,
  staleAfterMs = defaultStaleAfterMs,
): StatusExplanation {
  const status = deriveDeviceStatus(details, now, staleAfterMs);
  if (status === 'Pending') return { status, reason: 'Waiting for the first check' };
  if (status === 'Healthy' || status === 'Warning') {
    const measurements = { latencyMs: details.latency, loadPercent: details.load };
    return {
      status,
      reason:
        status === 'Warning' && classifyMeasurements(measurements) === 'Healthy'
          ? 'A measurement exceeded a warning limit'
          : describeMeasurements(measurements),
    };
  }
  if (details.status === 'Offline' || details.lastSeen === null)
    return { status, reason: 'The last check got no answer' };
  const minutes = Math.floor((now.getTime() - Date.parse(details.lastSeen)) / 60_000);
  return {
    status,
    reason: `No successful check for ${minutes} min (limit ${Math.round(staleAfterMs / 60_000)} min)`,
  };
}

/** How one recorded check reads in a history: the status it established and why. */
export function describeObservation(
  observation: Pick<DeviceObservation, 'result' | 'latencyMs' | 'loadPercent' | 'errorMessage'>,
): { status: DeviceStatus; label: string; detail: string } {
  if (observation.result === 'success') {
    const status = classifyMeasurements(observation);
    return { status, label: status, detail: describeMeasurements(observation) };
  }
  return {
    status: 'Offline',
    label: observation.result === 'timeout' ? 'Timed out' : 'Error',
    detail: observation.errorMessage ?? 'The check got no answer',
  };
}

/** Renders an uptime as the inventory shows it, e.g. `42d 06h`. */
export function formatUptime(uptimeSeconds: number | null) {
  if (uptimeSeconds === null) return 'Not measured';
  const days = Math.floor(uptimeSeconds / 86_400);
  const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
  return `${days}d ${String(hours).padStart(2, '0')}h`;
}

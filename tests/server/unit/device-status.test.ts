import { describe, expect, it } from 'vitest';
import {
  classifyMeasurements,
  defaultStaleAfterMs,
  deriveDeviceStatus,
  describeMeasurements,
  describeObservation,
  explainDeviceStatus,
  formatUptime,
  isStale,
  statusFromObservation,
  warningThresholds,
} from '../../../shared/device-status.ts';
import type { DeviceStatus } from '../../../shared/network.ts';

const now = new Date('2026-10-13T12:00:00.000Z');
const secondsBefore = (seconds: number) => new Date(now.getTime() - seconds * 1000).toISOString();

describe('device status rules', () => {
  it('pins the thresholds and the default staleness window', () => {
    expect(warningThresholds).toEqual({ latencyMs: 25, loadPercent: 70 });
    expect(defaultStaleAfterMs).toBe(5 * 60 * 1000);
    expect(Object.isFrozen(warningThresholds)).toBe(true);
  });

  it.each([
    ['nothing measured', { latencyMs: null, loadPercent: null }, 'Healthy'],
    ['latency at the threshold', { latencyMs: 25, loadPercent: 0 }, 'Healthy'],
    ['latency above the threshold', { latencyMs: 25.01, loadPercent: 0 }, 'Warning'],
    ['load at the threshold', { latencyMs: 0, loadPercent: 70 }, 'Healthy'],
    ['load above the threshold', { latencyMs: 0, loadPercent: 70.5 }, 'Warning'],
    ['both above the thresholds', { latencyMs: 100, loadPercent: 100 }, 'Warning'],
    ['high latency with unknown load', { latencyMs: 40, loadPercent: null }, 'Warning'],
  ] as const)('classifies %s as %s', (_, measurements, expected) => {
    expect(classifyMeasurements(measurements)).toBe(expected);
  });

  it('maps an observation result to the status it establishes', () => {
    expect(statusFromObservation('success', { latencyMs: 4, loadPercent: 30 })).toBe('Healthy');
    expect(statusFromObservation('success', { latencyMs: 40, loadPercent: 30 })).toBe('Warning');
    expect(statusFromObservation('timeout', { latencyMs: null, loadPercent: null })).toBe('Offline');
    expect(statusFromObservation('error', { latencyMs: 4, loadPercent: 30 })).toBe('Offline');
  });

  it('treats a last-seen time as stale only once the window has fully elapsed', () => {
    expect(isStale(null, now)).toBe(true);
    expect(isStale(secondsBefore(0), now)).toBe(false);
    expect(isStale(secondsBefore(300), now)).toBe(false);
    expect(isStale(secondsBefore(300.001), now)).toBe(true);
    expect(isStale(secondsBefore(30), now, 10_000)).toBe(true);
    expect(isStale(secondsBefore(-3600), now), 'clock skew into the future').toBe(false);
  });

  it.each([
    ['a device that was never observed', 'Pending', null, 'Pending'],
    [
      'a re-addressed device awaiting a check, even with an old last-seen',
      'Pending',
      secondsBefore(9999),
      'Pending',
    ],
    ['a recent healthy check', 'Healthy', secondsBefore(10), 'Healthy'],
    ['a recent warning check', 'Warning', secondsBefore(299), 'Warning'],
    ['a healthy check exactly at the window edge', 'Healthy', secondsBefore(300), 'Healthy'],
    ['a healthy check that has gone stale', 'Healthy', secondsBefore(301), 'Offline'],
    ['a warning check that has gone stale', 'Warning', secondsBefore(3600), 'Offline'],
    ['a healthy status without any last-seen time', 'Healthy', null, 'Offline'],
    ['a failed check, however recent', 'Offline', secondsBefore(1), 'Offline'],
    ['a failed check with no last-seen time', 'Offline', null, 'Offline'],
  ] as const satisfies readonly (readonly [string, DeviceStatus, string | null, DeviceStatus])[])(
    'derives %s as %s',
    (_, status, lastSeen, expected) => {
      expect(deriveDeviceStatus({ status, lastSeen }, now)).toBe(expected);
    },
  );

  it('honours a custom staleness window', () => {
    const snapshot = { status: 'Healthy' as const, lastSeen: secondsBefore(20) };
    expect(deriveDeviceStatus(snapshot, now, 10_000)).toBe('Offline');
    expect(deriveDeviceStatus(snapshot, now, 30_000)).toBe('Healthy');
  });

  it('describes measurements against the limits', () => {
    expect(describeMeasurements({ latencyMs: 4, loadPercent: 32 })).toBe('answered in 4 ms at 32% load');
    expect(describeMeasurements({ latencyMs: null, loadPercent: null })).toBe(
      'answered in an unmeasured latency at unmeasured load',
    );
    expect(describeMeasurements({ latencyMs: 31, loadPercent: 20 })).toBe(
      'latency 31 ms is above the 25 ms limit',
    );
    expect(describeMeasurements({ latencyMs: 3, loadPercent: 82.5 })).toBe(
      'load 82.5% is above the 70% limit',
    );
    expect(describeMeasurements({ latencyMs: 40, loadPercent: 90 })).toBe(
      'latency 40 ms is above the 25 ms limit and load 90% is above the 70% limit',
    );
  });

  const snapshot = (overrides: Partial<Parameters<typeof explainDeviceStatus>[0]>) => ({
    status: 'Healthy' as DeviceStatus,
    lastSeen: secondsBefore(30),
    latency: 4,
    load: 32,
    uptime: '1d 00h',
    ...overrides,
  });

  it.each([
    [
      'a pending device',
      snapshot({ status: 'Pending', lastSeen: null, latency: 0, load: 0 }),
      'Pending',
      'Waiting for the first check',
    ],
    ['a healthy device', snapshot({}), 'Healthy', 'answered in 4 ms at 32% load'],
    [
      'a warning from latency',
      snapshot({ status: 'Warning', latency: 31 }),
      'Warning',
      'latency 31 ms is above the 25 ms limit',
    ],
    [
      'a warning from load',
      snapshot({ status: 'Warning', load: 75 }),
      'Warning',
      'load 75% is above the 70% limit',
    ],
    [
      'a warning whose stored measurements no longer show why',
      snapshot({ status: 'Warning' }),
      'Warning',
      'A measurement exceeded a warning limit',
    ],
    [
      'a failed last check',
      snapshot({ status: 'Offline', latency: 0, load: 0, uptime: '—' }),
      'Offline',
      'The last check got no answer',
    ],
    [
      'a healthy status without any answer on record',
      snapshot({ lastSeen: null }),
      'Offline',
      'The last check got no answer',
    ],
    [
      'a stale healthy device',
      snapshot({ lastSeen: secondsBefore(12 * 60 + 5) }),
      'Offline',
      'No successful check for 12 min (limit 5 min)',
    ],
    [
      'a stale warning device',
      snapshot({ status: 'Warning', latency: 40, lastSeen: secondsBefore(3_600) }),
      'Offline',
      'No successful check for 60 min (limit 5 min)',
    ],
  ] as const)('explains %s', (_, details, status, reason) => {
    expect(explainDeviceStatus(details, now)).toEqual({ status, reason });
  });

  it('explains staleness against a custom window', () => {
    expect(explainDeviceStatus(snapshot({ lastSeen: secondsBefore(200) }), now, 120_000)).toEqual({
      status: 'Offline',
      reason: 'No successful check for 3 min (limit 2 min)',
    });
  });

  it('reads each recorded check as the status it established', () => {
    expect(
      describeObservation({ result: 'success', latencyMs: 4, loadPercent: 30, errorMessage: null }),
    ).toEqual({
      status: 'Healthy',
      label: 'Healthy',
      detail: 'answered in 4 ms at 30% load',
    });
    expect(
      describeObservation({ result: 'success', latencyMs: 28, loadPercent: 76, errorMessage: null }),
    ).toEqual({
      status: 'Warning',
      label: 'Warning',
      detail: 'latency 28 ms is above the 25 ms limit and load 76% is above the 70% limit',
    });
    expect(
      describeObservation({
        result: 'timeout',
        latencyMs: null,
        loadPercent: null,
        errorMessage: 'No reply from 10.0.0.1',
      }),
    ).toEqual({ status: 'Offline', label: 'Timed out', detail: 'No reply from 10.0.0.1' });
    expect(
      describeObservation({ result: 'error', latencyMs: null, loadPercent: null, errorMessage: null }),
    ).toEqual({
      status: 'Offline',
      label: 'Error',
      detail: 'The check got no answer',
    });
  });

  it('formats uptime in days and zero-padded hours', () => {
    expect(formatUptime(null)).toBe('Not measured');
    expect(formatUptime(0)).toBe('0d 00h');
    expect(formatUptime(3_599)).toBe('0d 00h');
    expect(formatUptime(3_600)).toBe('0d 01h');
    expect(formatUptime(42 * 86_400 + 6 * 3_600 + 59 * 60)).toBe('42d 06h');
  });
});

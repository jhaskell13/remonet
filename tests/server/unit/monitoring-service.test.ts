import { describe, expect, it } from 'vitest';
import { AppError } from '../../../server/http/app-error.ts';
import {
  maxErrorMessageLength,
  recordObservation,
  snapshotFrom,
  type ObservationInput,
  type RecordOptions,
} from '../../../server/modules/monitoring/monitoring.service.ts';
import { getDevice } from '../../../server/persistence/repositories/network-repository.ts';
import {
  countObservations,
  listObservationsForDevice,
} from '../../../server/persistence/repositories/device-observation-repository.ts';
import { useSeededDatabase } from '../helpers/database.ts';
import { fixtures } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
const at = (iso: string) => () => new Date(iso);
// Reads derive the status relative to "now", so the tests pin a clock shortly after the checks.
const clock = at('2026-10-13T08:04:00.000Z');
const success: ObservationInput = {
  deviceId: demo.coreRouterId,
  organizationId: demo.organizationId,
  source: 'simulator',
  result: 'success',
  latencyMs: 6,
  loadPercent: 41,
  uptimeSeconds: 3 * 86_400 + 5 * 3_600 + 59,
  collectedAt: '2026-10-13T08:00:00.000Z',
};

function record(input: Partial<ObservationInput>, options: RecordOptions = {}) {
  return recordObservation({ ...success, ...input }, { now: clock, ...options });
}
function failure(input: Partial<ObservationInput>) {
  try {
    record(input);
    return undefined;
  } catch (error) {
    if (error instanceof AppError) return { status: error.statusCode, message: error.message };
    throw error;
  }
}

describe('recordObservation', () => {
  useSeededDatabase();

  it('stores the check with its source, result, measurements, and timestamps', () => {
    const { observation } = record({}, { now: at('2026-10-13T08:00:01.000Z') });
    expect(observation).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      deviceId: demo.coreRouterId,
      source: 'simulator',
      result: 'success',
      latencyMs: 6,
      loadPercent: 41,
      uptimeSeconds: 3 * 86_400 + 5 * 3_600 + 59,
      errorMessage: null,
      collectedAt: '2026-10-13T08:00:00.000Z',
      createdAt: '2026-10-13T08:00:01.000Z',
    });
    expect(listObservationsForDevice(demo.coreRouterId, demo.organizationId, 5)).toEqual([observation]);
  });

  it('refreshes the inventory snapshot from a successful check', () => {
    const { device } = record({});
    expect(device).toMatchObject({
      id: demo.coreRouterId,
      status: 'Healthy',
      uptime: '3d 05h',
      latency: 6,
      load: 41,
      lastSeen: '2026-10-13T08:00:00.000Z',
    });
    expect(getDevice(demo.coreRouterId, demo.organizationId, clock())).toEqual(device);
  });

  it('reports a device Offline once its last successful check is older than the staleness window', () => {
    record({});
    const freshly = getDevice(demo.coreRouterId, demo.organizationId, new Date('2026-10-13T08:05:00.000Z'));
    const later = getDevice(demo.coreRouterId, demo.organizationId, new Date('2026-10-13T08:05:00.001Z'));
    expect(freshly?.status).toBe('Healthy');
    expect(later).toMatchObject({ status: 'Offline', latency: 6, lastSeen: '2026-10-13T08:00:00.000Z' });
  });

  it('reports Warning when latency or load exceed the thresholds', () => {
    expect(record({ latencyMs: 26 }).device.status).toBe('Warning');
    expect(record({ latencyMs: 25, loadPercent: 71 }).device.status).toBe('Warning');
    expect(record({ latencyMs: 25, loadPercent: 70 }).device.status).toBe('Healthy');
  });

  it('defaults the collection time to now and tolerates missing optional measurements', () => {
    const { observation, device } = record(
      { collectedAt: undefined, loadPercent: undefined, uptimeSeconds: undefined },
      { now: at('2026-10-13T09:30:00.000Z') },
    );
    expect(observation.collectedAt).toBe('2026-10-13T09:30:00.000Z');
    expect(observation).toMatchObject({ loadPercent: null, uptimeSeconds: null });
    expect(device).toMatchObject({ uptime: 'Not measured', load: 0, lastSeen: '2026-10-13T09:30:00.000Z' });
  });

  it('uses the real clock when none is injected', () => {
    const before = Date.now();
    const { observation, device } = recordObservation({ ...success, collectedAt: undefined });
    expect(Date.parse(observation.collectedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(observation.createdAt)).toBeGreaterThanOrEqual(Date.parse(observation.collectedAt));
    expect(device).toMatchObject({ status: 'Healthy', lastSeen: observation.collectedAt });
  });

  it('normalises the collection timestamp and truncates fractional uptime', () => {
    const { observation } = record({
      collectedAt: '2026-10-13T10:00:00+02:00',
      uptimeSeconds: 120.9,
    });
    expect(observation.collectedAt).toBe('2026-10-13T08:00:00.000Z');
    expect(observation.uptimeSeconds).toBe(120);
  });

  it('marks the device Offline on a timeout but keeps when it was last seen', () => {
    record({});
    const { observation, device } = record({
      result: 'timeout',
      collectedAt: '2026-10-13T08:01:00.000Z',
      errorMessage: undefined,
    });
    expect(observation).toMatchObject({
      result: 'timeout',
      latencyMs: null,
      loadPercent: null,
      uptimeSeconds: null,
      errorMessage: 'Check timed out',
    });
    expect(device).toMatchObject({
      status: 'Offline',
      uptime: '—',
      latency: 0,
      load: 0,
      lastSeen: '2026-10-13T08:00:00.000Z',
    });
  });

  it('records error details verbatim (trimmed) and discards measurements sent with a failure', () => {
    const { observation, device } = record({
      result: 'error',
      errorMessage: '  ECONNREFUSED 10.20.0.1:161  ',
    });
    expect(observation).toMatchObject({
      result: 'error',
      errorMessage: 'ECONNREFUSED 10.20.0.1:161',
      latencyMs: null,
      loadPercent: null,
      uptimeSeconds: null,
    });
    expect(device.status).toBe('Offline');
  });

  it('keeps the history while the snapshot only reflects the newest check', () => {
    record({ collectedAt: '2026-10-13T08:00:00.000Z', latencyMs: 3 });
    record({ collectedAt: '2026-10-13T08:05:00.000Z', result: 'timeout' });
    const { device } = record({
      collectedAt: '2026-10-13T08:10:00.000Z',
      latencyMs: 40,
    });
    expect(device).toMatchObject({ status: 'Warning', latency: 40, lastSeen: '2026-10-13T08:10:00.000Z' });
    expect(
      listObservationsForDevice(demo.coreRouterId, demo.organizationId, 10).map((row) => [
        row.collectedAt,
        row.result,
      ]),
    ).toEqual([
      ['2026-10-13T08:10:00.000Z', 'success'],
      ['2026-10-13T08:05:00.000Z', 'timeout'],
      ['2026-10-13T08:00:00.000Z', 'success'],
    ]);
  });

  it('derives the snapshot from the newest collection time even when checks arrive out of order', () => {
    record({ collectedAt: '2026-10-13T08:10:00.000Z', latencyMs: 5 });
    const { device } = record({
      collectedAt: '2026-10-13T08:00:00.000Z',
      result: 'error',
      errorMessage: 'late failure',
    });
    expect(device).toMatchObject({ status: 'Healthy', latency: 5, lastSeen: '2026-10-13T08:10:00.000Z' });
  });

  it('bounds the history per device to the retention setting', () => {
    for (let minute = 0; minute < 6; minute += 1)
      record({ collectedAt: `2026-10-13T08:0${minute}:00.000Z`, latencyMs: minute }, { retention: 4 });
    expect(countObservations(demo.coreRouterId)).toBe(4);
    expect(
      listObservationsForDevice(demo.coreRouterId, demo.organizationId, 10).map((row) => row.latencyMs),
    ).toEqual([5, 4, 3, 2]);
  });

  it('treats a successful row without measurements as reachable but unmeasured', () => {
    // Rows written outside the service (fixtures, imports) may lack measurements.
    const device = getDevice(demo.coreRouterId, demo.organizationId)!;
    expect(
      snapshotFrom(device, {
        id: 'obs',
        organizationId: demo.organizationId,
        networkId: demo.coreNetworkId,
        deviceId: demo.coreRouterId,
        source: 'manual',
        result: 'success',
        latencyMs: null,
        loadPercent: null,
        uptimeSeconds: null,
        errorMessage: null,
        collectedAt: '2026-10-13T08:00:00.000Z',
        createdAt: '2026-10-13T08:00:00.000Z',
      }),
    ).toEqual({
      status: 'Healthy',
      uptime: 'Not measured',
      latency: 0,
      load: 0,
      lastSeen: '2026-10-13T08:00:00.000Z',
    });
  });

  it('refuses devices that do not exist in the stated organization', () => {
    expect(failure({ deviceId: 'dev-missing' })).toEqual({ status: 404, message: 'Device not found' });
    expect(failure({ organizationId: acme.organizationId })).toEqual({
      status: 404,
      message: 'Device not found',
    });
    expect(countObservations(demo.coreRouterId)).toBe(0);
  });

  it.each([
    ['a success without latency', { latencyMs: undefined }, 'A successful check must report latencyMs'],
    ['a negative latency', { latencyMs: -1 }, 'latencyMs must be a number between 0 and 3600000'],
    ['an infinite latency', { latencyMs: Infinity }, 'latencyMs must be a number between 0 and 3600000'],
    ['a load above 100%', { loadPercent: 100.5 }, 'loadPercent must be a number between 0 and 100'],
    ['a negative uptime', { uptimeSeconds: -5 }, 'uptimeSeconds must be a number between 0 and 315360000'],
    ['an unparseable timestamp', { collectedAt: 'yesterday' }, 'collectedAt must be an ISO 8601 timestamp'],
    [
      'an error without a message',
      { result: 'error' as const, errorMessage: '   ' },
      'An error result must include errorMessage',
    ],
    [
      'an oversized error message',
      { result: 'error' as const, errorMessage: 'x'.repeat(maxErrorMessageLength + 1) },
      `errorMessage must be at most ${maxErrorMessageLength} characters`,
    ],
  ])('rejects %s without writing anything', (_, input, message) => {
    expect(failure(input)).toEqual({ status: 400, message });
    expect(countObservations(demo.coreRouterId)).toBe(0);
    expect(getDevice(demo.coreRouterId, demo.organizationId)?.lastSeen).toBe(
      fixtures.devices.find((device) => device.id === demo.coreRouterId)!.lastSeen,
    );
  });
});

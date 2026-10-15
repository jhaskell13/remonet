import { describe, expect, it } from 'vitest';
import type { DeviceObservation } from '../../../shared/network.ts';
import {
  countObservations,
  getLatestObservation,
  insertObservation,
  listObservationsForDevice,
  pruneObservations,
  type NewObservation,
} from '../../../server/persistence/repositories/device-observation-repository.ts';
import { deleteDevice } from '../../../server/persistence/repositories/network-repository.ts';
import { count, sqliteErrorCode, useSeededDatabase } from '../helpers/database.ts';
import { fixtures } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
const FOREIGN_KEY = 'SQLITE_CONSTRAINT_FOREIGNKEY';

let sequence = 0;
function observation(overrides: Partial<NewObservation> = {}): NewObservation {
  sequence += 1;
  return {
    id: `obs-${sequence}`,
    organizationId: demo.organizationId,
    networkId: demo.coreNetworkId,
    deviceId: demo.coreRouterId,
    source: 'simulator',
    result: 'success',
    latencyMs: 4,
    loadPercent: 32,
    uptimeSeconds: 3_600,
    errorMessage: null,
    collectedAt: `2026-03-01T10:${String(sequence).padStart(2, '0')}:00.000Z`,
    ...overrides,
  };
}

describe('device observation repository', () => {
  const db = useSeededDatabase();

  it('stores every field of a check result and stamps when it was recorded', () => {
    const before = Date.now();
    const stored = insertObservation(
      observation({
        result: 'error',
        latencyMs: null,
        loadPercent: null,
        uptimeSeconds: null,
        errorMessage: 'SNMP timeout after 3 retries',
      }),
    );
    expect(Date.parse(stored.createdAt)).toBeGreaterThanOrEqual(before);
    const [listed] = listObservationsForDevice(demo.coreRouterId, demo.organizationId, 10);
    expect(listed).toEqual<DeviceObservation>({
      id: stored.id,
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      deviceId: demo.coreRouterId,
      source: 'simulator',
      result: 'error',
      latencyMs: null,
      loadPercent: null,
      uptimeSeconds: null,
      errorMessage: 'SNMP timeout after 3 retries',
      collectedAt: stored.collectedAt,
      createdAt: stored.createdAt,
    });
  });

  it('keeps an explicit created_at when one is supplied', () => {
    const stored = insertObservation(observation({ createdAt: '2026-03-01T12:00:00.000Z' }));
    expect(stored.createdAt).toBe('2026-03-01T12:00:00.000Z');
    expect(getLatestObservation(demo.coreRouterId, demo.organizationId)?.createdAt).toBe(
      '2026-03-01T12:00:00.000Z',
    );
  });

  it('appends rather than overwrites: every check stays available, newest first', () => {
    const first = insertObservation(observation({ latencyMs: 3 }));
    const second = insertObservation(observation({ latencyMs: 9, result: 'timeout' }));
    const third = insertObservation(observation({ latencyMs: 5 }));
    expect(countObservations(demo.coreRouterId)).toBe(3);
    expect(
      listObservationsForDevice(demo.coreRouterId, demo.organizationId, 10).map((row) => row.id),
    ).toEqual([third.id, second.id, first.id]);
    expect(getLatestObservation(demo.coreRouterId, demo.organizationId)?.latencyMs).toBe(5);
  });

  it('orders by collection time, not insertion order, and breaks ties by the latest insert', () => {
    const late = insertObservation(observation({ collectedAt: '2026-03-02T00:00:00.000Z' }));
    const early = insertObservation(observation({ collectedAt: '2026-03-01T00:00:00.000Z' }));
    const tieA = insertObservation(observation({ collectedAt: '2026-03-02T00:00:00.000Z' }));
    expect(
      listObservationsForDevice(demo.coreRouterId, demo.organizationId, 10).map((row) => row.id),
    ).toEqual([tieA.id, late.id, early.id]);
  });

  it('honours the requested limit', () => {
    for (let index = 0; index < 5; index += 1) insertObservation(observation());
    expect(listObservationsForDevice(demo.coreRouterId, demo.organizationId, 2)).toHaveLength(2);
    expect(listObservationsForDevice(demo.coreRouterId, demo.organizationId, 100)).toHaveLength(5);
  });

  it('returns nothing for a device that was never observed', () => {
    expect(listObservationsForDevice(demo.branchGatewayId, demo.organizationId, 10)).toEqual([]);
    expect(getLatestObservation(demo.branchGatewayId, demo.organizationId)).toBeUndefined();
    expect(countObservations(demo.branchGatewayId)).toBe(0);
  });

  it('is scoped by organization so history cannot be read through another tenant', () => {
    insertObservation(observation());
    expect(listObservationsForDevice(demo.coreRouterId, acme.organizationId, 10)).toEqual([]);
  });

  it('rejects observations whose organization or network do not match the device', () => {
    expect(
      sqliteErrorCode(() => insertObservation(observation({ organizationId: acme.organizationId }))),
    ).toBe(FOREIGN_KEY);
    expect(sqliteErrorCode(() => insertObservation(observation({ networkId: demo.branchNetworkId })))).toBe(
      FOREIGN_KEY,
    );
    expect(sqliteErrorCode(() => insertObservation(observation({ deviceId: 'dev-missing' })))).toBe(
      FOREIGN_KEY,
    );
    expect(countObservations(demo.coreRouterId)).toBe(0);
  });

  it('prunes to a bounded count per device, dropping the oldest checks only', () => {
    const kept: string[] = [];
    for (let index = 0; index < 6; index += 1) {
      const row = insertObservation(observation({ deviceId: demo.edgeFirewallId }));
      if (index >= 2) kept.push(row.id);
    }
    insertObservation(observation());
    expect(pruneObservations(demo.edgeFirewallId, 4)).toBe(2);
    expect(
      listObservationsForDevice(demo.edgeFirewallId, demo.organizationId, 10)
        .map((row) => row.id)
        .reverse(),
    ).toEqual(kept);
    // Other devices are untouched, and pruning below the bound is a no-op.
    expect(countObservations(demo.coreRouterId)).toBe(1);
    expect(pruneObservations(demo.edgeFirewallId, 4)).toBe(0);
  });

  it('removes the history together with its device', () => {
    insertObservation(observation());
    insertObservation(observation());
    expect(deleteDevice(demo.coreRouterId, demo.organizationId)).toBe(1);
    expect(count('device_observations', 'WHERE device_id = ?', demo.coreRouterId)).toBe(0);
    expect(db.pragma('foreign_key_check')).toEqual([]);
  });
});

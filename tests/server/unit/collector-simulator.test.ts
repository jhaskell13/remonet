import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CollectorAbortedError,
  type CollectorResult,
  type CollectorTarget,
} from '../../../server/collectors/collector.ts';
import {
  hash32,
  personalityDistribution,
  personalityFor,
  SimulatorCollector,
  unit,
  type SimulatorPersonality,
} from '../../../server/collectors/simulator.ts';
import { warningThresholds } from '../../../shared/device-status.ts';

const target = (deviceId: string, address = '10.0.0.1'): CollectorTarget => ({
  deviceId,
  organizationId: 'org-demo',
  networkId: 'net-core',
  name: deviceId,
  type: 'Switch',
  address,
});
const live = () => new AbortController().signal;
const immediate = (options: ConstructorParameters<typeof SimulatorCollector>[0] = {}) =>
  new SimulatorCollector({ delayFactor: 0, ...options });

async function series(collector: SimulatorCollector, deviceId: string, checks: number) {
  const results: CollectorResult[] = [];
  for (let index = 0; index < checks; index += 1)
    results.push(await collector.check(target(deviceId), live()));
  return results;
}
const successes = (results: CollectorResult[]) =>
  results.flatMap((result) => (result.result === 'success' ? [result.measurements] : []));

afterEach(() => {
  vi.useRealTimers();
});

describe('simulator hashing', () => {
  it('is stable, spreads inputs, and maps into [0, 1)', () => {
    expect(hash32('')).toBe(0x811c9dc5);
    expect(hash32('RTR-001')).toBe(hash32('RTR-001'));
    expect(hash32('RTR-001')).not.toBe(hash32('RTR-002'));
    const samples = Array.from({ length: 1_000 }, (_, index) => unit(`sample-${index}`));
    expect(Math.min(...samples)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...samples)).toBeLessThan(1);
    expect(samples.reduce((sum, value) => sum + value, 0) / samples.length).toBeCloseTo(0.5, 1);
  });

  it('assigns personalities in the documented proportions', () => {
    expect(personalityDistribution.reduce((sum, [, share]) => sum + share, 0)).toBeCloseTo(1);
    const tally: Record<SimulatorPersonality, number> = { steady: 0, busy: 0, slow: 0, flaky: 0, down: 0 };
    const population = 5_000;
    for (let index = 0; index < population; index += 1)
      tally[personalityFor({ deviceId: `dev-${index}`, address: `10.1.${index >> 8}.${index & 255}` })] += 1;
    for (const [personality, share] of personalityDistribution)
      expect(tally[personality] / population, personality).toBeCloseTo(share, 1);
    expect(personalityFor({ deviceId: 'RTR-001', address: '10.20.0.1' })).toBe(
      personalityFor({ deviceId: 'RTR-001', address: '10.20.0.1' }),
    );
    expect(personalityFor({ deviceId: 'RTR-001', address: '10.20.0.1' }, 'other-seed')).toBeDefined();
  });
});

describe('SimulatorCollector', () => {
  it('tells the same story for the same inventory on every run', async () => {
    const first = await series(immediate({ now: () => new Date('2026-10-13T08:00:00.000Z') }), 'RTR-001', 5);
    const second = await series(immediate({ now: () => new Date('2026-10-13T08:00:00.000Z') }), 'RTR-001', 5);
    expect(second).toEqual(first);
    const reseeded = await series(
      immediate({ seed: 'another', now: () => new Date('2026-10-13T08:00:00.000Z') }),
      'RTR-001',
      5,
    );
    expect(reseeded).not.toEqual(first);
  });

  it('varies measurements from check to check while staying within sane bounds', async () => {
    const collector = immediate({ personalities: { sw: 'steady' } });
    const measurements = successes(await series(collector, 'sw', 20));
    expect(measurements).toHaveLength(20);
    expect(new Set(measurements.map((m) => m.latencyMs)).size).toBeGreaterThan(1);
    for (const measurement of measurements) {
      expect(measurement.latencyMs).toBeGreaterThanOrEqual(0.5);
      expect(measurement.latencyMs).toBeLessThanOrEqual(warningThresholds.latencyMs);
      expect(measurement.loadPercent).toBeGreaterThanOrEqual(0);
      expect(measurement.loadPercent).toBeLessThanOrEqual(warningThresholds.loadPercent);
      expect(measurement.uptimeSeconds).toBeGreaterThan(0);
    }
  });

  it('busy and slow devices exceed exactly one warning threshold', async () => {
    const collector = immediate({ personalities: { hot: 'busy', far: 'slow' } });
    for (const measurement of successes(await series(collector, 'hot', 10))) {
      expect(measurement.loadPercent).toBeGreaterThan(warningThresholds.loadPercent);
      expect(measurement.loadPercent).toBeLessThanOrEqual(100);
      expect(measurement.latencyMs).toBeLessThanOrEqual(warningThresholds.latencyMs);
    }
    for (const measurement of successes(await series(collector, 'far', 10))) {
      expect(measurement.latencyMs).toBeGreaterThan(warningThresholds.latencyMs);
      expect(measurement.loadPercent).toBeLessThanOrEqual(warningThresholds.loadPercent);
    }
  });

  it('a down device never answers and alternates between timeouts and errors', async () => {
    const results = await series(immediate({ personalities: { dead: 'down' } }), 'dead', 40);
    const kinds = new Set(results.map((result) => result.result));
    expect(kinds).toEqual(new Set(['timeout', 'error']));
    for (const result of results) {
      if (result.result === 'timeout') expect(result.error).toBe('No reply from 10.0.0.1');
      else if (result.result === 'error') expect(result.error).toBe('EHOSTUNREACH 10.0.0.1');
    }
  });

  it('a flaky device mostly answers but fails now and then', async () => {
    const results = await series(immediate({ personalities: { flap: 'flaky' } }), 'flap', 60);
    const failures = results.filter((result) => result.result !== 'success').length;
    expect(failures).toBeGreaterThan(5);
    expect(failures).toBeLessThan(40);
  });

  it('reports uptime that grows with the clock and resets after an outage', async () => {
    let at = Date.parse('2026-10-13T08:00:00.000Z');
    const collector = immediate({ now: () => new Date(at), personalities: { flap: 'flaky' } });
    const results: CollectorResult[] = [];
    for (let index = 0; index < 60; index += 1) {
      results.push(await collector.check(target('flap'), live()));
      at += 60_000;
    }
    let previous: CollectorResult | undefined;
    let resets = 0;
    for (const result of results) {
      if (result.result === 'success' && previous?.result === 'success') {
        expect(result.measurements.uptimeSeconds).toBe(previous.measurements.uptimeSeconds! + 60);
      } else if (result.result === 'success' && previous && previous.result !== 'success') {
        expect(result.measurements.uptimeSeconds).toBeLessThan(90 * 86_400);
        resets += 1;
      }
      previous = result;
    }
    expect(resets).toBeGreaterThan(0);
  });

  it('waits for the simulated round trip and honours cancellation', async () => {
    vi.useFakeTimers();
    const collector = new SimulatorCollector({ personalities: { sw: 'steady' }, delayFactor: 100 });
    const pending = collector.check(target('sw'), live());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(40);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(settled).toBe(true);
    expect((await pending).result).toBe('success');

    const controller = new AbortController();
    const cancelled = collector.check(target('sw'), controller.signal);
    await vi.advanceTimersByTimeAsync(10);
    controller.abort();
    await expect(cancelled).rejects.toBeInstanceOf(CollectorAbortedError);
    await expect(collector.check(target('sw'), AbortSignal.abort())).rejects.toBeInstanceOf(
      CollectorAbortedError,
    );
    // Failures cost no round trip, so a down device answers immediately even with a delay factor.
    const down = new SimulatorCollector({ personalities: { dead: 'down' }, delayFactor: 100 });
    const failure = down.check(target('dead'), live());
    await vi.advanceTimersByTimeAsync(0);
    expect((await failure).result).not.toBe('success');
  });

  it('answers with its defaults when constructed without options', async () => {
    const collector = new SimulatorCollector();
    const result = await collector.check(target('RTR-001', '10.20.0.1'), live());
    expect(['success', 'timeout', 'error']).toContain(result.result);
    expect(collector.personality(target('RTR-001', '10.20.0.1'))).toBe(
      personalityFor({ deviceId: 'RTR-001', address: '10.20.0.1' }),
    );
  });

  it('derives a personality from identity unless one is pinned', () => {
    const collector = immediate({ personalities: { pinned: 'down' } });
    expect(collector.personality(target('pinned'))).toBe('down');
    expect(collector.personality(target('RTR-001', '10.20.0.1'))).toBe(
      personalityFor({ deviceId: 'RTR-001', address: '10.20.0.1' }),
    );
    expect(collector.source).toBe('simulator');
  });
});

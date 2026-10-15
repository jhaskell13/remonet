import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Device, Network } from '../../../shared/network.ts';
import {
  CollectorAbortedError,
  throwIfAborted,
  type Collector,
  type CollectorResult,
  type CollectorTarget,
} from '../../../server/collectors/collector.ts';
import {
  backoffDelayMs,
  CollectorScheduler,
  defaultRetryPolicy,
  Semaphore,
  type SchedulerLogger,
  type SchedulerOptions,
} from '../../../server/collectors/scheduler.ts';
import type { ObservationInput } from '../../../server/modules/monitoring/monitoring.service.ts';

// The scheduler is exercised entirely in memory: networks and devices are plain fixtures, the
// collector is scripted per device, and `record` captures what would have been persisted.

function network(id: string, overrides: Partial<Network> = {}): Network {
  return {
    id,
    organizationId: 'org-demo',
    name: id,
    description: '',
    monitoringEnabled: true,
    pollIntervalSeconds: 60,
    ...overrides,
  };
}
function device(id: string, networkId: string): Device {
  return {
    id,
    organizationId: 'org-demo',
    networkId,
    areaId: 'area',
    name: id,
    type: 'Switch',
    address: `10.0.0.${id.length}`,
    status: 'Pending',
    statusReason: 'Waiting for the first check',
    uptime: 'Not measured',
    latency: 0,
    load: 0,
    lastSeen: null,
  };
}
const ok: CollectorResult = { result: 'success', measurements: { latencyMs: 4, loadPercent: 30 } };
const failed: CollectorResult = { result: 'error', error: 'ECONNREFUSED' };

type Behaviour = (target: CollectorTarget, signal: AbortSignal, attempt: number) => Promise<CollectorResult>;
/** Answers after `delayMs` (default 10) unless cancelled, and counts concurrent checks. */
function answer(result: CollectorResult, delayMs = 10): Behaviour {
  return (_target, signal) =>
    new Promise((resolve, reject) => {
      throwIfAborted(signal);
      const timer = setTimeout(() => resolve(result), delayMs);
      signal.addEventListener('abort', () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });
}
/** Never settles and ignores its signal: the worst-behaved collector the scheduler must survive. */
const hang: Behaviour = () => new Promise(() => {});

class ScriptedCollector implements Collector {
  readonly source = 'simulator' as const;
  readonly attempts = new Map<string, number>();
  inFlight = 0;
  maxInFlight = 0;
  constructor(
    private readonly behaviour: Behaviour,
    private readonly perDevice: Record<string, Behaviour> = {},
  ) {}
  async check(target: CollectorTarget, signal: AbortSignal) {
    const attempt = (this.attempts.get(target.deviceId) ?? 0) + 1;
    this.attempts.set(target.deviceId, attempt);
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      return await (this.perDevice[target.deviceId] ?? this.behaviour)(target, signal, attempt);
    } finally {
      this.inFlight -= 1;
    }
  }
}

type LogLine = { level: 'info' | 'warn' | 'error'; fields: Record<string, unknown>; message: string };
function recorder(): SchedulerLogger & {
  lines: LogLine[];
  messages: (level?: LogLine['level']) => string[];
} {
  const lines: LogLine[] = [];
  const push = (level: LogLine['level']) => (fields: Record<string, unknown>, message: string) => {
    lines.push({ level, fields, message });
  };
  return {
    lines,
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    messages: (level) => lines.filter((line) => !level || line.level === level).map((line) => line.message),
  };
}

function setup(
  collector: Collector,
  networks: Network[],
  devices: Device[],
  overrides: Partial<SchedulerOptions> = {},
) {
  const recorded: ObservationInput[] = [];
  const logger = recorder();
  const scheduler = new CollectorScheduler({
    collector,
    logger,
    listNetworks: () => networks,
    listDevices: (net) => devices.filter((candidate) => candidate.networkId === net.id),
    record: (input) => {
      recorded.push(input);
    },
    checkTimeoutMs: 1_000,
    maxConcurrentChecks: 8,
    retry: { attempts: 1, baseDelayMs: 100, maxDelayMs: 1_000 },
    ...overrides,
  });
  return { scheduler, recorded, logger };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-10-13T08:00:00.000Z') });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Semaphore', () => {
  it('limits concurrent holders, wakes waiters in order, and ignores double release', async () => {
    const semaphore = new Semaphore(1);
    const first = await semaphore.acquire();
    const order: string[] = [];
    const second = semaphore.acquire().then((release) => {
      order.push('second');
      return release;
    });
    const third = semaphore.acquire().then((release) => {
      order.push('third');
      return release;
    });
    expect(semaphore.inUse).toBe(1);
    first();
    first();
    (await second)();
    await third;
    expect(order).toEqual(['second', 'third']);
    expect(semaphore.inUse).toBe(1);
  });
});

describe('backoff', () => {
  it('doubles from the base delay and caps at the maximum', () => {
    expect(defaultRetryPolicy).toEqual({ attempts: 3, baseDelayMs: 500, maxDelayMs: 5_000 });
    const policy = { attempts: 5, baseDelayMs: 100, maxDelayMs: 350 };
    expect([1, 2, 3, 4].map((attempt) => backoffDelayMs(policy, attempt))).toEqual([100, 200, 350, 350]);
  });
});

describe('CollectorScheduler', () => {
  it('checks every device of a network once and records each answer with its source and time', async () => {
    const collector = new ScriptedCollector(answer(ok), { 'sw-2': answer(failed) });
    const { scheduler, recorded, logger } = setup(
      collector,
      [network('net-a')],
      [device('sw-1', 'net-a'), device('sw-2', 'net-a'), device('other', 'net-b')],
    );
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(10);
    const summary = await cycle;
    expect(summary).toEqual({
      networkId: 'net-a',
      startedAt: '2026-10-13T08:00:00.000Z',
      completedAt: '2026-10-13T08:00:00.010Z',
      durationMs: 10,
      devices: 2,
      success: 1,
      timeout: 0,
      error: 1,
      retries: 0,
      dropped: 0,
    });
    expect(recorded).toEqual([
      {
        deviceId: 'sw-1',
        organizationId: 'org-demo',
        source: 'simulator',
        collectedAt: '2026-10-13T08:00:00.010Z',
        result: 'success',
        latencyMs: 4,
        loadPercent: 30,
        uptimeSeconds: undefined,
      },
      {
        deviceId: 'sw-2',
        organizationId: 'org-demo',
        source: 'simulator',
        collectedAt: '2026-10-13T08:00:00.010Z',
        result: 'error',
        errorMessage: 'ECONNREFUSED',
      },
    ]);
    expect(logger.messages()).toEqual([
      'Collection cycle started',
      'Device checked',
      'Device checked',
      'Collection cycle completed',
    ]);
    expect(logger.lines[1]?.fields).toEqual({
      networkId: 'net-a',
      deviceId: 'sw-1',
      address: '10.0.0.4',
      source: 'simulator',
      trigger: 'cycle',
      result: 'success',
      attempts: 1,
      latencyMs: 4,
      collectedAt: '2026-10-13T08:00:00.010Z',
    });
    expect(logger.lines[2]?.fields).toMatchObject({
      deviceId: 'sw-2',
      result: 'error',
      error: 'ECONNREFUSED',
    });
    expect(scheduler.getState().networks[0]).toMatchObject({
      networkId: 'net-a',
      running: false,
      lastCycle: summary,
    });
  });

  it('checks a single device on demand with the same limits and notifies cycle listeners', async () => {
    const collector = new ScriptedCollector(answer(ok, 50));
    const cycles: string[] = [];
    const { scheduler, recorded, logger } = setup(
      collector,
      [network('net-a')],
      [device('d', 'net-a'), device('e', 'net-a')],
      {
        maxConcurrentChecks: 1,
        onCycle: (net, summary) => {
          cycles.push(`${net.id}:${summary.success}`);
          throw new Error('listener bug');
        },
      },
    );
    const cycle = scheduler.runNetwork('net-a');
    const onDemand = scheduler.checkDevice(device('d', 'net-a'));
    await vi.advanceTimersByTimeAsync(150);
    await cycle;
    expect(await onDemand).toEqual({ result: ok, attempts: 1 });
    expect(collector.maxInFlight).toBe(1);
    expect(recorded.map((input) => input.deviceId)).toEqual(['d', 'e', 'd']);
    expect(logger.messages('info')).toContain('On-demand check requested');
    expect(
      logger.lines.filter((line) => line.message === 'Device checked').map((line) => line.fields.trigger),
    ).toEqual(['cycle', 'cycle', 'on-demand']);
    expect(cycles).toEqual(['net-a:2']);
    expect(logger.lines.find((line) => line.message === 'Cycle listener failed')?.fields).toMatchObject({
      networkId: 'net-a',
      err: expect.any(Error),
    });
    await scheduler.stop();
    expect(await scheduler.checkDevice(device('d', 'net-a'))).toBeUndefined();
  });

  it('never runs more checks at once than the concurrency limit', async () => {
    const collector = new ScriptedCollector(answer(ok, 50));
    const devices = ['a', 'bb', 'ccc', 'dddd', 'eeeee'].map((id) => device(id, 'net-a'));
    const { scheduler, recorded } = setup(collector, [network('net-a')], devices, { maxConcurrentChecks: 2 });
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(50);
    expect(collector.inFlight).toBe(2);
    expect(scheduler.getState()).toMatchObject({ inFlight: 2, networks: [{ running: true }] });
    await vi.advanceTimersByTimeAsync(100);
    await cycle;
    expect(collector.maxInFlight).toBe(2);
    expect(recorded).toHaveLength(5);
    expect(scheduler.getState().inFlight).toBe(0);
  });

  it('cancels a check at the timeout, even when the collector ignores its signal', async () => {
    const collector = new ScriptedCollector(answer(ok), { hung: hang, polite: answer(ok, 5_000) });
    const { scheduler, recorded } = setup(
      collector,
      [network('net-a')],
      [device('hung', 'net-a'), device('polite', 'net-a')],
      { checkTimeoutMs: 250 },
    );
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(249);
    expect(recorded).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const summary = await cycle;
    expect(summary).toMatchObject({ timeout: 2, durationMs: 250 });
    expect(recorded.map((input) => [input.deviceId, input.result, input.errorMessage])).toEqual([
      ['hung', 'timeout', 'Check timed out after 250 ms'],
      ['polite', 'timeout', 'Check timed out after 250 ms'],
    ]);
  });

  it('retries failures with exponential backoff before recording the outcome', async () => {
    const flaky: Behaviour = (target, signal, attempt) =>
      answer(attempt < 3 ? { result: 'timeout' } : ok)(target, signal, attempt);
    const collector = new ScriptedCollector(answer(failed), { flaky });
    const { scheduler, recorded, logger } = setup(
      collector,
      [network('net-a')],
      [device('flaky', 'net-a'), device('down', 'net-a')],
      { retry: { attempts: 3, baseDelayMs: 100, maxDelayMs: 150 } },
    );
    const cycle = scheduler.runNetwork('net-a');
    // Attempt 1 at 10 ms, wait 100, attempt 2 at 120 ms, wait 150 (capped), attempt 3 at 280 ms.
    await vi.advanceTimersByTimeAsync(279);
    expect(recorded).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    const summary = await cycle;
    expect(summary).toMatchObject({ success: 1, error: 1, retries: 4, durationMs: 280 });
    expect(collector.attempts.get('flaky')).toBe(3);
    expect(collector.attempts.get('down')).toBe(3);
    expect(recorded.map((input) => [input.deviceId, input.result])).toEqual([
      ['flaky', 'success'],
      ['down', 'error'],
    ]);
    expect(logger.messages('warn')).toEqual(Array(4).fill('Check failed, retrying'));
    expect(logger.lines.filter((line) => line.level === 'warn')[0]?.fields).toEqual({
      deviceId: 'flaky',
      attempt: 1,
      result: 'timeout',
      error: undefined,
    });
    expect(
      logger.lines.find((line) => line.fields.deviceId === 'flaky' && line.message === 'Device checked')
        ?.fields,
    ).toMatchObject({ attempts: 3 });
  });

  it('keeps the cycle going when a result cannot be recorded', async () => {
    const collector = new ScriptedCollector(answer(ok));
    const recorded: ObservationInput[] = [];
    const { scheduler, logger } = setup(
      collector,
      [network('net-a')],
      [device('gone', 'net-a'), device('kept', 'net-a')],
      {
        record: (input) => {
          if (input.deviceId === 'gone') throw new Error('Device not found');
          recorded.push(input);
        },
      },
    );
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(10);
    expect(await cycle).toMatchObject({ success: 1, dropped: 1 });
    expect(recorded.map((input) => input.deviceId)).toEqual(['kept']);
    expect(logger.lines.find((line) => line.level === 'warn')).toMatchObject({
      message: 'Observation could not be recorded',
      fields: { deviceId: 'gone', err: expect.any(Error) },
    });
  });

  it('schedules enabled networks on their own intervals and leaves disabled ones alone', async () => {
    const collector = new ScriptedCollector(answer(ok));
    const networks = [
      network('fast', { pollIntervalSeconds: 5 }),
      network('slow', { pollIntervalSeconds: 10 }),
      network('paused', { monitoringEnabled: false }),
    ];
    const { scheduler, recorded, logger } = setup(collector, networks, [
      device('f', 'fast'),
      device('s', 'slow'),
      device('p', 'paused'),
    ]);
    scheduler.start();
    scheduler.start();
    expect(logger.messages('info')).toEqual(['Collector scheduler started']);
    expect(scheduler.getState()).toMatchObject({
      running: true,
      source: 'simulator',
      networks: [
        { networkId: 'fast', enabled: true, nextRunAt: '2026-10-13T08:00:00.000Z' },
        { networkId: 'paused', enabled: false, nextRunAt: null },
        { networkId: 'slow', enabled: true, nextRunAt: '2026-10-13T08:00:00.000Z' },
      ],
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(recorded.map((input) => input.deviceId)).toEqual(['f', 's']);
    expect(scheduler.getState().networks.find((state) => state.networkId === 'fast')?.nextRunAt).toBe(
      '2026-10-13T08:00:05.010Z',
    );
    await vi.advanceTimersByTimeAsync(20_000);
    const counts = recorded.reduce<Record<string, number>>((tally, input) => {
      tally[input.deviceId] = (tally[input.deviceId] ?? 0) + 1;
      return tally;
    }, {});
    // Cycles are spaced from completion, so by 20.01 s: fast ran at 0, 5.01, 10.02, and 15.03 s;
    // slow ran at 0 and 10.01 s, with its third cycle due at 20.02 s.
    expect(counts).toEqual({ f: 4, s: 2 });
    await scheduler.stop();
    await scheduler.stop();
    expect(scheduler.getState().running).toBe(false);
    expect(logger.messages('info').at(-1)).toBe('Collector scheduler stopped');
  });

  it('applies setting changes: pausing stops the timer, resuming runs at once, removal drops the network', async () => {
    const collector = new ScriptedCollector(answer(ok));
    const networks = [network('net-a', { pollIntervalSeconds: 5 })];
    const { scheduler, recorded } = setup(collector, networks, [device('d', 'net-a')], {
      discoveryIntervalMs: 1_000,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(recorded).toHaveLength(1);

    networks[0] = network('net-a', { pollIntervalSeconds: 5, monitoringEnabled: false });
    scheduler.sync();
    expect(scheduler.getState().networks[0]).toMatchObject({ enabled: false, nextRunAt: null });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(recorded).toHaveLength(1);

    networks[0] = network('net-a', { pollIntervalSeconds: 5 });
    await vi.advanceTimersByTimeAsync(1_010);
    expect(recorded).toHaveLength(2);

    // A change that lands while a timer is pending is honoured when the timer fires.
    networks[0] = network('net-a', { pollIntervalSeconds: 5, monitoringEnabled: false });
    await vi.advanceTimersByTimeAsync(6_000);
    expect(recorded).toHaveLength(2);

    networks.length = 0;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(scheduler.getState().networks).toEqual([]);

    networks.push(network('net-b'));
    await vi.advanceTimersByTimeAsync(1_010);
    expect(scheduler.getState().networks.map((state) => state.networkId)).toEqual(['net-b']);
    await scheduler.stop();
  });

  it('never overlaps cycles of one network, even when a cycle outlasts the interval', async () => {
    const collector = new ScriptedCollector(answer(ok, 8_000));
    const networks = [network('net-a', { pollIntervalSeconds: 5 })];
    const { scheduler, recorded } = setup(collector, networks, [device('d', 'net-a')], {
      checkTimeoutMs: 20_000,
    });
    scheduler.start();
    await vi.advanceTimersByTimeAsync(7_000);
    expect(collector.inFlight).toBe(1);
    expect(scheduler.getState().networks[0]).toMatchObject({ running: true, nextRunAt: null });
    // Removing the network mid-cycle lets the cycle finish but prevents another one.
    networks.length = 0;
    scheduler.sync();
    expect(scheduler.getState().networks[0]).toMatchObject({ enabled: false, running: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(recorded).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(recorded).toHaveLength(1);
    expect(collector.attempts.get('d')).toBe(1);
    scheduler.sync();
    expect(scheduler.getState().networks).toEqual([]);
    await scheduler.stop();
  });

  it('re-reads settings when a timer fires and forgets networks that disappeared meanwhile', async () => {
    const networks = [
      network('net-a', { pollIntervalSeconds: 5 }),
      network('net-b', { pollIntervalSeconds: 5 }),
    ];
    const { scheduler, recorded } = setup(
      new ScriptedCollector(answer(ok)),
      networks,
      [device('d', 'net-a'), device('e', 'net-b')],
      { discoveryIntervalMs: 60_000 },
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(recorded).toHaveLength(2);
    // Between discoveries: net-a is paused and net-b removed; both timers are still pending.
    networks[0] = network('net-a', { pollIntervalSeconds: 5, monitoringEnabled: false });
    networks.splice(1, 1);
    await vi.advanceTimersByTimeAsync(6_000);
    expect(recorded).toHaveLength(2);
    expect(scheduler.getState().networks).toMatchObject([{ networkId: 'net-a', nextRunAt: null }]);
    // Removing a network whose timer is pending drops it at the next sync.
    networks[0] = network('net-a', { pollIntervalSeconds: 5 });
    scheduler.sync();
    expect(scheduler.getState().networks[0]?.nextRunAt).not.toBeNull();
    networks.length = 0;
    scheduler.sync();
    expect(scheduler.getState().networks).toEqual([]);
    await scheduler.stop();
  });

  it('can be stopped without ever having been started', async () => {
    const { scheduler, logger } = setup(new ScriptedCollector(answer(ok)), [network('net-a')], []);
    await scheduler.stop();
    expect(logger.messages()).toEqual(['Collector scheduler stopped']);
    expect(scheduler.getState()).toEqual({ running: false, source: 'simulator', inFlight: 0, networks: [] });
  });

  it('logs a collector-reported timeout without a message as a plain timeout', async () => {
    const { scheduler, recorded, logger } = setup(
      new ScriptedCollector(answer({ result: 'timeout' })),
      [network('net-a')],
      [device('d', 'net-a')],
    );
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(10);
    expect(await cycle).toMatchObject({ timeout: 1 });
    expect(recorded[0]).toMatchObject({ result: 'timeout', errorMessage: undefined });
    expect(logger.lines.find((line) => line.message === 'Device checked')?.fields).toMatchObject({
      result: 'timeout',
      error: 'Check timed out',
    });
  });

  it('stop cancels in-flight checks and pending retries without recording anything for them', async () => {
    const collector = new ScriptedCollector(answer(ok, 500), { retrying: answer(failed, 10) });
    const { scheduler, recorded, logger } = setup(
      collector,
      [network('net-a')],
      [device('slow', 'net-a'), device('retrying', 'net-a')],
      { retry: { attempts: 3, baseDelayMs: 10_000, maxDelayMs: 10_000 } },
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(50);
    expect(collector.inFlight).toBe(1);
    const stopping = scheduler.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    expect(collector.inFlight).toBe(0);
    expect(recorded).toEqual([]);
    expect(logger.messages('info').at(-2)).toBe('Collection cycle completed');
    expect(logger.lines.at(-2)?.fields).toMatchObject({ dropped: 2, success: 0, timeout: 0 });
    expect(scheduler.getState().running).toBe(false);
    // Once stopped, nothing can be scheduled again.
    scheduler.start();
    scheduler.sync();
    expect(scheduler.getState().networks[0]?.nextRunAt).toBeNull();
  });

  it('drops devices still waiting for a slot when stopped', async () => {
    const collector = new ScriptedCollector(answer(ok, 500));
    const { scheduler, recorded, logger } = setup(
      collector,
      [network('net-a')],
      [device('first', 'net-a'), device('second', 'net-a')],
      { maxConcurrentChecks: 1 },
    );
    scheduler.start();
    await vi.advanceTimersByTimeAsync(50);
    const stopping = scheduler.stop();
    await vi.advanceTimersByTimeAsync(0);
    await stopping;
    expect(collector.attempts.has('second')).toBe(false);
    expect(recorded).toEqual([]);
    expect(logger.lines.find((line) => line.message === 'Collection cycle completed')?.fields).toMatchObject({
      devices: 2,
      dropped: 2,
    });
  });

  it('reports a failing cycle and recovers on the next one', async () => {
    const devices = [device('d', 'net-a')];
    let failure: unknown = new Error('database is locked');
    const { scheduler, logger } = setup(new ScriptedCollector(answer(ok)), [network('net-a')], devices, {
      listDevices: () => {
        if (failure) throw failure;
        return devices;
      },
    });
    const first = scheduler.runNetwork('net-a');
    // A cycle queued behind a failing one still runs.
    const queued = scheduler.runNetwork('net-a').catch((error: unknown) => error);
    await expect(first).rejects.toThrow('database is locked');
    expect(scheduler.getState().networks[0]?.lastError).toBe('database is locked');
    expect(logger.lines.at(-1)).toMatchObject({ level: 'error', message: 'Collection cycle failed' });
    expect(await queued).toMatchObject({ message: 'database is locked' });
    failure = 'disk full';
    await expect(scheduler.runNetwork('net-a')).rejects.toBe('disk full');
    expect(scheduler.getState().networks[0]).toMatchObject({ running: false, lastError: 'disk full' });
    failure = undefined;
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(10);
    await cycle;
    expect(scheduler.getState().networks[0]).toMatchObject({ lastError: null, lastCycle: { success: 1 } });
  });

  it('runNetwork refuses unknown networks and queues behind a running cycle', async () => {
    const collector = new ScriptedCollector(answer(ok, 100));
    const { scheduler, recorded } = setup(collector, [network('net-a')], [device('d', 'net-a')]);
    await expect(scheduler.runNetwork('net-x')).rejects.toThrow(
      'Network net-x is not known to the scheduler',
    );
    const first = scheduler.runNetwork('net-a');
    const second = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(100);
    await first;
    expect(collector.maxInFlight).toBe(1);
    await vi.advanceTimersByTimeAsync(100);
    await second;
    expect(recorded).toHaveLength(2);
  });

  it('uses the real clock when none is injected', async () => {
    vi.useRealTimers();
    const { scheduler, recorded } = setup(
      new ScriptedCollector(answer(ok, 1)),
      [network('net-a')],
      [device('d', 'net-a')],
    );
    const before = Date.now();
    await scheduler.runNetwork('net-a');
    expect(Date.parse(recorded[0]!.collectedAt!)).toBeGreaterThanOrEqual(before);
  });

  it('records a collector that rejects on cancellation as a timeout with the scheduler’s reason', async () => {
    const abortOnly: Behaviour = (_target, signal) =>
      new Promise((_, reject) => signal.addEventListener('abort', () => reject(new CollectorAbortedError())));
    const { scheduler, recorded } = setup(
      new ScriptedCollector(abortOnly),
      [network('net-a')],
      [device('d', 'net-a')],
      {
        checkTimeoutMs: 100,
      },
    );
    const cycle = scheduler.runNetwork('net-a');
    await vi.advanceTimersByTimeAsync(100);
    await cycle;
    expect(recorded[0]).toMatchObject({ result: 'timeout', errorMessage: 'Check timed out after 100 ms' });
  });
});

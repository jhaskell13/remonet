import {
  CollectorAbortedError,
  throwIfAborted,
  type Collector,
  type CollectorResult,
  type CollectorTarget,
} from './collector.ts';

/**
 * A collector that answers for hardware that does not exist.
 *
 * Every device gets a stable personality derived from its identity (and an optional seed), so the
 * same inventory produces the same story on every run: most devices answer steadily, some run hot
 * or slow (Warning), a few flap, and the odd one is down. Checks are numbered per device and every
 * value is derived from that number, which keeps results reproducible in tests while still varying
 * from check to check. The simulated round trip honours the scheduler's `AbortSignal` like a real
 * protocol would.
 */

export type SimulatorPersonality = 'steady' | 'busy' | 'slow' | 'flaky' | 'down';

export type SimulatorOptions = {
  /** Changes every device's personality and measurements; defaults to a fixed seed. */
  seed?: string | undefined;
  /** Pins personalities for specific device ids, overriding the derived one. */
  personalities?: Record<string, SimulatorPersonality> | undefined;
  /** Multiplies the simulated round-trip wait; 0 answers immediately (useful in tests). */
  delayFactor?: number | undefined;
  now?: (() => Date) | undefined;
};

/** Share of devices with each personality, in the order they are assigned along [0, 1). */
export const personalityDistribution: readonly [SimulatorPersonality, number][] = [
  ['steady', 0.7],
  ['busy', 0.1],
  ['slow', 0.1],
  ['flaky', 0.07],
  ['down', 0.03],
];

/** FNV-1a: small, dependency-free, and stable across platforms. */
export function hash32(input: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
/** A deterministic number in [0, 1) for the given input. */
export function unit(input: string) {
  return hash32(input) / 0x1_0000_0000;
}
const between = (value: number, min: number, max: number) => min + value * (max - min);

export function personalityFor(target: Pick<CollectorTarget, 'deviceId' | 'address'>, seed = 'remonet') {
  const roll = unit(`${seed}:personality:${target.deviceId}:${target.address}`);
  let cumulative = 0;
  let chosen: SimulatorPersonality = personalityDistribution[0]![0];
  for (const [personality, share] of personalityDistribution) {
    chosen = personality;
    cumulative += share;
    if (roll < cumulative) break;
  }
  return chosen;
}

type DeviceState = { checks: number; bootedAt: number | null };

export class SimulatorCollector implements Collector {
  readonly source = 'simulator' as const;
  private readonly seed: string;
  private readonly personalities: Record<string, SimulatorPersonality>;
  private readonly delayFactor: number;
  private readonly now: () => Date;
  private readonly devices = new Map<string, DeviceState>();

  constructor(options: SimulatorOptions = {}) {
    this.seed = options.seed ?? 'remonet';
    this.personalities = options.personalities ?? {};
    this.delayFactor = options.delayFactor ?? 1;
    this.now = options.now ?? (() => new Date());
  }

  personality(target: Pick<CollectorTarget, 'deviceId' | 'address'>) {
    return this.personalities[target.deviceId] ?? personalityFor(target, this.seed);
  }

  async check(target: CollectorTarget, signal: AbortSignal): Promise<CollectorResult> {
    throwIfAborted(signal);
    const state = this.devices.get(target.deviceId) ?? { checks: 0, bootedAt: null };
    state.checks += 1;
    this.devices.set(target.deviceId, state);
    const outcome = this.outcome(target, state.checks);
    await this.roundTrip(outcome.result === 'success' ? outcome.measurements.latencyMs : 0, signal);
    const now = this.now().getTime();
    if (outcome.result !== 'success') {
      // A device that stopped answering comes back freshly booted.
      state.bootedAt = null;
      return outcome;
    }
    state.bootedAt ??= now - Math.floor(between(this.roll(target, 'boot', 0), 3_600, 90 * 86_400)) * 1000;
    return {
      result: 'success',
      measurements: { ...outcome.measurements, uptimeSeconds: Math.floor((now - state.bootedAt) / 1000) },
    };
  }

  private roll(target: CollectorTarget, aspect: string, check: number) {
    return unit(`${this.seed}:${aspect}:${target.deviceId}:${target.address}:${check}`);
  }

  private outcome(target: CollectorTarget, check: number): CollectorResult {
    const personality = this.personality(target);
    const latencyBase = between(this.roll(target, 'latency', 0), 2, 18);
    const loadBase = between(this.roll(target, 'load', 0), 8, 55);
    const jitter = (aspect: string) => between(this.roll(target, aspect, check), -1, 1);
    const measure = (latencyMs: number, loadPercent: number): CollectorResult => ({
      result: 'success',
      measurements: {
        latencyMs: Number(Math.max(0.5, latencyMs).toFixed(1)),
        loadPercent: Number(Math.min(100, Math.max(0, loadPercent)).toFixed(1)),
      },
    });
    const failure = (): CollectorResult =>
      this.roll(target, 'failure', check) < 0.5
        ? { result: 'timeout', error: `No reply from ${target.address}` }
        : { result: 'error', error: `EHOSTUNREACH ${target.address}` };
    switch (personality) {
      case 'steady':
        return measure(latencyBase + jitter('latency') * 2, loadBase + jitter('load') * 6);
      case 'busy':
        return measure(
          latencyBase + jitter('latency') * 3,
          between(this.roll(target, 'load', check), 72, 96),
        );
      case 'slow':
        return measure(between(this.roll(target, 'latency', check), 28, 65), loadBase + jitter('load') * 6);
      case 'flaky':
        return this.roll(target, 'flap', check) < 0.35
          ? failure()
          : measure(latencyBase + jitter('latency') * 8, loadBase + jitter('load') * 10);
      case 'down':
        return failure();
    }
  }

  /** Waits for the simulated round trip, or rejects as soon as the signal aborts. */
  private roundTrip(latencyMs: number, signal: AbortSignal) {
    const waitMs = latencyMs * this.delayFactor;
    if (waitMs <= 0) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', cancel);
        resolve();
      }, waitMs);
      const cancel = () => {
        clearTimeout(timer);
        reject(new CollectorAbortedError());
      };
      signal.addEventListener('abort', cancel, { once: true });
    });
  }
}

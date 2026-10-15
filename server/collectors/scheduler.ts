import type {
  CollectionCycleSummary,
  Device,
  Network,
  NetworkCollectionState,
} from '../../shared/network.ts';
import type { ObservationInput } from '../modules/monitoring/monitoring.service.ts';
import {
  CollectorAbortedError,
  failureFrom,
  observationFrom,
  targetFor,
  type Collector,
  type CollectorResult,
  type CollectorTarget,
} from './collector.ts';

/**
 * Runs collectors on a schedule.
 *
 * Each network with monitoring enabled gets its own cycle, repeated every `pollIntervalSeconds`
 * after the previous cycle completes, so cycles of one network never overlap. Within a cycle every
 * device is checked with a timeout, bounded by a concurrency limit shared across networks, and
 * retried with exponential backoff before a failure is recorded. Results are persisted through the
 * injected `record` function (the monitoring service in production) and summarised in an
 * observable state snapshot and structured log lines.
 */

/** Pino-compatible subset: `app.log` satisfies it, and tests can supply a recorder. */
export type SchedulerLogger = {
  info(fields: Record<string, unknown>, message: string): void;
  warn(fields: Record<string, unknown>, message: string): void;
  error(fields: Record<string, unknown>, message: string): void;
};

export type RetryPolicy = {
  /** Total attempts per device per cycle, including the first. */
  attempts: number;
  /** Delay before the second attempt; each later retry doubles it. */
  baseDelayMs: number;
  maxDelayMs: number;
};

export type SchedulerOptions = {
  collector: Collector;
  logger: SchedulerLogger;
  /** Networks to schedule; read again at every cycle so setting changes apply promptly. */
  listNetworks: () => Network[];
  listDevices: (network: Network) => Device[];
  /** Persists one result; throwing skips that device without stopping the cycle. */
  record: (input: ObservationInput) => void;
  checkTimeoutMs: number;
  maxConcurrentChecks: number;
  retry: RetryPolicy;
  /** How often the scheduler looks for new or re-enabled networks. */
  discoveryIntervalMs?: number | undefined;
  /** Called after every completed cycle (for notifications); errors are logged, not propagated. */
  onCycle?: ((network: Network, summary: CycleSummary) => void) | undefined;
  now?: (() => Date) | undefined;
};

export type CheckTrigger = 'cycle' | 'on-demand';

export type CycleSummary = CollectionCycleSummary;
export type { NetworkCollectionState };

export type SchedulerState = {
  running: boolean;
  source: string;
  inFlight: number;
  networks: NetworkCollectionState[];
};

type NetworkSlot = {
  network: Network;
  timer: ReturnType<typeof setTimeout> | null;
  nextRunAt: string | null;
  cycle: Promise<CycleSummary> | null;
  lastCycle: CycleSummary | null;
  lastError: string | null;
};

/** A counting semaphore that hands out slots in request order. */
export class Semaphore {
  private active = 0;
  private readonly waiting: (() => void)[] = [];

  constructor(private readonly limit: number) {}

  get inUse() {
    return this.active;
  }

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active -= 1;
      this.waiting.shift()?.();
    };
  }
}

export const defaultRetryPolicy: RetryPolicy = { attempts: 3, baseDelayMs: 500, maxDelayMs: 5_000 };

export function backoffDelayMs(retry: RetryPolicy, attempt: number) {
  return Math.min(retry.baseDelayMs * 2 ** (attempt - 1), retry.maxDelayMs);
}

export class CollectorScheduler {
  private readonly slots = new Map<string, NetworkSlot>();
  private readonly semaphore: Semaphore;
  private readonly stopController = new AbortController();
  private discoveryTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;
  private stopped = false;
  private readonly now: () => Date;

  constructor(private readonly options: SchedulerOptions) {
    this.semaphore = new Semaphore(options.maxConcurrentChecks);
    this.now = options.now ?? (() => new Date());
  }

  /** Schedules every enabled network and keeps discovering networks until `stop()`. */
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    this.options.logger.info(
      {
        source: this.options.collector.source,
        checkTimeoutMs: this.options.checkTimeoutMs,
        maxConcurrentChecks: this.options.maxConcurrentChecks,
        attempts: this.options.retry.attempts,
      },
      'Collector scheduler started',
    );
    this.sync();
    const discoveryIntervalMs = this.options.discoveryIntervalMs ?? 30_000;
    const discover = () => {
      this.discoveryTimer = setTimeout(() => {
        this.sync();
        discover();
      }, discoveryIntervalMs);
    };
    discover();
  }

  /** Cancels timers and in-flight checks, then waits for running cycles to wind down. */
  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.discoveryTimer) clearTimeout(this.discoveryTimer);
    this.stopController.abort(new CollectorAbortedError('Collector scheduler stopped'));
    const cycles: Promise<unknown>[] = [];
    for (const slot of this.slots.values()) {
      if (slot.timer) clearTimeout(slot.timer);
      slot.timer = null;
      slot.nextRunAt = null;
      if (slot.cycle) cycles.push(slot.cycle);
    }
    await Promise.allSettled(cycles);
    this.options.logger.info({ source: this.options.collector.source }, 'Collector scheduler stopped');
  }

  /**
   * Reconciles the schedule with the current network settings: newly enabled networks run right
   * away, disabled or removed ones lose their timer (a running cycle finishes on its own).
   */
  sync() {
    if (this.stopped) return;
    const networks = this.options.listNetworks();
    const seen = new Set<string>();
    for (const network of networks) {
      seen.add(network.id);
      const slot = this.slots.get(network.id);
      if (!slot) {
        const created: NetworkSlot = {
          network,
          timer: null,
          nextRunAt: null,
          cycle: null,
          lastCycle: null,
          lastError: null,
        };
        this.slots.set(network.id, created);
        if (network.monitoringEnabled) this.schedule(created, 0);
        continue;
      }
      slot.network = network;
      if (!network.monitoringEnabled && slot.timer) {
        clearTimeout(slot.timer);
        slot.timer = null;
        slot.nextRunAt = null;
      } else if (network.monitoringEnabled && !slot.timer && !slot.cycle) {
        this.schedule(slot, 0);
      }
    }
    for (const [networkId, slot] of this.slots) {
      if (seen.has(networkId)) continue;
      if (slot.timer) clearTimeout(slot.timer);
      if (!slot.cycle) this.slots.delete(networkId);
      else {
        slot.timer = null;
        slot.nextRunAt = null;
        slot.network = { ...slot.network, monitoringEnabled: false };
      }
    }
  }

  /** Runs one cycle for a network now (used by tests and tooling); waits if one is already running. */
  async runNetwork(networkId: string): Promise<CycleSummary> {
    const network = this.options.listNetworks().find((candidate) => candidate.id === networkId);
    if (!network) throw new Error(`Network ${networkId} is not known to the scheduler`);
    let slot = this.slots.get(networkId);
    if (!slot) {
      slot = { network, timer: null, nextRunAt: null, cycle: null, lastCycle: null, lastError: null };
      this.slots.set(networkId, slot);
    }
    slot.network = network;
    if (slot.cycle) await slot.cycle.catch(() => undefined);
    return this.runCycle(slot);
  }

  getState(): SchedulerState {
    return {
      running: this.started && !this.stopped,
      source: this.options.collector.source,
      inFlight: this.semaphore.inUse,
      networks: [...this.slots.values()]
        .map((slot) => ({
          networkId: slot.network.id,
          organizationId: slot.network.organizationId,
          name: slot.network.name,
          enabled: slot.network.monitoringEnabled,
          pollIntervalSeconds: slot.network.pollIntervalSeconds,
          running: slot.cycle !== null,
          nextRunAt: slot.nextRunAt,
          lastCycle: slot.lastCycle,
          lastError: slot.lastError,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    };
  }

  private schedule(slot: NetworkSlot, delayMs: number) {
    slot.nextRunAt = new Date(this.now().getTime() + delayMs).toISOString();
    slot.timer = setTimeout(() => {
      slot.timer = null;
      slot.nextRunAt = null;
      // Settings may have changed while waiting; re-read before committing to a cycle.
      const current = this.options.listNetworks().find((candidate) => candidate.id === slot.network.id);
      if (!current) {
        this.slots.delete(slot.network.id);
        return;
      }
      slot.network = current;
      if (!current.monitoringEnabled) return;
      void this.runCycle(slot).finally(() => {
        if (!this.stopped && slot.network.monitoringEnabled && !slot.timer)
          this.schedule(slot, slot.network.pollIntervalSeconds * 1000);
      });
    }, delayMs);
  }

  private runCycle(slot: NetworkSlot): Promise<CycleSummary> {
    const cycle = this.collect(slot.network)
      .then((summary) => {
        slot.lastCycle = summary;
        slot.lastError = null;
        return summary;
      })
      .catch((error: unknown) => {
        slot.lastError = error instanceof Error ? error.message : String(error);
        this.options.logger.error({ networkId: slot.network.id, err: error }, 'Collection cycle failed');
        throw error;
      })
      .finally(() => {
        slot.cycle = null;
      });
    slot.cycle = cycle;
    return cycle;
  }

  /**
   * Checks one device outside its network's cycle, for example right after enrollment or when an
   * engineer asks for a check now. Shares the concurrency limit, timeout, and retry policy.
   */
  async checkDevice(device: Device): Promise<{ result: CollectorResult; attempts: number } | undefined> {
    if (this.stopped) return undefined;
    this.options.logger.info(
      { networkId: device.networkId, deviceId: device.id, address: device.address },
      'On-demand check requested',
    );
    return this.checkAndRecord(device, 'on-demand');
  }

  private async collect(network: Network): Promise<CycleSummary> {
    const startedAt = this.now();
    const devices = this.options.listDevices(network);
    const summary = {
      networkId: network.id,
      devices: devices.length,
      success: 0,
      timeout: 0,
      error: 0,
      retries: 0,
      dropped: 0,
    };
    this.options.logger.info(
      { networkId: network.id, organizationId: network.organizationId, devices: devices.length },
      'Collection cycle started',
    );
    await Promise.all(
      devices.map(async (device) => {
        const outcome = await this.checkAndRecord(device, 'cycle');
        if (!outcome) {
          summary.dropped += 1;
          return;
        }
        summary.retries += outcome.attempts - 1;
        summary[outcome.result.result] += 1;
      }),
    );
    const completedAt = this.now();
    const cycle: CycleSummary = {
      ...summary,
      startedAt: startedAt.toISOString(),
      completedAt: completedAt.toISOString(),
      durationMs: completedAt.getTime() - startedAt.getTime(),
    };
    this.options.logger.info({ ...cycle }, 'Collection cycle completed');
    try {
      this.options.onCycle?.(network, cycle);
    } catch (error) {
      this.options.logger.warn({ networkId: network.id, err: error }, 'Cycle listener failed');
    }
    return cycle;
  }

  /**
   * Runs one device through the slot limit, timeout, and retries, then records the outcome.
   * Returns undefined when the result was dropped: the scheduler stopped, or recording failed.
   */
  private async checkAndRecord(
    device: Device,
    trigger: CheckTrigger,
  ): Promise<{ result: CollectorResult; attempts: number } | undefined> {
    const target = targetFor(device);
    const release = await this.semaphore.acquire();
    try {
      if (this.stopController.signal.aborted) return undefined;
      const { result, attempts } = await this.checkWithRetry(target);
      // A check cut short by shutdown says nothing about the device.
      if (this.stopController.signal.aborted) return undefined;
      const collectedAt = this.now();
      try {
        this.options.record(observationFrom(target, this.options.collector.source, result, collectedAt));
      } catch (error) {
        this.options.logger.warn(
          { networkId: device.networkId, deviceId: device.id, trigger, err: error },
          'Observation could not be recorded',
        );
        return undefined;
      }
      this.options.logger.info(
        {
          networkId: device.networkId,
          deviceId: device.id,
          address: device.address,
          source: this.options.collector.source,
          trigger,
          result: result.result,
          attempts,
          ...(result.result === 'success'
            ? { latencyMs: result.measurements.latencyMs }
            : { error: result.error ?? 'Check timed out' }),
          collectedAt: collectedAt.toISOString(),
        },
        'Device checked',
      );
      return { result, attempts };
    } finally {
      release();
    }
  }

  private async checkWithRetry(
    target: CollectorTarget,
  ): Promise<{ result: CollectorResult; attempts: number }> {
    const { attempts } = this.options.retry;
    for (let attempt = 1; ; attempt += 1) {
      const result = await this.checkOnce(target);
      if (result.result === 'success' || attempt >= attempts) return { result, attempts: attempt };
      this.options.logger.warn(
        { deviceId: target.deviceId, attempt, result: result.result, error: result.error },
        'Check failed, retrying',
      );
      await this.delay(backoffDelayMs(this.options.retry, attempt));
    }
  }

  /** One attempt: the collector races a timeout, and a stop cancels it too (or skips it entirely). */
  private async checkOnce(target: CollectorTarget): Promise<CollectorResult> {
    if (this.stopController.signal.aborted) return failureFrom(this.stopController.signal.reason);
    const controller = new AbortController();
    const abort = (reason: Error) => {
      if (!controller.signal.aborted) controller.abort(reason);
    };
    const onStop = () => abort(new CollectorAbortedError('Collector scheduler stopped'));
    const timer = setTimeout(
      () => abort(new CollectorAbortedError(`Check timed out after ${this.options.checkTimeoutMs} ms`)),
      this.options.checkTimeoutMs,
    );
    this.stopController.signal.addEventListener('abort', onStop, { once: true });
    try {
      // A collector that ignores its signal must not hold the cycle hostage.
      const cancelled = new Promise<never>((_, reject) =>
        controller.signal.addEventListener('abort', () => reject(controller.signal.reason as Error), {
          once: true,
        }),
      );
      return await Promise.race([this.options.collector.check(target, controller.signal), cancelled]);
    } catch (error) {
      return failureFrom(error);
    } finally {
      clearTimeout(timer);
      this.stopController.signal.removeEventListener('abort', onStop);
      abort(new CollectorAbortedError('Check settled'));
    }
  }

  /** Waits unless the scheduler is stopping, in which case it returns at once. */
  private delay(ms: number) {
    return new Promise<void>((resolve) => {
      const signal = this.stopController.signal;
      if (signal.aborted) return resolve();
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', finish);
        resolve();
      }, ms);
      const finish = () => {
        clearTimeout(timer);
        resolve();
      };
      signal.addEventListener('abort', finish, { once: true });
    });
  }
}

import type { Device } from '../../shared/network.ts';
import { config } from '../config.ts';
import { publishMonitoringEvent } from '../modules/monitoring/events.ts';
import { recordObservation } from '../modules/monitoring/monitoring.service.ts';
import { listDevices, listNetworks } from '../persistence/repositories/network-repository.ts';
import { CollectorScheduler, defaultRetryPolicy, type SchedulerLogger } from './scheduler.ts';
import { SimulatorCollector } from './simulator.ts';

/**
 * Wires the scheduler to the real application: the configured collector, the repositories, the
 * monitoring service, and the logger. `createApp` keeps the instance here so that use cases (an
 * enrollment that wants an immediate check, the status endpoint) can reach the running scheduler
 * without threading it through every layer.
 */
export function createScheduler(logger: SchedulerLogger): CollectorScheduler | undefined {
  if (config.monitoring.collector === 'off') return undefined;
  return new CollectorScheduler({
    collector: new SimulatorCollector(),
    logger,
    listNetworks: () => listNetworks(),
    listDevices: (network) => listDevices({ networkId: network.id }),
    record: (input) => void recordObservation(input),
    checkTimeoutMs: config.monitoring.checkTimeoutMs,
    maxConcurrentChecks: config.monitoring.maxConcurrentChecks,
    retry: { ...defaultRetryPolicy, attempts: config.monitoring.checkAttempts },
    onCycle: (network, summary) =>
      publishMonitoringEvent({
        type: 'cycle',
        organizationId: network.organizationId,
        networkId: network.id,
        devices: summary.devices,
        success: summary.success,
        timeout: summary.timeout,
        error: summary.error,
        completedAt: summary.completedAt,
      }),
  });
}

let active: CollectorScheduler | undefined;

export function setActiveScheduler(scheduler: CollectorScheduler | undefined) {
  active = scheduler;
}
export function getActiveScheduler() {
  return active;
}

/**
 * Asks the running scheduler to check a device now, without waiting for its network's next cycle.
 * Returns whether a collector was there to take the request; the outcome lands as an observation.
 */
export function requestDeviceCheck(device: Device) {
  if (!active) return false;
  void active.checkDevice(device);
  return true;
}

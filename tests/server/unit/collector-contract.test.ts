import { describe, expect, it } from 'vitest';
import type { Device } from '../../../shared/network.ts';
import {
  CollectorAbortedError,
  failureFrom,
  isAbortError,
  observationFrom,
  targetFor,
  throwIfAborted,
  type Collector,
  type CollectorResult,
  type CollectorTarget,
} from '../../../server/collectors/collector.ts';
import { maxErrorMessageLength } from '../../../server/modules/monitoring/monitoring.service.ts';

const device: Device = {
  id: 'RTR-001',
  organizationId: 'org-demo',
  networkId: 'net-core',
  areaId: 'area-north',
  name: 'Core Router 01',
  type: 'Router',
  address: '10.20.0.1',
  status: 'Pending',
  statusReason: 'Waiting for the first check',
  uptime: 'Not measured',
  latency: 0,
  load: 0,
  lastSeen: null,
};
const target: CollectorTarget = {
  deviceId: 'RTR-001',
  organizationId: 'org-demo',
  networkId: 'net-core',
  name: 'Core Router 01',
  type: 'Router',
  address: '10.20.0.1',
};
const at = new Date('2026-10-13T08:00:00.000Z');

/**
 * A reference collector that follows the contract: it answers after a delay, and settles as soon as
 * the signal aborts. Protocol collectors are expected to behave the same way.
 */
function referenceCollector(answer: CollectorResult, delayMs: number): Collector {
  return {
    source: 'manual',
    check(_target, signal) {
      return new Promise((resolve, reject) => {
        throwIfAborted(signal);
        const timer = setTimeout(() => resolve(answer), delayMs);
        signal.addEventListener(
          'abort',
          () => {
            clearTimeout(timer);
            reject(new CollectorAbortedError());
          },
          { once: true },
        );
      });
    },
  };
}
const healthy: CollectorResult = { result: 'success', measurements: { latencyMs: 4, loadPercent: 30 } };

describe('collector contract', () => {
  it('derives the target from inventory without leaking monitoring state', () => {
    expect(targetFor(device)).toEqual(target);
  });

  it('a compliant collector resolves when left alone and rejects with AbortError once cancelled', async () => {
    const collector = referenceCollector(healthy, 5);
    await expect(collector.check(target, new AbortController().signal)).resolves.toEqual(healthy);

    const controller = new AbortController();
    const pending = collector.check(target, controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError', message: 'Check was cancelled' });

    // An already-aborted signal is honoured before any work starts.
    await expect(collector.check(target, AbortSignal.abort())).rejects.toBeInstanceOf(CollectorAbortedError);
    // `AbortSignal.timeout` aborts with the platform's own AbortError, which counts as cancellation.
    await expect(referenceCollector(healthy, 1_000).check(target, AbortSignal.timeout(5))).rejects.toSatisfy(
      isAbortError,
    );
  });

  it('throwIfAborted is a no-op on a live signal', () => {
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow();
    expect(() => throwIfAborted(AbortSignal.abort())).toThrow(CollectorAbortedError);
  });

  it('recognises abort errors from any source by name', () => {
    expect(isAbortError(new CollectorAbortedError())).toBe(true);
    expect(isAbortError(new DOMException('aborted', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('AbortError'))).toBe(false);
    expect(isAbortError(null)).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
  });

  it('turns a rejected check into a timeout for cancellation and an error otherwise', () => {
    expect(failureFrom(new CollectorAbortedError())).toEqual({
      result: 'timeout',
      error: 'Check was cancelled',
    });
    expect(failureFrom(new Error('ECONNREFUSED 10.20.0.1:161'))).toEqual({
      result: 'error',
      error: 'ECONNREFUSED 10.20.0.1:161',
    });
    expect(failureFrom('socket hang up')).toEqual({ result: 'error', error: 'socket hang up' });
    expect(failureFrom(new Error('   '))).toEqual({ result: 'error', error: 'Unknown collector failure' });
    expect(failureFrom({ code: 42 })).toEqual({ result: 'error', error: 'Unknown collector failure' });
    expect(failureFrom(new Error('x'.repeat(900)))).toEqual({
      result: 'error',
      error: 'x'.repeat(maxErrorMessageLength),
    });
  });

  it('maps a successful result to an observation carrying every measurement', () => {
    expect(
      observationFrom(
        target,
        'simulator',
        { result: 'success', measurements: { latencyMs: 4.5, loadPercent: 30, uptimeSeconds: 120 } },
        at,
      ),
    ).toEqual({
      deviceId: 'RTR-001',
      organizationId: 'org-demo',
      source: 'simulator',
      collectedAt: '2026-10-13T08:00:00.000Z',
      result: 'success',
      latencyMs: 4.5,
      loadPercent: 30,
      uptimeSeconds: 120,
    });
    expect(
      observationFrom(target, 'simulator', { result: 'success', measurements: { latencyMs: 9 } }, at),
    ).toMatchObject({ latencyMs: 9, loadPercent: undefined, uptimeSeconds: undefined });
  });

  it('maps failures to observations with their error details', () => {
    expect(observationFrom(target, 'manual', { result: 'timeout' }, at)).toEqual({
      deviceId: 'RTR-001',
      organizationId: 'org-demo',
      source: 'manual',
      collectedAt: '2026-10-13T08:00:00.000Z',
      result: 'timeout',
      errorMessage: undefined,
    });
    expect(
      observationFrom(target, 'manual', { result: 'error', error: 'SNMP authentication failed' }, at),
    ).toMatchObject({ result: 'error', errorMessage: 'SNMP authentication failed' });
    expect(
      observationFrom(target, 'manual', { result: 'error', error: 'y'.repeat(900) }, at).errorMessage,
    ).toHaveLength(maxErrorMessageLength);
  });
});

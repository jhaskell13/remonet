import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { coalesce, subscribeToMonitoring, type LiveStatus } from '../../../src/lib/live-updates.ts';

/** A scriptable stand-in for the browser's EventSource (jsdom does not provide one). */
class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  static instances: FakeEventSource[] = [];
  readyState = FakeEventSource.CONNECTING;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  private readonly listeners = new Map<string, ((message: MessageEvent<string>) => void)[]>();
  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (message: MessageEvent<string>) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emit(type: string, data: string) {
    for (const listener of this.listeners.get(type) ?? []) listener({ data } as MessageEvent<string>);
  }
  open() {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.();
  }
  fail(terminal = false) {
    this.readyState = terminal ? FakeEventSource.CLOSED : FakeEventSource.CONNECTING;
    this.onerror?.();
  }
}
const EventSourceImpl = FakeEventSource as unknown as typeof EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
});

describe('subscribeToMonitoring', () => {
  it('opens the organization-scoped stream and forwards parsed events and connection state', () => {
    const events: unknown[] = [];
    const statuses: LiveStatus[] = [];
    const subscription = subscribeToMonitoring(
      { organizationId: 'org demo' },
      { onEvent: (event) => events.push(event), onStatus: (status) => statuses.push(status) },
      EventSourceImpl,
    );
    const source = FakeEventSource.instances[0]!;
    expect(source.url).toBe('/api/monitoring/events?organizationId=org%20demo');
    expect(statuses).toEqual(['connecting']);
    source.open();
    source.emit('observation', JSON.stringify({ type: 'observation', deviceId: 'RTR-001' }));
    source.emit('cycle', JSON.stringify({ type: 'cycle', networkId: 'net-core' }));
    source.emit('inventory', 'not json');
    source.emit('inventory', JSON.stringify({ type: 'inventory', entityType: 'device' }));
    source.fail();
    source.open();
    source.fail(true);
    expect(events).toEqual([
      { type: 'observation', deviceId: 'RTR-001' },
      { type: 'cycle', networkId: 'net-core' },
      { type: 'inventory', entityType: 'device' },
    ]);
    expect(statuses).toEqual(['connecting', 'live', 'reconnecting', 'live', 'unavailable']);
    subscription.close();
    expect(source.closed).toBe(true);
  });

  it('streams every organization when none is selected', () => {
    subscribeToMonitoring({}, { onEvent: () => {}, onStatus: () => {} }, EventSourceImpl);
    expect(FakeEventSource.instances[0]?.url).toBe('/api/monitoring/events');
  });

  it('reports the stream unavailable where EventSource does not exist', () => {
    const statuses: LiveStatus[] = [];
    const subscription = subscribeToMonitoring({}, { onEvent: () => {}, onStatus: (s) => statuses.push(s) });
    expect(statuses).toEqual(['unavailable']);
    expect(FakeEventSource.instances).toEqual([]);
    expect(() => subscription.close()).not.toThrow();
  });

  it('uses the browser EventSource by default when present', () => {
    vi.stubGlobal('EventSource', EventSourceImpl);
    try {
      subscribeToMonitoring({ organizationId: 'org-demo' }, { onEvent: () => {}, onStatus: () => {} });
      expect(FakeEventSource.instances).toHaveLength(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('coalesce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('collapses a burst into one refresh after the quiet period and can be cancelled', () => {
    const refresh = vi.fn();
    const trigger = coalesce(refresh, 100);
    trigger();
    vi.advanceTimersByTime(60);
    trigger();
    vi.advanceTimersByTime(60);
    expect(refresh).not.toHaveBeenCalled();
    vi.advanceTimersByTime(40);
    expect(refresh).toHaveBeenCalledTimes(1);
    trigger();
    trigger.cancel();
    trigger.cancel();
    vi.advanceTimersByTime(200);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

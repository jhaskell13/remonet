import type { MonitoringEvent } from '../../shared/network.ts';

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'unavailable';

export type LiveSubscription = { close: () => void };

/**
 * Subscribes to the monitoring event stream. The browser's `EventSource` reconnects on its own;
 * `onStatus` reports the connection state for the UI. Where `EventSource` does not exist the
 * subscription is reported unavailable and the dashboard falls back to manual refreshes.
 */
export function subscribeToMonitoring(
  filters: { organizationId?: string },
  handlers: { onEvent: (event: MonitoringEvent) => void; onStatus: (status: LiveStatus) => void },
  EventSourceImpl: typeof EventSource | undefined = typeof EventSource === 'undefined'
    ? undefined
    : EventSource,
): LiveSubscription {
  if (!EventSourceImpl) {
    handlers.onStatus('unavailable');
    return { close: () => {} };
  }
  const query = filters.organizationId ? `?organizationId=${encodeURIComponent(filters.organizationId)}` : '';
  const source = new EventSourceImpl(`/api/monitoring/events${query}`);
  handlers.onStatus('connecting');
  source.onopen = () => handlers.onStatus('live');
  source.onerror = () =>
    handlers.onStatus(source.readyState === EventSourceImpl.CLOSED ? 'unavailable' : 'reconnecting');
  const forward = (message: MessageEvent<string>) => {
    try {
      handlers.onEvent(JSON.parse(message.data) as MonitoringEvent);
    } catch {
      /* A malformed frame is dropped; the next one is independent of it. */
    }
  };
  for (const type of ['observation', 'inventory', 'cycle']) source.addEventListener(type, forward);
  return { close: () => source.close() };
}

/** Collapses bursts of events (a cycle records one per device) into a single refresh. */
export function coalesce(refresh: () => void, delayMs = 150) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      refresh();
    }, delayMs);
  };
  trigger.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  return trigger;
}

/** How long "Check now" keeps looking for its result (attempts × interval) before giving up. */
export const checkFollowUp = { intervalMs: 500, attempts: 20 };

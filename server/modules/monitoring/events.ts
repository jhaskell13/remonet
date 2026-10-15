import { EventEmitter } from 'node:events';
import type { MonitoringEvent } from '../../../shared/network.ts';

/**
 * In-process notifications about monitoring and inventory changes. The SSE route forwards them to
 * dashboards so engineers see a check land the moment it is recorded; nothing here is persisted.
 */
export type { MonitoringEvent };

type Listener = (event: MonitoringEvent) => void;

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

export function publishMonitoringEvent(event: MonitoringEvent) {
  emitter.emit('event', event);
}

/** Subscribes to every event; returns the function that unsubscribes. */
export function subscribeToMonitoringEvents(listener: Listener) {
  emitter.on('event', listener);
  return () => {
    emitter.off('event', listener);
  };
}

export function monitoringListenerCount() {
  return emitter.listenerCount('event');
}

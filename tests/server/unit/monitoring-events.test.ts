import { describe, expect, it } from 'vitest';
import type { Principal } from '../../../server/auth.ts';
import {
  monitoringListenerCount,
  publishMonitoringEvent,
  subscribeToMonitoringEvents,
  type MonitoringEvent,
} from '../../../server/modules/monitoring/events.ts';
import { recordObservation } from '../../../server/modules/monitoring/monitoring.service.ts';
import { eventVisibleTo, formatEvent } from '../../../server/modules/monitoring/stream.service.ts';
import { useSeededDatabase } from '../helpers/database.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;
const cycle: MonitoringEvent = {
  type: 'cycle',
  organizationId: demo.organizationId,
  networkId: demo.coreNetworkId,
  devices: 3,
  success: 2,
  timeout: 1,
  error: 0,
  completedAt: '2026-10-13T08:00:00.000Z',
};

function collect() {
  const events: MonitoringEvent[] = [];
  const unsubscribe = subscribeToMonitoringEvents((event) => events.push(event));
  return { events, unsubscribe };
}

describe('monitoring events', () => {
  useSeededDatabase();

  it('delivers published events to every subscriber until they unsubscribe', () => {
    const first = collect();
    const second = collect();
    expect(monitoringListenerCount()).toBe(2);
    publishMonitoringEvent(cycle);
    first.unsubscribe();
    publishMonitoringEvent({ ...cycle, success: 3 });
    second.unsubscribe();
    expect(first.events).toEqual([cycle]);
    expect(second.events).toEqual([cycle, { ...cycle, success: 3 }]);
    expect(monitoringListenerCount()).toBe(0);
  });

  it('announces a recorded observation with the refreshed device, after the write', () => {
    const { events, unsubscribe } = collect();
    try {
      const { device, observation } = recordObservation({
        deviceId: demo.coreRouterId,
        organizationId: demo.organizationId,
        source: 'manual',
        result: 'success',
        latencyMs: 3,
      });
      expect(events).toEqual([
        {
          type: 'observation',
          organizationId: demo.organizationId,
          networkId: demo.coreNetworkId,
          deviceId: demo.coreRouterId,
          device,
          observation,
        },
      ]);
      expect(() =>
        recordObservation({
          deviceId: 'dev-missing',
          organizationId: demo.organizationId,
          source: 'manual',
          result: 'timeout',
        }),
      ).toThrow('Device not found');
      expect(events).toHaveLength(1);
    } finally {
      unsubscribe();
    }
  });

  it('shows an event only to members of its organization, narrowed by an optional filter', () => {
    const principal: Principal = {
      id: users.multiOrg.id,
      email: users.multiOrg.email,
      displayName: 'Consultant',
      organizations: [
        { id: demo.organizationId, name: 'Northstar', role: 'admin' },
        { id: acme.organizationId, name: 'Acme', role: 'operator' },
      ],
    };
    const acmeCycle = { ...cycle, organizationId: acme.organizationId, networkId: acme.networkId };
    expect(eventVisibleTo(principal, cycle)).toBe(true);
    expect(eventVisibleTo(principal, acmeCycle)).toBe(true);
    expect(eventVisibleTo(principal, { ...cycle, organizationId: 'org-solo' })).toBe(false);
    expect(eventVisibleTo(principal, cycle, demo.organizationId)).toBe(true);
    expect(eventVisibleTo(principal, acmeCycle, demo.organizationId)).toBe(false);
  });

  it('serialises events in the server-sent event format', () => {
    expect(formatEvent(cycle, 7)).toBe(`id: 7\nevent: cycle\ndata: ${JSON.stringify(cycle)}\n\n`);
  });
});

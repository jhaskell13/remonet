import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSession } from '../../../server/auth.ts';
import {
  monitoringListenerCount,
  publishMonitoringEvent,
} from '../../../server/modules/monitoring/events.ts';
import { recordObservation } from '../../../server/modules/monitoring/monitoring.service.ts';
import { heartbeatIntervalMs } from '../../../server/modules/monitoring/stream.service.ts';
import { expectError, useTestApp } from '../helpers/app.ts';
import { fixtures, users } from '../helpers/fixtures.ts';

const { demo, acme } = fixtures;

/**
 * Server-sent events never end, so `app.inject()` cannot read them; these tests talk to the real
 * listening socket and read the stream incrementally.
 */
describe('GET /api/monitoring/events', () => {
  const api = useTestApp();
  let baseUrl = '';
  beforeAll(async () => {
    baseUrl = await api.app.listen({ host: '127.0.0.1', port: 0 });
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  type Stream = { next: () => Promise<string>; close: () => void; status: number; headers: Headers };
  async function open(userId: string, query = ''): Promise<Stream> {
    const controller = new AbortController();
    const response = await fetch(`${baseUrl}/api/monitoring/events${query}`, {
      headers: { cookie: `remonet_session=${createSession(userId).token}` },
      signal: controller.signal,
    });
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    return {
      status: response.status,
      headers: response.headers,
      next: async () => {
        const { value, done } = await reader.read();
        return done ? '' : decoder.decode(value);
      },
      close: () => controller.abort(),
    };
  }
  const parse = (chunk: string) => {
    const data = chunk.split('\n').find((line) => line.startsWith('data: '));
    return data ? (JSON.parse(data.slice(6)) as Record<string, unknown>) : undefined;
  };

  it('streams observations for the caller’s organizations as they are recorded', async () => {
    const stream = await open(users.nsViewer.id);
    expect(stream.status).toBe(200);
    expect(stream.headers.get('content-type')).toBe('text/event-stream');
    expect(stream.headers.get('cache-control')).toBe('no-store');
    expect(await stream.next()).toMatch(/^: connected /);
    expect(monitoringListenerCount()).toBe(1);

    const { observation } = recordObservation({
      deviceId: demo.coreRouterId,
      organizationId: demo.organizationId,
      source: 'manual',
      result: 'success',
      latencyMs: 7,
    });
    const chunk = await stream.next();
    expect(chunk).toMatch(/^id: 1\nevent: observation\n/);
    expect(parse(chunk)).toMatchObject({
      type: 'observation',
      deviceId: demo.coreRouterId,
      device: { id: demo.coreRouterId, status: 'Healthy', latency: 7 },
      observation: { id: observation.id, source: 'manual' },
    });

    // An event in an organization the viewer does not belong to is not delivered; the next visible
    // one carries the next id.
    recordObservation({
      deviceId: acme.routerId,
      organizationId: acme.organizationId,
      source: 'manual',
      result: 'timeout',
    });
    publishMonitoringEvent({
      type: 'cycle',
      organizationId: demo.organizationId,
      networkId: demo.coreNetworkId,
      devices: 1,
      success: 1,
      timeout: 0,
      error: 0,
      completedAt: '2026-10-13T08:00:00.000Z',
    });
    const cycle = await stream.next();
    expect(cycle).toMatch(/^id: 2\nevent: cycle\n/);
    expect(parse(cycle)).toMatchObject({ type: 'cycle', networkId: demo.coreNetworkId });

    stream.close();
    await vi.waitFor(() => expect(monitoringListenerCount()).toBe(0));
  });

  it('narrows to one organization on request and refuses organizations the caller is not in', async () => {
    const stream = await open(users.multiOrg.id, `?organizationId=${acme.organizationId}`);
    await stream.next();
    recordObservation({
      deviceId: demo.coreRouterId,
      organizationId: demo.organizationId,
      source: 'manual',
      result: 'success',
      latencyMs: 1,
    });
    recordObservation({
      deviceId: acme.routerId,
      organizationId: acme.organizationId,
      source: 'manual',
      result: 'success',
      latencyMs: 2,
    });
    expect(parse(await stream.next())).toMatchObject({ type: 'observation', deviceId: acme.routerId });
    stream.close();
    await vi.waitFor(() => expect(monitoringListenerCount()).toBe(0));

    expectError(
      await api
        .as(users.nsViewer)
        .get('/api/monitoring/events', { query: { organizationId: acme.organizationId } }),
      403,
      'Organization access denied',
    );
    expect((await api.anonymous.get('/api/monitoring/events')).status).toBe(401);
  });

  it('keeps the connection alive with periodic heartbeats', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const stream = await open(users.nsViewer.id);
    await stream.next();
    vi.advanceTimersByTime(heartbeatIntervalMs);
    expect(await stream.next()).toBe(': heartbeat\n\n');
    stream.close();
    await vi.waitFor(() => expect(monitoringListenerCount()).toBe(0));
    expect(vi.getTimerCount()).toBe(0);
  });
});

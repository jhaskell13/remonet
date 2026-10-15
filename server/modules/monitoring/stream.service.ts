import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Principal } from '../../auth.ts';
import { AppError } from '../../http/app-error.ts';
import { subscribeToMonitoringEvents, type MonitoringEvent } from './events.ts';

export const heartbeatIntervalMs = 15_000;

/** Whether a principal may see an event: it must concern an organization they belong to. */
export function eventVisibleTo(principal: Principal, event: MonitoringEvent, organizationId?: string) {
  if (organizationId && event.organizationId !== organizationId) return false;
  return principal.organizations.some((organization) => organization.id === event.organizationId);
}

/** Serialises one server-sent event. */
export function formatEvent(event: MonitoringEvent, id: number) {
  return `id: ${id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Streams monitoring events to a dashboard as server-sent events. The connection stays open until
 * the client leaves; a comment line every `heartbeatIntervalMs` keeps proxies from closing it.
 */
export function streamMonitoringEvents(
  request: FastifyRequest<{ Querystring: { organizationId?: string } }>,
  reply: FastifyReply,
) {
  const principal = request.principal!;
  const { organizationId } = request.query;
  if (organizationId && !principal.organizations.some((organization) => organization.id === organizationId))
    throw new AppError(403, 'Organization access denied');

  reply.hijack();
  const socket = reply.raw;
  socket.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-store',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  socket.write(`: connected ${new Date().toISOString()}\n\n`);

  let nextId = 1;
  const unsubscribe = subscribeToMonitoringEvents((event) => {
    if (!eventVisibleTo(principal, event, organizationId)) return;
    socket.write(formatEvent(event, nextId));
    nextId += 1;
  });
  const heartbeat = setInterval(() => socket.write(': heartbeat\n\n'), heartbeatIntervalMs);
  const close = () => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  request.raw.once('close', close);
  request.log.info({ organizationId: organizationId ?? null }, 'Monitoring stream opened');
}

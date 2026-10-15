import type { FastifyReply, FastifyRequest } from 'fastify';
import { collectionStatusFor, requestCheckFor } from './collection.service.ts';
import { observationsFor, type ObservationQuery } from './monitoring.service.ts';
import { streamMonitoringEvents } from './stream.service.ts';

export type { ObservationQuery } from './monitoring.service.ts';
export type StatusQuery = { organizationId?: string };
export type StreamQuery = { organizationId?: string };

export function deviceObservations(
  request: FastifyRequest<{ Params: { deviceId: string }; Querystring: ObservationQuery }>,
) {
  return { data: observationsFor(request.principal!, request.params.deviceId, request.query) };
}

export function collectionStatus(request: FastifyRequest<{ Querystring: StatusQuery }>) {
  return { data: collectionStatusFor(request.principal!, request.query) };
}

export function requestDeviceCheckController(
  request: FastifyRequest<{ Params: { deviceId: string }; Body: { organizationId: string } }>,
  reply: FastifyReply,
) {
  reply.code(202);
  return { data: requestCheckFor(request.principal!, request.params.deviceId, request.body) };
}

export function monitoringStream(request: FastifyRequest<{ Querystring: StreamQuery }>, reply: FastifyReply) {
  streamMonitoringEvents(request, reply);
}

import type { FastifyInstance } from 'fastify';
import { requirePrincipal } from '../../http/access.ts';
import {
  collectionStatus,
  deviceObservations,
  monitoringStream,
  requestDeviceCheckController,
  type ObservationQuery,
  type StatusQuery,
  type StreamQuery,
} from './monitoring.controller.ts';
import { maxHistoryLimit } from './monitoring.service.ts';

const deviceParams = {
  type: 'object',
  required: ['deviceId'],
  additionalProperties: false,
  properties: { deviceId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const observationQuery = {
  type: 'object',
  required: ['organizationId'],
  additionalProperties: false,
  properties: {
    organizationId: { type: 'string', minLength: 1, maxLength: 120 },
    limit: { type: 'integer', minimum: 1, maximum: maxHistoryLimit },
  },
} as const;
const organizationQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { organizationId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;
const organizationBody = {
  type: 'object',
  required: ['organizationId'],
  additionalProperties: false,
  properties: { organizationId: { type: 'string', minLength: 1, maxLength: 120 } },
} as const;

export function registerMonitoringRoutes(app: FastifyInstance) {
  app.get<{ Params: { deviceId: string }; Querystring: ObservationQuery }>(
    '/api/devices/:deviceId/observations',
    { schema: { params: deviceParams, querystring: observationQuery }, preHandler: requirePrincipal },
    deviceObservations,
  );
  app.post<{ Params: { deviceId: string }; Body: { organizationId: string } }>(
    '/api/devices/:deviceId/check',
    { schema: { params: deviceParams, body: organizationBody }, preHandler: requirePrincipal },
    requestDeviceCheckController,
  );
  app.get<{ Querystring: StatusQuery }>(
    '/api/monitoring/status',
    { schema: { querystring: organizationQuery }, preHandler: requirePrincipal },
    collectionStatus,
  );
  app.get<{ Querystring: StreamQuery }>(
    '/api/monitoring/events',
    { schema: { querystring: organizationQuery }, preHandler: requirePrincipal },
    monitoringStream,
  );
}

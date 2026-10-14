import type { FastifyInstance } from 'fastify';
import { requireEngineer } from '../../http/access.ts';
import { auditEvents, type AuditQuery } from './audit.controller.ts';

const auditQuery = {
  type: 'object',
  additionalProperties: false,
  properties: {
    organizationId: { type: 'string', minLength: 1, maxLength: 120 },
    entityType: { type: 'string', enum: ['network', 'area', 'device', 'membership'] },
    entityId: { type: 'string', minLength: 1, maxLength: 120 },
    limit: { type: 'integer', minimum: 1, maximum: 500 },
  },
} as const;

export function registerAuditRoutes(app: FastifyInstance) {
  app.get<{ Querystring: AuditQuery }>(
    '/api/audit',
    { schema: { querystring: auditQuery }, preHandler: requireEngineer },
    auditEvents,
  );
}

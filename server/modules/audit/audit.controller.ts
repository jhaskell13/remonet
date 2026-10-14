import type { FastifyRequest } from 'fastify';
import { auditFor, type AuditQuery } from './audit.service.ts';

export type { AuditQuery } from './audit.service.ts';

export function auditEvents(request: FastifyRequest<{ Querystring: AuditQuery }>) {
  return { data: auditFor(request.principal!, request.query) };
}

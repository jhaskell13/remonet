import { randomUUID } from 'node:crypto';
import type { Principal } from '../../auth.ts';
import { AppError } from '../../http/app-error.ts';
import type { AuditAction, AuditEntityType } from '../../../shared/network.ts';
import { hasPermission } from '../../../shared/permissions.ts';
import { requirePermission } from '../../authorization.ts';
import { insertAuditEvent, listAuditEvents } from '../../store.ts';
import type { AuditEvent } from '../../store.ts';

export type AuditEntry = {
  organizationId: string;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  details?: Record<string, unknown>;
};
export type AuditActor = Pick<Principal, 'id' | 'email'>;
export type AuditQuery = {
  organizationId?: string;
  entityType?: AuditEntityType;
  entityId?: string;
  limit?: number;
};

const maxAuditLimit = 500;

/**
 * Records a security-sensitive change. Call this inside the same transaction as the change so the
 * trail and the data it describes are committed (or rolled back) together.
 */
export function recordAudit(actor: AuditActor, entry: AuditEntry): AuditEvent {
  const event: AuditEvent = {
    id: randomUUID(),
    organizationId: entry.organizationId,
    actorId: actor.id,
    actorEmail: actor.email,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    details: entry.details ?? {},
    createdAt: new Date().toISOString(),
  };
  insertAuditEvent(event);
  return event;
}

export function auditFor(principal: Principal, filters: AuditQuery): AuditEvent[] {
  if (principal.serviceToken) throw new AppError(403, 'Engineer account required to read the audit trail');
  const manageable = principal.organizations
    .filter((organization) => hasPermission(organization.role, 'audit.read'))
    .map((organization) => organization.id);
  if (filters.organizationId) requirePermission(principal, filters.organizationId, 'audit.read');
  const { organizationId, entityType, entityId, limit } = filters;
  return listAuditEvents({
    organizationIds: organizationId ? [organizationId] : manageable,
    ...(entityType ? { entityType } : {}),
    ...(entityId ? { entityId } : {}),
    limit: Math.min(limit ?? 100, maxAuditLimit),
  });
}

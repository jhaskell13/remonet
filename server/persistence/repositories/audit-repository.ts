import { db } from '../database.ts';
import type { AuditEvent } from '../types.ts';

type AuditRow = Omit<AuditEvent, 'details'> & { details: string };
type AuditScope = { organizationIds: string[]; entityType?: string; entityId?: string; limit?: number };

const columns =
  'id, organization_id AS organizationId, actor_id AS actorId, actor_email AS actorEmail, action, entity_type AS entityType, entity_id AS entityId, details, created_at AS createdAt';

function toEvent(row: AuditRow): AuditEvent {
  return { ...row, details: JSON.parse(row.details) as Record<string, unknown> };
}

export function insertAuditEvent(event: AuditEvent) {
  db.prepare(
    `INSERT INTO audit_log (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    event.id,
    event.organizationId,
    event.actorId,
    event.actorEmail,
    event.action,
    event.entityType,
    event.entityId,
    JSON.stringify(event.details),
    event.createdAt,
  );
}

export function listAuditEvents(scope: AuditScope): AuditEvent[] {
  if (scope.organizationIds.length === 0) return [];
  const clauses = [`organization_id IN (${scope.organizationIds.map(() => '?').join(', ')})`];
  const values: (string | number)[] = [...scope.organizationIds];
  if (scope.entityType) {
    clauses.push('entity_type = ?');
    values.push(scope.entityType);
  }
  if (scope.entityId) {
    clauses.push('entity_id = ?');
    values.push(scope.entityId);
  }
  values.push(scope.limit ?? 100);
  return (
    db
      .prepare(
        `SELECT ${columns} FROM audit_log WHERE ${clauses.join(' AND ')} ORDER BY created_at DESC, rowid DESC LIMIT ?`,
      )
      .all(...values) as unknown as AuditRow[]
  ).map(toEvent);
}

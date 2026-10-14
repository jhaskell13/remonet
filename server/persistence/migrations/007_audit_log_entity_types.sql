-- Widen the audit_log entity_type check to cover organization and team administration. SQLite
-- cannot alter a CHECK constraint in place, so the table is rebuilt; DROP TABLE does not fire the
-- append-only triggers, and every row is carried over unchanged.
CREATE TABLE audit_log_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('organization', 'team', 'network', 'area', 'device', 'membership')),
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL CHECK (json_valid(details)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
) STRICT;

INSERT INTO audit_log_new (id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at)
SELECT id, organization_id, actor_id, actor_email, action, entity_type, entity_id, details, created_at
FROM audit_log;

DROP TABLE audit_log;
ALTER TABLE audit_log_new RENAME TO audit_log;

CREATE INDEX audit_log_organization_created ON audit_log(organization_id, created_at);
CREATE INDEX audit_log_entity ON audit_log(organization_id, entity_type, entity_id);

CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries are immutable');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries are immutable');
END;

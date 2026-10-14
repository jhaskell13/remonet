CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('network', 'area', 'device', 'membership')),
  entity_id TEXT NOT NULL,
  details TEXT NOT NULL CHECK (json_valid(details)),
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id)
) STRICT;

CREATE INDEX audit_log_organization_created ON audit_log(organization_id, created_at);
CREATE INDEX audit_log_entity ON audit_log(organization_id, entity_type, entity_id);

-- The audit trail is append-only. Actor details are stored as a snapshot so history survives
-- account changes, and an organization with history cannot be removed without an explicit migration.
CREATE TRIGGER audit_log_no_update BEFORE UPDATE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries are immutable');
END;

CREATE TRIGGER audit_log_no_delete BEFORE DELETE ON audit_log
BEGIN
  SELECT RAISE(ABORT, 'audit_log entries are immutable');
END;

-- Monitoring history. Inventory (the devices table) describes what exists; observations describe
-- what a collector saw at one point in time. Rows are appended, never updated, and pruned per
-- device to a bounded count by the application. The composite foreign key keeps the denormalized
-- organization and network columns consistent with the device they describe.
CREATE UNIQUE INDEX devices_identity ON devices(id, organization_id, network_id);

CREATE TABLE device_observations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  network_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('simulator', 'manual')),
  result TEXT NOT NULL CHECK (result IN ('success', 'timeout', 'error')),
  latency_ms REAL CHECK (latency_ms IS NULL OR latency_ms >= 0),
  load_percent REAL CHECK (load_percent IS NULL OR (load_percent >= 0 AND load_percent <= 100)),
  uptime_seconds INTEGER CHECK (uptime_seconds IS NULL OR uptime_seconds >= 0),
  error_message TEXT,
  collected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id, organization_id, network_id) REFERENCES devices(id, organization_id, network_id) ON DELETE CASCADE
) STRICT;

CREATE INDEX device_observations_device_collected ON device_observations(device_id, collected_at);
CREATE INDEX device_observations_organization_collected ON device_observations(organization_id, collected_at);

CREATE TRIGGER device_observations_no_update BEFORE UPDATE ON device_observations
BEGIN
  SELECT RAISE(ABORT, 'device_observations entries are immutable');
END;

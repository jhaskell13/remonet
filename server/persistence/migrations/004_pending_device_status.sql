CREATE TABLE devices_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL,
  network_id TEXT NOT NULL,
  area_id TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Healthy', 'Warning', 'Offline')),
  uptime TEXT NOT NULL,
  latency REAL NOT NULL,
  load REAL NOT NULL,
  last_seen TEXT,
  FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
  FOREIGN KEY (network_id, organization_id) REFERENCES networks(id, organization_id) ON DELETE CASCADE,
  FOREIGN KEY (area_id, organization_id, network_id) REFERENCES areas(id, organization_id, network_id) ON DELETE CASCADE
) STRICT;

INSERT INTO devices_new (
  id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen
)
SELECT id, organization_id, network_id, area_id, name, type, address, status, uptime, latency, load, last_seen
FROM devices;

DROP TABLE devices;
ALTER TABLE devices_new RENAME TO devices;
CREATE INDEX devices_org_network_area ON devices(organization_id, network_id, area_id);

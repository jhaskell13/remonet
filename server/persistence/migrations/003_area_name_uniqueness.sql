CREATE UNIQUE INDEX areas_network_name ON areas(organization_id, network_id, name COLLATE NOCASE);

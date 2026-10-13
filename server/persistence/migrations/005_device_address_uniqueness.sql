CREATE UNIQUE INDEX devices_network_address ON devices(organization_id, network_id, address COLLATE NOCASE);

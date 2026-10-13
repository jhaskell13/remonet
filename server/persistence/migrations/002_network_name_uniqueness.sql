CREATE UNIQUE INDEX networks_organization_name ON networks(organization_id, name COLLATE NOCASE);

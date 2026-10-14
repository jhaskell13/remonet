CREATE UNIQUE INDEX teams_organization_name ON teams(organization_id, name COLLATE NOCASE);

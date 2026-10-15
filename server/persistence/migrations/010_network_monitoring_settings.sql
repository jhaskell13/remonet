-- Per-network collection controls. Monitoring can be paused for a network, and each network chooses
-- how often its devices are checked. Existing networks keep collecting at the default interval.
ALTER TABLE networks ADD COLUMN monitoring_enabled INTEGER NOT NULL DEFAULT 1 CHECK (monitoring_enabled IN (0, 1));
ALTER TABLE networks ADD COLUMN poll_interval_seconds INTEGER NOT NULL DEFAULT 60 CHECK (poll_interval_seconds BETWEEN 5 AND 3600);

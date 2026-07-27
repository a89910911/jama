CREATE TABLE IF NOT EXISTS startup_maintenance (
  job_key TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  completed_at TEXT NOT NULL,
  details TEXT
);

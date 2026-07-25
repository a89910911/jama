CREATE TABLE IF NOT EXISTS action_migration_jobs (
  id VARCHAR(64) PRIMARY KEY,
  drama_id INTEGER,
  title VARCHAR(255) NOT NULL DEFAULT '',
  mode VARCHAR(32) NOT NULL DEFAULT 'balanced',
  driving_video_path TEXT,
  driving_video_url TEXT,
  structure_video_path TEXT,
  reference_image_path TEXT,
  reference_image_url TEXT,
  prompt TEXT,
  negative_prompt TEXT,
  duration REAL,
  aspect_ratio VARCHAR(32),
  resolution VARCHAR(32) DEFAULT '480p',
  model VARCHAR(128),
  provider VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  preflight_report TEXT,
  settings TEXT,
  current_video_generation_id INTEGER,
  current_result_id INTEGER,
  task_id VARCHAR(128),
  error_code VARCHAR(64),
  error_msg TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  completed_at VARCHAR(32),
  deleted_at VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS action_migration_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id VARCHAR(64) NOT NULL,
  video_generation_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  mode VARCHAR(32) NOT NULL DEFAULT 'balanced',
  status VARCHAR(32) NOT NULL DEFAULT 'processing',
  video_url TEXT,
  local_path TEXT,
  is_current INTEGER NOT NULL DEFAULT 0,
  error_code VARCHAR(64),
  error_msg TEXT,
  quality_report TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  completed_at VARCHAR(32),
  deleted_at VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS action_migration_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id VARCHAR(64),
  event_type VARCHAR(64) NOT NULL DEFAULT '',
  message TEXT,
  payload TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT ''
);

ALTER TABLE video_generations ADD COLUMN action_migration_job_id VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_action_migration_jobs_updated
  ON action_migration_jobs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_migration_jobs_drama_updated
  ON action_migration_jobs (drama_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_action_migration_results_job_version
  ON action_migration_results (job_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_action_migration_results_video_gen
  ON action_migration_results (video_generation_id);

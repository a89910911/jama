ALTER TABLE image_generations ADD COLUMN provider_url TEXT;
ALTER TABLE image_generations ADD COLUMN prop_id INTEGER;
ALTER TABLE image_generations ADD COLUMN localize_status TEXT DEFAULT 'none';
ALTER TABLE image_generations ADD COLUMN localize_error TEXT;
ALTER TABLE image_generations ADD COLUMN localized_at TEXT;

ALTER TABLE video_generations ADD COLUMN provider_url TEXT;
ALTER TABLE video_generations ADD COLUMN localize_status TEXT DEFAULT 'none';
ALTER TABLE video_generations ADD COLUMN localize_error TEXT;
ALTER TABLE video_generations ADD COLUMN localized_at TEXT;

CREATE TABLE IF NOT EXISTS media_localization_jobs (
  id VARCHAR(64) PRIMARY KEY,
  media_type VARCHAR(16) NOT NULL,
  generation_type VARCHAR(32) NOT NULL,
  generation_id INTEGER NOT NULL,
  source_url TEXT NOT NULL,
  storage_category VARCHAR(64),
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  next_run_at VARCHAR(32),
  error_msg TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  completed_at VARCHAR(32),
  deleted_at VARCHAR(32)
);

CREATE INDEX IF NOT EXISTS idx_media_localization_jobs_status
  ON media_localization_jobs (status, next_run_at, updated_at);
CREATE INDEX IF NOT EXISTS idx_media_localization_jobs_generation
  ON media_localization_jobs (generation_type, generation_id);

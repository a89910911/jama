CREATE TABLE IF NOT EXISTS redraw_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER,
  episode_id INTEGER,
  title VARCHAR(255) NOT NULL DEFAULT '',
  overall_goal TEXT,
  aspect_ratio VARCHAR(32) DEFAULT '9:16',
  resolution VARCHAR(32) DEFAULT '480p',
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  settings TEXT,
  stats TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  deleted_at VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS redraw_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL,
  storyboard_id INTEGER,
  card_key VARCHAR(128) NOT NULL DEFAULT '',
  title TEXT,
  sort_order INTEGER DEFAULT 0,
  source_video_path TEXT,
  structure_video_path TEXT,
  structure_strength VARCHAR(32) DEFAULT 'balanced',
  prompt TEXT,
  negative_prompt TEXT,
  timeline TEXT,
  character_refs TEXT,
  scene_ref TEXT,
  prop_refs TEXT,
  asset_bindings TEXT,
  duration REAL,
  aspect_ratio VARCHAR(32),
  status VARCHAR(32) NOT NULL DEFAULT 'draft',
  current_video_generation_id INTEGER,
  current_result_id INTEGER,
  error_code VARCHAR(64),
  error_msg TEXT,
  preflight_report TEXT,
  quality_report TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  deleted_at VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS redraw_card_results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  card_id INTEGER NOT NULL,
  video_generation_id INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
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

CREATE TABLE IF NOT EXISTS redraw_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER,
  card_id INTEGER,
  event_type VARCHAR(64) NOT NULL DEFAULT '',
  message TEXT,
  payload TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT ''
);

ALTER TABLE video_generations ADD COLUMN source_video_url TEXT;
ALTER TABLE video_generations ADD COLUMN redraw_card_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_redraw_jobs_drama_updated
  ON redraw_jobs (drama_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_redraw_cards_job_order
  ON redraw_cards (job_id, sort_order, id);
CREATE INDEX IF NOT EXISTS idx_redraw_cards_status
  ON redraw_cards (status, updated_at);
CREATE INDEX IF NOT EXISTS idx_redraw_results_card_version
  ON redraw_card_results (card_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_redraw_results_video_gen
  ON redraw_card_results (video_generation_id);

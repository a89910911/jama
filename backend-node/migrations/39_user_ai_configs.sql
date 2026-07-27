CREATE TABLE IF NOT EXISTS user_ai_configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  service_type VARCHAR(64) NOT NULL DEFAULT 'text',
  name VARCHAR(255) NOT NULL DEFAULT '',
  priority INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  template_key VARCHAR(191),
  current_revision_id INTEGER,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  deleted_at VARCHAR(32)
);

CREATE TABLE IF NOT EXISTS user_ai_config_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  config_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  revision_no INTEGER NOT NULL DEFAULT 1,
  provider VARCHAR(128) NOT NULL DEFAULT '',
  api_protocol VARCHAR(128) NOT NULL DEFAULT '',
  base_url TEXT,
  api_key TEXT,
  credentials_json TEXT,
  model_json TEXT,
  default_model TEXT,
  endpoint TEXT,
  query_endpoint TEXT,
  settings_json TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS user_ai_config_defaults (
  user_id INTEGER NOT NULL,
  service_type VARCHAR(64) NOT NULL,
  config_id INTEGER NOT NULL,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, service_type)
);

CREATE TABLE IF NOT EXISTS user_ai_scene_model_maps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  scene_key VARCHAR(191) NOT NULL,
  service_type VARCHAR(64) NOT NULL DEFAULT 'text',
  config_id INTEGER,
  model_override TEXT,
  description TEXT,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_user_ai_configs_owner_type
ON user_ai_configs(user_id, service_type, is_active, priority);

CREATE INDEX IF NOT EXISTS idx_user_ai_configs_owner_deleted
ON user_ai_configs(user_id, deleted_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ai_config_revisions_number
ON user_ai_config_revisions(config_id, revision_no);

CREATE INDEX IF NOT EXISTS idx_user_ai_config_revisions_owner
ON user_ai_config_revisions(user_id, config_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_ai_scene_maps_owner_key
ON user_ai_scene_model_maps(user_id, scene_key);


CREATE TABLE IF NOT EXISTS character_looks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  character_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  category TEXT,
  appearance TEXT,
  polished_prompt TEXT,
  negative_prompt TEXT,
  image_url TEXT,
  local_path TEXT,
  ref_image TEXT,
  extra_images TEXT,
  four_view_image_url TEXT,
  reference_images TEXT,
  style_tokens TEXT,
  color_palette TEXT,
  seedance2_asset TEXT,
  error_msg TEXT,
  visual_revision INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  legacy_stage_key TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS scene_blocks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER NOT NULL,
  stable_key TEXT NOT NULL,
  title TEXT,
  location TEXT,
  time TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  signature TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS character_look_bindings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER,
  character_id INTEGER NOT NULL,
  look_id INTEGER NOT NULL,
  scope_type TEXT NOT NULL,
  scope_id INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  transition_note TEXT,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT '',
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS character_look_migration_warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  character_id INTEGER NOT NULL,
  warning_key TEXT NOT NULL,
  warning_type TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT ''
);

ALTER TABLE characters ADD COLUMN default_look_id INTEGER;
ALTER TABLE characters ADD COLUMN identity_appearance TEXT;

ALTER TABLE storyboards ADD COLUMN scene_block_id INTEGER;
ALTER TABLE storyboards ADD COLUMN current_video_generation_id INTEGER;
ALTER TABLE storyboards ADD COLUMN appearance_context_hash TEXT;
ALTER TABLE storyboards ADD COLUMN visual_context_stale INTEGER NOT NULL DEFAULT 0;

ALTER TABLE frame_prompts ADD COLUMN context_hash TEXT;
ALTER TABLE frame_prompts ADD COLUMN context_stale INTEGER NOT NULL DEFAULT 0;

ALTER TABLE image_generations ADD COLUMN character_look_id INTEGER;
ALTER TABLE image_generations ADD COLUMN character_look_revision INTEGER;
ALTER TABLE image_generations ADD COLUMN parent_generation_id INTEGER;
ALTER TABLE image_generations ADD COLUMN appearance_context_json TEXT;
ALTER TABLE image_generations ADD COLUMN appearance_context_hash TEXT;
ALTER TABLE image_generations ADD COLUMN generation_context_hash TEXT;
ALTER TABLE image_generations ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0;

ALTER TABLE video_generations ADD COLUMN appearance_context_json TEXT;
ALTER TABLE video_generations ADD COLUMN appearance_context_hash TEXT;
ALTER TABLE video_generations ADD COLUMN generation_context_hash TEXT;
ALTER TABLE video_generations ADD COLUMN superseded INTEGER NOT NULL DEFAULT 0;
ALTER TABLE video_generations ADD COLUMN voice_character_id INTEGER;

ALTER TABLE redraw_cards ADD COLUMN appearance_context_json TEXT;
ALTER TABLE redraw_cards ADD COLUMN appearance_context_hash TEXT;
ALTER TABLE redraw_cards ADD COLUMN context_stale INTEGER NOT NULL DEFAULT 0;

ALTER TABLE action_migration_jobs ADD COLUMN character_id INTEGER;
ALTER TABLE action_migration_jobs ADD COLUMN character_look_id INTEGER;
ALTER TABLE action_migration_jobs ADD COLUMN appearance_context_json TEXT;
ALTER TABLE action_migration_jobs ADD COLUMN appearance_context_hash TEXT;
ALTER TABLE action_migration_jobs ADD COLUMN context_stale INTEGER NOT NULL DEFAULT 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_character_looks_legacy_stage
  ON character_looks (character_id, legacy_stage_key);
CREATE INDEX IF NOT EXISTS idx_character_looks_character_status
  ON character_looks (character_id, status, id);
CREATE INDEX IF NOT EXISTS idx_character_looks_drama
  ON character_looks (drama_id, character_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scene_blocks_episode_key
  ON scene_blocks (episode_id, stable_key);
CREATE INDEX IF NOT EXISTS idx_scene_blocks_episode_order
  ON scene_blocks (episode_id, sort_order, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_look_binding_scope
  ON character_look_bindings (scope_type, scope_id, character_id);
CREATE INDEX IF NOT EXISTS idx_character_look_binding_look
  ON character_look_bindings (look_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_character_look_binding_episode
  ON character_look_bindings (episode_id, character_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_character_look_warning_key
  ON character_look_migration_warnings (character_id, warning_key);
CREATE INDEX IF NOT EXISTS idx_image_generations_look
  ON image_generations (character_look_id, created_at);

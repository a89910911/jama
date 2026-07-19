CREATE TABLE IF NOT EXISTS prompt_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  message_role TEXT NOT NULL,
  service_type TEXT NOT NULL DEFAULT 'text',
  scene_key TEXT,
  variable_schema TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'normal',
  allow_project_override INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  source_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  drama_id INTEGER,
  locale TEXT NOT NULL DEFAULT 'zh',
  content TEXT NOT NULL,
  seed_content TEXT,
  seed_version INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (definition_id) REFERENCES prompt_definitions(id),
  FOREIGN KEY (drama_id) REFERENCES dramas(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_system
ON prompt_templates(definition_id, locale)
WHERE scope = 'system' AND deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_project
ON prompt_templates(definition_id, drama_id, locale)
WHERE scope = 'project' AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_prompt_templates_drama
ON prompt_templates(drama_id, definition_id, locale);

ALTER TABLE async_tasks ADD COLUMN prompt_snapshot TEXT;

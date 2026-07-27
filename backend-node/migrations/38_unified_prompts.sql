CREATE TABLE prompt_definitions_unified (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key VARCHAR(191) NOT NULL,
  drama_id INTEGER NOT NULL DEFAULT 0,
  name TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  subcategory TEXT NOT NULL DEFAULT '',
  detail_category TEXT NOT NULL DEFAULT '',
  workflow_stage TEXT NOT NULL DEFAULT '',
  workflow_order INTEGER NOT NULL DEFAULT 0,
  message_role TEXT NOT NULL DEFAULT 'user',
  content_type TEXT NOT NULL DEFAULT 'user_template',
  service_type TEXT NOT NULL DEFAULT 'text',
  scene_key TEXT,
  variable_schema TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'normal',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  source_ref TEXT NOT NULL DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (prompt_key, drama_id)
);

INSERT INTO prompt_definitions_unified (
  id,
  prompt_key,
  drama_id,
  name,
  description,
  category,
  subcategory,
  detail_category,
  workflow_stage,
  workflow_order,
  message_role,
  content_type,
  service_type,
  scene_key,
  variable_schema,
  risk_level,
  sort_order,
  is_active,
  source_ref,
  content,
  created_at,
  updated_at
)
SELECT
  d.id,
  d.prompt_key,
  0,
  d.name,
  d.description,
  d.category,
  d.subcategory,
  d.detail_category,
  d.workflow_stage,
  d.workflow_order,
  d.message_role,
  d.content_type,
  d.service_type,
  d.scene_key,
  d.variable_schema,
  d.risk_level,
  d.sort_order,
  d.is_active,
  d.source_ref,
  t.content,
  d.created_at,
  CASE
    WHEN t.updated_at > d.updated_at THEN t.updated_at
    ELSE d.updated_at
  END
FROM prompt_definitions d
JOIN prompt_templates t
  ON t.definition_id = d.id
 AND t.scope = 'system'
 AND t.locale = 'default'
 AND t.deleted_at IS NULL;

INSERT INTO prompt_definitions_unified (
  prompt_key,
  drama_id,
  name,
  description,
  category,
  subcategory,
  detail_category,
  workflow_stage,
  workflow_order,
  message_role,
  content_type,
  service_type,
  scene_key,
  variable_schema,
  risk_level,
  sort_order,
  is_active,
  source_ref,
  content,
  created_at,
  updated_at
)
SELECT
  d.prompt_key,
  t.drama_id,
  d.name,
  d.description,
  d.category,
  d.subcategory,
  d.detail_category,
  d.workflow_stage,
  d.workflow_order,
  d.message_role,
  d.content_type,
  d.service_type,
  d.scene_key,
  d.variable_schema,
  d.risk_level,
  d.sort_order,
  d.is_active,
  d.source_ref,
  t.content,
  t.created_at,
  t.updated_at
FROM prompt_definitions d
JOIN prompt_templates t
  ON t.definition_id = d.id
 AND t.scope = 'project'
 AND t.drama_id IS NOT NULL
 AND t.locale = 'default'
 AND t.deleted_at IS NULL;

DROP TABLE prompt_templates;
DROP TABLE prompt_overrides;
DROP TABLE prompt_definitions;
ALTER TABLE prompt_definitions_unified RENAME TO prompt_definitions;

CREATE INDEX idx_prompt_definitions_drama
ON prompt_definitions(drama_id, prompt_key);

-- 提示词取消语言维度：每个定义、每个作用域只保留一个 default 模板。
-- 兼容旧库时按 zh > universal > en 的顺序选取原内容，保留选中内容和版本，
-- 完成合并后物理删除全部旧语言行。

INSERT INTO prompt_templates
  (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
SELECT
  source.definition_id,
  'system',
  NULL,
  'default',
  source.content,
  source.seed_content,
  source.seed_version,
  source.version,
  source.created_at,
  source.updated_at
FROM prompt_templates AS source
WHERE source.scope = 'system'
  AND source.deleted_at IS NULL
  AND source.locale <> 'default'
  AND NOT EXISTS (
    SELECT 1
    FROM prompt_templates AS existing
    WHERE existing.definition_id = source.definition_id
      AND existing.scope = 'system'
      AND existing.locale = 'default'
      AND existing.deleted_at IS NULL
  )
  AND source.id = (
    SELECT candidate.id
    FROM prompt_templates AS candidate
    WHERE candidate.definition_id = source.definition_id
      AND candidate.scope = 'system'
      AND candidate.deleted_at IS NULL
      AND candidate.locale <> 'default'
    ORDER BY CASE candidate.locale
      WHEN 'zh' THEN 0
      WHEN 'universal' THEN 1
      WHEN 'en' THEN 2
      ELSE 3
    END, candidate.id
    LIMIT 1
  );

INSERT INTO prompt_templates
  (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
SELECT
  source.definition_id,
  'project',
  source.drama_id,
  'default',
  source.content,
  source.seed_content,
  source.seed_version,
  source.version,
  source.created_at,
  source.updated_at
FROM prompt_templates AS source
WHERE source.scope = 'project'
  AND source.drama_id IS NOT NULL
  AND source.deleted_at IS NULL
  AND source.locale <> 'default'
  AND NOT EXISTS (
    SELECT 1
    FROM prompt_templates AS existing
    WHERE existing.definition_id = source.definition_id
      AND existing.scope = 'project'
      AND existing.drama_id = source.drama_id
      AND existing.locale = 'default'
      AND existing.deleted_at IS NULL
  )
  AND source.id = (
    SELECT candidate.id
    FROM prompt_templates AS candidate
    WHERE candidate.definition_id = source.definition_id
      AND candidate.scope = 'project'
      AND candidate.drama_id = source.drama_id
      AND candidate.deleted_at IS NULL
      AND candidate.locale <> 'default'
    ORDER BY CASE candidate.locale
      WHEN 'zh' THEN 0
      WHEN 'universal' THEN 1
      WHEN 'en' THEN 2
      ELSE 3
    END, candidate.id
    LIMIT 1
  );

DELETE FROM prompt_templates
WHERE locale <> 'default';

const { buildCatalog } = require('./promptCatalog');

const LEGACY_KEY_MAP = {
  story_expansion_system: 'story.generation.system',
  storyboard_system: 'storyboard.generation.system',
  storyboard_user_suffix: 'storyboard.generation.requirements',
  character_extraction: 'character.extraction.system',
  scene_extraction: 'scene.extraction.system',
  prop_extraction: 'prop.extraction.system',
  first_frame_prompt: 'frame.first.system',
  key_frame_prompt: 'frame.key.system',
  last_frame_prompt: 'frame.last.system',
};

const LEGACY_OVERRIDE_MIGRATION_KEY = 'prompt_templates_legacy_overrides_v1';
const SCENE_MAP_MIGRATION_KEY = 'prompt_templates_scene_map_split_v1';
const VALID_LOCALES = new Set(['zh', 'en', 'universal']);
const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

function nowIso() {
  return new Date().toISOString();
}

function normalizeLocale(value) {
  const locale = String(value || 'zh').trim().toLowerCase();
  if (locale.startsWith('zh')) return 'zh';
  if (locale.startsWith('en')) return 'en';
  if (locale === 'universal') return 'universal';
  return 'zh';
}

function parseSchema(value) {
  if (!value) return { variables: [] };
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && Array.isArray(parsed.variables) ? parsed : { variables: [] };
  } catch (_) {
    return { variables: [] };
  }
}

function extractVariables(content) {
  return [...new Set([...String(content || '').matchAll(PLACEHOLDER_RE)].map((m) => m[1]))];
}

function validateTemplateContent(definition, content) {
  const text = String(content == null ? '' : content);
  const errors = [];
  if (!text.trim()) errors.push('提示词内容不能为空');
  const schema = parseSchema(definition.variable_schema);
  const allowed = new Set(schema.variables.map((v) => v.name));
  const required = schema.variables.filter((v) => v.required).map((v) => v.name);
  const used = extractVariables(text);
  for (const name of used) {
    if (!allowed.has(name)) errors.push(`未注册的模板变量: {{${name}}}`);
  }
  for (const name of required) {
    if (!used.includes(name)) errors.push(`缺少必填模板变量: {{${name}}}`);
  }
  const opens = (text.match(/\{\{/g) || []).length;
  const closes = (text.match(/\}\}/g) || []).length;
  if (opens !== closes) errors.push('模板变量括号不完整');
  return { ok: errors.length === 0, errors, used_variables: used };
}

function renderTemplate(definition, content, variables = {}, opts = {}) {
  const schema = parseSchema(definition.variable_schema);
  const allowed = new Set(schema.variables.map((v) => v.name));
  const missing = [];
  const rendered = String(content || '').replace(PLACEHOLDER_RE, (_, name) => {
    if (!allowed.has(name)) {
      throw Object.assign(new Error(`未注册的模板变量: {{${name}}}`), { code: 'PROMPT_VARIABLE_UNKNOWN' });
    }
    const value = variables[name];
    if (value == null || value === '') {
      const meta = schema.variables.find((v) => v.name === name);
      if (meta?.required) missing.push(name);
      return opts.keepMissing ? `{{${name}}}` : '';
    }
    return String(value);
  });
  if (missing.length && !opts.allowMissing) {
    throw Object.assign(new Error(`提示词缺少必填变量: ${missing.join(', ')}`), {
      code: 'PROMPT_VARIABLE_MISSING',
      missing,
    });
  }
  return rendered;
}

function getGlobalSetting(db, key) {
  try {
    return db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key)?.value || null;
  } catch (_) {
    return null;
  }
}

function setGlobalSetting(db, key, value) {
  const now = nowIso();
  db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, String(value), now);
}

function seedCatalog(db) {
  const catalog = buildCatalog();
  const now = nowIso();
  const insertDef = db.prepare(`
    INSERT INTO prompt_definitions
      (prompt_key, name, description, category, message_role, service_type, scene_key,
       variable_schema, risk_level, allow_project_override, sort_order, is_active,
       source_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(prompt_key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      message_role = excluded.message_role,
      service_type = excluded.service_type,
      scene_key = excluded.scene_key,
      variable_schema = excluded.variable_schema,
      risk_level = excluded.risk_level,
      allow_project_override = excluded.allow_project_override,
      sort_order = excluded.sort_order,
      source_ref = excluded.source_ref,
      updated_at = excluded.updated_at
  `);
  const getDef = db.prepare('SELECT id FROM prompt_definitions WHERE prompt_key = ?');
  const getSystem = db.prepare(
    `SELECT id, content, seed_content, seed_version, version FROM prompt_templates
     WHERE definition_id = ? AND scope = 'system' AND locale = ? AND deleted_at IS NULL`
  );
  const insertSystem = db.prepare(`
    INSERT INTO prompt_templates
      (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
    VALUES (?, 'system', NULL, ?, ?, ?, ?, 1, ?, ?)
  `);
  const updateSeed = db.prepare(
    `UPDATE prompt_templates SET seed_content = ?, seed_version = ?, updated_at = ?
     WHERE id = ?`
  );
  const updateUnmodifiedSeed = db.prepare(
    `UPDATE prompt_templates
     SET content = ?, seed_content = ?, seed_version = ?, version = ?, updated_at = ?
     WHERE id = ?`
  );
  const listSystemLocales = db.prepare(
    `SELECT id, locale, content, seed_content
     FROM prompt_templates
     WHERE definition_id = ? AND scope = 'system' AND deleted_at IS NULL`
  );
  const retireUnmodifiedLocale = db.prepare(
    'UPDATE prompt_templates SET deleted_at = ?, updated_at = ? WHERE id = ?'
  );

  const tx = db.transaction(() => {
    for (const item of catalog) {
      insertDef.run(
        item.prompt_key,
        item.name,
        item.description || '',
        item.category,
        item.message_role,
        item.service_type || 'text',
        item.scene_key || null,
        JSON.stringify(item.variable_schema || { variables: [] }),
        item.risk_level || 'normal',
        item.allow_project_override ? 1 : 0,
        item.sort_order || 0,
        item.source_ref || '',
        now,
        now
      );
      const definitionId = getDef.get(item.prompt_key).id;
      for (const seed of item.contents) {
        if (!VALID_LOCALES.has(seed.locale)) continue;
        const current = getSystem.get(definitionId, seed.locale);
        if (!current) {
          insertSystem.run(
            definitionId,
            seed.locale,
            seed.content,
            seed.content,
            seed.seed_version || 1,
            now,
            now
          );
        } else if (Number(current.seed_version || 0) < Number(seed.seed_version || 1)) {
          if (current.content === current.seed_content) {
            updateUnmodifiedSeed.run(
              seed.content,
              seed.content,
              seed.seed_version || 1,
              Number(current.version || 1) + 1,
              now,
              current.id
            );
          } else {
            updateSeed.run(seed.content, seed.seed_version || 1, now, current.id);
          }
        }
      }
      const supportedLocales = new Set(item.contents.map((seed) => seed.locale));
      for (const row of listSystemLocales.all(definitionId)) {
        if (supportedLocales.has(row.locale)) continue;
        if (row.content === row.seed_content) {
          retireUnmodifiedLocale.run(now, now, row.id);
        }
      }
    }
  });
  tx();
  return catalog.length;
}

function migrateLegacyOverrides(db) {
  if (getGlobalSetting(db, LEGACY_OVERRIDE_MIGRATION_KEY) === 'done') return 0;
  let rows = [];
  try {
    rows = db.prepare('SELECT key, content, updated_at FROM prompt_overrides').all();
  } catch (_) {
    setGlobalSetting(db, LEGACY_OVERRIDE_MIGRATION_KEY, 'done');
    return 0;
  }
  const getTarget = db.prepare(`
    SELECT t.id, t.version
    FROM prompt_templates t
    JOIN prompt_definitions d ON d.id = t.definition_id
    WHERE d.prompt_key = ? AND t.scope = 'system' AND t.locale = 'zh' AND t.deleted_at IS NULL
  `);
  const update = db.prepare(
    'UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?'
  );
  let count = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const newKey = LEGACY_KEY_MAP[row.key];
      if (!newKey || !String(row.content || '').trim()) continue;
      const target = getTarget.get(newKey);
      if (!target) continue;
      update.run(row.content, Number(target.version || 1) + 1, row.updated_at || nowIso(), target.id);
      count += 1;
    }
    setGlobalSetting(db, LEGACY_OVERRIDE_MIGRATION_KEY, 'done');
  });
  tx();
  return count;
}

function migrateSplitSceneMaps(db) {
  if (getGlobalSetting(db, SCENE_MAP_MIGRATION_KEY) === 'done') return 0;
  const source = db.prepare('SELECT * FROM ai_model_map WHERE key = ?').get('image_polish');
  const targetKeys = [
    'omni_segment_generation',
    'omni_segment_polish',
    'classic_video_prompt_polish',
    'continuity_snapshot',
  ];
  let count = 0;
  const tx = db.transaction(() => {
    if (source) {
      const exists = db.prepare('SELECT id FROM ai_model_map WHERE key = ?');
      const insert = db.prepare(`
        INSERT INTO ai_model_map
          (key, service_type, config_id, model_override, description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const key of targetKeys) {
        if (exists.get(key)) continue;
        insert.run(
          key,
          source.service_type || 'text',
          source.config_id || null,
          source.model_override || null,
          `由旧 image_polish 路由自动迁移：${key}`,
          nowIso(),
          nowIso()
        );
        count += 1;
      }
    }
    setGlobalSetting(db, SCENE_MAP_MIGRATION_KEY, 'done');
  });
  tx();
  return count;
}

function ensurePromptCatalog(db) {
  const seeded = seedCatalog(db);
  const legacyMigrated = migrateLegacyOverrides(db);
  const sceneMapsMigrated = migrateSplitSceneMaps(db);
  return { seeded, legacyMigrated, sceneMapsMigrated };
}

function getDefinition(db, promptKey) {
  return db.prepare('SELECT * FROM prompt_definitions WHERE prompt_key = ? AND is_active = 1').get(promptKey) || null;
}

function resolveDramaId(db, context = {}) {
  const direct = Number(context.dramaId ?? context.drama_id);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const lookups = [
    ['episodeId', 'episode_id', 'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'],
    [
      'storyboardId',
      'storyboard_id',
      `SELECT e.drama_id FROM storyboards s JOIN episodes e ON e.id = s.episode_id
       WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
    ],
    ['characterId', 'character_id', 'SELECT drama_id FROM characters WHERE id = ? AND deleted_at IS NULL'],
    ['sceneId', 'scene_id', 'SELECT drama_id FROM scenes WHERE id = ? AND deleted_at IS NULL'],
    ['propId', 'prop_id', 'SELECT drama_id FROM props WHERE id = ? AND deleted_at IS NULL'],
  ];
  for (const [camel, snake, sql] of lookups) {
    const id = Number(context[camel] ?? context[snake]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const row = db.prepare(sql).get(id);
    const dramaId = Number(row?.drama_id);
    if (Number.isInteger(dramaId) && dramaId > 0) return dramaId;
  }
  return null;
}

function commonVariables(cfg = {}) {
  const style = cfg.style || {};
  return {
    style_prompt: style.default_style || '',
    style_prompt_zh: style.default_style_zh || style.default_style || '',
    style_prompt_en: style.default_style_en || style.default_style || '',
    role_style: style.default_role_style || '',
    scene_style: style.default_scene_style || '',
    prop_style: style.default_prop_style || '',
    image_ratio: style.default_image_ratio || '16:9',
    video_ratio: style.default_video_ratio || '16:9',
  };
}

function resolvePromptContent(db, promptKey, opts = {}) {
  return resolvePrompt(db, promptKey, {
    ...opts,
    locale: opts.locale || opts.cfg?.app?.language || 'zh',
    variables: {
      ...commonVariables(opts.cfg),
      ...(opts.variables || {}),
    },
  }).content;
}

function selectEffectiveRow(db, definitionId, dramaId, locale) {
  if (dramaId) {
    const project = db.prepare(`
      SELECT * FROM prompt_templates
      WHERE definition_id = ? AND scope = 'project' AND drama_id = ? AND locale = ?
        AND deleted_at IS NULL
    `).get(definitionId, dramaId, locale);
    if (project) return project;
  }
  const system = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'system' AND locale = ? AND deleted_at IS NULL
  `).get(definitionId, locale);
  if (system) return system;
  if (locale !== 'universal') {
    return db.prepare(`
      SELECT * FROM prompt_templates
      WHERE definition_id = ? AND scope = 'system' AND locale = 'universal' AND deleted_at IS NULL
    `).get(definitionId) || null;
  }
  return null;
}

function attachTaskPromptSnapshot(db, taskId, snapshot) {
  if (!taskId) return;
  let current = [];
  try {
    const raw = db.prepare('SELECT prompt_snapshot FROM async_tasks WHERE id = ?').get(taskId)?.prompt_snapshot;
    if (raw) current = JSON.parse(raw);
    if (!Array.isArray(current)) current = [];
  } catch (_) {
    current = [];
  }
  const idx = current.findIndex((item) => item.prompt_key === snapshot.prompt_key);
  if (idx >= 0) current[idx] = snapshot;
  else current.push(snapshot);
  db.prepare('UPDATE async_tasks SET prompt_snapshot = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(current), nowIso(), taskId);
}

function resolvePrompt(db, promptKey, opts = {}) {
  const definition = getDefinition(db, promptKey);
  if (!definition) {
    throw Object.assign(new Error(`提示词定义不存在: ${promptKey}`), { code: 'PROMPT_DEFINITION_NOT_FOUND' });
  }
  const locale = normalizeLocale(opts.locale);
  const dramaId = resolveDramaId(db, opts);
  const row = selectEffectiveRow(db, definition.id, dramaId, locale);
  if (!row) {
    throw Object.assign(new Error(`提示词模板不存在: ${promptKey} (${locale})`), {
      code: 'PROMPT_TEMPLATE_NOT_FOUND',
    });
  }
  const content = opts.render === false
    ? row.content
    : renderTemplate(definition, row.content, opts.variables || {}, opts.renderOptions || {});
  const resolved = {
    prompt_key: promptKey,
    definition_id: definition.id,
    name: definition.name,
    message_role: definition.message_role,
    scene_key: definition.scene_key,
    locale: row.locale,
    requested_locale: locale,
    scope: row.scope,
    drama_id: dramaId,
    version: row.version,
    content,
    template_content: row.content,
  };
  if (opts.taskId) {
    attachTaskPromptSnapshot(db, opts.taskId, {
      prompt_key: promptKey,
      scope: row.scope,
      locale: row.locale,
      version: row.version,
      content,
      captured_at: nowIso(),
    });
  }
  return resolved;
}

function listPrompts(db, opts = {}) {
  const dramaId = resolveDramaId(db, opts);
  const definitions = db.prepare(
    'SELECT * FROM prompt_definitions WHERE is_active = 1 ORDER BY sort_order, prompt_key'
  ).all();
  const rows = db.prepare(
    `SELECT * FROM prompt_templates WHERE deleted_at IS NULL ORDER BY definition_id, locale`
  ).all();
  const byDefinition = new Map();
  for (const row of rows) {
    if (!byDefinition.has(row.definition_id)) byDefinition.set(row.definition_id, []);
    byDefinition.get(row.definition_id).push(row);
  }
  const items = [];
  for (const def of definitions) {
    const templates = byDefinition.get(def.id) || [];
    const systemRows = templates.filter((r) => r.scope === 'system');
    for (const system of systemRows) {
      const project = dramaId
        ? templates.find((r) => r.scope === 'project' && Number(r.drama_id) === dramaId && r.locale === system.locale)
        : null;
      items.push({
        ...def,
        variable_schema: parseSchema(def.variable_schema),
        locale: system.locale,
        system_content: system.content,
        seed_content: system.seed_content,
        system_version: system.version,
        seed_version: system.seed_version,
        project_content: project?.content ?? null,
        project_version: project?.version ?? null,
        effective_content: project?.content ?? system.content,
        effective_source: project ? 'project' : 'system',
        drama_id: dramaId,
      });
    }
  }
  return items;
}

function requireDefinitionAndLocale(db, promptKey, locale) {
  const definition = getDefinition(db, promptKey);
  if (!definition) throw Object.assign(new Error(`提示词定义不存在: ${promptKey}`), { code: 'NOT_FOUND' });
  const normalized = normalizeLocale(locale);
  if (!VALID_LOCALES.has(normalized)) throw new Error(`不支持的语言: ${locale}`);
  return { definition, locale: normalized };
}

function updateSystemPrompt(db, promptKey, locale, content, expectedVersion) {
  const target = requireDefinitionAndLocale(db, promptKey, locale);
  const validation = validateTemplateContent(target.definition, content);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join('；')), { code: 'PROMPT_VALIDATION_FAILED' });
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'system' AND locale = ? AND deleted_at IS NULL
  `).get(target.definition.id, target.locale);
  if (!row) throw Object.assign(new Error('系统提示词不存在'), { code: 'NOT_FOUND' });
  if (expectedVersion != null && Number(expectedVersion) !== Number(row.version)) {
    throw Object.assign(new Error('提示词已被其他操作修改，请刷新后重试'), { code: 'VERSION_CONFLICT' });
  }
  const version = Number(row.version || 1) + 1;
  db.prepare('UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?')
    .run(String(content).trim(), version, nowIso(), row.id);
  return { ...row, content: String(content).trim(), version };
}

function resetSystemPrompt(db, promptKey, locale, expectedVersion) {
  const target = requireDefinitionAndLocale(db, promptKey, locale);
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'system' AND locale = ? AND deleted_at IS NULL
  `).get(target.definition.id, target.locale);
  if (!row) throw Object.assign(new Error('系统提示词不存在'), { code: 'NOT_FOUND' });
  if (expectedVersion != null && Number(expectedVersion) !== Number(row.version)) {
    throw Object.assign(new Error('提示词已被其他操作修改，请刷新后重试'), { code: 'VERSION_CONFLICT' });
  }
  if (!row.seed_content) throw new Error('该提示词没有出厂默认内容');
  const version = Number(row.version || 1) + 1;
  db.prepare('UPDATE prompt_templates SET content = seed_content, version = ?, updated_at = ? WHERE id = ?')
    .run(version, nowIso(), row.id);
  return { ...row, content: row.seed_content, version };
}

function updateProjectPrompt(db, dramaIdValue, promptKey, locale, content, expectedVersion) {
  const dramaId = Number(dramaIdValue);
  if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('drama_id 无效');
  if (!db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)) {
    throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' });
  }
  const target = requireDefinitionAndLocale(db, promptKey, locale);
  if (!target.definition.allow_project_override) throw Object.assign(new Error('该提示词不允许项目覆盖'), { code: 'FORBIDDEN' });
  const validation = validateTemplateContent(target.definition, content);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join('；')), { code: 'PROMPT_VALIDATION_FAILED' });
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'project' AND drama_id = ? AND locale = ? AND deleted_at IS NULL
  `).get(target.definition.id, dramaId, target.locale);
  const now = nowIso();
  if (row) {
    if (expectedVersion != null && Number(expectedVersion) !== Number(row.version)) {
      throw Object.assign(new Error('项目提示词已被其他操作修改，请刷新后重试'), { code: 'VERSION_CONFLICT' });
    }
    const version = Number(row.version || 1) + 1;
    db.prepare('UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?')
      .run(String(content).trim(), version, now, row.id);
    return { ...row, content: String(content).trim(), version };
  }
  const result = db.prepare(`
    INSERT INTO prompt_templates
      (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
    VALUES (?, 'project', ?, ?, ?, NULL, 1, 1, ?, ?)
  `).run(target.definition.id, dramaId, target.locale, String(content).trim(), now, now);
  return db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(result.lastInsertRowid);
}

function deleteProjectPrompt(db, dramaIdValue, promptKey, locale, expectedVersion) {
  const dramaId = Number(dramaIdValue);
  const target = requireDefinitionAndLocale(db, promptKey, locale);
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'project' AND drama_id = ? AND locale = ? AND deleted_at IS NULL
  `).get(target.definition.id, dramaId, target.locale);
  if (!row) return false;
  if (expectedVersion != null && Number(expectedVersion) !== Number(row.version)) {
    throw Object.assign(new Error('项目提示词已被其他操作修改，请刷新后重试'), { code: 'VERSION_CONFLICT' });
  }
  db.prepare('UPDATE prompt_templates SET deleted_at = ?, updated_at = ? WHERE id = ?')
    .run(nowIso(), nowIso(), row.id);
  return true;
}

function previewPrompt(db, promptKey, opts = {}) {
  const resolved = resolvePrompt(db, promptKey, {
    ...opts,
    render: opts.content === undefined,
    variables: opts.variables || {},
    renderOptions: { allowMissing: true, keepMissing: true },
  });
  if (opts.content === undefined) return resolved;

  const definition = getDefinition(db, promptKey);
  const validation = validateTemplateContent(definition, opts.content);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors.join('；')), {
      code: 'PROMPT_VALIDATION_FAILED',
      validation,
    });
  }
  resolved.content = renderTemplate(definition, opts.content, opts.variables || {}, {
    allowMissing: true,
    keepMissing: true,
  });
  resolved.template_content = String(opts.content);
  resolved.preview_source = 'editor';
  return resolved;
}

module.exports = {
  LEGACY_KEY_MAP,
  normalizeLocale,
  parseSchema,
  extractVariables,
  validateTemplateContent,
  renderTemplate,
  ensurePromptCatalog,
  resolveDramaId,
  commonVariables,
  resolvePrompt,
  resolvePromptContent,
  listPrompts,
  updateSystemPrompt,
  resetSystemPrompt,
  updateProjectPrompt,
  deleteProjectPrompt,
  previewPrompt,
  attachTaskPromptSnapshot,
};

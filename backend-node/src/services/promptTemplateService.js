const { buildCatalog } = require('./promptCatalog');
const { insertIgnoreSql, upsertSql } = require('../db/portableSql');

const SYSTEM_DRAMA_ID = 0;
const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;

function nowIso() {
  return new Date().toISOString();
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
  return [...new Set([...String(content || '').matchAll(PLACEHOLDER_RE)].map((match) => match[1]))];
}

function validateTemplateContent(definition, content) {
  const text = String(content == null ? '' : content);
  const errors = [];
  if (!text.trim()) errors.push('提示词内容不能为空');
  const schema = parseSchema(definition?.variable_schema);
  const allowed = new Set(schema.variables.map((variable) => variable.name));
  const required = schema.variables.filter((variable) => variable.required).map((variable) => variable.name);
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
  const schema = parseSchema(definition?.variable_schema);
  const allowed = new Set(schema.variables.map((variable) => variable.name));
  const missing = [];
  const rendered = String(content || '').replace(PLACEHOLDER_RE, (_, name) => {
    if (!allowed.has(name)) {
      throw Object.assign(new Error(`未注册的模板变量: {{${name}}}`), {
        code: 'PROMPT_VARIABLE_UNKNOWN',
      });
    }
    const value = variables[name];
    if (value == null || value === '') {
      const meta = schema.variables.find((variable) => variable.name === name);
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

function catalogRow(item) {
  const seed = item.contents?.find((entry) => entry.locale === 'default') || item.contents?.[0];
  return {
    prompt_key: item.prompt_key,
    drama_id: SYSTEM_DRAMA_ID,
    name: item.name,
    description: item.description || '',
    category: item.category || '',
    subcategory: item.subcategory || '',
    detail_category: item.detail_category || '',
    workflow_stage: item.workflow_stage || '',
    workflow_order: item.workflow_order || 0,
    message_role: item.message_role || 'user',
    content_type: item.content_type || 'user_template',
    service_type: item.service_type || 'text',
    scene_key: item.scene_key || null,
    variable_schema: JSON.stringify(item.variable_schema || { variables: [] }),
    risk_level: item.risk_level || 'normal',
    sort_order: item.sort_order || 0,
    is_active: 1,
    source_ref: item.source_ref || '',
    content: seed?.content || '',
  };
}

/**
 * Install the current built-in system prompts during the one-time database migration.
 * Runtime startup must never call this function.
 */
function installPromptCatalog(db) {
  const now = nowIso();
  const sql = insertIgnoreSql(db, `
    INSERT INTO prompt_definitions (
      prompt_key, drama_id, name, description, category, subcategory,
      detail_category, workflow_stage, workflow_order, message_role,
      content_type, service_type, scene_key, variable_schema, risk_level,
      sort_order, is_active, source_ref, content, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `);
  const insert = db.prepare(sql);
  let inserted = 0;
  const tx = db.transaction(() => {
    for (const item of buildCatalog()) {
      const row = catalogRow(item);
      inserted += insert.run(
        row.prompt_key,
        row.drama_id,
        row.name,
        row.description,
        row.category,
        row.subcategory,
        row.detail_category,
        row.workflow_stage,
        row.workflow_order,
        row.message_role,
        row.content_type,
        row.service_type,
        row.scene_key,
        row.variable_schema,
        row.risk_level,
        row.sort_order,
        row.is_active,
        row.source_ref,
        row.content,
        now,
        now
      ).changes;
    }
  });
  tx();
  return { catalog_size: buildCatalog().length, inserted };
}

function resolveDramaId(db, context = {}) {
  const direct = Number(context.dramaId ?? context.drama_id);
  if (Number.isInteger(direct) && direct > 0) return direct;
  const lookups = [
    ['episodeId', 'episode_id', 'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'],
    [
      'storyboardId',
      'storyboard_id',
      `SELECT e.drama_id FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
       WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
    ],
    ['characterId', 'character_id', 'SELECT drama_id FROM characters WHERE id = ? AND deleted_at IS NULL'],
    ['sceneId', 'scene_id', 'SELECT drama_id FROM scenes WHERE id = ? AND deleted_at IS NULL'],
    ['propId', 'prop_id', 'SELECT drama_id FROM props WHERE id = ? AND deleted_at IS NULL'],
  ];
  for (const [camel, snake, sql] of lookups) {
    const id = Number(context[camel] ?? context[snake]);
    if (!Number.isInteger(id) || id <= 0) continue;
    const dramaId = Number(db.prepare(sql).get(id)?.drama_id);
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

function effectivePromptSql(keyCount = 1) {
  const placeholders = Array.from({ length: keyCount }, () => '?').join(', ');
  return `
    SELECT
      s.*,
      p.id AS project_prompt_id,
      p.content AS project_content,
      p.updated_at AS project_updated_at
    FROM prompt_definitions s
    LEFT JOIN prompt_definitions p
      ON p.prompt_key = s.prompt_key
     AND p.drama_id = ?
     AND p.is_active = 1
    WHERE s.drama_id = ${SYSTEM_DRAMA_ID}
      AND s.is_active = 1
      AND s.prompt_key IN (${placeholders})
  `;
}

function getEffectiveRows(db, promptKeys, dramaId) {
  const keys = [...new Set((promptKeys || []).map(String).filter(Boolean))];
  if (!keys.length) return [];
  return db.prepare(effectivePromptSql(keys.length)).all(dramaId || -1, ...keys);
}

function getSystemPrompt(db, promptKey) {
  return db.prepare(`
    SELECT *
    FROM prompt_definitions
    WHERE prompt_key = ? AND drama_id = ${SYSTEM_DRAMA_ID} AND is_active = 1
    LIMIT 1
  `).get(promptKey) || null;
}

function requireSystemPrompt(db, promptKey) {
  const row = getSystemPrompt(db, promptKey);
  if (!row) {
    throw Object.assign(new Error(`系统管线不存在: ${promptKey}`), {
      code: 'PROMPT_DEFINITION_NOT_FOUND',
    });
  }
  return row;
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
  const index = current.findIndex((item) => item.prompt_key === snapshot.prompt_key);
  if (index >= 0) current[index] = snapshot;
  else current.push(snapshot);
  db.prepare('UPDATE async_tasks SET prompt_snapshot = ?, updated_at = ? WHERE id = ?')
    .run(JSON.stringify(current), nowIso(), taskId);
}

function resolvedFromRow(row, dramaId, opts = {}) {
  const usesProject = row.project_prompt_id != null;
  const templateContent = usesProject ? row.project_content : row.content;
  const content = opts.render === false
    ? templateContent
    : renderTemplate(row, templateContent, opts.variables || {}, opts.renderOptions || {});
  return {
    prompt_key: row.prompt_key,
    prompt_id: usesProject ? row.project_prompt_id : row.id,
    definition_id: row.id,
    name: row.name,
    message_role: row.message_role,
    scene_key: row.scene_key,
    scope: usesProject ? 'project' : 'system',
    drama_id: dramaId,
    updated_at: usesProject ? row.project_updated_at : row.updated_at,
    content,
    template_content: templateContent,
  };
}

function resolvePrompt(db, promptKey, opts = {}) {
  const dramaId = resolveDramaId(db, opts);
  const row = getEffectiveRows(db, [promptKey], dramaId)[0];
  if (!row) {
    throw Object.assign(new Error(`系统管线不存在: ${promptKey}`), {
      code: 'PROMPT_DEFINITION_NOT_FOUND',
    });
  }
  const resolved = resolvedFromRow(row, dramaId, opts);
  if (opts.taskId) {
    attachTaskPromptSnapshot(db, opts.taskId, {
      prompt_key: promptKey,
      prompt_id: resolved.prompt_id,
      scope: resolved.scope,
      updated_at: resolved.updated_at,
      content: resolved.content,
      captured_at: nowIso(),
    });
  }
  return resolved;
}

function resolvePromptContent(db, promptKey, opts = {}) {
  return resolvePrompt(db, promptKey, {
    ...opts,
    variables: {
      ...commonVariables(opts.cfg),
      ...(opts.variables || {}),
    },
  }).content;
}

function resolvePrompts(db, promptKeys, opts = {}) {
  const dramaId = resolveDramaId(db, opts);
  const rows = getEffectiveRows(db, promptKeys, dramaId);
  const byKey = new Map(rows.map((row) => [row.prompt_key, row]));
  const resolved = new Map();
  for (const promptKey of [...new Set(promptKeys.map(String))]) {
    const row = byKey.get(promptKey);
    if (!row) {
      throw Object.assign(new Error(`系统管线不存在: ${promptKey}`), {
        code: 'PROMPT_DEFINITION_NOT_FOUND',
      });
    }
    const variables = {
      ...commonVariables(opts.cfg),
      ...(opts.variables || {}),
      ...(opts.variablesByKey?.[promptKey] || {}),
    };
    const item = resolvedFromRow(row, dramaId, { ...opts, variables });
    resolved.set(promptKey, item);
    if (opts.taskId) {
      attachTaskPromptSnapshot(db, opts.taskId, {
        prompt_key: promptKey,
        prompt_id: item.prompt_id,
        scope: item.scope,
        updated_at: item.updated_at,
        content: item.content,
        captured_at: nowIso(),
      });
    }
  }
  return resolved;
}

function presentationByKey() {
  return new Map(buildCatalog().map((item) => [
    item.prompt_key,
    {
      parent_prompt_key: item.parent_prompt_key || null,
      is_fragment: item.is_fragment ? 1 : 0,
      template_kind: item.template_kind || 'main',
      template_subtype: item.template_subtype || null,
      injection_channel: item.injection_channel || '',
      relation_note: item.relation_note || '',
      business_scene_label: item.business_scene_label || '',
      business_scene_order: item.business_scene_order || 0,
      business_component_order: item.business_component_order || 0,
      business_slot: item.business_slot || 'component',
      business_slot_label: item.business_slot_label || '模板组件',
    },
  ]));
}

function listPrompts(db, opts = {}) {
  const dramaId = resolveDramaId(db, opts);
  const rows = db.prepare(`
    SELECT
      s.*,
      p.id AS project_prompt_id,
      p.content AS project_content,
      p.updated_at AS project_updated_at
    FROM prompt_definitions s
    LEFT JOIN prompt_definitions p
      ON p.prompt_key = s.prompt_key
     AND p.drama_id = ?
     AND p.is_active = 1
    WHERE s.drama_id = ${SYSTEM_DRAMA_ID}
      AND s.is_active = 1
    ORDER BY s.sort_order, s.prompt_key
  `).all(dramaId || -1);
  const presentation = presentationByKey();
  return rows.map((row) => ({
    ...row,
    ...(presentation.get(row.prompt_key) || {}),
    variable_schema: parseSchema(row.variable_schema),
    system_content: row.content,
    system_updated_at: row.updated_at,
    project_content: row.project_prompt_id == null ? null : row.project_content,
    project_updated_at: row.project_prompt_id == null ? null : row.project_updated_at,
    effective_content: row.project_prompt_id == null ? row.content : row.project_content,
    effective_source: row.project_prompt_id == null ? 'system' : 'project',
    drama_id: dramaId,
  }));
}

function updateSystemPrompt(db, promptKey, content) {
  const system = requireSystemPrompt(db, promptKey);
  const validation = validateTemplateContent(system, content);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors.join('；')), {
      code: 'PROMPT_VALIDATION_FAILED',
      validation,
    });
  }
  const updatedAt = nowIso();
  db.prepare(`
    UPDATE prompt_definitions
    SET content = ?, updated_at = ?
    WHERE id = ? AND drama_id = ${SYSTEM_DRAMA_ID}
  `).run(String(content).trim(), updatedAt, system.id);
  return { ...system, content: String(content).trim(), updated_at: updatedAt };
}

function requireDrama(db, dramaIdValue) {
  const dramaId = Number(dramaIdValue);
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    throw Object.assign(new Error('drama_id 无效'), { code: 'NOT_FOUND' });
  }
  if (!db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)) {
    throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' });
  }
  return dramaId;
}

function updateProjectPrompt(db, dramaIdValue, promptKey, content) {
  const dramaId = requireDrama(db, dramaIdValue);
  const system = requireSystemPrompt(db, promptKey);
  const validation = validateTemplateContent(system, content);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors.join('；')), {
      code: 'PROMPT_VALIDATION_FAILED',
      validation,
    });
  }
  const updatedAt = nowIso();
  const createdAt = updatedAt;
  const sql = upsertSql(db, `
    INSERT INTO prompt_definitions (
      prompt_key, drama_id, name, description, category, subcategory,
      detail_category, workflow_stage, workflow_order, message_role,
      content_type, service_type, scene_key, variable_schema, risk_level,
      sort_order, is_active, source_ref, content, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `, ['prompt_key', 'drama_id'], ['content', 'updated_at', 'is_active']);
  db.prepare(sql).run(
    system.prompt_key,
    dramaId,
    system.name,
    system.description,
    system.category,
    system.subcategory,
    system.detail_category,
    system.workflow_stage,
    system.workflow_order,
    system.message_role,
    system.content_type,
    system.service_type,
    system.scene_key,
    system.variable_schema,
    system.risk_level,
    system.sort_order,
    1,
    system.source_ref,
    String(content).trim(),
    createdAt,
    updatedAt
  );
  return db.prepare(`
    SELECT * FROM prompt_definitions
    WHERE prompt_key = ? AND drama_id = ?
    LIMIT 1
  `).get(promptKey, dramaId);
}

function deleteProjectPrompt(db, dramaIdValue, promptKey) {
  const dramaId = requireDrama(db, dramaIdValue);
  return db.prepare(`
    DELETE FROM prompt_definitions
    WHERE prompt_key = ? AND drama_id = ?
  `).run(promptKey, dramaId).changes > 0;
}

function previewPrompt(db, promptKey, opts = {}) {
  const resolved = resolvePrompt(db, promptKey, {
    ...opts,
    render: opts.content === undefined,
    variables: opts.variables || {},
    renderOptions: { allowMissing: true, keepMissing: true },
  });
  if (opts.content === undefined) return resolved;
  const system = requireSystemPrompt(db, promptKey);
  const validation = validateTemplateContent(system, opts.content);
  if (!validation.ok) {
    throw Object.assign(new Error(validation.errors.join('；')), {
      code: 'PROMPT_VALIDATION_FAILED',
      validation,
    });
  }
  resolved.content = renderTemplate(system, opts.content, opts.variables || {}, {
    allowMissing: true,
    keepMissing: true,
  });
  resolved.template_content = String(opts.content);
  resolved.preview_source = 'editor';
  return resolved;
}

module.exports = {
  SYSTEM_DRAMA_ID,
  parseSchema,
  extractVariables,
  validateTemplateContent,
  renderTemplate,
  installPromptCatalog,
  resolveDramaId,
  commonVariables,
  resolvePrompt,
  resolvePromptContent,
  resolvePrompts,
  listPrompts,
  updateSystemPrompt,
  updateProjectPrompt,
  deleteProjectPrompt,
  previewPrompt,
  attachTaskPromptSnapshot,
};

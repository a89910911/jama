const { buildCatalog } = require('./promptCatalog');

const LEGACY_KEY_MAP = {
  story_expansion_system: 'story.generation.system',
  storyboard_system: 'storyboard.generation.system',
  character_extraction: 'character.extraction.system',
  scene_extraction: 'scene.extraction.system',
  prop_extraction: 'prop.extraction.system',
  first_frame_prompt: 'frame.first.system',
  key_frame_prompt: 'frame.key.system',
  last_frame_prompt: 'frame.last.system',
};
const LEGACY_APPEND_KEY_MAP = {
  storyboard_user_suffix: 'storyboard.generation.system',
};

const LEGACY_OVERRIDE_MIGRATION_KEY = 'prompt_templates_legacy_overrides_v1';
const SCENE_MAP_MIGRATION_KEY = 'prompt_templates_scene_map_split_v1';
const CANONICAL_LOCALE = 'default';
const PLACEHOLDER_RE = /\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}/g;
const MERGED_PROMPT_GROUPS = [
  {
    targetKey: 'frame.input.user',
    oldKeys: ['frame.first.user', 'frame.key.user', 'frame.last.user'],
  },
  {
    targetKey: 'scene.image.user',
    oldKeys: ['scene.image_four_view.user', 'scene.image_single.user'],
  },
];
const CONSOLIDATED_PROMPT_KEYS = {
  storyboard: {
    targetKey: 'storyboard.generation.system',
    absorbedKeys: [
      'storyboard.generation.requirements',
      'storyboard.generation.output_contract',
    ],
  },
  frameOutput: {
    targetKeys: ['frame.first.system', 'frame.key.system', 'frame.last.system'],
    absorbedKey: 'frame.output_contract',
  },
  characterImage: {
    targetKey: 'character.image_compose',
    absorbedKey: 'character.image_layout',
  },
  frameScale: {
    targetKeys: [
      'frame.first.realistic_scale_contract',
      'frame.last.realistic_scale_contract',
    ],
    absorbedKey: 'image.realistic_scale_contract',
  },
  sceneImage: {
    composeKeys: [
      'scene.image.compose',
      'scene.image_four_view.compose',
      'scene.image_single.compose',
    ],
    variants: [
      {
        targetKey: 'scene.image_four_view.final',
        layoutKey: 'scene.image_four_view.layout',
        preferredComposeKeys: ['scene.image_four_view.compose', 'scene.image.compose'],
      },
      {
        targetKey: 'scene.image_single.final',
        layoutKey: 'scene.image_single.layout',
        preferredComposeKeys: ['scene.image_single.compose', 'scene.image.compose'],
      },
    ],
  },
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeLocale() {
  return CANONICAL_LOCALE;
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
      (prompt_key, name, description, category, subcategory, detail_category,
       workflow_stage, workflow_order,
       message_role, content_type, service_type, scene_key,
       variable_schema, risk_level, allow_project_override, sort_order, is_active,
       source_ref, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(prompt_key) DO UPDATE SET
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      subcategory = excluded.subcategory,
      detail_category = excluded.detail_category,
      workflow_stage = excluded.workflow_stage,
      workflow_order = excluded.workflow_order,
      message_role = excluded.message_role,
      content_type = excluded.content_type,
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
        item.subcategory || '',
        item.detail_category || '',
        item.workflow_stage || '',
        item.workflow_order || 0,
        item.message_role,
        item.content_type || 'user_template',
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
        if (seed.locale !== CANONICAL_LOCALE) continue;
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
    SELECT t.id, t.content, t.version
    FROM prompt_templates t
    JOIN prompt_definitions d ON d.id = t.definition_id
    WHERE d.prompt_key = ? AND t.scope = 'system' AND t.locale = 'default' AND t.deleted_at IS NULL
  `);
  const update = db.prepare(
    'UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?'
  );
  let count = 0;
  const tx = db.transaction(() => {
    for (const row of rows) {
      const newKey = LEGACY_KEY_MAP[row.key] || LEGACY_APPEND_KEY_MAP[row.key];
      if (!newKey || !String(row.content || '').trim()) continue;
      const target = getTarget.get(newKey);
      if (!target) continue;
      const migratedContent = LEGACY_APPEND_KEY_MAP[row.key]
        ? (
            String(target.content || '').includes(String(row.content).trim())
              ? target.content
              : `${String(target.content || '').trimEnd()}\n\n${String(row.content).trim()}`
          )
        : row.content;
      update.run(
        migratedContent,
        Number(target.version || 1) + 1,
        row.updated_at || nowIso(),
        target.id
      );
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

function migrateMergedPromptTemplates(db) {
  const stats = {
    definitionsDeleted: 0,
    templatesDeleted: 0,
    systemCustomizationsMigrated: 0,
    projectOverridesMigrated: 0,
  };
  const now = nowIso();
  const tx = db.transaction(() => {
    for (const group of MERGED_PROMPT_GROUPS) {
      const targetDefinition = db.prepare(
        'SELECT * FROM prompt_definitions WHERE prompt_key = ?'
      ).get(group.targetKey);
      if (!targetDefinition) continue;

      const keyPlaceholders = group.oldKeys.map(() => '?').join(', ');
      const oldDefinitions = db.prepare(
        `SELECT * FROM prompt_definitions WHERE prompt_key IN (${keyPlaceholders})`
      ).all(...group.oldKeys);
      if (!oldDefinitions.length) continue;

      const priority = new Map(group.oldKeys.map((key, index) => [key, index]));
      const oldIds = oldDefinitions.map((item) => item.id);
      const idPlaceholders = oldIds.map(() => '?').join(', ');
      const oldRows = db.prepare(`
        SELECT t.*, d.prompt_key
        FROM prompt_templates t
        JOIN prompt_definitions d ON d.id = t.definition_id
        WHERE t.definition_id IN (${idPlaceholders})
      `).all(...oldIds);

      const targetSystem = db.prepare(`
        SELECT * FROM prompt_templates
        WHERE definition_id = ? AND scope = 'system' AND locale = 'default' AND deleted_at IS NULL
      `).get(targetDefinition.id);
      const customizedSystem = oldRows
        .filter((row) =>
          row.scope === 'system' &&
          row.locale === CANONICAL_LOCALE &&
          row.deleted_at == null &&
          row.seed_content != null &&
          row.content !== row.seed_content
        )
        .sort((a, b) => priority.get(a.prompt_key) - priority.get(b.prompt_key))
        .find((row) => validateTemplateContent(targetDefinition, row.content).ok);
      if (
        customizedSystem &&
        targetSystem &&
        targetSystem.content === targetSystem.seed_content
      ) {
        db.prepare(
          'UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?'
        ).run(
          customizedSystem.content,
          Math.max(Number(targetSystem.version || 1), Number(customizedSystem.version || 1)) + 1,
          now,
          targetSystem.id
        );
        stats.systemCustomizationsMigrated += 1;
      }

      const projectRows = oldRows
        .filter((row) =>
          row.scope === 'project' &&
          row.locale === CANONICAL_LOCALE &&
          row.deleted_at == null &&
          row.drama_id != null
        )
        .sort((a, b) =>
          Number(a.drama_id) - Number(b.drama_id) ||
          priority.get(a.prompt_key) - priority.get(b.prompt_key)
        );
      const chosenByDrama = new Map();
      for (const row of projectRows) {
        if (chosenByDrama.has(row.drama_id)) continue;
        if (!validateTemplateContent(targetDefinition, row.content).ok) continue;
        chosenByDrama.set(row.drama_id, row);
      }
      for (const [dramaId, row] of chosenByDrama) {
        const existing = db.prepare(`
          SELECT id FROM prompt_templates
          WHERE definition_id = ? AND scope = 'project' AND drama_id = ?
            AND locale = 'default' AND deleted_at IS NULL
        `).get(targetDefinition.id, dramaId);
        if (existing) continue;
        db.prepare(`
          INSERT INTO prompt_templates
            (definition_id, scope, drama_id, locale, content, seed_content,
             seed_version, version, created_at, updated_at)
          VALUES (?, 'project', ?, 'default', ?, NULL, 1, ?, ?, ?)
        `).run(
          targetDefinition.id,
          dramaId,
          row.content,
          Number(row.version || 1),
          row.created_at || now,
          row.updated_at || now
        );
        stats.projectOverridesMigrated += 1;
      }

      stats.templatesDeleted += db.prepare(
        `DELETE FROM prompt_templates WHERE definition_id IN (${idPlaceholders})`
      ).run(...oldIds).changes;
      stats.definitionsDeleted += db.prepare(
        `DELETE FROM prompt_definitions WHERE id IN (${idPlaceholders})`
      ).run(...oldIds).changes;
    }
  });
  tx();
  return stats;
}

function migrateConsolidatedPromptTemplates(db) {
  const stats = {
    definitionsDeleted: 0,
    templatesDeleted: 0,
    systemCustomizationsMigrated: 0,
    projectOverridesMigrated: 0,
  };
  const now = nowIso();
  const getDefinitionByKey = (key) =>
    db.prepare('SELECT * FROM prompt_definitions WHERE prompt_key = ?').get(key) || null;
  const getSystemRow = (definitionId) =>
    db.prepare(`
      SELECT * FROM prompt_templates
      WHERE definition_id = ? AND scope = 'system' AND locale = 'default'
        AND deleted_at IS NULL
    `).get(definitionId) || null;
  const getProjectRows = (definitionId) =>
    db.prepare(`
      SELECT * FROM prompt_templates
      WHERE definition_id = ? AND scope = 'project' AND drama_id IS NOT NULL
        AND locale = 'default' AND deleted_at IS NULL
      ORDER BY drama_id
    `).all(definitionId);
  const isCustomized = (row) =>
    !!row && row.seed_content != null && row.content !== row.seed_content;
  const joinSections = (...sections) =>
    sections.map((value) => String(value || '').trim()).filter(Boolean).join('\n\n');
  const stripTrailingSections = (content, sections) => {
    let result = String(content || '').trimEnd();
    for (const section of [...sections].reverse()) {
      const expected = String(section || '').trim();
      if (!expected || !result.endsWith(expected)) continue;
      result = result.slice(0, result.length - expected.length).trimEnd();
    }
    return result;
  };
  const inlineLayout = (content, defaultLayout, selectedLayout) => {
    const text = String(content || '');
    const replacement = String(selectedLayout || '').trim();
    const fallback = String(defaultLayout || '').trim();
    if (text.includes('{{layout_instruction}}')) {
      return text.split('{{layout_instruction}}').join(replacement);
    }
    if (fallback && text.includes(fallback)) {
      return text.split(fallback).join(replacement);
    }
    if (replacement && replacement !== fallback && !text.includes(replacement)) {
      return `${replacement}\n\n${text}`;
    }
    return text;
  };
  const validateOrThrow = (definition, content) => {
    const validation = validateTemplateContent(definition, content);
    if (!validation.ok) {
      throw new Error(
        `合并提示词 ${definition.prompt_key} 失败：${validation.errors.join('；')}`
      );
    }
  };
  const updateSystemContent = (definition, row, content) => {
    if (!row || row.content === content) return false;
    validateOrThrow(definition, content);
    db.prepare(
      'UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?'
    ).run(content, Number(row.version || 1) + 1, now, row.id);
    row.content = content;
    row.version = Number(row.version || 1) + 1;
    return true;
  };
  const upsertProjectContent = (definition, dramaId, existing, content) => {
    validateOrThrow(definition, content);
    if (existing) {
      if (existing.content === content) return false;
      db.prepare(
        'UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?'
      ).run(content, Number(existing.version || 1) + 1, now, existing.id);
      return true;
    }
    db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content,
         seed_version, version, created_at, updated_at)
      VALUES (?, 'project', ?, 'default', ?, NULL, 1, 1, ?, ?)
    `).run(definition.id, dramaId, content, now, now);
    return true;
  };
  const deleteDefinitions = (definitions) => {
    const unique = [...new Map(
      definitions.filter(Boolean).map((definition) => [definition.id, definition])
    ).values()];
    if (!unique.length) return;
    const ids = unique.map((definition) => definition.id);
    const placeholders = ids.map(() => '?').join(', ');
    stats.templatesDeleted += db.prepare(
      `DELETE FROM prompt_templates WHERE definition_id IN (${placeholders})`
    ).run(...ids).changes;
    stats.definitionsDeleted += db.prepare(
      `DELETE FROM prompt_definitions WHERE id IN (${placeholders})`
    ).run(...ids).changes;
  };
  const rowsByDrama = (rows) =>
    new Map(rows.map((row) => [Number(row.drama_id), row]));

  const tx = db.transaction(() => {
    const storyboardGroup = CONSOLIDATED_PROMPT_KEYS.storyboard;
    const storyboardTarget = getDefinitionByKey(storyboardGroup.targetKey);
    const storyboardOldDefinitions = storyboardGroup.absorbedKeys
      .map(getDefinitionByKey)
      .filter(Boolean);
    if (storyboardTarget && storyboardOldDefinitions.length) {
      const targetSystem = getSystemRow(storyboardTarget.id);
      const oldSystemRows = storyboardOldDefinitions.map((definition) => ({
        definition,
        row: getSystemRow(definition.id),
      }));
      const oldSeeds = oldSystemRows.map(({ row }) => row?.seed_content || row?.content || '');
      const baseSystem = stripTrailingSections(targetSystem?.content, oldSeeds);
      const mergedSystem = joinSections(
        baseSystem,
        ...oldSystemRows.map(({ row }) => row?.content || '')
      );
      const hadSystemCustomization =
        isCustomized(targetSystem) || oldSystemRows.some(({ row }) => isCustomized(row));
      if (
        hadSystemCustomization &&
        updateSystemContent(storyboardTarget, targetSystem, mergedSystem)
      ) {
        stats.systemCustomizationsMigrated += 1;
      }

      const targetProjects = rowsByDrama(getProjectRows(storyboardTarget.id));
      const oldProjects = oldSystemRows.map(({ definition }) =>
        rowsByDrama(getProjectRows(definition.id))
      );
      const dramaIds = new Set(targetProjects.keys());
      for (const map of oldProjects) {
        for (const dramaId of map.keys()) dramaIds.add(dramaId);
      }
      const baseSeed = stripTrailingSections(targetSystem?.seed_content, oldSeeds);
      for (const dramaId of dramaIds) {
        const existing = targetProjects.get(dramaId) || null;
        const baseContent = existing
          ? stripTrailingSections(existing.content, oldSeeds)
          : baseSeed;
        const content = joinSections(
          baseContent,
          ...oldSystemRows.map(({ row }, index) =>
            oldProjects[index].get(dramaId)?.content || row?.content || ''
          )
        );
        if (upsertProjectContent(storyboardTarget, dramaId, existing, content)) {
          stats.projectOverridesMigrated += 1;
        }
      }
      deleteDefinitions(storyboardOldDefinitions);
    }

    const frameGroup = CONSOLIDATED_PROMPT_KEYS.frameOutput;
    const frameOutputDefinition = getDefinitionByKey(frameGroup.absorbedKey);
    if (frameOutputDefinition) {
      const outputSystem = getSystemRow(frameOutputDefinition.id);
      const outputProjects = rowsByDrama(getProjectRows(frameOutputDefinition.id));
      for (const targetKey of frameGroup.targetKeys) {
        const targetDefinition = getDefinitionByKey(targetKey);
        if (!targetDefinition) continue;
        const targetSystem = getSystemRow(targetDefinition.id);
        if (isCustomized(outputSystem) && !targetSystem.content.includes(outputSystem.content)) {
          if (
            updateSystemContent(
              targetDefinition,
              targetSystem,
              joinSections(targetSystem.content, outputSystem.content)
            )
          ) {
            stats.systemCustomizationsMigrated += 1;
          }
        }
        const targetProjects = rowsByDrama(getProjectRows(targetDefinition.id));
        const dramaIds = new Set([
          ...targetProjects.keys(),
          ...outputProjects.keys(),
        ]);
        for (const dramaId of dramaIds) {
          const existing = targetProjects.get(dramaId) || null;
          const outputOverride = outputProjects.get(dramaId);
          if (!outputOverride && !isCustomized(outputSystem)) continue;
          const suffix = outputOverride?.content || outputSystem?.content || '';
          const base = existing?.content || targetSystem.content;
          const content = base.includes(suffix) ? base : joinSections(base, suffix);
          if (upsertProjectContent(targetDefinition, dramaId, existing, content)) {
            stats.projectOverridesMigrated += 1;
          }
        }
      }
      deleteDefinitions([frameOutputDefinition]);
    }

    const characterGroup = CONSOLIDATED_PROMPT_KEYS.characterImage;
    const characterTarget = getDefinitionByKey(characterGroup.targetKey);
    const characterLayoutDefinition = getDefinitionByKey(characterGroup.absorbedKey);
    if (characterTarget && characterLayoutDefinition) {
      const targetSystem = getSystemRow(characterTarget.id);
      const layoutSystem = getSystemRow(characterLayoutDefinition.id);
      const layoutSeed = layoutSystem?.seed_content || layoutSystem?.content || '';
      const mergedSystem = inlineLayout(
        targetSystem.content,
        layoutSeed,
        layoutSystem?.content || layoutSeed
      );
      if (
        updateSystemContent(characterTarget, targetSystem, mergedSystem) &&
        (isCustomized(targetSystem) || isCustomized(layoutSystem))
      ) {
        stats.systemCustomizationsMigrated += 1;
      }
      const targetProjects = rowsByDrama(getProjectRows(characterTarget.id));
      const layoutProjects = rowsByDrama(getProjectRows(characterLayoutDefinition.id));
      const dramaIds = new Set([
        ...targetProjects.keys(),
        ...layoutProjects.keys(),
      ]);
      for (const dramaId of dramaIds) {
        const existing = targetProjects.get(dramaId) || null;
        const selectedLayout = layoutProjects.get(dramaId)?.content || layoutSystem?.content || '';
        const base = existing?.content || targetSystem.content;
        const content = inlineLayout(base, layoutSystem?.content || layoutSeed, selectedLayout);
        if (upsertProjectContent(characterTarget, dramaId, existing, content)) {
          stats.projectOverridesMigrated += 1;
        }
      }
      deleteDefinitions([characterLayoutDefinition]);
    }

    const frameScaleGroup = CONSOLIDATED_PROMPT_KEYS.frameScale;
    const sharedScaleDefinition = getDefinitionByKey(frameScaleGroup.absorbedKey);
    if (sharedScaleDefinition) {
      const sharedSystem = getSystemRow(sharedScaleDefinition.id);
      const sharedProjects = rowsByDrama(getProjectRows(sharedScaleDefinition.id));
      for (const targetKey of frameScaleGroup.targetKeys) {
        const targetDefinition = getDefinitionByKey(targetKey);
        if (!targetDefinition) continue;
        const targetSystem = getSystemRow(targetDefinition.id);
        if (
          isCustomized(sharedSystem) &&
          !isCustomized(targetSystem) &&
          updateSystemContent(targetDefinition, targetSystem, sharedSystem.content)
        ) {
          stats.systemCustomizationsMigrated += 1;
        }
        const targetProjects = rowsByDrama(getProjectRows(targetDefinition.id));
        for (const [dramaId, row] of sharedProjects) {
          if (targetProjects.has(dramaId)) continue;
          if (upsertProjectContent(targetDefinition, dramaId, null, row.content)) {
            stats.projectOverridesMigrated += 1;
          }
        }
      }
      deleteDefinitions([sharedScaleDefinition]);
    }

    const sceneGroup = CONSOLIDATED_PROMPT_KEYS.sceneImage;
    const composeDefinitions = sceneGroup.composeKeys
      .map(getDefinitionByKey)
      .filter(Boolean);
    const composeByKey = new Map(
      composeDefinitions.map((definition) => [definition.prompt_key, definition])
    );
    const layoutDefinitions = sceneGroup.variants
      .map((variant) => ({
        ...variant,
        definition: getDefinitionByKey(variant.layoutKey),
      }));
    if (composeDefinitions.length && layoutDefinitions.some(({ definition }) => definition)) {
      for (const variant of layoutDefinitions) {
        if (!variant.definition) continue;
        const targetDefinition = getDefinitionByKey(variant.targetKey);
        if (!targetDefinition) continue;
        const composeDefinition = variant.preferredComposeKeys
          .map((key) => composeByKey.get(key))
          .find(Boolean) || composeDefinitions[0];
        const composeSystem = getSystemRow(composeDefinition.id);
        const composeProjects = rowsByDrama(getProjectRows(composeDefinition.id));
        const targetSystem = getSystemRow(targetDefinition.id);
        const layoutSystem = getSystemRow(variant.definition.id);
        const layoutSeed = layoutSystem?.seed_content || layoutSystem?.content || '';
        if (isCustomized(composeSystem) || isCustomized(layoutSystem)) {
          const content = inlineLayout(
            composeSystem?.content || targetSystem.content,
            layoutSeed,
            layoutSystem?.content || layoutSeed
          );
          if (updateSystemContent(targetDefinition, targetSystem, content)) {
            stats.systemCustomizationsMigrated += 1;
          }
        }
        const targetProjects = rowsByDrama(getProjectRows(targetDefinition.id));
        const layoutProjects = rowsByDrama(getProjectRows(variant.definition.id));
        const dramaIds = new Set([
          ...targetProjects.keys(),
          ...composeProjects.keys(),
          ...layoutProjects.keys(),
        ]);
        for (const dramaId of dramaIds) {
          const existing = targetProjects.get(dramaId) || null;
          const composeContent =
            composeProjects.get(dramaId)?.content || composeSystem?.content || targetSystem.content;
          const layoutContent =
            layoutProjects.get(dramaId)?.content || layoutSystem?.content || layoutSeed;
          const content = inlineLayout(composeContent, layoutSeed, layoutContent);
          if (upsertProjectContent(targetDefinition, dramaId, existing, content)) {
            stats.projectOverridesMigrated += 1;
          }
        }
      }
      deleteDefinitions([
        ...composeDefinitions,
        ...layoutDefinitions.map(({ definition }) => definition),
      ]);
    }
  });
  tx();
  return stats;
}

function ensurePromptCatalog(db) {
  const seeded = seedCatalog(db);
  const mergedPrompts = migrateMergedPromptTemplates(db);
  const consolidatedPrompts = migrateConsolidatedPromptTemplates(db);
  const legacyMigrated = migrateLegacyOverrides(db);
  const sceneMapsMigrated = migrateSplitSceneMaps(db);
  return {
    seeded,
    mergedPrompts,
    consolidatedPrompts,
    legacyMigrated,
    sceneMapsMigrated,
  };
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
    locale: CANONICAL_LOCALE,
    variables: {
      ...commonVariables(opts.cfg),
      ...(opts.variables || {}),
    },
  }).content;
}

function selectEffectiveRow(db, definitionId, dramaId) {
  if (dramaId) {
    const project = db.prepare(`
      SELECT * FROM prompt_templates
      WHERE definition_id = ? AND scope = 'project' AND drama_id = ? AND locale = 'default'
        AND deleted_at IS NULL
    `).get(definitionId, dramaId);
    if (project) return project;
  }
  return db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'system' AND locale = 'default' AND deleted_at IS NULL
  `).get(definitionId) || null;
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
  const dramaId = resolveDramaId(db, opts);
  const row = selectEffectiveRow(db, definition.id, dramaId);
  if (!row) {
    throw Object.assign(new Error(`提示词模板不存在: ${promptKey}`), {
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
      version: row.version,
      content,
      captured_at: nowIso(),
    });
  }
  return resolved;
}

function listPrompts(db, opts = {}) {
  const dramaId = resolveDramaId(db, opts);
  const presentationByKey = new Map(
    buildCatalog().map((item) => [
      item.prompt_key,
      {
        parent_prompt_key: item.parent_prompt_key || null,
        is_fragment: item.is_fragment ? 1 : 0,
        template_kind: item.template_kind || 'main',
        template_subtype: item.template_subtype || null,
        content_type: item.content_type || 'user_template',
        injection_channel: item.injection_channel || '',
        relation_note: item.relation_note || '',
        business_scene_label: item.business_scene_label || '',
        business_scene_order: item.business_scene_order || 0,
        business_component_order: item.business_component_order || 0,
        business_slot: item.business_slot || 'component',
        business_slot_label: item.business_slot_label || '模板组件',
      },
    ])
  );
  const definitions = db.prepare(
    'SELECT * FROM prompt_definitions WHERE is_active = 1 ORDER BY sort_order, prompt_key'
  ).all();
  const rows = db.prepare(
    `SELECT * FROM prompt_templates
     WHERE deleted_at IS NULL AND locale = 'default'
     ORDER BY definition_id`
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
        ...(presentationByKey.get(def.prompt_key) || {
          parent_prompt_key: null,
          is_fragment: 0,
          template_kind: 'main',
          template_subtype: null,
          content_type: 'user_template',
          injection_channel: '',
          relation_note: '',
          business_scene_label: '',
          business_scene_order: 0,
          business_component_order: 0,
          business_slot: 'component',
          business_slot_label: '模板组件',
        }),
        variable_schema: parseSchema(def.variable_schema),
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

function requireDefinition(db, promptKey) {
  const definition = getDefinition(db, promptKey);
  if (!definition) throw Object.assign(new Error(`提示词定义不存在: ${promptKey}`), { code: 'NOT_FOUND' });
  return definition;
}

function updateSystemPrompt(db, promptKey, content, expectedVersion) {
  const definition = requireDefinition(db, promptKey);
  const validation = validateTemplateContent(definition, content);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join('；')), { code: 'PROMPT_VALIDATION_FAILED' });
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'system' AND locale = 'default' AND deleted_at IS NULL
  `).get(definition.id);
  if (!row) throw Object.assign(new Error('系统提示词不存在'), { code: 'NOT_FOUND' });
  if (expectedVersion != null && Number(expectedVersion) !== Number(row.version)) {
    throw Object.assign(new Error('提示词已被其他操作修改，请刷新后重试'), { code: 'VERSION_CONFLICT' });
  }
  const version = Number(row.version || 1) + 1;
  db.prepare('UPDATE prompt_templates SET content = ?, version = ?, updated_at = ? WHERE id = ?')
    .run(String(content).trim(), version, nowIso(), row.id);
  return { ...row, content: String(content).trim(), version };
}

function resetSystemPrompt(db, promptKey, expectedVersion) {
  const definition = requireDefinition(db, promptKey);
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'system' AND locale = 'default' AND deleted_at IS NULL
  `).get(definition.id);
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

function updateProjectPrompt(db, dramaIdValue, promptKey, content, expectedVersion) {
  const dramaId = Number(dramaIdValue);
  if (!Number.isInteger(dramaId) || dramaId <= 0) throw new Error('drama_id 无效');
  if (!db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)) {
    throw Object.assign(new Error('项目不存在'), { code: 'NOT_FOUND' });
  }
  const definition = requireDefinition(db, promptKey);
  if (!definition.allow_project_override) throw Object.assign(new Error('该提示词不允许项目覆盖'), { code: 'FORBIDDEN' });
  const validation = validateTemplateContent(definition, content);
  if (!validation.ok) throw Object.assign(new Error(validation.errors.join('；')), { code: 'PROMPT_VALIDATION_FAILED' });
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'project' AND drama_id = ? AND locale = 'default' AND deleted_at IS NULL
  `).get(definition.id, dramaId);
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
  `).run(definition.id, dramaId, CANONICAL_LOCALE, String(content).trim(), now, now);
  return db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(result.lastInsertRowid);
}

function deleteProjectPrompt(db, dramaIdValue, promptKey, expectedVersion) {
  const dramaId = Number(dramaIdValue);
  const definition = requireDefinition(db, promptKey);
  const row = db.prepare(`
    SELECT * FROM prompt_templates
    WHERE definition_id = ? AND scope = 'project' AND drama_id = ? AND locale = 'default' AND deleted_at IS NULL
  `).get(definition.id, dramaId);
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

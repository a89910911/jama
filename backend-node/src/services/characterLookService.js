const crypto = require('crypto');
const { insertIgnoreSql, tableExists } = require('../db/portableSql');
const wardrobeAvailabilityByDb = new WeakMap();

const LOOK_VISUAL_FIELDS = new Set([
  'appearance',
  'polished_prompt',
  'negative_prompt',
  'image_url',
  'local_path',
  'ref_image',
  'extra_images',
  'four_view_image_url',
  'reference_images',
  'style_tokens',
  'color_palette',
  'seedance2_asset',
]);

const LOOK_MUTABLE_FIELDS = new Set([
  'name',
  'category',
  ...LOOK_VISUAL_FIELDS,
  'error_msg',
  'status',
]);

const CHARACTER_MIRROR_FIELDS = [
  'appearance',
  'polished_prompt',
  'negative_prompt',
  'image_url',
  'local_path',
  'ref_image',
  'extra_images',
  'four_view_image_url',
  'style_tokens',
  'color_palette',
  'seedance2_asset',
  'error_msg',
];

const LOOK_SUMMARY_COLUMNS = `
  id, drama_id, character_id, name, category, appearance, polished_prompt,
  negative_prompt,
  CASE
    WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
      AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
    THEN NULL
    ELSE image_url
  END AS image_url,
  local_path,
  CASE
    WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
      AND LOWER(COALESCE(ref_image, '')) LIKE 'data:%'
    THEN NULL
    ELSE ref_image
  END AS ref_image,
  extra_images,
  CASE
    WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
      AND LOWER(COALESCE(four_view_image_url, '')) LIKE 'data:%'
    THEN NULL
    ELSE four_view_image_url
  END AS four_view_image_url,
  reference_images, style_tokens, color_palette, seedance2_asset, error_msg,
  visual_revision, status, legacy_stage_key, created_at, updated_at, deleted_at
`;

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function jsonColumn(value) {
  if (value == null || value === '') return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function normalizeLookName(value, fallback = '默认造型') {
  const text = String(value || '').trim();
  return (text || fallback).slice(0, 100);
}

function serializeLook(row, defaultLookId = null) {
  if (!row) return null;
  const localPath = String(row.local_path || '').trim();
  const responseImageUrl = localPath && /^data:/i.test(String(row.image_url || '').trim())
    ? null
    : row.image_url || null;
  const responseRefImage = localPath && /^data:/i.test(String(row.ref_image || '').trim())
    ? null
    : row.ref_image || null;
  const responseFourView = localPath
    && /^data:/i.test(String(row.four_view_image_url || '').trim())
    ? null
    : row.four_view_image_url || null;
  return {
    id: Number(row.id),
    drama_id: Number(row.drama_id),
    character_id: Number(row.character_id),
    name: row.name || '',
    category: row.category || null,
    appearance: row.appearance || null,
    polished_prompt: row.polished_prompt || null,
    negative_prompt: row.negative_prompt || null,
    image_url: responseImageUrl,
    local_path: row.local_path || null,
    ref_image: responseRefImage,
    extra_images: parseJson(row.extra_images, row.extra_images || null),
    four_view_image_url: responseFourView,
    reference_images: parseJson(row.reference_images, row.reference_images || null),
    style_tokens: parseJson(row.style_tokens, row.style_tokens || null),
    color_palette: parseJson(row.color_palette, row.color_palette || null),
    seedance2_asset: parseJson(row.seedance2_asset, null),
    error_msg: row.error_msg || null,
    visual_revision: Number(row.visual_revision || 1),
    status: row.status || 'active',
    is_default: Number(row.id) === Number(defaultLookId),
    legacy_stage_key: row.legacy_stage_key || null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at || null,
  };
}

function hasWardrobeTables(db) {
  if (wardrobeAvailabilityByDb.has(db)) {
    return wardrobeAvailabilityByDb.get(db);
  }
  try {
    const available = tableExists(db, 'character_looks')
      && tableExists(db, 'character_look_bindings');
    wardrobeAvailabilityByDb.set(db, available);
    return available;
  } catch (_) {
    return false;
  }
}

function getCharacter(db, characterId) {
  return db.prepare(
    'SELECT * FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(positiveId(characterId));
}

function getLookRow(db, lookId, includeArchived = false) {
  const sql = includeArchived
    ? 'SELECT * FROM character_looks WHERE id = ?'
    : "SELECT * FROM character_looks WHERE id = ? AND deleted_at IS NULL AND status = 'active'";
  return db.prepare(sql).get(positiveId(lookId));
}

function getLookSummaryRow(db, lookId, includeArchived = false) {
  const sql = includeArchived
    ? `SELECT ${LOOK_SUMMARY_COLUMNS} FROM character_looks WHERE id = ?`
    : `SELECT ${LOOK_SUMMARY_COLUMNS}
         FROM character_looks
        WHERE id = ? AND deleted_at IS NULL AND status = 'active'`;
  return db.prepare(sql).get(positiveId(lookId));
}

function listLookSummaryRowsForDrama(db, dramaId) {
  return db.prepare(
    `SELECT ${LOOK_SUMMARY_COLUMNS}
       FROM character_looks
      WHERE drama_id = ? AND deleted_at IS NULL AND status = 'active'
      ORDER BY character_id ASC, id ASC`
  ).all(positiveId(dramaId));
}

function listLooks(db, characterId, options = {}) {
  if (!hasWardrobeTables(db)) return [];
  const includeArchived = options.includeArchived === true;
  const rows = db.prepare(
    `SELECT l.*, c.default_look_id AS resolved_default_look_id
       FROM character_looks l
       JOIN characters c ON c.id = l.character_id AND c.deleted_at IS NULL
      WHERE l.character_id = ?
        ${includeArchived ? '' : "AND l.deleted_at IS NULL AND l.status = 'active'"}
      ORDER BY CASE WHEN l.id = c.default_look_id THEN 0 ELSE 1 END, l.id ASC`
  ).all(positiveId(characterId));
  return rows.map((row) => serializeLook(row, row.resolved_default_look_id));
}

function insertLookFromCharacter(db, character, options = {}) {
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO character_looks
      (drama_id, character_id, name, category, appearance, polished_prompt,
       negative_prompt, image_url, local_path, ref_image, extra_images,
       four_view_image_url, reference_images, style_tokens, color_palette,
       seedance2_asset, error_msg, visual_revision, status, legacy_stage_key,
       created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?, ?)`
  ).run(
    Number(character.drama_id),
    Number(character.id),
    normalizeLookName(options.name, '默认造型'),
    options.category || 'default',
    options.appearance !== undefined ? options.appearance : character.appearance || null,
    options.polished_prompt !== undefined ? options.polished_prompt : character.polished_prompt || null,
    options.negative_prompt !== undefined ? options.negative_prompt : character.negative_prompt || null,
    options.image_url !== undefined ? options.image_url : character.image_url || null,
    options.local_path !== undefined ? options.local_path : character.local_path || null,
    options.ref_image !== undefined ? options.ref_image : character.ref_image || null,
    jsonColumn(options.extra_images !== undefined ? options.extra_images : character.extra_images),
    options.four_view_image_url !== undefined
      ? options.four_view_image_url
      : character.four_view_image_url || null,
    jsonColumn(options.reference_images),
    jsonColumn(options.style_tokens !== undefined ? options.style_tokens : character.style_tokens),
    jsonColumn(options.color_palette !== undefined ? options.color_palette : character.color_palette),
    jsonColumn(options.seedance2_asset !== undefined ? options.seedance2_asset : character.seedance2_asset),
    options.error_msg !== undefined ? options.error_msg : character.error_msg || null,
    options.legacy_stage_key || null,
    now,
    now
  );
  return getLookRow(db, info.lastInsertRowid, true);
}

function ensureDefaultLook(db, characterId, options = {}, preloadedCharacter = null) {
  if (!hasWardrobeTables(db)) return null;
  const character = preloadedCharacter || getCharacter(db, characterId);
  if (!character) return null;
  if (positiveId(character.default_look_id)) {
    const existing = getLookRow(db, character.default_look_id);
    if (existing && Number(existing.character_id) === Number(character.id)) {
      return serializeLook(existing, character.default_look_id);
    }
  }

  let look = db.prepare(
    `SELECT * FROM character_looks
      WHERE character_id = ? AND deleted_at IS NULL AND status = 'active'
      ORDER BY id ASC LIMIT 1`
  ).get(character.id);
  if (!look) look = insertLookFromCharacter(db, character, options);
  db.prepare(
    'UPDATE characters SET default_look_id = ?, updated_at = ? WHERE id = ?'
  ).run(look.id, nowIso(), character.id);
  return serializeLook(look, look.id);
}

function mirrorDefaultLookToCharacter(db, characterId) {
  if (!hasWardrobeTables(db)) return null;
  const character = getCharacter(db, characterId);
  if (!character) return null;
  const ensured = ensureDefaultLook(db, character.id);
  if (!ensured) return null;
  const look = getLookRow(db, ensured.id, true);
  const assignments = CHARACTER_MIRROR_FIELDS.map((field) => `${field} = ?`);
  const values = CHARACTER_MIRROR_FIELDS.map((field) => look[field] ?? null);
  db.prepare(
    `UPDATE characters SET ${assignments.join(', ')}, updated_at = ? WHERE id = ?`
  ).run(...values, nowIso(), character.id);
  return serializeLook(look, look.id);
}

function syncDefaultLookFromCharacter(db, characterId, fields = null) {
  if (!hasWardrobeTables(db)) return null;
  const character = getCharacter(db, characterId);
  if (!character) return null;
  const ensured = ensureDefaultLook(db, character.id);
  if (!ensured) return null;
  const requested = fields == null
    ? CHARACTER_MIRROR_FIELDS
    : CHARACTER_MIRROR_FIELDS.filter((field) => fields.includes(field));
  if (!requested.length) return ensured;
  const currentLook = getLookRow(db, ensured.id, true);
  const changed = requested.filter((field) => {
    const nextValue = character[field] ?? null;
    const currentValue = currentLook?.[field] ?? null;
    return String(nextValue ?? '') !== String(currentValue ?? '');
  });
  if (!changed.length) return serializeLook(currentLook, ensured.id);
  const assignments = changed.map((field) => `${field} = ?`);
  const values = changed.map((field) => character[field] ?? null);
  db.prepare(
    `UPDATE character_looks
        SET ${assignments.join(', ')}, visual_revision = visual_revision + 1, updated_at = ?
       WHERE id = ?`
  ).run(...values, nowIso(), ensured.id);
  markCharacterStoryboardsStale(db, character.id);
  return serializeLook(getLookRow(db, ensured.id, true), ensured.id);
}

function storyboardCharacterIds(row) {
  const parsed = parseJson(row?.characters, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item) => positiveId(typeof item === 'object' && item != null ? item.id : item))
    .filter(Boolean);
}

function markCharacterStoryboardsStale(db, characterId) {
  const character = getCharacter(db, characterId);
  if (!character) return [];
  const rows = db.prepare(
    `SELECT s.id, s.characters
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE e.drama_id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`
  ).all(character.drama_id);
  const ids = rows
    .filter((row) => storyboardCharacterIds(row).includes(Number(character.id)))
    .map((row) => Number(row.id));
  const now = nowIso();
  for (const id of ids) {
    db.prepare(
      'UPDATE storyboards SET visual_context_stale = 1, updated_at = ? WHERE id = ?'
    ).run(now, id);
    try {
      db.prepare(
        'UPDATE frame_prompts SET context_stale = 1, updated_at = ? WHERE storyboard_id = ?'
      ).run(now, id);
    } catch (_) {}
    try {
      db.prepare(
        'UPDATE redraw_cards SET context_stale = 1, updated_at = ? WHERE storyboard_id = ? AND deleted_at IS NULL'
      ).run(now, id);
    } catch (_) {}
  }
  try {
    db.prepare(
      `UPDATE action_migration_jobs
          SET context_stale = 1, updated_at = ?
        WHERE character_id = ? AND deleted_at IS NULL`
    ).run(now, character.id);
  } catch (_) {}
  return ids;
}

function createLook(db, characterId, body = {}) {
  if (!hasWardrobeTables(db)) return { ok: false, error: 'wardrobe tables unavailable' };
  const character = getCharacter(db, characterId);
  if (!character) return { ok: false, error: 'character not found' };
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO character_looks
      (drama_id, character_id, name, category, appearance, polished_prompt,
       negative_prompt, image_url, local_path, ref_image, extra_images,
       four_view_image_url, reference_images, style_tokens, color_palette,
       seedance2_asset, error_msg, visual_revision, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`
  ).run(
    character.drama_id,
    character.id,
    normalizeLookName(body.name, `造型 ${listLooks(db, character.id).length + 1}`),
    body.category || 'custom',
    body.appearance || null,
    body.polished_prompt || null,
    body.negative_prompt || null,
    body.image_url || null,
    body.local_path || null,
    body.ref_image || null,
    jsonColumn(body.extra_images),
    body.four_view_image_url || null,
    jsonColumn(body.reference_images),
    jsonColumn(body.style_tokens),
    jsonColumn(body.color_palette),
    jsonColumn(body.seedance2_asset),
    body.error_msg || null,
    now,
    now
  );
  const look = getLookRow(db, info.lastInsertRowid, true);
  if (!positiveId(character.default_look_id) || body.make_default === true) {
    setDefaultLook(db, character.id, look.id);
  }
  return {
    ok: true,
    look: serializeLook(look, body.make_default === true ? look.id : character.default_look_id),
  };
}

function updateLook(db, lookId, body = {}) {
  if (!hasWardrobeTables(db)) return { ok: false, error: 'wardrobe tables unavailable' };
  const row = getLookRow(db, lookId, true);
  if (!row || row.deleted_at) return { ok: false, error: 'look not found' };
  const expected = body.expected_revision == null ? null : Number(body.expected_revision);
  if (expected != null && expected !== Number(row.visual_revision || 1)) {
    return {
      ok: false,
      conflict: true,
      error: 'look revision conflict',
      current: serializeLook(row, getCharacter(db, row.character_id)?.default_look_id),
    };
  }
  const updates = [];
  const values = [];
  let visualChanged = false;
  for (const field of LOOK_MUTABLE_FIELDS) {
    if (body[field] === undefined) continue;
    updates.push(`${field} = ?`);
    values.push(
      ['extra_images', 'reference_images', 'style_tokens', 'color_palette', 'seedance2_asset'].includes(field)
        ? jsonColumn(body[field])
        : body[field]
    );
    if (LOOK_VISUAL_FIELDS.has(field) && String(row[field] ?? '') !== String(values.at(-1) ?? '')) {
      visualChanged = true;
    }
  }
  if (body.name !== undefined) {
    const nameIndex = Array.from(LOOK_MUTABLE_FIELDS).indexOf('name');
    if (nameIndex >= 0) {
      const actualIndex = updates.findIndex((item) => item === 'name = ?');
      if (actualIndex >= 0) values[actualIndex] = normalizeLookName(body.name);
    }
  }
  if (!updates.length) {
    return {
      ok: true,
      look: serializeLook(row, getCharacter(db, row.character_id)?.default_look_id),
      affected_storyboard_ids: [],
    };
  }
  if (visualChanged) updates.push('visual_revision = visual_revision + 1');
  updates.push('updated_at = ?');
  values.push(nowIso(), row.id);
  db.prepare(`UPDATE character_looks SET ${updates.join(', ')} WHERE id = ?`).run(...values);
  const character = getCharacter(db, row.character_id);
  const affected = visualChanged ? markCharacterStoryboardsStale(db, row.character_id) : [];
  if (Number(character?.default_look_id) === Number(row.id)) {
    mirrorDefaultLookToCharacter(db, row.character_id);
  }
  const updated = getLookRow(db, row.id, true);
  return {
    ok: true,
    look: serializeLook(updated, character?.default_look_id),
    affected_storyboard_ids: affected,
  };
}

function setDefaultLook(db, characterId, lookId) {
  if (!hasWardrobeTables(db)) return { ok: false, error: 'wardrobe tables unavailable' };
  const character = getCharacter(db, characterId);
  const look = getLookRow(db, lookId);
  if (!character) return { ok: false, error: 'character not found' };
  if (!look || Number(look.character_id) !== Number(character.id)) {
    return { ok: false, error: 'look not found' };
  }
  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE characters SET default_look_id = ?, updated_at = ? WHERE id = ?'
    ).run(look.id, nowIso(), character.id);
    mirrorDefaultLookToCharacter(db, character.id);
    return markCharacterStoryboardsStale(db, character.id);
  });
  const affected = tx();
  return {
    ok: true,
    look: serializeLook(getLookRow(db, look.id, true), look.id),
    affected_storyboard_ids: affected,
  };
}

function lookDependencyReport(db, lookId) {
  const look = getLookRow(db, lookId, true);
  if (!look) return null;
  const bindings = db.prepare(
    `SELECT b.id, b.scope_type, b.scope_id, b.episode_id, b.transition_note
       FROM character_look_bindings b
       JOIN episodes e ON e.id = b.episode_id AND e.deleted_at IS NULL
      WHERE b.look_id = ? AND b.deleted_at IS NULL
      ORDER BY b.scope_type, b.scope_id`
  ).all(look.id);
  return {
    look_id: Number(look.id),
    character_id: Number(look.character_id),
    binding_count: bindings.length,
    bindings,
  };
}

function archiveLook(db, lookId, replacementLookId = null) {
  const look = getLookRow(db, lookId, true);
  if (!look || look.deleted_at) return { ok: false, error: 'look not found' };
  const character = getCharacter(db, look.character_id);
  const report = lookDependencyReport(db, look.id);
  let replacement = null;
  if (replacementLookId != null) {
    replacement = getLookRow(db, replacementLookId);
    if (!replacement || Number(replacement.character_id) !== Number(look.character_id)) {
      return { ok: false, error: 'replacement look not found' };
    }
  }
  const requiresReplacement =
    Number(character?.default_look_id) === Number(look.id) || report.binding_count > 0;
  if (requiresReplacement && !replacement) {
    return { ok: false, conflict: true, error: 'look has dependencies', dependencies: report };
  }
  const tx = db.transaction(() => {
    const now = nowIso();
    if (replacement) {
      db.prepare(
        `UPDATE character_look_bindings
            SET look_id = ?, source = 'replacement', updated_at = ?
          WHERE look_id = ? AND deleted_at IS NULL`
      ).run(replacement.id, now, look.id);
    }
    if (Number(character?.default_look_id) === Number(look.id)) {
      db.prepare(
        'UPDATE characters SET default_look_id = ?, updated_at = ? WHERE id = ?'
      ).run(replacement.id, now, character.id);
    }
    db.prepare(
      "UPDATE character_looks SET status = 'archived', deleted_at = ?, updated_at = ? WHERE id = ?"
    ).run(now, now, look.id);
    if (replacement) mirrorDefaultLookToCharacter(db, character.id);
    return markCharacterStoryboardsStale(db, look.character_id);
  });
  return { ok: true, affected_storyboard_ids: tx(), dependencies: report };
}

function recordMigrationWarning(db, characterId, warningKey, warningType, details) {
  if (!tableExists(db, 'character_look_migration_warnings')) return;
  db.prepare(insertIgnoreSql(
    db,
    `INSERT INTO character_look_migration_warnings
      (character_id, warning_key, warning_type, details, created_at)
     VALUES (?, ?, ?, ?, ?)`
  )).run(
    characterId,
    warningKey,
    warningType,
    jsonColumn(details),
    nowIso()
  );
}

function stageKey(index, stage) {
  const digest = crypto.createHash('sha1')
    .update(JSON.stringify(stage || {}))
    .digest('hex')
    .slice(0, 10);
  return `stage_${index}_${digest}`;
}

function ensureLegacyStageLook(db, character, index, stage) {
  const key = stageKey(index, stage);
  let existing = db.prepare(
    'SELECT * FROM character_looks WHERE character_id = ? AND legacy_stage_key = ?'
  ).get(character.id, key);
  if (existing) return existing;
  const range = Array.isArray(stage.episode_range) ? stage.episode_range : [];
  const label = String(stage.name || '').trim()
    || (range.length === 2 ? `第${range[0]}-${range[1]}集造型` : `阶段造型 ${index + 1}`);
  existing = insertLookFromCharacter(db, character, {
    name: label,
    category: stage.category || 'stage',
    appearance: stage.appearance || null,
    polished_prompt: stage.polished_prompt || null,
    negative_prompt: stage.negative_prompt || null,
    image_url: stage.image_url || null,
    local_path: stage.local_path || null,
    ref_image: stage.ref_image || null,
    legacy_stage_key: key,
  });
  return existing;
}

function migrateLegacyStagesForCharacter(db, character) {
  if (!character.stages) return { looks: 0, bindings: 0, warnings: 0 };
  let stages;
  try {
    stages = typeof character.stages === 'string'
      ? JSON.parse(character.stages)
      : character.stages;
  } catch (error) {
    recordMigrationWarning(
      db,
      character.id,
      'invalid_json',
      'invalid_json',
      { message: error.message, original: String(character.stages).slice(0, 4000) }
    );
    return { looks: 0, bindings: 0, warnings: 1 };
  }
  if (!Array.isArray(stages)) {
    recordMigrationWarning(db, character.id, 'not_array', 'invalid_shape', { original: stages });
    return { looks: 0, bindings: 0, warnings: 1 };
  }

  const episodes = db.prepare(
    `SELECT id, episode_number FROM episodes
      WHERE drama_id = ? AND deleted_at IS NULL
      ORDER BY episode_number ASC, id ASC`
  ).all(character.drama_id);
  const claimed = new Map();
  const conflicted = new Set();
  let lookCount = 0;
  let bindingCount = 0;
  let warnings = 0;
  const looks = [];

  stages.forEach((stage, index) => {
    const range = Array.isArray(stage?.episode_range) ? stage.episode_range : [];
    const start = Number(range[0]);
    const end = Number(range[1]);
    if (!stage || typeof stage !== 'object' || !stage.appearance
      || !Number.isInteger(start) || !Number.isInteger(end) || start > end) {
      recordMigrationWarning(
        db,
        character.id,
        `stage_${index}_invalid`,
        'invalid_stage',
        { index, stage }
      );
      warnings += 1;
      return;
    }
    const look = ensureLegacyStageLook(db, character, index, stage);
    looks.push(look);
    lookCount += 1;
    for (const episode of episodes) {
      const number = Number(episode.episode_number);
      if (number < start || number > end || conflicted.has(episode.id)) continue;
      if (claimed.has(episode.id)) {
        db.prepare(
          `UPDATE character_look_bindings
              SET deleted_at = ?, updated_at = ?
            WHERE scope_type = 'episode' AND scope_id = ? AND character_id = ?
              AND deleted_at IS NULL`
        ).run(nowIso(), nowIso(), episode.id, character.id);
        conflicted.add(episode.id);
        recordMigrationWarning(
          db,
          character.id,
          `episode_${episode.id}_overlap`,
          'overlapping_episode_range',
          {
            episode_id: episode.id,
            episode_number: number,
            stage_indexes: [claimed.get(episode.id), index],
          }
        );
        warnings += 1;
        continue;
      }
      const existing = db.prepare(
        `SELECT id, deleted_at FROM character_look_bindings
          WHERE scope_type = 'episode' AND scope_id = ? AND character_id = ?`
      ).get(episode.id, character.id);
      if (existing) {
        db.prepare(
          `UPDATE character_look_bindings
              SET drama_id = ?, episode_id = ?, look_id = ?, source = 'migrated_stage',
                  transition_note = ?, deleted_at = NULL, updated_at = ?
            WHERE id = ?`
        ).run(
          character.drama_id,
          episode.id,
          look.id,
          `从 characters.stages 第 ${index + 1} 项迁移`,
          nowIso(),
          existing.id
        );
        bindingCount += existing.deleted_at ? 1 : 0;
      } else {
        db.prepare(
          `INSERT INTO character_look_bindings
            (drama_id, episode_id, character_id, look_id, scope_type, scope_id,
             source, transition_note, created_at, updated_at)
           VALUES (?, ?, ?, ?, 'episode', ?, 'migrated_stage', ?, ?, ?)`
        ).run(
          character.drama_id,
          episode.id,
          character.id,
          look.id,
          episode.id,
          `从 characters.stages 第 ${index + 1} 项迁移`,
          nowIso(),
          nowIso()
        );
        bindingCount += 1;
      }
      claimed.set(episode.id, index);
    }
  });
  return { looks: lookCount, bindings: bindingCount, warnings, look_ids: looks.map((row) => row.id) };
}

function backfillAllCharacters(db, log = console) {
  if (!hasWardrobeTables(db) || !tableExists(db, 'characters')) {
    return { characters: 0, default_looks: 0, stage_looks: 0, bindings: 0, warnings: 0 };
  }
  const characters = db.prepare(
    `SELECT id, drama_id, default_look_id, stages
       FROM characters
      WHERE deleted_at IS NULL
      ORDER BY id ASC`
  ).all();
  const stats = {
    characters: characters.length,
    default_looks: 0,
    stage_looks: 0,
    bindings: 0,
    warnings: 0,
  };
  const tx = db.transaction(() => {
    for (const character of characters) {
      const defaultLookId = positiveId(character.default_look_id);
      const hasValidDefault = defaultLookId
        ? !!db.prepare(
          `SELECT 1 FROM character_looks
            WHERE id = ? AND character_id = ?
              AND deleted_at IS NULL AND status = 'active'
            LIMIT 1`
        ).get(defaultLookId, character.id)
        : false;
      const requiresFullCharacter = !hasValidDefault || !!character.stages;
      const sourceCharacter = requiresFullCharacter
        ? getCharacter(db, character.id)
        : character;
      const look = hasValidDefault
        ? { id: defaultLookId }
        : ensureDefaultLook(db, character.id, {}, sourceCharacter);
      if (!hasValidDefault && look) stats.default_looks += 1;
      const result = migrateLegacyStagesForCharacter(db, sourceCharacter);
      stats.stage_looks += result.looks;
      stats.bindings += result.bindings;
      stats.warnings += result.warnings;
    }
  });
  tx();
  if (log?.info) log.info('[衣橱迁移] 角色造型回填完成', stats);
  return stats;
}

function characterDependencyReport(db, characterId) {
  const character = getCharacter(db, characterId);
  if (!character) return null;
  const episodeLinks = db.prepare(
    'SELECT episode_id FROM episode_characters WHERE character_id = ?'
  ).all(character.id);
  const lookBindings = hasWardrobeTables(db)
    ? db.prepare(
      `SELECT b.id, b.scope_type, b.scope_id, b.look_id
         FROM character_look_bindings b
         JOIN episodes e ON e.id = b.episode_id AND e.deleted_at IS NULL
        WHERE b.character_id = ? AND b.deleted_at IS NULL`
    ).all(character.id)
    : [];
  const storyboardRows = db.prepare(
    `SELECT s.id, s.storyboard_number, s.characters
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE e.drama_id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`
  ).all(character.drama_id);
  const storyboards = storyboardRows
    .filter((row) => storyboardCharacterIds(row).includes(Number(character.id)))
    .map(({ id, storyboard_number }) => ({ id, storyboard_number }));
  return {
    character_id: Number(character.id),
    episode_count: episodeLinks.length,
    storyboard_count: storyboards.length,
    look_binding_count: lookBindings.length,
    episode_ids: episodeLinks.map((row) => Number(row.episode_id)),
    storyboards,
    look_bindings: lookBindings,
  };
}

module.exports = {
  LOOK_VISUAL_FIELDS,
  archiveLook,
  backfillAllCharacters,
  characterDependencyReport,
  createLook,
  ensureDefaultLook,
  getLookRow,
  getLookSummaryRow,
  hasWardrobeTables,
  listLookSummaryRowsForDrama,
  listLooks,
  lookDependencyReport,
  markCharacterStoryboardsStale,
  mirrorDefaultLookToCharacter,
  parseJson,
  serializeLook,
  setDefaultLook,
  syncDefaultLookFromCharacter,
  updateLook,
};

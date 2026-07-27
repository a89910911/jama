const crypto = require('crypto');
const characterLookService = require('./characterLookService');
const bindingService = require('./characterLookBindingService');
const { readBatch } = require('../db/portableSql');

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function publicMediaUrl(row, fields = ['local_path', 'image_url', 'ref_image', 'four_view_image_url']) {
  for (const field of fields) {
    const raw = String(row?.[field] || '').trim();
    if (!raw) continue;
    if (/^(?:https?:|data:|asset:)/i.test(raw) || raw.startsWith('/static/')) return raw;
    return `/static/${raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`;
  }
  return '';
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    ).join(',')}}`;
  }
  return JSON.stringify(value);
}

function hashObject(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function loadStoryboard(db, storyboardId, cache = null) {
  const id = positiveId(storyboardId);
  if (cache?.storyboards?.has(id)) return cache.storyboards.get(id);
  const row = db.prepare(
    `SELECT s.id, s.episode_id, s.scene_id, s.scene_block_id, s.characters,
            s.location, s.appearance_context_hash, s.visual_context_stale,
            e.drama_id, e.episode_number, e.title AS episode_title
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`
  ).get(id);
  if (row && cache?.storyboards) cache.storyboards.set(id, row);
  return row;
}

function bindingCacheKey(scopeType, scopeId, characterId) {
  return `${scopeType}:${Number(scopeId)}:${Number(characterId)}`;
}

function effectiveBinding(db, storyboard, characterId, cache = null) {
  const candidates = [
    ['storyboard', storyboard.id],
    ['scene_block', storyboard.scene_block_id],
    ['episode', storyboard.episode_id],
  ];
  for (const [scopeType, scopeId] of candidates) {
    if (!positiveId(scopeId)) continue;
    const key = bindingCacheKey(scopeType, scopeId, characterId);
    if (cache?.bindings?.has(key)) return cache.bindings.get(key);
    if (cache?.bindingsComplete) continue;
    const row = db.prepare(
      `SELECT * FROM character_look_bindings
        WHERE scope_type = ? AND scope_id = ? AND character_id = ?
          AND deleted_at IS NULL`
    ).get(scopeType, scopeId, characterId);
    if (cache?.bindings) cache.bindings.set(key, row || null);
    if (row) return row;
  }
  return null;
}

function cachedLook(db, lookId, cache = null) {
  const id = positiveId(lookId);
  if (!id) return null;
  if (cache?.looks?.has(id)) return cache.looks.get(id);
  const row = characterLookService.getLookSummaryRow(db, id);
  if (cache?.looks) cache.looks.set(id, row || null);
  return row;
}

function resolveCharacterLook(db, storyboard, character, cache = null) {
  const warnings = [];
  const binding = effectiveBinding(db, storyboard, character.id, cache);
  let look = binding
    ? cachedLook(db, binding.look_id, cache)
    : cachedLook(db, character.default_look_id, cache);
  let source = binding?.scope_type || 'default';
  if (binding && !look) {
    warnings.push({
      level: 'error',
      code: 'bound_look_unavailable',
      character_id: Number(character.id),
      look_id: Number(binding.look_id),
      message: `${character.name} 绑定的造型已归档或不存在`,
    });
    source = 'default_fallback';
  }
  if (!look) {
    const ensured = characterLookService.ensureDefaultLook(db, character.id);
    look = ensured ? cachedLook(db, ensured.id, cache) : null;
  }
  if (!look) {
    warnings.push({
      level: 'error',
      code: 'missing_default_look',
      character_id: Number(character.id),
      message: `${character.name} 没有可用造型`,
    });
    return {
      character_id: Number(character.id),
      character_name: character.name,
      look: null,
      binding: binding || null,
      binding_source: source,
      reference_url: '',
      warnings,
    };
  }

  let referenceUrl = publicMediaUrl(
    look,
    ['local_path', 'image_url', 'ref_image', 'four_view_image_url']
  );
  const isDefault = Number(character.default_look_id) === Number(look.id);
  if (!referenceUrl && isDefault) {
    referenceUrl = publicMediaUrl(
      character,
      ['local_path', 'image_url', 'ref_image', 'four_view_image_url']
    );
  }
  if (!referenceUrl) {
    warnings.push({
      level: isDefault ? 'warning' : 'error',
      code: isDefault ? 'missing_default_look_reference' : 'missing_look_reference',
      character_id: Number(character.id),
      look_id: Number(look.id),
      message: `${character.name}「${look.name}」缺少参考图`,
    });
  }
  return {
    character_id: Number(character.id),
    character_name: character.name,
    identity_appearance: character.identity_appearance || null,
    identity_anchors: parseJson(character.identity_anchors, character.identity_anchors || null),
    look: characterLookService.serializeLook(look, character.default_look_id),
    binding: binding
      ? {
        id: Number(binding.id),
        scope_type: binding.scope_type,
        scope_id: Number(binding.scope_id),
        source: binding.source,
        transition_note: binding.transition_note || null,
      }
      : null,
    binding_source: source,
    reference_url: referenceUrl,
    warnings,
  };
}

function resolveScene(db, storyboard, cache = null) {
  if (!positiveId(storyboard.scene_id)) return null;
  let row = cache?.scenes?.get(Number(storyboard.scene_id));
  if (row === undefined) {
    row = db.prepare(
      `SELECT id, drama_id, location, time, prompt, polished_prompt,
              CASE
                WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
                  AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
                THEN NULL
                ELSE image_url
              END AS image_url,
              local_path, ref_image
       FROM scenes WHERE id = ? AND deleted_at IS NULL`
    ).get(storyboard.scene_id);
    if (cache?.scenes) cache.scenes.set(Number(storyboard.scene_id), row || null);
  }
  if (!row || Number(row.drama_id) !== Number(storyboard.drama_id)) return null;
  return {
    id: Number(row.id),
    name: row.location || storyboard.location || '场景',
    location: row.location || null,
    time: row.time || null,
    prompt: row.polished_prompt || row.prompt || null,
    reference_url: publicMediaUrl(row, ['local_path', 'image_url', 'ref_image']),
  };
}

function resolveProps(db, storyboard, cache = null) {
  let rows = cache?.propsByStoryboard?.get(Number(storyboard.id));
  if (rows === undefined) {
    rows = db.prepare(
    `SELECT p.id, p.name, p.type, p.description, p.prompt,
            CASE
              WHEN NULLIF(TRIM(p.local_path), '') IS NOT NULL
                AND LOWER(COALESCE(p.image_url, '')) LIKE 'data:%'
              THEN NULL
              ELSE p.image_url
            END AS image_url,
            p.local_path, p.ref_image
       FROM storyboard_props sp
       JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
      WHERE sp.storyboard_id = ? AND p.drama_id = ?
      ORDER BY p.id ASC`
    ).all(storyboard.id, storyboard.drama_id);
    if (cache?.propsByStoryboard) {
      cache.propsByStoryboard.set(Number(storyboard.id), rows);
    }
  }
  return rows.map((row) => ({
    id: Number(row.id),
    name: row.name || '道具',
    type: row.type || null,
    description: row.description || null,
    prompt: row.prompt || null,
    reference_url: publicMediaUrl(row, ['local_path', 'image_url', 'ref_image']),
  }));
}

function createEpisodeResolutionCache(
  db,
  episode,
  storyboards,
  bindings = null,
  preloaded = {}
) {
  const dramaId = Number(episode.drama_id);
  const episodeId = Number(episode.id);
  const characterRows = Array.isArray(preloaded.characters)
    ? preloaded.characters
    : db.prepare(
    `SELECT id, drama_id, name, identity_appearance, identity_anchors,
            default_look_id,
            CASE
              WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
                AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
              THEN NULL
              ELSE image_url
            END AS image_url,
            local_path, ref_image, four_view_image_url
       FROM characters
      WHERE drama_id = ? AND deleted_at IS NULL`
  ).all(dramaId);
  const lookRows = Array.isArray(preloaded.looks)
    ? preloaded.looks
    : characterLookService.listLookSummaryRowsForDrama(db, dramaId);
  const sceneRows = Array.isArray(preloaded.scenes)
    ? preloaded.scenes
    : db.prepare(
    `SELECT id, drama_id, location, time, prompt, polished_prompt,
            CASE
              WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
                AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
              THEN NULL
              ELSE image_url
            END AS image_url,
            local_path, ref_image
       FROM scenes
      WHERE drama_id = ? AND deleted_at IS NULL`
  ).all(dramaId);
  const propRows = Array.isArray(preloaded.props)
    ? preloaded.props
    : db.prepare(
    `SELECT sp.storyboard_id, p.id, p.name, p.type, p.description, p.prompt,
            CASE
              WHEN NULLIF(TRIM(p.local_path), '') IS NOT NULL
                AND LOWER(COALESCE(p.image_url, '')) LIKE 'data:%'
              THEN NULL
              ELSE p.image_url
            END AS image_url,
            p.local_path, p.ref_image
       FROM storyboard_props sp
       JOIN storyboards s ON s.id = sp.storyboard_id AND s.deleted_at IS NULL
       JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
      WHERE s.episode_id = ? AND p.drama_id = ?
      ORDER BY sp.storyboard_id ASC, p.id ASC`
  ).all(episodeId, dramaId);
  const bindingRows = Array.isArray(bindings)
    ? bindings
    : bindingService.listBindingsForEpisode(db, episodeId);
  const propsByStoryboard = new Map(
    storyboards.map((row) => [Number(row.id), []])
  );
  for (const row of propRows) {
    const storyboardId = Number(row.storyboard_id);
    if (!propsByStoryboard.has(storyboardId)) propsByStoryboard.set(storyboardId, []);
    propsByStoryboard.get(storyboardId).push(row);
  }
  return {
    storyboards: new Map(storyboards.map((row) => [Number(row.id), row])),
    characters: new Map(characterRows.map((row) => [Number(row.id), row])),
    looks: new Map(lookRows.map((row) => [Number(row.id), row])),
    scenes: new Map(sceneRows.map((row) => [Number(row.id), row])),
    bindings: new Map(bindingRows.map((row) => [
      bindingCacheKey(row.scope_type, row.scope_id, row.character_id),
      row,
    ])),
    bindingsComplete: true,
    propsByStoryboard,
  };
}

function contextCanonical(context) {
  return {
    drama_id: context.drama_id,
    episode_id: context.episode_id,
    storyboard_id: context.storyboard_id,
    scene_block_id: context.scene_block_id,
    scene: context.scene
      ? {
        id: context.scene.id,
        reference_url: context.scene.reference_url,
        prompt: context.scene.prompt,
      }
      : null,
    characters: context.characters.map((item) => ({
      character_id: item.character_id,
      identity_appearance: item.identity_appearance,
      identity_anchors: item.identity_anchors,
      look_id: item.look?.id || null,
      look_revision: item.look?.visual_revision || null,
      look_appearance: item.look?.appearance || null,
      look_prompt: item.look?.polished_prompt || null,
      reference_url: item.reference_url || '',
      binding_source: item.binding_source,
    })),
    props: context.props.map((item) => ({
      id: item.id,
      reference_url: item.reference_url,
      prompt: item.prompt,
    })),
  };
}

function resolveStoryboardVisualContext(db, storyboardId, options = {}) {
  const cache = options.cache || null;
  let storyboard = loadStoryboard(db, storyboardId, cache);
  if (!storyboard) return null;
  if (!positiveId(storyboard.scene_block_id)) {
    bindingService.ensureSceneBlocksForEpisode(db, storyboard.episode_id);
    if (cache?.storyboards) cache.storyboards.delete(Number(storyboard.id));
    storyboard = loadStoryboard(db, storyboardId, cache);
  }
  const requestedIds = bindingService.storyboardCharacterIds(storyboard);
  const characters = [];
  const warnings = [];
  for (const id of requestedIds) {
    let character = cache?.characters?.get(Number(id));
    if (character === undefined) {
      character = db.prepare(
        `SELECT id, drama_id, name, identity_appearance, identity_anchors,
                default_look_id,
                CASE
                  WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
                    AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
                  THEN NULL
                  ELSE image_url
                END AS image_url,
                local_path, ref_image, four_view_image_url
           FROM characters
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).get(id, storyboard.drama_id);
      if (cache?.characters) cache.characters.set(Number(id), character || null);
    }
    if (!character) {
      warnings.push({
        level: 'error',
        code: 'invalid_storyboard_character',
        character_id: id,
        message: `分镜包含无效或跨项目角色 ID ${id}`,
      });
      continue;
    }
    const resolved = resolveCharacterLook(db, storyboard, character, cache);
    characters.push(resolved);
    warnings.push(...resolved.warnings);
  }
  const scene = resolveScene(db, storyboard, cache);
  const props = resolveProps(db, storyboard, cache);
  const slots = [];
  if (scene?.reference_url) {
    slots.push({ index: slots.length + 1, kind: 'scene', id: scene.id, name: scene.name, url: scene.reference_url });
  }
  for (const item of characters) {
    if (!item.reference_url) continue;
    slots.push({
      index: slots.length + 1,
      kind: 'character_look',
      id: item.look.id,
      character_id: item.character_id,
      name: `${item.character_name}·${item.look.name}`,
      url: item.reference_url,
    });
  }
  for (const item of props) {
    if (!item.reference_url) continue;
    slots.push({ index: slots.length + 1, kind: 'prop', id: item.id, name: item.name, url: item.reference_url });
  }
  const context = {
    schema_version: '1.0',
    drama_id: Number(storyboard.drama_id),
    episode_id: Number(storyboard.episode_id),
    storyboard_id: Number(storyboard.id),
    scene_block_id: positiveId(storyboard.scene_block_id),
    scene,
    characters,
    props,
    reference_slots: slots,
    warnings,
  };
  context.appearance_context_hash = hashObject(contextCanonical(context));
  context.appearance_context_json = JSON.stringify(contextCanonical(context));
  context.stale = !!storyboard.visual_context_stale
    || (!!storyboard.appearance_context_hash
      && storyboard.appearance_context_hash !== context.appearance_context_hash);
  if (options.persist === true) {
    db.prepare(
      `UPDATE storyboards
          SET appearance_context_hash = ?, visual_context_stale = 0, updated_at = ?
        WHERE id = ?`
    ).run(context.appearance_context_hash, new Date().toISOString(), storyboard.id);
  }
  return context;
}

function generationContextHash(appearanceContextHash, request = {}) {
  return hashObject({
    appearance_context_hash: appearanceContextHash || '',
    prompt: request.prompt || '',
    negative_prompt: request.negative_prompt || '',
    model: request.model || '',
    provider: request.provider || '',
    size: request.size || '',
    duration: request.duration || null,
    aspect_ratio: request.aspect_ratio || '',
    reference_urls: request.reference_urls || request.reference_image_urls || [],
  });
}

function isAppearanceContextCurrent(db, contextValue, expectedHash = null) {
  const context = parseJson(contextValue, null);
  if (!context) return !expectedHash;
  if (positiveId(context.storyboard_id)) {
    const current = resolveStoryboardVisualContext(db, context.storyboard_id);
    return !!current && (!expectedHash
      || current.appearance_context_hash === expectedHash);
  }
  const characters = Array.isArray(context.characters) ? context.characters : [];
  for (const item of characters) {
    const lookId = positiveId(item.look_id || item.look?.id);
    const revision = Number(item.look_revision || item.look?.visual_revision || 0);
    if (!lookId) continue;
    const current = characterLookService.getLookSummaryRow(db, lookId);
    if (!current || (revision && Number(current.visual_revision || 1) !== revision)) {
      return false;
    }
  }
  return true;
}

function sceneBlockSignature(row) {
  return [
    row?.scene_id == null ? '' : Number(row.scene_id),
    String(row?.location || '').trim().toLowerCase(),
    String(row?.time || '').trim().toLowerCase(),
  ].join('|');
}

function sceneBlocksNeedRefresh(storyboards, sceneBlocks) {
  const groups = [];
  for (const storyboard of storyboards) {
    const signature = sceneBlockSignature(storyboard);
    const previous = groups.at(-1);
    if (previous?.signature === signature) {
      previous.storyboards.push(storyboard);
    } else {
      groups.push({ signature, storyboards: [storyboard] });
    }
  }
  if (groups.length !== sceneBlocks.length) return true;
  return groups.some((group, index) => {
    const block = sceneBlocks[index];
    return !block
      || Number(block.sort_order) !== index
      || String(block.signature || '') !== group.signature
      || group.storyboards.some(
        (storyboard) => Number(storyboard.scene_block_id) !== Number(block.id)
      );
  });
}

function loadEpisodeContextBundle(db, episodeId, allowSceneBlockRefresh = true) {
  const id = positiveId(episodeId);
  if (!id) return null;
  const [
    episode,
    sceneBlocks,
    bindings,
    storyboards,
    characters,
    looks,
    scenes,
    props,
  ] = readBatch(db, [
    {
      mode: 'get',
      sql: 'SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL',
      values: [id],
    },
    {
      sql: `SELECT * FROM scene_blocks
             WHERE episode_id = ? AND deleted_at IS NULL
             ORDER BY sort_order ASC, id ASC`,
      values: [id],
    },
    {
      sql: `SELECT b.*, l.name AS look_name, l.category AS look_category,
                   l.visual_revision, c.name AS character_name
              FROM character_look_bindings b
              JOIN character_looks l ON l.id = b.look_id
              JOIN characters c ON c.id = b.character_id
             WHERE b.episode_id = ? AND b.deleted_at IS NULL
               AND l.deleted_at IS NULL AND c.deleted_at IS NULL
             ORDER BY b.character_id, b.scope_type, b.scope_id`,
      values: [id],
    },
    {
      sql: `SELECT s.id, s.episode_id, s.scene_id, s.scene_block_id, s.characters,
                   s.location, s.time, s.storyboard_number, s.appearance_context_hash,
                   s.visual_context_stale, e.drama_id, e.episode_number,
                   e.title AS episode_title
              FROM storyboards s
              JOIN episodes e ON e.id = s.episode_id
             WHERE s.episode_id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL
             ORDER BY s.storyboard_number ASC, s.id ASC`,
      values: [id],
    },
    {
      sql: `SELECT id, drama_id, name, identity_appearance, identity_anchors,
                   default_look_id,
                   CASE
                     WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
                       AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
                     THEN NULL
                     ELSE image_url
                   END AS image_url,
                   local_path, ref_image, four_view_image_url
              FROM characters
             WHERE drama_id = (
               SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL
             ) AND deleted_at IS NULL`,
      values: [id],
    },
    {
      sql: `SELECT * FROM character_looks
             WHERE drama_id = (
               SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL
             ) AND deleted_at IS NULL AND status = 'active'
             ORDER BY character_id ASC, id ASC`,
      values: [id],
    },
    {
      sql: `SELECT id, drama_id, location, time, prompt, polished_prompt,
                   CASE
                     WHEN NULLIF(TRIM(local_path), '') IS NOT NULL
                       AND LOWER(COALESCE(image_url, '')) LIKE 'data:%'
                     THEN NULL
                     ELSE image_url
                   END AS image_url,
                   local_path, ref_image
              FROM scenes
             WHERE drama_id = (
               SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL
             ) AND deleted_at IS NULL`,
      values: [id],
    },
    {
      sql: `SELECT sp.storyboard_id, p.id, p.name, p.type, p.description, p.prompt,
                   CASE
                     WHEN NULLIF(TRIM(p.local_path), '') IS NOT NULL
                       AND LOWER(COALESCE(p.image_url, '')) LIKE 'data:%'
                     THEN NULL
                     ELSE p.image_url
                   END AS image_url,
                   p.local_path, p.ref_image
              FROM storyboard_props sp
              JOIN storyboards s ON s.id = sp.storyboard_id AND s.deleted_at IS NULL
              JOIN episodes e ON e.id = s.episode_id AND e.deleted_at IS NULL
              JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
             WHERE s.episode_id = ? AND p.drama_id = e.drama_id
             ORDER BY sp.storyboard_id ASC, p.id ASC`,
      values: [id],
    },
  ]);
  if (!episode) return null;
  const activeSceneBlocks = storyboards.length ? sceneBlocks : [];

  if (
    allowSceneBlockRefresh
    && storyboards.length
    && sceneBlocksNeedRefresh(storyboards, activeSceneBlocks)
  ) {
    bindingService.ensureSceneBlocksForEpisode(db, id);
    return loadEpisodeContextBundle(db, id, false);
  }

  return {
    episode,
    sceneBlocks: activeSceneBlocks,
    bindings,
    storyboards,
    preloaded: { characters, looks, scenes, props },
  };
}

function preflightEpisode(db, episodeId, options = {}) {
  if (!options.episode || !Array.isArray(options.storyboards) || !options.preloaded) {
    const bundle = loadEpisodeContextBundle(db, episodeId);
    if (!bundle) return null;
    return preflightEpisode(db, episodeId, { ...options, ...bundle });
  }
  const episode = options.episode;
  if (!episode) return null;
  if (!Array.isArray(options.sceneBlocks)) {
    bindingService.ensureSceneBlocksForEpisode(db, episode.id);
  }
  const rows = options.storyboards;
  const cache = createEpisodeResolutionCache(
    db,
    episode,
    rows,
    options.bindings,
    options.preloaded
  );
  const contexts = rows.map((row) =>
    resolveStoryboardVisualContext(db, row.id, {
      persist: options.persist === true,
      cache,
    })
  ).filter(Boolean);
  const issues = [];
  for (const context of contexts) {
    for (const warning of context.warnings) {
      issues.push({ ...warning, storyboard_id: context.storyboard_id });
    }
  }
  for (let index = 1; index < contexts.length; index += 1) {
    const previous = contexts[index - 1];
    const current = contexts[index];
    const previousByCharacter = new Map(
      previous.characters.map((item) => [item.character_id, item])
    );
    for (const item of current.characters) {
      const before = previousByCharacter.get(item.character_id);
      if (!before || !before.look || !item.look || before.look.id === item.look.id) continue;
      const sceneBoundary = previous.scene_block_id !== current.scene_block_id;
      const hasTransitionNote = !!item.binding?.transition_note;
      if (!sceneBoundary && !hasTransitionNote) {
        issues.push({
          level: 'warning',
          code: 'undeclared_look_change',
          storyboard_id: current.storyboard_id,
          previous_storyboard_id: previous.storyboard_id,
          character_id: item.character_id,
          from_look_id: before.look.id,
          to_look_id: item.look.id,
          message: `${item.character_name} 在同一场次内切换造型但未填写换装说明`,
        });
      }
    }
  }
  const requiredLooks = new Map();
  for (const context of contexts) {
    for (const item of context.characters) {
      if (!item.look) continue;
      const key = Number(item.look.id);
      if (!requiredLooks.has(key)) {
        requiredLooks.set(key, {
          look_id: key,
          character_id: item.character_id,
          character_name: item.character_name,
          look_name: item.look.name,
          has_reference: !!item.reference_url,
          storyboard_ids: [],
        });
      }
      requiredLooks.get(key).storyboard_ids.push(context.storyboard_id);
    }
  }
  return {
    ok: issues.every((issue) => issue.level !== 'error'),
    episode_id: Number(episode.id),
    drama_id: Number(episode.drama_id),
    checked_at: new Date().toISOString(),
    issues,
    errors: issues.filter((issue) => issue.level === 'error'),
    warnings: issues.filter((issue) => issue.level !== 'error'),
    required_looks: Array.from(requiredLooks.values()),
    contexts,
  };
}

function getEpisodeLookContext(db, episodeId) {
  const bundle = loadEpisodeContextBundle(db, episodeId);
  if (!bundle) return null;
  return {
    episode_id: Number(bundle.episode.id),
    scene_blocks: bundle.sceneBlocks,
    bindings: bundle.bindings,
    preflight: preflightEpisode(db, episodeId, bundle),
  };
}

function affectedStoryboardsForLook(db, lookId) {
  const look = characterLookService.getLookSummaryRow(db, lookId, true);
  if (!look) return [];
  const rows = db.prepare(
    `SELECT s.id
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE e.drama_id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`
  ).all(look.drama_id);
  return rows.filter((row) => {
    const context = resolveStoryboardVisualContext(db, row.id);
    return context?.characters.some((item) => Number(item.look?.id) === Number(look.id));
  }).map((row) => Number(row.id));
}

module.exports = {
  affectedStoryboardsForLook,
  generationContextHash,
  getEpisodeLookContext,
  hashObject,
  isAppearanceContextCurrent,
  preflightEpisode,
  publicMediaUrl,
  resolveStoryboardVisualContext,
  stableJson,
};

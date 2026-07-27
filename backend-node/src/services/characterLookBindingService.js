const crypto = require('crypto');
const { insertIgnoreSql, tableExists } = require('../db/portableSql');
const characterLookService = require('./characterLookService');

const VALID_SCOPES = new Set(['episode', 'scene_block', 'storyboard']);

function nowIso() {
  return new Date().toISOString();
}

function positiveId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseJson(value, fallback = []) {
  if (value == null || value === '') return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function storyboardCharacterIds(row) {
  const values = parseJson(row?.characters, []);
  if (!Array.isArray(values)) return [];
  return values
    .map((item) => positiveId(typeof item === 'object' && item != null ? item.id : item))
    .filter(Boolean);
}

function sceneBlockSignature(row) {
  return [
    row.scene_id == null ? '' : Number(row.scene_id),
    String(row.location || '').trim().toLowerCase(),
    String(row.time || '').trim().toLowerCase(),
  ].join('|');
}

function stableBlockKey(signature, occurrence) {
  const digest = crypto.createHash('sha1')
    .update(`${signature}#${occurrence}`)
    .digest('hex')
    .slice(0, 16);
  return `scene_${digest}`;
}

function ensureSceneBlocksForEpisode(db, episodeId) {
  if (!tableExists(db, 'scene_blocks')) return [];
  const episode = db.prepare(
    'SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(positiveId(episodeId));
  if (!episode) return [];
  const storyboards = db.prepare(
    `SELECT id, scene_id, location, time, storyboard_number, scene_block_id
       FROM storyboards
      WHERE episode_id = ? AND deleted_at IS NULL
      ORDER BY storyboard_number ASC, id ASC`
  ).all(episode.id);
  if (!storyboards.length) return [];

  const groups = [];
  const occurrenceBySignature = new Map();
  for (const row of storyboards) {
    const signature = sceneBlockSignature(row);
    const previous = groups.at(-1);
    if (previous && previous.signature === signature) {
      previous.storyboards.push(row);
      continue;
    }
    const occurrence = (occurrenceBySignature.get(signature) || 0) + 1;
    occurrenceBySignature.set(signature, occurrence);
    groups.push({
      signature,
      occurrence,
      stable_key: stableBlockKey(signature, occurrence),
      storyboards: [row],
    });
  }

  const now = nowIso();
  const activeIds = [];
  const claimedExistingIds = new Set();
  const existingBlocks = db.prepare(
    `SELECT * FROM scene_blocks
      WHERE episode_id = ? AND deleted_at IS NULL`
  ).all(episode.id);
  const existingById = new Map(
    existingBlocks.map((row) => [Number(row.id), row])
  );
  const existingByStableKey = new Map(
    existingBlocks.map((row) => [String(row.stable_key), row])
  );
  const tx = db.transaction(() => {
    for (let index = 0; index < groups.length; index += 1) {
      const group = groups[index];
      const first = group.storyboards[0];
      let block = null;
      const previousBlockIds = [...new Set(
        group.storyboards.map((item) => positiveId(item.scene_block_id)).filter(Boolean)
      )];
      for (const previousBlockId of previousBlockIds) {
        if (claimedExistingIds.has(previousBlockId)) continue;
        const candidate = existingById.get(Number(previousBlockId));
        if (candidate && candidate.signature === group.signature) {
          block = candidate;
          group.stable_key = candidate.stable_key;
          claimedExistingIds.add(Number(candidate.id));
          break;
        }
      }
      if (!block) {
        block = existingByStableKey.get(group.stable_key) || null;
        if (block && claimedExistingIds.has(Number(block.id))) block = null;
      }
      if (block) {
        claimedExistingIds.add(Number(block.id));
        const next = {
          drama_id: Number(episode.drama_id),
          title: `场次 ${index + 1}`,
          location: first.location || null,
          time: first.time || null,
          sort_order: index,
          signature: group.signature,
        };
        const changed =
          Number(block.drama_id) !== next.drama_id
          || String(block.title || '') !== next.title
          || String(block.location || '') !== String(next.location || '')
          || String(block.time || '') !== String(next.time || '')
          || Number(block.sort_order) !== next.sort_order
          || String(block.signature || '') !== next.signature;
        if (changed) {
          db.prepare(
            `UPDATE scene_blocks
                SET drama_id = ?, title = ?, location = ?, time = ?, sort_order = ?,
                    signature = ?, deleted_at = NULL, updated_at = ?
              WHERE id = ?`
          ).run(
            next.drama_id,
            next.title,
            next.location,
            next.time,
            next.sort_order,
            next.signature,
            now,
            block.id
          );
          Object.assign(block, next, { updated_at: now, deleted_at: null });
        }
      } else {
        const info = db.prepare(
          `INSERT INTO scene_blocks
            (drama_id, episode_id, stable_key, title, location, time, sort_order,
             signature, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          episode.drama_id,
          episode.id,
          group.stable_key,
          `场次 ${index + 1}`,
          first.location || null,
          first.time || null,
          index,
          group.signature,
          now,
          now
        );
        block = {
          id: Number(info.lastInsertRowid),
          drama_id: Number(episode.drama_id),
          episode_id: Number(episode.id),
          stable_key: group.stable_key,
          title: `场次 ${index + 1}`,
          location: first.location || null,
          time: first.time || null,
          sort_order: index,
          signature: group.signature,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        existingBlocks.push(block);
        existingById.set(Number(block.id), block);
        existingByStableKey.set(String(block.stable_key), block);
      }
      activeIds.push(Number(block.id));
      for (const storyboard of group.storyboards) {
        if (Number(storyboard.scene_block_id) !== Number(block.id)) {
          db.prepare(
            'UPDATE storyboards SET scene_block_id = ?, visual_context_stale = 1, updated_at = ? WHERE id = ?'
          ).run(block.id, now, storyboard.id);
        }
      }
    }
    for (const row of existingBlocks) {
      if (!activeIds.includes(Number(row.id))) {
        db.prepare(
          'UPDATE scene_blocks SET deleted_at = ?, updated_at = ? WHERE id = ?'
        ).run(now, now, row.id);
        db.prepare(
          `UPDATE character_look_bindings
              SET deleted_at = ?, updated_at = ?
            WHERE scope_type = 'scene_block' AND scope_id = ? AND deleted_at IS NULL`
        ).run(now, now, row.id);
      }
    }
  });
  tx();
  if (!activeIds.length) return [];
  return db.prepare(
    `SELECT * FROM scene_blocks
      WHERE episode_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`
  ).all(episode.id);
}

function resolveScope(db, scopeType, scopeId) {
  const type = String(scopeType || '').trim();
  const id = positiveId(scopeId);
  if (!VALID_SCOPES.has(type) || !id) return null;
  if (type === 'episode') {
    const row = db.prepare(
      'SELECT id, drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL'
    ).get(id);
    return row ? { scope_type: type, scope_id: id, episode_id: id, drama_id: Number(row.drama_id) } : null;
  }
  if (type === 'scene_block') {
    const row = db.prepare(
      `SELECT id, episode_id, drama_id FROM scene_blocks
        WHERE id = ? AND deleted_at IS NULL`
    ).get(id);
    return row
      ? {
        scope_type: type,
        scope_id: id,
        episode_id: Number(row.episode_id),
        drama_id: Number(row.drama_id),
      }
      : null;
  }
  const row = db.prepare(
    `SELECT s.id, s.episode_id, e.drama_id, s.characters
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`
  ).get(id);
  return row
    ? {
      scope_type: type,
      scope_id: id,
      episode_id: Number(row.episode_id),
      drama_id: Number(row.drama_id),
      character_ids: storyboardCharacterIds(row),
    }
    : null;
}

function validateBindingTarget(db, scope, characterId, lookId) {
  const character = db.prepare(
    'SELECT id, drama_id FROM characters WHERE id = ? AND deleted_at IS NULL'
  ).get(positiveId(characterId));
  const look = characterLookService.getLookRow(db, lookId);
  if (!scope) return { ok: false, error: 'scope not found' };
  if (!character || Number(character.drama_id) !== Number(scope.drama_id)) {
    return { ok: false, error: 'character not in scope drama' };
  }
  if (!look || Number(look.character_id) !== Number(character.id)
    || Number(look.drama_id) !== Number(scope.drama_id)) {
    return { ok: false, error: 'look not in scope character' };
  }
  if (scope.scope_type === 'storyboard'
    && !scope.character_ids.includes(Number(character.id))) {
    return { ok: false, error: 'character not in storyboard roster' };
  }
  return { ok: true, character, look };
}

function ensureEpisodeCharacter(db, episodeId, characterId) {
  db.prepare(insertIgnoreSql(
    db,
    'INSERT INTO episode_characters (episode_id, character_id) VALUES (?, ?)'
  )).run(episodeId, characterId);
}

function affectedStoryboardsForScope(db, scope, characterId) {
  let rows = [];
  if (scope.scope_type === 'storyboard') {
    rows = db.prepare(
      'SELECT id, characters FROM storyboards WHERE id = ? AND deleted_at IS NULL'
    ).all(scope.scope_id);
  } else if (scope.scope_type === 'scene_block') {
    rows = db.prepare(
      'SELECT id, characters FROM storyboards WHERE scene_block_id = ? AND deleted_at IS NULL'
    ).all(scope.scope_id);
  } else {
    rows = db.prepare(
      'SELECT id, characters FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL'
    ).all(scope.episode_id);
  }
  return rows
    .filter((row) => storyboardCharacterIds(row).includes(Number(characterId)))
    .map((row) => Number(row.id));
}

function markStoryboardsStale(db, ids) {
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
}

function upsertBinding(db, body = {}) {
  if (!characterLookService.hasWardrobeTables(db)) {
    return { ok: false, error: 'wardrobe tables unavailable' };
  }
  const scope = resolveScope(db, body.scope_type, body.scope_id);
  const checked = validateBindingTarget(db, scope, body.character_id, body.look_id);
  if (!checked.ok) return checked;
  const now = nowIso();
  const existing = db.prepare(
    `SELECT id FROM character_look_bindings
      WHERE scope_type = ? AND scope_id = ? AND character_id = ?`
  ).get(scope.scope_type, scope.scope_id, checked.character.id);
  const tx = db.transaction(() => {
    if (existing) {
      db.prepare(
        `UPDATE character_look_bindings
            SET drama_id = ?, episode_id = ?, look_id = ?, source = ?,
                transition_note = ?, deleted_at = NULL, updated_at = ?
          WHERE id = ?`
      ).run(
        scope.drama_id,
        scope.episode_id,
        checked.look.id,
        body.source || 'manual',
        body.transition_note || null,
        now,
        existing.id
      );
    } else {
      db.prepare(
        `INSERT INTO character_look_bindings
          (drama_id, episode_id, character_id, look_id, scope_type, scope_id,
           source, transition_note, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        scope.drama_id,
        scope.episode_id,
        checked.character.id,
        checked.look.id,
        scope.scope_type,
        scope.scope_id,
        body.source || 'manual',
        body.transition_note || null,
        now,
        now
      );
    }
    ensureEpisodeCharacter(db, scope.episode_id, checked.character.id);
    const affected = affectedStoryboardsForScope(db, scope, checked.character.id);
    markStoryboardsStale(db, affected);
    return affected;
  });
  const affected = tx();
  const row = db.prepare(
    `SELECT * FROM character_look_bindings
      WHERE scope_type = ? AND scope_id = ? AND character_id = ? AND deleted_at IS NULL`
  ).get(scope.scope_type, scope.scope_id, checked.character.id);
  return { ok: true, binding: row, affected_storyboard_ids: affected };
}

function removeBinding(db, scopeType, scopeId, characterId) {
  const scope = resolveScope(db, scopeType, scopeId);
  if (!scope) return { ok: false, error: 'scope not found' };
  const characterIdNum = positiveId(characterId);
  const row = db.prepare(
    `SELECT id FROM character_look_bindings
      WHERE scope_type = ? AND scope_id = ? AND character_id = ? AND deleted_at IS NULL`
  ).get(scope.scope_type, scope.scope_id, characterIdNum);
  if (!row) return { ok: false, error: 'binding not found' };
  const affected = affectedStoryboardsForScope(db, scope, characterIdNum);
  const now = nowIso();
  const tx = db.transaction(() => {
    db.prepare(
      'UPDATE character_look_bindings SET deleted_at = ?, updated_at = ? WHERE id = ?'
    ).run(now, now, row.id);
    markStoryboardsStale(db, affected);
  });
  tx();
  return { ok: true, affected_storyboard_ids: affected };
}

function listBindingsForEpisode(db, episodeId) {
  if (!characterLookService.hasWardrobeTables(db)) return [];
  return db.prepare(
    `SELECT b.*, l.name AS look_name, l.category AS look_category,
            l.visual_revision, c.name AS character_name
       FROM character_look_bindings b
       JOIN character_looks l ON l.id = b.look_id
       JOIN characters c ON c.id = b.character_id
      WHERE b.episode_id = ? AND b.deleted_at IS NULL
        AND l.deleted_at IS NULL AND c.deleted_at IS NULL
      ORDER BY b.character_id, b.scope_type, b.scope_id`
  ).all(positiveId(episodeId));
}

function listSceneBlocks(db, episodeId) {
  return ensureSceneBlocksForEpisode(db, episodeId);
}

module.exports = {
  VALID_SCOPES,
  affectedStoryboardsForScope,
  ensureSceneBlocksForEpisode,
  listBindingsForEpisode,
  listSceneBlocks,
  markStoryboardsStale,
  removeBinding,
  resolveScope,
  storyboardCharacterIds,
  upsertBinding,
};

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrations } = require('../src/db/migrate');
const characterLookService = require('../src/services/characterLookService');
const bindingService = require('../src/services/characterLookBindingService');
const visualContextResolver = require('../src/services/visualContextResolver');
const videoService = require('../src/services/videoService');
const dramaService = require('../src/services/dramaService');

const log = { info() {}, warn() {}, error() {} };

function createDatabase() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

function insertDrama(db, title = '衣橱测试项目') {
  const now = new Date().toISOString();
  return Number(db.prepare(
    `INSERT INTO dramas (title, style, created_at, updated_at)
     VALUES (?, 'realistic', ?, ?)`
  ).run(title, now, now).lastInsertRowid);
}

function insertEpisode(db, dramaId, episodeNumber = 1) {
  const now = new Date().toISOString();
  return Number(db.prepare(
    `INSERT INTO episodes (drama_id, episode_number, title, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(dramaId, episodeNumber, `第${episodeNumber}集`, now, now).lastInsertRowid);
}

function insertCharacter(db, dramaId, name = '林夏', extra = {}) {
  const now = new Date().toISOString();
  return Number(db.prepare(
    `INSERT INTO characters (
       drama_id, name, appearance, image_url, stages, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    dramaId,
    name,
    extra.appearance || '黑色长发，青年女性',
    extra.image_url || '/static/characters/default.png',
    extra.stages || null,
    now,
    now
  ).lastInsertRowid);
}

function insertStoryboard(db, episodeId, number, characterId, location = '客厅', time = '白天') {
  const now = new Date().toISOString();
  return Number(db.prepare(
    `INSERT INTO storyboards (
       episode_id, storyboard_number, title, location, time, characters,
       created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    episodeId,
    number,
    `镜头${number}`,
    location,
    time,
    JSON.stringify([characterId]),
    now,
    now
  ).lastInsertRowid);
}

test('wardrobe resolver applies storyboard > scene block > episode > default precedence', () => {
  const db = createDatabase();
  try {
    const dramaId = insertDrama(db);
    const episodeId = insertEpisode(db, dramaId);
    const characterId = insertCharacter(db, dramaId);
    const sb1 = insertStoryboard(db, episodeId, 1, characterId);
    const sb2 = insertStoryboard(db, episodeId, 2, characterId);
    const defaultLook = characterLookService.ensureDefaultLook(db, characterId);
    const daily = characterLookService.createLook(db, characterId, {
      name: '日常装',
      appearance: '米色针织衫',
      image_url: '/static/looks/daily.png',
    }).look;
    const battle = characterLookService.createLook(db, characterId, {
      name: '战斗装',
      appearance: '深色战术服',
      image_url: '/static/looks/battle.png',
    }).look;
    const injured = characterLookService.createLook(db, characterId, {
      name: '受伤状态',
      appearance: '战术服破损，额角有伤',
      image_url: '/static/looks/injured.png',
    }).look;

    const blocks = bindingService.ensureSceneBlocksForEpisode(db, episodeId);
    assert.equal(blocks.length, 1);
    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'episode',
      scope_id: episodeId,
      character_id: characterId,
      look_id: daily.id,
    }).ok, true);
    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'scene_block',
      scope_id: blocks[0].id,
      character_id: characterId,
      look_id: battle.id,
    }).ok, true);
    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'storyboard',
      scope_id: sb1,
      character_id: characterId,
      look_id: injured.id,
      transition_note: '本镜受伤',
    }).ok, true);

    const first = visualContextResolver.resolveStoryboardVisualContext(db, sb1);
    const second = visualContextResolver.resolveStoryboardVisualContext(db, sb2);
    assert.equal(first.characters[0].look.id, injured.id);
    assert.equal(first.characters[0].binding_source, 'storyboard');
    assert.equal(second.characters[0].look.id, battle.id);
    assert.equal(second.characters[0].binding_source, 'scene_block');

    bindingService.removeBinding(db, 'scene_block', blocks[0].id, characterId);
    const inherited = visualContextResolver.resolveStoryboardVisualContext(db, sb2);
    assert.equal(inherited.characters[0].look.id, daily.id);
    assert.equal(inherited.characters[0].binding_source, 'episode');

    bindingService.removeBinding(db, 'episode', episodeId, characterId);
    const fallback = visualContextResolver.resolveStoryboardVisualContext(db, sb2);
    assert.equal(fallback.characters[0].look.id, defaultLook.id);
    assert.equal(fallback.characters[0].binding_source, 'default');
  } finally {
    db.close();
  }
});

test('look visual revision invalidates storyboard and prompt contexts', () => {
  const db = createDatabase();
  try {
    const dramaId = insertDrama(db);
    const episodeId = insertEpisode(db, dramaId);
    const characterId = insertCharacter(db, dramaId);
    const storyboardId = insertStoryboard(db, episodeId, 1, characterId);
    const look = characterLookService.ensureDefaultLook(db, characterId);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO frame_prompts (
         storyboard_id, frame_type, prompt, context_stale, created_at, updated_at
       ) VALUES (?, 'first', '旧提示词', 0, ?, ?)`
    ).run(storyboardId, now, now);
    visualContextResolver.resolveStoryboardVisualContext(db, storyboardId, { persist: true });
    assert.equal(
      db.prepare('SELECT visual_context_stale FROM storyboards WHERE id = ?').get(storyboardId).visual_context_stale,
      0
    );

    const updated = characterLookService.updateLook(db, look.id, {
      expected_revision: look.visual_revision,
      appearance: '黑色长发，白色战损外套',
    });
    assert.equal(updated.ok, true);
    assert.equal(updated.look.visual_revision, look.visual_revision + 1);
    assert.deepEqual(updated.affected_storyboard_ids, [storyboardId]);
    assert.equal(
      db.prepare('SELECT visual_context_stale FROM storyboards WHERE id = ?').get(storyboardId).visual_context_stale,
      1
    );
    assert.equal(
      db.prepare('SELECT context_stale FROM frame_prompts WHERE storyboard_id = ?').get(storyboardId).context_stale,
      1
    );
  } finally {
    db.close();
  }
});

test('legacy stages backfill idempotently and reports overlapping episode ranges', () => {
  const db = createDatabase();
  try {
    const dramaId = insertDrama(db);
    const episode1 = insertEpisode(db, dramaId, 1);
    const episode2 = insertEpisode(db, dramaId, 2);
    const characterId = insertCharacter(db, dramaId, '周野', {
      stages: JSON.stringify([
        { name: '前期日常', appearance: '蓝色校服', episode_range: [1, 2] },
        { name: '第二集战斗', appearance: '黑色战斗服', episode_range: [2, 2] },
      ]),
    });

    const first = characterLookService.backfillAllCharacters(db, log);
    assert.equal(first.default_looks, 1);
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM character_look_bindings
          WHERE character_id = ? AND scope_type = 'episode' AND deleted_at IS NULL`
      ).get(characterId).count,
      1
    );
    assert.equal(
      db.prepare(
        `SELECT scope_id FROM character_look_bindings
          WHERE character_id = ? AND scope_type = 'episode' AND deleted_at IS NULL`
      ).get(characterId).scope_id,
      episode1
    );
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM character_look_migration_warnings
          WHERE character_id = ? AND warning_type = 'overlapping_episode_range'`
      ).get(characterId).count,
      1
    );

    characterLookService.backfillAllCharacters(db, log);
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM character_look_migration_warnings
          WHERE character_id = ? AND warning_type = 'overlapping_episode_range'`
      ).get(characterId).count,
      1
    );
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM character_look_bindings
          WHERE character_id = ? AND scope_id = ? AND deleted_at IS NULL`
      ).get(characterId, episode2).count,
      0
    );
  } finally {
    db.close();
  }
});

test('cross-project bindings are rejected and deleting the current video selects a valid fallback', () => {
  const db = createDatabase();
  try {
    const drama1 = insertDrama(db, '项目一');
    const drama2 = insertDrama(db, '项目二');
    const episode1 = insertEpisode(db, drama1);
    const episode2 = insertEpisode(db, drama2);
    const character1 = insertCharacter(db, drama1, '甲');
    const character2 = insertCharacter(db, drama2, '乙');
    const look1 = characterLookService.ensureDefaultLook(db, character1);
    characterLookService.ensureDefaultLook(db, character2);
    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'episode',
      scope_id: episode2,
      character_id: character1,
      look_id: look1.id,
    }).ok, false);

    const storyboardId = insertStoryboard(db, episode1, 1, character1);
    const now = new Date().toISOString();
    const oldVideoId = Number(db.prepare(
      `INSERT INTO video_generations (
         drama_id, storyboard_id, status, video_url, local_path, superseded,
         completed_at, created_at, updated_at
       ) VALUES (?, ?, 'completed', ?, ?, 0, ?, ?, ?)`
    ).run(
      drama1,
      storyboardId,
      'https://example.test/old.mp4',
      'videos/old.mp4',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:00:00.000Z'
    ).lastInsertRowid);
    const currentVideoId = Number(db.prepare(
      `INSERT INTO video_generations (
         drama_id, storyboard_id, status, video_url, local_path, superseded,
         completed_at, created_at, updated_at
       ) VALUES (?, ?, 'completed', ?, ?, 0, ?, ?, ?)`
    ).run(
      drama1,
      storyboardId,
      'https://example.test/current.mp4',
      'videos/current.mp4',
      now,
      now,
      now
    ).lastInsertRowid);
    db.prepare(
      `UPDATE storyboards
          SET current_video_generation_id = ?, video_url = ?, updated_at = ?
        WHERE id = ?`
    ).run(currentVideoId, 'https://example.test/current.mp4', now, storyboardId);

    assert.equal(videoService.deleteById(db, log, currentVideoId), true);
    let storyboard = db.prepare(
      'SELECT current_video_generation_id, video_url FROM storyboards WHERE id = ?'
    ).get(storyboardId);
    assert.equal(storyboard.current_video_generation_id, oldVideoId);
    assert.equal(storyboard.video_url, 'https://example.test/old.mp4');

    assert.equal(videoService.deleteById(db, log, oldVideoId), true);
    storyboard = db.prepare(
      'SELECT current_video_generation_id, video_url FROM storyboards WHERE id = ?'
    ).get(storyboardId);
    assert.equal(storyboard.current_video_generation_id, null);
    assert.equal(storyboard.video_url, null);
  } finally {
    db.close();
  }
});

test('same-scene look changes require a transition note and scene block ids stay stable', () => {
  const db = createDatabase();
  try {
    const dramaId = insertDrama(db, 'Wardrobe continuity');
    const episodeId = insertEpisode(db, dramaId);
    const characterId = insertCharacter(db, dramaId, 'Actor');
    const firstStoryboardId = insertStoryboard(db, episodeId, 1, characterId, 'Room A', 'Day');
    const secondStoryboardId = insertStoryboard(db, episodeId, 2, characterId, 'Room A', 'Day');
    const defaultLook = characterLookService.ensureDefaultLook(db, characterId);
    const changedLook = characterLookService.createLook(db, characterId, {
      name: 'Changed',
      appearance: 'Changed costume',
      image_url: '/static/looks/changed.png',
    }).look;

    const originalBlocks = bindingService.ensureSceneBlocksForEpisode(db, episodeId);
    assert.equal(originalBlocks.length, 1);
    const originalBlockId = originalBlocks[0].id;
    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'storyboard',
      scope_id: firstStoryboardId,
      character_id: characterId,
      look_id: defaultLook.id,
    }).ok, true);
    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'storyboard',
      scope_id: secondStoryboardId,
      character_id: characterId,
      look_id: changedLook.id,
    }).ok, true);

    let preflight = visualContextResolver.preflightEpisode(db, episodeId);
    assert.equal(
      preflight.warnings.some((item) =>
        item.code === 'undeclared_look_change'
        && item.storyboard_id === secondStoryboardId
      ),
      true
    );

    assert.equal(bindingService.upsertBinding(db, {
      scope_type: 'storyboard',
      scope_id: secondStoryboardId,
      character_id: characterId,
      look_id: changedLook.id,
      transition_note: 'Costume change happens on camera',
    }).ok, true);
    preflight = visualContextResolver.preflightEpisode(db, episodeId);
    assert.equal(
      preflight.warnings.some((item) => item.code === 'undeclared_look_change'),
      false
    );

    insertStoryboard(db, episodeId, 0, characterId, 'Room B', 'Night');
    const rebuiltBlocks = bindingService.ensureSceneBlocksForEpisode(db, episodeId);
    const originalStoryboard = db.prepare(
      'SELECT scene_block_id FROM storyboards WHERE id = ?'
    ).get(firstStoryboardId);
    assert.equal(originalStoryboard.scene_block_id, originalBlockId);
    assert.equal(rebuiltBlocks.some((item) => item.id === originalBlockId), true);
  } finally {
    db.close();
  }
});

test('non-default look generation status does not overwrite the character main-card status', () => {
  const db = createDatabase();
  try {
    const dramaId = insertDrama(db, 'Generation status isolation');
    const characterId = insertCharacter(db, dramaId, 'Actor');
    const defaultLook = characterLookService.ensureDefaultLook(db, characterId);
    const alternateLook = characterLookService.createLook(db, characterId, {
      name: 'Alternate',
      appearance: 'Alternate costume',
    }).look;
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO image_generations (
         drama_id, character_id, character_look_id, character_look_revision,
         status, error_msg, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'failed', 'alternate failed', ?, ?)`
    ).run(
      dramaId,
      characterId,
      alternateLook.id,
      alternateLook.visual_revision,
      now,
      now
    );

    let character = dramaService.getCharacters(db, dramaId)[0];
    assert.equal(character.image_generation_status, undefined);
    assert.equal(character.image_generation_error, undefined);

    db.prepare(
      `INSERT INTO image_generations (
         drama_id, character_id, character_look_id, character_look_revision,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'processing', ?, ?)`
    ).run(
      dramaId,
      characterId,
      defaultLook.id,
      defaultLook.visual_revision,
      new Date(Date.now() + 1000).toISOString(),
      new Date(Date.now() + 1000).toISOString()
    );
    character = dramaService.getCharacters(db, dramaId)[0];
    assert.equal(character.image_generation_status, 'processing');
  } finally {
    db.close();
  }
});

test('wardrobe APIs prefer local media paths and do not echo inline base64 images', () => {
  const db = createDatabase();
  try {
    const dramaId = insertDrama(db, 'Lightweight wardrobe media');
    const episodeId = insertEpisode(db, dramaId);
    const characterId = insertCharacter(db, dramaId, 'Actor', {
      image_url: `data:image/png;base64,${'A'.repeat(4096)}`,
    });
    db.prepare(
      'UPDATE characters SET local_path = ? WHERE id = ?'
    ).run('dramas/1/characters/actor.png', characterId);
    const storyboardId = insertStoryboard(db, episodeId, 1, characterId);
    characterLookService.ensureDefaultLook(db, characterId);

    const looks = characterLookService.listLooks(db, characterId);
    assert.equal(looks.length, 1);
    assert.equal(looks[0].image_url, null);
    assert.equal(looks[0].local_path, 'dramas/1/characters/actor.png');

    const context = visualContextResolver.resolveStoryboardVisualContext(db, storyboardId);
    assert.equal(
      context.characters[0].reference_url,
      '/static/dramas/1/characters/actor.png'
    );
    assert.equal(context.characters[0].look.image_url, null);
    assert.equal(JSON.stringify(context).includes('data:image/png;base64'), false);
  } finally {
    db.close();
  }
});

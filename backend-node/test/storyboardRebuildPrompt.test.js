const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');

test('rebuilding a storyboard video prompt uses the persisted fields without undefined helpers', () => {
  const db = new Database(':memory:');
  const log = { info() {}, warn() {}, error() {} };

  try {
    runMigrationsAndEnsure(db);

    const now = new Date().toISOString();
    const dramaId = db.prepare(`
      INSERT INTO dramas (title, style, metadata, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('测试项目', 'realistic', JSON.stringify({ aspect_ratio: '9:16' }), now, now).lastInsertRowid;
    const episodeId = db.prepare(`
      INSERT INTO episodes (drama_id, episode_number, title, created_at, updated_at)
      VALUES (?, 1, ?, ?, ?)
    `).run(dramaId, '第一集', now, now).lastInsertRowid;
    const storyboardId = db.prepare(`
      INSERT INTO storyboards (
        episode_id, storyboard_number, title, location, time, duration,
        action, result, shot_type, angle, movement, created_at, updated_at
      ) VALUES (?, 1, ?, ?, ?, 8, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      episodeId,
      '跑车甩尾',
      '大学校门口',
      '傍晚',
      '红色跑车甩尾停下',
      '跑车成为全场焦点',
      '远景',
      '平视',
      '跟镜',
      now,
      now
    ).lastInsertRowid;

    const storyboard = episodeStoryboardService.rebuildVideoPromptForStoryboard(
      db,
      log,
      storyboardId
    );

    assert.equal(storyboard.id, Number(storyboardId));
    assert.match(storyboard.video_prompt, /跑车甩尾/);
    assert.match(storyboard.video_prompt, /红色跑车甩尾停下/);
    assert.equal(
      db.prepare('SELECT video_prompt FROM storyboards WHERE id = ?').get(storyboardId).video_prompt,
      storyboard.video_prompt
    );
  } finally {
    db.close();
  }
});

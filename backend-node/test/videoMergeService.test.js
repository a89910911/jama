const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const Database = require('better-sqlite3');

const videoMergeService = require('../src/services/videoMergeService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE video_merges (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      drama_id INTEGER,
      status TEXT,
      scenes TEXT,
      merge_options TEXT,
      task_id TEXT,
      requested_by_user_id INTEGER,
      tts_config_id INTEGER,
      tts_config_revision_id INTEGER,
      merged_url TEXT,
      duration INTEGER,
      completed_at TEXT,
      error_msg TEXT,
      deleted_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      status TEXT,
      progress INTEGER,
      message TEXT,
      error TEXT,
      result TEXT,
      completed_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      video_url TEXT,
      status TEXT,
      updated_at TEXT
    );
  `);
  db.prepare('INSERT INTO episodes (id, status) VALUES (?, ?)').run(16, 'draft');
  return db;
}

function insertMerge(db, scenes, mergeOptions = {}) {
  db.prepare(
    `INSERT INTO async_tasks (id, status, progress) VALUES ('merge-task', 'pending', 0)`
  ).run();
  db.prepare(
    `INSERT INTO video_merges
      (id, episode_id, drama_id, status, scenes, merge_options, task_id, requested_by_user_id)
     VALUES (1, 16, 9, 'pending', ?, ?, 'merge-task', 1)`
  ).run(JSON.stringify(scenes), JSON.stringify(mergeOptions));
}

test('single-clip merge can complete without ffmpeg', async () => {
  const db = createDb();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-merge-test-'));
  const clip = path.join(tempDir, 'clip.mp4');
  fs.writeFileSync(clip, 'clip');
  try {
    insertMerge(db, [{ video_url: clip, duration: 5 }]);
    await videoMergeService.processVideoMerge(
      db,
      { info() {}, warn() {} },
      1,
      '',
      { ffmpegAvailable: false }
    );
    const merge = db.prepare('SELECT * FROM video_merges WHERE id = 1').get();
    const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get('merge-task');
    assert.equal(merge.status, 'completed');
    assert.equal(merge.merged_url, clip);
    assert.equal(task.status, 'completed');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('multi-clip merge fails explicitly when ffmpeg is unavailable', async () => {
  const db = createDb();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-merge-test-'));
  const first = path.join(tempDir, 'first.mp4');
  const second = path.join(tempDir, 'second.mp4');
  fs.writeFileSync(first, 'first');
  fs.writeFileSync(second, 'second');
  try {
    insertMerge(db, [
      { video_url: first, duration: 5 },
      { video_url: second, duration: 6 },
    ]);
    await videoMergeService.processVideoMerge(
      db,
      { info() {}, warn() {} },
      1,
      '',
      { ffmpegAvailable: false }
    );
    const merge = db.prepare('SELECT * FROM video_merges WHERE id = 1').get();
    const task = db.prepare('SELECT * FROM async_tasks WHERE id = ?').get('merge-task');
    const episode = db.prepare('SELECT * FROM episodes WHERE id = 16').get();
    assert.equal(merge.status, 'failed');
    assert.match(merge.error_msg, /未找到 ffmpeg/);
    assert.equal(merge.merged_url, null);
    assert.equal(task.status, 'failed');
    assert.equal(episode.video_url, null);
    assert.equal(episode.status, 'draft');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('single-clip post-processing fails explicitly when ffmpeg is unavailable', async () => {
  const db = createDb();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-merge-test-'));
  const clip = path.join(tempDir, 'clip.mp4');
  fs.writeFileSync(clip, 'clip');
  try {
    insertMerge(
      db,
      [{ video_url: clip, duration: 5 }],
      { watermark_text: 'production-test' }
    );
    await videoMergeService.processVideoMerge(
      db,
      { info() {}, warn() {} },
      1,
      '',
      { ffmpegAvailable: false }
    );
    const merge = db.prepare('SELECT * FROM video_merges WHERE id = 1').get();
    assert.equal(merge.status, 'failed');
    assert.match(merge.error_msg, /未找到 ffmpeg/);
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

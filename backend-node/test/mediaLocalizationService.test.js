const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const mediaLocalizationService = require('../src/services/mediaLocalizationService');
const uploadService = require('../src/services/uploadService');
const videoService = require('../src/services/videoService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE media_localization_jobs (
      id TEXT PRIMARY KEY,
      media_type TEXT,
      generation_type TEXT,
      generation_id INTEGER,
      source_url TEXT,
      storage_category TEXT,
      status TEXT,
      attempts INTEGER DEFAULT 0,
      max_attempts INTEGER DEFAULT 3,
      next_run_at TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      drama_id INTEGER,
      scene_id INTEGER,
      character_id INTEGER,
      character_look_id INTEGER,
      prop_id INTEGER,
      frame_type TEXT,
      size TEXT,
      provider_url TEXT,
      image_url TEXT,
      local_path TEXT,
      localize_status TEXT,
      localize_error TEXT,
      localized_at TEXT,
      status TEXT,
      superseded INTEGER DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      drama_id INTEGER,
      provider_url TEXT,
      video_url TEXT,
      local_path TEXT,
      localize_status TEXT,
      localize_error TEXT,
      localized_at TEXT,
      status TEXT,
      superseded INTEGER DEFAULT 0,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      first_frame_image_id INTEGER,
      last_frame_image_id INTEGER,
      image_url TEXT,
      local_path TEXT,
      last_frame_image_url TEXT,
      last_frame_local_path TEXT,
      current_video_generation_id INTEGER,
      video_url TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY,
      image_gen_id INTEGER,
      video_gen_id INTEGER,
      url TEXT,
      local_path TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      created_at TEXT,
      metadata TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, title, created_at, metadata)
    VALUES (7, '测试项目', '2026-01-01T00:00:00.000Z', '{}');
  `);
  return db;
}

test('image localization updates the generation row and current storyboard binding', async (t) => {
  const db = createDb();
  const sourceUrl = 'https://ai.example.test/image.png';
  db.prepare(
    `INSERT INTO image_generations
      (id, storyboard_id, drama_id, frame_type, provider_url, image_url, localize_status, status)
     VALUES (1, 10, 7, 'storyboard_first', ?, ?, 'pending', 'completed')`
  ).run(sourceUrl, sourceUrl);
  db.prepare(
    `INSERT INTO storyboards (id, first_frame_image_id, image_url)
     VALUES (10, 1, ?)`
  ).run(sourceUrl);
  db.prepare(
    `INSERT INTO media_localization_jobs
      (id, media_type, generation_type, generation_id, source_url, status, attempts, max_attempts, created_at, updated_at)
     VALUES ('job-image', 'image', 'image_generation', 1, ?, 'pending', 0, 3, '2026-01-01', '2026-01-01')`
  ).run(sourceUrl);

  const original = uploadService.downloadImageToLocal;
  uploadService.downloadImageToLocal = async () => 'projects/0007/images/ig_1.png';
  t.after(() => {
    uploadService.downloadImageToLocal = original;
    db.close();
  });

  await mediaLocalizationService.processJobById(db, { info() {}, warn() {} }, 'job-image');

  const image = db.prepare('SELECT * FROM image_generations WHERE id = 1').get();
  const storyboard = db.prepare('SELECT * FROM storyboards WHERE id = 10').get();
  const job = db.prepare('SELECT * FROM media_localization_jobs WHERE id = ?').get('job-image');

  assert.equal(image.image_url, '/static/projects/0007/images/ig_1.png');
  assert.equal(image.local_path, 'projects/0007/images/ig_1.png');
  assert.equal(image.localize_status, 'completed');
  assert.equal(storyboard.image_url, image.image_url);
  assert.equal(storyboard.local_path, image.local_path);
  assert.equal(job.status, 'completed');
});

test('image localization does not overwrite a newer storyboard selection', async (t) => {
  const db = createDb();
  const sourceUrl = 'https://ai.example.test/old.png';
  db.prepare(
    `INSERT INTO image_generations
      (id, storyboard_id, drama_id, frame_type, provider_url, image_url, localize_status, status)
     VALUES (1, 10, 7, 'storyboard_first', ?, ?, 'pending', 'completed')`
  ).run(sourceUrl, sourceUrl);
  db.prepare(
    `INSERT INTO storyboards (id, first_frame_image_id, image_url, local_path)
     VALUES (10, 2, '/static/projects/0007/images/new.png', 'projects/0007/images/new.png')`
  ).run();
  db.prepare(
    `INSERT INTO media_localization_jobs
      (id, media_type, generation_type, generation_id, source_url, status, attempts, max_attempts, created_at, updated_at)
     VALUES ('job-stale-image', 'image', 'image_generation', 1, ?, 'pending', 0, 3, '2026-01-01', '2026-01-01')`
  ).run(sourceUrl);

  const original = uploadService.downloadImageToLocal;
  uploadService.downloadImageToLocal = async () => 'projects/0007/images/old.png';
  t.after(() => {
    uploadService.downloadImageToLocal = original;
    db.close();
  });

  await mediaLocalizationService.processJobById(db, { info() {}, warn() {} }, 'job-stale-image');

  const image = db.prepare('SELECT * FROM image_generations WHERE id = 1').get();
  const storyboard = db.prepare('SELECT * FROM storyboards WHERE id = 10').get();

  assert.equal(image.image_url, '/static/projects/0007/images/old.png');
  assert.equal(storyboard.image_url, '/static/projects/0007/images/new.png');
  assert.equal(storyboard.local_path, 'projects/0007/images/new.png');
});

test('video localization updates only the current storyboard video binding', async (t) => {
  const db = createDb();
  const sourceUrl = 'https://ai.example.test/video.mp4';
  db.prepare(
    `INSERT INTO video_generations
      (id, storyboard_id, drama_id, provider_url, video_url, localize_status, status)
     VALUES (5, 20, 7, ?, ?, 'pending', 'completed')`
  ).run(sourceUrl, sourceUrl);
  db.prepare(
    `INSERT INTO storyboards (id, current_video_generation_id, video_url)
     VALUES (20, 5, ?)`
  ).run(sourceUrl);
  db.prepare(
    `INSERT INTO media_localization_jobs
      (id, media_type, generation_type, generation_id, source_url, status, attempts, max_attempts, created_at, updated_at)
     VALUES ('job-video', 'video', 'video_generation', 5, ?, 'pending', 0, 3, '2026-01-01', '2026-01-01')`
  ).run(sourceUrl);

  const original = videoService.downloadVideoToLocal;
  videoService.downloadVideoToLocal = async () => 'projects/0007/videos/vg_5.mp4';
  t.after(() => {
    videoService.downloadVideoToLocal = original;
    db.close();
  });

  await mediaLocalizationService.processJobById(db, { info() {}, warn() {} }, 'job-video');

  const video = db.prepare('SELECT * FROM video_generations WHERE id = 5').get();
  const storyboard = db.prepare('SELECT * FROM storyboards WHERE id = 20').get();

  assert.equal(video.video_url, '/static/projects/0007/videos/vg_5.mp4');
  assert.equal(video.local_path, 'projects/0007/videos/vg_5.mp4');
  assert.equal(video.localize_status, 'completed');
  assert.equal(storyboard.video_url, video.video_url);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const episodeMediaService = require('../src/services/episodeMediaService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      drama_id INTEGER,
      scene_id INTEGER,
      character_id INTEGER,
      provider TEXT,
      prompt TEXT,
      model TEXT,
      image_url TEXT,
      local_path TEXT,
      status TEXT,
      task_id TEXT,
      error_msg TEXT,
      frame_type TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      drama_id INTEGER,
      provider TEXT,
      prompt TEXT,
      model TEXT,
      image_gen_id INTEGER,
      image_url TEXT,
      video_url TEXT,
      local_path TEXT,
      status TEXT,
      task_id TEXT,
      error_msg TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );

    INSERT INTO episodes (id, deleted_at) VALUES (1, NULL), (2, NULL);
    INSERT INTO storyboards (id, episode_id, deleted_at)
    VALUES (10, 1, NULL), (11, 1, NULL), (20, 2, NULL), (12, 1, 'deleted');

    INSERT INTO image_generations
      (id, storyboard_id, drama_id, image_url, status, created_at, deleted_at)
    VALUES
      (1, 10, 1, 'old.png', 'completed', '2026-01-01T00:00:00Z', NULL),
      (2, 10, 1, 'new.png', 'completed', '2026-01-02T00:00:00Z', NULL),
      (3, 11, 1, 'second.png', 'completed', '2026-01-03T00:00:00Z', NULL),
      (4, 20, 1, 'other-episode.png', 'completed', '2026-01-04T00:00:00Z', NULL),
      (5, 12, 1, 'deleted-board.png', 'completed', '2026-01-05T00:00:00Z', NULL),
      (6, 10, 1, 'deleted-media.png', 'completed', '2026-01-06T00:00:00Z', 'deleted');

    INSERT INTO video_generations
      (id, storyboard_id, drama_id, video_url, status, created_at, deleted_at)
    VALUES
      (1, 10, 1, 'clip.mp4', 'completed', '2026-01-01T00:00:00Z', NULL),
      (2, 20, 1, 'other-episode.mp4', 'completed', '2026-01-02T00:00:00Z', NULL);
  `);
  return db;
}

test('loads and groups media for one episode in two batched queries', () => {
  const db = createDb();
  try {
    const result = episodeMediaService.getEpisodeMedia(db, 1);

    assert.equal(result.episode_id, 1);
    assert.deepEqual(
      result.images_by_storyboard['10'].map((item) => item.image_url),
      ['new.png', 'old.png']
    );
    assert.deepEqual(
      result.images_by_storyboard['11'].map((item) => item.image_url),
      ['second.png']
    );
    assert.deepEqual(
      result.videos_by_storyboard['10'].map((item) => item.video_url),
      ['clip.mp4']
    );
    assert.equal(result.images_by_storyboard['20'], undefined);
    assert.equal(result.images_by_storyboard['12'], undefined);
  } finally {
    db.close();
  }
});

test('filters requested storyboards and limits history per storyboard', () => {
  const db = createDb();
  try {
    const result = episodeMediaService.getEpisodeMedia(db, 1, {
      storyboardIds: ['10', 'not-an-id', 10],
      imageLimitPerStoryboard: 1,
    });

    assert.deepEqual(
      result.images_by_storyboard['10'].map((item) => item.image_url),
      ['new.png']
    );
    assert.equal(result.images_by_storyboard['11'], undefined);
  } finally {
    db.close();
  }
});

test('returns null for a missing episode', () => {
  const db = createDb();
  try {
    assert.equal(episodeMediaService.getEpisodeMedia(db, 999), null);
  } finally {
    db.close();
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const imageService = require('../src/services/imageService');
const videoService = require('../src/services/videoService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      status TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO image_generations (id, drama_id, status, created_at)
    VALUES
      (1, 7, 'pending', '2026-01-01T00:00:00.000Z'),
      (2, 7, 'pending', '2026-01-02T00:00:00.000Z');
    INSERT INTO video_generations (id, drama_id, status, created_at, updated_at)
    VALUES
      (1, 7, 'processing', '2026-01-01T00:00:00.000Z', '2099-01-01T00:00:00.000Z'),
      (2, 7, 'processing', '2026-01-02T00:00:00.000Z', '2099-01-01T00:00:00.000Z');
  `);
  return db;
}

test('image list returns page rows and total in one portable query shape', () => {
  const db = createDb();
  const page = imageService.list(db, {
    drama_id: 7,
    status: 'pending',
    page: 2,
    page_size: 1,
  });
  assert.equal(page.total, 2);
  assert.deepEqual(page.items.map((item) => item.id), [1]);

  const empty = imageService.list(db, { drama_id: 99, status: 'pending' });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  db.close();
});

test('video list returns page rows and total in one portable query shape', () => {
  const db = createDb();
  const page = videoService.list(db, {
    drama_id: 7,
    status: 'processing',
    page: 2,
    page_size: 1,
  });
  assert.equal(page.total, 2);
  assert.deepEqual(page.items.map((item) => item.id), [1]);

  const empty = videoService.list(db, { drama_id: 99, status: 'processing' });
  assert.equal(empty.total, 0);
  assert.deepEqual(empty.items, []);
  db.close();
});

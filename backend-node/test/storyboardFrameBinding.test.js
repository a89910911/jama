const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { bindStoryboardFrameImage } = require('../src/services/storyboardFrameBinding');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      image_url TEXT,
      local_path TEXT,
      first_frame_image_id INTEGER,
      last_frame_image_url TEXT,
      last_frame_local_path TEXT,
      last_frame_image_id INTEGER,
      error_msg TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO storyboards (id, error_msg) VALUES (1, 'read ECONNRESET');
  `);
  return db;
}

test('successful first-frame retry clears an earlier storyboard error', () => {
  const db = createDb();

  bindStoryboardFrameImage(db, 1, 'storyboard_first', 5, '/static/shot.jpg', 'images/shot.jpg');
  const row = db.prepare(
    'SELECT image_url, local_path, first_frame_image_id, error_msg FROM storyboards WHERE id = 1'
  ).get();

  assert.deepEqual(row, {
    image_url: '/static/shot.jpg',
    local_path: 'images/shot.jpg',
    first_frame_image_id: 5,
    error_msg: null,
  });
  db.close();
});

test('successful last-frame retry also clears an earlier storyboard error', () => {
  const db = createDb();

  bindStoryboardFrameImage(db, 1, 'storyboard_last', 6, '/static/tail.jpg', 'images/tail.jpg');
  const row = db.prepare(
    'SELECT last_frame_image_url, last_frame_local_path, last_frame_image_id, error_msg FROM storyboards WHERE id = 1'
  ).get();

  assert.deepEqual(row, {
    last_frame_image_url: '/static/tail.jpg',
    last_frame_local_path: 'images/tail.jpg',
    last_frame_image_id: 6,
    error_msg: null,
  });
  db.close();
});

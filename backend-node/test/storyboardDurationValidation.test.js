const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const storyboardService = require('../src/services/storyboardService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      storyboard_number INTEGER,
      duration REAL,
      status TEXT,
      characters TEXT,
      deleted_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE storyboard_props (storyboard_id INTEGER, prop_id INTEGER);
    INSERT INTO storyboards (id, episode_id, storyboard_number, duration, status)
    VALUES (1, 1, 1, 5, 'pending');
  `);
  return db;
}

const log = { info() {}, warn() {} };

test('manual storyboard updates accept only integer durations from 4 to 15', () => {
  const db = createDb();
  try {
    assert.throws(
      () => storyboardService.updateStoryboard(db, log, 1, { duration: 3 }),
      /4～15/
    );
    assert.throws(
      () => storyboardService.updateStoryboard(db, log, 1, { duration: 16 }),
      /4～15/
    );
    assert.throws(
      () => storyboardService.updateStoryboard(db, log, 1, { duration: 4.5 }),
      /整数秒/
    );

    storyboardService.updateStoryboard(db, log, 1, { duration: 15 });
    assert.equal(db.prepare('SELECT duration FROM storyboards WHERE id = 1').get().duration, 15);
  } finally {
    db.close();
  }
});

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const { setupRouter } = require('../src/routes');
const createSceneRoutes = require('../src/routes/scenes');

const log = {
  info() {},
  warn() {},
  error() {},
};

function createResponseRecorder() {
  return {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

test('registers GET /dramas/:id/scenes', () => {
  const router = setupRouter({}, {}, log);
  const route = router.stack
    .filter((layer) => layer.route)
    .find((layer) => layer.route.path === '/dramas/:id/scenes');

  assert.ok(route);
  assert.equal(route.route.methods.get, true);
});

test('lists active scenes for the requested drama', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      location TEXT,
      time TEXT,
      prompt TEXT,
      polished_prompt TEXT,
      polished_prompt_single TEXT,
      description TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );

    INSERT INTO scenes (id, drama_id, episode_id, location, deleted_at)
    VALUES
      (1, 1, 10, '客厅', NULL),
      (2, 1, 11, '天台', NULL),
      (3, 2, 12, '办公室', NULL),
      (4, 1, 10, '已删除场景', '2026-07-19T00:00:00.000Z');
  `);

  try {
    const handler = createSceneRoutes(db, log, {}).listByDrama;
    const res = createResponseRecorder();

    handler({ params: { id: '1' } }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(
      res.body.data.map(({ id, episode_id, location }) => ({ id, episode_id, location })),
      [
        { id: 1, episode_id: 10, location: '客厅' },
        { id: 2, episode_id: 11, location: '天台' },
      ]
    );
  } finally {
    db.close();
  }
});

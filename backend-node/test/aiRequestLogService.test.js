const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const aiRequestLogService = require('../src/services/aiRequestLogService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE user_accounts (
      id INTEGER PRIMARY KEY,
      username TEXT
    );
    CREATE TABLE ai_request_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      request_uuid TEXT NOT NULL UNIQUE,
      drama_id INTEGER,
      user_id INTEGER,
      service_type TEXT NOT NULL,
      operation TEXT NOT NULL,
      scene_key TEXT,
      provider TEXT,
      model TEXT,
      config_id INTEGER,
      status TEXT NOT NULL DEFAULT 'processing',
      request_payload TEXT,
      response_payload TEXT,
      error_message TEXT,
      duration_ms INTEGER,
      related_type TEXT,
      related_id TEXT,
      created_at TEXT NOT NULL,
      completed_at TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare('INSERT INTO dramas (id, title) VALUES (?, ?)').run(7, '测试项目');
  db.prepare('INSERT INTO episodes (id, drama_id) VALUES (?, ?)').run(11, 7);
  db.prepare('INSERT INTO storyboards (id, episode_id) VALUES (?, ?)').run(21, 11);
  db.prepare('INSERT INTO user_accounts (id, username) VALUES (?, ?)').run(3, 'tester');
  return db;
}

test('records a project AI request with inferred drama, redaction, and stats', () => {
  const db = createDb();
  const req = {
    headers: {},
    user: { id: 3 },
    body: {},
    query: {},
    params: { id: '21' },
    path: '/storyboards/21/polish-prompt',
  };

  let record;
  aiRequestLogService.requestContextMiddleware(req, {}, () => {
    record = aiRequestLogService.start(db, {
      service_type: 'text',
      operation: 'image_polish',
      scene_key: 'image_polish',
      provider: 'openai-compatible',
      model: 'demo-model',
      options: { storyboard_id: 21 },
      request: {
        user_prompt: '润色这个画面',
        api_key: 'must-not-be-stored',
        image: 'data:image/png;base64,AAAA',
      },
    });
    aiRequestLogService.succeed(db, record, { content: '润色结果' });
  });

  const item = aiRequestLogService.getOne(db, 7, record.id);
  assert.equal(item.drama_id, 7);
  assert.equal(item.user_id, 3);
  assert.equal(item.username, 'tester');
  assert.equal(item.status, 'succeeded');
  assert.equal(item.request_payload.api_key, '[REDACTED]');
  assert.match(item.request_payload.image, /^\[base64 image\/png,/);
  assert.equal(item.response_payload.content, '润色结果');

  const page = aiRequestLogService.list(db, 7, {
    keyword: '润色这个画面',
    service_type: 'text',
  });
  assert.equal(page.pagination.total, 1);
  assert.equal(page.items[0].request_preview, '润色这个画面');

  const stats = aiRequestLogService.stats(db, 7);
  assert.equal(stats.total, 1);
  assert.equal(stats.succeeded, 1);
  assert.equal(stats.service_counts.text, 1);
  db.close();
});

test('keeps submitted video requests processing and finalizes by related generation', () => {
  const db = createDb();
  const record = aiRequestLogService.start(db, {
    service_type: 'video',
    operation: 'video_generation',
    drama_id: 7,
    related_type: 'video_generation',
    related_id: 88,
    request: { prompt: '生成视频' },
  });
  aiRequestLogService.processing(db, record, { task_id: 'remote-1' });

  assert.equal(aiRequestLogService.getOne(db, 7, record.id).status, 'processing');
  aiRequestLogService.finishLatestRelated(db, 'video_generation', 88, {
    video_url: 'https://example.com/video.mp4',
  });
  const item = aiRequestLogService.getOne(db, 7, record.id);
  assert.equal(item.status, 'succeeded');
  assert.equal(item.response_payload.video_url, 'https://example.com/video.mp4');
  db.close();
});

test('system scope includes every project and unassigned tasks while project scope stays isolated', () => {
  const db = createDb();
  db.prepare('INSERT INTO dramas (id, title) VALUES (?, ?)').run(8, '另一个项目');

  const projectRecord = aiRequestLogService.start(db, {
    drama_id: 7,
    service_type: 'text',
    operation: 'story_generation',
    request: { prompt: '项目七' },
  });
  aiRequestLogService.succeed(db, projectRecord, { content: '完成' });

  const otherProjectRecord = aiRequestLogService.start(db, {
    drama_id: 8,
    service_type: 'image',
    operation: 'image_generation',
    request: { prompt: '项目八' },
  });
  aiRequestLogService.fail(db, otherProjectRecord, new Error('生成失败'));

  const systemRecord = aiRequestLogService.start(db, {
    service_type: 'video',
    operation: 'connection_test',
    request: { prompt: '系统任务' },
  });

  const projectPage = aiRequestLogService.list(db, 7);
  assert.equal(projectPage.pagination.total, 1);
  assert.equal(projectPage.items[0].id, projectRecord.id);
  assert.equal(projectPage.items[0].drama_title, '测试项目');

  const systemPage = aiRequestLogService.list(db, null);
  assert.equal(systemPage.pagination.total, 3);
  assert.deepEqual(
    new Set(systemPage.items.map((item) => item.id)),
    new Set([projectRecord.id, otherProjectRecord.id, systemRecord.id])
  );
  assert.equal(
    systemPage.items.find((item) => item.id === otherProjectRecord.id).drama_title,
    '另一个项目'
  );
  assert.equal(
    systemPage.items.find((item) => item.id === systemRecord.id).drama_id,
    null
  );

  const systemStats = aiRequestLogService.stats(db, null);
  assert.equal(systemStats.total, 3);
  assert.equal(systemStats.succeeded, 1);
  assert.equal(systemStats.failed, 1);
  assert.equal(systemStats.processing, 1);

  const failedPage = aiRequestLogService.list(db, null, { status: 'failed' });
  assert.equal(failedPage.pagination.total, 1);
  assert.equal(failedPage.items[0].id, otherProjectRecord.id);

  const systemDetail = aiRequestLogService.getOne(db, null, otherProjectRecord.id);
  assert.equal(systemDetail.drama_id, 8);
  assert.equal(systemDetail.drama_title, '另一个项目');
  assert.equal(aiRequestLogService.getOne(db, 7, otherProjectRecord.id), null);

  assert.equal(aiRequestLogService.clear(db, null, { status: 'failed' }), 1);
  assert.equal(aiRequestLogService.remove(db, null, systemRecord.id), true);
  assert.equal(aiRequestLogService.list(db, null).pagination.total, 1);
  assert.equal(aiRequestLogService.list(db, 7).pagination.total, 1);
  db.close();
});

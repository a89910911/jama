'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const aiClient = require('../src/services/aiClient');
const imageClient = require('../src/services/imageClient');
const assistantSettings = require('../src/services/assistantSettingsService');
const {
  ConfiguredApiRuntime,
  parseStructuredText,
  schemaErrors,
} = require('../src/integrations/assistant/configuredApiRuntime');
const {
  createSession,
  getSession,
} = require('../src/services/codexChatService');
const userAiConfigService = require('../src/services/userAiConfigService');

const TEST_USER_ID = 1;
const userConfigSchema = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '39_user_ai_configs.sql'),
  'utf8'
);
const userPreferenceSchema = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '41_user_ai_preferences.sql'),
  'utf8'
);

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT NOT NULL DEFAULT 'text',
      provider TEXT DEFAULT '',
      api_protocol TEXT DEFAULT '',
      name TEXT DEFAULT '',
      base_url TEXT DEFAULT '',
      api_key TEXT,
      model TEXT,
      default_model TEXT,
      endpoint TEXT,
      query_endpoint TEXT,
      priority INTEGER DEFAULT 0,
      is_default INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1,
      settings TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      description TEXT,
      genre TEXT,
      style TEXT,
      metadata TEXT,
      total_episodes INTEGER,
      total_duration INTEGER,
      status TEXT,
      thumbnail TEXT,
      tags TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_number INTEGER,
      title TEXT,
      script_content TEXT,
      deleted_at TEXT
    );
    CREATE TABLE codex_chat_sessions (
      id TEXT PRIMARY KEY,
      drama_id INTEGER NOT NULL,
      episode_id INTEGER,
      user_id INTEGER,
      engine TEXT,
      codex_thread_id TEXT,
      title TEXT,
      status TEXT,
      last_message_at TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  db.exec(userConfigSchema);
  db.exec(userPreferenceSchema);
  db.prepare("INSERT INTO dramas (id, title) VALUES (1, '双引擎测试')").run();
  return db;
}

function insertConfig(db, serviceType, options = {}) {
  return userAiConfigService.createConfig(db, log, TEST_USER_ID, {
    service_type: serviceType,
    provider: options.provider || `${serviceType}-provider`,
    name: options.name || serviceType,
    base_url: 'https://example.com',
    api_key: 'test-key',
    model: [options.model || `${serviceType}-model`],
    default_model: options.model || `${serviceType}-model`,
    priority: 10,
    is_default: true,
    is_active: options.active !== false,
  }).id;
}

const log = {
  info() {},
  warn() {},
  error() {},
};

describe('AI assistant engine settings and session snapshots', () => {
  it('defaults to configured APIs and reports each configured capability independently', () => {
    const db = createTestDb();
    assert.equal(
      assistantSettings.getAssistantEngine(db, TEST_USER_ID),
      assistantSettings.ENGINE_CONFIGURED_API
    );
    insertConfig(db, 'text');
    insertConfig(db, 'image', { active: false });

    const status = assistantSettings.getConfiguredApiStatus(db, TEST_USER_ID);
    assert.equal(status.available, true);
    assert.equal(status.text.available, true);
    assert.equal(status.image.available, false);
    assert.equal(status.storyboard_image.available, false);
  });

  it('captures the selected engine when a conversation is created', () => {
    const db = createTestDb();
    assistantSettings.setAssistantEngine(
      db,
      assistantSettings.ENGINE_CONFIGURED_API,
      TEST_USER_ID
    );
    const apiSession = createSession(db, { drama_id: 1, user_id: TEST_USER_ID });

    assistantSettings.setAssistantEngine(db, assistantSettings.ENGINE_CODEX, TEST_USER_ID);
    const codexSession = createSession(db, { drama_id: 1, user_id: TEST_USER_ID });

    assert.equal(apiSession.engine, assistantSettings.ENGINE_CONFIGURED_API);
    assert.equal(codexSession.engine, assistantSettings.ENGINE_CODEX);
    assert.equal(
      getSession(db, apiSession.id, TEST_USER_ID).engine,
      assistantSettings.ENGINE_CONFIGURED_API
    );
  });

  it('keeps legacy conversations on Codex when their engine is null', () => {
    const db = createTestDb();
    db.prepare(`
      INSERT INTO codex_chat_sessions
        (id, drama_id, engine, title, status, created_at, updated_at)
      VALUES ('legacy', 1, NULL, '旧会话', 'active', '2026-07-24', '2026-07-24')
    `).run();
    assert.equal(getSession(db, 'legacy').engine, assistantSettings.ENGINE_CODEX);
  });
});

describe('Configured API assistant runtime', () => {
  it('validates structured output and retries one malformed response', async () => {
    const db = createTestDb();
    insertConfig(db, 'text');
    const original = aiClient.generateText;
    let calls = 0;
    aiClient.generateText = async () => {
      calls += 1;
      return calls === 1
        ? '{"answer":7}'
        : '{"answer":"已修正"}';
    };
    try {
      const runtime = new ConfiguredApiRuntime({ db, log, userId: TEST_USER_ID });
      const result = await runtime.runTurn({
        taskId: 'structured-1',
        text: '返回答案',
        outputSchema: {
          type: 'object',
          required: ['answer'],
          properties: { answer: { type: 'string', minLength: 1 } },
        },
      });
      assert.equal(calls, 2);
      assert.deepEqual(JSON.parse(result.text), { answer: '已修正' });
    } finally {
      aiClient.generateText = original;
    }
  });

  it('falls back when a text provider does not support response_format', async () => {
    const db = createTestDb();
    insertConfig(db, 'text');
    const original = aiClient.generateText;
    const jsonModes = [];
    aiClient.generateText = async (_db, _log, _type, _user, _system, options) => {
      jsonModes.push(options.json_mode);
      if (options.json_mode) throw new Error('response_format is unsupported');
      return '{"answer":"兼容成功"}';
    };
    try {
      const runtime = new ConfiguredApiRuntime({ db, log, userId: TEST_USER_ID });
      const result = await runtime.runTurn({
        taskId: 'structured-2',
        text: '返回答案',
        outputSchema: {
          type: 'object',
          required: ['answer'],
          properties: { answer: { type: 'string' } },
        },
      });
      assert.deepEqual(jsonModes, [true, false]);
      assert.equal(JSON.parse(result.text).answer, '兼容成功');
    } finally {
      aiClient.generateText = original;
    }
  });

  it('routes storyboard images only through storyboard_image configuration', async () => {
    const db = createTestDb();
    insertConfig(db, 'image', { provider: 'normal-image', model: 'normal-model' });
    insertConfig(db, 'storyboard_image', {
      provider: 'storyboard-image',
      model: 'storyboard-model',
    });
    const original = imageClient.callImageApi;
    let captured = null;
    imageClient.callImageApi = async (_db, _log, options) => {
      captured = options;
      return { image_url: 'data:image/png;base64,aGVsbG8=' };
    };
    try {
      const runtime = new ConfiguredApiRuntime({ db, log, userId: TEST_USER_ID });
      const result = await runtime.runTurn({
        taskId: 'image-1',
        text: 'ignored',
        imageRequest: {
          prompt: '分镜画面',
          dramaId: 1,
          imageServiceType: 'storyboard_image',
          referenceImages: ['projects/1/images/character.png'],
          sceneKey: 'storyboard_image_generation',
        },
      });
      assert.equal(captured.imageServiceType, 'storyboard_image');
      assert.equal(captured.preferred_provider, 'storyboard-image');
      assert.equal(captured.model, 'storyboard-model');
      assert.equal(captured.scene_key, undefined);
      assert.equal(result.images[0].provider, 'storyboard-image');
    } finally {
      imageClient.callImageApi = original;
    }
  });

  it('rejects malformed structured values with useful paths', () => {
    const schema = {
      type: 'object',
      required: ['items'],
      properties: {
        items: {
          type: 'array',
          minItems: 1,
          items: { type: 'integer', minimum: 1 },
        },
      },
    };
    assert.deepEqual(schemaErrors({ items: [0] }, schema), ['$.items[0] 不能小于 1']);
    assert.throws(
      () => parseStructuredText('{"items":[]}', schema),
      /至少需要 1 项/
    );
  });
});

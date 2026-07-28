'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const authService = require('../src/services/authService');
const userAiConfigService = require('../src/services/userAiConfigService');
const userAiConfigResolver = require('../src/services/userAiConfigResolver');

const migration39 = fs.readFileSync(
  path.join(__dirname, '..', 'migrations', '39_user_ai_configs.sql'),
  'utf8'
);
const log = { info() {}, warn() {}, error() {} };

function createConfigDb() {
  const db = new Database(':memory:');
  db.exec(migration39);
  return db;
}

function createLegacyConfigDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT,
      provider TEXT,
      api_protocol TEXT,
      name TEXT,
      base_url TEXT,
      api_key TEXT,
      model TEXT,
      default_model TEXT,
      endpoint TEXT,
      query_endpoint TEXT,
      priority INTEGER,
      is_default INTEGER,
      is_active INTEGER,
      settings TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE ai_model_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT,
      service_type TEXT,
      config_id INTEGER,
      model_override TEXT,
      description TEXT
    );
  `);
  db.exec(migration39);
  return db;
}

function countPreparedStatements(db) {
  const stats = { count: 0 };
  return {
    stats,
    database: {
      dialect: 'sqlite',
      prepare(sql) {
        stats.count += 1;
        return db.prepare(sql);
      },
      transaction(callback) {
        return db.transaction(callback);
      },
    },
  };
}

function createTextConfig(db, userId, name, apiKey, secretKey) {
  return userAiConfigService.createConfig(db, log, userId, {
    service_type: 'text',
    name,
    provider: 'openai',
    base_url: `https://${name}.example.test/v1`,
    api_key: apiKey,
    model: ['model-a', 'model-b'],
    default_model: 'model-a',
    is_default: true,
    settings: JSON.stringify({
      max_tokens: 4096,
      secret_access_key: secretKey,
    }),
  });
}

test('removed SD2 service types are rejected and hidden from legacy personal configs', () => {
  for (const serviceType of ['jimeng2_character_auth', 'model_ark_asset']) {
    assert.throws(
      () => userAiConfigService.normalizeServiceType(serviceType),
      { code: 'INVALID_SERVICE_TYPE' }
    );
  }

  const db = createConfigDb();
  const config = createTextConfig(db, 101, 'legacy-sd2', 'key', 'secret');
  db.prepare('UPDATE user_ai_configs SET service_type = ? WHERE id = ?')
    .run('model_ark_asset', config.id);

  assert.equal(userAiConfigService.getRuntimeConfig(db, 101, config.id), null);
  assert.deepEqual(userAiConfigService.listRuntimeConfigs(db, 101), []);
})

test('personal AI configs isolate owners, store plaintext server-side, and mask browser DTOs', () => {
  const db = createConfigDb();
  const alice = createTextConfig(db, 101, 'alice', 'alice-plain-key', 'alice-plain-secret');
  const bob = createTextConfig(db, 202, 'bob', 'bob-plain-key', 'bob-plain-secret');

  const aliceRevision = db.prepare(
    'SELECT api_key, credentials_json, settings_json FROM user_ai_config_revisions WHERE id = ?'
  ).get(alice.revision_id);
  assert.equal(aliceRevision.api_key, 'alice-plain-key');
  assert.equal(
    JSON.parse(aliceRevision.credentials_json).secret_access_key,
    'alice-plain-secret'
  );
  assert.deepEqual(JSON.parse(aliceRevision.settings_json), { max_tokens: 4096 });

  const browserRow = userAiConfigService.getConfig(db, 101, alice.id);
  assert.equal(Object.hasOwn(browserRow, 'api_key'), false);
  assert.equal(browserRow.settings.includes('alice-plain-secret'), false);
  assert.equal(browserRow.credentials.api_key.configured, true);
  assert.match(browserRow.credentials.api_key.mask, /^••••/);
  assert.equal(browserRow.credentials.secret_access_key.configured, true);

  assert.equal(userAiConfigService.getConfig(db, 101, bob.id), null);
  assert.equal(userAiConfigService.getRuntimeConfig(db, 202, alice.id), null);
  assert.deepEqual(
    userAiConfigService.listConfigs(db, 101).map((item) => item.id),
    [alice.id]
  );
  assert.equal(
    userAiConfigResolver.resolveForExecution(db, {
      userId: 101,
      serviceType: 'text',
    }).config.id,
    alice.id
  );
  assert.equal(
    userAiConfigResolver.resolveForExecution(db, {
      userId: 202,
      serviceType: 'text',
    }).config.id,
    bob.id
  );
  assert.throws(
    () => userAiConfigResolver.resolveForExecution(db, {
      userId: 202,
      serviceType: 'text',
      explicitConfigId: alice.id,
    }),
    (error) => error.code === 'AI_CONFIG_NOT_FOUND'
  );
  db.close();
});

test('updates create immutable revisions and pinned executions keep the original plaintext credentials', () => {
  const db = createConfigDb();
  const created = createTextConfig(db, 101, 'alice', 'revision-one-key', 'revision-one-secret');
  const originalRevisionId = created.revision_id;

  const updated = userAiConfigService.updateConfig(db, log, 101, created.id, {
    api_key: 'revision-two-key',
    credential_updates: { secret_access_key: 'revision-two-secret' },
    default_model: 'model-b',
  });
  assert.equal(updated.revision_no, 2);
  assert.notEqual(updated.revision_id, originalRevisionId);

  const original = userAiConfigService.getRuntimeConfigByRevision(
    db,
    101,
    created.id,
    originalRevisionId
  );
  const current = userAiConfigService.getRuntimeConfig(db, 101, created.id);
  assert.equal(original.api_key, 'revision-one-key');
  assert.equal(original.credentials.secret_access_key, 'revision-one-secret');
  assert.equal(original.default_model, 'model-a');
  assert.equal(current.api_key, 'revision-two-key');
  assert.equal(current.credentials.secret_access_key, 'revision-two-secret');
  assert.equal(current.default_model, 'model-b');
  assert.equal(
    db.prepare(
      'SELECT COUNT(*) AS count FROM user_ai_config_revisions WHERE config_id = ?'
    ).get(created.id).count,
    2
  );
  db.close();
});

test('legacy shared configs migrate once to the super admin owner and are then disabled', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE ai_service_configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service_type TEXT,
      provider TEXT,
      api_protocol TEXT,
      name TEXT,
      base_url TEXT,
      api_key TEXT,
      model TEXT,
      default_model TEXT,
      endpoint TEXT,
      query_endpoint TEXT,
      priority INTEGER,
      is_default INTEGER,
      is_active INTEGER,
      settings TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE ai_model_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT,
      service_type TEXT,
      config_id INTEGER,
      model_override TEXT,
      description TEXT
    );
  `);
  db.exec(migration39);
  const legacyId = Number(db.prepare(`
    INSERT INTO ai_service_configs
      (service_type, provider, name, base_url, api_key, model, default_model,
       priority, is_default, is_active, created_at, updated_at)
    VALUES ('text', 'openai', 'legacy', 'https://legacy.example.test/v1',
            'legacy-plain-key', '["legacy-model"]', 'legacy-model',
            10, 1, 1, '2026-01-01', '2026-01-01')
  `).run().lastInsertRowid);
  db.prepare(`
    INSERT INTO ai_model_map
      (key, service_type, config_id, model_override, description)
    VALUES ('story.generate', 'text', ?, 'legacy-model', 'legacy scene')
  `).run(legacyId);

  const result = userAiConfigService.migrateLegacyConfigs(db, log, 1);
  assert.deepEqual(result, { migrated: 1, scene_maps: 1, skipped: false });
  const migrated = userAiConfigService.getRuntimeConfig(
    db,
    1,
    userAiConfigService.listConfigs(db, 1)[0].id
  );
  assert.equal(migrated.api_key, 'legacy-plain-key');
  assert.equal(
    db.prepare('SELECT deleted_at FROM ai_service_configs WHERE id = ?').get(legacyId)
      .deleted_at != null,
    true
  );
  assert.equal(userAiConfigService.migrateLegacyConfigs(db, log, 1).skipped, true);
  db.close();
});

test('legacy shared configs are migrated with a constant number of database statements', () => {
  const db = createLegacyConfigDb();
  const insertConfig = db.prepare(`
    INSERT INTO ai_service_configs
      (service_type, provider, name, base_url, api_key, model, default_model,
       priority, is_default, is_active, created_at, updated_at)
    VALUES (?, 'openai', ?, 'https://legacy.example.test/v1', ?,
            '["legacy-model"]', 'legacy-model', ?, ?, 1, '2026-01-01', '2026-01-01')
  `);
  const serviceTypes = ['text', 'image', 'storyboard_image', 'video'];
  const legacyIds = [];
  for (let index = 0; index < 12; index += 1) {
    legacyIds.push(Number(insertConfig.run(
      serviceTypes[index % serviceTypes.length],
      `legacy-${index}`,
      `key-${index}`,
      index,
      index < serviceTypes.length ? 1 : 0
    ).lastInsertRowid));
  }
  const insertMap = db.prepare(`
    INSERT INTO ai_model_map
      (key, service_type, config_id, model_override, description)
    VALUES (?, 'text', ?, 'legacy-model', 'legacy scene')
  `);
  for (let index = 0; index < 4; index += 1) {
    insertMap.run(`story.generate.${index}`, legacyIds[index]);
  }

  const counted = countPreparedStatements(db);
  const result = userAiConfigService.migrateLegacyConfigs(
    counted.database,
    log,
    1
  );
  assert.deepEqual(result, { migrated: 12, scene_maps: 4, skipped: false });
  assert.ok(
    counted.stats.count <= 12,
    `expected at most 12 prepared statements, got ${counted.stats.count}`
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM user_ai_configs').get().count,
    12
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM user_ai_config_revisions').get().count,
    12
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM user_ai_scene_model_maps').get().count,
    4
  );
  assert.equal(
    db.prepare('SELECT COUNT(*) AS count FROM user_ai_config_defaults').get().count,
    4
  );
  db.close();
});

test('deleting an account purges its plaintext AI credentials', () => {
  const db = createConfigDb();
  authService.ensureAuthSystem(db);
  const user = authService.createAccount(db, 'credential_owner', 'secret123');
  const config = createTextConfig(
    db,
    user.id,
    'deletable',
    'delete-me-api-key',
    'delete-me-secret'
  );

  authService.deleteAccount(db, user.id);
  const revision = db.prepare(
    'SELECT api_key, credentials_json FROM user_ai_config_revisions WHERE id = ?'
  ).get(config.revision_id);
  assert.equal(revision.api_key, '');
  assert.deepEqual(JSON.parse(revision.credentials_json), {});
  assert.equal(
    db.prepare('SELECT deleted_at FROM user_ai_configs WHERE id = ?').get(config.id)
      .deleted_at != null,
    true
  );
  db.close();
});

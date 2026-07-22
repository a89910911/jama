'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const aiConfigService = require('../src/services/aiConfigService');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
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
  `);
  return db;
}

function insertConfig(db, { serviceType, name, isDefault = false }) {
  return Number(db.prepare(
    `INSERT INTO ai_service_configs
      (service_type, provider, name, base_url, model, is_default, is_active, created_at, updated_at)
     VALUES (?, 'test', ?, 'https://example.com', '["model"]', ?, 1, '2026-01-01', '2026-01-01')`
  ).run(serviceType, name, isDefault ? 1 : 0).lastInsertRowid);
}

describe('aiConfigService.setDefaultConfig', () => {
  it('switches the default only within the target service type', () => {
    const db = createTestDb();
    const oldTextId = insertConfig(db, { serviceType: 'text', name: 'old text', isDefault: true });
    const newTextId = insertConfig(db, { serviceType: 'text', name: 'new text' });
    const imageId = insertConfig(db, { serviceType: 'image', name: 'image', isDefault: true });

    const result = aiConfigService.setDefaultConfig(db, { info() {} }, newTextId);

    assert.equal(result.id, newTextId);
    assert.equal(result.is_default, true);
    assert.equal(aiConfigService.getConfig(db, oldTextId).is_default, false);
    assert.equal(aiConfigService.getConfig(db, imageId).is_default, true);
  });

  it('returns null without changing defaults when the config does not exist', () => {
    const db = createTestDb();
    const textId = insertConfig(db, { serviceType: 'text', name: 'text', isDefault: true });

    assert.equal(aiConfigService.setDefaultConfig(db, { info() {} }, 999), null);
    assert.equal(aiConfigService.getConfig(db, textId).is_default, true);
  });
});

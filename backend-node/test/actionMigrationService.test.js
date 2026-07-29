const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  buildPrompt,
  buildNegativePrompt,
  configCapability,
  ACTION_MIGRATION_INSERT_SQL,
  ACTION_MIGRATION_VIDEO_INSERT_SQL,
  syncVideoGenerationResult,
  buildStructureFilter,
} = require('../src/services/actionMigrationService');

describe('action migration prompt builder', () => {
  it('separates motion source from reference identity', () => {
    const prompt = buildPrompt('identity', 'red dress, rainy street');

    assert.match(prompt, /action migration/i);
    assert.match(prompt, /driving video only for body pose/i);
    assert.match(prompt, /reference image for identity/i);
    assert.match(prompt, /Replace the original actor/i);
    assert.match(prompt, /red dress, rainy street/);
  });

  it('includes default failure suppressors in the negative prompt', () => {
    const negative = buildNegativePrompt('low quality');

    assert.match(negative, /^low quality,/);
    assert.match(negative, /original actor face/);
    assert.match(negative, /identity drift/);
    assert.match(negative, /distorted hands/);
    assert.match(negative, /watermark/);
  });
});

describe('action migration model capability', () => {
  it('allows configured video protocols that accept source_video_url', () => {
    assert.equal(configCapability({ api_protocol: 'volcengine_omni', model: 'seedance' }).ok, true);
    assert.equal(configCapability({ provider: 'mediabridge', model: 'seedance-2-0' }).ok, true);
  });

  it('blocks video models that cannot consume a driving video', () => {
    const result = configCapability({ api_protocol: 'kling_omni', model: 'kling-v2' });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported_reference_video');
    assert.match(result.message, /不支持动作迁移驱动视频/);
  });
});

describe('action migration job persistence', () => {
  it('keeps the insert placeholders aligned with the 22 bound values', () => {
    assert.equal((ACTION_MIGRATION_INSERT_SQL.match(/\?/g) || []).length, 22);
  });

  it('keeps video-generation insert placeholders aligned with the 20 bound values', () => {
    assert.equal((ACTION_MIGRATION_VIDEO_INSERT_SQL.match(/\?/g) || []).length, 20);
  });

  it('reconciles a processing video without recursively loading the same job', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE video_generations (
        id INTEGER PRIMARY KEY,
        action_migration_job_id TEXT,
        status TEXT,
        deleted_at TEXT
      );
      CREATE TABLE action_migration_jobs (
        id TEXT PRIMARY KEY,
        current_video_generation_id INTEGER,
        deleted_at TEXT
      );
      CREATE TABLE action_migration_results (
        id INTEGER PRIMARY KEY,
        job_id TEXT,
        video_generation_id INTEGER,
        deleted_at TEXT
      );
      INSERT INTO video_generations
        (id, action_migration_job_id, status)
        VALUES (7, 'am_test', 'processing');
      INSERT INTO action_migration_jobs
        (id, current_video_generation_id)
        VALUES ('am_test', 7);
      INSERT INTO action_migration_results
        (id, job_id, video_generation_id)
        VALUES (9, 'am_test', 7);
    `);

    try {
      const row = syncVideoGenerationResult(db, {}, 7);
      assert.equal(row.id, 'am_test');
      assert.equal(row.current_video_generation_id, 7);
    } finally {
      db.close();
    }
  });
});

describe('action migration structure filter', () => {
  it('uses a bounded chroma blur radius for tiny structure frames', () => {
    for (const mode of ['identity', 'balanced', 'motion']) {
      const filter = buildStructureFilter(mode);
      assert.match(filter, /boxblur=\d+:1:2:1/);
      assert.match(filter, /^scale=\d+:-2,/);
    }
  });
});

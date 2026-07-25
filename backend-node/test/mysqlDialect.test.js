const test = require('node:test');
const assert = require('node:assert/strict');
const { translateSqliteSqlToMysql } = require('../src/db/sqlDialect');

test('translates SQLite insert conflict clauses to MySQL', () => {
  assert.equal(
    translateSqliteSqlToMysql(
      'INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)'
    ),
    'INSERT IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)'
  );
  assert.equal(
    translateSqliteSqlToMysql(
      'INSERT OR REPLACE INTO image_proxy_cache (cache_key, proxy_url) VALUES (?, ?)'
    ),
    'REPLACE INTO image_proxy_cache (cache_key, proxy_url) VALUES (?, ?)'
  );
  assert.match(
    translateSqliteSqlToMysql(`
      INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `),
    /ON DUPLICATE KEY UPDATE value = VALUES\(`value`\), updated_at = VALUES\(`updated_at`\)/
  );
});

test('quotes reserved key columns without changing literals or duplicate-key syntax', () => {
  const translated = translateSqliteSqlToMysql(
    "SELECT key FROM global_settings WHERE key = 'key'"
  );
  assert.equal(translated, "SELECT `key` FROM global_settings WHERE `key` = 'key'");
});

test('translates SQLite metadata and date expressions', () => {
  assert.match(
    translateSqliteSqlToMysql('PRAGMA table_info(character_libraries)'),
    /information_schema\.COLUMNS/
  );
  assert.match(
    translateSqliteSqlToMysql(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video_generations'"
    ),
    /information_schema\.TABLES/
  );
  assert.equal(
    translateSqliteSqlToMysql(
      "updated_at >= datetime('now', '-5 minutes')"
    ),
    'updated_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)'
  );
  assert.equal(
    translateSqliteSqlToMysql('id INTEGER PRIMARY KEY AUTOINCREMENT'),
    'id INTEGER PRIMARY KEY AUTO_INCREMENT'
  );
  assert.equal(
    translateSqliteSqlToMysql('id TEXT PRIMARY KEY'),
    'id VARCHAR(191) PRIMARY KEY'
  );
  assert.equal(
    translateSqliteSqlToMysql('cache_key TEXT NOT NULL UNIQUE'),
    'cache_key VARCHAR(191) NOT NULL UNIQUE'
  );
});

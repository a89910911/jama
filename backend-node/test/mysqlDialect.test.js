const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { translateSqliteSqlToMysql } = require('../src/db/sqlDialect');
const { addMysqlTextIndexPrefixes } = require('../src/db/mysql');
const { splitSqlStatements } = require('../src/db/migrate');

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
  assert.match(
    translateSqliteSqlToMysql(
      'INSERT INTO global_settings (key, value) VALUES (?, ?) ' +
      'ON DUPLICATE KEY UPDATE `value` = VALUES(`value`)'
    ),
    /ON DUPLICATE KEY UPDATE/
  );
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
  assert.equal(
    translateSqliteSqlToMysql("content TEXT NOT NULL DEFAULT ''"),
    "content LONGTEXT NOT NULL DEFAULT ('')"
  );
});

test('adds safe prefix lengths when MySQL indexes text columns', () => {
  const database = {
    query(sql, values) {
      assert.match(sql, /information_schema\.COLUMNS/);
      assert.deepEqual(values, ['ai_request_logs']);
      return [
        { name: 'drama_id', data_type: 'bigint' },
        { name: 'created_at', data_type: 'longtext' },
      ];
    },
  };
  assert.equal(
    addMysqlTextIndexPrefixes(
      database,
      'CREATE INDEX idx_logs ON ai_request_logs (drama_id, created_at DESC)'
    ),
    'CREATE INDEX idx_logs ON ai_request_logs (drama_id, created_at(191) DESC)'
  );
});

test('all migration statements translate without SQLite-only syntax', () => {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const forbidden = [
    /\bAUTOINCREMENT\b/i,
    /\bCOLLATE\s+NOCASE\b/i,
    /\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/i,
    /\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b/i,
    /\bON\s+CONFLICT\s*\(/i,
    /\bAS\s+TEXT\b/i,
    /\|\|/,
  ];
  const violations = [];
  for (const file of fs.readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'))) {
    const source = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const statements = splitSqlStatements(source);
    statements.forEach((statement, index) => {
      const translated = translateSqliteSqlToMysql(statement);
      forbidden.forEach((pattern) => {
        if (pattern.test(translated)) violations.push(`${file}#${index + 1}: ${pattern}`);
      });
    });
  }
  assert.deepEqual(violations, []);
});

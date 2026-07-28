const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');

const {
  allTableColumns,
  insertIgnoreSql,
  insertRow,
  readBatch,
  replaceIntoSql,
  tableColumns,
  tableExists,
  upsertSql,
} = require('../src/db/portableSql');
const { listMessages } = require('../src/services/codexChatService');

test('builds native conflict SQL for MySQL and SQLite', () => {
  const mysql = { dialect: 'mysql' };
  const sqlite = { dialect: 'sqlite' };
  const insert = 'INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)';

  assert.match(insertIgnoreSql(mysql, insert), /^INSERT IGNORE INTO/);
  assert.match(insertIgnoreSql(sqlite, insert), /^INSERT OR IGNORE INTO/);
  assert.match(replaceIntoSql(mysql, insert), /^REPLACE INTO/);
  assert.match(replaceIntoSql(sqlite, insert), /^INSERT OR REPLACE INTO/);
  assert.match(
    upsertSql(mysql, insert, ['key'], ['value', 'updated_at']),
    /ON DUPLICATE KEY UPDATE `value` = VALUES\(`value`\)/
  );
  assert.match(
    upsertSql(sqlite, insert, ['key'], ['value', 'updated_at']),
    /ON CONFLICT\(key\) DO UPDATE SET value = excluded\.value/
  );
});

test('portable schema helpers and conflict statements work with SQLite', () => {
  const db = new Database(':memory:');
  db.dialect = 'sqlite';
  db.exec(`
    CREATE TABLE demo (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT NOT NULL UNIQUE,
      value TEXT
    )
  `);

  assert.equal(tableExists(db, 'demo'), true);
  assert.equal(tableExists(db, 'missing_demo'), false);
  assert.deepEqual(
    tableColumns(db, 'demo').map((column) => column.name),
    ['id', 'code', 'value']
  );

  const insert = 'INSERT INTO demo (code, value) VALUES (?, ?)';
  db.prepare(insertIgnoreSql(db, insert)).run('one', 'first');
  db.prepare(insertIgnoreSql(db, insert)).run('one', 'ignored');
  assert.equal(db.prepare('SELECT value FROM demo WHERE code = ?').get('one').value, 'first');

  db.prepare(upsertSql(db, insert, ['code'], ['value'])).run('one', 'updated');
  assert.equal(db.prepare('SELECT value FROM demo WHERE code = ?').get('one').value, 'updated');
  assert.deepEqual(
    readBatch(db, [
      { mode: 'get', sql: 'SELECT value FROM demo WHERE code = ?', values: ['one'] },
      { sql: 'SELECT code FROM demo ORDER BY code' },
    ]),
    [{ value: 'updated' }, [{ code: 'one' }]]
  );
  db.close();
});

test('insertRow derives placeholders from the row shape', () => {
  const db = new Database(':memory:');
  db.exec('CREATE TABLE generated_records (id INTEGER PRIMARY KEY, status TEXT, task_id TEXT)');

  const result = insertRow(db, 'generated_records', {
    id: 7,
    status: 'processing',
    task_id: 'task-7',
  });
  assert.equal(result.changes, 1);
  assert.deepEqual(
    db.prepare('SELECT * FROM generated_records WHERE id = 7').get(),
    { id: 7, status: 'processing', task_id: 'task-7' }
  );
  assert.throws(
    () => insertRow(db, 'unsafe table', { id: 1 }),
    /Invalid table name/
  );
  db.close();
});

test('loads all MySQL column metadata in one information_schema query', () => {
  let queryCount = 0;
  const mysql = {
    dialect: 'mysql',
    prepare(sql) {
      queryCount += 1;
      assert.match(sql, /information_schema\.COLUMNS/);
      return {
        all() {
          return [
            { table_name: 'characters', name: 'id', type: 'int', notnull: 1, pk: 1 },
            { table_name: 'characters', name: 'name', type: 'text', notnull: 0, pk: 0 },
            { table_name: 'dramas', name: 'id', type: 'int', notnull: 1, pk: 1 },
          ];
        },
      };
    },
  };

  const columns = allTableColumns(mysql);
  assert.equal(queryCount, 1);
  assert.deepEqual(columns.get('characters').map((column) => column.name), ['id', 'name']);
  assert.deepEqual(columns.get('dramas').map((column) => column.name), ['id']);
});

test('chat messages use a cross-database deterministic order', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE codex_chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT,
      content_type TEXT,
      content TEXT,
      action_type TEXT,
      status TEXT,
      task_id TEXT,
      codex_turn_id TEXT,
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    )
  `);
  const insert = db.prepare(`
    INSERT INTO codex_chat_messages
      (id, session_id, role, content, status, created_at)
    VALUES (?, 'session-1', 'user', ?, 'completed', '2026-07-26T00:00:00.000Z')
  `);
  insert.run('b-message', 'second');
  insert.run('a-message', 'first');

  assert.deepEqual(
    listMessages(db, 'session-1').map((message) => message.id),
    ['a-message', 'b-message']
  );
  db.close();
});

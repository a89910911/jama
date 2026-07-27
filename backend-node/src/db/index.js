const path = require('path');
const fs = require('fs');
const { MysqlDatabase } = require('./mysql');
const { guardSqliteDatabase } = require('./dataUrlPersistenceGuard');

let db = null;

function getDb(config) {
  if (db) return db;
  if (String(config.type || '').toLowerCase() === 'mysql') {
    db = new MysqlDatabase(config);
    return db;
  }
  const Database = require('better-sqlite3');
  const dbPath = config.path;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(dbPath, {
    verbose: config.type === 'sqlite' && process.env.DEBUG ? console.log : undefined,
  });
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.dialect = 'sqlite';
  db = guardSqliteDatabase(sqlite);
  return db;
}

function closeDb() {
  if (db) {
    db.close();
    db = null;
  }
}

module.exports = { getDb, closeDb };

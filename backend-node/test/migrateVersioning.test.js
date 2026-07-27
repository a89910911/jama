const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runMigrations } = require('../src/db/migrate');

class FakeDatabase {
  constructor() {
    this.execs = [];
    this.rows = [];
  }

  exec(sql) {
    this.execs.push(sql);
  }

  prepare(sql) {
    if (sql.includes('SELECT version, name, checksum, applied_at FROM schema_migrations')) {
      return {
        all: () => [...this.rows].sort((a, b) => a.version - b.version),
      };
    }
    if (sql.includes('INSERT INTO schema_migrations')) {
      return {
        run: (version, name, checksum, appliedAt) => {
          this.rows.push({ version, name, checksum, applied_at: appliedAt });
          return { changes: 1 };
        },
      };
    }
    throw new Error(`Unexpected SQL in fake database: ${sql}`);
  }
}

test('records migrations by version and skips them on the next startup pass', () => {
  const migrationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-migrations-'));
  fs.writeFileSync(path.join(migrationsDir, '01_init.sql'), 'CREATE TABLE demo (id INTEGER);');
  fs.writeFileSync(path.join(migrationsDir, '02_add_name.sql'), 'ALTER TABLE demo ADD COLUMN name TEXT;');

  const db = new FakeDatabase();
  const first = runMigrations(db, { migrationsDir });
  assert.deepEqual(first.applied, [1, 2]);
  assert.deepEqual(db.rows.map((row) => row.version), [1, 2]);
  assert.deepEqual(db.rows.map((row) => row.name), ['01_init.sql', '02_add_name.sql']);

  const businessExecs = () => db.execs.filter((sql) => !sql.includes('schema_migrations')).length;
  const firstBusinessExecCount = businessExecs();
  const second = runMigrations(db, { migrationsDir });
  assert.deepEqual(second.applied, []);
  assert.equal(db.rows.length, 2);
  assert.equal(businessExecs(), firstBusinessExecCount);
  assert.equal(
    db.execs.filter((sql) => sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')).length,
    0
  );
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { runStartupMaintenanceJob } = require('../src/db/migrate');

const log = { info() {}, warn() {} };

test('startup maintenance jobs execute once per persisted version', () => {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE startup_maintenance (
      job_key TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      completed_at TEXT NOT NULL,
      details TEXT
    )
  `);
  let executions = 0;
  const jobV1 = { key: 'test_job', version: 1 };
  const versions = new Map();

  const first = runStartupMaintenanceJob(db, versions, jobV1, log, () => {
    executions += 1;
    return { execution: executions };
  });
  assert.equal(first.executed, true);
  assert.equal(executions, 1);

  const persistedVersions = new Map(
    db.prepare('SELECT job_key, version FROM startup_maintenance').all()
      .map((row) => [row.job_key, Number(row.version)])
  );
  const second = runStartupMaintenanceJob(db, persistedVersions, jobV1, log, () => {
    executions += 1;
  });
  assert.equal(second.executed, false);
  assert.equal(executions, 1);

  const upgraded = runStartupMaintenanceJob(
    db,
    persistedVersions,
    { key: 'test_job', version: 2 },
    log,
    () => {
      executions += 1;
      return { execution: executions };
    }
  );
  assert.equal(upgraded.executed, true);
  assert.equal(executions, 2);
  assert.equal(
    db.prepare('SELECT version FROM startup_maintenance WHERE job_key = ?')
      .get('test_job').version,
    2
  );
  db.close();
});

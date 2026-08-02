const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getDb, closeDb } = require('./index.js');
const { loadConfig } = require('../config/index.js');
const { upsertSql } = require('./portableSql');

// Increment a job version only when its callback must run again for every database.
// A completed version is persisted in startup_maintenance and skipped on later boots.
const STARTUP_MAINTENANCE_JOBS = Object.freeze({
  legacyAiConfigs: { key: 'legacy_ai_configs', version: 1 },
});

function stripLeadingComments(sql) {
  return sql
    .split('\n')
    .filter((line) => {
      const t = line.trim();
      return t.length > 0 && !t.startsWith('--');
    })
    .join('\n')
    .trim();
}

function checksum(sql) {
  return crypto.createHash('sha256').update(sql).digest('hex');
}

function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (!quote && (char === "'" || char === '"' || char === '`')) {
      quote = char;
      current += char;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) {
        if (sql[i + 1] === quote) {
          current += sql[i + 1];
          i += 1;
        } else if (sql[i - 1] !== '\\') {
          quote = null;
        }
      }
      continue;
    }
    if (char === ';') {
      if (current.trim()) statements.push(current.trim() + ';');
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

function parseMigrationFile(file) {
  const match = file.match(/^(\d+)_([\s\S]+)\.sql$/);
  if (!match) {
    throw new Error(`Invalid migration filename "${file}". Expected NN_name.sql`);
  }
  return {
    version: Number(match[1]),
    name: match[2],
  };
}

function ensureMigrationTable(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    )
  `);
}

function isMissingTableError(error) {
  const message = String(error?.message || '').toLowerCase();
  return error?.errno === 1146
    || error?.code === 'ER_NO_SUCH_TABLE'
    || message.includes('no such table')
    || message.includes("doesn't exist");
}

function getAppliedMigrations(database) {
  let rows;
  try {
    rows = database.prepare(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
    ).all();
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    ensureMigrationTable(database);
    rows = database.prepare(
      'SELECT version, name, checksum, applied_at FROM schema_migrations ORDER BY version ASC'
    ).all();
  }
  return new Map(rows.map((row) => [Number(row.version), row]));
}

function recordMigration(database, migration) {
  database.prepare(
    'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)'
  ).run(migration.version, migration.file, migration.checksum, new Date().toISOString());
}

function runOne(database, sql, file, index) {
  const s = stripLeadingComments(sql);
  if (!s) return;
  try {
    database.exec(s);
    console.log('Ran migration:', file + (index >= 0 ? ' #' + (index + 1) : ''));
  } catch (err) {
    const msg = (err.message || '').toLowerCase();
    if (
      (err.code === 'SQLITE_ERROR' && (msg.includes('duplicate column') || msg.includes('already exists'))) ||
      msg.includes('duplicate column') ||
      msg.includes('already exists') ||
      msg.includes('duplicate key name') ||
      err.errno === 1050 ||
      err.errno === 1060 ||
      err.errno === 1061
    ) {
      console.log('Skip (already exists):', file + (index >= 0 ? ' #' + (index + 1) : ''));
    } else if ((err.code === 'SQLITE_ERROR' && msg.includes('no such table')) || err.errno === 1146) {
      console.warn('Skip migration (table not found):', file, '-', err.message);
    } else {
      throw err;
    }
  }
}

function runMigrations(database, options = {}) {
  const migrationsDir = options.migrationsDir || path.join(__dirname, '..', '..', 'migrations');
  if (!fs.existsSync(migrationsDir)) {
    console.log('Migrations dir missing, skipping:', migrationsDir);
    return { applied: [], total: 0 };
  }
  const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const applied = getAppliedMigrations(database);
  const appliedNow = [];
  for (const file of files) {
    const fullPath = path.join(migrationsDir, file);
    const sql = fs.readFileSync(fullPath, 'utf8');
    const migration = {
      ...parseMigrationFile(file),
      file,
      checksum: checksum(sql),
    };
    const appliedRow = applied.get(migration.version);
    if (appliedRow) {
      if (appliedRow.checksum !== migration.checksum) {
        console.warn(
          `Migration checksum changed for version ${migration.version} (${file}); keeping recorded version.`
        );
      }
      continue;
    }
    const statements = splitSqlStatements(sql);
    if (statements.length <= 1) {
      runOne(database, sql, file, -1);
    } else {
      statements.forEach((stmt, i) => runOne(database, stmt, file, i));
    }
    if (migration.version === 38) {
      const promptTemplates = require('../services/promptTemplateService');
      const installed = promptTemplates.installPromptCatalog(database);
      console.log('Installed current prompt catalog:', installed);
    }
    recordMigration(database, migration);
    appliedNow.push(migration.version);
    console.log('Recorded migration:', `${migration.version} ${file}`);
  }
  return { applied: appliedNow, total: files.length };
}

function ensureStartupMaintenanceTable(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS startup_maintenance (
    job_key TEXT PRIMARY KEY,
    version INTEGER NOT NULL,
    completed_at TEXT NOT NULL,
    details TEXT
  )`);
}

function getStartupMaintenanceVersions(database) {
  let rows;
  try {
    rows = database.prepare(
      'SELECT job_key, version, completed_at, details FROM startup_maintenance'
    ).all();
  } catch (error) {
    if (!isMissingTableError(error)) throw error;
    ensureStartupMaintenanceTable(database);
    rows = [];
  }
  return new Map(rows.map((row) => [String(row.job_key), Number(row.version)]));
}

function recordStartupMaintenance(database, job, details) {
  const sql = upsertSql(
    database,
    `INSERT INTO startup_maintenance (job_key, version, completed_at, details)
     VALUES (?, ?, ?, ?)`,
    ['job_key'],
    ['version', 'completed_at', 'details']
  );
  database.prepare(sql).run(
    job.key,
    job.version,
    new Date().toISOString(),
    details == null ? null : JSON.stringify(details)
  );
}

function runStartupMaintenanceJob(database, versions, job, log, callback, options = {}) {
  const startedAt = Date.now();
  const currentVersion = Number(versions.get(job.key) || 0);
  if (currentVersion >= job.version) {
    log?.info?.('Startup maintenance checked', {
      job: job.key,
      version: job.version,
      executed: false,
      duration_ms: Date.now() - startedAt,
    });
    return { executed: false, version: currentVersion };
  }
  try {
    const details = callback();
    recordStartupMaintenance(database, job, details);
    versions.set(job.key, job.version);
    log?.info?.('Startup maintenance complete', {
      job: job.key,
      version: job.version,
      executed: true,
      duration_ms: Date.now() - startedAt,
    });
    return { executed: true, version: job.version, details };
  } catch (error) {
    log?.warn?.('Startup maintenance failed', {
      job: job.key,
      version: job.version,
      duration_ms: Date.now() - startedAt,
      error: error.message,
    });
    if (options.fatal !== false) throw error;
    return { executed: false, version: currentVersion, error: error.message };
  }
}

function main() {
  const config = loadConfig();
  const database = getDb(config.database);
  try {
    runMigrations(database);
    console.log('Migrations complete.');
  } finally {
    closeDb();
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  STARTUP_MAINTENANCE_JOBS,
  splitSqlStatements,
  runMigrations,
  getStartupMaintenanceVersions,
  runStartupMaintenanceJob,
};

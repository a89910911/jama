const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_DATABASE_TYPE,
  resolveDatabaseType,
} = require('../src/config');
const {
  ensureCharacterLookMysqlTextCapacity,
} = require('../src/db/migrate');

test('server and source development default to MySQL', () => {
  assert.equal(DEFAULT_DATABASE_TYPE, 'mysql');
  assert.equal(resolveDatabaseType({}, {}), 'mysql');
  assert.equal(resolveDatabaseType({ type: 'mysql' }, {}), 'mysql');
});

test('packaged desktop mode always selects SQLite', () => {
  assert.equal(
    resolveDatabaseType(
      { type: 'mysql' },
      { JAMA_DESKTOP_PACKAGED: '1', JAMA_DB_TYPE: 'mysql' }
    ),
    'sqlite'
  );
});

test('explicit database type remains available outside packaged desktop mode', () => {
  assert.equal(
    resolveDatabaseType({ type: 'mysql' }, { JAMA_DB_TYPE: 'sqlite' }),
    'sqlite'
  );
});

test('default backend commands load the local MySQL environment file', () => {
  const packageJson = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')
  );
  for (const scriptName of ['start', 'dev', 'migrate']) {
    assert.match(
      packageJson.scripts[scriptName],
      /--env-file=\.env\.mysql\.test(?:\s|$)/,
      `${scriptName} must load .env.mysql.test`
    );
  }
});

test('MySQL wardrobe image fields are widened without running SQLite-only DDL', () => {
  const execs = [];
  const mysql = {
    dialect: 'mysql',
    prepare() {
      return {
        all() {
          return [
            { name: 'image_url', type: 'text' },
            { name: 'appearance', type: 'longtext' },
          ];
        },
      };
    },
    exec(sql) {
      execs.push(sql);
    },
  };
  assert.deepEqual(ensureCharacterLookMysqlTextCapacity(mysql), ['image_url']);
  assert.deepEqual(execs, [
    'ALTER TABLE `character_looks` MODIFY COLUMN `image_url` LONGTEXT NULL',
  ]);

  const sqlite = {
    dialect: 'sqlite',
    prepare() {
      throw new Error('SQLite metadata should not be queried');
    },
  };
  assert.deepEqual(ensureCharacterLookMysqlTextCapacity(sqlite), []);
});

test('business SQL does not contain SQLite-only query syntax', () => {
  const sourceRoot = path.join(__dirname, '..', 'src');
  const roots = ['routes', 'services'];
  const files = [];
  for (const root of roots) {
    const directory = path.join(sourceRoot, root);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.js')) {
        files.push(path.join(directory, entry.name));
      }
    }
  }

  const forbidden = [
    /\browid\b/i,
    /\blast_insert_rowid\s*\(/i,
    /\bINSERT\s+OR\s+(?:IGNORE|REPLACE)\b/i,
    /\bON\s+CONFLICT\s*\(/i,
    /\bCOLLATE\s+NOCASE\b/i,
    /\bdatetime\s*\(\s*['"]now['"]/i,
    /\bsqlite_master\b/i,
    /\bPRAGMA\s+table_info\b/i,
  ];
  const violations = [];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of forbidden) {
      if (pattern.test(source)) {
        violations.push(`${path.relative(sourceRoot, file)}: ${pattern}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

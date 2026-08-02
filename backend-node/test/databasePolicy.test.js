const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const {
  DEFAULT_DATABASE_TYPE,
  resolveDatabaseType,
  resolveInsecureTls,
} = require('../src/config');

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

test('TLS verification stays enabled by default and test-only override is explicit', () => {
  assert.equal(resolveInsecureTls({}, {}), false);
  assert.equal(resolveInsecureTls({ insecure_tls: false }, {}), false);
  assert.equal(resolveInsecureTls({ insecure_tls: true }, {}), true);
  assert.equal(
    resolveInsecureTls({ insecure_tls: false }, { JAMA_INSECURE_TLS: '1' }),
    true
  );
  assert.equal(
    resolveInsecureTls({ insecure_tls: true }, { JAMA_INSECURE_TLS: '0' }),
    false
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

function readEnvFile(name) {
  const source = fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
  return Object.fromEntries(
    source
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [line.slice(0, index), line.slice(index + 1)];
      })
  );
}

test('MySQL environments use jama-test with only host differing for server deploys', () => {
  const local = readEnvFile('.env.mysql.test');
  const server = readEnvFile('.env.mysql.prod');

  assert.equal(local.JAMA_DB_NAME, 'jama-test');
  assert.equal(server.JAMA_DB_NAME, 'jama-test');
  assert.equal(local.JAMA_DB_USER, 'jama-test');
  assert.equal(server.JAMA_DB_USER, 'jama-test');
  assert.equal(local.JAMA_DB_HOST, '101.35.214.179');
  assert.equal(server.JAMA_DB_HOST, '127.0.0.1');
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

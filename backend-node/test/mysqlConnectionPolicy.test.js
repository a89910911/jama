const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isReadOnlySql,
  isRecoverableConnectionError,
} = require('../src/db/mysqlConnectionPolicy');

test('recognizes stale MySQL connection failures that can be reconnected', () => {
  for (const code of [
    'PROTOCOL_CONNECTION_LOST',
    'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
    'ECONNRESET',
    'EPIPE',
    'ETIMEDOUT',
  ]) {
    assert.equal(isRecoverableConnectionError({ code }), true, code);
  }
  assert.equal(
    isRecoverableConnectionError({
      message: "Can't add new command when connection is in closed state",
    }),
    true
  );
  assert.equal(isRecoverableConnectionError({ code: 'ER_BAD_FIELD_ERROR' }), false);
});

test('only read-only SQL is eligible for an automatic retry', () => {
  assert.equal(isReadOnlySql('SELECT * FROM characters'), true);
  assert.equal(isReadOnlySql('  /* context */ SHOW FULL PROCESSLIST'), true);
  assert.equal(isReadOnlySql('-- context\nDESCRIBE character_looks'), true);
  assert.equal(isReadOnlySql('EXPLAIN SELECT 1'), true);
  assert.equal(isReadOnlySql('UPDATE characters SET name = ?'), false);
  assert.equal(isReadOnlySql('INSERT INTO character_looks (name) VALUES (?)'), false);
  assert.equal(isReadOnlySql('WITH changed AS (SELECT 1) DELETE FROM characters'), false);
});

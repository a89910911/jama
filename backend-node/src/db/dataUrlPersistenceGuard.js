const { isReadOnlySql } = require('./mysqlConnectionPolicy');
const {
  assertNoDataUrls,
  containsDataUrl,
} = require('../services/localMediaService');

function assertSafeWrite(sql, values) {
  if (isReadOnlySql(sql)) return;
  assertNoDataUrls(values, 'executing a database write');
  if (containsDataUrl(sql)) {
    const error = new Error(
      'Base64 data URLs must not be embedded in database write SQL'
    );
    error.code = 'BASE64_PERSISTENCE_BLOCKED';
    throw error;
  }
}

function guardSqliteStatement(statement, sql) {
  if (isReadOnlySql(sql)) return statement;
  return new Proxy(statement, {
    get(target, property) {
      if (property === 'run') {
        return (...values) => {
          assertSafeWrite(sql, values);
          return target.run(...values);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function guardSqliteDatabase(database) {
  return new Proxy(database, {
    get(target, property) {
      if (property === 'prepare') {
        return (sql) => guardSqliteStatement(target.prepare(sql), sql);
      }
      if (property === 'exec') {
        return (sql) => {
          assertSafeWrite(sql, []);
          return target.exec(sql);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) {
      return Reflect.set(target, property, value, target);
    },
  });
}

module.exports = {
  assertSafeWrite,
  guardSqliteDatabase,
};

function isMysql(database) {
  return String(database?.dialect || '').toLowerCase() === 'mysql';
}

function assertIdentifier(identifier, label = 'SQL identifier') {
  const value = String(identifier || '');
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid ${label}: ${identifier}`);
  }
  return value;
}

function insertIgnoreSql(database, insertSql) {
  const keyword = isMysql(database) ? 'INSERT IGNORE INTO' : 'INSERT OR IGNORE INTO';
  return String(insertSql).replace(/\bINSERT\s+INTO\b/i, keyword);
}

function replaceIntoSql(database, insertSql) {
  const keyword = isMysql(database) ? 'REPLACE INTO' : 'INSERT OR REPLACE INTO';
  return String(insertSql).replace(/\bINSERT\s+INTO\b/i, keyword);
}

function upsertSql(database, insertSql, conflictColumns, updateColumns) {
  const conflicts = (conflictColumns || []).map((column) =>
    assertIdentifier(column, 'conflict column')
  );
  const updates = (updateColumns || []).map((column) =>
    assertIdentifier(column, 'update column')
  );
  if (!conflicts.length) throw new Error('At least one conflict column is required');
  if (!updates.length) throw new Error('At least one update column is required');

  if (isMysql(database)) {
    const assignments = updates
      .map((column) => `\`${column}\` = VALUES(\`${column}\`)`)
      .join(', ');
    return `${String(insertSql).trim()} ON DUPLICATE KEY UPDATE ${assignments}`;
  }

  const assignments = updates
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  return `${String(insertSql).trim()} ON CONFLICT(${conflicts.join(', ')}) DO UPDATE SET ${assignments}`;
}

function tableColumns(database, table) {
  const safeTable = assertIdentifier(table, 'table name');
  if (isMysql(database)) {
    return database.prepare(
      `SELECT
         COLUMN_NAME AS name,
         COLUMN_TYPE AS type,
         CASE WHEN IS_NULLABLE = 'NO' THEN 1 ELSE 0 END AS notnull,
         COLUMN_DEFAULT AS dflt_value,
         CASE WHEN COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS pk
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       ORDER BY ORDINAL_POSITION`
    ).all(safeTable);
  }
  return database.prepare(`PRAGMA table_info(${safeTable})`).all();
}

function allTableColumns(database) {
  if (!isMysql(database)) return null;
  const rows = database.prepare(
    `SELECT
       TABLE_NAME AS table_name,
       COLUMN_NAME AS name,
       COLUMN_TYPE AS type,
       CASE WHEN IS_NULLABLE = 'NO' THEN 1 ELSE 0 END AS notnull,
       COLUMN_DEFAULT AS dflt_value,
       CASE WHEN COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS pk
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME, ORDINAL_POSITION`
  ).all();
  const byTable = new Map();
  for (const row of rows) {
    const tableName = String(row.table_name || '');
    if (!byTable.has(tableName)) byTable.set(tableName, []);
    byTable.get(tableName).push({
      name: row.name,
      type: row.type,
      notnull: row.notnull,
      dflt_value: row.dflt_value,
      pk: row.pk,
    });
  }
  return byTable;
}

function tableExists(database, table) {
  const safeTable = assertIdentifier(table, 'table name');
  if (isMysql(database)) {
    return !!database.prepare(
      `SELECT 1
       FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?
       LIMIT 1`
    ).get(safeTable);
  }
  return !!database.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1"
  ).get(safeTable);
}

function readBatch(database, statements) {
  const requests = (Array.isArray(statements) ? statements : []).map((statement) => ({
    sql: String(statement?.sql || ''),
    values: Array.isArray(statement?.values) ? statement.values : [],
    mode: statement?.mode === 'get' ? 'get' : 'all',
  }));
  if (!requests.length) return [];

  if (typeof database?.readBatch === 'function') {
    const results = database.readBatch(
      requests.map(({ sql, values }) => ({ sql, values }))
    );
    return requests.map((request, index) => {
      const rows = Array.isArray(results?.[index]) ? results[index] : [];
      return request.mode === 'get' ? rows[0] : rows;
    });
  }

  return requests.map((request) => {
    const statement = database.prepare(request.sql);
    return request.mode === 'get'
      ? statement.get(...request.values)
      : statement.all(...request.values);
  });
}

module.exports = {
  allTableColumns,
  insertIgnoreSql,
  isMysql,
  readBatch,
  replaceIntoSql,
  tableColumns,
  tableExists,
  upsertSql,
};

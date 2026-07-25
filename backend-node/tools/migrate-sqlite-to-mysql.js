const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const mysql = require('mysql2/promise');
const { loadConfig } = require('../src/config');

function parseArgs(argv) {
  const options = {
    replace: false,
    verifyOnly: false,
    source: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--replace') options.replace = true;
    else if (argv[i] === '--verify-only') options.verifyOnly = true;
    else if (argv[i] === '--source') options.source = argv[++i];
    else throw new Error(`Unknown argument: ${argv[i]}`);
  }
  return options;
}

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function getSourcePath(config, options) {
  const configured = options.source || process.env.JAMA_SQLITE_SOURCE || config.database.path;
  if (!configured) throw new Error('SQLite source path is missing; use --source or JAMA_SQLITE_SOURCE');
  return path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
}

function getSchema(sqlite) {
  const tableRows = sqlite.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all();
  return tableRows.map(({ name }) => {
    const columns = sqlite.prepare(`PRAGMA table_info(${quoteIdentifier(name)})`).all();
    const primaryKey = columns
      .filter((column) => column.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((column) => column.name);
    const indexes = sqlite.prepare(`PRAGMA index_list(${quoteIdentifier(name)})`).all()
      .map((index) => ({
        ...index,
        columns: sqlite
          .prepare(`PRAGMA index_info(${quoteIdentifier(index.name)})`)
          .all()
          .sort((a, b) => a.seqno - b.seqno)
          .map((column) => column.name),
      }))
      .filter((index) => index.columns.length > 0);
    const indexedColumns = new Set([
      ...primaryKey,
      ...indexes.flatMap((index) => index.columns),
    ]);
    const foreignKeys = sqlite.prepare(`PRAGMA foreign_key_list(${quoteIdentifier(name)})`).all();
    return { name, columns, primaryKey, indexes, indexedColumns, foreignKeys };
  });
}

function mysqlType(column, table) {
  const sqliteType = String(column.type || '').toUpperCase();
  if (sqliteType.includes('INT')) return 'BIGINT';
  if (sqliteType.includes('REAL') || sqliteType.includes('FLOA') || sqliteType.includes('DOUB')) {
    return 'DOUBLE';
  }
  if (sqliteType.includes('BLOB')) return 'LONGBLOB';
  if (table.indexedColumns.has(column.name)) return 'VARCHAR(191)';
  return 'LONGTEXT';
}

function mysqlDefault(column, type) {
  if (column.dflt_value == null) return '';
  const value = String(column.dflt_value).trim();
  if (!value) return '';
  if (type === 'LONGTEXT' || type === 'LONGBLOB') return ` DEFAULT (${value})`;
  return ` DEFAULT ${value}`;
}

function buildCreateTable(table) {
  const autoIncrementColumn =
    table.primaryKey.length === 1 &&
    String(table.columns.find((column) => column.name === table.primaryKey[0])?.type || '')
      .toUpperCase()
      .includes('INT')
      ? table.primaryKey[0]
      : null;
  const definitions = table.columns.map((column) => {
    const type = mysqlType(column, table);
    const required = column.notnull || column.pk ? ' NOT NULL' : '';
    const autoIncrement = column.name === autoIncrementColumn ? ' AUTO_INCREMENT' : '';
    const defaultValue = autoIncrement ? '' : mysqlDefault(column, type);
    return `  ${quoteIdentifier(column.name)} ${type}${required}${defaultValue}${autoIncrement}`;
  });
  if (table.primaryKey.length) {
    definitions.push(
      `  PRIMARY KEY (${table.primaryKey.map(quoteIdentifier).join(', ')})`
    );
  }
  return [
    `CREATE TABLE ${quoteIdentifier(table.name)} (`,
    definitions.join(',\n'),
    ') ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci',
  ].join('\n');
}

function buildIndexes(table) {
  const primarySignature = table.primaryKey.join('\0');
  const seen = new Set(primarySignature ? [primarySignature] : []);
  const indexes = [...table.indexes].sort((a, b) => {
    if (a.origin === b.origin) return a.name.localeCompare(b.name);
    return a.origin === 'c' ? -1 : 1;
  });
  const statements = [];
  let generatedIndex = 0;
  for (const index of indexes) {
    if (index.origin === 'pk') continue;
    const signature = index.columns.join('\0');
    if (seen.has(signature)) continue;
    seen.add(signature);
    generatedIndex += 1;
    const rawName = index.name.startsWith('sqlite_autoindex_')
      ? `${index.unique ? 'uq' : 'idx'}_${table.name}_${generatedIndex}`
      : index.name;
    const name = rawName.slice(0, 64);
    statements.push(
      `CREATE ${index.unique ? 'UNIQUE ' : ''}INDEX ${quoteIdentifier(name)} ` +
      `ON ${quoteIdentifier(table.name)} (${index.columns.map(quoteIdentifier).join(', ')})`
    );
  }
  return statements;
}

function buildForeignKeys(table) {
  const grouped = new Map();
  for (const foreignKey of table.foreignKeys) {
    if (!grouped.has(foreignKey.id)) grouped.set(foreignKey.id, []);
    grouped.get(foreignKey.id).push(foreignKey);
  }
  const statements = [];
  for (const [id, rows] of grouped) {
    rows.sort((a, b) => a.seq - b.seq);
    const name = `fk_${table.name}_${id}`.slice(0, 64);
    statements.push(
      `ALTER TABLE ${quoteIdentifier(table.name)} ` +
      `ADD CONSTRAINT ${quoteIdentifier(name)} ` +
      `FOREIGN KEY (${rows.map((row) => quoteIdentifier(row.from)).join(', ')}) ` +
      `REFERENCES ${quoteIdentifier(rows[0].table)} ` +
      `(${rows.map((row) => quoteIdentifier(row.to)).join(', ')})`
    );
  }
  return statements;
}

function estimateRowBytes(row) {
  let bytes = 0;
  for (const value of Object.values(row)) {
    if (value == null) continue;
    if (Buffer.isBuffer(value)) bytes += value.length;
    else bytes += Buffer.byteLength(String(value));
  }
  return bytes;
}

async function targetTables(connection) {
  const [rows] = await connection.query(`
    SELECT TABLE_NAME AS name
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
    ORDER BY TABLE_NAME
  `);
  return rows.map((row) => row.name);
}

async function createTargetSchema(connection, schema, replace) {
  const sourceNames = new Set(schema.map((table) => table.name));
  const existing = await targetTables(connection);
  const existingSourceTables = existing.filter((name) => sourceNames.has(name));
  if (existingSourceTables.length && !replace) {
    throw new Error(
      `Target database already contains ${existingSourceTables.length} source tables. ` +
      'Re-run with --replace after taking a backup.'
    );
  }

  await connection.query('SET FOREIGN_KEY_CHECKS = 0');
  if (replace) {
    for (const table of [...existingSourceTables, 'jama_mysql_meta']) {
      await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(table)}`);
    }
  }
  for (const table of schema) {
    await connection.query(buildCreateTable(table));
  }
  for (const table of schema) {
    for (const statement of buildIndexes(table)) await connection.query(statement);
  }
  for (const table of schema) {
    for (const statement of buildForeignKeys(table)) await connection.query(statement);
  }
}

async function copyTable(sqlite, connection, table) {
  const columnNames = table.columns.map((column) => column.name);
  const selectSql = `SELECT ${columnNames.map(quoteIdentifier).join(', ')} ` +
    `FROM ${quoteIdentifier(table.name)}`;
  const insertSql = `INSERT INTO ${quoteIdentifier(table.name)} ` +
    `(${columnNames.map(quoteIdentifier).join(', ')}) VALUES ` +
    `(${columnNames.map(() => '?').join(', ')})`;
  const sourceRows = sqlite.prepare(selectSql).iterate();
  let copied = 0;
  let transactionBytes = 0;
  let transactionOpen = false;

  const begin = async () => {
    if (!transactionOpen) {
      await connection.beginTransaction();
      transactionOpen = true;
      transactionBytes = 0;
    }
  };
  const commit = async () => {
    if (transactionOpen) {
      await connection.commit();
      transactionOpen = false;
      transactionBytes = 0;
    }
  };

  try {
    await begin();
    for (const row of sourceRows) {
      const values = columnNames.map((column) => row[column]);
      await connection.execute(insertSql, values);
      copied += 1;
      transactionBytes += estimateRowBytes(row);
      if (transactionBytes >= 16 * 1024 * 1024) {
        await commit();
        await begin();
      }
      if (copied % 50 === 0) {
        process.stdout.write(`\r  ${table.name}: ${copied} rows`);
      }
    }
    await commit();
  } catch (error) {
    if (transactionOpen) await connection.rollback();
    throw error;
  }
  if (copied >= 50) process.stdout.write('\r');
  console.log(`  ${table.name}: ${copied} rows copied`);

  const integerPrimaryKey =
    table.primaryKey.length === 1 &&
    String(table.columns.find((column) => column.name === table.primaryKey[0])?.type || '')
      .toUpperCase()
      .includes('INT');
  if (integerPrimaryKey) {
    const [rows] = await connection.query(
      `SELECT COALESCE(MAX(${quoteIdentifier(table.primaryKey[0])}), 0) + 1 AS next_id ` +
      `FROM ${quoteIdentifier(table.name)}`
    );
    await connection.query(
      `ALTER TABLE ${quoteIdentifier(table.name)} AUTO_INCREMENT = ${Number(rows[0].next_id || 1)}`
    );
  }
  return copied;
}

function sourceTextStats(sqlite, table) {
  const textColumns = table.columns.filter((column) => {
    const type = mysqlType(column, table);
    return type === 'LONGTEXT' || type.startsWith('VARCHAR');
  });
  const expressions = textColumns.map((column) =>
    `COALESCE(SUM(LENGTH(CAST(${quoteIdentifier(column.name)} AS BLOB))), 0) ` +
    `AS ${quoteIdentifier(column.name)}`
  );
  if (!expressions.length) return {};
  return sqlite.prepare(
    `SELECT ${expressions.join(', ')} FROM ${quoteIdentifier(table.name)}`
  ).get();
}

async function targetTextStats(connection, table) {
  const textColumns = table.columns.filter((column) => {
    const type = mysqlType(column, table);
    return type === 'LONGTEXT' || type.startsWith('VARCHAR');
  });
  const expressions = textColumns.map((column) =>
    `COALESCE(SUM(OCTET_LENGTH(${quoteIdentifier(column.name)})), 0) ` +
    `AS ${quoteIdentifier(column.name)}`
  );
  if (!expressions.length) return {};
  const [rows] = await connection.query(
    `SELECT ${expressions.join(', ')} FROM ${quoteIdentifier(table.name)}`
  );
  return rows[0];
}

async function verify(sqlite, connection, schema) {
  let totalRows = 0;
  for (const table of schema) {
    const sourceCount = Number(
      sqlite.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`).get().count
    );
    const [targetCountRows] = await connection.query(
      `SELECT COUNT(*) AS count FROM ${quoteIdentifier(table.name)}`
    );
    const targetCount = Number(targetCountRows[0].count);
    if (sourceCount !== targetCount) {
      throw new Error(
        `Verification failed for ${table.name}: source=${sourceCount}, target=${targetCount}`
      );
    }
    const sourceStats = sourceTextStats(sqlite, table);
    const targetStats = await targetTextStats(connection, table);
    for (const column of Object.keys(sourceStats)) {
      if (Number(sourceStats[column]) !== Number(targetStats[column])) {
        throw new Error(
          `Verification failed for ${table.name}.${column}: ` +
          `source_bytes=${sourceStats[column]}, target_bytes=${targetStats[column]}`
        );
      }
    }
    totalRows += sourceCount;
  }
  console.log(`Verification passed: ${schema.length} tables, ${totalRows} rows, text bytes match.`);
  return totalRows;
}

async function writeMetadata(connection, sourcePath, totalRows) {
  await connection.query(`
    CREATE TABLE jama_mysql_meta (
      id BIGINT PRIMARY KEY AUTO_INCREMENT,
      source_path VARCHAR(512) NOT NULL,
      source_size BIGINT NOT NULL,
      table_count BIGINT NOT NULL,
      row_count BIGINT NOT NULL,
      migrated_at VARCHAR(64) NOT NULL
    ) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci
  `);
  await connection.execute(
    `INSERT INTO jama_mysql_meta
      (source_path, source_size, table_count, row_count, migrated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [
      sourcePath,
      fs.statSync(sourcePath).size,
      (await targetTables(connection)).filter((name) => name !== 'jama_mysql_meta').length,
      totalRows,
      new Date().toISOString(),
    ]
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  if (String(config.database.type).toLowerCase() !== 'mysql') {
    throw new Error('JAMA_DB_TYPE must be mysql for this migration');
  }
  const sourcePath = getSourcePath(config, options);
  if (!fs.existsSync(sourcePath)) throw new Error(`SQLite source not found: ${sourcePath}`);

  const sqlite = new Database(sourcePath, { readonly: true, fileMustExist: true });
  const schema = getSchema(sqlite);
  const connection = await mysql.createConnection({
    host: config.database.host,
    port: Number(config.database.port || 3306),
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    charset: config.database.charset || 'utf8mb4',
    connectTimeout: Number(config.database.connect_timeout || 10000),
    supportBigNumbers: true,
    dateStrings: true,
  });

  try {
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query(
      "SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ONLY_FULL_GROUP_BY', '')"
    );
    if (!options.verifyOnly) {
      console.log(`Creating MySQL schema in ${config.database.database}...`);
      await createTargetSchema(connection, schema, options.replace);
      for (const table of schema) await copyTable(sqlite, connection, table);
      await connection.query('SET FOREIGN_KEY_CHECKS = 1');
    }
    const totalRows = await verify(sqlite, connection, schema);
    if (!options.verifyOnly) await writeMetadata(connection, sourcePath, totalRows);
  } finally {
    sqlite.close();
    await connection.end();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

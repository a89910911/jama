const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const { loadConfig } = require('../src/config');
const {
  containsDataUrl,
  existingLocalMedia,
  normalizeDataUrlsForPersistence,
  resolveStorageRoot,
} = require('../src/services/localMediaService');

const APPLY = process.argv.includes('--apply');
const TEXT_TYPES = [
  'char',
  'varchar',
  'tinytext',
  'text',
  'mediumtext',
  'longtext',
  'json',
];

function quoteId(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function primaryWhere(primaryKeys, row) {
  return {
    sql: primaryKeys.map((key) => `${quoteId(key)} = ?`).join(' AND '),
    values: primaryKeys.map((key) => row[key]),
  };
}

async function textColumns(connection, database) {
  const [rows] = await connection.query(
    `SELECT c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,
            EXISTS (
              SELECT 1
                FROM information_schema.COLUMNS lp
               WHERE lp.TABLE_SCHEMA = c.TABLE_SCHEMA
                 AND lp.TABLE_NAME = c.TABLE_NAME
                 AND lp.COLUMN_NAME = 'local_path'
            ) AS HAS_LOCAL_PATH
       FROM information_schema.COLUMNS c
       JOIN information_schema.TABLES t
         ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND t.TABLE_NAME = c.TABLE_NAME
        AND t.TABLE_TYPE = 'BASE TABLE'
      WHERE c.TABLE_SCHEMA = ?
        AND c.DATA_TYPE IN (${TEXT_TYPES.map(() => '?').join(',')})
      ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION`,
    [database, ...TEXT_TYPES]
  );
  return rows;
}

async function primaryKeys(connection, database, table) {
  const [rows] = await connection.query(
    `SELECT COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?
        AND CONSTRAINT_NAME = 'PRIMARY'
      ORDER BY ORDINAL_POSITION`,
    [database, table]
  );
  return rows.map((row) => row.COLUMN_NAME);
}

async function scanHits(connection, columns) {
  const hits = [];
  for (let offset = 0; offset < columns.length; offset += 80) {
    const chunk = columns.slice(offset, offset + 80);
    const sql = chunk.map((column) => {
      const table = quoteId(column.TABLE_NAME);
      const field = quoteId(column.COLUMN_NAME);
      return (
        `SELECT ${connection.escape(column.TABLE_NAME)} AS table_name, ` +
        `${connection.escape(column.COLUMN_NAME)} AS column_name, ` +
        `COUNT(*) AS row_count, COALESCE(SUM(OCTET_LENGTH(${field})), 0) AS total_bytes ` +
        `FROM ${table} WHERE LOCATE(';base64,', ${field}) > 0 AND LOCATE('data:', ${field}) > 0`
      );
    }).join(' UNION ALL ');
    const [rows] = await connection.query(sql);
    hits.push(...rows.filter((row) => Number(row.row_count) > 0));
  }
  return hits;
}

async function directLocalPathCandidates(
  connection,
  database,
  hit,
  storageRoot
) {
  const keys = await primaryKeys(connection, database, hit.table_name);
  if (!keys.length) return null;
  const table = quoteId(hit.table_name);
  const column = quoteId(hit.column_name);
  const selectedKeys = keys.map(quoteId).join(', ');
  const [rows] = await connection.query(
    `SELECT ${selectedKeys}, local_path,
            OCTET_LENGTH(${column}) AS original_bytes,
            SHA2(${column}, 256) AS original_digest
       FROM ${table}
      WHERE LOCATE(';base64,', ${column}) > 0
        AND ${column} LIKE 'data:%'
        AND local_path IS NOT NULL
        AND TRIM(local_path) <> ''`
  );
  if (rows.length !== Number(hit.row_count)) return null;
  const entries = [];
  for (const row of rows) {
    const existing = existingLocalMedia(storageRoot, row.local_path);
    if (!existing) return null;
    entries.push({
      table: hit.table_name,
      column: hit.column_name,
      primary_key: Object.fromEntries(keys.map((key) => [key, row[key]])),
      original_bytes: Number(row.original_bytes),
      original_sha256: row.original_digest,
      local_path: existing.local_path,
      local_url: existing.url,
      reused_existing_file: true,
    });
  }
  return { keys, entries };
}

async function jsonRootLocalPathCandidates(
  connection,
  database,
  hit,
  storageRoot
) {
  const keys = await primaryKeys(connection, database, hit.table_name);
  if (!keys.length) return null;
  const table = quoteId(hit.table_name);
  const column = quoteId(hit.column_name);
  const selectedKeys = keys.map(quoteId).join(', ');
  const [rows] = await connection.query(
    `SELECT ${selectedKeys},
            CASE WHEN JSON_VALID(${column})
              THEN JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.local_path'))
              ELSE NULL END AS embedded_local_path,
            CASE WHEN JSON_VALID(${column})
              THEN JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.image_url')) LIKE 'data:%;base64,%'
              ELSE 0 END AS root_image_is_data_url,
            OCTET_LENGTH(${column}) AS original_bytes,
            SHA2(${column}, 256) AS original_digest
       FROM ${table}
      WHERE LOCATE(';base64,', ${column}) > 0`
  );
  if (
    rows.length !== Number(hit.row_count) ||
    rows.some((row) => !Number(row.root_image_is_data_url))
  ) {
    return null;
  }
  const entries = [];
  for (const row of rows) {
    const existing = existingLocalMedia(storageRoot, row.embedded_local_path);
    if (!existing) return null;
    entries.push({
      table: hit.table_name,
      column: hit.column_name,
      primary_key: Object.fromEntries(keys.map((key) => [key, row[key]])),
      original_bytes: Number(row.original_bytes),
      original_sha256: row.original_digest,
      local_path: existing.local_path,
      local_url: existing.url,
      reused_existing_file: true,
      json_path: '$.image_url',
    });
  }
  return { keys, entries };
}

async function applyDirectFastPath(connection, hit) {
  const table = quoteId(hit.table_name);
  const column = quoteId(hit.column_name);
  const [result] = await connection.query(
    `UPDATE ${table}
        SET ${column} = CONCAT('/static/', TRIM(LEADING '/' FROM REPLACE(local_path, '\\\\', '/')))
      WHERE LOCATE(';base64,', ${column}) > 0
        AND ${column} LIKE 'data:%'
        AND local_path IS NOT NULL
        AND TRIM(local_path) <> ''`
  );
  return Number(result.affectedRows || 0);
}

async function applyJsonFastPath(connection, hit) {
  const table = quoteId(hit.table_name);
  const column = quoteId(hit.column_name);
  const [result] = await connection.query(
    `UPDATE ${table}
        SET ${column} = JSON_SET(
          ${column},
          '$.image_url',
          CONCAT(
            '/static/',
            TRIM(
              LEADING '/' FROM REPLACE(
                JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.local_path')),
                '\\\\',
                '/'
              )
            )
          )
        )
      WHERE LOCATE(';base64,', ${column}) > 0
        AND JSON_VALID(${column})
        AND JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.image_url')) LIKE 'data:%;base64,%'
        AND JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.local_path')) IS NOT NULL
        AND TRIM(JSON_UNQUOTE(JSON_EXTRACT(${column}, '$.local_path'))) <> ''`
  );
  return Number(result.affectedRows || 0);
}

async function applyGenericFallback(
  connection,
  database,
  hit,
  storageRoot,
  manifest
) {
  const keys = await primaryKeys(connection, database, hit.table_name);
  if (!keys.length) {
    throw new Error(
      `${hit.table_name}.${hit.column_name} contains Base64 but has no primary key`
    );
  }
  const table = quoteId(hit.table_name);
  const column = quoteId(hit.column_name);
  let changed = 0;
  while (true) {
    const [rows] = await connection.query(
      `SELECT ${keys.map(quoteId).join(', ')}, ${column} AS encoded_value
         FROM ${table}
        WHERE LOCATE(';base64,', ${column}) > 0
        LIMIT 1`
    );
    if (!rows.length) break;
    const row = rows[0];
    const normalized = normalizeDataUrlsForPersistence(row.encoded_value, {
      storagePath: storageRoot,
      category: `migrated/${hit.table_name}`,
      prefix: hit.column_name,
    });
    if (!normalized.replacements || containsDataUrl(normalized.value)) {
      throw new Error(
        `Could not normalize ${hit.table_name}.${hit.column_name}`
      );
    }
    const where = primaryWhere(keys, row);
    manifest.entries.push({
      table: hit.table_name,
      column: hit.column_name,
      primary_key: Object.fromEntries(keys.map((key) => [key, row[key]])),
      original_bytes: Buffer.byteLength(String(row.encoded_value)),
      original_sha256: sha256(row.encoded_value),
      local_paths: normalized.files.map((file) => file.local_path),
      local_urls: normalized.files.map((file) => file.url),
      reused_existing_file: normalized.files.every((file) => file.reused),
      generic_fallback: true,
    });
    if (APPLY) {
      await connection.query(
        `UPDATE ${table} SET ${column} = ? WHERE ${where.sql}`,
        [normalized.value, ...where.values]
      );
    } else {
      break;
    }
    changed += 1;
  }
  return changed;
}

async function main() {
  const config = loadConfig();
  if (String(config.database?.type || '').toLowerCase() !== 'mysql') {
    throw new Error('This migration command currently targets the configured MySQL database');
  }
  const storageRoot = resolveStorageRoot(config.storage?.local_path || './data/storage');
  fs.mkdirSync(storageRoot, { recursive: true });
  const backupDir = path.resolve(process.cwd(), 'data', 'migration-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const manifestPath = path.join(
    backupDir,
    `base64-media-${nowStamp()}.json`
  );
  const manifest = {
    created_at: new Date().toISOString(),
    mode: APPLY ? 'apply' : 'dry-run',
    database: config.database.database,
    storage_root: storageRoot,
    scanned_text_columns: 0,
    hit_columns: [],
    entries: [],
    updated_rows: 0,
    status: 'scanning',
  };

  const connection = await mysql.createConnection({
    host: config.database.host,
    port: Number(config.database.port || 3306),
    user: config.database.user,
    password: config.database.password,
    database: config.database.database,
    charset: config.database.charset || 'utf8mb4',
  });
  try {
    const columns = await textColumns(connection, config.database.database);
    manifest.scanned_text_columns = columns.length;
    const hits = await scanHits(connection, columns);
    manifest.hit_columns = hits;
    manifest.status = 'validated';

    const fastPaths = [];
    for (const hit of hits) {
      const metadata = columns.find(
        (column) =>
          column.TABLE_NAME === hit.table_name &&
          column.COLUMN_NAME === hit.column_name
      );
      let candidate = null;
      let kind = null;
      if (Number(metadata?.HAS_LOCAL_PATH)) {
        candidate = await directLocalPathCandidates(
          connection,
          config.database.database,
          hit,
          storageRoot
        );
        kind = candidate ? 'direct' : null;
      }
      if (!candidate) {
        candidate = await jsonRootLocalPathCandidates(
          connection,
          config.database.database,
          hit,
          storageRoot
        );
        kind = candidate ? 'json-root' : null;
      }
      if (candidate) {
        manifest.entries.push(...candidate.entries);
        fastPaths.push({ hit, kind });
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    if (APPLY) {
      for (const fastPath of fastPaths) {
        const changed = fastPath.kind === 'direct'
          ? await applyDirectFastPath(connection, fastPath.hit)
          : await applyJsonFastPath(connection, fastPath.hit);
        manifest.updated_rows += changed;
      }
    }

    if (APPLY) {
      const remaining = await scanHits(connection, columns);
      for (const hit of remaining) {
        manifest.updated_rows += await applyGenericFallback(
          connection,
          config.database.database,
          hit,
          storageRoot,
          manifest
        );
      }
    }

    const after = APPLY ? await scanHits(connection, columns) : hits;
    manifest.remaining_hit_columns = after;
    manifest.status = APPLY && !after.length
      ? 'completed'
      : APPLY
        ? 'incomplete'
        : 'dry-run-completed';
    manifest.completed_at = new Date().toISOString();
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(JSON.stringify({
      mode: manifest.mode,
      scanned_text_columns: manifest.scanned_text_columns,
      hit_columns: hits.length,
      affected_records: manifest.entries.length,
      updated_rows: manifest.updated_rows,
      remaining_hit_columns: after.length,
      manifest: manifestPath,
      status: manifest.status,
    }, null, 2));
    if (APPLY && after.length) process.exitCode = 2;
  } finally {
    await connection.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    error: error.message,
    code: error.code,
  }, null, 2));
  process.exit(1);
});

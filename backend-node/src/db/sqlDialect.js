function replaceOutsideQuoted(sql, replacer) {
  let output = '';
  let segment = '';
  let quote = null;

  const flush = () => {
    if (!segment) return;
    output += replacer(segment);
    segment = '';
  };

  for (let i = 0; i < sql.length; i += 1) {
    const char = sql[i];
    if (!quote && (char === "'" || char === '"' || char === '`')) {
      flush();
      quote = char;
      output += char;
      continue;
    }
    if (quote) {
      output += char;
      if (char === quote) {
        if (sql[i + 1] === quote) {
          output += sql[i + 1];
          i += 1;
        } else if (sql[i - 1] !== '\\') {
          quote = null;
        }
      }
      continue;
    }
    segment += char;
  }
  flush();
  return output;
}

function quoteMysqlReservedIdentifiers(sql) {
  return replaceOutsideQuoted(sql, (segment) =>
    segment.replace(/\bkey\b/gi, (match, offset, full) => {
      const before = full.slice(Math.max(0, offset - 16), offset).toLowerCase();
      if (/\b(primary|foreign|unique)\s+$/.test(before)) return match.toUpperCase();
      return '`key`';
    })
  );
}

function translatePragmaTableInfo(sql) {
  const match = sql.trim().match(/^PRAGMA\s+table_info\s*\(\s*([A-Za-z0-9_]+)\s*\)\s*;?$/i);
  if (!match) return null;
  const table = match[1];
  return `
    SELECT
      COLUMN_NAME AS name,
      COLUMN_TYPE AS type,
      CASE WHEN IS_NULLABLE = 'NO' THEN 1 ELSE 0 END AS notnull,
      COLUMN_DEFAULT AS dflt_value,
      CASE WHEN COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END AS pk
    FROM information_schema.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'
    ORDER BY ORDINAL_POSITION
  `;
}

function translateOnConflict(sql) {
  const conflict = /\s+ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE\s+SET\s+([\s\S]*?)(;?\s*)$/i;
  return sql.replace(conflict, (_whole, _columns, assignments, ending) => {
    const mysqlAssignments = assignments.replace(
      /\bexcluded\s*\.\s*`?([A-Za-z_][A-Za-z0-9_]*)`?/gi,
      (_value, column) => `VALUES(\`${column}\`)`
    );
    return ` ON DUPLICATE KEY UPDATE ${mysqlAssignments}${ending}`;
  });
}

function translateSqliteSqlToMysql(input) {
  const pragma = translatePragmaTableInfo(input);
  if (pragma) return pragma;

  let sql = String(input);
  sql = sql.replace(
    /SELECT\s+1\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*'([^']+)'/gi,
    (_whole, table) =>
      `SELECT 1 FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
  );
  sql = quoteMysqlReservedIdentifiers(sql);
  sql = replaceOutsideQuoted(sql, (segment) =>
    segment
      .replace(/\bINSERT\s+OR\s+IGNORE\b/gi, 'INSERT IGNORE')
      .replace(/\bINSERT\s+OR\s+REPLACE\b/gi, 'REPLACE')
      .replace(/\bAUTOINCREMENT\b/gi, 'AUTO_INCREMENT')
      .replace(/\bTEXT\s+PRIMARY\s+KEY\b/gi, 'VARCHAR(191) PRIMARY KEY')
      .replace(/\bTEXT\s+NOT\s+NULL\s+UNIQUE\b/gi, 'VARCHAR(191) NOT NULL UNIQUE')
      .replace(/\bTEXT\s+UNIQUE\b/gi, 'VARCHAR(191) UNIQUE')
      .replace(/\bTEXT\s+((?:NOT\s+NULL\s+)?DEFAULT\b)/gi, 'VARCHAR(255) $1')
      .replace(/\bAS\s+TEXT\b/gi, 'AS CHAR')
      .replace(/\s+COLLATE\s+NOCASE\b/gi, '')
  );
  sql = sql.replace(/'\/static\/'\s*\|\|\s*([A-Za-z_][A-Za-z0-9_.]*)/g, "CONCAT('/static/', $1)");
  sql = sql.replace(
    /^\s*CREATE\s+(?:UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)\s+ON\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([\s\S]*?)\)\s+WHERE\s+[\s\S]*$/i,
    'CREATE INDEX $1 ON $2 ($3)'
  );
  sql = sql.replace(/\bCREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS\b/gi, 'CREATE $1INDEX');
  sql = translateOnConflict(sql);
  sql = sql.replace(
    /datetime\s*\(\s*'now'\s*,\s*'-5 minutes'\s*\)/gi,
    'DATE_SUB(UTC_TIMESTAMP(), INTERVAL 5 MINUTE)'
  );
  return sql;
}

module.exports = {
  quoteMysqlReservedIdentifiers,
  translateSqliteSqlToMysql,
};

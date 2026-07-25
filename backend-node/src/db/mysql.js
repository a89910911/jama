const path = require('path');
const {
  MessageChannel,
  Worker,
  receiveMessageOnPort,
} = require('worker_threads');
const { translateSqliteSqlToMysql } = require('./sqlDialect');

const REQUIRED_TABLES = [
  'ai_model_map',
  'ai_request_logs',
  'ai_service_configs',
  'assets',
  'async_tasks',
  'character_libraries',
  'characters',
  'codex_chat_messages',
  'codex_chat_sessions',
  'dramas',
  'episode_characters',
  'episodes',
  'frame_prompts',
  'global_settings',
  'image_generations',
  'image_proxy_cache',
  'prompt_definitions',
  'prompt_overrides',
  'prompt_templates',
  'prop_libraries',
  'props',
  'scene_libraries',
  'scenes',
  'storyboard_characters',
  'storyboard_props',
  'storyboards',
  'user_accounts',
  'video_generations',
  'video_merges',
];

function normalizeValues(values) {
  const args = values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return args.map((value) => {
    if (typeof value === 'bigint') return value.toString();
    return value;
  });
}

class MysqlStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = translateSqliteSqlToMysql(sql);
  }

  all(...values) {
    const result = this.database.query(this.sql, normalizeValues(values));
    return Array.isArray(result) ? result : [];
  }

  get(...values) {
    return this.all(...values)[0];
  }

  run(...values) {
    const result = this.database.query(this.sql, normalizeValues(values)) || {};
    return {
      changes: Number(result.affectedRows || 0),
      lastInsertRowid: Number(result.insertId || 0),
    };
  }
}

function splitStatements(sql) {
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
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

class MysqlDatabase {
  constructor(config) {
    const required = ['host', 'user', 'password', 'database'];
    for (const name of required) {
      if (config[name] == null || String(config[name]).trim() === '') {
        throw new Error(`MySQL configuration is missing database.${name}`);
      }
    }
    this.dialect = 'mysql';
    this.config = { ...config };
    this.transactionDepth = 0;
    this.queryTimeout = Number(config.query_timeout || 10 * 60 * 1000);
    this.controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    this.control = new Int32Array(this.controlBuffer);
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.worker = new Worker(path.join(__dirname, 'mysqlWorker.js'), {
      workerData: {
        config: this.config,
        controlBuffer: this.controlBuffer,
        port: channel.port2,
      },
      transferList: [channel.port2],
    });
    this.receive('connect', Number(config.connect_timeout || 10000) + 5000);
  }

  receive(operation, timeout = this.queryTimeout) {
    const waitResult = Atomics.wait(this.control, 0, 0, timeout);
    if (waitResult === 'timed-out') {
      throw new Error(`MySQL ${operation} timed out after ${timeout}ms`);
    }
    const packet = receiveMessageOnPort(this.port);
    Atomics.store(this.control, 0, 0);
    if (!packet) throw new Error(`MySQL ${operation} returned no response`);
    const message = packet.message;
    if (!message.ok) {
      const error = new Error(message.error?.message || `MySQL ${operation} failed`);
      Object.assign(error, message.error || {});
      throw error;
    }
    return message.result;
  }

  query(sql, values = []) {
    Atomics.store(this.control, 0, 0);
    this.port.postMessage({ type: 'query', sql, values });
    return this.receive('query');
  }

  prepare(sql) {
    return new MysqlStatement(this, sql);
  }

  exec(sql) {
    let result = null;
    for (const statement of splitStatements(sql)) {
      result = this.query(translateSqliteSqlToMysql(statement));
    }
    return result;
  }

  pragma() {
    return undefined;
  }

  transaction(callback) {
    return (...args) => {
      const depth = this.transactionDepth;
      const savepoint = `jama_nested_${depth}`;
      if (depth === 0) this.query('START TRANSACTION');
      else this.query(`SAVEPOINT ${savepoint}`);
      this.transactionDepth += 1;
      try {
        const result = callback(...args);
        this.transactionDepth -= 1;
        if (depth === 0) this.query('COMMIT');
        else this.query(`RELEASE SAVEPOINT ${savepoint}`);
        return result;
      } catch (error) {
        this.transactionDepth -= 1;
        if (depth === 0) this.query('ROLLBACK');
        else this.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
        throw error;
      }
    };
  }

  close() {
    Atomics.store(this.control, 0, 0);
    this.port.postMessage({ type: 'close' });
    this.receive('close', 10000);
    this.port.close();
    this.worker.terminate();
  }
}

function assertMysqlSchema(database) {
  const rows = database.prepare(`
    SELECT TABLE_NAME AS name
    FROM information_schema.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
  `).all();
  const existing = new Set(rows.map((row) => row.name));
  const missing = REQUIRED_TABLES.filter((table) => !existing.has(table));
  if (missing.length) {
    throw new Error(
      `MySQL schema "${database.config.database}" is not initialized; missing tables: ` +
      `${missing.join(', ')}. Run "npm run db:migrate:mysql -- --replace" first.`
    );
  }
}

module.exports = {
  MysqlDatabase,
  assertMysqlSchema,
  REQUIRED_TABLES,
};

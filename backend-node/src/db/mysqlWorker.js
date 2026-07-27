const { workerData } = require('worker_threads');
const mysql = require('mysql2/promise');
const {
  isReadOnlySql,
  isRecoverableConnectionError,
} = require('./mysqlConnectionPolicy');

const { config, controlBuffer, port } = workerData;
const control = new Int32Array(controlBuffer);
const idleProbeMs = Math.max(100, Number(config.idle_probe_ms || 30 * 1000));
let connection = null;
let connectionFault = null;
let lastActivityAt = 0;
let closing = false;

function serializeError(error) {
  return {
    message: error?.message || String(error),
    code: error?.code,
    errno: error?.errno,
    sqlState: error?.sqlState,
    stack: error?.stack,
  };
}

function respond(payload) {
  port.postMessage(payload);
  Atomics.store(control, 0, 1);
  Atomics.notify(control, 0, 1);
}

function markConnectionFault(error) {
  if (!closing && isRecoverableConnectionError(error)) {
    connectionFault = error;
  }
}

async function openConnection() {
  const next = await mysql.createConnection({
    host: config.host,
    port: Number(config.port || 3306),
    user: config.user,
    password: config.password,
    database: config.database,
    charset: config.charset || 'utf8mb4',
    connectTimeout: Number(config.connect_timeout || 10000),
    supportBigNumbers: true,
    dateStrings: true,
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    multipleStatements: true,
  });
  next.on?.('error', markConnectionFault);
  await next.query("SET SESSION time_zone = '+00:00'");
  await next.query(
    "SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ONLY_FULL_GROUP_BY', '')"
  );
  connection = next;
  connectionFault = null;
  lastActivityAt = Date.now();
}

function destroyConnection() {
  const current = connection;
  connection = null;
  connectionFault = null;
  if (!current) return;
  current.removeListener?.('error', markConnectionFault);
  try {
    current.destroy();
  } catch (_) {
    // The socket may already have been closed by MySQL.
  }
}

async function reconnect() {
  destroyConnection();
  await openConnection();
}

async function ensureLiveConnection() {
  if (!connection || connectionFault) {
    await reconnect();
    return;
  }
  if (Date.now() - lastActivityAt < idleProbeMs) return;
  try {
    await connection.ping();
    lastActivityAt = Date.now();
  } catch (error) {
    if (!isRecoverableConnectionError(error)) throw error;
    await reconnect();
  }
}

async function executeQuery(sql, values) {
  await ensureLiveConnection();
  try {
    const [result] = await connection.query(sql, values || []);
    lastActivityAt = Date.now();
    return result;
  } catch (error) {
    if (!isRecoverableConnectionError(error)) throw error;

    // Re-establish the connection for subsequent work. Only retry reads:
    // retrying a write after losing its response could apply it twice.
    await reconnect();
    if (!isReadOnlySql(sql)) throw error;

    const [result] = await connection.query(sql, values || []);
    lastActivityAt = Date.now();
    return result;
  }
}

async function executeReadBatch(statements) {
  const requests = Array.isArray(statements) ? statements : [];
  if (!requests.length) return [];
  for (const request of requests) {
    if (!isReadOnlySql(request?.sql) || String(request.sql).includes(';')) {
      throw new Error('MySQL read batch only accepts single read-only statements');
    }
  }
  const sql = requests.map((request) => request.sql).join(';\n');
  const values = requests.flatMap((request) =>
    Array.isArray(request.values) ? request.values : []
  );

  const run = async () => {
    const [result] = await connection.query(sql, values);
    lastActivityAt = Date.now();
    return requests.length === 1 ? [result] : result;
  };

  await ensureLiveConnection();
  try {
    return await run();
  } catch (error) {
    if (!isRecoverableConnectionError(error)) throw error;
    await reconnect();
    return run();
  }
}

async function initialize() {
  try {
    await openConnection();
    respond({ ok: true });
  } catch (error) {
    respond({ ok: false, error: serializeError(error) });
    return;
  }

  port.on('message', async (message) => {
    try {
      if (message.type === 'query') {
        const result = await executeQuery(message.sql, message.values);
        respond({ ok: true, result });
        return;
      }
      if (message.type === 'readBatch') {
        const result = await executeReadBatch(message.statements);
        respond({ ok: true, result });
        return;
      }
      if (message.type === 'close') {
        closing = true;
        if (connection) await connection.end();
        connection = null;
        respond({ ok: true });
        setImmediate(() => process.exit(0));
        return;
      }
      throw new Error(`Unsupported MySQL worker command: ${message.type}`);
    } catch (error) {
      respond({ ok: false, error: serializeError(error) });
    }
  });
  port.start();
}

initialize();

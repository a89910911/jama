const { workerData } = require('worker_threads');
const mysql = require('mysql2/promise');

const { config, controlBuffer, port } = workerData;
const control = new Int32Array(controlBuffer);
let connection = null;

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

async function initialize() {
  try {
    connection = await mysql.createConnection({
      host: config.host,
      port: Number(config.port || 3306),
      user: config.user,
      password: config.password,
      database: config.database,
      charset: config.charset || 'utf8mb4',
      connectTimeout: Number(config.connect_timeout || 10000),
      supportBigNumbers: true,
      dateStrings: true,
    });
    await connection.query("SET SESSION time_zone = '+00:00'");
    await connection.query(
      "SET SESSION sql_mode = REPLACE(@@SESSION.sql_mode, 'ONLY_FULL_GROUP_BY', '')"
    );
    respond({ ok: true });
  } catch (error) {
    respond({ ok: false, error: serializeError(error) });
    return;
  }

  port.on('message', async (message) => {
    try {
      if (message.type === 'query') {
        const [result] = await connection.query(message.sql, message.values || []);
        respond({ ok: true, result });
        return;
      }
      if (message.type === 'close') {
        await connection.end();
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

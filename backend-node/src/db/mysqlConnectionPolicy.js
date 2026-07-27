const RECOVERABLE_CONNECTION_CODES = new Set([
  'PROTOCOL_CONNECTION_LOST',
  'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR',
  'PROTOCOL_ENQUEUE_AFTER_QUIT',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
]);

function isRecoverableConnectionError(error) {
  if (RECOVERABLE_CONNECTION_CODES.has(String(error?.code || '').toUpperCase())) {
    return true;
  }
  const message = String(error?.message || '').toLowerCase();
  return (
    message.includes('connection lost') ||
    message.includes('connection is in closed state') ||
    message.includes('socket has been disconnected') ||
    message.includes('read econnreset') ||
    message.includes('write epipe')
  );
}

function isReadOnlySql(sql) {
  const normalized = String(sql || '')
    .replace(/^\s*(?:--[^\r\n]*(?:\r?\n|$)|\/\*[\s\S]*?\*\/\s*)*/u, '')
    .trimStart()
    .toUpperCase();
  return /^(?:SELECT|SHOW|DESCRIBE|DESC|EXPLAIN)\b/u.test(normalized);
}

module.exports = {
  isReadOnlySql,
  isRecoverableConnectionError,
};

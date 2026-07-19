/**
 * 从 global_settings 表读取一个键值，返回解析后的值，不存在时返回 defaultValue。
 */
function getGlobalSetting(db, key, defaultValue = null) {
  try {
    const row = db.prepare('SELECT value FROM global_settings WHERE key = ?').get(key);
    if (!row) return defaultValue;
    try { return JSON.parse(row.value); } catch (_) { return row.value; }
  } catch (_) { return defaultValue; }
}

/**
 * 向 global_settings 表写入一个键值（value 会被 JSON.stringify）。
 */
function setGlobalSetting(db, key, value) {
  const now = new Date().toISOString();
  const str = JSON.stringify(value);
  db.prepare(
    `INSERT INTO global_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  ).run(key, str, now);
}

module.exports = {
  getGlobalSetting,
  setGlobalSetting,
};

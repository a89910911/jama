'use strict';

const { requireUserId } = require('./userAiConfigService');

const DEFAULTS = Object.freeze({
  assistant_engine: 'configured_api',
  image_concurrency: 3,
  video_concurrency: 3,
});

function normalizeEngine(value) {
  return String(value || '').trim().toLowerCase() === 'codex'
    ? 'codex'
    : 'configured_api';
}

function concurrency(value, fallback = 3) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 20) return fallback;
  return number;
}

function getPreferences(db, userIdValue) {
  const userId = requireUserId(userIdValue);
  const row = db.prepare(
    'SELECT * FROM user_ai_preferences WHERE user_id = ?'
  ).get(userId);
  if (!row) return { user_id: userId, ...DEFAULTS };
  return {
    user_id: userId,
    assistant_engine: normalizeEngine(row.assistant_engine),
    image_concurrency: concurrency(row.image_concurrency),
    video_concurrency: concurrency(row.video_concurrency),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function updatePreferences(db, userIdValue, input = {}) {
  const userId = requireUserId(userIdValue);
  const current = getPreferences(db, userId);
  const next = {
    assistant_engine: input.assistant_engine !== undefined
      ? normalizeEngine(input.assistant_engine)
      : current.assistant_engine,
    image_concurrency: input.image_concurrency !== undefined
      ? concurrency(input.image_concurrency, NaN)
      : current.image_concurrency,
    video_concurrency: input.video_concurrency !== undefined
      ? concurrency(input.video_concurrency, NaN)
      : current.video_concurrency,
  };
  if (!Number.isInteger(next.image_concurrency) || !Number.isInteger(next.video_concurrency)) {
    const error = new Error('并发数必须是 1-20 之间的整数');
    error.code = 'INVALID_CONCURRENCY';
    throw error;
  }
  const now = new Date().toISOString();
  const existing = db.prepare(
    'SELECT user_id FROM user_ai_preferences WHERE user_id = ?'
  ).get(userId);
  if (existing) {
    db.prepare(`
      UPDATE user_ai_preferences
         SET assistant_engine = ?, image_concurrency = ?, video_concurrency = ?,
             updated_at = ?
       WHERE user_id = ?
    `).run(
      next.assistant_engine,
      next.image_concurrency,
      next.video_concurrency,
      now,
      userId
    );
  } else {
    db.prepare(`
      INSERT INTO user_ai_preferences
        (user_id, assistant_engine, image_concurrency, video_concurrency,
         created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      userId,
      next.assistant_engine,
      next.image_concurrency,
      next.video_concurrency,
      now,
      now
    );
  }
  return getPreferences(db, userId);
}

module.exports = {
  DEFAULTS,
  getPreferences,
  normalizeEngine,
  updatePreferences,
};


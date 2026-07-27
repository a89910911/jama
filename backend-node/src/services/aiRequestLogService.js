const { AsyncLocalStorage } = require('async_hooks');
const { randomUUID } = require('crypto');
const { tableColumns } = require('../db/portableSql');

const requestStorage = new AsyncLocalStorage();
const MAX_STRING_LENGTH = 200000;
const SENSITIVE_KEY_RE = /(^|_)(api[_-]?key|authorization|cookie|password|secret|token|access[_-]?key|session)(_|$)/i;

function requestContextMiddleware(req, res, next) {
  requestStorage.run(
    {
      req,
      request_uuid: String(req.headers?.['x-request-id'] || '').trim() || randomUUID(),
    },
    next
  );
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function firstPositive(sources, keys) {
  for (const source of sources) {
    if (!source || typeof source !== 'object') continue;
    for (const key of keys) {
      const value = positiveInteger(source[key]);
      if (value) return value;
    }
  }
  return null;
}

function currentRequest() {
  return requestStorage.getStore()?.req || null;
}

function currentUserId(explicitValue) {
  return positiveInteger(explicitValue) || positiveInteger(currentRequest()?.user?.id);
}

function currentUsername(explicitValue) {
  const value = explicitValue || currentRequest()?.user?.username;
  return value ? String(value).slice(0, 255) : null;
}

function collectSources(details = {}) {
  const req = currentRequest();
  return [
    details,
    details.context,
    details.options,
    req?.body,
    req?.query,
    req?.params,
  ].filter(Boolean);
}

function queryDramaId(db, sql, id) {
  if (!db || !id) return null;
  try {
    return positiveInteger(db.prepare(sql).get(id)?.drama_id);
  } catch (_) {
    return null;
  }
}

function resolveDramaId(db, details = {}) {
  const sources = collectSources(details);
  const direct = firstPositive(sources, ['drama_id', 'dramaId', 'project_id', 'projectId']);
  if (direct) return direct;

  const req = currentRequest();
  const dramaPathMatch = String(req?.path || '').match(/^\/dramas\/(\d+)(?:\/|$)/);
  if (dramaPathMatch) return positiveInteger(dramaPathMatch[1]);

  const episodeId = firstPositive(sources, ['episode_id', 'episodeId']);
  const fromEpisode = queryDramaId(
    db,
    'SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL',
    episodeId
  );
  if (fromEpisode) return fromEpisode;

  const storyboardId = firstPositive(sources, ['storyboard_id', 'storyboardId']);
  const fromStoryboard = queryDramaId(
    db,
    `SELECT e.drama_id
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`,
    storyboardId
  );
  if (fromStoryboard) return fromStoryboard;

  const entityLookups = [
    ['character_id', 'characterId', 'characters'],
    ['scene_id', 'sceneId', 'scenes'],
    ['prop_id', 'propId', 'props'],
    ['image_gen_id', 'imageGenId', 'image_generations'],
    ['video_gen_id', 'videoGenId', 'video_generations'],
  ];
  for (const [snakeKey, camelKey, table] of entityLookups) {
    const id = firstPositive(sources, [snakeKey, camelKey]);
    const dramaId = queryDramaId(db, `SELECT drama_id FROM ${table} WHERE id = ?`, id);
    if (dramaId) return dramaId;
  }

  const path = String(req?.path || '');
  const genericId = positiveInteger(req?.params?.id);
  const pathTables = [
    [/^\/storyboards\/\d+(?:\/|$)/, `SELECT e.drama_id
      FROM storyboards s JOIN episodes e ON e.id = s.episode_id WHERE s.id = ?`],
    [/^\/characters\/\d+(?:\/|$)/, 'SELECT drama_id FROM characters WHERE id = ?'],
    [/^\/scenes\/\d+(?:\/|$)/, 'SELECT drama_id FROM scenes WHERE id = ?'],
    [/^\/props\/\d+(?:\/|$)/, 'SELECT drama_id FROM props WHERE id = ?'],
    [/^\/images\/\d+(?:\/|$)/, 'SELECT drama_id FROM image_generations WHERE id = ?'],
    [/^\/videos\/\d+(?:\/|$)/, 'SELECT drama_id FROM video_generations WHERE id = ?'],
  ];
  for (const [pattern, sql] of pathTables) {
    if (!pattern.test(path)) continue;
    const dramaId = queryDramaId(db, sql, genericId);
    if (dramaId) return dramaId;
  }
  return null;
}

function resolveRelated(details = {}) {
  if (details.related_type && details.related_id != null) {
    return {
      related_type: String(details.related_type),
      related_id: String(details.related_id),
    };
  }
  const sources = collectSources(details);
  const candidates = [
    ['video_generation', ['video_gen_id', 'videoGenId']],
    ['image_generation', ['image_gen_id', 'imageGenId']],
    ['storyboard', ['storyboard_id', 'storyboardId']],
    ['episode', ['episode_id', 'episodeId']],
    ['character', ['character_id', 'characterId']],
    ['scene', ['scene_id', 'sceneId']],
    ['prop', ['prop_id', 'propId']],
    ['task', ['task_id', 'taskId']],
  ];
  for (const [type, keys] of candidates) {
    const id = firstPositive(sources, keys);
    if (id) return { related_type: type, related_id: String(id) };
  }
  return { related_type: null, related_id: null };
}

function summarizeDataUrl(value) {
  const match = value.match(/^data:([^;,]+)?(?:;[^,]*)?;base64,(.*)$/s);
  if (!match) return null;
  const bytes = Math.round((match[2].length * 3) / 4);
  return `[base64 ${match[1] || 'application/octet-stream'}, ${bytes} bytes]`;
}

function sanitizeValue(value, key = '', seen = new WeakSet(), depth = 0) {
  if (SENSITIVE_KEY_RE.test(String(key))) return '[REDACTED]';
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'string') {
    const dataSummary = summarizeDataUrl(value);
    if (dataSummary) return dataSummary;
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}\n…[truncated ${value.length - MAX_STRING_LENGTH} chars]`
      : value;
  }
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
  if (typeof value === 'function') return '[Function]';
  if (depth >= 8) return '[Max depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, 200).map((item) => sanitizeValue(item, '', seen, depth + 1));
    if (value.length > 200) items.push(`[${value.length - 200} more items]`);
    return items;
  }
  const result = {};
  for (const [childKey, childValue] of Object.entries(value)) {
    result[childKey] = sanitizeValue(childValue, childKey, seen, depth + 1);
  }
  return result;
}

function toJson(value) {
  if (value === undefined) return null;
  try {
    return JSON.stringify(sanitizeValue(value));
  } catch (_) {
    return JSON.stringify({ value: '[Unserializable payload]' });
  }
}

function parseJson(value) {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch (_) {
    return value;
  }
}

function start(db, details = {}) {
  try {
    const req = currentRequest();
    const related = resolveRelated(details);
    const now = new Date().toISOString();
    const requestUuid = randomUUID();
    const hasOwnershipColumns = tableColumns(db, 'ai_request_logs')
      .some((column) => column.name === 'user_ai_config_id');
    const info = hasOwnershipColumns ? db.prepare(
      `INSERT INTO ai_request_logs
        (request_uuid, drama_id, user_id, username_snapshot, service_type,
         operation, scene_key, provider, model, config_id, user_ai_config_id,
         user_ai_config_revision_id, status, request_payload, related_type,
         related_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`
    ).run(
      requestUuid,
      resolveDramaId(db, details),
      currentUserId(details.user_id),
      currentUsername(details.username),
      String(details.service_type || 'text'),
      String(details.operation || 'generate'),
      details.scene_key ? String(details.scene_key) : null,
      details.provider ? String(details.provider) : null,
      details.model ? String(details.model) : null,
      positiveInteger(details.config_id),
      positiveInteger(details.user_ai_config_id || details.config_id),
      positiveInteger(details.user_ai_config_revision_id || details.config_revision_id),
      toJson(details.request),
      related.related_type,
      related.related_id,
      now,
      now
    ) : db.prepare(
      `INSERT INTO ai_request_logs
        (request_uuid, drama_id, user_id, service_type, operation, scene_key,
         provider, model, config_id, status, request_payload, related_type,
         related_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?, ?, ?)`
    ).run(
      requestUuid,
      resolveDramaId(db, details),
      currentUserId(details.user_id),
      String(details.service_type || 'text'),
      String(details.operation || 'generate'),
      details.scene_key ? String(details.scene_key) : null,
      details.provider ? String(details.provider) : null,
      details.model ? String(details.model) : null,
      positiveInteger(details.config_id),
      toJson(details.request),
      related.related_type,
      related.related_id,
      now,
      now
    );
    return {
      id: Number(info.lastInsertRowid),
      request_uuid: requestUuid,
      started_at_ms: Date.now(),
    };
  } catch (_) {
    return null;
  }
}

function finish(db, record, status, response, errorMessage, meta = {}) {
  if (!record?.id) return;
  try {
    const now = new Date().toISOString();
    const isFinal = status !== 'processing';
    const duration = isFinal
      ? Math.max(0, Date.now() - Number(record.started_at_ms || Date.now()))
      : null;
    const hasOwnershipColumns = tableColumns(db, 'ai_request_logs')
      .some((column) => column.name === 'user_ai_config_id');
    const statement = hasOwnershipColumns ? db.prepare(
      `UPDATE ai_request_logs
          SET status = ?,
              response_payload = COALESCE(?, response_payload),
              error_message = ?,
              provider = COALESCE(?, provider),
              model = COALESCE(?, model),
              config_id = COALESCE(?, config_id),
              user_ai_config_id = COALESCE(?, user_ai_config_id),
              user_ai_config_revision_id = COALESCE(?, user_ai_config_revision_id),
              duration_ms = COALESCE(?, duration_ms),
              completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
              updated_at = ?
        WHERE id = ?`
    ) : db.prepare(
      `UPDATE ai_request_logs
          SET status = ?,
              response_payload = COALESCE(?, response_payload),
              error_message = ?,
              provider = COALESCE(?, provider),
              model = COALESCE(?, model),
              config_id = COALESCE(?, config_id),
              duration_ms = COALESCE(?, duration_ms),
              completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
              updated_at = ?
        WHERE id = ?`
    );
    const commonValues = [
      status,
      toJson(response),
      errorMessage ? String(errorMessage).slice(0, 10000) : null,
      meta.provider ? String(meta.provider) : null,
      meta.model ? String(meta.model) : null,
      positiveInteger(meta.config_id),
    ];
    statement.run(
      ...commonValues,
      ...(hasOwnershipColumns ? [
      positiveInteger(meta.user_ai_config_id || meta.config_id),
      positiveInteger(meta.user_ai_config_revision_id || meta.config_revision_id),
      ] : []),
      duration,
      isFinal ? 1 : 0,
      now,
      now,
      record.id
    );
  } catch (_) {}
}

function succeed(db, record, response, meta) {
  finish(db, record, 'succeeded', response, null, meta);
}

function fail(db, record, error, response, meta) {
  finish(db, record, 'failed', response, error?.message || error || 'AI request failed', meta);
}

function processing(db, record, response, meta) {
  finish(db, record, 'processing', response, null, meta);
}

function finishLatestRelated(db, relatedType, relatedId, result = {}) {
  try {
    const row = db.prepare(
      `SELECT id, created_at
         FROM ai_request_logs
        WHERE related_type = ? AND related_id = ? AND status = 'processing'
        ORDER BY id DESC
        LIMIT 1`
    ).get(String(relatedType), String(relatedId));
    if (!row) return;
    const createdMs = Date.parse(row.created_at);
    const record = {
      id: row.id,
      started_at_ms: Number.isFinite(createdMs) ? createdMs : Date.now(),
    };
    if (result.error) fail(db, record, result.error, result);
    else succeed(db, record, result);
  } catch (_) {}
}

function normalizeFilters(query = {}) {
  const serviceTypes = new Set(['text', 'vision', 'image', 'video', 'tts', 'connection_test']);
  const statuses = new Set(['processing', 'succeeded', 'failed']);
  const serviceType = serviceTypes.has(String(query.service_type)) ? String(query.service_type) : '';
  const status = statuses.has(String(query.status)) ? String(query.status) : '';
  return {
    service_type: serviceType,
    status,
    scene_key: String(query.scene_key || '').trim().slice(0, 100),
    keyword: String(query.keyword || '').trim().slice(0, 200),
    date_from: String(query.date_from || '').trim(),
    date_to: String(query.date_to || '').trim(),
  };
}

function buildWhere(dramaId, filters, userId) {
  const clauses = [];
  const params = [];
  if (dramaId !== null) {
    clauses.push('l.drama_id = ?');
    params.push(Number(dramaId));
  }
  if (positiveInteger(userId)) {
    clauses.push('l.user_id = ?');
    params.push(positiveInteger(userId));
  }
  if (filters.service_type) {
    clauses.push('l.service_type = ?');
    params.push(filters.service_type);
  }
  if (filters.status) {
    clauses.push('l.status = ?');
    params.push(filters.status);
  }
  if (filters.scene_key) {
    clauses.push('l.scene_key = ?');
    params.push(filters.scene_key);
  }
  if (filters.keyword) {
    clauses.push(`(
      l.operation LIKE ? OR l.scene_key LIKE ? OR l.provider LIKE ? OR l.model LIKE ?
      OR l.request_payload LIKE ? OR l.error_message LIKE ?
    )`);
    const like = `%${filters.keyword}%`;
    params.push(like, like, like, like, like, like);
  }
  if (filters.date_from && !Number.isNaN(Date.parse(filters.date_from))) {
    clauses.push('l.created_at >= ?');
    params.push(new Date(filters.date_from).toISOString());
  }
  if (filters.date_to && !Number.isNaN(Date.parse(filters.date_to))) {
    clauses.push('l.created_at <= ?');
    params.push(new Date(filters.date_to).toISOString());
  }
  return { sql: clauses.length ? clauses.join(' AND ') : '1 = 1', params };
}

function extractPreview(payload) {
  if (!payload) return '';
  const values = [
    payload.user_prompt,
    payload.prompt,
    payload.text,
    payload.input,
    payload?.options?.prompt,
  ];
  const first = values.find((value) => typeof value === 'string' && value.trim());
  if (first) return first.trim().replace(/\s+/g, ' ').slice(0, 180);
  try {
    return JSON.stringify(payload).replace(/\s+/g, ' ').slice(0, 180);
  } catch (_) {
    return '';
  }
}

function rowToListItem(row) {
  const requestPayload = parseJson(row.request_payload);
  return {
    id: row.id,
    request_uuid: row.request_uuid,
    drama_id: row.drama_id,
    drama_title: row.drama_title || '',
    user_id: row.user_id,
    username: row.username || '',
    service_type: row.service_type,
    operation: row.operation,
    scene_key: row.scene_key,
    provider: row.provider,
    model: row.model,
    config_id: row.config_id,
    status: row.status,
    error_message: row.error_message,
    duration_ms: row.duration_ms,
    related_type: row.related_type,
    related_id: row.related_id,
    created_at: row.created_at,
    completed_at: row.completed_at,
    updated_at: row.updated_at,
    request_preview: extractPreview(requestPayload),
  };
}

function list(db, dramaId, query = {}, userId) {
  const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, Number.parseInt(query.page_size, 10) || 20));
  const filters = normalizeFilters(query);
  const where = buildWhere(dramaId, filters, userId);
  const total = db.prepare(
    `SELECT COUNT(*) AS count FROM ai_request_logs l WHERE ${where.sql}`
  ).get(...where.params).count;
  const rows = db.prepare(
    `SELECT l.*, u.username, d.title AS drama_title
       FROM ai_request_logs l
       LEFT JOIN user_accounts u ON u.id = l.user_id
       LEFT JOIN dramas d ON d.id = l.drama_id
      WHERE ${where.sql}
      ORDER BY l.created_at DESC, l.id DESC
      LIMIT ? OFFSET ?`
  ).all(...where.params, pageSize, (page - 1) * pageSize);
  return {
    items: rows.map(rowToListItem),
    pagination: {
      page,
      page_size: pageSize,
      total: Number(total || 0),
      total_pages: Math.ceil(Number(total || 0) / pageSize),
    },
  };
}

function getOne(db, dramaId, id, userId) {
  const scopeClause = dramaId === null ? '' : ' AND l.drama_id = ?';
  const ownerClause = positiveInteger(userId) ? ' AND l.user_id = ?' : '';
  const params = dramaId === null ? [Number(id)] : [Number(id), Number(dramaId)];
  if (positiveInteger(userId)) params.push(positiveInteger(userId));
  const row = db.prepare(
    `SELECT l.*, u.username, d.title AS drama_title
       FROM ai_request_logs l
       LEFT JOIN user_accounts u ON u.id = l.user_id
       LEFT JOIN dramas d ON d.id = l.drama_id
      WHERE l.id = ?${scopeClause}${ownerClause}`
  ).get(...params);
  if (!row) return null;
  return {
    ...rowToListItem(row),
    request_payload: parseJson(row.request_payload),
    response_payload: parseJson(row.response_payload),
  };
}

function stats(db, dramaId, userId) {
  const scope = dramaId === null
    ? { sql: '1 = 1', params: [] }
    : { sql: 'drama_id = ?', params: [Number(dramaId)] };
  if (positiveInteger(userId)) {
    scope.sql += ' AND user_id = ?';
    scope.params.push(positiveInteger(userId));
  }
  const summary = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
       SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed,
       SUM(CASE WHEN status = 'processing' THEN 1 ELSE 0 END) AS processing,
       SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END) AS today,
       CAST(AVG(CASE WHEN status != 'processing' THEN duration_ms END) AS SIGNED) AS avg_duration_ms
     FROM ai_request_logs
     WHERE ${scope.sql}`
  ).get(new Date(new Date().setHours(0, 0, 0, 0)).toISOString(), ...scope.params);
  const serviceRows = db.prepare(
    `SELECT service_type, COUNT(*) AS count
       FROM ai_request_logs
      WHERE ${scope.sql}
      GROUP BY service_type`
  ).all(...scope.params);
  return {
    total: Number(summary.total || 0),
    succeeded: Number(summary.succeeded || 0),
    failed: Number(summary.failed || 0),
    processing: Number(summary.processing || 0),
    today: Number(summary.today || 0),
    avg_duration_ms: Number(summary.avg_duration_ms || 0),
    service_counts: Object.fromEntries(
      serviceRows.map((row) => [row.service_type, Number(row.count || 0)])
    ),
  };
}

function remove(db, dramaId, id, userId) {
  if (positiveInteger(userId)) {
    const dramaClause = dramaId === null ? '' : ' AND drama_id = ?';
    const params = [Number(id), positiveInteger(userId)];
    if (dramaId !== null) params.push(Number(dramaId));
    return db.prepare(
      `DELETE FROM ai_request_logs WHERE id = ? AND user_id = ?${dramaClause}`
    ).run(...params).changes > 0;
  }
  if (dramaId === null) {
    return db.prepare('DELETE FROM ai_request_logs WHERE id = ?').run(Number(id)).changes > 0;
  }
  return db.prepare('DELETE FROM ai_request_logs WHERE id = ? AND drama_id = ?')
    .run(Number(id), Number(dramaId)).changes > 0;
}

function clear(db, dramaId, query = {}, userId) {
  const status = ['processing', 'succeeded', 'failed'].includes(String(query.status))
    ? String(query.status)
    : '';
  if (positiveInteger(userId)) {
    const clauses = ['user_id = ?'];
    const params = [positiveInteger(userId)];
    if (dramaId !== null) {
      clauses.push('drama_id = ?');
      params.push(Number(dramaId));
    }
    if (status) {
      clauses.push('status = ?');
      params.push(status);
    }
    return db.prepare(
      `DELETE FROM ai_request_logs WHERE ${clauses.join(' AND ')}`
    ).run(...params).changes;
  }
  if (dramaId === null) {
    if (status) {
      return db.prepare('DELETE FROM ai_request_logs WHERE status = ?').run(status).changes;
    }
    return db.prepare('DELETE FROM ai_request_logs').run().changes;
  }
  if (status) {
    return db.prepare(
      'DELETE FROM ai_request_logs WHERE drama_id = ? AND status = ?'
    ).run(Number(dramaId), status).changes;
  }
  return db.prepare(
    'DELETE FROM ai_request_logs WHERE drama_id = ?'
  ).run(Number(dramaId)).changes;
}

module.exports = {
  requestContextMiddleware,
  currentRequest,
  currentUserId,
  currentUsername,
  resolveDramaId,
  sanitizeValue,
  start,
  succeed,
  fail,
  processing,
  finishLatestRelated,
  list,
  getOne,
  stats,
  remove,
  clear,
};

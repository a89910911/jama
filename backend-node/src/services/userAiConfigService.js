'use strict';

const { forceVideoAudioSettings } = require('./videoAudioPolicy');
const { insertIgnoreSql, upsertSql } = require('../db/portableSql');

const SERVICE_TYPES = new Set([
  'text',
  'image',
  'storyboard_image',
  'video',
  'tts',
]);

const SECRET_SETTING_KEYS = new Set([
  'access_key',
  'access_key_id',
  'secret_key',
  'secret_access_key',
  'session_token',
  'token',
  'kling_access_key',
  'kling_secret_key',
  'jimeng_token',
]);

function requireUserId(value) {
  const userId = Number(value);
  if (!Number.isInteger(userId) || userId <= 0) {
    const error = new Error('缺少有效的用户身份');
    error.code = 'UNAUTHORIZED';
    throw error;
  }
  return userId;
}

function normalizeServiceType(value) {
  const serviceType = String(value || 'text').trim().toLowerCase();
  if (!SERVICE_TYPES.has(serviceType)) {
    const error = new Error(`不支持的 AI 服务类型: ${serviceType}`);
    error.code = 'INVALID_SERVICE_TYPE';
    throw error;
  }
  return serviceType;
}

function parseJsonObject(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return { ...value };
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : {};
  } catch (_) {
    return {};
  }
}

function parseModels(value) {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) {
      return parsed.map(String).map((item) => item.trim()).filter(Boolean);
    }
  } catch (_) {}
  return [String(value).trim()].filter(Boolean);
}

function modelToDb(value) {
  return JSON.stringify(parseModels(value));
}

function extractCredentials(settingsValue, suppliedCredentials = {}) {
  const settings = parseJsonObject(settingsValue);
  const credentials = parseJsonObject(suppliedCredentials);
  for (const key of Object.keys(settings)) {
    if (!SECRET_SETTING_KEYS.has(key)) continue;
    if (settings[key] != null && settings[key] !== '') credentials[key] = settings[key];
    delete settings[key];
  }
  return { settings, credentials };
}

function normalizeSettings(serviceType, settings) {
  const value = Object.keys(settings || {}).length ? JSON.stringify(settings) : null;
  return forceVideoAudioSettings(serviceType, value);
}

function inferEndpoints(input) {
  let endpoint = input.endpoint || '';
  let queryEndpoint = input.query_endpoint || '';
  if (endpoint || !input.provider) return { endpoint, queryEndpoint };

  const provider = String(input.provider).toLowerCase();
  const serviceType = normalizeServiceType(input.service_type);
  if (provider === 'openai' || provider === 'agnes') {
    if (serviceType === 'text') endpoint = '/chat/completions';
    else if (serviceType === 'image' || serviceType === 'storyboard_image') endpoint = '/images/generations';
    else if (serviceType === 'video') {
      endpoint = '/videos';
      queryEndpoint = '/videos/{taskId}';
    }
  } else if (provider === 'gemini' || provider === 'google') {
    endpoint = '/v1beta/models/{model}:generateContent';
  } else if (provider === 'dashscope' || provider === 'qwen_image') {
    if (serviceType === 'image' || serviceType === 'storyboard_image') {
      endpoint = '/api/v1/services/aigc/multimodal-generation/generation';
    } else if (serviceType === 'video' && provider === 'dashscope') {
      endpoint = '/api/v1/services/aigc/image2video/video-synthesis';
      queryEndpoint = '/api/v1/tasks/{taskId}';
    }
  } else if (['volces', 'volcengine', 'volc'].includes(provider)) {
    if (serviceType === 'video') {
      endpoint = '/contents/generations/tasks';
      queryEndpoint = '/contents/generations/tasks/{taskId}';
    } else if (serviceType === 'image' || serviceType === 'storyboard_image') {
      endpoint = '/images/generations';
    }
  } else if (provider === 'nano_banana') {
    endpoint = '/api/v1/nanobanana/generate-2';
    queryEndpoint = '/api/v1/nanobanana/record-info';
  }
  return { endpoint, queryEndpoint };
}

function maskSecret(value) {
  const text = String(value || '');
  if (!text) return '';
  if (text.length <= 4) return '••••';
  return `••••${text.slice(-4)}`;
}

function credentialSummary(apiKey, credentials) {
  const result = {};
  if (apiKey) {
    result.api_key = { configured: true, mask: maskSecret(apiKey) };
  } else {
    result.api_key = { configured: false, mask: '' };
  }
  for (const [key, value] of Object.entries(credentials || {})) {
    result[key] = {
      configured: value != null && String(value) !== '',
      mask: value != null && String(value) !== '' ? maskSecret(value) : '',
    };
  }
  return result;
}

function baseSelect() {
  return `
    SELECT
      c.id, c.user_id, c.service_type, c.name, c.priority, c.is_active,
      c.template_key, c.current_revision_id, c.created_at, c.updated_at, c.deleted_at,
      r.id AS revision_id, r.revision_no, r.provider, r.api_protocol, r.base_url,
      r.api_key, r.credentials_json, r.model_json, r.default_model, r.endpoint,
      r.query_endpoint, r.settings_json,
      CASE WHEN d.config_id = c.id THEN 1 ELSE 0 END AS is_default
    FROM user_ai_configs c
    JOIN user_ai_config_revisions r
      ON r.id = c.current_revision_id
     AND r.config_id = c.id
     AND r.user_id = c.user_id
    LEFT JOIN user_ai_config_defaults d
      ON d.user_id = c.user_id
     AND d.service_type = c.service_type
  `;
}

function rowToRuntimeConfig(row) {
  if (!row) return null;
  const serviceType = String(row.service_type || '').trim().toLowerCase();
  if (!SERVICE_TYPES.has(serviceType)) return null;
  const credentials = parseJsonObject(row.credentials_json);
  const publicSettings = parseJsonObject(row.settings_json);
  const runtimeSettings = { ...publicSettings, ...credentials };
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    service_type: serviceType,
    name: row.name || '',
    provider: row.provider || '',
    api_protocol: row.api_protocol || '',
    base_url: row.base_url || '',
    api_key: row.api_key || '',
    credentials,
    model: parseModels(row.model_json),
    default_model: row.default_model ? String(row.default_model).trim() : null,
    endpoint: row.endpoint || '',
    query_endpoint: row.query_endpoint || '',
    priority: Number(row.priority || 0),
    is_default: !!row.is_default,
    is_active: row.is_active == null ? true : !!row.is_active,
    template_key: row.template_key || null,
    settings: forceVideoAudioSettings(
      serviceType,
      Object.keys(runtimeSettings).length ? JSON.stringify(runtimeSettings) : null
    ),
    public_settings: Object.keys(publicSettings).length ? JSON.stringify(publicSettings) : null,
    revision_id: Number(row.revision_id),
    revision_no: Number(row.revision_no || 1),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function runtimeToPublic(config) {
  if (!config) return null;
  const {
    api_key: apiKey,
    credentials,
    settings: _runtimeSettings,
    public_settings: publicSettings,
    ...safe
  } = config;
  return {
    ...safe,
    settings: publicSettings,
    has_credentials: !!apiKey || Object.values(credentials || {}).some(Boolean),
    credentials: credentialSummary(apiKey, credentials),
  };
}

function listRuntimeConfigs(db, userIdValue, serviceTypeValue) {
  const userId = requireUserId(userIdValue);
  const params = [userId];
  let where = ' WHERE c.user_id = ? AND c.deleted_at IS NULL';
  if (serviceTypeValue) {
    where += ' AND c.service_type = ?';
    params.push(normalizeServiceType(serviceTypeValue));
  }
  const rows = db.prepare(
    `${baseSelect()}${where}
     ORDER BY is_default DESC, c.priority DESC, c.created_at DESC, c.id ASC`
  ).all(...params);
  return rows.map(rowToRuntimeConfig).filter(Boolean);
}

function listConfigs(db, userId, serviceType) {
  return listRuntimeConfigs(db, userId, serviceType).map(runtimeToPublic);
}

function getRuntimeConfig(db, userIdValue, configIdValue, options = {}) {
  const userId = requireUserId(userIdValue);
  const configId = Number(configIdValue);
  if (!Number.isInteger(configId) || configId <= 0) return null;
  const deletedClause = options.includeDeleted ? '' : ' AND c.deleted_at IS NULL';
  const row = db.prepare(
    `${baseSelect()}
     WHERE c.id = ? AND c.user_id = ?${deletedClause}`
  ).get(configId, userId);
  return rowToRuntimeConfig(row);
}

function getRuntimeConfigByRevision(db, userIdValue, configIdValue, revisionIdValue, options = {}) {
  const userId = requireUserId(userIdValue);
  const configId = Number(configIdValue);
  const revisionId = Number(revisionIdValue);
  if (![configId, revisionId].every((value) => Number.isInteger(value) && value > 0)) return null;
  const deletedClause = options.includeDeleted ? '' : ' AND c.deleted_at IS NULL';
  const row = db.prepare(`
    SELECT
      c.id, c.user_id, c.service_type, c.name, c.priority, c.is_active,
      c.template_key, c.current_revision_id, c.created_at, c.updated_at, c.deleted_at,
      r.id AS revision_id, r.revision_no, r.provider, r.api_protocol, r.base_url,
      r.api_key, r.credentials_json, r.model_json, r.default_model, r.endpoint,
      r.query_endpoint, r.settings_json,
      CASE WHEN d.config_id = c.id THEN 1 ELSE 0 END AS is_default
    FROM user_ai_configs c
    JOIN user_ai_config_revisions r
      ON r.id = ?
     AND r.config_id = c.id
     AND r.user_id = c.user_id
    LEFT JOIN user_ai_config_defaults d
      ON d.user_id = c.user_id
     AND d.service_type = c.service_type
    WHERE c.id = ? AND c.user_id = ?${deletedClause}
  `).get(revisionId, configId, userId);
  return rowToRuntimeConfig(row);
}

function getConfig(db, userId, configId) {
  return runtimeToPublic(getRuntimeConfig(db, userId, configId));
}

function defaultRow(db, userId, serviceType) {
  return db.prepare(
    'SELECT config_id FROM user_ai_config_defaults WHERE user_id = ? AND service_type = ?'
  ).get(userId, serviceType);
}

function setDefaultInternal(db, userId, serviceType, configId, now) {
  db.prepare(
    'DELETE FROM user_ai_config_defaults WHERE user_id = ? AND service_type = ?'
  ).run(userId, serviceType);
  db.prepare(
    `INSERT INTO user_ai_config_defaults
      (user_id, service_type, config_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(userId, serviceType, configId, now, now);
}

function chooseReplacementDefault(db, userId, serviceType, excludedId, now) {
  const row = db.prepare(
    `SELECT id FROM user_ai_configs
      WHERE user_id = ? AND service_type = ? AND deleted_at IS NULL
        AND is_active = 1 AND id != ?
      ORDER BY priority DESC, created_at DESC, id ASC
      LIMIT 1`
  ).get(userId, serviceType, excludedId || 0);
  db.prepare(
    'DELETE FROM user_ai_config_defaults WHERE user_id = ? AND service_type = ?'
  ).run(userId, serviceType);
  if (row) setDefaultInternal(db, userId, serviceType, row.id, now);
  return row?.id || null;
}

function normalizeApiKey(serviceType, value) {
  return value == null ? '' : String(value);
}

function revisionInsertValues(config, revisionNo, payload, previous = null, createdAt = null) {
  const serviceType = config.service_type;
  const extracted = extractCredentials(
    payload.settings !== undefined ? payload.settings : previous?.public_settings,
    payload.credentials !== undefined ? payload.credentials : previous?.credentials
  );
  const credentials = {
    ...(previous?.credentials || {}),
    ...extracted.credentials,
    ...parseJsonObject(payload.credential_updates),
  };
  for (const key of Array.isArray(payload.clear_credentials) ? payload.clear_credentials : []) {
    delete credentials[String(key)];
  }

  let apiKey = previous?.api_key || '';
  if (payload.api_key !== undefined) apiKey = payload.api_key;
  if (Object.prototype.hasOwnProperty.call(parseJsonObject(payload.credential_updates), 'api_key')) {
    apiKey = parseJsonObject(payload.credential_updates).api_key;
    delete credentials.api_key;
  }
  if ((payload.clear_credentials || []).includes('api_key')) apiKey = '';
  apiKey = normalizeApiKey(serviceType, apiKey);

  const provider = payload.provider !== undefined ? String(payload.provider || '') : previous?.provider || '';
  const endpoints = inferEndpoints({
    service_type: serviceType,
    provider,
    endpoint: payload.endpoint !== undefined ? payload.endpoint : previous?.endpoint,
    query_endpoint: payload.query_endpoint !== undefined
      ? payload.query_endpoint
      : previous?.query_endpoint,
  });
  const models = payload.model !== undefined ? parseModels(payload.model) : previous?.model || [];
  const requestedDefault = payload.default_model !== undefined
    ? String(payload.default_model || '').trim()
    : previous?.default_model || '';
  const defaultModel = models.includes(requestedDefault)
    ? requestedDefault
    : models[0] || null;
  const settings = normalizeSettings(serviceType, extracted.settings);
  const now = createdAt || new Date().toISOString();
  return [
    config.id,
    config.user_id,
    revisionNo,
    provider,
    payload.api_protocol !== undefined
      ? String(payload.api_protocol || '')
      : previous?.api_protocol || '',
    payload.base_url !== undefined ? String(payload.base_url || '') : previous?.base_url || '',
    apiKey,
    JSON.stringify(credentials),
    modelToDb(models),
    defaultModel,
    endpoints.endpoint,
    endpoints.queryEndpoint,
    settings,
    now,
  ];
}

function insertRevision(db, config, revisionNo, payload, previous = null) {
  const values = revisionInsertValues(config, revisionNo, payload, previous);
  const info = db.prepare(`
    INSERT INTO user_ai_config_revisions
      (config_id, user_id, revision_no, provider, api_protocol, base_url, api_key,
       credentials_json, model_json, default_model, endpoint, query_endpoint,
       settings_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(...values);
  return Number(info.lastInsertRowid);
}

function createConfig(db, log, userIdValue, request) {
  const userId = requireUserId(userIdValue);
  const serviceType = normalizeServiceType(request.service_type);
  const name = String(request.name || '').trim();
  const provider = String(request.provider || '').trim();
  const baseUrl = String(request.base_url || '').trim();
  if (!name || !provider || !baseUrl) {
    const error = new Error('缺少必填字段: name, provider, base_url');
    error.code = 'INVALID_AI_CONFIG';
    throw error;
  }
  const now = new Date().toISOString();
  const create = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO user_ai_configs
        (user_id, service_type, name, priority, is_active, template_key,
         current_revision_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      userId,
      serviceType,
      name,
      Number(request.priority || 0),
      request.is_active === false ? 0 : 1,
      request.template_key || null,
      now,
      now
    );
    const configId = Number(info.lastInsertRowid);
    const config = { id: configId, user_id: userId, service_type: serviceType };
    const revisionId = insertRevision(db, config, 1, request);
    db.prepare(
      'UPDATE user_ai_configs SET current_revision_id = ?, updated_at = ? WHERE id = ? AND user_id = ?'
    ).run(revisionId, now, configId, userId);

    const hasDefault = !!defaultRow(db, userId, serviceType);
    if (request.is_default || (!hasDefault && request.is_active !== false)) {
      setDefaultInternal(db, userId, serviceType, configId, now);
    }
    return configId;
  });
  const configId = create();
  log?.info?.('User AI config created', {
    user_id: userId,
    config_id: configId,
    service_type: serviceType,
    provider,
  });
  return getConfig(db, userId, configId);
}

function updateConfig(db, log, userIdValue, configIdValue, request) {
  const userId = requireUserId(userIdValue);
  const configId = Number(configIdValue);
  const existing = getRuntimeConfig(db, userId, configId);
  if (!existing) return null;
  const now = new Date().toISOString();
  const update = db.transaction(() => {
    const nextRevision = Number(existing.revision_no || 0) + 1;
    const revisionId = insertRevision(
      db,
      { id: configId, user_id: userId, service_type: existing.service_type },
      nextRevision,
      request,
      existing
    );
    const name = request.name !== undefined ? String(request.name || '').trim() : existing.name;
    const priority = request.priority !== undefined ? Number(request.priority || 0) : existing.priority;
    const isActive = request.is_active !== undefined ? !!request.is_active : existing.is_active;
    const templateKey = request.template_key !== undefined
      ? request.template_key || null
      : existing.template_key;
    db.prepare(`
      UPDATE user_ai_configs
         SET name = ?, priority = ?, is_active = ?, template_key = ?,
             current_revision_id = ?, updated_at = ?
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL
    `).run(name, priority, isActive ? 1 : 0, templateKey, revisionId, now, configId, userId);

    if (request.is_default === true) {
      if (!isActive) {
        const error = new Error('停用的配置不能设为默认配置');
        error.code = 'AI_CONFIG_INACTIVE';
        throw error;
      }
      setDefaultInternal(db, userId, existing.service_type, configId, now);
    } else if (!isActive && existing.is_default) {
      chooseReplacementDefault(db, userId, existing.service_type, configId, now);
    }
  });
  update();
  log?.info?.('User AI config updated', { user_id: userId, config_id: configId });
  return getConfig(db, userId, configId);
}

function setDefaultConfig(db, log, userIdValue, configIdValue) {
  const userId = requireUserId(userIdValue);
  const configId = Number(configIdValue);
  const existing = getRuntimeConfig(db, userId, configId);
  if (!existing) return null;
  if (!existing.is_active) {
    const error = new Error('停用的配置不能设为默认配置');
    error.code = 'AI_CONFIG_INACTIVE';
    throw error;
  }
  const now = new Date().toISOString();
  const set = db.transaction(() => {
    setDefaultInternal(db, userId, existing.service_type, configId, now);
  });
  set();
  log?.info?.('User AI config set default', {
    user_id: userId,
    config_id: configId,
    service_type: existing.service_type,
  });
  return getConfig(db, userId, configId);
}

function deleteConfig(db, log, userIdValue, configIdValue) {
  const userId = requireUserId(userIdValue);
  const configId = Number(configIdValue);
  const existing = getRuntimeConfig(db, userId, configId);
  if (!existing) return false;
  const now = new Date().toISOString();
  const remove = db.transaction(() => {
    db.prepare(
      `UPDATE user_ai_configs
          SET deleted_at = ?, updated_at = ?
        WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    ).run(now, now, configId, userId);
    if (existing.is_default) {
      chooseReplacementDefault(db, userId, existing.service_type, configId, now);
    }
  });
  remove();
  log?.info?.('User AI config deleted', { user_id: userId, config_id: configId });
  return true;
}

function bulkUpdateApiKey(db, log, userIdValue, newKey) {
  const userId = requireUserId(userIdValue);
  const configs = listRuntimeConfigs(db, userId);
  for (const config of configs) {
    updateConfig(db, log, userId, config.id, {
      credential_updates: { api_key: String(newKey || '') },
    });
  }
  return configs.length;
}

function bulkValuesClause(rowCount, columnCount) {
  const row = `(${Array.from({ length: columnCount }, () => '?').join(', ')})`;
  return Array.from({ length: rowCount }, () => row).join(', ');
}

function flattenRows(rows) {
  return rows.flatMap((row) => row);
}

function legacyConfigRequest(row) {
  return {
    service_type: row.service_type,
    provider: row.provider,
    api_protocol: row.api_protocol || '',
    name: row.name || `${row.provider || 'AI'} ${row.service_type || 'text'}`,
    base_url: row.base_url,
    api_key: row.api_key || '',
    model: parseModels(row.model),
    default_model: row.default_model,
    endpoint: row.endpoint,
    query_endpoint: row.query_endpoint,
    priority: row.priority,
    is_default: !!row.is_default,
    is_active: row.is_active == null ? true : !!row.is_active,
    settings: row.settings,
    template_key: `legacy_ai_service_config:${row.id}`,
  };
}

function migrateLegacyConfigs(db, log, userIdValue) {
  const userId = requireUserId(userIdValue);
  let rows = [];
  try {
    rows = db.prepare(
      'SELECT * FROM ai_service_configs WHERE deleted_at IS NULL ORDER BY id ASC'
    ).all().filter((row) => SERVICE_TYPES.has(String(row.service_type || '').trim().toLowerCase()));
  } catch (_) {
    return { migrated: 0, scene_maps: 0, skipped: true };
  }
  if (!rows.length) return { migrated: 0, scene_maps: 0, skipped: true };

  const migrate = db.transaction(() => {
    const now = new Date().toISOString();
    const requests = rows.map((row) => ({
      legacyId: Number(row.id),
      request: legacyConfigRequest(row),
    }));
    const templateKeys = requests.map(({ request }) => request.template_key);
    const existingConfigs = db.prepare(
      `SELECT id, template_key, service_type
         FROM user_ai_configs
        WHERE user_id = ? AND template_key IN (${templateKeys.map(() => '?').join(', ')})
        ORDER BY id ASC`
    ).all(userId, ...templateKeys);
    const configByTemplate = new Map();
    for (const config of existingConfigs) {
      if (!configByTemplate.has(config.template_key)) {
        configByTemplate.set(config.template_key, config);
      }
    }

    const missing = requests.filter(({ request }) => !configByTemplate.has(request.template_key));
    if (missing.length) {
      const configRows = missing.map(({ request }) => {
        const serviceType = normalizeServiceType(request.service_type);
        const name = String(request.name || '').trim();
        const provider = String(request.provider || '').trim();
        const baseUrl = String(request.base_url || '').trim();
        if (!name || !provider || !baseUrl) {
          const error = new Error('缂哄皯蹇呭～瀛楁: name, provider, base_url');
          error.code = 'INVALID_AI_CONFIG';
          throw error;
        }
        return [
          userId,
          serviceType,
          name,
          Number(request.priority || 0),
          request.is_active === false ? 0 : 1,
          request.template_key,
          null,
          now,
          now,
        ];
      });
      db.prepare(`
        INSERT INTO user_ai_configs
          (user_id, service_type, name, priority, is_active, template_key,
           current_revision_id, created_at, updated_at)
        VALUES ${bulkValuesClause(configRows.length, configRows[0].length)}
      `).run(...flattenRows(configRows));

      const createdConfigs = db.prepare(
        `SELECT id, template_key, service_type
           FROM user_ai_configs
          WHERE user_id = ? AND template_key IN (${missing.map(() => '?').join(', ')})
          ORDER BY id ASC`
      ).all(userId, ...missing.map(({ request }) => request.template_key));
      for (const config of createdConfigs) {
        if (!configByTemplate.has(config.template_key)) {
          configByTemplate.set(config.template_key, config);
        }
      }

      const revisionRows = missing.map(({ request }) => {
        const config = configByTemplate.get(request.template_key);
        if (!config?.id) {
          throw new Error(`Bulk AI config migration could not resolve ${request.template_key}`);
        }
        return revisionInsertValues(
          {
            id: Number(config.id),
            user_id: userId,
            service_type: normalizeServiceType(request.service_type),
          },
          1,
          request,
          null,
          now
        );
      });
      db.prepare(`
        INSERT INTO user_ai_config_revisions
          (config_id, user_id, revision_no, provider, api_protocol, base_url, api_key,
           credentials_json, model_json, default_model, endpoint, query_endpoint,
           settings_json, created_at)
        VALUES ${bulkValuesClause(revisionRows.length, revisionRows[0].length)}
      `).run(...flattenRows(revisionRows));

      const configIds = missing.map(({ request }) =>
        Number(configByTemplate.get(request.template_key).id)
      );
      const revisions = db.prepare(
        `SELECT id, config_id
           FROM user_ai_config_revisions
          WHERE user_id = ? AND revision_no = 1
            AND config_id IN (${configIds.map(() => '?').join(', ')})`
      ).all(userId, ...configIds);
      const revisionByConfig = new Map(
        revisions.map((revision) => [Number(revision.config_id), Number(revision.id)])
      );
      const cases = [];
      const caseValues = [];
      for (const configId of configIds) {
        const revisionId = revisionByConfig.get(configId);
        if (!revisionId) {
          throw new Error(`Bulk AI config migration could not resolve revision for ${configId}`);
        }
        cases.push('WHEN ? THEN ?');
        caseValues.push(configId, revisionId);
      }
      db.prepare(`
        UPDATE user_ai_configs
           SET current_revision_id = CASE id ${cases.join(' ')} ELSE current_revision_id END,
               updated_at = ?
         WHERE user_id = ? AND id IN (${configIds.map(() => '?').join(', ')})
      `).run(...caseValues, now, userId, ...configIds);
    }

    const idMap = new Map();
    for (const { legacyId, request } of requests) {
      const config = configByTemplate.get(request.template_key);
      if (!config?.id) {
        throw new Error(`Bulk AI config migration missing ${request.template_key}`);
      }
      idMap.set(legacyId, Number(config.id));
    }

    const desiredDefaults = new Map();
    for (const row of rows) {
      const serviceType = normalizeServiceType(row.service_type);
      const configId = idMap.get(Number(row.id));
      if (row.is_default || (!desiredDefaults.has(serviceType) && row.is_active !== 0)) {
        desiredDefaults.set(serviceType, configId);
      }
    }
    if (desiredDefaults.size) {
      const defaultRows = [...desiredDefaults.entries()].map(([serviceType, configId]) => [
        userId,
        serviceType,
        configId,
        now,
        now,
      ]);
      const defaultInsert = `
        INSERT INTO user_ai_config_defaults
          (user_id, service_type, config_id, created_at, updated_at)
        VALUES ${bulkValuesClause(defaultRows.length, defaultRows[0].length)}
      `;
      db.prepare(upsertSql(
        db,
        defaultInsert,
        ['user_id', 'service_type'],
        ['config_id', 'updated_at']
      )).run(...flattenRows(defaultRows));
    }

    let sceneMaps = [];
    try {
      sceneMaps = db.prepare('SELECT * FROM ai_model_map ORDER BY id ASC').all();
    } catch (_) {}
    let sceneMapCount = 0;
    if (sceneMaps.length) {
      const sceneKeys = sceneMaps.map((map) => map.key);
      const existingMaps = db.prepare(
        `SELECT scene_key
           FROM user_ai_scene_model_maps
          WHERE user_id = ? AND scene_key IN (${sceneKeys.map(() => '?').join(', ')})`
      ).all(userId, ...sceneKeys);
      const existingKeys = new Set(existingMaps.map((map) => map.scene_key));
      const missingMaps = sceneMaps.filter((map) => !existingKeys.has(map.key));
      if (missingMaps.length) {
        const mapRows = missingMaps.map((map) => [
          userId,
          map.key,
          map.service_type || 'text',
          map.config_id ? idMap.get(Number(map.config_id)) || null : null,
          map.model_override || null,
          map.description || '',
          now,
          now,
        ]);
        const insertMaps = `
          INSERT INTO user_ai_scene_model_maps
            (user_id, scene_key, service_type, config_id, model_override,
             description, created_at, updated_at)
          VALUES ${bulkValuesClause(mapRows.length, mapRows[0].length)}
        `;
        db.prepare(insertIgnoreSql(db, insertMaps)).run(...flattenRows(mapRows));
        sceneMapCount = missingMaps.length;
      }
    }

    db.prepare(
      'UPDATE ai_service_configs SET deleted_at = ?, updated_at = ? WHERE deleted_at IS NULL'
    ).run(now, now);
    return { migrated: missing.length, scene_maps: sceneMapCount };
  });
  const result = migrate();
  log?.info?.('Legacy AI configs migrated in bulk', {
    user_id: userId,
    migrated: result.migrated,
    scene_maps: result.scene_maps,
  });
  return { ...result, skipped: false };
}

module.exports = {
  SERVICE_TYPES,
  bulkUpdateApiKey,
  createConfig,
  deleteConfig,
  getConfig,
  getRuntimeConfig,
  getRuntimeConfigByRevision,
  listConfigs,
  listRuntimeConfigs,
  maskSecret,
  migrateLegacyConfigs,
  normalizeServiceType,
  requireUserId,
  runtimeToPublic,
  setDefaultConfig,
  updateConfig,
};

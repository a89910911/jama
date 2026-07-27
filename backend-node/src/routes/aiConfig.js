const aiConfigService = require('../services/aiConfigService');
const userAiConfigService = require('../services/userAiConfigService');
const aiRequestLogService = require('../services/aiRequestLogService');
const response = require('../response');

function list(db) {
  return (req, res) => {
    const list = userAiConfigService.listConfigs(db, req.user.id, req.query.service_type);
    response.success(res, list);
  };
}

function get(db) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const config = userAiConfigService.getConfig(db, req.user.id, id);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

function vendorLock(cfg) {
  return (req, res) => {
    const status = aiConfigService.getVendorLockStatus(cfg);
    response.success(res, {
      enabled: false,
      template_policy_enabled: status.enabled,
      config_file: status.config_file,
    });
  };
}

function create(db, log, cfg) {
  return (req, res) => {
    const body = req.body || {};
    if (!body.service_type || !body.name || !body.provider || !body.base_url) {
      return response.badRequest(res, '缺少必填字段: service_type, name, provider, base_url');
    }
    if (body.api_key === undefined || body.api_key === null) {
      return response.badRequest(res, '缺少必填字段: api_key');
    }
    try {
      const config = userAiConfigService.createConfig(db, log, req.user.id, {
        ...body,
        model: body.model ?? [],
      });
      response.created(res, config);
    } catch (err) {
      log.errorw('Create AI config failed', { error: err.message });
      response.internalError(res, '创建失败');
    }
  };
}

function update(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');

    const body = req.body || {};

    const config = userAiConfigService.updateConfig(db, log, req.user.id, id, body);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

function setDefault(db, log) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置 ID');

    try {
      const config = userAiConfigService.setDefaultConfig(db, log, req.user.id, id);
      if (!config) return response.notFound(res, '配置不存在');
      response.success(res, config);
    } catch (err) {
      log.error('Set default AI config failed', { config_id: id, error: err.message });
      response.internalError(res, '设置默认配置失败');
    }
  };
}

function listModels(db, log) {
  return async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置 ID');
    const config = userAiConfigService.getRuntimeConfig(db, req.user.id, id);
    if (!config) return response.notFound(res, '配置不存在');

    try {
      const result = await aiConfigService.listAvailableModels({
        ...config,
        service_type: req.query.service_type || config.service_type,
      });
      response.success(res, result);
    } catch (err) {
      log.error('List provider models failed', {
        config_id: id,
        provider: config.provider,
        error: err.message,
      });
      response.badRequest(res, err.message || '同步模型失败');
    }
  };
}

function remove(db, log, cfg) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const ok = userAiConfigService.deleteConfig(db, log, req.user.id, id);
    if (!ok) return response.notFound(res, '配置不存在');
    response.success(res, { message: '删除成功' });
  };
}

function bulkUpdateKey(db, log, cfg) {
  return (req, res) => {
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的 API Key');
    }
    try {
      const count = userAiConfigService.bulkUpdateApiKey(db, log, req.user.id, api_key.trim());
      response.success(res, { updated: count, message: `已更新 ${count} 条配置的 API Key` });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换Key失败');
    }
  };
}

function testConnection(db, log) {
  return async (req, res) => {
    const requested = req.body || {};
    const savedConfig = requested.config_id
      ? userAiConfigService.getRuntimeConfig(
          db,
          req.user.id,
          Number(requested.config_id)
        )
      : null;
    if (requested.config_id && !savedConfig) {
      return response.notFound(res, '配置不存在');
    }
    const body = savedConfig
      ? {
          ...savedConfig,
          ...requested,
          api_key: savedConfig.api_key,
          settings: savedConfig.settings,
        }
      : requested;
    const model = Array.isArray(body.model) ? body.model[0] : body.model;
    const record = aiRequestLogService.start(db, {
      user_id: req.user.id,
      service_type: 'connection_test',
      operation: 'test_connection',
      provider: body.provider || null,
      model: model || null,
      request: {
        base_url: body.base_url,
        api_key: body.api_key,
        model: body.model,
        provider: body.provider,
        api_protocol: body.api_protocol,
        endpoint: body.endpoint,
        service_type: body.service_type,
      },
    });
    if (!body.base_url || !body.api_key) {
      return response.badRequest(res, '缺少 base_url 或 api_key');
    }
    try {
      await aiConfigService.testConnection({
        base_url: body.base_url,
        api_key: body.api_key,
        model: body.model,
        provider: body.provider,
        api_protocol: body.api_protocol,
        endpoint: body.endpoint,
        service_type: body.service_type,
        settings: body.settings,
      });
      aiRequestLogService.succeed(db, record, { connected: true });
      response.success(res, { message: '连接测试成功' });
    } catch (err) {
      aiRequestLogService.fail(db, record, err);
      log.error('AI config test connection failed', { error: err.message });
      response.badRequest(res, '连接测试失败: ' + (err.message || '未知错误'));
    }
  };
}

/** ModelArk / 方舟私有资产库：代理调用 CreateAssetGroup、ListAssets 等（与官方 Action 名一致） */
function parseSettings(value) {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

function modelArkAsset(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const action = (body.action || '').toString().trim();
    const configId = Number.parseInt(body.config_id, 10);
    const savedConfig = Number.isInteger(configId) && configId > 0
      ? userAiConfigService.getRuntimeConfig(db, req.user.id, configId)
      : null;
    if (Number.isInteger(configId) && configId > 0 && !savedConfig) {
      return response.notFound(res, '配置不存在');
    }
    if (savedConfig && savedConfig.service_type !== 'model_ark_asset') {
      return response.badRequest(res, '所选配置不是 SD2 资产库配置');
    }
    if (savedConfig && !savedConfig.is_active) {
      return response.badRequest(res, '所选配置未启用');
    }
    const savedSettings = parseSettings(savedConfig?.settings);
    const valueOrSaved = (value, key) => {
      const clean = value == null ? '' : String(value).trim();
      return clean || savedSettings[key];
    };
    try {
      const modelArkAssetProxyService = require('../services/modelArkAssetProxyService');
      const data = await modelArkAssetProxyService.callModelArkAsset(
        {
          base_url: body.base_url || savedConfig?.base_url,
          api_key: body.api_key || savedConfig?.api_key,
          action,
          body: body.payload,
          path_mode: body.path_mode || savedSettings.path_mode,
          http_method: body.http_method,
          api_version: body.api_version || savedSettings.api_version,
          auth_mode: body.auth_mode || savedSettings.auth_mode,
          access_key_id: valueOrSaved(body.access_key_id, 'access_key_id'),
          secret_access_key: valueOrSaved(body.secret_access_key, 'secret_access_key'),
          sign_region: body.sign_region || savedSettings.sign_region,
          sign_service: body.sign_service || savedSettings.sign_service,
          session_token: valueOrSaved(body.session_token, 'session_token'),
          project_name: body.project_name || savedSettings.project_name,
        },
        log
      );
      response.success(res, data);
    } catch (err) {
      log.error('model-ark-asset proxy failed', { error: err.message, action });
      const status = err.status >= 400 && err.status < 600 ? err.status : 400;
      return response.error(res, status, 'MODEL_ARK_ASSET', err.message || '请求失败', err.payload);
    }
  };
}

/** 即梦2角色认证：代理 GET 素材列表（表单未保存也可用当前填写的网关与 Token） */
function listJimeng2MaterialAssets(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const configId = Number.parseInt(body.config_id, 10);
    const savedConfig = Number.isInteger(configId) && configId > 0
      ? userAiConfigService.getRuntimeConfig(db, req.user.id, configId)
      : null;
    if (Number.isInteger(configId) && configId > 0 && !savedConfig) {
      return response.notFound(res, '配置不存在');
    }
    if (savedConfig && savedConfig.service_type !== 'jimeng2_character_auth') {
      return response.badRequest(res, '所选配置不是即梦2角色认证配置');
    }
    if (savedConfig && !savedConfig.is_active) {
      return response.badRequest(res, '所选配置未启用');
    }
    const base_url = (body.base_url || savedConfig?.base_url || '')
      .toString()
      .trim()
      .replace(/\/$/, '');
    const { normalizeMaterialHubToken } = require('../services/jimengMaterialHubService');
    const api_key = normalizeMaterialHubToken(body.api_key || savedConfig?.api_key || '');
    if (!base_url || !api_key) {
      return response.badRequest(res, '请先填写网关 URL 与 Token');
    }
    const jimengMaterialHubService = require('../services/jimengMaterialHubService');
    const ctx = { baseUrl: base_url, token: api_key };
    const r = await jimengMaterialHubService.listAssets(ctx, { limit: body.limit, cursor: body.cursor }, log);
    if (!r.ok) {
      return response.badRequest(res, String(r.error || '列出素材失败').slice(0, 800));
    }
    response.success(res, r.data);
  };
}

/** HolyCrab 素材管理：使用已保存的配置，密钥无需由浏览器重复传输。 */
function holyCrabAssets(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const configId = Number.parseInt(body.config_id, 10);
    if (!Number.isFinite(configId) || configId <= 0) {
      return response.badRequest(res, '请选择 HolyCrab 配置');
    }
    const config = userAiConfigService.getRuntimeConfig(db, req.user.id, configId);
    if (!config) return response.notFound(res, 'HolyCrab 配置不存在');
    if (!config.is_active) return response.badRequest(res, 'HolyCrab 配置未启用');

    const action = String(body.action || '').trim().toLowerCase();
    const service = require('../services/holyCrabAssetService');
    try {
      let data;
      if (action === 'list') {
        data = await service.listAssets(config, body);
      } else if (action === 'get') {
        data = await service.getAsset(config, body.uniq_id);
      } else if (action === 'create_from_url') {
        data = await service.createAssetFromUrl(config, body);
      } else if (action === 'delete') {
        data = await service.deleteAsset(config, body.uniq_id);
      } else if (action === 'upload') {
        data = await service.uploadAsset(config, req.file, body);
      } else {
        return response.badRequest(res, '不支持的 HolyCrab 素材操作');
      }
      response.success(res, data);
    } catch (err) {
      log.error('holycrab asset operation failed', {
        action,
        config_id: configId,
        error: err.message,
      });
      response.badRequest(res, err.message || 'HolyCrab 素材操作失败');
    }
  };
}

/** HolyCrab 素材内容代理：供浏览器播放器和下载按钮使用，支持 Range 请求。 */
function holyCrabAssetContent(db, log) {
  return async (req, res) => {
    const configId = Number.parseInt(req.params.configId, 10);
    if (!Number.isFinite(configId) || configId <= 0) {
      return response.badRequest(res, 'HolyCrab 配置 ID 无效');
    }
    const config = userAiConfigService.getRuntimeConfig(db, req.user.id, configId);
    if (!config) return response.notFound(res, 'HolyCrab 配置不存在');
    if (!config.is_active) return response.badRequest(res, 'HolyCrab 配置未启用');

    const service = require('../services/holyCrabAssetService');
    try {
      const asset = await service.getAsset(config, req.params.uniqId);
      await service.streamAssetContent(config, asset, req, res, {
        download: String(req.query.download || '') === '1',
      });
    } catch (err) {
      log.error('holycrab asset content proxy failed', {
        config_id: configId,
        uniq_id: req.params.uniqId,
        error: err.message,
      });
      if (!res.headersSent && !res.destroyed) {
        return response.badRequest(res, err.message || 'HolyCrab 素材文件读取失败');
      }
      if (!res.destroyed) res.destroy(err);
    }
  };
}

module.exports = function aiConfigRoutes(db, log, cfg) {
  return {
    list: list(db),
    get: get(db),
    vendorLock: vendorLock(cfg),
    create: create(db, log, cfg),
    update: update(db, log, cfg),
    setDefault: setDefault(db, log),
    listModels: listModels(db, log),
    delete: remove(db, log, cfg),
    testConnection: testConnection(db, log),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(db, log),
    modelArkAsset: modelArkAsset(db, log),
    holyCrabAssets: holyCrabAssets(db, log),
    holyCrabAssetContent: holyCrabAssetContent(db, log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};

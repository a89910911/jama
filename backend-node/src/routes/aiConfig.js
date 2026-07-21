const aiConfigService = require('../services/aiConfigService');
const aiRequestLogService = require('../services/aiRequestLogService');
const response = require('../response');

function list(db) {
  return (req, res) => {
    const list = aiConfigService.listConfigs(db, req.query.service_type);
    response.success(res, list);
  };
}

function get(db) {
  return (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const config = aiConfigService.getConfig(db, id);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

function vendorLock(cfg) {
  return (req, res) => {
    const status = aiConfigService.getVendorLockStatus(cfg);
    response.success(res, status);
  };
}

function create(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许添加配置');
    }
    const body = req.body || {};
    if (!body.service_type || !body.name || !body.provider || !body.base_url) {
      return response.badRequest(res, '缺少必填字段: service_type, name, provider, base_url');
    }
    if (body.api_key === undefined || body.api_key === null) {
      return response.badRequest(res, '缺少必填字段: api_key');
    }
    try {
      const config = aiConfigService.createConfig(db, log, {
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

    let body = req.body || {};
    // 锁定模式下只允许修改 api_key、default_model、is_default
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      const allowed = {};
      if (body.api_key !== undefined) allowed.api_key = body.api_key;
      if (body.default_model !== undefined) allowed.default_model = body.default_model;
      if (body.is_default !== undefined) allowed.is_default = body.is_default;
      body = allowed;
    }

    const config = aiConfigService.updateConfig(db, log, id, body);
    if (!config) return response.notFound(res, '配置不存在');
    response.success(res, config);
  };
}

function remove(db, log, cfg) {
  return (req, res) => {
    if (aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '当前为厂商锁定模式，不允许删除配置');
    }
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return response.badRequest(res, '无效的配置ID');
    const ok = aiConfigService.deleteConfig(db, log, id);
    if (!ok) return response.notFound(res, '配置不存在');
    response.success(res, { message: '删除成功' });
  };
}

function bulkUpdateKey(db, log, cfg) {
  return (req, res) => {
    if (!aiConfigService.getVendorLockStatus(cfg).enabled) {
      return response.badRequest(res, '批量换Key仅在厂商锁定模式下可用');
    }
    const { api_key } = req.body || {};
    if (!api_key || !api_key.trim()) {
      return response.badRequest(res, '请提供新的 API Key');
    }
    try {
      const count = aiConfigService.bulkUpdateApiKey(db, log, api_key.trim());
      response.success(res, { updated: count, message: `已更新 ${count} 条配置的 API Key` });
    } catch (err) {
      log.error('Bulk update api_key failed', { error: err.message });
      response.internalError(res, '批量换Key失败');
    }
  };
}

function testConnection(db, log) {
  return async (req, res) => {
    const body = req.body || {};
    const model = Array.isArray(body.model) ? body.model[0] : body.model;
    const record = aiRequestLogService.start(db, {
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
function modelArkAsset(log) {
  return async (req, res) => {
    const body = req.body || {};
    const action = (body.action || '').toString().trim();
    try {
      const modelArkAssetProxyService = require('../services/modelArkAssetProxyService');
      const data = await modelArkAssetProxyService.callModelArkAsset(
        {
          base_url: body.base_url,
          api_key: body.api_key,
          action,
          body: body.payload,
          path_mode: body.path_mode,
          http_method: body.http_method,
          api_version: body.api_version,
          auth_mode: body.auth_mode,
          access_key_id: body.access_key_id,
          secret_access_key: body.secret_access_key,
          sign_region: body.sign_region,
          sign_service: body.sign_service,
          session_token: body.session_token,
          project_name: body.project_name,
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
function listJimeng2MaterialAssets(log) {
  return async (req, res) => {
    const body = req.body || {};
    const base_url = (body.base_url || '').toString().trim().replace(/\/$/, '');
    const { normalizeMaterialHubToken } = require('../services/jimengMaterialHubService');
    let api_key = normalizeMaterialHubToken(body.api_key || '');
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
    const config = aiConfigService.getConfig(db, configId);
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
    const config = aiConfigService.getConfig(db, configId);
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
    delete: remove(db, log, cfg),
    testConnection: testConnection(db, log),
    listJimeng2MaterialAssets: listJimeng2MaterialAssets(log),
    modelArkAsset: modelArkAsset(log),
    holyCrabAssets: holyCrabAssets(db, log),
    holyCrabAssetContent: holyCrabAssetContent(db, log),
    bulkUpdateKey: bulkUpdateKey(db, log, cfg),
  };
};

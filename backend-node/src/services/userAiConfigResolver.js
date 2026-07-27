'use strict';

const userAiConfigService = require('./userAiConfigService');
const {
  getBusinessScene,
  isRegisteredBusinessScene,
} = require('./businessSceneRegistry');

function models(config) {
  return Array.isArray(config?.model) ? config.model.filter(Boolean) : [];
}

function effectiveModel(config, preferredModel, override) {
  if (override) return String(override);
  if (preferredModel && models(config).includes(preferredModel)) return preferredModel;
  if (config?.default_model && models(config).includes(config.default_model)) {
    return config.default_model;
  }
  return models(config)[0] || null;
}

function getSceneMap(db, userId, sceneKey) {
  if (!sceneKey || !isRegisteredBusinessScene(sceneKey)) return null;
  return db.prepare(
    `SELECT * FROM user_ai_scene_model_maps
      WHERE user_id = ? AND scene_key = ?`
  ).get(userId, sceneKey) || null;
}

function resolveForExecution(db, options = {}) {
  const userId = userAiConfigService.requireUserId(options.userId);
  let serviceType = userAiConfigService.normalizeServiceType(options.serviceType || 'text');
  const scene = options.sceneKey ? getBusinessScene(options.sceneKey) : null;
  if (scene?.service_type) serviceType = scene.service_type;

  if (options.explicitConfigId) {
    const explicit = userAiConfigService.getRuntimeConfig(
      db,
      userId,
      options.explicitConfigId
    );
    if (!explicit) {
      const error = new Error('AI 配置不存在');
      error.code = 'AI_CONFIG_NOT_FOUND';
      throw error;
    }
    if (!explicit.is_active) {
      const error = new Error('AI 配置已停用');
      error.code = 'AI_CONFIG_INACTIVE';
      throw error;
    }
    if (
      explicit.service_type !== serviceType
      && !(serviceType === 'storyboard_image' && explicit.service_type === 'image')
    ) {
      const error = new Error('AI 配置类型与当前任务不匹配');
      error.code = 'AI_CONFIG_TYPE_MISMATCH';
      throw error;
    }
    return {
      config: explicit,
      model: effectiveModel(explicit, options.preferredModel),
      scene,
      sceneMap: null,
      source: 'explicit',
    };
  }

  const sceneMap = getSceneMap(db, userId, options.sceneKey);
  if (sceneMap?.config_id) {
    const mapped = userAiConfigService.getRuntimeConfig(db, userId, sceneMap.config_id);
    if (
      mapped?.is_active
      && (
        mapped.service_type === serviceType
        || (serviceType === 'storyboard_image' && mapped.service_type === 'image')
      )
    ) {
      return {
        config: mapped,
        model: effectiveModel(mapped, options.preferredModel, sceneMap.model_override),
        scene,
        sceneMap,
        source: 'scene',
      };
    }
  }

  let candidates = userAiConfigService
    .listRuntimeConfigs(db, userId, serviceType)
    .filter((config) => config.is_active);
  if (!candidates.length && serviceType === 'storyboard_image') {
    candidates = userAiConfigService
      .listRuntimeConfigs(db, userId, 'image')
      .filter((config) => config.is_active);
  }
  if (options.preferredProvider) {
    const provider = String(options.preferredProvider).toLowerCase();
    const matched = candidates.filter(
      (config) => String(config.provider || '').toLowerCase() === provider
    );
    if (matched.length) candidates = matched;
  }
  let config = null;
  if (options.preferredModel) {
    config = candidates.find((item) => models(item).includes(options.preferredModel)) || null;
  }
  if (!config) config = candidates.find((item) => item.is_default) || candidates[0] || null;
  if (!config) {
    const error = new Error(`当前用户未配置可用的 ${serviceType} AI 服务`);
    error.code = 'AI_CONFIG_REQUIRED';
    error.service_type = serviceType;
    throw error;
  }
  return {
    config,
    model: effectiveModel(config, options.preferredModel, sceneMap?.model_override),
    scene,
    sceneMap,
    source: config.is_default ? 'default' : 'priority',
  };
}

function tryResolveForExecution(db, options = {}) {
  try {
    return resolveForExecution(db, options);
  } catch (error) {
    if (error.code === 'AI_CONFIG_REQUIRED') return null;
    throw error;
  }
}

module.exports = {
  effectiveModel,
  getSceneMap,
  resolveForExecution,
  tryResolveForExecution,
};


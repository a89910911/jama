const userAiConfigService = require('./userAiConfigService');
const userAiPreferenceService = require('./userAiPreferenceService');
const aiRequestLogService = require('./aiRequestLogService');

const ASSISTANT_ENGINE_KEY = 'ai_assistant_engine';
const ENGINE_CODEX = 'codex';
const ENGINE_CONFIGURED_API = 'configured_api';
const SUPPORTED_ENGINES = new Set([ENGINE_CODEX, ENGINE_CONFIGURED_API]);

function normalizeEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  return SUPPORTED_ENGINES.has(engine) ? engine : ENGINE_CONFIGURED_API;
}

function resolveUserId(userId) {
  return userAiConfigService.requireUserId(
    aiRequestLogService.currentUserId(userId)
  );
}

function getAssistantEngine(db, userId) {
  const resolvedUserId = resolveUserId(userId);
  return normalizeEngine(
    userAiPreferenceService.getPreferences(db, resolvedUserId).assistant_engine
  );
}

function setAssistantEngine(db, engine, userId) {
  const normalized = normalizeEngine(engine);
  const resolvedUserId = resolveUserId(userId);
  userAiPreferenceService.updatePreferences(db, resolvedUserId, {
    assistant_engine: normalized,
  });
  return normalized;
}

function configModel(config) {
  if (!config) return null;
  const models = Array.isArray(config.model)
    ? config.model.filter(Boolean)
    : (config.model ? [config.model] : []);
  if (config.default_model && models.includes(config.default_model)) {
    return config.default_model;
  }
  return models[0] || null;
}

function configuredCapability(db, serviceType, userId) {
  let configs = [];
  try {
    const resolvedUserId = resolveUserId(userId);
    configs = userAiConfigService.listConfigs(db, resolvedUserId, serviceType);
    configs = configs.filter((item) => item.is_active);
  } catch (_) {
    configs = [];
  }
  const config = configs.find((item) => item.is_default) || configs[0] || null;
  if (!config) {
    const labels = {
      text: '文本/对话',
      image: '文本生成图片',
      storyboard_image: '分镜图片生成',
    };
    return {
      available: false,
      service_type: serviceType,
      reason: `未配置已启用的${labels[serviceType] || serviceType} API`,
    };
  }
  return {
    available: true,
    service_type: serviceType,
    config_id: config.id,
    config_name: config.name || '',
    provider: config.provider || '',
    model: configModel(config),
  };
}

function getConfiguredApiStatus(db, userId) {
  const resolvedUserId = resolveUserId(userId);
  const text = configuredCapability(db, 'text', resolvedUserId);
  const image = configuredCapability(db, 'image', resolvedUserId);
  const storyboardImage = configuredCapability(db, 'storyboard_image', resolvedUserId);
  return {
    available: text.available,
    text,
    image,
    storyboard_image: storyboardImage,
  };
}

module.exports = {
  ASSISTANT_ENGINE_KEY,
  ENGINE_CODEX,
  ENGINE_CONFIGURED_API,
  normalizeEngine,
  getAssistantEngine,
  setAssistantEngine,
  configModel,
  configuredCapability,
  getConfiguredApiStatus,
};

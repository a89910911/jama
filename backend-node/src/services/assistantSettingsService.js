const settingsService = require('./settingsService');
const aiConfigService = require('./aiConfigService');

const ASSISTANT_ENGINE_KEY = 'ai_assistant_engine';
const ENGINE_CODEX = 'codex';
const ENGINE_CONFIGURED_API = 'configured_api';
const SUPPORTED_ENGINES = new Set([ENGINE_CODEX, ENGINE_CONFIGURED_API]);

function normalizeEngine(value) {
  const engine = String(value || '').trim().toLowerCase();
  return SUPPORTED_ENGINES.has(engine) ? engine : ENGINE_CONFIGURED_API;
}

function getAssistantEngine(db) {
  return normalizeEngine(
    settingsService.getGlobalSetting(db, ASSISTANT_ENGINE_KEY, ENGINE_CONFIGURED_API)
  );
}

function setAssistantEngine(db, engine) {
  const normalized = normalizeEngine(engine);
  settingsService.setGlobalSetting(db, ASSISTANT_ENGINE_KEY, normalized);
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

function configuredCapability(db, serviceType) {
  let configs = [];
  try {
    configs = aiConfigService.listConfigs(db, serviceType)
      .filter((item) => item.is_active);
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

function getConfiguredApiStatus(db) {
  const text = configuredCapability(db, 'text');
  const image = configuredCapability(db, 'image');
  const storyboardImage = configuredCapability(db, 'storyboard_image');
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

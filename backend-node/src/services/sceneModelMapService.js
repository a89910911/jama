const userAiConfigService = require('./userAiConfigService');
const {
  getBusinessScene,
  listBusinessScenes,
} = require('./businessSceneRegistry');

function configModels(config) {
  if (!config) return [];
  if (Array.isArray(config.model)) return config.model.filter(Boolean);
  return config.model ? [config.model] : [];
}

function configSupportsService(config, serviceType) {
  if (!config || !config.is_active) return false;
  if (config.service_type === serviceType) return true;
  return serviceType === 'storyboard_image' && config.service_type === 'image';
}

function listCandidateConfigs(db, userId, serviceType) {
  let configs = [];
  try {
    configs = userAiConfigService
      .listRuntimeConfigs(db, userId, serviceType)
      .filter((item) => item.is_active);
    if (!configs.length && serviceType === 'storyboard_image') {
      configs = userAiConfigService
        .listRuntimeConfigs(db, userId, 'image')
        .filter((item) => item.is_active);
    }
  } catch (_) {
    return [];
  }
  return configs;
}

function candidateConfigsFromRows(configs, serviceType) {
  const direct = configs.filter(
    (config) => config.is_active && config.service_type === serviceType
  );
  if (direct.length || serviceType !== 'storyboard_image') return direct;
  return configs.filter(
    (config) => config.is_active && config.service_type === 'image'
  );
}

function chooseDefaultConfig(configs, preferredModel) {
  if (preferredModel) {
    const matched = configs.find((config) => configModels(config).includes(preferredModel));
    if (matched) return matched;
  }
  return configs.find((config) => config.is_default) || configs[0] || null;
}

function effectiveModel(config, preferredModel, modelOverride) {
  if (modelOverride) return modelOverride;
  const models = configModels(config);
  if (preferredModel && models.includes(preferredModel)) return preferredModel;
  if (config?.default_model && models.includes(config.default_model)) return config.default_model;
  return models[0] || null;
}

function getSceneMapRow(db, userId, sceneKey) {
  try {
    return db.prepare(
      `SELECT id, user_id, scene_key AS key, service_type, config_id,
              model_override, description, created_at, updated_at
         FROM user_ai_scene_model_maps
        WHERE user_id = ? AND scene_key = ?`
    ).get(userAiConfigService.requireUserId(userId), sceneKey) || null;
  } catch (_) {
    return null;
  }
}

function resolveSceneModelSelection(db, sceneKey, options = {}) {
  const userId = userAiConfigService.requireUserId(options.userId);
  const scene = getBusinessScene(sceneKey);
  const serviceType = scene?.service_type || options.serviceType || 'text';
  const row = scene ? getSceneMapRow(db, userId, scene.key) : null;
  const candidates = listCandidateConfigs(db, userId, serviceType);
  let config = null;

  if (row?.config_id) {
    const selected = userAiConfigService.getRuntimeConfig(db, userId, row.config_id);
    if (configSupportsService(selected, serviceType)) config = selected;
  }
  if (!config) config = chooseDefaultConfig(candidates, row ? null : options.preferredModel);

  const modelOverride = row?.model_override || null;
  return {
    scene,
    row,
    service_type: serviceType,
    config,
    model: effectiveModel(config, options.preferredModel, modelOverride),
    model_override: modelOverride,
    mapping_source: row && (row.config_id || row.model_override) ? 'scene' : 'default',
  };
}

function promptPresentationByKey() {
  const { buildCatalog } = require('./promptCatalog');
  return new Map(buildCatalog().map((item) => [item.prompt_key, item]));
}

function buildBusinessSceneOverview(db, userIdValue) {
  const userId = Number(userIdValue) > 0 ? Number(userIdValue) : 0;
  const presentation = promptPresentationByKey();
  let mapRows = [];
  let configs = [];
  try {
    mapRows = db.prepare(
      `SELECT id, user_id, scene_key AS key, service_type, config_id,
              model_override, description, created_at, updated_at
         FROM user_ai_scene_model_maps
        WHERE user_id = ?`
    ).all(userId);
  } catch (_) {}
  try {
    configs = userId
      ? userAiConfigService
          .listRuntimeConfigs(db, userId)
          .filter((config) => config.is_active)
      : [];
  } catch (_) {}
  const mapByKey = new Map(mapRows.map((row) => [row.key, row]));
  const configById = new Map(configs.map((config) => [Number(config.id), config]));
  return listBusinessScenes().map((scene) => {
    const row = mapByKey.get(scene.key) || null;
    const candidates = candidateConfigsFromRows(configs, scene.service_type);
    let config = row?.config_id ? configById.get(Number(row.config_id)) || null : null;
    if (!configSupportsService(config, scene.service_type)) config = null;
    if (!config) config = chooseDefaultConfig(candidates, null);
    const modelOverride = row?.model_override || null;
    const selection = {
      row,
      config,
      model: effectiveModel(config, null, modelOverride),
      mapping_source: row && (row.config_id || row.model_override) ? 'scene' : 'default',
    };
    const components = scene.prompt_keys.map((promptKey, index) => {
      const item = presentation.get(promptKey);
      return {
        prompt_key: promptKey,
        name: item?.name || promptKey,
        business_slot: item?.business_slot || 'component',
        business_slot_label: item?.business_slot_label || '模板组件',
        component_order: item?.business_component_order || index + 1,
        template_kind: item?.template_kind || 'main',
        content_type: item?.content_type || 'user_template',
        relation_note: item?.relation_note || '',
      };
    });
    return {
      ...scene,
      category_path: [scene.category, scene.subcategory, scene.detail_category].filter(Boolean),
      prompt_count: components.length,
      prompt_components: components,
      mapping_exists: !!selection.row,
      mapping_source: selection.mapping_source,
      config_id: selection.row?.config_id || null,
      model_override: selection.row?.model_override || null,
      mapping_description: selection.row?.description || '',
      effective_config_id: selection.config?.id || null,
      effective_config_name: selection.config?.name || null,
      effective_provider: selection.config?.provider || null,
      effective_model: selection.model,
    };
  });
}

module.exports = {
  buildBusinessSceneOverview,
  getSceneMapRow,
  resolveSceneModelSelection,
};

const response = require('../response');
const {
  listBusinessScenes,
  getBusinessScene,
  isRegisteredBusinessScene,
} = require('../services/businessSceneRegistry');
const { buildBusinessSceneOverview } = require('../services/sceneModelMapService');
const userAiConfigService = require('../services/userAiConfigService');

function validateOwnedConfig(db, userId, configId, serviceType) {
  if (configId == null || configId === '') return null;
  const config = userAiConfigService.getRuntimeConfig(db, userId, configId);
  if (!config) {
    const error = new Error('AI 配置不存在');
    error.code = 'AI_CONFIG_NOT_FOUND';
    throw error;
  }
  if (
    config.service_type !== serviceType
    && !(serviceType === 'storyboard_image' && config.service_type === 'image')
  ) {
    const error = new Error('AI 配置类型与业务场景不匹配');
    error.code = 'AI_CONFIG_TYPE_MISMATCH';
    throw error;
  }
  return config.id;
}

function list(db, log) {
  return (req, res) => {
    try {
      const rows = db.prepare(
        `SELECT id, scene_key AS key, service_type, config_id, model_override,
                description, created_at, updated_at
           FROM user_ai_scene_model_maps
          WHERE user_id = ?
          ORDER BY scene_key`
      ).all(req.user.id);
      response.success(res, rows);
    } catch (err) {
      log.error('List scene model map failed', { error: err.message });
      response.internalError(res, '获取场景模型映射失败');
    }
  };
}

function get(db, log) {
  return (req, res) => {
    const { key } = req.params;
    try {
      const row = db.prepare(
        `SELECT id, scene_key AS key, service_type, config_id, model_override,
                description, created_at, updated_at
           FROM user_ai_scene_model_maps
          WHERE user_id = ? AND scene_key = ?`
      ).get(req.user.id, key);
      if (!row) {
        return response.notFound(res, '场景模型映射不存在');
      }
      response.success(res, row);
    } catch (err) {
      log.error('Get scene model map failed', { error: err.message, key });
      response.internalError(res, '获取场景模型映射失败');
    }
  };
}

function create(db, log) {
  return (req, res) => {
    const body = req.body || {};
    const { key, service_type = 'text', config_id, model_override, description } = body;
    
    if (!key) {
      return response.badRequest(res, '缺少必填字段: key');
    }
    if (!isRegisteredBusinessScene(key)) {
      return response.badRequest(res, `未注册的业务场景键: ${key}`);
    }
    const registered = getBusinessScene(key);
    if (service_type && service_type !== registered.service_type) {
      return response.badRequest(res, `业务场景 ${key} 的服务类型必须为 ${registered.service_type}`);
    }
    
    const now = new Date().toISOString();
    try {
      // 检查 key 是否已存在
      const existing = db.prepare(
        'SELECT id FROM user_ai_scene_model_maps WHERE user_id = ? AND scene_key = ?'
      ).get(req.user.id, key);
      if (existing) {
        return response.badRequest(res, '场景键已存在');
      }
      
      const ownedConfigId = validateOwnedConfig(
        db,
        req.user.id,
        config_id,
        registered.service_type
      );
      const result = db.prepare(`
        INSERT INTO user_ai_scene_model_maps
          (user_id, scene_key, service_type, config_id, model_override,
           description, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        req.user.id,
        key,
        registered.service_type,
        ownedConfigId,
        model_override || null,
        description || registered.description || '',
        now,
        now
      );
      
      const row = db.prepare(
        `SELECT id, scene_key AS key, service_type, config_id, model_override,
                description, created_at, updated_at
           FROM user_ai_scene_model_maps
          WHERE id = ? AND user_id = ?`
      ).get(result.lastInsertRowid, req.user.id);
      response.created(res, row);
    } catch (err) {
      log.error('Create scene model map failed', { error: err.message, key });
      response.internalError(res, '创建场景模型映射失败');
    }
  };
}

function update(db, log) {
  return (req, res) => {
    const { key } = req.params;
    const body = req.body || {};
    const { service_type, config_id, model_override, description } = body;
    const registered = getBusinessScene(key);
    if (!registered) return response.badRequest(res, `未注册的业务场景键: ${key}`);
    if (service_type && service_type !== registered.service_type) {
      return response.badRequest(res, `业务场景 ${key} 的服务类型必须为 ${registered.service_type}`);
    }
    
    const now = new Date().toISOString();
    try {
      const existing = db.prepare(
        'SELECT id FROM user_ai_scene_model_maps WHERE user_id = ? AND scene_key = ?'
      ).get(req.user.id, key);
      if (!existing) {
        return response.notFound(res, '场景模型映射不存在');
      }
      
      const ownedConfigId = validateOwnedConfig(
        db,
        req.user.id,
        config_id,
        registered.service_type
      );
      db.prepare(`
        UPDATE user_ai_scene_model_maps
        SET service_type = ?, config_id = ?, model_override = ?, description = ?, updated_at = ?
        WHERE user_id = ? AND scene_key = ?
      `).run(
        registered.service_type,
        ownedConfigId,
        model_override !== undefined ? model_override : null,
        description !== undefined ? description : '',
        now,
        req.user.id,
        key
      );
      
      const row = db.prepare(
        `SELECT id, scene_key AS key, service_type, config_id, model_override,
                description, created_at, updated_at
           FROM user_ai_scene_model_maps
          WHERE user_id = ? AND scene_key = ?`
      ).get(req.user.id, key);
      response.success(res, row);
    } catch (err) {
      log.error('Update scene model map failed', { error: err.message, key });
      response.internalError(res, '更新场景模型映射失败');
    }
  };
}

function remove(db, log) {
  return (req, res) => {
    const { key } = req.params;
    try {
      const existing = db.prepare(
        'SELECT id FROM user_ai_scene_model_maps WHERE user_id = ? AND scene_key = ?'
      ).get(req.user.id, key);
      if (!existing) {
        return response.notFound(res, '场景模型映射不存在');
      }
      
      db.prepare(
        'DELETE FROM user_ai_scene_model_maps WHERE user_id = ? AND scene_key = ?'
      ).run(req.user.id, key);
      response.success(res, { message: '删除成功' });
    } catch (err) {
      log.error('Delete scene model map failed', { error: err.message, key });
      response.internalError(res, '删除场景模型映射失败');
    }
  };
}

module.exports = function sceneModelMapRoutes(db, log) {
  return {
    definitions: (req, res) => response.success(res, listBusinessScenes()),
    overview: (req, res) => {
      try {
        response.success(res, buildBusinessSceneOverview(db, req.user.id));
      } catch (err) {
        log.error('Get business scene overview failed', { error: err.message });
        response.internalError(res, '获取业务场景概览失败');
      }
    },
    list: list(db, log),
    get: get(db, log),
    create: create(db, log),
    update: update(db, log),
    delete: remove(db, log)
  };
};

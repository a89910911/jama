const response = require('../response');
const promptTemplates = require('../services/promptTemplateService');
const { buildBusinessSceneOverview } = require('../services/sceneModelMapService');

function enrichBusinessScenes(db, items) {
  const overviewByKey = new Map(
    buildBusinessSceneOverview(db).map((scene) => [scene.key, scene])
  );
  return items.map((item) => {
    const scene = overviewByKey.get(item.scene_key);
    if (!scene) return item;
    return {
      ...item,
      business_scene_label: scene.label,
      business_scene_service_type: scene.service_type,
      business_scene_category_path: scene.category_path,
      business_scene_mapping_source: scene.mapping_source,
      business_scene_config_id: scene.effective_config_id,
      business_scene_config_name: scene.effective_config_name,
      business_scene_provider: scene.effective_provider,
      business_scene_model: scene.effective_model,
      business_scene_prompt_count: scene.prompt_count,
    };
  });
}

function sendError(res, err) {
  if (err?.code === 'NOT_FOUND' || err?.code === 'PROMPT_DEFINITION_NOT_FOUND') {
    return response.notFound(res, err.message);
  }
  if (err?.code === 'FORBIDDEN') return response.forbidden(res, err.message);
  if (err?.code === 'VERSION_CONFLICT') {
    return response.error(res, 409, 'VERSION_CONFLICT', err.message);
  }
  if (
    err?.code === 'PROMPT_VALIDATION_FAILED' ||
    err?.code === 'PROMPT_VARIABLE_MISSING' ||
    err?.code === 'PROMPT_VARIABLE_UNKNOWN'
  ) {
    return response.badRequest(res, err.message);
  }
  return response.internalError(res, err?.message || '提示词操作失败');
}

function filterItems(items, query = {}) {
  const keyword = String(query.keyword || '').trim().toLowerCase();
  return items.filter((item) => {
    if (query.category && item.category !== query.category) return false;
    if (query.subcategory && item.subcategory !== query.subcategory) return false;
    if (query.detail_category && item.detail_category !== query.detail_category) return false;
    if (query.workflow_stage && item.workflow_stage !== query.workflow_stage) return false;
    if (query.scene_key && item.scene_key !== query.scene_key) return false;
    if (query.template_kind && item.template_kind !== query.template_kind) return false;
    if (!keyword) return true;
    return [
      item.name,
      item.prompt_key,
      item.description,
      item.category,
      item.subcategory,
      item.detail_category,
      item.workflow_stage,
      item.business_scene_label,
      item.business_scene_config_name,
      item.business_scene_model,
      item.scene_key,
      item.template_kind,
      item.template_subtype,
      item.content_type,
      item.injection_channel,
      item.relation_note,
    ]
      .some((value) => String(value || '').toLowerCase().includes(keyword));
  });
}

function routes(db, log) {
  return {
    listSystem(req, res) {
      try {
        response.success(res, {
          prompts: filterItems(enrichBusinessScenes(db, promptTemplates.listPrompts(db)), req.query),
        });
      } catch (err) {
        log.error('prompt list system', { error: err.message });
        sendError(res, err);
      }
    },

    getSystem(req, res) {
      try {
        const prompts = enrichBusinessScenes(db, promptTemplates.listPrompts(db))
          .filter((item) => item.prompt_key === req.params.key);
        const filtered = filterItems(prompts, req.query);
        if (!filtered.length) return response.notFound(res, '提示词不存在');
        response.success(res, { prompts: filtered });
      } catch (err) {
        sendError(res, err);
      }
    },

    updateSystem(req, res) {
      try {
        const row = promptTemplates.updateSystemPrompt(
          db,
          req.params.key,
          req.body?.content,
          req.body?.version
        );
        response.success(res, { ok: true, version: row.version });
      } catch (err) {
        log.error('prompt update system', { key: req.params.key, error: err.message });
        sendError(res, err);
      }
    },

    resetSystem(req, res) {
      try {
        const row = promptTemplates.resetSystemPrompt(
          db,
          req.params.key,
          req.body?.version
        );
        response.success(res, { ok: true, version: row.version, content: row.content });
      } catch (err) {
        log.error('prompt reset system', { key: req.params.key, error: err.message });
        sendError(res, err);
      }
    },

    previewSystem(req, res) {
      try {
        const data = promptTemplates.previewPrompt(db, req.params.key, {
          variables: req.body?.variables || {},
          content: req.body?.content,
        });
        response.success(res, data);
      } catch (err) {
        sendError(res, err);
      }
    },

    listProject(req, res) {
      try {
        const dramaId = Number(req.params.drama_id);
        if (!db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)) {
          return response.notFound(res, '项目不存在');
        }
        response.success(res, {
          prompts: filterItems(
            enrichBusinessScenes(db, promptTemplates.listPrompts(db, { dramaId })),
            req.query
          ),
        });
      } catch (err) {
        log.error('prompt list project', { error: err.message, drama_id: req.params.drama_id });
        sendError(res, err);
      }
    },

    getProject(req, res) {
      try {
        const dramaId = Number(req.params.drama_id);
        if (!db.prepare('SELECT id FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)) {
          return response.notFound(res, '项目不存在');
        }
        const prompts = enrichBusinessScenes(db, promptTemplates.listPrompts(db, { dramaId }))
          .filter((item) => item.prompt_key === req.params.key);
        const filtered = filterItems(prompts, req.query);
        if (!filtered.length) return response.notFound(res, '提示词不存在');
        response.success(res, { prompts: filtered });
      } catch (err) {
        sendError(res, err);
      }
    },

    updateProject(req, res) {
      try {
        const row = promptTemplates.updateProjectPrompt(
          db,
          req.params.drama_id,
          req.params.key,
          req.body?.content,
          req.body?.version
        );
        response.success(res, { ok: true, version: row.version });
      } catch (err) {
        log.error('prompt update project', { key: req.params.key, error: err.message });
        sendError(res, err);
      }
    },

    deleteProject(req, res) {
      try {
        const ok = promptTemplates.deleteProjectPrompt(
          db,
          req.params.drama_id,
          req.params.key,
          req.body?.version
        );
        response.success(res, { ok, effective_source: 'system' });
      } catch (err) {
        log.error('prompt delete project', { key: req.params.key, error: err.message });
        sendError(res, err);
      }
    },

    previewProject(req, res) {
      try {
        const data = promptTemplates.previewPrompt(db, req.params.key, {
          dramaId: req.params.drama_id,
          variables: req.body?.variables || {},
          content: req.body?.content,
        });
        response.success(res, data);
      } catch (err) {
        sendError(res, err);
      }
    },
  };
}

module.exports = { routes };

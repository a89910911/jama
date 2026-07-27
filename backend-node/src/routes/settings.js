const response = require('../response');
const { loadConfig } = require('../config');
const { resolveVideoGenerationTimeoutMinutes } = require('../config/videoGeneration');
const assistantSettingsService = require('../services/assistantSettingsService');
const userAiPreferenceService = require('../services/userAiPreferenceService');

/** GET /settings/generation — 获取当前用户的生成设置 */
function getGenerationSettings(db) {
  return (req, res) => {
    const preferences = userAiPreferenceService.getPreferences(db, req.user.id);
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, {
      concurrency: preferences.image_concurrency,
      video_concurrency: preferences.video_concurrency,
      video_generation_timeout_minutes,
    });
  };
}

/** PUT /settings/generation — 更新当前用户的生成设置 */
function updateGenerationSettings(db) {
  return (req, res) => {
    const { concurrency, video_concurrency } = req.body || {};
    if (concurrency !== undefined) {
      const n = Number(concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '图片并发数需为 1-20 之间的整数');
      }
    }
    if (video_concurrency !== undefined) {
      const n = Number(video_concurrency);
      if (!Number.isInteger(n) || n < 1 || n > 20) {
        return response.badRequest(res, '视频并发数需为 1-20 之间的整数');
      }
    }
    const saved = userAiPreferenceService.updatePreferences(db, req.user.id, {
      ...(concurrency !== undefined ? { image_concurrency: Number(concurrency) } : {}),
      ...(video_concurrency !== undefined
        ? { video_concurrency: Number(video_concurrency) }
        : {}),
    });
    const video_generation_timeout_minutes = resolveVideoGenerationTimeoutMinutes(loadConfig());
    response.success(res, {
      concurrency: saved.image_concurrency,
      video_concurrency: saved.video_concurrency,
      video_generation_timeout_minutes,
    });
  };
}

function getAssistantSettings(db) {
  return (req, res) => {
    response.success(res, {
      engine: assistantSettingsService.getAssistantEngine(db, req.user.id),
      configured_api: assistantSettingsService.getConfiguredApiStatus(db, req.user.id),
    });
  };
}

function updateAssistantSettings(db) {
  return (req, res) => {
    const requested = String(req.body?.engine || '').trim();
    if (!['codex', 'configured_api'].includes(requested)) {
      return response.badRequest(res, '助手引擎必须是 codex 或 configured_api');
    }
    const engine = assistantSettingsService.setAssistantEngine(db, requested, req.user.id);
    response.success(res, {
      engine,
      configured_api: assistantSettingsService.getConfiguredApiStatus(db, req.user.id),
    });
  };
}

module.exports = function settingsRoutes(db, cfg, log) {
  return {
    getGenerationSettings: getGenerationSettings(db),
    updateGenerationSettings: updateGenerationSettings(db),
    getAssistantSettings: getAssistantSettings(db),
    updateAssistantSettings: updateAssistantSettings(db),
  };
};

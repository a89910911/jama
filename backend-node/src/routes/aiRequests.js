const response = require('../response');
const aiRequestLogService = require('../services/aiRequestLogService');

function parseDramaId(req, res) {
  const dramaId = Number(req.params.drama_id || req.params.id);
  if (!Number.isInteger(dramaId) || dramaId <= 0) {
    response.badRequest(res, '无效的项目 ID');
    return null;
  }
  return dramaId;
}

module.exports = function aiRequestRoutes(db, log) {
  return {
    systemList(req, res) {
      try {
        response.success(res, aiRequestLogService.list(db, null, req.query));
      } catch (error) {
        log.error('List system AI request logs failed', { error: error.message });
        response.internalError(res, 'AI 任务记录加载失败');
      }
    },

    systemStats(req, res) {
      try {
        response.success(res, aiRequestLogService.stats(db, null));
      } catch (error) {
        log.error('System AI request stats failed', { error: error.message });
        response.internalError(res, 'AI 任务记录统计失败');
      }
    },

    systemGet(req, res) {
      const item = aiRequestLogService.getOne(db, null, req.params.request_id);
      if (!item) return response.notFound(res, 'AI 任务记录不存在');
      response.success(res, item);
    },

    systemRemove(req, res) {
      const removed = aiRequestLogService.remove(db, null, req.params.request_id);
      if (!removed) return response.notFound(res, 'AI 任务记录不存在');
      response.success(res, { deleted: 1 });
    },

    systemClear(req, res) {
      try {
        const deleted = aiRequestLogService.clear(db, null, req.query);
        response.success(res, { deleted });
      } catch (error) {
        log.error('Clear system AI request logs failed', { error: error.message });
        response.internalError(res, 'AI 任务记录清理失败');
      }
    },

    list(req, res) {
      const dramaId = parseDramaId(req, res);
      if (!dramaId) return;
      try {
        response.success(res, aiRequestLogService.list(db, dramaId, req.query));
      } catch (error) {
        log.error('List AI request logs failed', { drama_id: dramaId, error: error.message });
        response.internalError(res, 'AI 记录加载失败');
      }
    },

    stats(req, res) {
      const dramaId = parseDramaId(req, res);
      if (!dramaId) return;
      try {
        response.success(res, aiRequestLogService.stats(db, dramaId));
      } catch (error) {
        log.error('AI request stats failed', { drama_id: dramaId, error: error.message });
        response.internalError(res, 'AI 记录统计失败');
      }
    },

    get(req, res) {
      const dramaId = parseDramaId(req, res);
      if (!dramaId) return;
      const item = aiRequestLogService.getOne(db, dramaId, req.params.request_id);
      if (!item) return response.notFound(res, 'AI 记录不存在');
      response.success(res, item);
    },

    remove(req, res) {
      const dramaId = parseDramaId(req, res);
      if (!dramaId) return;
      const removed = aiRequestLogService.remove(db, dramaId, req.params.request_id);
      if (!removed) return response.notFound(res, 'AI 记录不存在');
      response.success(res, { deleted: 1 });
    },

    clear(req, res) {
      const dramaId = parseDramaId(req, res);
      if (!dramaId) return;
      try {
        const deleted = aiRequestLogService.clear(db, dramaId, req.query);
        response.success(res, { deleted });
      } catch (error) {
        log.error('Clear AI request logs failed', { drama_id: dramaId, error: error.message });
        response.internalError(res, 'AI 记录清理失败');
      }
    },
  };
};

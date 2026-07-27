const response = require('../response');
const redrawService = require('../services/redrawService');

function ownsJob(db, jobId, userId) {
  return !!db.prepare(
    `SELECT id FROM redraw_jobs
      WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
  ).get(Number(jobId), Number(userId));
}

function ownsCard(db, cardId, userId) {
  return !!db.prepare(
    `SELECT c.id
       FROM redraw_cards c
       JOIN redraw_jobs j ON j.id = c.job_id AND j.deleted_at IS NULL
      WHERE c.id = ? AND c.deleted_at IS NULL AND j.user_id = ?`
  ).get(Number(cardId), Number(userId));
}

function routes(db, cfg, log) {
  return {
    listJobs: (req, res) => {
      try {
        response.success(res, redrawService.listJobs(db, {
          ...(req.query || {}),
          user_id: req.user.id,
        }));
      } catch (err) {
        log.error('redraw listJobs', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    createJob: (req, res) => {
      try {
        response.created(
          res,
          redrawService.createJob(db, {
            ...(req.body || {}),
            user_id: req.user.id,
          })
        );
      } catch (err) {
        log.error('redraw createJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    getJob: (req, res) => {
      try {
        if (!ownsJob(db, req.params.job_id, req.user.id)) {
          return response.notFound(res, '转绘任务不存在');
        }
        const job = redrawService.getJob(db, cfg, req.params.job_id);
        if (!job) return response.notFound(res, '转绘任务不存在');
        response.success(res, job);
      } catch (err) {
        log.error('redraw getJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    createCard: (req, res) => {
      try {
        if (!ownsJob(db, req.params.job_id, req.user.id)) {
          return response.notFound(res, '转绘任务不存在');
        }
        response.created(res, redrawService.addCard(db, req.params.job_id, req.body || {}));
      } catch (err) {
        log.error('redraw createCard', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    importEpisodeCards: (req, res) => {
      try {
        if (!ownsJob(db, req.params.job_id, req.user.id)) {
          return response.notFound(res, '转绘任务不存在');
        }
        response.success(res, redrawService.createCardsFromEpisode(db, req.params.job_id));
      } catch (err) {
        log.error('redraw importEpisodeCards', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    updateCard: (req, res) => {
      try {
        if (!ownsCard(db, req.params.card_id, req.user.id)) {
          return response.notFound(res, '转绘镜头不存在');
        }
        const card = redrawService.updateCard(db, req.params.card_id, req.body || {});
        if (!card) return response.notFound(res, '转绘镜头不存在');
        response.success(res, card);
      } catch (err) {
        log.error('redraw updateCard', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    preflightCard: (req, res) => {
      try {
        if (!ownsCard(db, req.params.card_id, req.user.id)) {
          return response.notFound(res, '转绘镜头不存在');
        }
        const report = redrawService.preflightCard(db, cfg, req.params.card_id);
        if (!report) return response.notFound(res, '转绘镜头不存在');
        response.success(res, report);
      } catch (err) {
        log.error('redraw preflightCard', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    generateStructure: (req, res) => {
      try {
        if (!ownsCard(db, req.params.card_id, req.user.id)) {
          return response.notFound(res, '转绘镜头不存在');
        }
        const result = redrawService.generateStructure(
          db,
          cfg,
          log,
          req.params.card_id,
          req.body?.strength || req.query?.strength
        );
        if (!result) return response.notFound(res, '转绘镜头不存在');
        response.success(res, result);
      } catch (err) {
        log.error('redraw generateStructure', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    submitCard: (req, res) => {
      try {
        if (!ownsCard(db, req.params.card_id, req.user.id)) {
          return response.notFound(res, '转绘镜头不存在');
        }
        const card = redrawService.submitCard(db, cfg, log, req.params.card_id);
        if (!card) return response.notFound(res, '转绘镜头不存在');
        response.success(res, card);
      } catch (err) {
        log.error('redraw submitCard', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    submitJob: (req, res) => {
      try {
        if (!ownsJob(db, req.params.job_id, req.user.id)) {
          return response.notFound(res, '转绘任务不存在');
        }
        response.success(res, redrawService.submitJob(db, cfg, log, req.params.job_id, req.body || {}));
      } catch (err) {
        log.error('redraw submitJob', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    reconcileJob: (req, res) => {
      try {
        if (!ownsJob(db, req.params.job_id, req.user.id)) {
          return response.notFound(res, '转绘任务不存在');
        }
        redrawService.reconcileJob(db, cfg, req.params.job_id);
        const job = redrawService.getJob(db, cfg, req.params.job_id);
        if (!job) return response.notFound(res, '转绘任务不存在');
        response.success(res, job);
      } catch (err) {
        log.error('redraw reconcileJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    repairJob: (req, res) => {
      try {
        if (!ownsJob(db, req.params.job_id, req.user.id)) {
          return response.notFound(res, '转绘任务不存在');
        }
        response.success(res, redrawService.repairJobResults(db, cfg, req.params.job_id));
      } catch (err) {
        log.error('redraw repairJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;

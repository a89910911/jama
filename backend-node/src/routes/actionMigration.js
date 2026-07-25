const fs = require('fs');
const os = require('os');
const path = require('path');
const multer = require('multer');
const response = require('../response');
const actionMigrationService = require('../services/actionMigrationService');

const tempRoot = path.join(os.tmpdir(), 'jama-action-migration');
fs.mkdirSync(tempRoot, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, tempRoot),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname || '') || '.bin';
      cb(null, `${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: {
    fileSize: 600 * 1024 * 1024,
    files: 2,
  },
});

function cleanupFiles(files) {
  for (const list of Object.values(files || {})) {
    for (const file of list || []) {
      if (!file?.path) continue;
      try {
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
      } catch (_) {}
    }
  }
}

function uploadMiddleware(req, res, next) {
  upload.fields([
    { name: 'driving_video', maxCount: 1 },
    { name: 'reference_image', maxCount: 1 },
    { name: 'drivingVideo', maxCount: 1 },
    { name: 'referenceImage', maxCount: 1 },
  ])(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      cleanupFiles(req.files);
      return response.error(res, 413, 'FILE_TOO_LARGE', '动作迁移素材过大，驱动视频建议裁剪到 5-15 秒后再上传');
    }
    if (err) {
      cleanupFiles(req.files);
      return response.badRequest(res, err.message || '上传失败');
    }
    next();
  });
}

function routes(db, cfg, log) {
  return {
    capability: (_req, res) => {
      try {
        response.success(res, actionMigrationService.getCapability(db));
      } catch (err) {
        log.error('action migration capability', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    listJobs: (req, res) => {
      try {
        response.success(res, actionMigrationService.listJobs(db, cfg, req.query || {}));
      } catch (err) {
        log.error('action migration listJobs', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    createJob: [
      uploadMiddleware,
      (req, res) => {
        try {
          const job = actionMigrationService.createJob(db, cfg, log, req.body || {}, req.files || {});
          response.created(res, job);
        } catch (err) {
          cleanupFiles(req.files);
          log.error('action migration createJob', { error: err.message });
          response.badRequest(res, err.message);
        }
      },
    ],

    getJob: (req, res) => {
      try {
        const job = actionMigrationService.getJob(db, cfg, req.params.job_id);
        if (!job) return response.notFound(res, '动作迁移任务不存在');
        response.success(res, job);
      } catch (err) {
        log.error('action migration getJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    preflightJob: (req, res) => {
      try {
        const report = actionMigrationService.updatePreflight(db, cfg, req.params.job_id);
        if (!report) return response.notFound(res, '动作迁移任务不存在');
        response.success(res, report);
      } catch (err) {
        log.error('action migration preflightJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    submitJob: (req, res) => {
      try {
        const job = actionMigrationService.submitJob(db, cfg, log, req.params.job_id, req.body || {});
        if (!job) return response.notFound(res, '动作迁移任务不存在');
        response.success(res, job);
      } catch (err) {
        log.error('action migration submitJob', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    retryJob: (req, res) => {
      try {
        const job = actionMigrationService.retryJob(db, cfg, log, req.params.job_id, req.body || {});
        if (!job) return response.notFound(res, '动作迁移任务不存在');
        response.success(res, job);
      } catch (err) {
        log.error('action migration retryJob', { error: err.message });
        response.badRequest(res, err.message);
      }
    },

    cancelJob: (req, res) => {
      try {
        const job = actionMigrationService.cancelJob(db, log, req.params.job_id);
        if (!job) return response.notFound(res, '动作迁移任务不存在');
        response.success(res, job);
      } catch (err) {
        log.error('action migration cancelJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    deleteJob: (req, res) => {
      try {
        const ok = actionMigrationService.deleteJob(db, req.params.job_id);
        if (!ok) return response.notFound(res, '动作迁移任务不存在');
        response.success(res, { ok: true });
      } catch (err) {
        log.error('action migration deleteJob', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;

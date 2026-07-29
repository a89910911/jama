const path = require('path');
const multer = require('multer');
const response = require('../response');
const uploadService = require('../services/uploadService');
const storageLayout = require('../services/storageLayout');
const assetService = require('../services/assetService');

const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'];
const maxSize = 16 * 1024 * 1024; // 16MB，单张图片上限
const MAX_SIZE_MB = 16;
const allowedMediaTypes = new Set([
  ...allowedTypes,
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);
const maxMediaSize = 500 * 1024 * 1024;
const MAX_MEDIA_SIZE_MB = 500;

const memoryStorage = multer.memoryStorage();
const upload = multer({
  storage: memoryStorage,
  limits: { fileSize: maxSize },
  fileFilter: (req, file, cb) => {
    const ct = file.mimetype || 'application/octet-stream';
    if (!allowedTypes.includes(ct)) {
      return cb(new Error('只支持图片格式 (jpg, png, gif, webp)'));
    }
    cb(null, true);
  },
});

const mediaUpload = multer({
  storage: memoryStorage,
  limits: { fileSize: maxMediaSize },
  fileFilter: (req, file, cb) => {
    const ct = String(file.mimetype || '').toLowerCase();
    if (!allowedMediaTypes.has(ct)) {
      return cb(new Error('只支持图片或视频格式 (jpg, png, gif, webp, mp4, webm, mov)'));
    }
    cb(null, true);
  },
});

function multerMediaSingle(req, res, next) {
  mediaUpload.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      return response.error(
        res,
        413,
        'FILE_TOO_LARGE',
        `媒体素材不能超过 ${MAX_MEDIA_SIZE_MB}MB`
      );
    }
    if (err) return response.badRequest(res, err.message || '素材上传失败');
    return next();
  });
}

function resolveUploadContext(cfg, db, dramaId) {
  const rawStorage = cfg?.storage?.local_path || './data/storage';
  const storagePath = path.isAbsolute(rawStorage)
    ? rawStorage
    : path.join(process.cwd(), rawStorage);
  const baseUrl = cfg?.storage?.base_url || '';
  let projectSubdir = null;
  if (db) {
    const did =
      dramaId !== undefined && dramaId !== null && String(dramaId).trim() !== ''
        ? Number(dramaId)
        : NaN;
    if (Number.isFinite(did) && did > 0) {
      projectSubdir = storageLayout.getProjectStorageSubdir(db, did);
    }
  }
  return { storagePath, baseUrl, projectSubdir };
}

function routes(cfg, log, db) {
  const singleUpload = upload.single('file');
  return {
    multerSingle: singleUpload,
    uploadImage: (req, res) => {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请选择文件');
      }
      try {
        const { storagePath, baseUrl, projectSubdir } = resolveUploadContext(
          cfg,
          db,
          req.body?.drama_id
        );
        const result = uploadService.uploadFile(
          storagePath,
          baseUrl,
          log,
          req.file.buffer,
          req.file.originalname || 'image.png',
          req.file.mimetype,
          'uploads',
          projectSubdir
        );
        response.success(res, {
          url: result.url,
          path: result.local_path,
          local_path: result.local_path,
          filename: req.file.originalname,
          size: req.file.size,
        });
      } catch (err) {
        log.error('upload image', { error: err.message });
        response.internalError(res, err.message || '上传失败');
      }
    },
    uploadMediaAsset: (req, res) => {
      if (!req.file || !req.file.buffer) {
        return response.badRequest(res, '请选择文件');
      }
      try {
        const dramaId = Number(req.body?.drama_id);
        const { storagePath, baseUrl, projectSubdir } = resolveUploadContext(
          cfg,
          db,
          dramaId
        );
        const result = uploadService.uploadFile(
          storagePath,
          baseUrl,
          log,
          req.file.buffer,
          req.file.originalname || 'media',
          req.file.mimetype,
          'media',
          projectSubdir
        );
        const type = String(req.file.mimetype || '').startsWith('video/')
          ? 'video'
          : 'image';
        const item = assetService.create(db, log, {
          drama_id: Number.isFinite(dramaId) && dramaId > 0 ? dramaId : null,
          name: req.file.originalname || '未命名素材',
          type,
          category: req.body?.category || 'upload',
          url: result.url,
          local_path: result.local_path,
          file_size: req.file.size ?? req.file.buffer.length,
          mime_type: req.file.mimetype || null,
        });
        response.created(res, item);
      } catch (err) {
        log.error('upload media asset', { error: err.message });
        response.internalError(res, err.message || '素材上传失败');
      }
    },
  };
}

module.exports = {
  routes,
  upload,
  multerSingle: upload.single('file'),
  multerMediaSingle,
  MAX_IMAGE_SIZE_MB: MAX_SIZE_MB,
  MAX_MEDIA_SIZE_MB,
};

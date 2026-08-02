const path = require('path');
const { randomUUID } = require('crypto');
const { loadConfig } = require('../config');
const { tableExists } = require('../db/portableSql');
const uploadService = require('./uploadService');
const storageLayout = require('./storageLayout');
const {
  existingLocalMedia,
  isDataUrl,
  localUrl,
  resolveStorageRoot,
} = require('./localMediaService');

const ACTIVE_JOB_STATUSES = new Set(['pending', 'running']);
const MAX_DUE_JOBS = 20;
const DEFAULT_INTERVAL_MS = 15 * 1000;
const activeJobs = new Set();

const LAST_FRAME_TYPES = new Set(['last', 'storyboard_last', 'tail', 'last_frame']);
const GRID_FRAME_TYPES = new Set(['quad_grid', 'nine_grid']);

function nowIso() {
  return new Date().toISOString();
}

function isMissingSchemaError(error) {
  const msg = String(error?.message || '').toLowerCase();
  return msg.includes('no such table')
    || msg.includes('no such column')
    || error?.errno === 1146
    || error?.code === 'ER_NO_SUCH_TABLE';
}

function hasLocalizationTable(db) {
  try {
    return tableExists(db, 'media_localization_jobs');
  } catch (_) {
    return false;
  }
}

function resolveStoragePath(cfg = loadConfig()) {
  return resolveStorageRoot(cfg.storage?.local_path || './data/storage');
}

function isRemoteDownloadUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || isDataUrl(raw) || raw.startsWith('/static/')) return false;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch (_) {
    return false;
  }
}

function normalizePublicUrl(localPath) {
  return localUrl(String(localPath || '').replace(/^\/+/, ''));
}

function imageCategoryForRow(row) {
  if (row?.scene_id != null && row?.storyboard_id == null) return 'scenes';
  if (row?.character_id != null || row?.character_look_id != null) return 'characters';
  if (row?.prop_id != null) return 'props';
  return 'images';
}

function markGenerationLocalizePending(db, generationType, generationId, sourceUrl) {
  const table = generationType === 'video_generation' ? 'video_generations' : 'image_generations';
  try {
    db.prepare(
      `UPDATE ${table}
          SET provider_url = COALESCE(provider_url, ?),
              localize_status = 'pending',
              localize_error = NULL,
              updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`
    ).run(sourceUrl, nowIso(), Number(generationId));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
}

function markGenerationLocalizeFailed(db, generationType, generationId, message) {
  const table = generationType === 'video_generation' ? 'video_generations' : 'image_generations';
  try {
    db.prepare(
      `UPDATE ${table}
          SET localize_status = 'failed',
              localize_error = ?,
              updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`
    ).run(String(message || '本地化失败').slice(0, 1000), nowIso(), Number(generationId));
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
}

function nextRetryAt(attempts) {
  const delayMs = Math.min(30 * 60 * 1000, Math.max(30 * 1000, (2 ** Math.max(0, attempts - 1)) * 30 * 1000));
  return new Date(Date.now() + delayMs).toISOString();
}

function enqueueLocalization(db, log, generationType, generationId, sourceUrl, options = {}) {
  if (!hasLocalizationTable(db)) return null;
  const id = Number(generationId);
  const rawUrl = String(sourceUrl || '').trim();
  if (!id || !rawUrl || !isRemoteDownloadUrl(rawUrl)) return null;

  try {
    const existing = db.prepare(
      `SELECT id, status
         FROM media_localization_jobs
        WHERE generation_type = ?
          AND generation_id = ?
          AND source_url = ?
          AND deleted_at IS NULL
          AND status IN ('pending', 'running')
        ORDER BY created_at DESC
        LIMIT 1`
    ).get(generationType, id, rawUrl);
    if (existing?.id) {
      setImmediate(() => processJobById(db, log, existing.id));
      return existing.id;
    }
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return null;
  }

  const jobId = randomUUID();
  const now = nowIso();
  const mediaType = generationType === 'video_generation' ? 'video' : 'image';
  const maxAttempts = Math.max(1, Math.min(10, Number(options.maxAttempts) || 3));
  try {
    db.prepare(
      `INSERT INTO media_localization_jobs
        (id, media_type, generation_type, generation_id, source_url,
         storage_category, status, attempts, max_attempts, next_run_at,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`
    ).run(
      jobId,
      mediaType,
      generationType,
      id,
      rawUrl,
      options.storageCategory || null,
      maxAttempts,
      now,
      now,
      now
    );
    markGenerationLocalizePending(db, generationType, id, rawUrl);
    setImmediate(() => processJobById(db, log, jobId));
    return jobId;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return null;
  }
}

function enqueueImageLocalization(db, log, imageGenerationId, sourceUrl, options = {}) {
  return enqueueLocalization(db, log, 'image_generation', imageGenerationId, sourceUrl, options);
}

function enqueueVideoLocalization(db, log, videoGenerationId, sourceUrl, options = {}) {
  return enqueueLocalization(db, log, 'video_generation', videoGenerationId, sourceUrl, options);
}

function updateAssetsForImage(db, imageGenId, finalUrl, localPath, sourceUrl, now) {
  try {
    db.prepare(
      `UPDATE assets
          SET url = ?, local_path = ?, updated_at = ?
        WHERE image_gen_id = ?
          AND deleted_at IS NULL
          AND (url = ? OR local_path IS NULL OR local_path = '')`
    ).run(finalUrl, localPath, now, Number(imageGenId), sourceUrl);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
}

function updateAssetsForVideo(db, videoGenId, finalUrl, localPath, sourceUrl, now) {
  try {
    db.prepare(
      `UPDATE assets
          SET url = ?, local_path = ?, updated_at = ?
        WHERE video_gen_id = ?
          AND deleted_at IS NULL
          AND (url = ? OR local_path IS NULL OR local_path = '')`
    ).run(finalUrl, localPath, now, Number(videoGenId), sourceUrl);
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
  }
}

function isLastFrameType(frameType) {
  return LAST_FRAME_TYPES.has(String(frameType || '').toLowerCase());
}

function shouldBindStoryboardImage(row) {
  if (!row?.storyboard_id || row.superseded) return false;
  return !GRID_FRAME_TYPES.has(String(row.frame_type || '').toLowerCase());
}

function updateStoryboardImageBinding(db, row, finalUrl, localPath, sourceUrl, now) {
  if (!shouldBindStoryboardImage(row)) return;
  if (isLastFrameType(row.frame_type)) {
    db.prepare(
      `UPDATE storyboards
          SET last_frame_image_url = ?, last_frame_local_path = ?, updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND (last_frame_image_id = ? OR (last_frame_image_id IS NULL AND last_frame_image_url = ?))`
    ).run(finalUrl, localPath, now, Number(row.storyboard_id), Number(row.id), sourceUrl);
    return;
  }
  db.prepare(
    `UPDATE storyboards
        SET image_url = ?, local_path = ?, updated_at = ?
      WHERE id = ?
        AND deleted_at IS NULL
        AND (first_frame_image_id = ? OR (first_frame_image_id IS NULL AND image_url = ?))`
  ).run(finalUrl, localPath, now, Number(row.storyboard_id), Number(row.id), sourceUrl);
}

function updateEntityImageBinding(db, row, finalUrl, localPath, sourceUrl, now) {
  if (row.storyboard_id != null) return;
  if (row.character_look_id != null) {
    const changed = db.prepare(
      `UPDATE character_looks
          SET image_url = ?, local_path = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND image_url = ?`
    ).run(finalUrl, localPath, now, Number(row.character_look_id), sourceUrl).changes;
    if (changed) {
      try {
        const characterLookService = require('./characterLookService');
        const look = characterLookService.getLookRow(db, row.character_look_id);
        if (look?.character_id) characterLookService.mirrorDefaultLookToCharacter(db, look.character_id);
      } catch (_) {}
    }
    return;
  }
  if (row.character_id != null) {
    const changed = db.prepare(
      `UPDATE characters
          SET image_url = ?, local_path = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND image_url = ?`
    ).run(finalUrl, localPath, now, Number(row.character_id), sourceUrl).changes;
    if (changed) {
      try {
        require('./characterLookService').syncDefaultLookFromCharacter(
          db,
          row.character_id,
          ['image_url', 'local_path']
        );
      } catch (_) {}
    }
    return;
  }
  if (row.scene_id != null) {
    db.prepare(
      `UPDATE scenes
          SET image_url = ?, local_path = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND image_url = ?`
    ).run(finalUrl, localPath, now, Number(row.scene_id), sourceUrl);
    return;
  }
  if (row.prop_id != null) {
    db.prepare(
      `UPDATE props
          SET image_url = ?, local_path = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL AND image_url = ?`
    ).run(finalUrl, localPath, now, Number(row.prop_id), sourceUrl);
  }
}

async function normalizeLocalizedImage(storagePath, localPath, row, log) {
  if (!localPath || !row?.size) return;
  try {
    const imageService = require('./imageService');
    const absPath = path.join(storagePath, ...String(localPath).split('/'));
    await imageService.normalizeLocalImageToTargetSize?.(absPath, row.size, log, { id: row.id });
    if (!GRID_FRAME_TYPES.has(String(row.frame_type || '').toLowerCase())) {
      await imageService.normalizeSavedImageToTargetPixels?.(absPath, row.size, log, {
        id: row.id,
        size: row.size,
      });
    }
  } catch (error) {
    log?.warn?.('Localized image normalization skipped', {
      image_generation_id: row?.id,
      error: error.message,
    });
  }
}

async function splitGridIfNeeded(db, log, row, storagePath, localPath, finalUrl) {
  const frameType = String(row?.frame_type || '').toLowerCase();
  if (!GRID_FRAME_TYPES.has(frameType) || !localPath) return;
  try {
    const existing = db.prepare(
      `SELECT id FROM image_generations
        WHERE parent_generation_id = ?
          AND deleted_at IS NULL
        LIMIT 1`
    ).get(Number(row.id));
    if (existing?.id) return;
  } catch (_) {}

  try {
    const imageService = require('./imageService');
    const absPath = path.join(storagePath, ...String(localPath).split('/'));
    if (frameType === 'quad_grid') {
      await imageService.splitQuadGridToImages?.(db, log, row, absPath, storagePath, finalUrl);
    } else if (frameType === 'nine_grid') {
      await imageService.splitNineGridToImages?.(db, log, row, absPath, storagePath, finalUrl);
    }
  } catch (error) {
    log?.warn?.('Localized grid image split failed', {
      image_generation_id: row?.id,
      frame_type: row?.frame_type,
      error: error.message,
    });
  }
}

async function localizeImageJob(db, log, job) {
  const row = db.prepare(
    'SELECT * FROM image_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(job.generation_id));
  if (!row) throw new Error('图片生成记录不存在或已删除');

  const cfg = loadConfig();
  const storagePath = resolveStoragePath(cfg);
  const sourceUrl = String(job.source_url || row.provider_url || row.image_url || '').trim();
  if (!sourceUrl) throw new Error('缺少图片下载地址');

  const existing = existingLocalMedia(storagePath, sourceUrl, cfg.storage?.base_url);
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
  const category = job.storage_category || imageCategoryForRow(row);
  const localPath = existing?.local_path || await uploadService.downloadImageToLocal(
    storagePath,
    sourceUrl,
    category,
    log,
    `ig_${row.id}`,
    projectSubdir
  );
  if (!localPath) throw new Error('图片下载到本地失败');

  await normalizeLocalizedImage(storagePath, localPath, row, log);

  const finalUrl = normalizePublicUrl(localPath);
  const now = nowIso();
  db.prepare(
    `UPDATE image_generations
        SET image_url = ?, local_path = ?, localize_status = 'completed',
            localize_error = NULL, localized_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`
  ).run(finalUrl, localPath, now, now, Number(row.id));

  updateStoryboardImageBinding(db, row, finalUrl, localPath, sourceUrl, now);
  updateEntityImageBinding(db, row, finalUrl, localPath, sourceUrl, now);
  updateAssetsForImage(db, row.id, finalUrl, localPath, sourceUrl, now);
  await splitGridIfNeeded(db, log, row, storagePath, localPath, finalUrl);

  return { local_path: localPath, url: finalUrl };
}

async function localizeVideoJob(db, log, job) {
  const row = db.prepare(
    'SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(job.generation_id));
  if (!row) throw new Error('视频生成记录不存在或已删除');

  const cfg = loadConfig();
  const storagePath = resolveStoragePath(cfg);
  const sourceUrl = String(job.source_url || row.provider_url || row.video_url || '').trim();
  if (!sourceUrl) throw new Error('缺少视频下载地址');

  const existing = existingLocalMedia(storagePath, sourceUrl, cfg.storage?.base_url);
  const videoService = require('./videoService');
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, row.drama_id);
  const localPath = existing?.local_path || await videoService.downloadVideoToLocal(
    storagePath,
    sourceUrl,
    row.id,
    log,
    projectSubdir
  );
  if (!localPath) throw new Error('视频下载到本地失败');

  try {
    videoService.maybeNormalizeVideoAfterDownload?.(storagePath, localPath, row, row.id, log);
  } catch (_) {}

  const finalUrl = normalizePublicUrl(localPath);
  const now = nowIso();
  db.prepare(
    `UPDATE video_generations
        SET video_url = ?, local_path = ?, localize_status = 'completed',
            localize_error = NULL, localized_at = ?, updated_at = ?
      WHERE id = ? AND deleted_at IS NULL`
  ).run(finalUrl, localPath, now, now, Number(row.id));

  if (!row.superseded && row.storyboard_id != null) {
    db.prepare(
      `UPDATE storyboards
          SET video_url = ?, updated_at = ?
        WHERE id = ?
          AND deleted_at IS NULL
          AND current_video_generation_id = ?`
    ).run(finalUrl, now, Number(row.storyboard_id), Number(row.id));
  }
  updateAssetsForVideo(db, row.id, finalUrl, localPath, sourceUrl, now);
  try { require('./redrawService').syncVideoGenerationResult(db, log, row.id); } catch (_) {}
  try { require('./actionMigrationService').syncVideoGenerationResult(db, cfg, row.id); } catch (_) {}

  return { local_path: localPath, url: finalUrl };
}

async function processJob(db, log, job) {
  if (!job?.id || activeJobs.has(job.id)) return null;
  activeJobs.add(job.id);
  const startedAt = nowIso();
  try {
    db.prepare(
      `UPDATE media_localization_jobs
          SET status = 'running', attempts = COALESCE(attempts, 0) + 1,
              updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`
    ).run(startedAt, job.id);

    const result = job.generation_type === 'video_generation'
      ? await localizeVideoJob(db, log, job)
      : await localizeImageJob(db, log, job);

    const now = nowIso();
    db.prepare(
      `UPDATE media_localization_jobs
          SET status = 'completed', error_msg = NULL,
              completed_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(now, now, job.id);
    log?.info?.('Media localized to local storage', {
      job_id: job.id,
      generation_type: job.generation_type,
      generation_id: job.generation_id,
      local_path: result.local_path,
    });
    return result;
  } catch (error) {
    const attempts = Number(job.attempts || 0) + 1;
    const maxAttempts = Number(job.max_attempts || 3);
    const terminal = attempts >= maxAttempts;
    const now = nowIso();
    db.prepare(
      `UPDATE media_localization_jobs
          SET status = ?, error_msg = ?, next_run_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(
      terminal ? 'failed' : 'pending',
      String(error.message || '本地化失败').slice(0, 1000),
      terminal ? null : nextRetryAt(attempts),
      now,
      job.id
    );
    if (terminal) {
      markGenerationLocalizeFailed(
        db,
        job.generation_type,
        job.generation_id,
        error.message
      );
    }
    log?.warn?.('Media localization failed', {
      job_id: job.id,
      generation_type: job.generation_type,
      generation_id: job.generation_id,
      attempts,
      max_attempts: maxAttempts,
      retry: !terminal,
      error: error.message,
    });
    return null;
  } finally {
    activeJobs.delete(job.id);
  }
}

async function processJobById(db, log, jobId) {
  if (!hasLocalizationTable(db)) return null;
  const job = db.prepare(
    `SELECT * FROM media_localization_jobs
      WHERE id = ? AND deleted_at IS NULL`
  ).get(String(jobId || ''));
  if (!job || !ACTIVE_JOB_STATUSES.has(job.status)) return null;
  return processJob(db, log, job);
}

async function processDueJobs(db, log, options = {}) {
  if (!hasLocalizationTable(db)) return 0;
  const limit = Math.min(100, Math.max(1, Number(options.limit) || MAX_DUE_JOBS));
  const now = nowIso();
  const jobs = db.prepare(
    `SELECT * FROM media_localization_jobs
      WHERE status = 'pending'
        AND deleted_at IS NULL
        AND COALESCE(attempts, 0) < COALESCE(max_attempts, 3)
        AND (next_run_at IS NULL OR next_run_at <= ?)
      ORDER BY created_at ASC
      LIMIT ?`
  ).all(now, limit);
  for (const job of jobs) {
    await processJob(db, log, job);
  }
  return jobs.length;
}

function resetInterruptedLocalizations(db, log) {
  if (!hasLocalizationTable(db)) return 0;
  try {
    const now = nowIso();
    const changed = db.prepare(
      `UPDATE media_localization_jobs
          SET status = 'pending',
              next_run_at = ?,
              updated_at = ?
        WHERE status = 'running'
          AND deleted_at IS NULL
          AND COALESCE(attempts, 0) < COALESCE(max_attempts, 3)`
    ).run(now, now).changes;
    if (changed) {
      log?.warn?.('Interrupted media localization jobs reset', { count: changed });
    }
    return changed;
  } catch (error) {
    if (!isMissingSchemaError(error)) throw error;
    return 0;
  }
}

function resumePendingLocalizations(db, log, options = {}) {
  resetInterruptedLocalizations(db, log);
  setImmediate(() => {
    processDueJobs(db, log, options).catch((error) => {
      log?.warn?.('Media localization resume failed', { error: error.message });
    });
  });
}

function startMediaLocalizationWorker(db, log, options = {}) {
  const intervalMs = Math.max(1000, Number(options.intervalMs) || DEFAULT_INTERVAL_MS);
  const tick = () => {
    processDueJobs(db, log, options).catch((error) => {
      log?.warn?.('Media localization worker failed', { error: error.message });
    });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  enqueueImageLocalization,
  enqueueVideoLocalization,
  enqueueLocalization,
  processDueJobs,
  processJobById,
  resetInterruptedLocalizations,
  resumePendingLocalizations,
  startMediaLocalizationWorker,
  isRemoteDownloadUrl,
};

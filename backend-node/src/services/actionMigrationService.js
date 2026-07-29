const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const taskService = require('./taskService');
const videoClient = require('./videoClient');
const storageLayout = require('./storageLayout');
const { getFfmpegPath, getFfprobePath, hasLocalFfmpeg } = require('../utils/ffmpegPath');
const characterLookService = require('./characterLookService');
const visualContextResolver = require('./visualContextResolver');

const MODE_PRESETS = {
  identity: {
    label: 'identity',
    structure: { width: 36, blur: 10, contrast: 0.45, maskBottom: 0.22 },
    instruction: 'Prioritize the reference person identity, face, hair, clothing, and body shape. Use the driving video only for broad timing and pose.',
  },
  balanced: {
    label: 'balanced',
    structure: { width: 48, blur: 8, contrast: 0.55, maskBottom: 0.18 },
    instruction: 'Balance motion following and identity preservation. Keep the action rhythm while replacing the original actor completely.',
  },
  motion: {
    label: 'motion',
    structure: { width: 72, blur: 5, contrast: 0.7, maskBottom: 0.14 },
    instruction: 'Follow the driving action, camera rhythm, and body pose more closely while still preserving the reference person identity.',
  },
};

const SUPPORTED_REFERENCE_VIDEO_PROTOCOLS = new Set(['volcengine_omni', 'mediabridge']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm', '.m4v', '.avi', '.mkv']);
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    const parsed = JSON.parse(value);
    return parsed == null ? fallback : parsed;
  } catch (_) {
    return fallback;
  }
}

function stringify(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function storageRootFromConfig(cfg) {
  return path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function safeExt(originalName, allowed, fallback) {
  const ext = path.extname(originalName || '').toLowerCase();
  return allowed.has(ext) ? ext : fallback;
}

function publicUrlFromLocalPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  if (raw.startsWith('/static/')) return raw;
  return `/static/${raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`;
}

function absoluteStoragePath(cfg, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) && !raw.includes('/static/')) return null;
  const storageRoot = storageRootFromConfig(cfg);
  let rel = raw;
  if (raw.includes('/static/')) rel = raw.split('/static/')[1] || '';
  rel = rel.replace(/^\/?static\//i, '').replace(/^[/\\]+/, '').split(/[?#]/)[0];
  return path.isAbsolute(raw) ? raw : path.join(storageRoot, rel);
}

function fileInfo(cfg, value) {
  const abs = absoluteStoragePath(cfg, value);
  if (!abs) return { exists: /^https?:\/\//i.test(String(value || '')), absolute_path: null };
  try {
    const stat = fs.statSync(abs);
    return { exists: stat.isFile(), absolute_path: abs, bytes: stat.size };
  } catch (_) {
    return { exists: false, absolute_path: abs };
  }
}

function moveUploadToJobDir(cfg, db, jobId, dramaId, file, kind) {
  if (!file?.path) throw new Error(`${kind} upload missing`);
  const storageRoot = storageRootFromConfig(cfg);
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const relDir = `${projectSubdir}/action-migration/${jobId}`.replace(/\\/g, '/');
  const absDir = path.join(storageRoot, relDir);
  ensureDir(absDir);

  const allowed = kind === 'driving' ? VIDEO_EXTS : IMAGE_EXTS;
  const fallback = kind === 'driving' ? '.mp4' : '.png';
  const ext = safeExt(file.originalname, allowed, fallback);
  const name = `${kind}${ext}`;
  const absPath = path.join(absDir, name);
  try {
    fs.renameSync(file.path, absPath);
  } catch (_) {
    fs.copyFileSync(file.path, absPath);
    fs.unlinkSync(file.path);
  }
  const relPath = `${relDir}/${name}`.replace(/\\/g, '/');
  return {
    local_path: relPath,
    url: publicUrlFromLocalPath(relPath),
    absolute_path: absPath,
    filename: file.originalname || name,
    bytes: file.size || fs.statSync(absPath).size,
  };
}

function parseFrameRate(raw) {
  const text = String(raw || '');
  const parts = text.split('/');
  if (parts.length === 2) {
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (a > 0 && b > 0) return Math.round((a / b) * 100) / 100;
  }
  const n = Number(text);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function probeVideo(absPath) {
  if (!absPath || !fs.existsSync(absPath)) return null;
  try {
    const out = spawnSync(getFfprobePath(), [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,r_frame_rate,duration:format=duration',
      '-of', 'json',
      absPath,
    ], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
    if (out.status !== 0 || !out.stdout) return null;
    const data = JSON.parse(out.stdout);
    const stream = (data.streams || [])[0] || {};
    const formatDuration = Number(data.format?.duration);
    const streamDuration = Number(stream.duration);
    return {
      width: Number(stream.width || 0) || null,
      height: Number(stream.height || 0) || null,
      duration: Number.isFinite(streamDuration) && streamDuration > 0
        ? Math.round(streamDuration * 100) / 100
        : Number.isFinite(formatDuration) && formatDuration > 0
          ? Math.round(formatDuration * 100) / 100
          : null,
      fps: parseFrameRate(stream.r_frame_rate),
    };
  } catch (_) {
    return null;
  }
}

function aspectFromDimensions(width, height) {
  const w = Number(width || 0);
  const h = Number(height || 0);
  if (!w || !h) return '9:16';
  const ratio = w / h;
  if (Math.abs(ratio - 16 / 9) < 0.12) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.12) return '9:16';
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  return w >= h ? '16:9' : '9:16';
}

function buildPrompt(mode, userPrompt) {
  const preset = MODE_PRESETS[mode] || MODE_PRESETS.balanced;
  const base = String(userPrompt || '').trim();
  return [
    'Task: action migration. Generate a clean video of the exact person from the reference image performing the action from the driving video.',
    preset.instruction,
    'Use the driving video only for body pose, movement rhythm, camera motion, staging, spatial timing, and performance intensity.',
    'Use the reference image for identity, face, hair, outfit, body proportions, and visible personal details.',
    'Replace the original actor, original face, original costume, original scene details, subtitles, logos, and watermarks from the driving video.',
    base ? `User direction: ${base}` : '',
    'Result: stable face, natural hands and feet, coherent clothing, no readable text, no watermark, no duplicated body.',
  ].filter(Boolean).join('\n');
}

function buildNegativePrompt(userNegative) {
  const defaults = [
    'original actor face',
    'original costume',
    'identity drift',
    'deformed face',
    'distorted hands',
    'extra fingers',
    'extra limbs',
    'fused legs',
    'duplicated body',
    'ghosting',
    'motion smear',
    'subtitles',
    'captions',
    'readable text',
    'watermark',
    'logo',
  ];
  const user = String(userNegative || '').trim();
  return user ? `${user}, ${defaults.join(', ')}` : defaults.join(', ');
}

function getVideoModel(config) {
  if (!config) return null;
  if (config.default_model) return config.default_model;
  if (Array.isArray(config.model)) return config.model[0] || null;
  const raw = String(config.model || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed[0] || null;
  } catch (_) {}
  return raw.split(',').map((item) => item.trim()).filter(Boolean)[0] || raw;
}

function getActionVideoConfig(db, userId) {
  return videoClient.getDefaultVideoConfig(db, null, 'action_migration', userId)
    || videoClient.getDefaultVideoConfig(db, null, 'redraw_generation', userId)
    || videoClient.getDefaultVideoConfig(db, null, 'video_generation', userId)
    || videoClient.getDefaultVideoConfig(db, null, null, userId);
}

function configCapability(config) {
  if (!config) {
    return {
      ok: false,
      code: 'missing_video_model',
      message: '未配置可用的视频模型',
      protocol: '',
      provider: '',
      model: '',
    };
  }
  const protocol = String(config.api_protocol || '').toLowerCase();
  const provider = String(config.provider || '').toLowerCase();
  const model = getVideoModel(config) || '';
  const ok = SUPPORTED_REFERENCE_VIDEO_PROTOCOLS.has(protocol)
    || SUPPORTED_REFERENCE_VIDEO_PROTOCOLS.has(provider)
    || videoClient.isMediaBridgeConfig(config);
  return {
    ok,
    code: ok ? 'supported' : 'unsupported_reference_video',
    message: ok
      ? '当前视频模型支持驱动视频参考'
      : `当前视频模型不支持动作迁移驱动视频：${protocol || provider || model || 'unknown'}`,
    protocol,
    provider: config.provider || '',
    model,
  };
}

function buildStructureFilter(mode) {
  const preset = (MODE_PRESETS[mode] || MODE_PRESETS.balanced).structure;
  return [
    `scale=${preset.width}:-2`,
    // 低分辨率结构图的色度平面很小；显式限制 chroma radius，
    // 避免 balanced/identity 的 luma blur 在 FFmpeg 中越界失败。
    `boxblur=${preset.blur}:1:2:1`,
    `eq=contrast=${preset.contrast}`,
    `drawbox=x=0:y=ih*(1-${preset.maskBottom}):w=iw:h=ih*${preset.maskBottom}:color=black:t=fill`,
  ].join(',');
}

function makeStructureVideo(cfg, db, log, jobId, dramaId, sourceAbs, sourceRel, mode, trim) {
  if (!hasLocalFfmpeg()) {
    return { local_path: sourceRel, url: publicUrlFromLocalPath(sourceRel), warning: '未找到 ffmpeg，已直接使用原始驱动视频' };
  }
  const storageRoot = storageRootFromConfig(cfg);
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, dramaId);
  const relDir = `${projectSubdir}/action-migration/${jobId}`.replace(/\\/g, '/');
  const absDir = path.join(storageRoot, relDir);
  ensureDir(absDir);
  const outName = `structure_${mode || 'balanced'}.mp4`;
  const absOut = path.join(absDir, outName);
  const relOut = `${relDir}/${outName}`.replace(/\\/g, '/');
  const filter = buildStructureFilter(mode);
  const args = ['-y'];
  if (trim?.start != null && Number(trim.start) > 0) args.push('-ss', String(Math.max(0, Number(trim.start))));
  args.push('-i', sourceAbs);
  if (trim?.end != null && trim?.start != null && Number(trim.end) > Number(trim.start)) {
    args.push('-t', String(Math.max(0.1, Number(trim.end) - Number(trim.start))));
  }
  args.push(
    '-vf', filter,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '30',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    absOut
  );
  const result = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    log?.warn?.('[action-migration] structure video failed, fallback source', {
      job_id: jobId,
      error: (result.stderr || result.stdout || '').slice(-500),
    });
    try { fs.unlinkSync(absOut); } catch (_) {}
    return { local_path: sourceRel, url: publicUrlFromLocalPath(sourceRel), warning: '结构源生成失败，已直接使用原始驱动视频' };
  }
  return { local_path: relOut, url: publicUrlFromLocalPath(relOut) };
}

function classifyError(message) {
  const text = String(message || '').toLowerCase();
  if (/unsupported|不支持/.test(text)) return 'unsupported_model';
  if (/timeout|timed out|超时/.test(text)) return 'provider_timeout';
  if (/download|下载/.test(text)) return 'download_failed';
  if (/not found|missing|不存在/.test(text)) return 'missing_asset';
  if (/policy|copyright|violation|restricted/.test(text)) return 'policy';
  return 'provider_failed';
}

function event(db, jobId, eventType, message, payload) {
  try {
    db.prepare(
      `INSERT INTO action_migration_events (job_id, event_type, message, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(jobId || null, eventType || '', message || '', stringify(payload), nowIso());
  } catch (_) {}
}

function rowToResult(row) {
  if (!row) return null;
  return {
    ...row,
    quality_report: parseJson(row.quality_report, null),
  };
}

function rowToJob(row, results = []) {
  if (!row) return null;
  return {
    ...row,
    preflight_report: parseJson(row.preflight_report, null),
    settings: parseJson(row.settings, {}),
    appearance_context: parseJson(row.appearance_context_json, null),
    context_stale: !!row.context_stale,
    results: results.map(rowToResult),
    current_result: results.map(rowToResult).find((item) => item?.id === row.current_result_id) || null,
  };
}

function getJobRow(db, jobId) {
  return db.prepare('SELECT * FROM action_migration_jobs WHERE id = ? AND deleted_at IS NULL').get(String(jobId));
}

function actionLookContext(db, dramaId, characterId, lookId) {
  const character = db.prepare(
    'SELECT * FROM characters WHERE id = ? AND drama_id = ? AND deleted_at IS NULL'
  ).get(Number(characterId), Number(dramaId));
  const look = characterLookService.getLookRow(db, lookId);
  if (!character || !look || Number(look.character_id) !== Number(character.id)) return null;
  const referenceUrl = visualContextResolver.publicMediaUrl(
    look,
    ['image_url', 'local_path', 'ref_image', 'four_view_image_url']
  );
  const context = {
    schema_version: '1.0',
    drama_id: Number(dramaId),
    characters: [{
      character_id: Number(character.id),
      character_name: character.name,
      look_id: Number(look.id),
      look_name: look.name,
      look_revision: Number(look.visual_revision || 1),
      reference_url: referenceUrl,
    }],
  };
  context.appearance_context_hash = visualContextResolver.hashObject(context);
  return { character, look, context, referenceUrl };
}

function syncActionLookContext(db, row) {
  if (!row?.character_id || !row?.character_look_id) return row;
  const resolved = actionLookContext(
    db,
    row.drama_id,
    row.character_id,
    row.character_look_id
  );
  if (!resolved?.referenceUrl) return row;
  db.prepare(
    `UPDATE action_migration_jobs
        SET reference_image_path = ?, reference_image_url = ?,
            appearance_context_json = ?, appearance_context_hash = ?,
            context_stale = 0, updated_at = ?
      WHERE id = ?`
  ).run(
    resolved.look.local_path || null,
    resolved.referenceUrl,
    JSON.stringify(resolved.context),
    resolved.context.appearance_context_hash,
    nowIso(),
    row.id
  );
  return getJobRow(db, row.id);
}

function calculatePreflight(db, cfg, row) {
  const issues = [];
  const driving = fileInfo(cfg, row.structure_video_path || row.driving_video_path);
  const reference = fileInfo(cfg, row.reference_image_path || row.reference_image_url);
  const meta = parseJson(row.settings, {}).video_metadata || {};
  const capability = configCapability(getActionVideoConfig(db, row.user_id));
  if (row.character_look_id && row.context_stale) {
    issues.push({
      level: 'error',
      code: 'stale_character_look',
      message: '所选角色造型已变化或不可用，请重新选择造型',
    });
  }

  if (!row.driving_video_path && !row.driving_video_url) {
    issues.push({ level: 'error', code: 'missing_driving_video', message: '缺少驱动视频' });
  } else if (!driving.exists && !/^https?:\/\//i.test(String(row.driving_video_url || ''))) {
    issues.push({ level: 'error', code: 'driving_video_missing', message: '驱动视频文件不存在' });
  }
  if (!row.reference_image_path && !row.reference_image_url) {
    issues.push({ level: 'error', code: 'missing_reference_image', message: '缺少参考人物图' });
  } else if (!reference.exists && !/^https?:\/\//i.test(String(row.reference_image_url || ''))) {
    issues.push({ level: 'error', code: 'reference_image_missing', message: '参考人物图文件不存在' });
  }
  if (!capability.ok) {
    issues.push({ level: 'error', code: capability.code, message: capability.message });
  }
  if (meta.duration && Number(meta.duration) > 15) {
    issues.push({ level: 'warning', code: 'long_driving_clip', message: '驱动片段超过 15 秒，建议裁剪到 5-8 秒以提高动作跟随和成功率' });
  }
  if (!row.structure_video_path) {
    issues.push({ level: 'warning', code: 'missing_structure_source', message: '缺少低细节结构源，容易继承原演员脸和服装' });
  }
  if (!hasLocalFfmpeg()) {
    issues.push({ level: 'warning', code: 'ffmpeg_unavailable', message: '未找到 ffmpeg，无法自动裁剪或生成低细节结构源' });
  }

  return {
    ok: !issues.some((item) => item.level === 'error'),
    issues,
    capability,
    video_metadata: meta,
    checked_at: nowIso(),
  };
}

function updatePreflight(db, cfg, jobId) {
  const row = syncActionLookContext(db, getJobRow(db, jobId));
  if (!row) return null;
  const report = calculatePreflight(db, cfg, row);
  const nextStatus = report.ok
    ? (['running', 'completed', 'failed'].includes(row.status) ? row.status : 'ready')
    : (row.status === 'running' ? 'running' : 'draft');
  db.prepare(
    `UPDATE action_migration_jobs
        SET preflight_report = ?, status = ?, error_code = ?, error_msg = ?, updated_at = ?
      WHERE id = ?`
  ).run(
    JSON.stringify(report),
    nextStatus,
    report.ok ? null : report.issues.find((item) => item.level === 'error')?.code || null,
    report.ok ? null : report.issues.find((item) => item.level === 'error')?.message || null,
    nowIso(),
    String(jobId)
  );
  return report;
}

const ACTION_MIGRATION_INSERT_SQL = `
  INSERT INTO action_migration_jobs
    (id, drama_id, title, mode, driving_video_path, driving_video_url, structure_video_path,
     reference_image_path, reference_image_url, prompt, negative_prompt, duration, aspect_ratio,
     resolution, status, settings, character_id, character_look_id,
     appearance_context_json, appearance_context_hash, context_stale,
     user_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, ?, ?, ?)
`;

function createJob(db, cfg, log, body, files) {
  const userId = require('./aiRequestLogService').currentUserId(body.user_id);
  if (!userId) throw new Error('缺少有效的用户身份');
  const drivingFile = files?.driving_video?.[0] || files?.drivingVideo?.[0];
  const referenceFile = files?.reference_image?.[0] || files?.referenceImage?.[0];
  if (!drivingFile) throw new Error('请上传驱动视频');

  const jobId = `am_${randomUUID().replace(/-/g, '').slice(0, 12)}`;
  const dramaId = body.drama_id ? Number(body.drama_id) : null;
  const characterId = body.character_id ? Number(body.character_id) : null;
  const lookId = body.character_look_id ? Number(body.character_look_id) : null;
  const resolvedLook = characterId && lookId
    ? actionLookContext(db, dramaId, characterId, lookId)
    : null;
  if ((characterId || lookId) && !resolvedLook) {
    throw new Error('所选角色造型不存在或不属于当前项目');
  }
  if (!referenceFile && !resolvedLook?.referenceUrl) throw new Error('请选择角色造型或上传参考人物图');
  const mode = MODE_PRESETS[body.mode] ? body.mode : 'balanced';
  const driving = moveUploadToJobDir(cfg, db, jobId, dramaId, drivingFile, 'driving');
  const reference = resolvedLook
    ? {
      local_path: resolvedLook.look.local_path || '',
      url: resolvedLook.referenceUrl,
      filename: `${resolvedLook.character.name}-${resolvedLook.look.name}`,
      bytes: null,
    }
    : moveUploadToJobDir(cfg, db, jobId, dramaId, referenceFile, 'reference');
  if (resolvedLook && referenceFile?.path) {
    try { fs.unlinkSync(referenceFile.path); } catch (_) {}
  }
  const metadata = probeVideo(driving.absolute_path) || {};
  const trim = {
    start: body.start_time !== '' && body.start_time != null ? Number(body.start_time) : null,
    end: body.end_time !== '' && body.end_time != null ? Number(body.end_time) : null,
  };
  const structure = makeStructureVideo(cfg, db, log, jobId, dramaId, driving.absolute_path, driving.local_path, mode, trim);
  const settings = {
    driving_filename: driving.filename,
    reference_filename: reference.filename,
    driving_bytes: driving.bytes,
    reference_bytes: reference.bytes,
    video_metadata: {
      ...metadata,
      duration: trim.start != null && trim.end != null && trim.end > trim.start
        ? Math.round((trim.end - trim.start) * 100) / 100
        : metadata.duration || null,
    },
    trim,
    structure_warning: structure.warning || null,
  };
  const aspect = body.aspect_ratio || aspectFromDimensions(metadata.width, metadata.height);
  const prompt = buildPrompt(mode, body.prompt);
  const negative = buildNegativePrompt(body.negative_prompt);
  const now = nowIso();
  db.prepare(ACTION_MIGRATION_INSERT_SQL).run(
    jobId,
    dramaId,
    String(body.title || '动作迁移任务').trim() || '动作迁移任务',
    mode,
    driving.local_path,
    driving.url,
    structure.local_path,
    reference.local_path,
    reference.url,
    prompt,
    negative,
    settings.video_metadata.duration || (body.duration ? Number(body.duration) : null),
    aspect,
    body.resolution || '480p',
    JSON.stringify(settings),
    characterId,
    lookId,
    resolvedLook ? JSON.stringify(resolvedLook.context) : null,
    resolvedLook?.context.appearance_context_hash || null,
    userId,
    now,
    now
  );
  event(db, jobId, 'created', '创建动作迁移任务', { mode, aspect, resolution: body.resolution || '480p' });
  updatePreflight(db, cfg, jobId);
  return getJob(db, cfg, jobId);
}

function syncVideoGenerationResult(db, cfg, videoGenId) {
  const video = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!video?.action_migration_job_id) return null;
  const row = getJobRow(db, video.action_migration_job_id);
  if (!row) return null;
  const result = db.prepare(
    'SELECT * FROM action_migration_results WHERE video_generation_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1'
  ).get(Number(videoGenId));
  if (!result) return null;
  const now = nowIso();
  if (video.status === 'completed') {
    const quality = inspectVideoResult(cfg, video);
    if (video.superseded) {
      db.prepare(
        `UPDATE action_migration_results
            SET status = 'completed', is_current = 0, video_url = ?, local_path = ?,
                error_code = 'superseded_context',
                error_msg = '生成期间角色造型已变化，结果仅保留在历史记录',
                quality_report = ?, completed_at = COALESCE(?, completed_at)
          WHERE id = ?`
      ).run(
        video.video_url || null,
        video.local_path || null,
        JSON.stringify(quality),
        video.completed_at || now,
        result.id
      );
      db.prepare(
        `UPDATE action_migration_jobs
            SET status = 'ready', current_video_generation_id = NULL,
                current_result_id = NULL, context_stale = 1,
                error_code = 'superseded_context',
                error_msg = '角色造型已变化，请按当前造型重新生成', updated_at = ?
          WHERE id = ?`
      ).run(now, row.id);
      event(db, row.id, 'superseded', '角色造型变化，旧结果未设为当前版本', {
        video_generation_id: video.id,
      });
      return getJobRow(db, row.id);
    }
    db.prepare(
      `UPDATE action_migration_results
          SET status = 'completed', video_url = ?, local_path = ?, error_code = NULL, error_msg = NULL,
              quality_report = ?, completed_at = COALESCE(?, completed_at)
        WHERE id = ?`
    ).run(video.video_url || null, video.local_path || null, JSON.stringify(quality), video.completed_at || now, result.id);
    db.prepare(
      `UPDATE action_migration_jobs
          SET status = 'completed', current_video_generation_id = ?, current_result_id = ?,
              error_code = NULL, error_msg = NULL, completed_at = COALESCE(completed_at, ?), updated_at = ?
        WHERE id = ?`
    ).run(video.id, result.id, video.completed_at || now, now, row.id);
    event(db, row.id, 'completed', '动作迁移生成完成', { video_generation_id: video.id });
  } else if (video.status === 'failed') {
    const code = classifyError(video.error_msg);
    db.prepare(
      `UPDATE action_migration_results
          SET status = 'failed', error_code = ?, error_msg = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ?`
    ).run(code, video.error_msg || '视频生成失败', now, result.id);
    db.prepare(
      `UPDATE action_migration_jobs
          SET status = 'failed', error_code = ?, error_msg = ?, updated_at = ?
        WHERE id = ?`
    ).run(code, video.error_msg || '视频生成失败', now, row.id);
    event(db, row.id, 'failed', '动作迁移生成失败', { video_generation_id: video.id, error: video.error_msg });
  }
  return getJobRow(db, row.id);
}

function inspectVideoResult(cfg, video) {
  const info = fileInfo(cfg, video.local_path || video.video_url);
  const issues = [];
  if (!video.video_url && !video.local_path) {
    issues.push({ level: 'error', code: 'missing_output', message: '结果缺少视频地址' });
  }
  if ((video.local_path || video.video_url) && !info.exists) {
    issues.push({ level: 'error', code: 'output_missing', message: '结果文件不存在' });
  }
  return {
    ok: !issues.some((item) => item.level === 'error'),
    issues,
    file: info,
    checked_at: nowIso(),
  };
}

function reconcileJob(db, cfg, jobId) {
  const row = getJobRow(db, jobId);
  if (!row) return null;
  if (row.current_video_generation_id) {
    syncVideoGenerationResult(db, cfg, row.current_video_generation_id);
  }
  return getJobRow(db, jobId);
}

function getJob(db, cfg, jobId) {
  const row = reconcileJob(db, cfg, jobId);
  if (!row) return null;
  const results = db.prepare(
    `SELECT * FROM action_migration_results
      WHERE job_id = ? AND deleted_at IS NULL
      ORDER BY version DESC, id DESC`
  ).all(String(jobId));
  return rowToJob(row, results);
}

function listJobs(db, cfg, query = {}) {
  let sql = 'FROM action_migration_jobs WHERE deleted_at IS NULL';
  const params = [];
  if (query.user_id) {
    sql += ' AND user_id = ?';
    params.push(Number(query.user_id));
  }
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.status) {
    sql += ' AND status = ?';
    params.push(String(query.status));
  }
  const rows = db.prepare(`SELECT * ${sql} ORDER BY updated_at DESC, created_at DESC LIMIT 100`).all(...params);
  return rows.map((row) => getJob(db, cfg, row.id)).filter(Boolean);
}

const ACTION_MIGRATION_VIDEO_INSERT_SQL = `
  INSERT INTO video_generations
    (drama_id, provider, prompt, model, duration, aspect_ratio, resolution, watermark,
     image_url, reference_image_urls, source_video_url, status, task_id,
     action_migration_job_id, appearance_context_json, appearance_context_hash,
     generation_context_hash, requested_by_user_id, ai_config_id,
     ai_config_revision_id, created_at, updated_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 'processing', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

function submitJob(db, cfg, log, jobId, options = {}) {
  let row = getJobRow(db, jobId);
  if (!row) return null;
  const report = updatePreflight(db, cfg, jobId);
  if (!report?.ok) {
    const first = report?.issues?.find((item) => item.level === 'error');
    throw new Error(first?.message || '预检未通过');
  }
  row = getJobRow(db, jobId);
  const config = getActionVideoConfig(db, row.user_id);
  const capability = configCapability(config);
  if (!capability.ok) throw new Error(capability.message);
  const source = row.structure_video_path || row.driving_video_path || row.driving_video_url;
  const reference = row.reference_image_url || publicUrlFromLocalPath(row.reference_image_path);
  const refs = [reference].filter(Boolean);
  const task = taskService.createTask(
    db,
    log || console,
    'action_migration_video_generation',
    row.id,
    row.user_id
  );
  const now = nowIso();
  const model = getVideoModel(config);
  const provider = config.provider || '';
  const finalPrompt = options.prompt ? buildPrompt(row.mode, options.prompt) : row.prompt;
  const generationContextHash = row.appearance_context_hash
    ? visualContextResolver.generationContextHash(row.appearance_context_hash, {
      prompt: finalPrompt,
      negative_prompt: row.negative_prompt,
      model,
      duration: row.duration,
      aspect_ratio: row.aspect_ratio,
      reference_urls: refs,
    })
    : null;
  const insertInfo = db.prepare(ACTION_MIGRATION_VIDEO_INSERT_SQL).run(
    row.drama_id || null,
    provider,
    finalPrompt,
    model,
    row.duration || null,
    row.aspect_ratio || '9:16',
    row.resolution || '480p',
    refs[0] || null,
    JSON.stringify(refs),
    publicUrlFromLocalPath(source),
    task.id,
    row.id,
    row.appearance_context_json || null,
    row.appearance_context_hash || null,
    generationContextHash,
    row.user_id,
    config.id,
    config.revision_id,
    now,
    now
  );
  const videoGenId = insertInfo.lastInsertRowid;
  const version = Number(db.prepare(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM action_migration_results WHERE job_id = ? AND deleted_at IS NULL'
  ).get(row.id)?.next_version || 1);
  const resultInfo = db.prepare(
    `INSERT INTO action_migration_results
      (job_id, video_generation_id, version, mode, status, is_current, created_at)
     VALUES (?, ?, ?, ?, 'processing', 1, ?)`
  ).run(row.id, videoGenId, version, row.mode || 'balanced', now);
  db.prepare('UPDATE action_migration_results SET is_current = 0 WHERE job_id = ? AND id != ?')
    .run(row.id, resultInfo.lastInsertRowid);
  db.prepare(
    `UPDATE action_migration_jobs
        SET status = 'running', current_video_generation_id = ?, current_result_id = ?,
            task_id = ?, model = ?, provider = ?, error_code = NULL, error_msg = NULL, updated_at = ?
      WHERE id = ?`
  ).run(videoGenId, resultInfo.lastInsertRowid, task.id, model, provider, now, row.id);
  event(db, row.id, 'submitted', '提交动作迁移生成', {
    video_generation_id: videoGenId,
    task_id: task.id,
    protocol: capability.protocol,
    model,
  });
  setImmediate(() => {
    try {
      require('./videoService').processVideoGeneration(db, log, videoGenId);
    } catch (error) {
      log?.error?.('[action-migration] start video generation failed', { job_id: row.id, error: error.message });
    }
  });
  return getJob(db, cfg, row.id);
}

function retryJob(db, cfg, log, jobId, body = {}) {
  return submitJob(db, cfg, log, jobId, body);
}

function cancelJob(db, log, jobId) {
  const row = getJobRow(db, jobId);
  if (!row) return null;
  if (row.task_id) taskService.cancelTask(db, log || console, row.task_id, '用户取消动作迁移任务');
  db.prepare(
    `UPDATE action_migration_jobs
        SET status = 'cancelled', error_code = 'cancelled', error_msg = '用户取消动作迁移任务', updated_at = ?
      WHERE id = ?`
  ).run(nowIso(), row.id);
  event(db, row.id, 'cancelled', '用户取消动作迁移任务', null);
  return getJobRow(db, row.id);
}

function deleteJob(db, jobId) {
  const row = getJobRow(db, jobId);
  if (!row) return false;
  const now = nowIso();
  db.prepare('UPDATE action_migration_jobs SET deleted_at = ?, updated_at = ? WHERE id = ?').run(now, now, row.id);
  db.prepare('UPDATE action_migration_results SET deleted_at = ? WHERE job_id = ?').run(now, row.id);
  return true;
}

function getCapability(db) {
  return configCapability(getActionVideoConfig(db));
}

module.exports = {
  MODE_PRESETS,
  createJob,
  listJobs,
  getJob,
  updatePreflight,
  submitJob,
  retryJob,
  cancelJob,
  deleteJob,
  syncVideoGenerationResult,
  getCapability,
  buildPrompt,
  buildNegativePrompt,
  configCapability,
  buildStructureFilter,
  ACTION_MIGRATION_INSERT_SQL,
  ACTION_MIGRATION_VIDEO_INSERT_SQL,
};

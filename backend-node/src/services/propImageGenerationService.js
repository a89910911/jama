// 与 Go PropService.GeneratePropImage + processPropImageGeneration 对齐：道具图片生成
const taskService = require('./taskService');
const imageClient = require('./imageClient');
const propService = require('./propService');
const mediaLocalizationService = require('./mediaLocalizationService');
const { aspectRatioToSize } = require('./imageService');

function appendPrompt(base, extra) {
  const add = (extra || '').toString().trim();
  if (!add) return (base || '').toString().trim();
  const current = (base || '').toString().trim();
  if (!current) return add;
  const lowerCurrent = current.toLowerCase();
  const lowerAdd = add.toLowerCase();
  if (lowerCurrent.includes(lowerAdd)) return current;
  return current + ', ' + add;
}

async function processPropImageGeneration(db, log, taskId, propId, opts) {
  taskService.updateTaskStatus(db, taskId, 'processing', 10, '正在准备道具图片…');

  const prop = propService.getById(db, propId);
  if (!prop) {
    taskService.updateTaskError(db, taskId, '道具不存在');
    return;
  }
  if (!prop.prompt || !String(prop.prompt).trim()) {
    taskService.updateTaskError(db, taskId, '道具没有图片提示词');
    return;
  }

  const loadConfig = require('../config').loadConfig;
  const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
  let cfg = loadConfig();
  if (prop.drama_id) {
    try {
      const dr = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(prop.drama_id);
      cfg = mergeCfgStyleWithDrama(cfg, dr || {});
    } catch (_) {}
  }
  const styleOverride = (opts && opts.style) ? String(opts.style).trim() : '';
  const baseStyle = styleOverride || (cfg?.style?.default_style_en || cfg?.style?.default_style || '');
  let style = '';
  style = appendPrompt(style, baseStyle);
  if (!styleOverride) {
    style = appendPrompt(style, cfg?.style?.default_prop_style || '');
  }
  // 优先用项目 aspect_ratio 推导尺寸；兜底 1920x1920（满足 ≥3,686,400 像素要求）
  let imageSize = null;
  if (prop.drama_id) {
    try {
      const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(prop.drama_id);
      if (dramaRow && dramaRow.metadata) {
        const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
        if (meta && meta.aspect_ratio) imageSize = aspectRatioToSize(meta.aspect_ratio);
      }
    } catch (_) {}
  }
  if (!imageSize) imageSize = cfg?.style?.default_image_size || '1920x1920';
  const useQuadGrid = !!opts?.useQuadGrid;
  if (useQuadGrid) imageSize = '1920x1920';
  const layoutPrompt = useQuadGrid
    ? 'A clean 2x2 four-view prop reference sheet showing the exact same single prop from front, side, back, and top views, consistent materials and proportions in every panel, seamless solid-color studio background, no people, no hands, no text, no watermark'
    : '';
  const assetPrompt = appendPrompt(String(prop.prompt).trim(), layoutPrompt);
  const fullPrompt = appendPrompt(assetPrompt, style);
  // 使用当前用户的个人图片配置；不再从 YAML 读取共享供应商回退。
  const model = (opts && opts.model) ? String(opts.model).trim() || null : null;
  const userNeg = imageClient.resolveAssetUserNegativeForApi(model, prop.negative_prompt);
  const selectedConfig = imageClient.getDefaultImageConfig(
    db,
    model || undefined,
    null,
    'image',
    opts?.user_id
  );
  if (!selectedConfig) {
    const errMsg = '当前账号尚未配置可用的图片 AI 服务';
    taskService.updateTaskError(db, taskId, errMsg);
    try {
      db.prepare('UPDATE props SET error_msg = ?, updated_at = ? WHERE id = ?').run(errMsg, new Date().toISOString(), propId);
    } catch (_) {}
    return;
  }

  const nowSubmit = new Date().toISOString();
  let imageGenId = null;
  try {
    const info = db.prepare(
      `INSERT INTO image_generations
        (drama_id, prop_id, provider, prompt, negative_prompt, model, size,
         quality, requested_by_user_id, ai_config_id, ai_config_revision_id,
         status, task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
    ).run(
      prop.drama_id || 0,
      propId,
      selectedConfig.provider || 'openai',
      fullPrompt,
      userNeg || null,
      model || null,
      imageSize,
      'standard',
      opts?.user_id || null,
      selectedConfig.id,
      selectedConfig.revision_id,
      taskId,
      nowSubmit,
      nowSubmit
    );
    imageGenId = info.lastInsertRowid;
  } catch (error) {
    if ((error.message || '').includes('prop_id')) {
      const info = db.prepare(
        `INSERT INTO image_generations
          (drama_id, provider, prompt, negative_prompt, model, size,
           quality, requested_by_user_id, ai_config_id, ai_config_revision_id,
           status, task_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'processing', ?, ?, ?)`
      ).run(
        prop.drama_id || 0,
        selectedConfig.provider || 'openai',
        fullPrompt,
        userNeg || null,
        model || null,
        imageSize,
        'standard',
        opts?.user_id || null,
        selectedConfig.id,
        selectedConfig.revision_id,
        taskId,
        nowSubmit,
        nowSubmit
      );
      imageGenId = info.lastInsertRowid;
    } else {
      throw error;
    }
  }

  let result;
  try {
    taskService.updateTaskStatus(db, taskId, 'processing', 20, '正在提交道具图片生成请求…');
    result = await imageClient.callImageApi(db, log, {
      prompt: fullPrompt,
      size: imageSize,
      drama_id: prop.drama_id,
      model: model || undefined,
      user_negative_prompt: userNeg || undefined,
      user_id: opts?.user_id,
      ai_config_id: selectedConfig.id,
      ai_config_revision_id: selectedConfig.revision_id,
      image_gen_id: imageGenId,
      prop_id: propId,
      image_type: 'prop_image_generation',
    });
  } catch (err) {
    const errMsg = '图片生成请求失败: ' + (err.message || '未知错误');
    log.error('Prop image API failed', { prop_id: propId, error: err.message });
    taskService.updateTaskError(db, taskId, errMsg);
    if (imageGenId) {
      try {
        db.prepare('UPDATE image_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?')
          .run('failed', errMsg, new Date().toISOString(), imageGenId);
      } catch (_) {}
    }
    try {
      db.prepare('UPDATE props SET error_msg = ?, updated_at = ? WHERE id = ?').run(errMsg, new Date().toISOString(), propId);
    } catch (_) {}
    return;
  }

  if (result.error) {
    taskService.updateTaskError(db, taskId, result.error);
    if (imageGenId) {
      try {
        db.prepare('UPDATE image_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?')
          .run('failed', result.error, new Date().toISOString(), imageGenId);
      } catch (_) {}
    }
    try {
      db.prepare('UPDATE props SET error_msg = ?, updated_at = ? WHERE id = ?').run(result.error, new Date().toISOString(), propId);
    } catch (_) {}
    return;
  }
  if (!result.image_url) {
    const errMsg = '未返回图片地址';
    taskService.updateTaskError(db, taskId, errMsg);
    if (imageGenId) {
      try {
        db.prepare('UPDATE image_generations SET status = ?, error_msg = ?, updated_at = ? WHERE id = ?')
          .run('failed', errMsg, new Date().toISOString(), imageGenId);
      } catch (_) {}
    }
    try {
      db.prepare('UPDATE props SET error_msg = ?, updated_at = ? WHERE id = ?').run(errMsg, new Date().toISOString(), propId);
    } catch (_) {}
    return;
  }

  taskService.updateTaskStatus(db, taskId, 'processing', 80, '图片已生成，正在写入记录...');
  const localPath = result.local_path || null;
  const providerUrl = result.provider_url || result.image_url;
  const persistedImageUrl = localPath
    ? '/static/' + String(localPath).replace(/^\//, '')
    : result.image_url;
  const shouldLocalize = !localPath && mediaLocalizationService.isRemoteDownloadUrl(result.image_url);
  const localizeStatus = localPath ? 'completed' : shouldLocalize ? 'pending' : 'none';

  const now = new Date().toISOString();
  const localizedAt = localPath ? now : null;
  if (imageGenId) {
    try {
      db.prepare(
        `UPDATE image_generations
            SET status = ?, provider_url = ?, image_url = ?, local_path = ?,
                localize_status = ?, localized_at = ?, error_msg = NULL,
                completed_at = ?, updated_at = ?
          WHERE id = ?`
      ).run(
        'completed',
        providerUrl,
        persistedImageUrl,
        localPath,
        localizeStatus,
        localizedAt,
        now,
        now,
        imageGenId
      );
    } catch (error) {
      if ((error.message || '').includes('provider_url')
        || (error.message || '').includes('localize_status')
        || (error.message || '').includes('localized_at')
        || (error.message || '').includes('completed_at')) {
        db.prepare(
          'UPDATE image_generations SET status = ?, image_url = ?, local_path = ?, error_msg = NULL, completed_at = ?, updated_at = ? WHERE id = ?'
        ).run('completed', persistedImageUrl, localPath, now, now, imageGenId);
      } else {
        throw error;
      }
    }
  }
  // 旧图追加到 extra_images，与上传逻辑保持一致
  const oldProp = db.prepare('SELECT local_path, image_url, extra_images FROM props WHERE id = ?').get(propId);
  const oldPath = oldProp?.local_path || oldProp?.image_url || '';
  let extras = [];
  try { extras = oldProp?.extra_images ? JSON.parse(oldProp.extra_images) : []; } catch (_) {}
  if (!Array.isArray(extras)) extras = [];
  if (oldPath && !extras.includes(oldPath)) extras.push(oldPath);
  const extraJson = extras.length ? JSON.stringify(extras) : null;
  try {
    db.prepare(
      'UPDATE props SET image_url = ?, local_path = ?, extra_images = ?, updated_at = ? WHERE id = ?'
    ).run(persistedImageUrl, localPath, extraJson, now, propId);
  } catch (e) {
    if ((e.message || '').includes('extra_images')) {
      db.prepare('UPDATE props SET image_url = ?, local_path = ?, updated_at = ? WHERE id = ?').run(persistedImageUrl, localPath, now, propId);
    } else {
      throw e;
    }
  }

  taskService.updateTaskResult(db, taskId, {
    image_generation_id: imageGenId,
    image_url: persistedImageUrl,
    local_path: localPath,
    provider_url: providerUrl,
    localize_status: localizeStatus,
    prop_id: propId,
  });
  if (shouldLocalize && imageGenId) {
    mediaLocalizationService.enqueueImageLocalization(db, log, imageGenId, result.image_url, {
      storageCategory: 'props',
    });
  }
  log.info('Prop image generation completed', { prop_id: propId, image_generation_id: imageGenId, image_url: persistedImageUrl, local_path: localPath });
}

function generatePropImage(db, log, propId, opts) {
  const prop = propService.getById(db, propId);
  if (!prop) throw new Error('道具不存在');
  if (!prop.prompt || !String(prop.prompt).trim()) {
    throw new Error('道具没有图片提示词');
  }

  const task = taskService.createTask(
    db,
    log,
    'prop_image_generation',
    String(propId),
    opts?.user_id
  );
  setImmediate(() => {
    processPropImageGeneration(db, log, task.id, propId, opts || {}).catch((err) => {
      log.error('processPropImageGeneration fatal', { error: err.message, task_id: task.id });
    });
  });
  return task.id;
}

module.exports = {
  generatePropImage,
  processPropImageGeneration,
};

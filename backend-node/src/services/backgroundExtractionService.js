// 与 Go ImageGenerationService.ExtractBackgroundsForEpisode + processBackgroundExtraction 对齐
const taskService = require('./taskService');
const aiClient = require('./aiClient');
const promptTemplates = require('./promptTemplateService');
const sceneService = require('./sceneService');
const { safeParseAIJSON, extractFirstArray } = require('../utils/safeJson');

function hasChinese(text) {
  return /[\u4e00-\u9fff]/.test(text || '');
}

async function translatePromptToChinese(db, log, model, prompt, dramaId, taskId) {
  const userPrompt = promptTemplates.resolvePromptContent(db, 'scene.prompt.translate_zh.user', {
    dramaId,
    taskId,
    variables: { source_prompt: prompt },
  });
  const text = await aiClient.generateText(db, log, 'text', userPrompt, '', {
    scene_key: 'scene_extraction',
    model: model || undefined,
    temperature: 0.2,
    max_tokens: 400,
  });
  return (text || '').toString().trim();
}

async function extractBackgroundsFromScript(db, cfg, log, scriptContent, dramaId, model, style, taskId) {
  if (!scriptContent || !scriptContent.trim()) return [];
  const promptContext = { cfg, dramaId, taskId };
  const systemPrompt = promptTemplates.resolvePromptContent(db, 'scene.extraction.system', promptContext);
  const prompt = promptTemplates.resolvePromptContent(db, 'scene.extraction.user', {
    ...promptContext,
    variables: { script_content: scriptContent },
  });
  const text = await aiClient.generateText(db, log, 'text', prompt, systemPrompt, { scene_key: 'scene_extraction', model: model || undefined, temperature: 0.7 });
  let list = [];
  try {
    const parsed = safeParseAIJSON(text, log);
    list = extractFirstArray(parsed) || [];
  } catch (_) {
    list = [];
  }
  return list.map((b) => ({
    location: b.location || '',
    time: b.time || '',
    prompt: b.prompt || '',
    atmosphere: b.atmosphere,
  }));
}

async function processBackgroundExtraction(db, cfg, log, taskID, episodeId, model, style) {
  taskService.updateTaskStatus(db, taskID, 'processing', 0, '正在提取场景信息...');
  const episode = db.prepare('SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧集信息不存在');
    return;
  }
  const scriptContent = episode.script_content;
  if (!scriptContent || !String(scriptContent).trim()) {
    taskService.updateTaskStatus(db, taskID, 'failed', 0, '剧本内容为空');
    return;
  }

  // 合并风格：显式 style 参数优先（一般为前端传来的英文 prompt）；否则用剧集 metadata 中的完整提示词
  let effectiveCfg = cfg;
  try {
    const dramaRow = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    const paramStyle = (style && String(style).trim()) || '';
    let next = { ...cfg, style: { ...(cfg?.style || {}) } };
    if (dramaRow?.metadata) {
      const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
      if (meta?.aspect_ratio) next.style.default_image_ratio = meta.aspect_ratio;
    }
    if (paramStyle) {
      next.style = {
        ...next.style,
        default_style_zh: paramStyle,
        default_style_en: paramStyle,
        default_style: paramStyle,
      };
      effectiveCfg = next;
    } else {
      effectiveCfg = mergeCfgStyleWithDrama(next, dramaRow);
    }
    style = paramStyle || effectiveCfg?.style?.default_style_en || effectiveCfg?.style?.default_style || style;
  } catch (_) {}

  let backgroundsInfo;
  try {
    backgroundsInfo = await extractBackgroundsFromScript(
      db,
      effectiveCfg,
      log,
      String(scriptContent),
      episode.drama_id,
      model,
      style,  // 作为 prompt 追加（extractBackgroundsFromScript 内部会用到）
      taskID
    );
  } catch (err) {
    log.error('Background extraction AI failed', { error: err.message, task_id: taskID });
    taskService.updateTaskStatus(db, taskID, 'failed', 0, 'AI提取场景失败: ' + err.message);
    return;
  }
  const translated = await Promise.all(
    (backgroundsInfo || []).map(async (bg) => {
      const original = (bg.prompt || '').toString().trim();
      if (!original || hasChinese(original)) return bg;
      try {
        const translatedPrompt = await translatePromptToChinese(
          db,
          log,
          model,
          original,
          episode.drama_id,
          taskID
        );
        if (!translatedPrompt) return bg;
        return { ...bg, prompt: translatedPrompt };
      } catch (err) {
        log.warn('Background prompt translate failed', { error: err.message, task_id: taskID });
        return bg;
      }
    })
  );
  backgroundsInfo = translated;
  sceneService.deleteScenesByEpisodeId(db, log, episodeId);
  const scenes = [];
  for (const bg of backgroundsInfo) {
    const scene = sceneService.createSceneForEpisode(db, log, episode.drama_id, episodeId, {
      location: bg.location,
      time: bg.time,
      prompt: bg.prompt,
    });
    if (scene) {
      scenes.push(scene);
      // polished_prompt 是完整四视图图片提示词，提取后始终为空，需要异步预生成
      if (effectiveCfg) {
        const capturedStyle = style;
        setImmediate(() => {
          sceneService.generateScenePromptOnly(db, log, effectiveCfg, scene.id, undefined, capturedStyle).catch((err) => {
            log.warn('[提取场景] 预生成polished_prompt失败', { scene_id: scene.id, error: err.message });
          });
        });
      }
    }
  }
  taskService.updateTaskResult(db, taskID, {
    scenes,
    count: scenes.length,
    episode_id: episodeId,
    drama_id: episode.drama_id,
  });
  log.info('Background extraction completed', { task_id: taskID, episode_id: episodeId, count: scenes.length });
}

function extractBackgroundsForEpisode(db, cfg, log, episodeId, model, style) {
  const episode = db.prepare('SELECT id, drama_id, script_content FROM episodes WHERE id = ? AND deleted_at IS NULL').get(Number(episodeId));
  if (!episode) throw new Error('episode not found');
  if (!episode.script_content || !String(episode.script_content).trim()) {
    throw new Error('episode has no script content');
  }
  // 读取项目的 aspect_ratio，覆盖全局 cfg 中的 default_image_ratio，使 promptI18n 生成正确比例的提示词
  let runCfg = cfg;
  if (episode.drama_id) {
    try {
      const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(episode.drama_id);
      if (dramaRow && dramaRow.metadata) {
        const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
        if (meta && meta.aspect_ratio) {
          runCfg = { ...cfg, style: { ...(cfg?.style || {}), default_image_ratio: meta.aspect_ratio } };
        }
      }
    } catch (_) {}
  }
  const existing = db.prepare(
    `SELECT id FROM async_tasks
     WHERE resource_id = ? AND type = 'background_extraction'
       AND status IN ('pending', 'processing') AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`
  ).get(String(episodeId));
  if (existing) {
    log.info('Background extraction already running', { task_id: existing.id, episode_id: episodeId });
    return existing.id;
  }

  const task = taskService.createTask(db, log, 'background_extraction', String(episodeId));
  setImmediate(() => {
    processBackgroundExtraction(db, runCfg, log, task.id, episodeId, model, style).catch((err) => {
      log.error('processBackgroundExtraction fatal', { error: err.message, task_id: task.id });
      taskService.updateTaskError(db, task.id, err.message || '场景提取失败');
    });
  });
  return task.id;
}

module.exports = {
  extractBackgroundsForEpisode,
};

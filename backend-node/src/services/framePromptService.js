// 与 Go application/services/frame_prompt_service.go 对齐：生成首帧/关键帧/尾帧/分镜板/动作序列提示词
const loadConfig = require('../config').loadConfig;
const promptTemplates = require('./promptTemplateService');
const aiClient = require('./aiClient');
const taskService = require('./taskService');
const { safeParseAIJSON } = require('../utils/safeJson');
const storyboardService = require('./storyboardService');
const angleService = require('./angleService');
const {
  parseNamesFromAnchorLines,
  sanitizeFramePrompt,
} = require('../utils/framePromptSanitize');

/**
 * 将分镜角度值扩展为带透视含义的完整描述，注入图像提示词上下文
 * 优先使用结构化三元组（angle_h/angle_v/angle_s），降级到旧文本解析
 */
function expandAngleDescription(angle, isEn, angleH, angleV, angleS) {
  if (angleH && angleV && angleS) {
    return isEn
      ? angleService.toPromptFragment(angleH, angleV, angleS)
      : `相机角度：${angleService.toChineseLabel(angleH, angleV, angleS)}`;
  }
  if (angle) {
    if (isEn) return angleService.fromLegacyText(angle, '');
    const { h, v, s } = angleService.parseFromLegacyText(angle, '');
    return `相机角度：${angleService.toChineseLabel(h, v, s)}`;
  }
  return null;
}

const FRAME_TYPES = ['first', 'key', 'last', 'panel', 'action'];

function loadStoryboard(db, storyboardId) {
  const row = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(Number(storyboardId));
  return row
    ? {
        id: row.id,
        description: row.description,
        location: row.location,
        time: row.time,
        dialogue: row.dialogue,
        narration: row.narration,
        action: row.action,
        atmosphere: row.atmosphere,
        result: row.result,
        scene_id: row.scene_id,
        shot_type: row.shot_type,
        angle: row.angle,
        angle_h: row.angle_h,
        angle_v: row.angle_v,
        angle_s: row.angle_s,
        movement: row.movement,
        lighting_style: row.lighting_style,
        depth_of_field: row.depth_of_field,
        layout_description: row.layout_description || null,   // 画面布局与人物站位合同（首尾帧强制一致核心）
      }
    : null;
}

/**
 * 将 identity_anchors JSON 转换为适合注入分镜提示词的结构化描述
 * 优先使用结构化锚点，无锚点时 fallback 到 appearance 文本
 */
function cleanAppearanceForIdentity(appText) {
  if (!appText) return '';
  let t = String(appText).trim();
  // 去除服装/衣着/配饰等可变描述（中英文常见表述）—— 保留固定身份特征（脸型、发型、肤质、眼神、气质等）
  const clothingPatterns = [
    /身穿[^，。；\n]*/g,
    /穿着[^，。；\n]*/g,
    /衣着[^，。；\n]*/g,
    /手持[^，。；\n]*/g,
    /戴着[^，。；\n]*/g,
    /围[^，。；\n]*巾/g,
    /服装[^，。；\n]*/g,
    /服饰[^，。；\n]*/g,
    /着装[^，。；\n]*/g,
    / dressed in [^，。；\n]*/gi,
    / wearing [^，。；\n]*/gi,
    / holding [^，。；\n]*/gi,
    /着[^，。；\n]*鞋/g,
  ];
  clothingPatterns.forEach((re) => {
    t = t.replace(re, '');
  });
  // 清理多余标点和空格，保留核心描述
  t = t.replace(/[，、；]\s*[，、；]+/g, '，').replace(/^[，、；\s]+|[，、；\s]+$/g, '').replace(/\s+/g, ' ').trim();
  return t;
}

function buildCharacterAnchorText(db, storyboardId, name, anchors, appearance) {
  if (anchors && typeof anchors === 'object' && Object.keys(anchors).length > 0) {
    let colors = '';
    if (anchors.color_anchors && typeof anchors.color_anchors === 'object') {
      colors = Object.entries(anchors.color_anchors)
        .filter(([, v]) => v && v !== 'unspecified')
        .map(([k, v]) => `${k}=${v}`)
        .join(', ');
    }
    return promptTemplates.resolvePromptContent(db, 'frame.character_anchor.structured', {
      storyboardId,
      variables: {
        character_name: name,
        face_shape: anchors.face_shape !== 'unspecified' ? anchors.face_shape || '' : '',
        facial_features: anchors.facial_features !== 'unspecified' ? anchors.facial_features || '' : '',
        hair_style: anchors.hair_style !== 'unspecified' ? anchors.hair_style || '' : '',
        skin_texture: anchors.skin_texture !== 'unspecified' ? anchors.skin_texture || '' : '',
        color_anchors: colors,
        unique_marks: anchors.unique_marks !== 'none' && anchors.unique_marks !== 'unspecified'
          ? anchors.unique_marks || ''
          : '',
      },
    });
  }
  // fallback: 清洗 appearance，只保留固定身份特征，彻底剔除服装/配饰等可变描述
  const cleaned = cleanAppearanceForIdentity(appearance);
  if (cleaned) {
    return promptTemplates.resolvePromptContent(db, 'frame.character_anchor.fallback', {
      storyboardId,
      variables: { character_name: name, appearance: cleaned },
    });
  }
  return name;
}

function loadStoryboardCharacterNames(db, storyboardId) {
  const sid = Number(storyboardId);
  let ids = [];
  let usedExplicitCharactersColumn = false;

  // 以 storyboards.characters（前端勾选）为权威；仅未配置时才回退 storyboard_characters
  try {
    const sbRow = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sid);
    if (sbRow?.characters != null && String(sbRow.characters).trim() !== '') {
      const parsed = JSON.parse(sbRow.characters);
      if (Array.isArray(parsed)) {
        usedExplicitCharactersColumn = true;
        for (const item of parsed) {
          if (typeof item === 'object' && item != null && item.id != null) {
            ids.push(Number(item.id));
          } else if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item))) {
            ids.push(Number(item));
          }
        }
      }
    }
  } catch (_) {}

  if (!usedExplicitCharactersColumn) {
    const links = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(sid);
    if (links.length) {
      ids = links.map((r) => r.character_id);
    }
  }

  if (!ids.length) {
    if (usedExplicitCharactersColumn) return [];
    // 最后兜底：尝试按名称模糊匹配（某些老数据可能只存了名字）
    try {
      const sbRow = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sid);
      if (sbRow?.characters) {
        const raw = String(sbRow.characters);
        // 尝试提取可能的名字（简单处理）
        const nameMatches = raw.match(/[\u4e00-\u9fa5]{2,4}/g) || [];
        if (nameMatches.length) {
          const namePlaceholders = nameMatches.map(() => '?').join(',');
          const nameRows = db.prepare(
            `SELECT id, name, appearance, identity_anchors FROM characters 
             WHERE name IN (${namePlaceholders}) AND deleted_at IS NULL 
             AND drama_id = (SELECT drama_id FROM episodes WHERE id = (SELECT episode_id FROM storyboards WHERE id = ?))`
          ).all(...nameMatches, sid);
          if (nameRows.length) {
            return nameRows.map((r) => {
              let anchors = null;
              if (r.identity_anchors) { try { anchors = JSON.parse(r.identity_anchors); } catch (_) {} }
              return buildCharacterAnchorText(db, sid, r.name, anchors, r.appearance);
            });
          }
        }
      }
    } catch (_) {}
    return [];
  }

  const placeholders = ids.map(() => '?').join(',');

  let rows = db.prepare(
    `SELECT id, name, appearance, identity_anchors FROM characters WHERE id IN (${placeholders}) AND deleted_at IS NULL`
  ).all(...ids);

  if (!rows || rows.length === 0) {
    rows = db.prepare(
      `SELECT id, name, appearance, identity_anchors FROM character_libraries WHERE id IN (${placeholders}) AND deleted_at IS NULL`
    ).all(...ids);
  }

  return rows.map((r) => {
    let anchors = null;
    if (r.identity_anchors) {
      try { anchors = JSON.parse(r.identity_anchors); } catch (_) {}
    }
    return buildCharacterAnchorText(db, sid, r.name, anchors, r.appearance);
  });
}

/** 本剧全部角色名（用于从帧提示词中剔除未勾选出场的人物） */
function loadDramaCharacterNamesForStoryboard(db, storyboardId) {
  try {
    const rows = db.prepare(
      `SELECT name FROM characters
       WHERE drama_id = (
         SELECT e.drama_id FROM episodes e
         INNER JOIN storyboards s ON s.episode_id = e.id
         WHERE s.id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL
       ) AND deleted_at IS NULL`
    ).all(Number(storyboardId));
    return rows.map((r) => String(r.name || '').trim()).filter(Boolean);
  } catch (_) {
    return [];
  }
}

function loadScene(db, sceneId) {
  if (sceneId == null) return null;
  const row = db.prepare('SELECT id, location, time FROM scenes WHERE id = ? AND deleted_at IS NULL').get(Number(sceneId));
  return row ? { id: row.id, location: row.location, time: row.time } : null;
}

function buildDatabaseStoryboardContext(db, cfg, sb, scene, characterNames, taskId) {
  const promptContext = { cfg, storyboardId: sb?.id, taskId };
  const style = cfg?.style?.default_style_zh || cfg?.style?.default_style || cfg?.style?.default_style_en || '';
  const styleContract = String(style || '').trim()
    ? promptTemplates.resolvePromptContent(db, 'frame.context.style', {
        ...promptContext,
        variables: { style_prompt: String(style).trim() },
      })
    : '';
  const spatialContract = sb.layout_description && String(sb.layout_description).trim()
    ? promptTemplates.resolvePromptContent(db, 'frame.context.spatial_contract', {
        ...promptContext,
        variables: { layout_description: String(sb.layout_description).trim() },
      })
    : '';
  const allowedCharNames = parseNamesFromAnchorLines(characterNames);
  const rosterContract = allowedCharNames.length
    ? promptTemplates.resolvePromptContent(db, 'frame.context.character_roster', {
        ...promptContext,
        variables: { allowed_characters: allowedCharNames.join('、') },
      })
    : '';
  const anchorContract = characterNames.length
    ? promptTemplates.resolvePromptContent(db, 'frame.context.character_anchors', {
        ...promptContext,
        variables: { character_anchors: characterNames.join('\n') },
      })
    : '';
  const angle = sb.angle_h && sb.angle_v && sb.angle_s
    ? `${sb.angle_s}/${sb.angle_v}/${sb.angle_h}`
    : (sb.angle || '');
  return promptTemplates.resolvePromptContent(db, 'frame.context.compose', {
    ...promptContext,
    variables: {
      spatial_contract: spatialContract,
      style_contract: styleContract,
      character_roster_contract: rosterContract,
      character_anchor_contract: anchorContract,
      shot_description: sb.description || '',
      scene_location: scene?.location || sb.location || '',
      scene_time: scene?.time || sb.time || '',
      action: sb.action || '',
      result: sb.result || '',
      dialogue: sb.dialogue || '',
      atmosphere: sb.atmosphere || '',
      shot_type: sb.shot_type || '',
      angle,
      movement: sb.movement || '',
    },
  });
}

function buildDatabaseFallbackPrompt(db, cfg, scene, frameKind, storyboardId, taskId) {
  const style = cfg?.style?.default_style_zh || cfg?.style?.default_style || cfg?.style?.default_style_en || '';
  return promptTemplates.resolvePromptContent(db, `frame.${frameKind}.fallback`, {
    cfg,
    storyboardId,
    taskId,
    variables: {
      scene_context: scene ? [scene.location, scene.time].filter(Boolean).join('，') : '',
      style_prompt: String(style || '').trim(),
    },
  });
}

function parseFramePromptJSON(log, aiResponse) {
  try {
    const data = safeParseAIJSON(aiResponse, {}, log);
    if (data && typeof data.prompt === 'string') {
      return { prompt: data.prompt, description: data.description || '' };
    }
  } catch (e) {
    log.warn('Frame prompt JSON parse failed', { error: e.message, response_head: (aiResponse || '').slice(0, 200) });
  }
  return null;
}

function saveFramePrompt(db, log, storyboardId, frameType, prompt, description, layout) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM frame_prompts WHERE storyboard_id = ? AND frame_type = ?').run(Number(storyboardId), frameType);
  db.prepare(
    `INSERT INTO frame_prompts (storyboard_id, frame_type, prompt, description, layout, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(Number(storyboardId), frameType, prompt, description ?? null, layout ?? null, now, now);
  log.info('Frame prompt saved', { storyboard_id: storyboardId, frame_type: frameType });
}

async function generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, frameKind, sanitizeOpts = {}) {
  const context = buildDatabaseStoryboardContext(
    db,
    cfg,
    sb,
    scene,
    characterNames,
    sanitizeOpts.taskId
  );
  const allowedCharNames = parseNamesFromAnchorLines(characterNames);
  const allDramaNames = sanitizeOpts.allDramaNames || allowedCharNames;
  const promptKind = frameKind === 'first' ? 'first' : frameKind === 'key' ? 'key' : 'last';
  const promptContext = {
    cfg,
    storyboardId: sb?.id,
    taskId: sanitizeOpts.taskId,
  };
  let systemPrompt = promptTemplates.resolvePromptContent(db, `frame.${promptKind}.system`, promptContext);
  if (promptKind === 'first' || promptKind === 'last') {
    const scaleContract = promptTemplates.resolvePromptContent(
      db,
      `frame.${promptKind}.realistic_scale_contract`,
      promptContext
    );
    if (!systemPrompt.includes(scaleContract)) {
      systemPrompt = `${systemPrompt}\n\n${scaleContract}`;
    }
  }
  const userTemplate = promptTemplates.resolvePromptContent(db, 'frame.input.user', {
    ...promptContext,
    variables: { frame_context: context },
  });
  const userPrompt = userTemplate;

  // ── 调试日志：打印完整提示词，方便确认角度/视角是否正确注入 ──
  log.info('[帧提示词] ===== generateSingleFrame DEBUG =====', {
    frame_kind: frameKind,
    storyboard_id: sb?.id,
    angle: sb?.angle,
    shot_type: sb?.shot_type,
    movement: sb?.movement,
  });
  log.info('[帧提示词] CONTEXT (角色/场景/角度上下文):\n' + context);
  log.info('[帧提示词] SYSTEM PROMPT:\n' + systemPrompt);
  log.info('[帧提示词] USER PROMPT:\n' + userPrompt);
  log.info('[帧提示词] ==========================================');

  let aiResponse;
  try {
    aiResponse = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
      scene_key: 'frame_prompt',
      model: model || undefined,
      max_tokens: 2400,
    });
  } catch (err) {
    log.warn('Frame prompt AI failed, using fallback', { error: err.message });
    const prompt = buildDatabaseFallbackPrompt(
      db,
      cfg,
      scene,
      frameKind,
      sb?.id,
      sanitizeOpts.taskId
    );
    const desc =
      frameKind === 'first'
        ? '镜头开始的静态画面，展示初始状态'
        : frameKind === 'key'
          ? '动作高潮瞬间，展示关键动作'
          : '镜头结束画面，展示最终状态和结果';
    return { prompt, description: desc };
  }
  log.info('[帧提示词] AI RAW RESPONSE:\n' + (aiResponse || '(empty)'));
  const parsed = parseFramePromptJSON(log, aiResponse);
  if (parsed) {
    const cleanedPrompt = sanitizeFramePrompt(parsed.prompt, allowedCharNames, allDramaNames, {
      log,
      source: 'frame_prompt_generation',
      storyboard_id: sb?.id,
      frame_kind: frameKind,
    });
    log.info('[帧提示词] PARSED RESULT prompt:\n' + cleanedPrompt);
    return { ...parsed, prompt: cleanedPrompt };
  }
  const fallback = buildDatabaseFallbackPrompt(
    db,
    cfg,
    scene,
    frameKind,
    sb?.id,
    sanitizeOpts.taskId
  );
  log.warn('[帧提示词] JSON 解析失败，使用 FALLBACK prompt:\n' + fallback);
  return {
    prompt: fallback,
    description: frameKind === 'last' ? '镜头结束画面，展示最终状态和结果' : frameKind === 'key' ? '动作高潮瞬间，展示关键动作' : '镜头开始的静态画面，展示初始状态',
  };
}

async function processFramePromptGeneration(db, log, taskId, storyboardId, frameType, panelCount, model) {
  let cfg = loadConfig();
  taskService.updateTaskStatus(db, taskId, 'processing', 0, '正在生成帧提示词...');

  const sb = loadStoryboard(db, storyboardId);
  if (!sb) {
    taskService.updateTaskError(db, taskId, '分镜信息不存在');
    log.error('Frame prompt: storyboard not found', { storyboard_id: storyboardId });
    return;
  }

  // 通过 storyboard → episode → drama 链路读取项目 style 和 aspect_ratio
  try {
    const epRow = db.prepare(
      'SELECT drama_id FROM episodes WHERE id = (SELECT episode_id FROM storyboards WHERE id = ? AND deleted_at IS NULL) AND deleted_at IS NULL'
    ).get(Number(storyboardId));
    if (epRow && epRow.drama_id) {
      const dramaRow = db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(epRow.drama_id);
      if (dramaRow) {
        const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
        let next = { ...cfg, style: { ...(cfg?.style || {}) } };
        if (dramaRow.metadata) {
          const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
          if (meta && meta.aspect_ratio) {
            next.style.default_image_ratio = meta.aspect_ratio;
            next.style.default_video_ratio = meta.aspect_ratio;
          }
        }
        cfg = mergeCfgStyleWithDrama(next, dramaRow);
      }
    }
  } catch (_) {}

  const scene = loadScene(db, sb.scene_id);
  const characterNames = loadStoryboardCharacterNames(db, storyboardId);
  const allDramaNames = loadDramaCharacterNamesForStoryboard(db, storyboardId);
  const sanitizeOpts = { allDramaNames, taskId };

  // 强调试日志：确认角色视觉锚点是否成功加载（用于排查“黑发扎马尾”等脑补问题）
  log.info('[帧提示词] 角色视觉锚点加载结果', {
    storyboard_id: storyboardId,
    character_count: characterNames.length,
    characters_preview: characterNames.length ? characterNames.map(c => c.substring(0, 120) + (c.length > 120 ? '...' : '')).join(' | ') : '(无关联角色或加载失败)'
  });

  const storyboardIdStr = String(storyboardId);
  let combinedPrompt = '';
  let description = '';
  let layout = '';

  try {
    if (frameType === 'first' || frameType === 'key' || frameType === 'last') {
      const frameKind = frameType;
      const single = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, frameKind, sanitizeOpts);
      saveFramePrompt(db, log, storyboardId, frameType, single.prompt, single.description, '');
      combinedPrompt = single.prompt;
      description = single.description;
    } else if (frameType === 'panel') {
      const count = panelCount || 3;
      layout = `horizontal_${count}`;
      const prompts = [];
      if (count === 3) {
        const first = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts);
        const key = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
        const last = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts);
        prompts.push(first.prompt, key.prompt, last.prompt);
        description = '分镜板组合提示词';
      } else if (count === 4) {
        const first = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts);
        const key1 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
        const key2 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
        const last = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts);
        prompts.push(first.prompt, key1.prompt, key2.prompt, last.prompt);
        description = '分镜板组合提示词';
      } else {
        prompts.push((await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts)).prompt);
        for (let i = 0; i < count - 2; i++) {
          prompts.push((await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts)).prompt);
        }
        prompts.push((await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts)).prompt);
        description = '分镜板组合提示词';
      }
      combinedPrompt = prompts.join('\n---\n');
      saveFramePrompt(db, log, storyboardId, frameType, combinedPrompt, description, layout);
    } else if (frameType === 'action') {
      layout = 'horizontal_5';
      const first = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'first', sanitizeOpts);
      const key1 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
      const key2 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
      const key3 = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'key', sanitizeOpts);
      const last = await generateSingleFrame(db, log, cfg, sb, scene, characterNames, model, 'last', sanitizeOpts);
      combinedPrompt = [first.prompt, key1.prompt, key2.prompt, key3.prompt, last.prompt].join('\n---\n');
      description = '动作序列组合提示词';
      saveFramePrompt(db, log, storyboardId, frameType, combinedPrompt, description, layout);
    } else {
      taskService.updateTaskError(db, taskId, '不支持的帧类型');
      log.error('Frame prompt: unsupported frame_type', { frame_type: frameType });
      return;
    }

    taskService.updateTaskResult(db, taskId, {
      storyboard_id: storyboardIdStr,
      frame_type: frameType,
      response: { frame_type: frameType, single_frame: combinedPrompt ? { prompt: combinedPrompt, description } : undefined, layout: layout || undefined },
    });
    log.info('Frame prompt generation completed', { task_id: taskId, storyboard_id: storyboardId, frame_type: frameType });
  } catch (err) {
    log.error('Frame prompt generation error', { task_id: taskId, error: err.message });
    taskService.updateTaskError(db, taskId, err.message || '生成失败');
  }
}

function generateFramePrompt(db, log, storyboardId, frameType, panelCount, model) {
  const sid = Number(storyboardId);
  const sb = db.prepare('SELECT id FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sid);
  if (!sb) {
    throw new Error('分镜不存在');
  }
  const validTypes = FRAME_TYPES.includes(frameType);
  if (!validTypes) {
    throw new Error('不支持的 frame_type，可选: first, key, last, panel, action');
  }
  const task = taskService.createTask(db, log, 'frame_prompt_generation', String(storyboardId));
  setImmediate(() => {
    processFramePromptGeneration(db, log, task.id, storyboardId, frameType, panelCount || 0, model);
  });
  log.info('Frame prompt task created', { task_id: task.id, storyboard_id: storyboardId, frame_type: frameType });
  return task.id;
}

module.exports = {
  generateFramePrompt,
  saveFramePrompt,
  loadStoryboard,
  loadStoryboardCharacterNames,
  loadDramaCharacterNamesForStoryboard,
  loadScene,
  buildCharacterAnchorText,
  getFramePrompts: (db, storyboardId) => storyboardService.getFramePrompts(db, storyboardId),
  generateSingleFrameExported: generateSingleFrame,
  expandAngleDescription,
  regenerateLayoutDescription,
};

/**
 * 一键重新生成/优化单个分镜的 layout_description（空间布局合同）
 * 自动参考上下分镜，保证前后连贯性
 * @returns {string} 新的 layout_description 文本
 */
async function regenerateLayoutDescription(db, log, storyboardId) {
  const sid = Number(storyboardId);
  const sb = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sid);
  if (!sb) throw new Error('分镜不存在');

  // 取前后分镜（用于连贯性）
  let prevSb = null, nextSb = null;
  if (sb.episode_id != null && sb.storyboard_number != null) {
    prevSb = db.prepare(`
      SELECT storyboard_number, action, result, layout_description
      FROM storyboards
      WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
      ORDER BY storyboard_number DESC LIMIT 1
    `).get(sb.episode_id, sb.storyboard_number);

    nextSb = db.prepare(`
      SELECT storyboard_number, action, result, layout_description
      FROM storyboards
      WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
      ORDER BY storyboard_number ASC LIMIT 1
    `).get(sb.episode_id, sb.storyboard_number);
  }

  // 角色信息（用于站位描述）
  const characterNames = loadStoryboardCharacterNames(db, sid);

  const cfg = require('../config').loadConfig();
  const systemPrompt = promptTemplates.resolvePromptContent(db, 'storyboard.layout.regenerate.system', {
    cfg,
    storyboardId: sid,
  });
  const effectiveUserPrompt = promptTemplates.resolvePromptContent(db, 'storyboard.layout.regenerate.user', {
    storyboardId: sid,
    cfg,
    variables: {
      storyboard_number: sb.storyboard_number || sid,
      action: sb.action || '',
      result: sb.result || '',
      dialogue: sb.dialogue || '',
      shot_type: sb.shot_type || '',
      characters: characterNames.join('；'),
      previous_layout: prevSb
        ? `#${prevSb.storyboard_number}: ${prevSb.layout_description || '(none)'}`
        : '(first shot)',
      next_layout: nextSb
        ? `#${nextSb.storyboard_number}: ${nextSb.layout_description || '(none)'}`
        : '(last shot)',
    },
  });

  log.info('[布局重生成] 开始', { storyboard_id: sid, has_prev: !!prevSb, has_next: !!nextSb });

  const raw = await aiClient.generateText(db, log, 'text', effectiveUserPrompt, systemPrompt, {
    scene_key: 'layout_regenerate',
    max_tokens: 300,
    temperature: 0.35,
  });

  let newLayout = (raw || '').trim()
    .replace(/^```[a-z]*\s*/i, '')
    .replace(/\s*```$/, '')
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .trim();

  // 极简清洗：去掉明显的前缀
  newLayout = newLayout.replace(/^(布局描述|layout_description|空间布局|画面布局)[:：]\s*/i, '').trim();

  if (!newLayout || newLayout.length < 8) {
    throw new Error('AI 返回的布局描述过短或无效');
  }

  // 写回数据库
  const now = new Date().toISOString();
  db.prepare('UPDATE storyboards SET layout_description = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL')
    .run(newLayout, now, sid);

  log.info('[布局重生成] 完成', { storyboard_id: sid, new_layout_preview: newLayout.slice(0, 80) });

  return newLayout;
}

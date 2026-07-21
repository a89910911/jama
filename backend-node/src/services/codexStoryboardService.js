const { safeParseAIJSON } = require('../utils/safeJson');
const promptTemplates = require('./promptTemplateService');
const episodeStoryboardService = require('./episodeStoryboardService');

const STORYBOARD_ITEM_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'shot_number',
    'segment_index',
    'segment_title',
    'title',
    'location',
    'time',
    'scene_id',
    'shot_type',
    'angle',
    'movement',
    'lighting_style',
    'depth_of_field',
    'action',
    'dialogue',
    'narration',
    'result',
    'atmosphere',
    'emotion',
    'emotion_intensity',
    'duration',
    'bgm_prompt',
    'sound_effect',
    'characters',
    'props',
    'layout_description',
  ],
  properties: {
    shot_number: { type: 'integer', minimum: 1 },
    segment_index: { type: 'integer', minimum: 0 },
    segment_title: { type: 'string' },
    title: { type: 'string' },
    location: { type: 'string' },
    time: { type: 'string' },
    scene_id: { type: 'integer', minimum: 0 },
    shot_type: { type: 'string' },
    angle: { type: 'string' },
    movement: { type: 'string' },
    lighting_style: { type: 'string' },
    depth_of_field: { type: 'string' },
    action: { type: 'string' },
    dialogue: { type: 'string' },
    narration: { type: 'string' },
    result: { type: 'string' },
    atmosphere: { type: 'string' },
    emotion: { type: 'string' },
    emotion_intensity: { type: 'integer', minimum: -1, maximum: 3 },
    duration: { type: 'number', minimum: 1, maximum: 120 },
    bgm_prompt: { type: 'string' },
    sound_effect: { type: 'string' },
    characters: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
    },
    props: {
      type: 'array',
      items: { type: 'integer', minimum: 1 },
    },
    layout_description: { type: 'string' },
  },
};

function createStoryboardOutputSchema(expectedCount) {
  const count = Math.max(1, Math.min(200, Number(expectedCount) || 1));
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assistant_reply', 'storyboards'],
    properties: {
      assistant_reply: { type: 'string' },
      storyboards: {
        type: 'array',
        minItems: count,
        maxItems: count,
        items: STORYBOARD_ITEM_SCHEMA,
      },
    },
  };
}

function clean(value, max = 30_000) {
  return String(value || '').trim().slice(0, max);
}

function parseMetadata(drama) {
  if (!drama?.metadata) return {};
  if (typeof drama.metadata === 'object') return drama.metadata;
  try {
    return JSON.parse(drama.metadata);
  } catch (_) {
    return {};
  }
}

function parseExplicitCount(text) {
  const input = String(text || '');
  const matches = [
    input.match(/(?:生成|制作|创建|拆成|拆分为)\s*(\d{1,3})\s*(?:个|条|幅|镜头)?\s*分镜/i),
    input.match(/分镜(?:数量|数)?\s*[为是:：]?\s*(\d{1,3})/i),
    input.match(/(\d{1,3})\s*(?:个|条)\s*分镜/i),
  ];
  for (const match of matches) {
    const value = Number(match?.[1]);
    if (Number.isInteger(value) && value > 0 && value <= 200) return value;
  }
  return null;
}

function estimateStoryboardPlan(episode, drama, body = {}) {
  const metadata = parseMetadata(drama);
  const scriptLength = clean(episode?.script_content).length;
  const estimatedDuration = Math.min(
    600,
    Math.max(10, Math.round(10 + (scriptLength / 600) * 60))
  );
  const clipDuration = Math.max(
    2,
    Math.min(60, Number(body.video_clip_duration || metadata.video_clip_duration) || 5)
  );
  const requested = Number(body.storyboard_count);
  const explicitCount = Number.isInteger(requested) && requested > 0
    ? Math.min(200, requested)
    : parseExplicitCount(body.content);
  const storyboardCount = explicitCount
    || Math.max(1, Math.min(200, Math.round(estimatedDuration / clipDuration)));
  const requestedDuration = Number(body.video_duration);
  const videoDuration = Number.isFinite(requestedDuration) && requestedDuration > 0
    ? Math.min(600, Math.max(10, Math.round(requestedDuration)))
    : estimatedDuration;
  return {
    storyboardCount,
    videoDuration,
    clipDuration,
    aspectRatio: clean(body.aspect_ratio || metadata.aspect_ratio || '16:9', 20),
  };
}

function serializeRows(rows, mapper) {
  return JSON.stringify((rows || []).map(mapper));
}

function buildStoryboardGenerationPrompt(db, cfg, session, episode, body, taskId) {
  if (!episode) throw new Error('生成分镜必须选择一个剧集');
  const scriptContent = clean(episode.script_content);
  if (!scriptContent) throw new Error('当前剧本为空，请先生成或填写剧本');
  const drama = db.prepare(
    'SELECT id, title, description, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(session.drama_id));
  const plan = estimateStoryboardPlan(episode, drama, body);
  const characters = db.prepare(
    `SELECT id, name FROM characters
      WHERE drama_id = ? AND deleted_at IS NULL ORDER BY name, id`
  ).all(Number(session.drama_id));
  const scenes = db.prepare(
    `SELECT id, location, time FROM scenes
      WHERE drama_id = ? AND deleted_at IS NULL ORDER BY location, time, id`
  ).all(Number(session.drama_id));
  const props = db.prepare(
    `SELECT id, name, type FROM props
      WHERE drama_id = ? AND (episode_id = ? OR episode_id IS NULL)
        AND deleted_at IS NULL ORDER BY id`
  ).all(Number(session.drama_id), Number(episode.id));
  const characterList = serializeRows(characters, (row) => ({
    id: row.id,
    name: row.name,
  }));
  const sceneList = serializeRows(scenes, (row) => ({
    id: row.id,
    location: row.location,
    time: row.time,
  }));
  const propList = serializeRows(props, (row) => ({
    id: row.id,
    name: row.name,
    type: row.type || '',
  }));
  const context = {
    cfg,
    dramaId: session.drama_id,
    episodeId: episode.id,
    taskId,
  };
  const durationConstraint = promptTemplates.resolvePromptContent(
    db,
    'storyboard.generation.duration_constraint',
    {
      ...context,
      variables: { video_duration: plan.videoDuration },
    }
  );
  const clipConstraint = promptTemplates.resolvePromptContent(
    db,
    'storyboard.generation.project_clip_duration_constraint',
    {
      ...context,
      variables: {
        video_clip_duration: plan.clipDuration,
        video_duration: plan.videoDuration,
        storyboard_count: plan.storyboardCount,
        implied_duration: Math.max(1, Math.round(plan.videoDuration / plan.storyboardCount)),
      },
    }
  );
  const userPrompt = promptTemplates.resolvePromptContent(
    db,
    'storyboard.generation.user',
    {
      ...context,
      variables: {
        characters: characterList,
        scenes: sceneList,
        props: propList,
        script_content: scriptContent,
        extra_constraints: `${durationConstraint}\n${clipConstraint}`,
      },
    }
  );
  let systemPrompt = promptTemplates.resolvePromptContent(
    db,
    'storyboard.generation.system',
    {
      ...context,
      variables: { shot_duration: plan.clipDuration },
    }
  );
  systemPrompt += '\n\n' + promptTemplates.resolvePromptContent(
    db,
    'storyboard.generation.count_constraint',
    {
      ...context,
      variables: {
        storyboard_count: plan.storyboardCount,
        min_storyboard_count: plan.storyboardCount,
        max_storyboard_count: plan.storyboardCount,
      },
    }
  );
  const prompt = [
    '请使用当前项目的分镜生成规则，把当前剧本完整拆解为所有分镜。',
    `必须恰好生成 ${plan.storyboardCount} 条分镜，shot_number 必须从 1 连续递增到 ${plan.storyboardCount}。`,
    '必须覆盖剧本从开场到结尾的全部情节，不得只输出建议清单、Markdown 或自然语言说明。',
    '每条分镜的 title、action、result、layout_description 必须具体且非空。',
    'scene_id、characters、props 只能使用项目提供的数字 ID；没有匹配场景时 scene_id 填 0。',
    'layout_description 必须说明主体在画面中的位置、前中后景关系、朝向和关键道具位置，可直接用于首帧构图。',
    '最终只按宿主应用提供的 JSON Schema 输出。',
    `【项目分镜系统提示词】\n${systemPrompt}`,
    `【项目分镜用户提示词】\n${userPrompt}`,
    `【用户本次要求】\n${clean(body.content)}`,
  ].join('\n\n');
  promptTemplates.attachTaskPromptSnapshot(db, taskId, {
    prompt_key: 'codex.storyboard.generation.composed',
    scope: 'effective',
    version: 1,
    content: prompt,
    captured_at: new Date().toISOString(),
  });
  return {
    prompt,
    plan,
    outputSchema: createStoryboardOutputSchema(plan.storyboardCount),
  };
}

function normalizeIds(values) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value > 0)
  ));
}

function parseStoryboardResult(text, expectedCount) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = safeParseAIJSON(text, {}, null);
  }
  const rows = Array.isArray(parsed) ? parsed : parsed?.storyboards;
  if (!Array.isArray(rows) || !rows.length) {
    throw new Error('Codex 未返回有效分镜数据');
  }
  const expected = Math.max(1, Number(expectedCount) || rows.length);
  if (rows.length !== expected) {
    throw new Error(`Codex 返回 ${rows.length} 条分镜，但完整任务要求 ${expected} 条，未写入数据库`);
  }
  const storyboards = rows.map((row, index) => {
    const normalized = {
      shot_number: index + 1,
      segment_index: Math.max(0, Number(row.segment_index) || 0),
      segment_title: clean(row.segment_title, 100),
      title: clean(row.title, 200),
      location: clean(row.location, 200),
      time: clean(row.time, 100),
      scene_id: Number(row.scene_id) > 0 ? Number(row.scene_id) : null,
      shot_type: clean(row.shot_type, 100),
      angle: clean(row.angle || row.camera_angle, 100),
      movement: clean(row.movement || row.camera_movement, 100),
      lighting_style: clean(row.lighting_style, 100),
      depth_of_field: clean(row.depth_of_field, 100),
      action: clean(row.action),
      dialogue: clean(row.dialogue),
      narration: clean(row.narration),
      result: clean(row.result),
      atmosphere: clean(row.atmosphere),
      emotion: clean(row.emotion, 200),
      emotion_intensity: Math.max(-1, Math.min(3, Number(row.emotion_intensity) || 0)),
      duration: Math.max(1, Math.min(120, Number(row.duration) || 5)),
      bgm_prompt: clean(row.bgm_prompt),
      sound_effect: clean(row.sound_effect),
      characters: normalizeIds(row.characters),
      props: normalizeIds(row.props),
      layout_description: clean(row.layout_description),
    };
    if (!normalized.title || !normalized.action || !normalized.result || !normalized.layout_description) {
      throw new Error(`第 ${index + 1} 条分镜缺少标题、动作、结果或画面布局，未写入数据库`);
    }
    return normalized;
  });
  return {
    assistant_reply: clean(parsed?.assistant_reply) || `已生成 ${storyboards.length} 条完整分镜。`,
    storyboards,
  };
}

function sanitizeStoryboardReferences(db, session, episode, storyboards) {
  const characterIds = new Set(db.prepare(
    'SELECT id FROM characters WHERE drama_id = ? AND deleted_at IS NULL'
  ).all(Number(session.drama_id)).map((row) => Number(row.id)));
  const sceneIds = new Set(db.prepare(
    'SELECT id FROM scenes WHERE drama_id = ? AND deleted_at IS NULL'
  ).all(Number(session.drama_id)).map((row) => Number(row.id)));
  const propIds = new Set(db.prepare(
    `SELECT id FROM props
      WHERE drama_id = ? AND (episode_id = ? OR episode_id IS NULL)
        AND deleted_at IS NULL`
  ).all(Number(session.drama_id), Number(episode.id)).map((row) => Number(row.id)));
  return storyboards.map((row) => ({
    ...row,
    scene_id: sceneIds.has(Number(row.scene_id)) ? Number(row.scene_id) : null,
    characters: row.characters.filter((id) => characterIds.has(Number(id))),
    props: row.props.filter((id) => propIds.has(Number(id))),
  }));
}

function persistGeneratedStoryboards(db, cfg, log, session, episode, parsed, plan) {
  const rows = sanitizeStoryboardReferences(
    db,
    session,
    episode,
    parsed.storyboards
  );
  const runCfg = {
    ...cfg,
    style: {
      ...(cfg?.style || {}),
      default_video_ratio: plan.aspectRatio,
      default_image_ratio: plan.aspectRatio,
    },
  };
  const save = db.transaction(() => {
    const saved = episodeStoryboardService.saveStoryboards(
      db,
      log,
      episode.id,
      rows,
      runCfg,
      null,
      null,
      { targetClipDuration: plan.clipDuration }
    );
    const insertCharacterLink = db.prepare(
      `INSERT OR IGNORE INTO storyboard_characters
        (storyboard_id, character_id, created_at)
       VALUES (?, ?, ?)`
    );
    const now = new Date().toISOString();
    for (const storyboard of saved) {
      db.prepare('DELETE FROM storyboard_characters WHERE storyboard_id = ?')
        .run(storyboard.id);
      for (const characterId of normalizeIds(storyboard.characters)) {
        insertCharacterLink.run(storyboard.id, characterId, now);
      }
    }
    db.prepare(
      `UPDATE scenes
          SET storyboard_count = (
            SELECT COUNT(*) FROM storyboards s
             WHERE s.scene_id = scenes.id AND s.deleted_at IS NULL
          ),
              updated_at = ?
        WHERE drama_id = ? AND deleted_at IS NULL`
    ).run(now, Number(session.drama_id));
    return saved;
  });
  return save();
}

function isStoryboardImageRequest(text) {
  const input = String(text || '');
  return /分镜/i.test(input)
    && /(图|图片|首帧|image)/i.test(input)
    && /(生成|制作|创建|画|补齐|配图|出图|重做|重新)/i.test(input);
}

function isStoryboardGenerationRequest(text) {
  const input = String(text || '');
  if (isStoryboardImageRequest(input)) return false;
  return /分镜/i.test(input)
    && /(生成|制作|创建|拆解|拆分|提取|补齐|重做|重新)/i.test(input);
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function listStoryboardImageTargets(db, session, options = {}) {
  const episodeId = Number(session.episode_id);
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new Error('生成分镜图片必须选择一个剧集');
  }
  const rows = db.prepare(
    `SELECT s.*, e.episode_number, e.title AS episode_title
       FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
      WHERE s.episode_id = ? AND e.drama_id = ?
        AND s.deleted_at IS NULL AND e.deleted_at IS NULL
      ORDER BY s.storyboard_number, s.id`
  ).all(episodeId, Number(session.drama_id));
  const targets = rows.map((row) => {
    const characterIds = parseJsonArray(row.characters)
      .map(Number)
      .filter(Number.isFinite);
    const characters = characterIds.length
      ? db.prepare(
        `SELECT id, name, appearance, description, polished_prompt
           FROM characters
          WHERE id IN (${characterIds.map(() => '?').join(',')})
            AND drama_id = ? AND deleted_at IS NULL`
      ).all(...characterIds, Number(session.drama_id))
      : [];
    const props = db.prepare(
      `SELECT p.id, p.name, p.description, p.prompt
         FROM storyboard_props sp
         JOIN props p ON p.id = sp.prop_id
        WHERE sp.storyboard_id = ? AND p.deleted_at IS NULL
        ORDER BY p.id`
    ).all(row.id);
    const scene = row.scene_id
      ? db.prepare(
        `SELECT id, location, time, prompt, polished_prompt
           FROM scenes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).get(row.scene_id, Number(session.drama_id))
      : null;
    return {
      targetType: 'storyboard',
      targetId: row.id,
      storyboardId: row.id,
      frameType: 'first',
      name: `分镜 ${row.storyboard_number}${row.title ? ` · ${row.title}` : ''}`,
      storyboardNumber: row.storyboard_number,
      title: row.title || '',
      description: row.description || '',
      layoutDescription: row.layout_description || '',
      imagePrompt: row.polished_prompt || row.image_prompt || row.description || '',
      location: row.location || '',
      time: row.time || '',
      action: row.action || '',
      result: row.result || '',
      atmosphere: row.atmosphere || '',
      shotType: row.shot_type || '',
      angle: row.angle || '',
      characters,
      props,
      scene,
      imageUrl: row.image_url || '',
    };
  });
  return options.missingOnly === false
    ? targets
    : targets.filter((target) => !target.imageUrl);
}

function filterStoryboardTargetsByRequest(targets, text) {
  const input = String(text || '');
  const numbers = new Set();
  const patterns = [
    /第\s*(\d{1,3})\s*(?:个|条|号|镜)?\s*分镜/g,
    /分镜\s*[#＃]?\s*(\d{1,3})/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(input))) numbers.add(Number(match[1]));
  }
  if (!numbers.size) return [...(targets || [])];
  return (targets || []).filter((target) => numbers.has(Number(target.storyboardNumber)));
}

function buildStoryboardImagePrompt(db, session, episode, target) {
  const drama = db.prepare(
    'SELECT title, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(session.drama_id));
  const metadata = parseMetadata(drama);
  const characterText = target.characters.length
    ? target.characters.map((item) => [
      `${item.name}`,
      item.appearance || item.description || '',
      item.polished_prompt || '',
    ].filter(Boolean).join('：')).join('\n')
    : '无角色';
  const propText = target.props.length
    ? target.props.map((item) => `${item.name}：${item.description || item.prompt || ''}`).join('\n')
    : '无关键道具';
  const sceneText = target.scene
    ? [
      target.scene.location,
      target.scene.time,
      target.scene.polished_prompt || target.scene.prompt,
    ].filter(Boolean).join('；')
    : [target.location, target.time].filter(Boolean).join('；');
  return [
    '必须调用 Codex 原生图片生成能力并保存一张图片，不能只回复说明或提示词。',
    '本次只生成一张独立的影视分镜首帧，禁止生成分镜表、接触表、拼贴、宫格、多画格或多张图片。',
    `项目：${drama?.title || session.drama_id}`,
    episode ? `剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
    `目标：${target.name}`,
    drama?.style ? `项目风格：${drama.style}` : '',
    metadata.aspect_ratio ? `画幅比例：${metadata.aspect_ratio}` : '',
    sceneText ? `场景资源：${sceneText}` : '',
    `画面布局：${target.layoutDescription || target.description}`,
    `分镜画面提示词：${target.imagePrompt}`,
    target.action ? `动作起始状态：${target.action}` : '',
    target.result ? `画面结果：${target.result}` : '',
    target.shotType ? `景别：${target.shotType}` : '',
    target.angle ? `机位：${target.angle}` : '',
    target.atmosphere ? `氛围：${target.atmosphere}` : '',
    `本镜出场角色（必须保持资源设定一致，禁止增加其他人物）：\n${characterText}`,
    `本镜关键道具：\n${propText}`,
    '画面必须表现这一条分镜的单一首帧瞬间，角色数量、外貌、服装、站位和道具必须与上述数据一致。',
    '不要出现文字、镜号、标题、字幕、气泡、水印、logo、品牌标志或边框。',
  ].filter(Boolean).join('\n\n');
}

module.exports = {
  STORYBOARD_ITEM_SCHEMA,
  createStoryboardOutputSchema,
  parseExplicitCount,
  estimateStoryboardPlan,
  buildStoryboardGenerationPrompt,
  parseStoryboardResult,
  persistGeneratedStoryboards,
  isStoryboardImageRequest,
  isStoryboardGenerationRequest,
  listStoryboardImageTargets,
  filterStoryboardTargetsByRequest,
  buildStoryboardImagePrompt,
};

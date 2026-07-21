const { safeParseAIJSON } = require('../utils/safeJson');
const dramaService = require('./dramaService');
const codexResources = require('./codexResourceService');
const codexStoryboards = require('./codexStoryboardService');

const STORYBOARD_DETAIL_FIELDS = [
  'title',
  'description',
  'layout_description',
  'action',
  'result',
  'atmosphere',
];
const STORYBOARD_PROMPT_FIELDS = ['image_prompt', 'polished_prompt', 'video_prompt'];

function clean(value, max = 30_000) {
  return String(value || '').trim().slice(0, max);
}

function parseJson(value, fallback = null) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function parseStructuredResult(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return safeParseAIJSON(text, {}, null);
  }
}

function exactUpdateSchema(targets, fields) {
  const properties = {
    target_id: { type: 'integer', minimum: 1 },
  };
  for (const field of fields) properties[field] = { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['assistant_reply', 'updates'],
    properties: {
      assistant_reply: { type: 'string' },
      updates: {
        type: 'array',
        minItems: targets.length,
        maxItems: targets.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['target_id', ...fields],
          properties,
        },
      },
    },
  };
}

function validateStructuredUpdates(text, targets, fields) {
  const parsed = parseStructuredResult(text);
  const updates = Array.isArray(parsed?.updates) ? parsed.updates : [];
  if (updates.length !== targets.length) {
    throw new Error(`Codex 返回数量不完整：要求 ${targets.length} 条，实际 ${updates.length} 条`);
  }
  const targetIds = new Set(targets.map((target) => Number(target.targetId)));
  const seen = new Set();
  const normalized = updates.map((item) => {
    const targetId = Number(item.target_id);
    if (!targetIds.has(targetId) || seen.has(targetId)) {
      throw new Error(`Codex 返回了无效或重复的目标 ID：${item.target_id}`);
    }
    seen.add(targetId);
    const update = { target_id: targetId };
    for (const field of fields) {
      const value = clean(item[field]);
      if (!value) throw new Error(`目标 ${targetId} 的 ${field} 为空`);
      update[field] = value;
    }
    return update;
  });
  return {
    assistant_reply: clean(parsed?.assistant_reply, 2000) || '内容已优化并保存。',
    updates: normalized,
  };
}

function matchesNamedTarget(target, names) {
  const targetName = clean(target?.name, 100).toLocaleLowerCase();
  return (names || []).some((name) => {
    const wanted = clean(name, 100).toLocaleLowerCase();
    return wanted && (targetName === wanted || targetName.includes(wanted) || wanted.includes(targetName));
  });
}

function listResourcePromptTargets(db, session, plan, requestText) {
  const scopes = plan.resource_scopes?.length
    ? plan.resource_scopes
    : codexResources.detectResourceScopes(requestText);
  const allTargets = codexResources.listResourceImageTargets(
    db,
    session,
    scopes,
    { missingOnly: false }
  );
  let targets = allTargets;
  if (plan.resource_names?.length) {
    targets = allTargets.filter((target) => matchesNamedTarget(target, plan.resource_names));
  } else {
    const mentioned = codexResources.filterResourceTargetsByRequest(allTargets, requestText);
    if (mentioned.length < allTargets.length) targets = mentioned;
  }
  if (!targets.length) throw new Error('没有找到要优化提示词的角色、道具或场景');
  if (!plan.target_all && !plan.resource_names?.length && targets.length > 1) {
    throw new Error('请明确资源名称，或说明要优化该类型的全部资源提示词');
  }
  return targets;
}

function resourcePromptOutputSchema(targets) {
  return exactUpdateSchema(targets, ['optimized_prompt']);
}

function buildResourcePromptOptimizationPrompt(db, session, episode, targets, requestText) {
  const drama = dramaService.getDramaById(db, session.drama_id);
  const metadata = drama?.metadata && typeof drama.metadata === 'object'
    ? drama.metadata
    : parseJson(drama?.metadata, {});
  const rules = {
    character: '单个角色独立设定图；明确年龄、体态、面部、发型、服装和稳定身份锚点；不得增加其他角色。',
    prop: '单个道具独立资源图；明确材质、结构、尺度、磨损与棚拍构图；无人、无手、无身体部位。',
    scene: '纯环境场景资源图；明确空间结构、时间、光线、材质、前中后景和镜头视角；无人物、无人群。',
  };
  const payload = targets.map((target) => ({
    target_id: target.targetId,
    target_type: target.targetType,
    name: target.name,
    description: target.description,
    current_prompt: target.imagePrompt,
    rules: rules[target.targetType],
  }));
  return [
    '你正在优化 LocalMiniDrama 项目资源的最终图片生成提示词，只生成文字，不生成图片。',
    '每个 target_id 必须原样返回一次，不得遗漏、重复或增加目标。',
    'optimized_prompt 必须可直接交给图片模型，具体、无歧义，并严格保持现有角色外貌、道具结构或场景设定。',
    '每个提示词只能描述一个独立资源，禁止拼贴、宫格、设定表、文字、标题、水印、logo 和品牌标志。',
    `项目：${drama?.title || session.drama_id}`,
    drama?.style ? `项目风格：${drama.style}` : '',
    metadata?.aspect_ratio ? `画幅：${metadata.aspect_ratio}` : '',
    episode ? `当前剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
    `用户要求：${clean(requestText)}`,
    `待优化资源：${JSON.stringify(payload)}`,
    '最终只返回符合宿主 JSON Schema 的数据，不要输出 Markdown。',
  ].filter(Boolean).join('\n\n');
}

function persistResourcePromptUpdates(db, session, targets, parsed) {
  const targetById = new Map(targets.map((target) => [Number(target.targetId), target]));
  const now = new Date().toISOString();
  return db.transaction(() => parsed.updates.map((update) => {
    const target = targetById.get(update.target_id);
    if (!target) throw new Error(`资源 ${update.target_id} 不属于本次任务`);
    if (target.targetType === 'character') {
      db.prepare(
        `UPDATE characters SET polished_prompt = ?, updated_at = ?
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).run(update.optimized_prompt, now, update.target_id, Number(session.drama_id));
    } else if (target.targetType === 'prop') {
      db.prepare(
        `UPDATE props SET prompt = ?, updated_at = ?
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).run(update.optimized_prompt, now, update.target_id, Number(session.drama_id));
    } else if (target.targetType === 'scene') {
      db.prepare(
        `UPDATE scenes SET polished_prompt = ?, updated_at = ?
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).run(update.optimized_prompt, now, update.target_id, Number(session.drama_id));
    } else {
      throw new Error(`不支持的资源类型：${target.targetType}`);
    }
    return {
      target_type: target.targetType,
      target_id: update.target_id,
      name: target.name,
      optimized_prompt: update.optimized_prompt,
    };
  }))();
}

function parseIds(value) {
  const parsed = parseJson(value, []);
  return (Array.isArray(parsed) ? parsed : [])
    .map((item) => Number(typeof item === 'object' && item != null ? item.id : item))
    .filter(Number.isFinite);
}

function enrichStoryboardTarget(db, session, row) {
  const characterIds = parseIds(row.characters);
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
       FROM storyboard_props sp JOIN props p ON p.id = sp.prop_id
      WHERE sp.storyboard_id = ? AND p.deleted_at IS NULL ORDER BY p.id`
  ).all(row.id);
  const scene = row.scene_id
    ? db.prepare(
      `SELECT id, location, time, prompt, polished_prompt
         FROM scenes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
    ).get(row.scene_id, Number(session.drama_id))
    : null;
  return {
    targetId: row.id,
    storyboardNumber: row.storyboard_number,
    name: `分镜 ${row.storyboard_number}${row.title ? ` · ${row.title}` : ''}`,
    row,
    characters,
    props,
    scene,
  };
}

function listStoryboardEditTargets(db, session, plan, requestText) {
  const episodeId = Number(session.episode_id);
  if (!Number.isInteger(episodeId) || episodeId <= 0) {
    throw new Error('编辑分镜必须选择一个剧集');
  }
  let rows = db.prepare(
    `SELECT * FROM storyboards
      WHERE episode_id = ? AND deleted_at IS NULL
      ORDER BY storyboard_number, id`
  ).all(episodeId);
  if (!rows.length) throw new Error('当前剧集还没有分镜，请先生成分镜');
  if (plan.storyboard_numbers?.length) {
    const wanted = new Set(plan.storyboard_numbers.map(Number));
    rows = rows.filter((row) => wanted.has(Number(row.storyboard_number)));
  } else if (!plan.target_all) {
    const filtered = codexStoryboards.filterStoryboardTargetsByRequest(
      rows.map((row) => ({ storyboardNumber: row.storyboard_number, row })),
      requestText
    );
    if (filtered.length < rows.length) rows = filtered.map((item) => item.row);
  }
  if (!rows.length) throw new Error('没有找到用户指定的分镜编号');
  if (!plan.target_all && !plan.storyboard_numbers?.length && rows.length > 1) {
    throw new Error('请明确分镜编号，或说明要处理当前集的所有分镜');
  }
  return rows.map((row) => enrichStoryboardTarget(db, session, row));
}

function storyboardUpdateOutputSchema(targets, fields) {
  return exactUpdateSchema(targets, fields);
}

function serializeStoryboardTarget(target) {
  const row = target.row;
  return {
    target_id: target.targetId,
    storyboard_number: target.storyboardNumber,
    title: row.title || '',
    description: row.description || '',
    location: row.location || '',
    time: row.time || '',
    duration: row.duration || 5,
    action: row.action || '',
    dialogue: row.dialogue || '',
    narration: row.narration || '',
    result: row.result || '',
    atmosphere: row.atmosphere || '',
    shot_type: row.shot_type || '',
    angle: row.angle || '',
    movement: row.movement || '',
    lighting_style: row.lighting_style || '',
    depth_of_field: row.depth_of_field || '',
    layout_description: row.layout_description || '',
    image_prompt: row.image_prompt || '',
    polished_prompt: row.polished_prompt || '',
    video_prompt: row.video_prompt || '',
    scene: target.scene,
    characters: target.characters,
    props: target.props,
  };
}

function buildStoryboardDetailsPrompt(db, session, episode, targets, fields, requestText) {
  const drama = dramaService.getDramaById(db, session.drama_id);
  const payload = targets.map(serializeStoryboardTarget);
  return [
    '你正在补充或优化 LocalMiniDrama 的结构化分镜字段，只生成文字，不生成图片。',
    `本次只更新字段：${fields.join(', ')}。每个 target_id 必须原样返回一次。`,
    '必须忠于当前剧本和已有分镜事实，不得新增未出现的角色、道具、地点或剧情。',
    'description 要具体说明单一画面；layout_description 要明确主体位置、朝向、前中后景和关键道具位置。',
    'action 描述本镜动作过程，result 描述镜头结束状态，atmosphere 描述可视化氛围。',
    '字段内容必须可直接保存，不能写解释、建议、占位符或 Markdown。',
    `项目：${drama?.title || session.drama_id}`,
    episode ? `当前剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
    episode?.script_content ? `剧本：${clean(episode.script_content, 18_000)}` : '',
    `用户要求：${clean(requestText)}`,
    `目标分镜：${JSON.stringify(payload)}`,
    '最终只返回符合宿主 JSON Schema 的数据。',
  ].filter(Boolean).join('\n\n');
}

function buildStoryboardPromptOptimizationPrompt(db, session, episode, targets, fields, requestText) {
  const drama = dramaService.getDramaById(db, session.drama_id);
  const metadata = drama?.metadata && typeof drama.metadata === 'object'
    ? drama.metadata
    : parseJson(drama?.metadata, {});
  const payload = targets.map(serializeStoryboardTarget);
  return [
    '你正在生成或优化 LocalMiniDrama 分镜编辑区的提示词，只生成文字，不生成图片。',
    `本次只更新字段：${fields.join(', ')}。每个 target_id 必须原样返回一次。`,
    'image_prompt：中文原始画面提示词，描述单一首帧的主体、环境、构图、光线和风格，不写连续动作。',
    'polished_prompt：可直接用于图片生成的完整通用优化提示词，保持角色、场景、道具设定一致，只生成一张独立影视首帧，禁止拼贴、宫格、文字、水印和 logo。',
    'video_prompt：可直接用于视频生成，明确起始状态、按时间顺序的动作、运镜、结束状态、时长、对白/旁白/音效；必须与首帧和相邻剧情一致。',
    '不得改变已有剧情事实、角色数量、服装锚点、道具归属或场景时空。',
    `项目：${drama?.title || session.drama_id}`,
    drama?.style ? `项目风格：${drama.style}` : '',
    metadata?.aspect_ratio ? `画幅：${metadata.aspect_ratio}` : '',
    episode ? `当前剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
    episode?.script_content ? `剧本：${clean(episode.script_content, 18_000)}` : '',
    `用户要求：${clean(requestText)}`,
    `目标分镜：${JSON.stringify(payload)}`,
    '最终只返回符合宿主 JSON Schema 的数据，不要输出 Markdown。',
  ].filter(Boolean).join('\n\n');
}

function persistStoryboardUpdates(db, session, targets, parsed, fields) {
  const allowed = new Set([...STORYBOARD_DETAIL_FIELDS, ...STORYBOARD_PROMPT_FIELDS]);
  for (const field of fields) {
    if (!allowed.has(field)) throw new Error(`不支持更新分镜字段：${field}`);
  }
  const targetIds = new Set(targets.map((target) => Number(target.targetId)));
  const now = new Date().toISOString();
  return db.transaction(() => parsed.updates.map((update) => {
    if (!targetIds.has(update.target_id)) throw new Error(`分镜 ${update.target_id} 不属于本次任务`);
    const sets = fields.map((field) => `${field} = ?`);
    const values = fields.map((field) => update[field]);
    const info = db.prepare(
      `UPDATE storyboards SET ${sets.join(', ')}, updated_at = ?
        WHERE id = ? AND episode_id = ? AND deleted_at IS NULL`
    ).run(...values, now, update.target_id, Number(session.episode_id));
    if (!info.changes) throw new Error(`分镜 ${update.target_id} 保存失败`);
    return {
      storyboard_id: update.target_id,
      storyboard_number: targets.find((target) => target.targetId === update.target_id)?.storyboardNumber,
      ...Object.fromEntries(fields.map((field) => [field, update[field]])),
    };
  }))();
}

function normalizeDetailFields(fields) {
  const normalized = [...new Set((fields || []).filter((field) => STORYBOARD_DETAIL_FIELDS.includes(field)))];
  return normalized.length ? normalized : ['description', 'layout_description'];
}

function normalizePromptFields(fields) {
  const normalized = [...new Set((fields || []).filter((field) => STORYBOARD_PROMPT_FIELDS.includes(field)))];
  return normalized.length ? normalized : ['polished_prompt'];
}

module.exports = {
  STORYBOARD_DETAIL_FIELDS,
  STORYBOARD_PROMPT_FIELDS,
  buildResourcePromptOptimizationPrompt,
  buildStoryboardDetailsPrompt,
  buildStoryboardPromptOptimizationPrompt,
  listResourcePromptTargets,
  listStoryboardEditTargets,
  normalizeDetailFields,
  normalizePromptFields,
  persistResourcePromptUpdates,
  persistStoryboardUpdates,
  resourcePromptOutputSchema,
  storyboardUpdateOutputSchema,
  validateStructuredUpdates,
};

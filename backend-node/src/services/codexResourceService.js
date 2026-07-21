const { safeParseAIJSON } = require('../utils/safeJson');
const promptTemplates = require('./promptTemplateService');
const dramaService = require('./dramaService');
const propService = require('./propService');
const sceneService = require('./sceneService');

const RESOURCE_SCOPES = ['character', 'prop', 'scene'];

const RESOURCE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assistant_reply', 'characters', 'props', 'scenes'],
  properties: {
    assistant_reply: { type: 'string' },
    characters: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'role', 'description', 'personality', 'appearance', 'image_prompt'],
        properties: {
          name: { type: 'string' },
          role: { type: 'string' },
          description: { type: 'string' },
          personality: { type: 'string' },
          appearance: { type: 'string' },
          image_prompt: { type: 'string' },
        },
      },
    },
    props: {
      type: 'array',
      maxItems: 30,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'type', 'description', 'image_prompt'],
        properties: {
          name: { type: 'string' },
          type: { type: 'string' },
          description: { type: 'string' },
          image_prompt: { type: 'string' },
        },
      },
    },
    scenes: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['location', 'time', 'description', 'image_prompt'],
        properties: {
          location: { type: 'string' },
          time: { type: 'string' },
          description: { type: 'string' },
          image_prompt: { type: 'string' },
        },
      },
    },
  },
};

function clean(value, max = 20_000) {
  return String(value || '').trim().slice(0, max);
}

function detectResourceScopes(text) {
  const input = String(text || '');
  const scopes = [];
  if (/角色|人物|演员|character/i.test(input)) scopes.push('character');
  if (/道具|物品|prop/i.test(input)) scopes.push('prop');
  if (/场景|环境|背景|scene|background/i.test(input)) scopes.push('scene');
  return scopes.length ? scopes : [...RESOURCE_SCOPES];
}

function isResourceImageRequest(text) {
  const input = String(text || '');
  return /(图|图片|形象照|设定图|资源图|image)/i.test(input)
    && /(资源|角色|人物|道具|物品|场景|环境|背景|character|prop|scene)/i.test(input)
    && /(生成|制作|创建|画|补齐|配图|出图|来一?张|想要|重做|重新)/i.test(input);
}

function isResourceExtractionRequest(text) {
  const input = String(text || '');
  if (isResourceImageRequest(input)) return false;
  return /(资源文本|资源信息|资源说明|资源设定)/i.test(input)
    || /(提取|生成|创建|整理|分析).{0,18}(角色|人物|道具|物品|场景|环境|背景)/i.test(input)
    || /(角色|人物|道具|物品|场景|环境|背景).{0,18}(提取|生成|创建|整理|分析)/i.test(input);
}

function buildResourceExtractionPrompt(db, cfg, session, episode, body, taskId) {
  const script = clean(episode?.script_content || dramaService.getDramaById(db, session.drama_id)?.description);
  if (!script) throw new Error('当前项目没有可用于提取资源的剧本内容');
  const context = { cfg, dramaId: session.drama_id, taskId };
  const characterSystem = promptTemplates.resolvePromptContent(
    db,
    'character.extraction.system',
    context
  );
  const characterUser = promptTemplates.resolvePromptContent(db, 'character.extraction.user', {
    ...context,
    variables: { script_content: script },
  });
  const propSystem = promptTemplates.resolvePromptContent(db, 'prop.extraction.system', context);
  const propUser = promptTemplates.resolvePromptContent(db, 'prop.extraction.user', {
    ...context,
    variables: { script_content: script },
  });
  const sceneSystem = promptTemplates.resolvePromptContent(db, 'scene.extraction.system', context);
  const sceneUser = promptTemplates.resolvePromptContent(db, 'scene.extraction.user', {
    ...context,
    variables: { script_content: script },
  });
  const scopes = detectResourceScopes(body.content);
  return [
    '请从剧本中提取可复用的角色、道具和场景资源，并严格按宿主提供的 JSON Schema 输出。',
    `本次需要的资源范围：${scopes.join(', ')}。未要求的资源数组必须返回空数组。`,
    '每项必须提供可直接入库的中文说明，以及可直接交给原生图片生成能力的详细 image_prompt。',
    '角色 image_prompt 只描述单个角色；道具 image_prompt 只描述单个道具；场景 image_prompt 只描述纯环境。',
    '不要把多个资源合并到同一条 image_prompt，不要输出 Markdown。',
    `【角色提取规则】\n${characterSystem}\n${characterUser}`,
    `【道具提取规则】\n${propSystem}\n${propUser}`,
    `【场景提取规则】\n${sceneSystem}\n${sceneUser}`,
    `【用户要求】\n${clean(body.content)}`,
    `【剧本】\n${script}`,
  ].join('\n\n');
}

function parseResourceResult(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = safeParseAIJSON(text, {}, null);
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('Codex 未返回有效资源数据');
  const characters = (Array.isArray(parsed.characters) ? parsed.characters : [])
    .slice(0, 20)
    .map((item) => ({
      name: clean(item.name, 100),
      role: clean(item.role, 100),
      description: clean(item.description),
      personality: clean(item.personality),
      appearance: clean(item.appearance),
      image_prompt: clean(item.image_prompt),
    }))
    .filter((item) => item.name);
  const props = (Array.isArray(parsed.props) ? parsed.props : [])
    .slice(0, 30)
    .map((item) => ({
      name: clean(item.name, 100),
      type: clean(item.type, 100),
      description: clean(item.description),
      image_prompt: clean(item.image_prompt),
    }))
    .filter((item) => item.name);
  const scenes = (Array.isArray(parsed.scenes) ? parsed.scenes : [])
    .slice(0, 20)
    .map((item) => ({
      location: clean(item.location, 200),
      time: clean(item.time, 100),
      description: clean(item.description),
      image_prompt: clean(item.image_prompt),
    }))
    .filter((item) => item.location);
  if (!characters.length && !props.length && !scenes.length) {
    throw new Error('Codex 未提取到角色、道具或场景');
  }
  return {
    assistant_reply: clean(parsed.assistant_reply) || '资源文本已提取并保存。',
    characters,
    props,
    scenes,
  };
}

function persistExtractedResources(db, log, session, extracted) {
  const dramaId = Number(session.drama_id);
  const episodeId = session.episode_id != null ? Number(session.episode_id) : null;
  const now = new Date().toISOString();
  return db.transaction(() => {
    const characters = [];
    for (const item of extracted.characters) {
      let row = db.prepare(
        'SELECT * FROM characters WHERE drama_id = ? AND name = ? AND deleted_at IS NULL'
      ).get(dramaId, item.name);
      if (row) {
        db.prepare(
          `UPDATE characters
              SET role = ?, description = ?, personality = ?, appearance = ?,
                  polished_prompt = ?, updated_at = ?
            WHERE id = ?`
        ).run(
          item.role || row.role || null,
          item.description || row.description || null,
          item.personality || row.personality || null,
          item.appearance || row.appearance || null,
          item.image_prompt || row.polished_prompt || null,
          now,
          row.id
        );
      } else {
        const info = db.prepare(
          `INSERT INTO characters
            (drama_id, name, role, description, personality, appearance,
             polished_prompt, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
        ).run(
          dramaId,
          item.name,
          item.role || null,
          item.description || null,
          item.personality || null,
          item.appearance || null,
          item.image_prompt || null,
          now,
          now
        );
        row = { id: Number(info.lastInsertRowid) };
      }
      if (episodeId) {
        db.prepare(
          'INSERT OR IGNORE INTO episode_characters (episode_id, character_id) VALUES (?, ?)'
        ).run(episodeId, row.id);
      }
      characters.push(db.prepare(
        `SELECT id, name, role, description, personality, appearance, polished_prompt
           FROM characters WHERE id = ?`
      ).get(row.id));
    }

    const props = [];
    for (const item of extracted.props) {
      let row = db.prepare(
        'SELECT * FROM props WHERE drama_id = ? AND name = ? AND deleted_at IS NULL'
      ).get(dramaId, item.name);
      if (row) {
        db.prepare(
          `UPDATE props
              SET episode_id = COALESCE(episode_id, ?), type = ?, description = ?,
                  prompt = ?, updated_at = ?
            WHERE id = ?`
        ).run(
          episodeId,
          item.type || row.type || null,
          item.description || row.description || null,
          item.image_prompt || row.prompt || null,
          now,
          row.id
        );
      } else {
        row = propService.create(db, log, {
          drama_id: dramaId,
          episode_id: episodeId,
          name: item.name,
          type: item.type || null,
          description: item.description || null,
          prompt: item.image_prompt || null,
        });
      }
      props.push(propService.getById(db, row.id));
    }

    const scenes = [];
    for (const item of extracted.scenes) {
      let row = episodeId
        ? db.prepare(
          `SELECT * FROM scenes
            WHERE drama_id = ? AND episode_id = ? AND location = ? AND deleted_at IS NULL`
        ).get(dramaId, episodeId, item.location)
        : db.prepare(
          `SELECT * FROM scenes
            WHERE drama_id = ? AND location = ? AND deleted_at IS NULL`
        ).get(dramaId, item.location);
      if (row) {
        db.prepare(
          `UPDATE scenes
              SET time = ?, prompt = ?, polished_prompt = ?, updated_at = ?
            WHERE id = ?`
        ).run(
          item.time || row.time || null,
          item.description || row.prompt || null,
          item.image_prompt || row.polished_prompt || null,
          now,
          row.id
        );
      } else {
        row = sceneService.createSceneForEpisode(db, log, dramaId, episodeId, {
          location: item.location,
          time: item.time || '',
          prompt: item.description || '',
        });
        db.prepare(
          `UPDATE scenes
              SET polished_prompt = ?, updated_at = ?
            WHERE id = ?`
        ).run(
          item.image_prompt || null,
          now,
          row.id
        );
      }
      scenes.push(db.prepare(
        `SELECT id, location, time, prompt, polished_prompt
           FROM scenes WHERE id = ?`
      ).get(row.id));
    }

    return {
      characters,
      props,
      scenes,
      counts: {
        characters: characters.length,
        props: props.length,
        scenes: scenes.length,
      },
    };
  })();
}

function listResourceImageTargets(db, session, scopes, options = {}) {
  const wanted = new Set(scopes?.length ? scopes : RESOURCE_SCOPES);
  const dramaId = Number(session.drama_id);
  const episodeId = session.episode_id != null ? Number(session.episode_id) : null;
  const targets = [];
  if (wanted.has('character')) {
    let rows = episodeId
      ? db.prepare(
        `SELECT c.id, c.name, c.description, c.appearance, c.polished_prompt,
                c.image_url, c.local_path
           FROM characters c
           JOIN episode_characters ec ON ec.character_id = c.id
          WHERE c.drama_id = ? AND ec.episode_id = ? AND c.deleted_at IS NULL
          ORDER BY c.id`
      ).all(dramaId, episodeId)
      : db.prepare(
        `SELECT id, name, description, appearance, polished_prompt, image_url, local_path
           FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(dramaId);
    if (episodeId && !rows.length) {
      rows = db.prepare(
        `SELECT id, name, description, appearance, polished_prompt, image_url, local_path
           FROM characters WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(dramaId);
    }
    for (const row of rows) {
      targets.push({
        targetType: 'character',
        targetId: row.id,
        characterId: row.id,
        name: row.name,
        description: row.appearance || row.description || '',
        imagePrompt: row.polished_prompt || row.appearance || row.description || '',
        imageUrl: row.image_url || '',
      });
    }
  }
  if (wanted.has('prop')) {
    const rows = episodeId
      ? db.prepare(
        `SELECT id, name, type, description, prompt, image_url, local_path
           FROM props
          WHERE drama_id = ? AND (episode_id = ? OR episode_id IS NULL)
            AND deleted_at IS NULL ORDER BY id`
      ).all(dramaId, episodeId)
      : db.prepare(
        `SELECT id, name, type, description, prompt, image_url, local_path
           FROM props WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(dramaId);
    for (const row of rows) {
      targets.push({
        targetType: 'prop',
        targetId: row.id,
        propId: row.id,
        name: row.name,
        description: [row.type, row.description].filter(Boolean).join('；'),
        imagePrompt: row.prompt || row.description || '',
        imageUrl: row.image_url || '',
      });
    }
  }
  if (wanted.has('scene')) {
    const rows = episodeId
      ? db.prepare(
        `SELECT id, location, time, prompt, polished_prompt,
                image_url, local_path
           FROM scenes
          WHERE drama_id = ? AND (episode_id = ? OR episode_id IS NULL)
            AND deleted_at IS NULL ORDER BY id`
      ).all(dramaId, episodeId)
      : db.prepare(
        `SELECT id, location, time, prompt, polished_prompt,
                image_url, local_path
           FROM scenes WHERE drama_id = ? AND deleted_at IS NULL ORDER BY id`
      ).all(dramaId);
    for (const row of rows) {
      targets.push({
        targetType: 'scene',
        targetId: row.id,
        sceneId: row.id,
        name: row.location,
        description: [row.time, row.prompt].filter(Boolean).join('；'),
        imagePrompt: row.polished_prompt || row.prompt || '',
        imageUrl: row.image_url || '',
      });
    }
  }
  return options.missingOnly === false
    ? targets
    : targets.filter((target) => !target.imageUrl);
}

function filterResourceTargetsByRequest(targets, text) {
  const input = String(text || '').trim();
  const mentioned = (targets || []).filter(
    (target) => target.name && input.includes(String(target.name))
  );
  return mentioned.length ? mentioned : [...(targets || [])];
}

function buildResourceImagePrompt(db, session, episode, target) {
  const drama = dramaService.getDramaById(db, session.drama_id);
  const metadata = drama?.metadata && typeof drama.metadata === 'object' ? drama.metadata : {};
  const typeRules = {
    character: '只生成这一个角色的独立角色设定图，人物清晰完整，背景简洁；不要出现其他角色。',
    prop: '只生成这一个道具的独立资源图，纯色无缝背景，无人物、无手、无身体部位。',
    scene: '只生成这个场景的纯环境资源图，无人物、无角色、无身体部位、无人群。',
  };
  return [
    '必须调用 Codex 原生图片生成能力生成并保存一张图片，不能只回复文字或生成提示词。',
    `资源类型：${target.targetType}`,
    `资源名称：${target.name}`,
    target.description ? `资源说明：${target.description}` : '',
    target.imagePrompt ? `项目资源提示词：${target.imagePrompt}` : '',
    drama?.style ? `项目风格：${drama.style}` : '',
    metadata.aspect_ratio ? `画幅比例：${metadata.aspect_ratio}` : '',
    episode ? `所属剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
    typeRules[target.targetType],
    '必须是一张独立资源图片，不要拼贴、九宫格、设计表、文字、标题、标签、水印、logo或品牌标志。',
  ].filter(Boolean).join('\n');
}

module.exports = {
  RESOURCE_OUTPUT_SCHEMA,
  RESOURCE_SCOPES,
  detectResourceScopes,
  isResourceImageRequest,
  isResourceExtractionRequest,
  buildResourceExtractionPrompt,
  parseResourceResult,
  persistExtractedResources,
  listResourceImageTargets,
  filterResourceTargetsByRequest,
  buildResourceImagePrompt,
};

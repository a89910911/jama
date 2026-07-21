const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const { randomUUID } = require('crypto');
const promptTemplates = require('./promptTemplateService');
const taskService = require('./taskService');
const dramaService = require('./dramaService');
const assetService = require('./assetService');
const aiRequestLogs = require('./aiRequestLogService');
const storageLayout = require('./storageLayout');
const { bindStoryboardFrameImage } = require('./storyboardFrameBinding');
const { safeParseAIJSON } = require('../utils/safeJson');
const { getCodexRuntime } = require('../integrations/codex/codexRuntimeManager');
const { codexChatEventBus } = require('./codexChatEventBus');
const codexResources = require('./codexResourceService');
const codexStoryboards = require('./codexStoryboardService');
const codexIntents = require('./codexIntentService');
const codexEditing = require('./codexEditingService');

const CODEX_PROVIDER = 'codex_app_server';
const MAX_CONTEXT_CHARS = 30_000;
const MAX_MESSAGE_CHARS = 50_000;

const SCRIPT_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['assistant_reply', 'episodes'],
  properties: {
    assistant_reply: { type: 'string' },
    episodes: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['episode_number', 'title', 'script_content'],
        properties: {
          episode_number: { type: 'integer', minimum: 1 },
          title: { type: 'string' },
          script_content: { type: 'string' },
        },
      },
    },
  },
};

function parseJson(value, fallback = null) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    drama_id: row.drama_id,
    episode_id: row.episode_id,
    user_id: row.user_id,
    codex_thread_id: row.codex_thread_id,
    title: row.title,
    status: row.status,
    last_message_at: row.last_message_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function rowToMessage(row) {
  if (!row) return null;
  return {
    id: row.id,
    session_id: row.session_id,
    role: row.role,
    content_type: row.content_type,
    content: row.content,
    action_type: row.action_type,
    status: row.status,
    task_id: row.task_id,
    codex_turn_id: row.codex_turn_id,
    metadata: parseJson(row.metadata, {}),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function verifyEpisode(db, dramaId, episodeId) {
  if (episodeId == null || episodeId === '') return null;
  const episode = db.prepare(
    `SELECT id, drama_id, episode_number, title, script_content
       FROM episodes
      WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
  ).get(Number(episodeId), Number(dramaId));
  if (!episode) {
    const error = new Error('当前剧集不存在或不属于该项目');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  return episode;
}

function createSession(db, details) {
  const dramaId = Number(details.drama_id);
  const drama = dramaService.getDramaById(db, dramaId);
  if (!drama) {
    const error = new Error('项目不存在');
    error.code = 'NOT_FOUND';
    throw error;
  }
  const episode = verifyEpisode(db, dramaId, details.episode_id);
  const now = new Date().toISOString();
  const id = randomUUID();
  const title = String(
    details.title
      || (episode ? `第${episode.episode_number || ''}集 AI 对话` : `${drama.title || '项目'} AI 对话`)
  ).trim().slice(0, 100);
  db.prepare(
    `INSERT INTO codex_chat_sessions
      (id, drama_id, episode_id, user_id, title, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    id,
    dramaId,
    episode?.id || null,
    details.user_id || null,
    title,
    now,
    now
  );
  return getSession(db, id, details.user_id);
}

function getSession(db, sessionId, userId) {
  const params = [String(sessionId)];
  let userClause = '';
  if (userId) {
    userClause = ' AND (user_id IS NULL OR user_id = ?)';
    params.push(Number(userId));
  }
  return rowToSession(db.prepare(
    `SELECT * FROM codex_chat_sessions
      WHERE id = ? AND deleted_at IS NULL${userClause}`
  ).get(...params));
}

function listSessions(db, dramaId, userId, episodeId) {
  const params = [Number(dramaId)];
  let sql = `SELECT * FROM codex_chat_sessions
    WHERE drama_id = ? AND deleted_at IS NULL`;
  if (episodeId != null && episodeId !== '') {
    sql += ' AND episode_id = ?';
    params.push(Number(episodeId));
  }
  if (userId) {
    sql += ' AND (user_id IS NULL OR user_id = ?)';
    params.push(Number(userId));
  }
  sql += ' ORDER BY updated_at DESC';
  return db.prepare(sql).all(...params).map(rowToSession);
}

function listMessages(db, sessionId) {
  return db.prepare(
    `SELECT * FROM codex_chat_messages
      WHERE session_id = ? AND deleted_at IS NULL
      ORDER BY created_at ASC, rowid ASC`
  ).all(String(sessionId)).map(rowToMessage);
}

function insertMessage(db, details) {
  const now = new Date().toISOString();
  const id = details.id || randomUUID();
  db.prepare(
    `INSERT INTO codex_chat_messages
      (id, session_id, role, content_type, content, action_type, status,
       task_id, codex_turn_id, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    details.session_id,
    details.role,
    details.content_type || 'text',
    String(details.content || '').slice(0, MAX_MESSAGE_CHARS),
    details.action_type || null,
    details.status || 'completed',
    details.task_id || null,
    details.codex_turn_id || null,
    details.metadata ? JSON.stringify(details.metadata) : null,
    now,
    now
  );
  return rowToMessage(db.prepare('SELECT * FROM codex_chat_messages WHERE id = ?').get(id));
}

function updateMessage(db, messageId, fields) {
  const allowed = ['content', 'content_type', 'action_type', 'status', 'task_id', 'codex_turn_id', 'metadata'];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (fields[key] === undefined) continue;
    sets.push(`${key} = ?`);
    params.push(key === 'metadata' && fields[key] != null
      ? JSON.stringify(fields[key])
      : fields[key]);
  }
  if (!sets.length) return null;
  sets.push('updated_at = ?');
  params.push(new Date().toISOString(), String(messageId));
  db.prepare(`UPDATE codex_chat_messages SET ${sets.join(', ')} WHERE id = ?`).run(...params);
  return rowToMessage(db.prepare('SELECT * FROM codex_chat_messages WHERE id = ?').get(String(messageId)));
}

function inferIntent(text, hint) {
  const allowed = new Set(codexIntents.SUPPORTED_INTENTS);
  if (allowed.has(hint)) return hint;
  const input = String(text || '');
  const discussesExistingResult = /(为什么|为何|怎么回事|有什么问题|哪里有问题|失败原因|是否已经|有没有生成|生成了多少|如何使用|怎么使用|什么意思|评价|分析一下|检查一下)/i.test(input)
    && !/(请|帮我|麻烦|现在|立即|重新|再|继续|开始).{0,12}(生成|制作|创建|画|改写|重写|续写|提取|保存|补齐)/i.test(input);
  if (discussesExistingResult) return 'chat';
  if (/(优化|润色|完善|改写|重写|生成).{0,18}(通用优化提示词|视频提示词|原始提示词|图生提示词|提示词编辑)/i.test(input)
    && /分镜|镜头/i.test(input)) {
    return 'optimize_storyboard_prompt';
  }
  if (/分镜|镜头/i.test(input)
    && /(补充|完善|优化|改写|重写).{0,18}(说明|描述|布局|构图|站位|动作|结果|氛围|镜头内容)/i.test(input)
    && !/(重新生成|生成|制作|创建|拆解|拆分).{0,16}(全部|所有|每条)?\s*分镜/i.test(input)) {
    return 'update_storyboard_details';
  }
  if (/(优化|润色|完善|改写|重写|生成).{0,18}(图生提示词|图片提示词|资源提示词)/i.test(input)
    && /(资源|角色|人物|道具|物品|场景|环境|背景)/i.test(input)) {
    return 'optimize_resource_prompt';
  }
  if (codexStoryboards.isStoryboardImageRequest(input)) return 'generate_storyboard_images';
  if (codexStoryboards.isStoryboardGenerationRequest(input)) return 'generate_storyboards';
  if (codexResources.isResourceImageRequest(input)) return 'generate_resource_images';
  if (codexResources.isResourceExtractionRequest(input)) return 'extract_resources';
  if (/(生成|画|制作|创建).{0,8}(图|图片|海报|插画)|生图|画一[幅张]/i.test(input)) {
    return 'generate_image';
  }
  if (/续写|继续写|接着写/i.test(input)) return 'continue_current_episode';
  if (/改写|重写|修改.{0,8}(剧本|这一集|本集|第\d+集)/i.test(input)) {
    return 'rewrite_current_episode';
  }
  if (/(生成|创作|制作|创建|写|做).{0,12}(剧本|分集|故事大纲|故事|短剧|剧情)/i.test(input)
    || /(剧本|分集|故事大纲).{0,12}(生成|创作|制作|创建|写|做)/i.test(input)) {
    return 'generate_story';
  }
  return 'chat';
}

function buildConversationContext(db, session, episode) {
  const drama = dramaService.getDramaById(db, session.drama_id);
  const messages = listMessages(db, session.id)
    .filter((item) => item.status === 'completed')
    .slice(-12)
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`)
    .join('\n');
  const context = [
    `项目：${drama?.title || session.drama_id}`,
    `项目简介：${drama?.description || ''}`,
    episode ? `当前剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
    episode?.script_content ? `当前剧本：\n${String(episode.script_content).slice(0, 18_000)}` : '',
    messages ? `最近对话：\n${messages}` : '',
  ].filter(Boolean).join('\n\n');
  return context.slice(0, MAX_CONTEXT_CHARS);
}

function buildStoryPrompt(db, session, episode, body, taskId, intent) {
  const episodeCount = episode
    ? 1
    : Math.max(1, Math.min(50, Math.floor(Number(body.episode_count) || 1)));
  const drama = dramaService.getDramaById(db, session.drama_id);
  const premise = String(body.content || body.message || '').trim();
  const promptContext = {
    dramaId: session.drama_id,
    taskId,
    variables: { episode_count: episodeCount },
  };
  const systemPrompt = promptTemplates.resolvePromptContent(db, 'story.generation.system', promptContext);
  const userPrompt = promptTemplates.resolvePromptContent(db, 'story.generation.user', {
    dramaId: session.drama_id,
    taskId,
    variables: {
      episode_count: episodeCount,
      story_premise: premise,
      story_style: body.style || drama?.metadata?.story_style || '',
      story_type: body.type || drama?.genre || '',
    },
  });
  const operation = intent === 'continue_current_episode'
    ? '续写当前剧集；episodes[0].script_content 只输出新增续写片段，不要重复当前剧本'
    : intent === 'rewrite_current_episode'
      ? '根据用户要求改写当前剧集'
      : episode
        ? '根据用户要求生成当前剧集的完整剧本'
        : `生成 ${episodeCount} 集完整短剧剧本`;
  return [
    '【项目生成规则】',
    systemPrompt,
    '【本次操作】',
    operation,
    episode?.script_content ? `【当前剧本】\n${String(episode.script_content).slice(0, 20_000)}` : '',
    '【项目提示词接口生成的用户提示词】',
    userPrompt,
    '【用户原始消息】',
    premise,
    '最终输出必须符合宿主应用提供的 JSON Schema。不要输出 Markdown 代码块。',
  ].filter(Boolean).join('\n\n');
}

function parseScriptResult(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = safeParseAIJSON(text, {}, null);
  }
  const rawEpisodes = Array.isArray(parsed) ? parsed : parsed?.episodes;
  const episodes = (Array.isArray(rawEpisodes) ? rawEpisodes : [])
    .map((episode, index) => ({
      episode_number: Math.max(1, Number(episode.episode_number ?? episode.episode ?? index + 1) || index + 1),
      title: String(episode.title || `第${index + 1}集`).trim().slice(0, 200),
      script_content: String(episode.script_content || episode.content || episode.script || '').trim(),
    }))
    .filter((episode) => episode.script_content);
  if (!episodes.length) throw new Error('Codex 未返回有效剧本内容');
  return {
    assistant_reply: String(parsed?.assistant_reply || `已生成 ${episodes.length} 集剧本。`).trim(),
    episodes,
  };
}

function assertTaskActive(db, taskId) {
  const task = taskService.getTask(db, taskId);
  if (!task || !['pending', 'processing', 'running'].includes(task.status)) {
    const error = new Error(task?.error || '任务已停止');
    error.code = 'CODEX_TURN_INTERRUPTED';
    throw error;
  }
}

async function persistCodexImage(db, log, cfg, details) {
  const source = path.resolve(String(details.savedPath || ''));
  if (!source || !fs.existsSync(source)) throw new Error('Codex 未返回有效图片文件');
  const codexHome = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
  const allowedRoot = path.resolve(details.allowedImageRoot || path.join(codexHome, 'generated_images'));
  const relativeToAllowed = path.relative(allowedRoot, source);
  if (relativeToAllowed.startsWith('..') || path.isAbsolute(relativeToAllowed)) {
    throw new Error('Codex 图片路径不在允许目录中');
  }
  const stat = fs.statSync(source);
  if (!stat.isFile() || stat.size <= 0 || stat.size > 25 * 1024 * 1024) {
    throw new Error('Codex 图片文件无效或超过 25MB');
  }
  const metadata = await sharp(source).metadata();
  if (!['png', 'jpeg', 'webp'].includes(metadata.format)) {
    throw new Error('Codex 返回了不支持的图片格式');
  }

  const rawStorage = cfg?.storage?.local_path || './data/storage';
  const storageRoot = path.isAbsolute(rawStorage)
    ? rawStorage
    : path.join(process.cwd(), rawStorage);
  const projectDir = storageLayout.getProjectStorageSubdir(db, details.dramaId);
  const relDir = `${projectDir}/images`;
  const destDir = path.join(storageRoot, ...relDir.split('/'));
  fs.mkdirSync(destDir, { recursive: true });
  const ext = metadata.format === 'jpeg' ? '.jpg' : `.${metadata.format}`;
  const filename = `codex_${Date.now()}_${randomUUID().slice(0, 8)}${ext}`;
  const destination = path.join(destDir, filename);
  fs.copyFileSync(source, destination);
  const localPath = `${relDir}/${filename}`;
  const now = new Date().toISOString();

  const transaction = db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO image_generations
        (storyboard_id, drama_id, episode_id, scene_id, character_id, provider,
         prompt, model, frame_type, size, image_url, local_path, width, height,
         status, task_id, completed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)`
    ).run(
      details.storyboardId || null,
      Number(details.dramaId),
      details.episodeId || null,
      details.sceneId || null,
      details.characterId || null,
      CODEX_PROVIDER,
      details.prompt,
      details.model || null,
      details.frameType || null,
      `${metadata.width || 0}x${metadata.height || 0}`,
      `/static/${localPath}`,
      localPath,
      metadata.width || null,
      metadata.height || null,
      details.taskId,
      now,
      now,
      now
    );
    const imageGenId = Number(info.lastInsertRowid);

    if (details.storyboardId) {
      bindStoryboardFrameImage(
        db,
        details.storyboardId,
        details.frameType,
        imageGenId,
        `/static/${localPath}`,
        localPath
      );
    } else if (details.characterId) {
      db.prepare(
        `UPDATE characters SET image_url = ?, local_path = ?, updated_at = ?
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).run(`/static/${localPath}`, localPath, now, details.characterId, details.dramaId);
    } else if (details.sceneId) {
      db.prepare(
        `UPDATE scenes SET image_url = ?, local_path = ?, updated_at = ?
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).run(`/static/${localPath}`, localPath, now, details.sceneId, details.dramaId);
    } else if (details.propId) {
      db.prepare(
        `UPDATE props SET image_url = ?, local_path = ?, updated_at = ?
          WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
      ).run(`/static/${localPath}`, localPath, now, details.propId, details.dramaId);
    }

    const asset = assetService.create(db, log, {
      drama_id: details.dramaId,
      name: String(details.assetName || 'Codex 生成图片').slice(0, 100),
      type: 'image',
      category: details.targetType || 'ai_chat',
      url: `/static/${localPath}`,
      local_path: localPath,
      file_size: stat.size,
      mime_type: metadata.format === 'jpeg' ? 'image/jpeg' : `image/${metadata.format}`,
      width: metadata.width,
      height: metadata.height,
      image_gen_id: imageGenId,
    });
    return {
      image_generation_id: imageGenId,
      asset_id: asset?.id || null,
      url: `/static/${localPath}`,
      local_path: localPath,
      width: metadata.width || null,
      height: metadata.height || null,
      revised_prompt: details.revisedPrompt || '',
    };
  });

  try {
    return transaction();
  } catch (error) {
    try { fs.unlinkSync(destination); } catch (_) {}
    throw error;
  }
}

function validateImageTarget(db, session, body) {
  const targetType = String(body.target_type || '').trim();
  const targetId = Number(body.target_id);
  if (!targetType || !Number.isFinite(targetId)) return {};
  if (targetType === 'storyboard') {
    const row = db.prepare(
      `SELECT s.id FROM storyboards s
       JOIN episodes e ON e.id = s.episode_id
       WHERE s.id = ? AND e.drama_id = ? AND s.deleted_at IS NULL AND e.deleted_at IS NULL`
    ).get(targetId, session.drama_id);
    if (!row) throw new Error('目标分镜不属于当前项目');
    return { targetType, storyboardId: targetId, frameType: body.frame_type || 'first' };
  }
  const tableMap = { character: 'characters', scene: 'scenes', prop: 'props' };
  const table = tableMap[targetType];
  if (!table) throw new Error('不支持的图片绑定目标');
  const row = db.prepare(
    `SELECT id FROM ${table} WHERE id = ? AND drama_id = ? AND deleted_at IS NULL`
  ).get(targetId, session.drama_id);
  if (!row) throw new Error('图片绑定目标不属于当前项目');
  return {
    targetType,
    characterId: targetType === 'character' ? targetId : null,
    sceneId: targetType === 'scene' ? targetId : null,
    propId: targetType === 'prop' ? targetId : null,
  };
}

async function ensureSessionThread(db, session, runtime) {
  const threadId = await runtime.ensureThread(session.codex_thread_id);
  if (threadId !== session.codex_thread_id) {
    db.prepare(
      'UPDATE codex_chat_sessions SET codex_thread_id = ?, updated_at = ? WHERE id = ?'
    ).run(threadId, new Date().toISOString(), session.id);
  }
  return threadId;
}

async function resolveIntentPlan(db, log, details) {
  const {
    session,
    episode,
    body,
    taskId,
    assistantMessageId,
    runtime,
    threadId,
  } = details;
  const explicitHint = codexIntents.SUPPORTED_INTENTS.includes(body.intent_hint)
    ? body.intent_hint
    : '';
  const initialIntent = inferIntent(body.content, explicitHint);
  const contextualRequest = !explicitHint
    && codexIntents.needsContextualPlanning(body.content);
  if (explicitHint || (initialIntent !== 'chat' && !contextualRequest)) {
    return codexIntents.createLocalIntentPlan(
      initialIntent,
      body.content,
      explicitHint ? 'shortcut' : 'rule'
    );
  }

  taskService.updateTaskStatus(db, taskId, 'processing', 15, 'Codex 正在理解你的需求...');
  codexChatEventBus.publish(session.id, 'phase.changed', {
    task_id: taskId,
    phase: 'planning',
    message: 'Codex 正在理解你的需求...',
  });
  try {
    const turn = await runtime.runTurn({
      taskId,
      threadId,
      text: codexIntents.buildIntentPlanningPrompt(
        db,
        session,
        episode,
        body.content
      ),
      outputSchema: codexIntents.INTENT_PLAN_SCHEMA,
      timeoutMs: 90_000,
      onTurnStarted(turnId) {
        updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
      },
    });
    assertTaskActive(db, taskId);
    return codexIntents.parseIntentPlan(turn.text, body.content);
  } catch (error) {
    if (error.code === 'CODEX_TURN_INTERRUPTED') throw error;
    log?.warn?.('Codex intent planning failed; falling back to chat', {
      task_id: taskId,
      error: error.message,
    });
    return {
      ...codexIntents.createLocalIntentPlan('chat', body.content, 'fallback'),
      confidence: 0,
      reason: `意图规划失败，已安全回退为普通对话：${error.message}`,
    };
  }
}

function mergeIntentPlanMetadata(message, plan) {
  return {
    ...(message?.metadata || {}),
    intent_plan: {
      intent: plan.intent,
      label: codexIntents.intentLabel(plan.intent),
      confidence: plan.confidence,
      normalized_request: plan.normalized_request,
      reason: plan.reason,
      resource_scopes: plan.resource_scopes,
      resource_names: plan.resource_names,
      storyboard_numbers: plan.storyboard_numbers,
      prompt_fields: plan.prompt_fields,
      detail_fields: plan.detail_fields,
      target_all: plan.target_all,
      prepare_source: plan.prepare_source,
      force_regenerate: plan.force_regenerate,
      source: plan.source,
    },
  };
}

async function extractResourcesWithCodex(db, cfg, log, details) {
  const {
    session,
    episode,
    body,
    taskId,
    assistantMessageId,
    runtime,
    threadId,
  } = details;
  taskService.updateTaskStatus(db, taskId, 'processing', 25, 'Codex 正在提取角色、道具和场景...');
  codexChatEventBus.publish(session.id, 'phase.changed', {
    task_id: taskId,
    phase: 'extracting_resources',
    message: 'Codex 正在提取角色、道具和场景...',
  });
  const prompt = codexResources.buildResourceExtractionPrompt(
    db,
    cfg,
    session,
    episode,
    body,
    taskId
  );
  const turn = await runtime.runTurn({
    taskId,
    threadId,
    text: prompt,
    outputSchema: codexResources.RESOURCE_OUTPUT_SCHEMA,
    timeoutMs: 3 * 60_000,
    onTurnStarted(turnId) {
      updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
    },
  });
  assertTaskActive(db, taskId);
  taskService.updateTaskStatus(db, taskId, 'processing', 70, '正在写入资源库...');
  const extracted = codexResources.parseResourceResult(turn.text);
  const saved = codexResources.persistExtractedResources(db, log, session, extracted);
  return { extracted, saved };
}

function resourceSummary(counts) {
  return [
    `${Number(counts?.characters || 0)} 个角色`,
    `${Number(counts?.props || 0)} 个道具`,
    `${Number(counts?.scenes || 0)} 个场景`,
  ].join('、');
}

async function generateStoryboardsWithCodex(db, cfg, log, details) {
  const {
    session,
    episode,
    body,
    taskId,
    assistantMessageId,
    runtime,
    threadId,
  } = details;
  if (!episode) throw new Error('生成分镜必须选择一个剧集');
  taskService.updateTaskStatus(db, taskId, 'processing', 20, 'Codex 正在生成完整分镜...');
  codexChatEventBus.publish(session.id, 'phase.changed', {
    task_id: taskId,
    phase: 'generating_storyboards',
    message: 'Codex 正在生成完整分镜...',
  });
  const bundle = codexStoryboards.buildStoryboardGenerationPrompt(
    db,
    cfg,
    session,
    episode,
    body,
    taskId
  );
  const turn = await runtime.runTurn({
    taskId,
    threadId,
    text: bundle.prompt,
    outputSchema: bundle.outputSchema,
    timeoutMs: 6 * 60_000,
    onTurnStarted(turnId) {
      updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
    },
  });
  assertTaskActive(db, taskId);
  taskService.updateTaskStatus(db, taskId, 'processing', 80, '正在校验并写入全部分镜...');
  const parsed = codexStoryboards.parseStoryboardResult(
    turn.text,
    bundle.plan.storyboardCount
  );
  const saved = codexStoryboards.persistGeneratedStoryboards(
    db,
    cfg,
    log,
    session,
    episode,
    parsed,
    bundle.plan
  );
  if (saved.length !== bundle.plan.storyboardCount) {
    throw new Error(
      `分镜入库数量不完整：要求 ${bundle.plan.storyboardCount} 条，实际 ${saved.length} 条`
    );
  }
  return { parsed, saved, plan: bundle.plan };
}

async function processMessage(db, cfg, log, details) {
  const {
    sessionId,
    userMessageId,
    assistantMessageId,
    taskId,
    body,
    userId,
  } = details;
  const session = getSession(db, sessionId, userId);
  if (!session) {
    taskService.updateTaskError(db, taskId, 'AI 对话不存在');
    return;
  }
  const episode = verifyEpisode(db, session.drama_id, session.episode_id);
  const runtime = getCodexRuntime({ log });
  let intent = inferIntent(body.content, body.intent_hint);
  let intentPlan = codexIntents.createLocalIntentPlan(intent, body.content);
  let intentPlanMetadata = intentPlan;
  let logRecord = null;

  taskService.updateTaskStatus(db, taskId, 'processing', 10, '正在连接 Codex...');
  codexChatEventBus.publish(sessionId, 'phase.changed', {
    task_id: taskId,
    phase: 'connecting',
    message: '正在连接 Codex...',
  });

  try {
    const threadId = await ensureSessionThread(db, session, runtime);
    assertTaskActive(db, taskId);
    intentPlan = await resolveIntentPlan(db, log, {
      session,
      episode,
      body,
      taskId,
      assistantMessageId,
      runtime,
      threadId,
    });
    intent = intentPlan.intent;
    const originalContent = body.content;
    if (
      intentPlan.normalized_request
      && intentPlan.normalized_request !== originalContent
    ) {
      body.content = [
        originalContent,
        `【意图识别后的可执行要求】${intentPlan.normalized_request}`,
      ].join('\n\n');
    }
    intentPlanMetadata = mergeIntentPlanMetadata(null, intentPlan).intent_plan;
    const userRow = rowToMessage(db.prepare(
      'SELECT * FROM codex_chat_messages WHERE id = ?'
    ).get(userMessageId));
    const assistantRow = rowToMessage(db.prepare(
      'SELECT * FROM codex_chat_messages WHERE id = ?'
    ).get(assistantMessageId));
    updateMessage(db, userMessageId, {
      action_type: intent,
      metadata: mergeIntentPlanMetadata(userRow, intentPlan),
    });
    updateMessage(db, assistantMessageId, {
      action_type: intent,
      content_type: codexIntents.contentTypeForIntent(intent),
      metadata: mergeIntentPlanMetadata(assistantRow, intentPlan),
    });
    taskService.updateTaskStatus(
      db,
      taskId,
      'processing',
      18,
      `已理解为“${codexIntents.intentLabel(intent)}”，正在执行...`
    );
    codexChatEventBus.publish(sessionId, 'intent.resolved', {
      task_id: taskId,
      intent,
      label: codexIntents.intentLabel(intent),
      plan: intentPlanMetadata,
      user_message: rowToMessage(db.prepare(
        'SELECT * FROM codex_chat_messages WHERE id = ?'
      ).get(userMessageId)),
      assistant_message: rowToMessage(db.prepare(
        'SELECT * FROM codex_chat_messages WHERE id = ?'
      ).get(assistantMessageId)),
    });

    logRecord = aiRequestLogs.start(db, {
      drama_id: session.drama_id,
      episode_id: episode?.id,
      service_type: [
        'generate_image',
        'generate_resource_images',
        'generate_storyboard_images',
      ].includes(intent) ? 'image' : 'text',
      operation: intent,
      scene_key: 'codex_ai_chat',
      provider: CODEX_PROVIDER,
      related_type: 'codex_chat_message',
      related_id: assistantMessageId,
      request: {
        content: originalContent,
        intent,
        intent_plan: intentPlanMetadata,
        episode_id: episode?.id || null,
      },
    });

    if (intent === 'optimize_resource_prompt') {
      const targets = codexEditing.listResourcePromptTargets(
        db,
        session,
        intentPlan,
        body.content
      );
      taskService.updateTaskStatus(db, taskId, 'processing', 30, 'Codex 正在优化资源图片提示词...');
      codexChatEventBus.publish(sessionId, 'phase.changed', {
        task_id: taskId,
        phase: 'optimizing_resource_prompts',
        message: `正在优化 ${targets.length} 个资源的图片提示词...`,
      });
      const turn = await runtime.runTurn({
        taskId,
        threadId,
        text: codexEditing.buildResourcePromptOptimizationPrompt(
          db,
          session,
          episode,
          targets,
          body.content
        ),
        outputSchema: codexEditing.resourcePromptOutputSchema(targets),
        timeoutMs: 3 * 60_000,
        onTurnStarted(turnId) {
          updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
        },
      });
      assertTaskActive(db, taskId);
      taskService.updateTaskStatus(db, taskId, 'processing', 82, '正在校验并保存资源提示词...');
      const parsed = codexEditing.validateStructuredUpdates(
        turn.text,
        targets,
        ['optimized_prompt']
      );
      const saved = codexEditing.persistResourcePromptUpdates(
        db,
        session,
        targets,
        parsed
      );
      const reply = `${parsed.assistant_reply}\n\n已优化并写入 ${saved.length} 个资源的图片提示词。`;
      const metadata = {
        intent_plan: intentPlanMetadata,
        resource_prompt_updates: saved,
      };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'resources',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        updated_count: saved.length,
        updates: saved,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        updated_count: saved.length,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'update_storyboard_details') {
      const fields = codexEditing.normalizeDetailFields(intentPlan.detail_fields);
      const targets = codexEditing.listStoryboardEditTargets(
        db,
        session,
        intentPlan,
        body.content
      );
      taskService.updateTaskStatus(db, taskId, 'processing', 30, 'Codex 正在补充分镜说明...');
      codexChatEventBus.publish(sessionId, 'phase.changed', {
        task_id: taskId,
        phase: 'updating_storyboard_details',
        message: `正在补充 ${targets.length} 条分镜的说明...`,
      });
      const turn = await runtime.runTurn({
        taskId,
        threadId,
        text: codexEditing.buildStoryboardDetailsPrompt(
          db,
          session,
          episode,
          targets,
          fields,
          body.content
        ),
        outputSchema: codexEditing.storyboardUpdateOutputSchema(targets, fields),
        timeoutMs: 5 * 60_000,
        onTurnStarted(turnId) {
          updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
        },
      });
      assertTaskActive(db, taskId);
      taskService.updateTaskStatus(db, taskId, 'processing', 82, '正在校验并保存分镜说明...');
      const parsed = codexEditing.validateStructuredUpdates(turn.text, targets, fields);
      const saved = codexEditing.persistStoryboardUpdates(
        db,
        session,
        targets,
        parsed,
        fields
      );
      const reply = `${parsed.assistant_reply}\n\n已补充并写入 ${saved.length} 条分镜，更新字段：${fields.join('、')}。`;
      const metadata = {
        intent_plan: intentPlanMetadata,
        storyboard_updates: saved,
        updated_fields: fields,
      };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'storyboards',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        updated_count: saved.length,
        updated_fields: fields,
        updates: saved,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        updated_count: saved.length,
        updated_fields: fields,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'optimize_storyboard_prompt') {
      const fields = codexEditing.normalizePromptFields(intentPlan.prompt_fields);
      const targets = codexEditing.listStoryboardEditTargets(
        db,
        session,
        intentPlan,
        body.content
      );
      taskService.updateTaskStatus(db, taskId, 'processing', 30, 'Codex 正在优化分镜提示词...');
      codexChatEventBus.publish(sessionId, 'phase.changed', {
        task_id: taskId,
        phase: 'optimizing_storyboard_prompts',
        message: `正在优化 ${targets.length} 条分镜的提示词...`,
      });
      const turn = await runtime.runTurn({
        taskId,
        threadId,
        text: codexEditing.buildStoryboardPromptOptimizationPrompt(
          db,
          session,
          episode,
          targets,
          fields,
          body.content
        ),
        outputSchema: codexEditing.storyboardUpdateOutputSchema(targets, fields),
        timeoutMs: 5 * 60_000,
        onTurnStarted(turnId) {
          updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
        },
      });
      assertTaskActive(db, taskId);
      taskService.updateTaskStatus(db, taskId, 'processing', 82, '正在校验并保存分镜提示词...');
      const parsed = codexEditing.validateStructuredUpdates(turn.text, targets, fields);
      const saved = codexEditing.persistStoryboardUpdates(
        db,
        session,
        targets,
        parsed,
        fields
      );
      const reply = `${parsed.assistant_reply}\n\n已优化并写入 ${saved.length} 条分镜的提示词，更新字段：${fields.join('、')}。`;
      const metadata = {
        intent_plan: intentPlanMetadata,
        storyboard_prompt_updates: saved,
        updated_fields: fields,
      };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'storyboards',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        updated_count: saved.length,
        updated_fields: fields,
        updates: saved,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        updated_count: saved.length,
        updated_fields: fields,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'generate_storyboards') {
      const { parsed, saved, plan } = await generateStoryboardsWithCodex(
        db,
        cfg,
        log,
        {
          session,
          episode,
          body,
          taskId,
          assistantMessageId,
          runtime,
          threadId,
        }
      );
      const reply = `${parsed.assistant_reply}\n\n已完整写入 ${saved.length} 条分镜。`;
      const metadata = {
        intent_plan: intentPlanMetadata,
        storyboards: {
          count: saved.length,
          storyboard_ids: saved.map((item) => item.id),
          expected_count: plan.storyboardCount,
          video_duration: plan.videoDuration,
          clip_duration: plan.clipDuration,
        },
      };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'storyboards',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        ...metadata.storyboards,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        storyboard_count: saved.length,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'generate_storyboard_images') {
      let allTargets = codexStoryboards.listStoryboardImageTargets(
        db,
        session,
        { missingOnly: false }
      );
      let generatedStoryboards = null;
      if (intentPlan.prepare_source || !allTargets.length) {
        generatedStoryboards = await generateStoryboardsWithCodex(
          db,
          cfg,
          log,
          {
            session,
            episode,
            body: {
              ...body,
              content: '先根据当前剧本生成全部分镜，再为每一条分镜生成独立首帧图片。',
            },
            taskId,
            assistantMessageId,
            runtime,
            threadId,
          }
        );
        allTargets = codexStoryboards.listStoryboardImageTargets(
          db,
          session,
          { missingOnly: false }
        );
      }
      allTargets = intentPlan.storyboard_numbers?.length
        ? allTargets.filter((target) => intentPlan.storyboard_numbers.includes(
          Number(target.storyboardNumber)
        ))
        : codexStoryboards.filterStoryboardTargetsByRequest(
          allTargets,
          body.content
        );
      const forceRegenerate = intentPlan.force_regenerate
        || /重新生成|重做|覆盖|全部重生/i.test(String(body.content || ''));
      const targets = forceRegenerate
        ? allTargets
        : allTargets.filter((target) => !target.imageUrl);
      if (!allTargets.length) throw new Error('当前剧集没有可生成图片的分镜');

      const images = [];
      const failures = [];
      for (let index = 0; index < targets.length; index += 1) {
        assertTaskActive(db, taskId);
        const target = targets[index];
        const progress = 25 + Math.round((index / Math.max(1, targets.length)) * 65);
        taskService.updateTaskStatus(
          db,
          taskId,
          'processing',
          progress,
          `正在生成分镜图片 ${index + 1}/${targets.length}：${target.name}`
        );
        codexChatEventBus.publish(sessionId, 'phase.changed', {
          task_id: taskId,
          phase: 'generating_storyboard_images',
          message: `正在生成分镜图片 ${index + 1}/${targets.length}：${target.name}`,
          current: index + 1,
          total: targets.length,
          storyboard: {
            id: target.storyboardId,
            number: target.storyboardNumber,
            title: target.title,
          },
        });
        try {
          const prompt = codexStoryboards.buildStoryboardImagePrompt(
            db,
            session,
            episode,
            target
          );
          const turn = await runtime.runTurn({
            taskId,
            threadId,
            text: prompt,
            timeoutMs: 5 * 60_000,
            onTurnStarted(turnId) {
              updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
            },
          });
          assertTaskActive(db, taskId);
          const generated = turn.images.find(
            (item) => item.status === 'completed' && item.savedPath
          );
          if (!generated) throw new Error('Codex 未返回分镜图片文件');
          const image = await persistCodexImage(db, log, cfg, {
            ...target,
            dramaId: session.drama_id,
            episodeId: episode?.id || null,
            taskId,
            prompt,
            revisedPrompt: generated.revisedPrompt,
            savedPath: generated.savedPath,
            assetName: `${target.name} · Codex`,
          });
          const completedImage = {
            ...image,
            target_type: 'storyboard',
            target_id: target.storyboardId,
            storyboard_number: target.storyboardNumber,
            name: target.name,
          };
          images.push(completedImage);
          codexChatEventBus.publish(sessionId, 'image.completed', {
            task_id: taskId,
            message_id: assistantMessageId,
            image: completedImage,
          });
        } catch (error) {
          if (error.code === 'CODEX_TURN_INTERRUPTED') throw error;
          failures.push({
            storyboard_id: target.storyboardId,
            storyboard_number: target.storyboardNumber,
            name: target.name,
            error: error.message,
          });
          log?.warn?.('Codex storyboard image failed', {
            task_id: taskId,
            storyboard_id: target.storyboardId,
            error: error.message,
          });
        }
      }
      if (!images.length && targets.length) {
        throw new Error(
          `分镜图片生成失败：${failures.map((item) => `#${item.storyboard_number}`).join('、')}`
        );
      }

      const skipped = Math.max(0, allTargets.length - targets.length);
      const reply = [
        generatedStoryboards
          ? `已先生成并写入 ${generatedStoryboards.saved.length} 条完整分镜。`
          : '',
        `已为 ${images.length} 条分镜生成并绑定独立图片。`,
        skipped ? `${skipped} 条已有图片的分镜已跳过。` : '',
        failures.length
          ? `${failures.length} 条分镜图片生成失败，可再次发送“生成所有分镜图片”重试。`
          : '',
      ].filter(Boolean).join('\n');
      const metadata = { intent_plan: intentPlanMetadata, images, failures, skipped };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'image',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        images,
        failures,
        skipped,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        generated_count: images.length,
        failed_count: failures.length,
        skipped,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'extract_resources') {
      const { extracted, saved } = await extractResourcesWithCodex(db, cfg, log, {
        session,
        episode,
        body,
        taskId,
        assistantMessageId,
        runtime,
        threadId,
      });
      const reply = `${extracted.assistant_reply}\n\n已写入资源库：${resourceSummary(saved.counts)}。`;
      const metadata = {
        intent_plan: intentPlanMetadata,
        resources: {
          counts: saved.counts,
          character_ids: saved.characters.map((item) => item.id),
          prop_ids: saved.props.map((item) => item.id),
          scene_ids: saved.scenes.map((item) => item.id),
        },
      };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'resources',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        ...metadata.resources,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        counts: saved.counts,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'generate_resource_images') {
      const scopes = intentPlan.resource_scopes?.length
        ? intentPlan.resource_scopes
        : codexResources.detectResourceScopes(body.content);
      let allTargets = codexResources.listResourceImageTargets(
        db,
        session,
        scopes,
        { missingOnly: false }
      );
      let extractedDuringTask = null;
      if (intentPlan.prepare_source || !allTargets.length) {
        extractedDuringTask = await extractResourcesWithCodex(db, cfg, log, {
          session,
          episode,
          body: {
            ...body,
            content: `先从当前剧本提取${scopes.join('、')}资源，再为每个资源生成独立图片。`,
          },
          taskId,
          assistantMessageId,
          runtime,
          threadId,
        });
        allTargets = codexResources.listResourceImageTargets(
          db,
          session,
          scopes,
          { missingOnly: false }
        );
      }
      allTargets = intentPlan.resource_names?.length
        ? allTargets.filter((target) => intentPlan.resource_names.some((name) => {
          const wanted = String(name || '').trim();
          const actual = String(target.name || '').trim();
          return wanted && actual && (
            wanted === actual || wanted.includes(actual) || actual.includes(wanted)
          );
        }))
        : codexResources.filterResourceTargetsByRequest(
          allTargets,
          body.content
        );
      const forceRegenerate = intentPlan.force_regenerate
        || /重新生成|重做|覆盖|全部重生/i.test(String(body.content || ''));
      const targets = forceRegenerate
        ? allTargets
        : allTargets.filter((target) => !target.imageUrl);
      if (!allTargets.length) throw new Error('未找到可生成图片的角色、道具或场景资源');

      const images = [];
      const failures = [];
      for (let index = 0; index < targets.length; index += 1) {
        assertTaskActive(db, taskId);
        const target = targets[index];
        const label = `${target.targetType}:${target.name}`;
        const progress = 25 + Math.round((index / Math.max(1, targets.length)) * 65);
        taskService.updateTaskStatus(
          db,
          taskId,
          'processing',
          progress,
          `正在生成资源图片 ${index + 1}/${targets.length}：${target.name}`
        );
        codexChatEventBus.publish(sessionId, 'phase.changed', {
          task_id: taskId,
          phase: 'generating_resource_images',
          message: `正在生成资源图片 ${index + 1}/${targets.length}：${target.name}`,
          current: index + 1,
          total: targets.length,
          resource: { type: target.targetType, id: target.targetId, name: target.name },
        });
        try {
          const prompt = codexResources.buildResourceImagePrompt(
            db,
            session,
            episode,
            target
          );
          const turn = await runtime.runTurn({
            taskId,
            threadId,
            text: prompt,
            timeoutMs: 5 * 60_000,
            onTurnStarted(turnId) {
              updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
            },
          });
          assertTaskActive(db, taskId);
          const generated = turn.images.find(
            (item) => item.status === 'completed' && item.savedPath
          );
          if (!generated) throw new Error('Codex 未返回图片文件');
          const image = await persistCodexImage(db, log, cfg, {
            ...target,
            dramaId: session.drama_id,
            episodeId: episode?.id || null,
            taskId,
            prompt,
            revisedPrompt: generated.revisedPrompt,
            savedPath: generated.savedPath,
            assetName: `${target.name} · Codex`,
          });
          const completedImage = {
            ...image,
            target_type: target.targetType,
            target_id: target.targetId,
            name: target.name,
          };
          images.push(completedImage);
          codexChatEventBus.publish(sessionId, 'image.completed', {
            task_id: taskId,
            message_id: assistantMessageId,
            image: completedImage,
          });
        } catch (error) {
          if (error.code === 'CODEX_TURN_INTERRUPTED') throw error;
          failures.push({ resource: label, error: error.message });
          log?.warn?.('Codex resource image failed', {
            task_id: taskId,
            resource: label,
            error: error.message,
          });
        }
      }
      if (!images.length && targets.length) {
        throw new Error(`资源图片生成失败：${failures.map((item) => item.resource).join('、')}`);
      }

      const skipped = Math.max(0, allTargets.length - targets.length);
      const reply = [
        extractedDuringTask
          ? `已先提取并写入${resourceSummary(extractedDuringTask.saved.counts)}。`
          : '',
        `已为 ${images.length} 个资源生成并绑定独立图片。`,
        skipped ? `${skipped} 个已有图片的资源已跳过。` : '',
        failures.length ? `${failures.length} 个资源生成失败，可再次发送“生成资源图片”重试。` : '',
      ].filter(Boolean).join('\n');
      const metadata = { intent_plan: intentPlanMetadata, images, failures, skipped };
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'image',
        action_type: intent,
        status: 'completed',
        metadata,
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        refresh_drama: true,
        images,
        failures,
        skipped,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        generated_count: images.length,
        failed_count: failures.length,
        skipped,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare(
          'SELECT * FROM codex_chat_messages WHERE id = ?'
        ).get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'generate_image') {
      const target = validateImageTarget(db, session, body);
      const prompt = [
        '请使用 Codex 内置的原生图片生成能力，只生成一张图片。',
        '不要使用 MCP、第三方图片服务或外部工具。',
        '图片中不要出现文字、水印或标志，除非用户明确要求。',
        `项目：${dramaService.getDramaById(db, session.drama_id)?.title || ''}`,
        episode ? `当前剧集：第${episode.episode_number}集《${episode.title || ''}》` : '',
        `用户要求：${body.content}`,
      ].filter(Boolean).join('\n');
      taskService.updateTaskStatus(db, taskId, 'processing', 25, 'Codex 正在生成图片...');
      codexChatEventBus.publish(sessionId, 'phase.changed', {
        task_id: taskId,
        phase: 'generating_image',
        message: 'Codex 正在生成图片...',
      });
      const turn = await runtime.runTurn({
        taskId,
        threadId,
        text: prompt,
        timeoutMs: 5 * 60_000,
        onTurnStarted(turnId) {
          updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
        },
        onDelta(delta) {
          codexChatEventBus.publish(sessionId, 'message.delta', {
            task_id: taskId,
            message_id: assistantMessageId,
            delta,
          });
        },
        onImage(image) {
          codexChatEventBus.publish(sessionId, 'image.completed', {
            task_id: taskId,
            message_id: assistantMessageId,
            image: { saved: !!image.savedPath, revised_prompt: image.revisedPrompt },
          });
        },
      });
      assertTaskActive(db, taskId);
      const generated = turn.images.find((item) => item.status === 'completed' && item.savedPath);
      if (!generated) throw new Error('Codex 未生成图片');
      taskService.updateTaskStatus(db, taskId, 'processing', 85, '正在保存图片...');
      const imageResult = await persistCodexImage(db, log, cfg, {
        ...target,
        dramaId: session.drama_id,
        episodeId: episode?.id || null,
        taskId,
        prompt: body.content,
        revisedPrompt: generated.revisedPrompt,
        savedPath: generated.savedPath,
        assetName: body.asset_name || 'Codex 对话生成图片',
      });
      const reply = turn.text || '图片已生成并保存到项目素材库。';
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'image',
        action_type: intent,
        status: 'completed',
        metadata: { intent_plan: intentPlanMetadata, image: imageResult },
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        image: imageResult,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        image_generation_id: imageResult.image_generation_id,
        local_path: imageResult.local_path,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare('SELECT * FROM codex_chat_messages WHERE id = ?').get(assistantMessageId)),
      });
      return;
    }

    if (intent === 'generate_story' || intent === 'rewrite_current_episode' || intent === 'continue_current_episode') {
      const prompt = buildStoryPrompt(db, session, episode, body, taskId, intent);
      taskService.updateTaskStatus(db, taskId, 'processing', 30, 'Codex 正在生成剧本...');
      codexChatEventBus.publish(sessionId, 'phase.changed', {
        task_id: taskId,
        phase: 'generating_script',
        message: 'Codex 正在生成剧本...',
      });
      const turn = await runtime.runTurn({
        taskId,
        threadId,
        text: prompt,
        outputSchema: SCRIPT_OUTPUT_SCHEMA,
        timeoutMs: 3 * 60_000,
        onTurnStarted(turnId) {
          updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
        },
        onDelta(delta) {
          codexChatEventBus.publish(sessionId, 'message.delta', {
            task_id: taskId,
            message_id: assistantMessageId,
            delta,
          });
        },
      });
      assertTaskActive(db, taskId);
      const parsed = parseScriptResult(turn.text);
      taskService.updateTaskStatus(db, taskId, 'processing', 85, '正在保存剧本...');
      let savedEpisodes;
      if (episode) {
        const generated = parsed.episodes[0];
        const saved = dramaService.updateEpisodeScript(db, log, session.drama_id, episode.id, {
          title: generated.title || episode.title,
          script_content: intent === 'continue_current_episode'
            ? `${episode.script_content || ''}\n\n${generated.script_content}`.trim()
            : generated.script_content,
        });
        if (!saved) throw new Error('保存当前剧集失败');
        savedEpisodes = [saved];
      } else {
        const saved = dramaService.saveEpisodes(db, log, session.drama_id, {
          episodes: parsed.episodes,
        });
        if (!saved) throw new Error('保存剧本失败');
        savedEpisodes = parsed.episodes;
      }
      const reply = parsed.assistant_reply || `已生成并保存 ${savedEpisodes.length} 集剧本。`;
      updateMessage(db, assistantMessageId, {
        content: reply,
        content_type: 'script',
        action_type: intent,
        status: 'completed',
        metadata: {
          intent_plan: intentPlanMetadata,
          episode_ids: savedEpisodes.map((item) => item.id).filter(Boolean),
          episode_count: savedEpisodes.length,
        },
      });
      taskService.updateTaskResult(db, taskId, {
        session_id: sessionId,
        message_id: assistantMessageId,
        action: intent,
        intent_plan: intentPlanMetadata,
        episode_count: savedEpisodes.length,
        episode_id: episode?.id || null,
      });
      aiRequestLogs.succeed(db, logRecord, {
        message_id: assistantMessageId,
        episode_count: savedEpisodes.length,
      }, { provider: CODEX_PROVIDER });
      codexChatEventBus.publish(sessionId, 'message.completed', {
        task_id: taskId,
        refresh_drama: true,
        message: rowToMessage(db.prepare('SELECT * FROM codex_chat_messages WHERE id = ?').get(assistantMessageId)),
      });
      return;
    }

    const context = buildConversationContext(db, session, episode);
    const prompt = [
      '请作为 LocalMiniDrama 的 Codex AI 创作助手直接回复用户。',
      '本轮已经被宿主应用判定为咨询或讨论，不执行数据库写入，也不生成图片。',
      '请结合项目上下文准确理解用户的代词和追问，回答应简洁、具体、可操作。',
      '不要声称已经生成、保存、入库、更新或绑定任何项目数据。',
      '如果用户其实是在询问如何让系统执行创作，可以告诉他直接自然地提出目标；可执行能力包括：生成/改写/续写剧本、提取角色道具场景、优化资源图生提示词、生成资源图片、生成或补充分镜、优化分镜原始/通用/视频提示词、生成分镜首帧、生成单张素材图。',
      '如果需求存在会覆盖数据、范围不明确或缺少当前剧集等关键条件，请明确指出需要补充什么。',
      `【项目上下文】\n${context}`,
      `【用户消息】\n${body.content}`,
    ].join('\n\n');
    taskService.updateTaskStatus(db, taskId, 'processing', 30, 'Codex 正在回复...');
    const turn = await runtime.runTurn({
      taskId,
      threadId,
      text: prompt,
      timeoutMs: 2 * 60_000,
      onTurnStarted(turnId) {
        updateMessage(db, assistantMessageId, { codex_turn_id: turnId });
      },
      onDelta(delta) {
        codexChatEventBus.publish(sessionId, 'message.delta', {
          task_id: taskId,
          message_id: assistantMessageId,
          delta,
        });
      },
    });
    assertTaskActive(db, taskId);
    const reply = turn.text || 'Codex 未返回文字内容。';
    updateMessage(db, assistantMessageId, {
      content: reply,
      content_type: 'text',
      action_type: intent,
      status: 'completed',
      metadata: { intent_plan: intentPlanMetadata },
    });
    taskService.updateTaskResult(db, taskId, {
      session_id: sessionId,
      message_id: assistantMessageId,
      action: intent,
      intent_plan: intentPlanMetadata,
    });
    aiRequestLogs.succeed(db, logRecord, { message_id: assistantMessageId }, { provider: CODEX_PROVIDER });
    codexChatEventBus.publish(sessionId, 'message.completed', {
      task_id: taskId,
      message: rowToMessage(db.prepare('SELECT * FROM codex_chat_messages WHERE id = ?').get(assistantMessageId)),
    });
  } catch (error) {
    const cancelled = error.code === 'CODEX_TURN_INTERRUPTED';
    updateMessage(db, assistantMessageId, {
      content: cancelled ? '已停止生成。' : `生成失败：${error.message}`,
      status: cancelled ? 'cancelled' : 'failed',
    });
    taskService.updateTaskError(db, taskId, cancelled ? '用户已取消' : error.message);
    aiRequestLogs.fail(db, logRecord, error, null, { provider: CODEX_PROVIDER });
    codexChatEventBus.publish(sessionId, cancelled ? 'turn.interrupted' : 'turn.failed', {
      task_id: taskId,
      message_id: assistantMessageId,
      error: cancelled ? '用户已取消' : error.message,
    });
    log?.error?.('Codex chat message failed', {
      task_id: taskId,
      session_id: sessionId,
      error: error.message,
    });
  } finally {
    db.prepare(
      `UPDATE codex_chat_sessions
          SET last_message_at = ?, updated_at = ?
        WHERE id = ?`
    ).run(new Date().toISOString(), new Date().toISOString(), sessionId);
  }
}

function startMessage(db, cfg, log, details) {
  const session = getSession(db, details.session_id, details.user_id);
  if (!session) {
    const error = new Error('AI 对话不存在');
    error.code = 'NOT_FOUND';
    throw error;
  }
  const content = String(details.content || '').trim();
  if (!content) {
    const error = new Error('请输入对话内容');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  if (content.length > MAX_MESSAGE_CHARS) {
    const error = new Error('对话内容不能超过 50000 字');
    error.code = 'BAD_REQUEST';
    throw error;
  }
  const existing = db.prepare(
    `SELECT t.id FROM async_tasks t
     JOIN codex_chat_messages m ON m.task_id = t.id
     WHERE m.session_id = ?
       AND t.status IN ('pending', 'processing', 'running')
       AND t.deleted_at IS NULL AND m.deleted_at IS NULL
     LIMIT 1`
  ).get(session.id);
  if (existing) {
    const error = new Error('当前对话已有生成任务，请等待完成或先停止');
    error.code = 'CONFLICT';
    throw error;
  }

  const task = taskService.createTask(db, log, 'codex_chat', `codex_chat:${session.id}`);
  const explicitHint = codexIntents.SUPPORTED_INTENTS.includes(details.intent_hint)
    ? details.intent_hint
    : '';
  const intent = inferIntent(content, explicitHint);
  const userMessage = insertMessage(db, {
    session_id: session.id,
    role: 'user',
    content,
    content_type: 'text',
    action_type: intent,
    status: 'completed',
  });
  const assistantMessage = insertMessage(db, {
    session_id: session.id,
    role: 'assistant',
    content: '',
    content_type: codexIntents.contentTypeForIntent(intent),
    action_type: intent,
    status: 'processing',
    task_id: task.id,
  });
  const now = new Date().toISOString();
  db.prepare(
    'UPDATE codex_chat_sessions SET last_message_at = ?, updated_at = ? WHERE id = ?'
  ).run(now, now, session.id);
  codexChatEventBus.publish(session.id, 'message.started', {
    task_id: task.id,
    user_message: userMessage,
    assistant_message: assistantMessage,
  });

  const body = {
    ...details,
    content,
    intent_hint: explicitHint || undefined,
    initial_intent: intent,
  };
  setImmediate(() => {
    processMessage(db, cfg, log, {
      sessionId: session.id,
      userMessageId: userMessage.id,
      assistantMessageId: assistantMessage.id,
      taskId: task.id,
      body,
      userId: details.user_id,
    }).catch((error) => {
      log?.error?.('Codex chat background task crashed', { task_id: task.id, error: error.message });
      taskService.updateTaskError(db, task.id, error.message);
    });
  });

  return {
    task_id: task.id,
    status: 'pending',
    user_message: userMessage,
    assistant_message: assistantMessage,
  };
}

async function cancelTask(db, log, taskId) {
  const runtime = getCodexRuntime({ log });
  let interrupted = false;
  try {
    interrupted = await runtime.interruptTask(taskId);
  } catch (error) {
    log?.warn?.('Codex turn interrupt failed', { task_id: taskId, error: error.message });
  }
  const rows = db.prepare(
    `SELECT id, session_id FROM codex_chat_messages
      WHERE task_id = ? AND status = 'processing' AND deleted_at IS NULL`
  ).all(String(taskId));
  for (const row of rows) {
    updateMessage(db, row.id, { content: '已停止生成。', status: 'cancelled' });
    codexChatEventBus.publish(row.session_id, 'turn.interrupted', {
      task_id: taskId,
      message_id: row.id,
      error: '用户已取消',
    });
  }
  return interrupted;
}

module.exports = {
  CODEX_PROVIDER,
  SCRIPT_OUTPUT_SCHEMA,
  createSession,
  getSession,
  listSessions,
  listMessages,
  startMessage,
  cancelTask,
  inferIntent,
  parseScriptResult,
  persistCodexImage,
  rowToSession,
  rowToMessage,
};

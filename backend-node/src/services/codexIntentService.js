const { safeParseAIJSON } = require('../utils/safeJson');
const promptTemplates = require('./promptTemplateService');
const assistantActions = require('./assistantActionRegistry');

const SUPPORTED_INTENTS = [...assistantActions.SUPPORTED_ACTIONS];

const INTENT_LABELS = {
  chat: '创作咨询',
  generate_story: '生成剧本并入库',
  rewrite_current_episode: '改写本集剧本并入库',
  continue_current_episode: '续写本集剧本并入库',
  extract_resources: '提取资源说明并入库',
  generate_resource_images: '生成资源图片并入库',
  generate_storyboards: '生成全部分镜并入库',
  generate_storyboard_images: '生成分镜图片并入库',
  generate_image: '生成单张素材图并入库',
  optimize_resource_prompt: '优化资源图片提示词并入库',
  update_storyboard_details: '补充或优化分镜说明并入库',
  optimize_storyboard_prompt: '优化分镜提示词并入库',
};

const INTENT_PLAN_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schema_version',
    'intent',
    'confidence',
    'normalized_request',
    'reason',
    'evidence',
    'alternatives',
    'requested_actions',
    'missing_inputs',
    'requires_confirmation',
    'confirmation_granted',
    'clarification_question',
    'resource_scopes',
    'resource_names',
    'storyboard_numbers',
    'prompt_fields',
    'detail_fields',
    'target_all',
    'prepare_source',
    'force_regenerate',
  ],
  properties: {
    schema_version: { type: 'string', enum: ['1.0'] },
    intent: { type: 'string', enum: SUPPORTED_INTENTS },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    normalized_request: { type: 'string' },
    reason: { type: 'string' },
    evidence: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', maxLength: 300 },
    },
    alternatives: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['intent', 'confidence'],
        properties: {
          intent: { type: 'string', enum: SUPPORTED_INTENTS },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
        },
      },
    },
    requested_actions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: { type: 'string', enum: SUPPORTED_INTENTS },
    },
    missing_inputs: {
      type: 'array',
      maxItems: 8,
      items: { type: 'string', maxLength: 100 },
    },
    requires_confirmation: { type: 'boolean' },
    confirmation_granted: { type: 'boolean' },
    clarification_question: { type: 'string', maxLength: 500 },
    resource_scopes: {
      type: 'array',
      maxItems: 3,
      items: { type: 'string', enum: ['character', 'prop', 'scene'] },
    },
    resource_names: {
      type: 'array',
      maxItems: 50,
      items: { type: 'string' },
    },
    storyboard_numbers: {
      type: 'array',
      maxItems: 50,
      items: { type: 'integer', minimum: 1, maximum: 200 },
    },
    prompt_fields: {
      type: 'array',
      maxItems: 3,
      items: {
        type: 'string',
        enum: ['image_prompt', 'polished_prompt', 'video_prompt'],
      },
    },
    detail_fields: {
      type: 'array',
      maxItems: 6,
      items: {
        type: 'string',
        enum: ['title', 'description', 'layout_description', 'action', 'result', 'atmosphere'],
      },
    },
    target_all: { type: 'boolean' },
    prepare_source: { type: 'boolean' },
    force_regenerate: { type: 'boolean' },
  },
};

function clean(value, max = 12_000) {
  return String(value || '').trim().slice(0, max);
}

function intentMessageExcerpt(value, max = 24_000) {
  const text = String(value || '').trim();
  if (text.length <= max) return text;
  const tailLength = Math.min(8_000, Math.floor(max / 3));
  const headLength = max - tailLength;
  return [
    text.slice(0, headLength),
    '【中间内容因长度省略；以下保留消息末尾明确要求】',
    text.slice(-tailLength),
  ].join('\n\n');
}

function parseMetadata(value) {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return {};
  }
}

function detectPreparation(intent, text) {
  const input = clean(text);
  if (intent === 'generate_resource_images') {
    return /(先|同时|并且|然后|再|顺便).{0,20}(提取|整理|创建|生成).{0,12}(资源|角色|人物|道具|场景)/i.test(input)
      || /(提取|整理|创建).{0,18}(资源|角色|人物|道具|场景).{0,24}(图片|图像|设定图|资源图)/i.test(input);
  }
  if (intent === 'generate_storyboard_images') {
    return /(先|同时|并且|然后|再|顺便).{0,20}(生成|制作|创建|拆解|拆分).{0,12}分镜/i.test(input)
      || /(生成|制作|创建|拆解|拆分).{0,12}分镜.{0,24}(图片|首帧|图像)/i.test(input);
  }
  return false;
}

function detectForceRegenerate(text) {
  return /重新生成|重新制作|重做|覆盖|全部重生|从头生成|替换现有/i.test(clean(text));
}

function parseChineseNumber(value) {
  const input = clean(value, 12);
  if (/^\d+$/.test(input)) return Number(input);
  const digits = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9,
  };
  if (input === '十') return 10;
  if (input.includes('十')) {
    const [left, right] = input.split('十');
    const tens = left ? digits[left] : 1;
    const ones = right ? digits[right] : 0;
    return Number.isInteger(tens) && Number.isInteger(ones)
      ? tens * 10 + ones
      : null;
  }
  return input.length === 1 && Number.isInteger(digits[input])
    ? digits[input]
    : null;
}

function extractStoryboardNumbers(text) {
  const input = clean(text);
  const numbers = new Set();
  const patterns = [
    /第\s*([0-9零〇一二两三四五六七八九十]{1,4})\s*(?:个|条|号)?\s*分镜/g,
    /第\s*([0-9零〇一二两三四五六七八九十]{1,4})\s*(?:个|条|号)?\s*镜(?:头)?/g,
    /分镜\s*[#＃]?\s*([0-9]{1,3})/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(input))) {
      const value = parseChineseNumber(match[1]);
      if (Number.isInteger(value) && value >= 1 && value <= 200) numbers.add(value);
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function detectPromptFields(text) {
  const input = clean(text);
  if (/(提示词编辑|全部提示词|所有提示词|三个提示词|整套提示词)/i.test(input)) {
    return ['image_prompt', 'polished_prompt', 'video_prompt'];
  }
  const fields = [];
  if (/(原始提示词|基础提示词|画面提示词|image[_ ]?prompt)/i.test(input)) {
    fields.push('image_prompt');
  }
  if (/(通用优化提示词|优化图生提示词|图片优化提示词|图生提示词|polished[_ ]?prompt)/i.test(input)) {
    fields.push('polished_prompt');
  }
  if (/(视频提示词|动态提示词|运镜提示词|video[_ ]?prompt)/i.test(input)) {
    fields.push('video_prompt');
  }
  if (!fields.length && /提示词/i.test(input)) fields.push('polished_prompt');
  return [...new Set(fields)];
}

function detectDetailFields(text) {
  const input = clean(text);
  const fields = [];
  if (/标题/i.test(input)) fields.push('title');
  if (/(说明|描述|画面内容)/i.test(input)) fields.push('description');
  if (/(布局|构图|站位|空间锚点)/i.test(input)) fields.push('layout_description');
  if (/动作/i.test(input)) fields.push('action');
  if (/(结果|结束状态|最终画面)/i.test(input)) fields.push('result');
  if (/(氛围|情绪)/i.test(input)) fields.push('atmosphere');
  if (!fields.length) return ['description', 'layout_description'];
  return [...new Set(fields)];
}

function detectTargetAll(text) {
  return /(全部|所有|每个|每条|整集|批量|尚未|缺失|补齐)/i.test(clean(text));
}

function needsContextualPlanning(text) {
  return /(刚才|上一张|上一个|上一次|这张|这个|那个|它们?|他们|她们|再来一张|重新来一张|重新生成一张|不满意|按刚才的)/i.test(clean(text));
}

function createLocalIntentPlan(intent, text, source = 'rule') {
  const normalizedIntent = SUPPORTED_INTENTS.includes(intent) ? intent : 'chat';
  const storyboardNumbers = extractStoryboardNumbers(text);
  const inferredAllTargets = [
    'update_storyboard_details',
    'optimize_storyboard_prompt',
  ].includes(normalizedIntent) && !storyboardNumbers.length;
  return {
    schema_version: '1.0',
    intent: normalizedIntent,
    confidence: 1,
    normalized_request: clean(text),
    reason: source === 'shortcut'
      ? '用户通过快捷操作明确指定了项目能力'
      : '本地规则已明确识别用户要求',
    evidence: [source === 'shortcut' ? '用户选择了快捷操作' : '本地语义规则匹配'],
    alternatives: [],
    requested_actions: [normalizedIntent],
    missing_inputs: [],
    requires_confirmation: false,
    confirmation_granted: false,
    clarification_question: '',
    resource_scopes: [],
    resource_names: [],
    storyboard_numbers: storyboardNumbers,
    prompt_fields: normalizedIntent === 'optimize_storyboard_prompt'
      ? detectPromptFields(text)
      : [],
    detail_fields: normalizedIntent === 'update_storyboard_details'
      ? detectDetailFields(text)
      : [],
    target_all: detectTargetAll(text) || inferredAllTargets,
    prepare_source: detectPreparation(normalizedIntent, text),
    force_regenerate: detectForceRegenerate(text),
    source,
  };
}

function parseIntentPlan(text, fallbackText = '') {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = safeParseAIJSON(text, {}, null);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI 助手未返回有效的意图规划结果');
  }
  const intent = SUPPORTED_INTENTS.includes(parsed.intent) ? parsed.intent : 'chat';
  const confidence = Math.max(0, Math.min(1, Number(parsed.confidence) || 0));
  const resourceScopes = [...new Set(
    (Array.isArray(parsed.resource_scopes) ? parsed.resource_scopes : [])
      .filter((scope) => ['character', 'prop', 'scene'].includes(scope))
  )];
  const resourceNames = [...new Set(
    (Array.isArray(parsed.resource_names) ? parsed.resource_names : [])
      .map((value) => clean(value, 100))
      .filter(Boolean)
  )];
  const storyboardNumbers = [...new Set(
    (Array.isArray(parsed.storyboard_numbers) ? parsed.storyboard_numbers : [])
      .map(Number)
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 200)
  )];
  const promptFields = [...new Set(
    (Array.isArray(parsed.prompt_fields) ? parsed.prompt_fields : [])
      .filter((field) => ['image_prompt', 'polished_prompt', 'video_prompt'].includes(field))
  )];
  const detailFields = [...new Set(
    (Array.isArray(parsed.detail_fields) ? parsed.detail_fields : [])
      .filter((field) => [
        'title',
        'description',
        'layout_description',
        'action',
        'result',
        'atmosphere',
      ].includes(field))
  )];
  const evidence = (Array.isArray(parsed.evidence) ? parsed.evidence : [])
    .map((value) => clean(value, 300))
    .filter(Boolean)
    .slice(0, 8);
  const alternatives = (Array.isArray(parsed.alternatives) ? parsed.alternatives : [])
    .map((item) => ({
      intent: SUPPORTED_INTENTS.includes(item?.intent) ? item.intent : 'chat',
      confidence: Math.max(0, Math.min(1, Number(item?.confidence) || 0)),
    }))
    .filter((item) => item.intent !== intent)
    .slice(0, 3);
  const missingInputs = [...new Set(
    (Array.isArray(parsed.missing_inputs) ? parsed.missing_inputs : [])
      .map((value) => clean(value, 100))
      .filter(Boolean)
  )];
  const safeIntent = intent === 'chat' || confidence >= 0.65 ? intent : 'chat';
  const requestedActions = [...new Set(
    (Array.isArray(parsed.requested_actions) ? parsed.requested_actions : [])
      .filter((action) => SUPPORTED_INTENTS.includes(action) && action !== 'chat')
  )];
  if (safeIntent === 'chat') {
    requestedActions.length = 0;
    requestedActions.push('chat');
  } else {
    const primaryIndex = requestedActions.indexOf(safeIntent);
    if (primaryIndex >= 0) requestedActions.splice(primaryIndex, 1);
    requestedActions.push(safeIntent);
  }
  return {
    schema_version: '1.0',
    intent: safeIntent,
    confidence,
    normalized_request: clean(parsed.normalized_request || fallbackText),
    reason: clean(parsed.reason, 500),
    evidence,
    alternatives,
    requested_actions: requestedActions,
    missing_inputs: missingInputs,
    requires_confirmation: safeIntent === 'chat' ? false : !!parsed.requires_confirmation,
    confirmation_granted: safeIntent === 'chat' ? false : !!parsed.confirmation_granted,
    clarification_question: clean(parsed.clarification_question, 500),
    resource_scopes: resourceScopes,
    resource_names: resourceNames,
    storyboard_numbers: storyboardNumbers.length
      ? storyboardNumbers
      : extractStoryboardNumbers(parsed.normalized_request || fallbackText),
    prompt_fields: promptFields.length
      ? promptFields
      : (intent === 'optimize_storyboard_prompt'
        ? detectPromptFields(parsed.normalized_request || fallbackText)
        : []),
    detail_fields: detailFields.length
      ? detailFields
      : (intent === 'update_storyboard_details'
        ? detectDetailFields(parsed.normalized_request || fallbackText)
        : []),
    target_all: !!parsed.target_all,
    prepare_source: !!parsed.prepare_source,
    force_regenerate: !!parsed.force_regenerate,
    source: 'assistant_planner',
  };
}

function countRows(db, sql, ...params) {
  try {
    return Number(db.prepare(sql).get(...params)?.count || 0);
  } catch (_) {
    return 0;
  }
}

function buildIntentPlanningPrompt(db, session, episode, content, options = {}) {
  const drama = db.prepare(
    'SELECT id, title, description, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(session.drama_id));
  const metadata = parseMetadata(drama?.metadata);
  const recentMessages = db.prepare(
    `SELECT role, content, action_type
       FROM codex_chat_messages
      WHERE session_id = ? AND status = 'completed' AND deleted_at IS NULL
      ORDER BY created_at DESC, id DESC
      LIMIT 8`
  ).all(String(session.id))
    .reverse()
    .map((item) => `${item.role === 'user' ? '用户' : '助手'}${item.action_type ? `(${item.action_type})` : ''}：${clean(item.content, 800)}`)
    .join('\n');
  const episodeId = Number(episode?.id);
  const projectState = {
    episodes: countRows(
      db,
      'SELECT COUNT(*) AS count FROM episodes WHERE drama_id = ? AND deleted_at IS NULL',
      Number(session.drama_id)
    ),
    characters: countRows(
      db,
      'SELECT COUNT(*) AS count FROM characters WHERE drama_id = ? AND deleted_at IS NULL',
      Number(session.drama_id)
    ),
    props: countRows(
      db,
      'SELECT COUNT(*) AS count FROM props WHERE drama_id = ? AND deleted_at IS NULL',
      Number(session.drama_id)
    ),
    scenes: countRows(
      db,
      'SELECT COUNT(*) AS count FROM scenes WHERE drama_id = ? AND deleted_at IS NULL',
      Number(session.drama_id)
    ),
    storyboards: episodeId
      ? countRows(
        db,
        'SELECT COUNT(*) AS count FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL',
        episodeId
      )
      : 0,
  };

  const promptOptions = {
    dramaId: session.drama_id,
    taskId: options.taskId,
  };
  const resolvedPrompts = promptTemplates.resolvePrompts(db, [
    'assistant.intent.system',
    'assistant.intent.user',
  ], {
    ...promptOptions,
    variablesByKey: {
      'assistant.intent.user': {
          project_context: JSON.stringify({
            project_id: Number(session.drama_id),
            project_title: drama?.title || '',
            project_description: clean(drama?.description, 1200),
            aspect_ratio: metadata.aspect_ratio || '',
            current_episode: episode
              ? {
                id: Number(episode.id),
                number: Number(episode.episode_number),
                title: episode.title || '',
                has_script: !!String(episode.script_content || '').trim(),
              }
              : null,
            project_state: projectState,
          }),
          recent_messages: recentMessages || '无',
          routing_evidence: JSON.stringify({
            shortcut_hint: options.intentHint || '',
            local_rule_intent: options.ruleIntent || 'chat',
            rule_note: '这些字段只是证据；本轮消息中的明确自然语言要求优先级最高。',
          }),
          user_message: intentMessageExcerpt(content),
      },
    },
  });
  return [
    '【Jama 意图识别系统规则】',
    resolvedPrompts.get('assistant.intent.system').content,
    '【Jama 意图识别输入】',
    resolvedPrompts.get('assistant.intent.user').content,
  ].join('\n\n');
}

function contentTypeForIntent(intent) {
  if (['generate_image', 'generate_resource_images', 'generate_storyboard_images'].includes(intent)) {
    return 'image';
  }
  if (['extract_resources', 'optimize_resource_prompt'].includes(intent)) return 'resources';
  if (['generate_storyboards', 'update_storyboard_details', 'optimize_storyboard_prompt'].includes(intent)) {
    return 'storyboards';
  }
  if (['generate_story', 'rewrite_current_episode', 'continue_current_episode'].includes(intent)) {
    return 'script';
  }
  return 'text';
}

function intentLabel(intent) {
  return INTENT_LABELS[intent] || INTENT_LABELS.chat;
}

module.exports = {
  SUPPORTED_INTENTS,
  INTENT_LABELS,
  INTENT_PLAN_SCHEMA,
  buildIntentPlanningPrompt,
  contentTypeForIntent,
  createLocalIntentPlan,
  detectDetailFields,
  detectForceRegenerate,
  detectPromptFields,
  detectPreparation,
  detectTargetAll,
  extractStoryboardNumbers,
  intentLabel,
  needsContextualPlanning,
  parseIntentPlan,
};

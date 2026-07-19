const promptI18n = require('./promptI18n');
const { EXTRACT_PROMPTS } = require('./aiClient');

const SENTINELS = {
  style: '__PROMPT_STYLE__',
  styleZh: '__PROMPT_STYLE_ZH__',
  styleEn: '__PROMPT_STYLE_EN__',
  imageRatio: '__IMAGE_RATIO__',
  videoRatio: '__VIDEO_RATIO__',
  episodeCount: '987',
  shotDuration: '986',
};

function seedCfg(locale) {
  return {
    app: { language: locale },
    style: {
      default_style: SENTINELS.style,
      default_style_zh: SENTINELS.styleZh,
      default_style_en: SENTINELS.styleEn,
      default_role_style: '{{role_style}}',
      default_scene_style: '{{scene_style}}',
      default_prop_style: '{{prop_style}}',
      default_image_ratio: SENTINELS.imageRatio,
      default_video_ratio: SENTINELS.videoRatio,
    },
  };
}

function placeholders(value) {
  return String(value || '')
    .replaceAll(SENTINELS.styleZh, '{{style_prompt_zh}}')
    .replaceAll(SENTINELS.styleEn, '{{style_prompt_en}}')
    .replaceAll(SENTINELS.style, '{{style_prompt}}')
    .replaceAll(SENTINELS.imageRatio, '{{image_ratio}}')
    .replaceAll(SENTINELS.videoRatio, '{{video_ratio}}')
    .replaceAll(SENTINELS.episodeCount, '{{episode_count}}')
    .replaceAll(SENTINELS.shotDuration, '{{shot_duration}}')
    .replaceAll('${n}', '{{episode_count}}');
}

function variableSchema(names = [], required = []) {
  return {
    variables: names.map((name) => ({
      name,
      required: required.includes(name),
      description: name.replaceAll('_', ' '),
      example: `[${name}]`,
    })),
  };
}

function definition({
  key,
  name,
  category,
  role,
  sceneKey = null,
  contents,
  variables = [],
  required = [],
  risk = 'normal',
  project = true,
  description = '',
  source = '',
  seedVersion = 1,
}) {
  return {
    prompt_key: key,
    name,
    description,
    category,
    message_role: role,
    service_type: role === 'image_prompt' ? 'image' : role === 'video_prompt' ? 'video' : 'text',
    scene_key: sceneKey,
    variable_schema: variableSchema(variables, required),
    risk_level: risk,
    allow_project_override: project ? 1 : 0,
    source_ref: source,
    contents: Object.entries(contents).map(([locale, content]) => ({
      locale,
      content: placeholders(content),
      seed_version: seedVersion,
    })),
  };
}

function bilingual(getter, ...args) {
  return {
    zh: getter(seedCfg('zh'), ...args),
    en: getter(seedCfg('en'), ...args),
  };
}

function universal(content) {
  return { universal: content };
}

function buildCatalog() {
  const zh = seedCfg('zh');
  const en = seedCfg('en');
  const defs = [];
  let order = 0;
  const add = (d) => {
    d.sort_order = ++order;
    defs.push(d);
  };

  add(definition({
    key: 'story.generation.system',
    name: '故事生成系统提示词',
    category: '故事与小说',
    role: 'system',
    sceneKey: 'story_generation',
    contents: {
      zh: promptI18n.getStoryExpansionSystemPrompt(zh, Number(SENTINELS.episodeCount)),
      en: promptI18n.getStoryExpansionSystemPrompt(en, Number(SENTINELS.episodeCount)),
    },
    variables: ['episode_count'],
    required: ['episode_count'],
    risk: 'high',
    source: 'promptI18n.getStoryExpansionSystemPrompt',
  }));
  add(definition({
    key: 'story.generation.user',
    name: '故事生成用户模板',
    category: '故事与小说',
    role: 'user_template',
    sceneKey: 'story_generation',
    contents: {
      zh: '请根据以下故事梗概，创作 {{episode_count}} 集短片剧本：\n\n{{story_premise}}\n\n故事风格：{{story_style}}\n剧本类型：{{story_type}}\n生成集数：{{episode_count}} 集',
      en: 'Create {{episode_count}} episode(s) of a short-film script from this premise:\n\n{{story_premise}}\n\nStyle: {{story_style}}\nGenre: {{story_type}}\nEpisodes: {{episode_count}}',
    },
    variables: ['episode_count', 'story_premise', 'story_style', 'story_type'],
    required: ['episode_count', 'story_premise'],
    source: 'promptI18n.buildStoryExpansionUserPrompt',
  }));
  add(definition({
    key: 'novel.import.user',
    name: '小说章节短剧化改写',
    category: '故事与小说',
    role: 'user_template',
    sceneKey: 'novel_import',
    contents: {
      zh: '小说名称：{{drama_title}}\n章节标题：{{chapter_title}}\n\n章节原文（部分）：\n{{chapter_content}}\n\n请将上述章节内容改写为短剧剧本格式，包含：场景描述、角色对话、动作说明。输出为中文纯文本，不需要 JSON 格式，长度200-500字。',
      en: 'Novel: {{drama_title}}\nChapter: {{chapter_title}}\n\nSource excerpt:\n{{chapter_content}}\n\nRewrite this chapter as a short-drama script with scene description, dialogue and action. Return plain text, 200-500 words.',
    },
    variables: ['drama_title', 'chapter_title', 'chapter_content'],
    required: ['chapter_content'],
    source: 'novelImportService.summarizeChapterToScript',
  }));

  add(definition({
    key: 'character.extraction.system',
    name: '剧本角色提取规则',
    category: '角色/场景/道具提取',
    role: 'system',
    sceneKey: 'role_extraction',
    contents: bilingual(promptI18n.getCharacterExtractionPrompt),
    variables: ['style_prompt', 'style_prompt_zh', 'style_prompt_en', 'image_ratio', 'role_style'],
    risk: 'high',
    source: 'promptI18n.getCharacterExtractionPrompt',
  }));
  add(definition({
    key: 'character.extraction.user',
    name: '剧本角色提取输入模板',
    category: '角色/场景/道具提取',
    role: 'user_template',
    sceneKey: 'role_extraction',
    contents: {
      zh: promptI18n.formatUserPrompt(zh, 'character_request', '{{script_content}}'),
      en: promptI18n.formatUserPrompt(en, 'character_request', '{{script_content}}'),
    },
    variables: ['script_content'],
    required: ['script_content'],
    source: 'promptI18n.formatUserPrompt(character_request)',
  }));
  add(definition({
    key: 'character.extraction.drama_info',
    name: '角色提取项目资料输入模板',
    category: '角色/场景/道具提取',
    role: 'user_template',
    sceneKey: 'role_extraction',
    contents: {
      zh: '剧名：{{drama_title}}\n简介：{{drama_description}}\n类型：{{drama_genre}}\n风格：{{style_prompt}}\n图片比例：{{image_ratio}}',
      en: 'Title: {{drama_title}}\nSummary: {{drama_description}}\nGenre: {{drama_genre}}\nStyle: {{style_prompt}}\nImage ratio: {{image_ratio}}',
    },
    variables: ['drama_title', 'drama_description', 'drama_genre', 'style_prompt', 'image_ratio'],
    required: ['drama_title'],
    source: 'characterGenerationService project context',
  }));
  add(definition({
    key: 'scene.extraction.system',
    name: '剧本场景提取规则',
    category: '角色/场景/道具提取',
    role: 'system',
    sceneKey: 'scene_extraction',
    contents: {
      zh: promptI18n.getSceneExtractionPrompt(zh, SENTINELS.style),
      en: promptI18n.getSceneExtractionPrompt(en, SENTINELS.style),
    },
    variables: ['style_prompt', 'image_ratio', 'scene_style'],
    risk: 'high',
    source: 'promptI18n.getSceneExtractionPrompt',
  }));
  add(definition({
    key: 'scene.extraction.user',
    name: '剧本场景提取输入模板',
    category: '角色/场景/道具提取',
    role: 'user_template',
    sceneKey: 'scene_extraction',
    contents: {
      zh: '【剧本内容】\n{{script_content}}',
      en: '[Script Content]\n{{script_content}}',
    },
    variables: ['script_content'],
    required: ['script_content'],
    source: 'backgroundExtractionService.extractBackgrounds',
  }));
  add(definition({
    key: 'prop.extraction.system',
    name: '剧本道具提取规则',
    category: '角色/场景/道具提取',
    role: 'system',
    sceneKey: 'prop_extraction',
    contents: bilingual(promptI18n.getPropExtractionPrompt),
    variables: ['style_prompt', 'style_prompt_zh', 'style_prompt_en', 'image_ratio', 'prop_style'],
    risk: 'high',
    source: 'promptI18n.getPropExtractionPrompt',
  }));
  add(definition({
    key: 'prop.extraction.user',
    name: '剧本道具提取输入模板',
    category: '角色/场景/道具提取',
    role: 'user_template',
    sceneKey: 'prop_extraction',
    contents: {
      zh: '【剧本内容】\n{{script_content}}',
      en: '[Script Content]\n{{script_content}}',
    },
    variables: ['script_content'],
    required: ['script_content'],
    source: 'propExtractionService.extractProps',
  }));

  const visionEntries = [
    ['character', '角色', 'vision_character_extract'],
    ['scene', '场景', 'vision_scene_extract'],
    ['prop', '道具', 'vision_prop_extract'],
  ];
  for (const [kind, label, sceneKey] of visionEntries) {
    add(definition({
      key: `vision.${kind}.extract.system`,
      name: `从参考图提取${label}描述`,
      category: '参考图视觉识别',
      role: 'system',
      sceneKey,
      contents: universal(EXTRACT_PROMPTS[kind].system),
      source: `aiClient.EXTRACT_PROMPTS.${kind}.system`,
    }));
    add(definition({
      key: `vision.${kind}.extract.user`,
      name: `${label}参考图输入模板`,
      category: '参考图视觉识别',
      role: 'user_template',
      sceneKey,
      contents: universal(EXTRACT_PROMPTS[kind].user('{{entity_name}}')),
      variables: ['entity_name'],
      source: `aiClient.EXTRACT_PROMPTS.${kind}.user`,
    }));
  }
  add(definition({
    key: 'character.identity_anchors.system',
    name: '角色视觉锚点提炼',
    category: '参考图视觉识别',
    role: 'system',
    sceneKey: 'identity_anchors',
    contents: universal(promptI18n.getIdentityAnchorsPrompt()),
    risk: 'high',
    source: 'promptI18n.getIdentityAnchorsPrompt',
  }));
  add(definition({
    key: 'character.identity_anchors.user',
    name: '角色视觉锚点输入模板',
    category: '参考图视觉识别',
    role: 'user_template',
    sceneKey: 'identity_anchors',
    contents: universal('Character appearance description:\n{{character_appearance}}'),
    variables: ['character_appearance'],
    required: ['character_appearance'],
    source: 'characterGenerationService.enrichIdentityAnchors',
  }));

  add(definition({
    key: 'storyboard.generation.system',
    name: '分镜生成系统规则',
    category: '分镜生成',
    role: 'system',
    sceneKey: 'storyboard_extraction',
    contents: bilingual(promptI18n.getStoryboardSystemPrompt),
    risk: 'high',
    source: 'promptI18n.getStoryboardSystemPrompt',
  }));
  add(definition({
    key: 'storyboard.generation.user',
    name: '分镜生成用户模板',
    category: '分镜生成',
    role: 'user_template',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: `【本剧可用角色列表】
{{characters}}

**重要** — characters字段填写规则：
1. 只能使用上述角色列表中的角色ID（数字），不得自创ID。
2. 只填写在本镜头中实际出现并有具体行为的角色，不要填写仅被提到或画面外的角色。
3. characters数量必须与action/dialogue中实际描写的人物数量一致。

【本剧已提取的场景背景列表】
{{scenes}}

**重要**：scene_id 必须从上述背景列表选择最匹配的数字ID；没有合适背景时填 null。

【本集可用道具列表】
{{props}}

**重要** — props字段填写规则：
1. 只能使用上述道具列表中的数字ID，不得自创ID。
2. 只填写本镜头中视觉上出现并被使用或显著展示的道具。
3. 没有道具时填空数组 []。

【剧本内容】
{{script_content}}

【任务】
将剧本按独立动作单元拆解为分镜头方案。
{{extra_constraints}}`,
      en: `[Available Characters]
{{characters}}

**Important — characters field**
1. Use only numeric IDs from the list above; never invent IDs.
2. Include only characters physically present and acting in this shot, not merely mentioned or offscreen.
3. The list must match the people actually described by action/dialogue.

[Extracted Scene Backgrounds]
{{scenes}}

**Important**: scene_id must be the best matching numeric ID above, or null when none fits.

[Available Props]
{{props}}

**Important — props field**
1. Use only numeric IDs from the list above; never invent IDs.
2. Include only props visibly present and actively used or prominently featured in this shot.
3. Use [] when no listed prop appears.

[Script]
{{script_content}}

[Task]
Break the script into storyboard shots by independent action units.
{{extra_constraints}}`,
    },
    variables: ['characters', 'scenes', 'props', 'script_content', 'extra_constraints'],
    required: ['script_content'],
    source: 'episodeStoryboardService.generateEpisodeStoryboards',
    seedVersion: 2,
  }));
  add(definition({
    key: 'storyboard.generation.requirements',
    name: '分镜要素要求',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: promptI18n.getStoryboardUserPromptSuffix(zh, Number(SENTINELS.shotDuration)),
      en: promptI18n.getStoryboardUserPromptSuffix(en, Number(SENTINELS.shotDuration)),
    },
    variables: ['shot_duration', 'style_prompt', 'style_prompt_zh', 'style_prompt_en', 'image_ratio'],
    risk: 'high',
    source: 'promptI18n.getStoryboardUserPromptSuffix',
  }));
  add(definition({
    key: 'storyboard.generation.output_contract',
    name: '分镜 JSON 输出协议',
    category: '分镜生成',
    role: 'format_contract',
    sceneKey: 'storyboard_extraction',
    contents: universal('返回合法 JSON，包含 storyboards 数组；字段必须符合当前分镜数据协议。不要输出 markdown 或解释文字。'),
    risk: 'high',
    source: 'promptI18n.getStoryboardUserPromptSuffix output contract',
  }));
  add(definition({
    key: 'storyboard.generation.continuation',
    name: '分镜截断续写模板',
    category: '分镜生成',
    role: 'user_template',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: `[续写指令 - 第{{attempt}}次续写]
之前的分镜生成因长度限制在 shot_number {{last_shot_number}} 处中断，已生成 {{generated_count}} 个分镜。

━━━ 已生成分镜完整列表（绝对不能重复以下内容）━━━
{{generated_summary}}
━━━ 列表结束 ━━━

以上所有情节均已覆盖，请勿重复。末尾几个分镜详情供衔接参考：
[
{{last_storyboards_context}}
]

请从 shot_number {{next_shot_number}} 继续生成剩余分镜，直至剧本全部场景覆盖完毕。
要求：
- 仅返回新增分镜（JSON数组），shot_number 从 {{next_shot_number}} 开始递增
- 格式与之前完全相同，字段保持一致
{{narration_requirement}}
{{universal_requirement}}
- 严禁重复已生成列表中的任何情节或场景
- 不要输出任何解释文字，直接输出 JSON

原始剧本与任务说明：
{{original_user_prompt}}`,
      en: `[Continuation request — attempt {{attempt}}]
The previous response was truncated after shot_number {{last_shot_number}}; {{generated_count}} shots were recovered.

=== Complete list of generated shots — do not repeat ===
{{generated_summary}}
=== End of list ===

The following final recovered shots provide continuity context:
[
{{last_storyboards_context}}
]

Continue from shot_number {{next_shot_number}} until the complete script is covered.
Requirements:
- Return only new shots as a JSON array, starting at shot_number {{next_shot_number}}
- Preserve exactly the same fields and schema
{{narration_requirement}}
{{universal_requirement}}
- Never repeat any plot beat or scene listed above
- Return JSON only, without explanation

Original script and task:
{{original_user_prompt}}`,
    },
    variables: [
      'attempt', 'last_shot_number', 'generated_count', 'generated_summary',
      'last_storyboards_context', 'next_shot_number', 'narration_requirement',
      'universal_requirement', 'original_user_prompt',
    ],
    required: [
      'attempt', 'last_shot_number', 'generated_count', 'generated_summary',
      'next_shot_number', 'original_user_prompt',
    ],
    risk: 'high',
    source: 'episodeStoryboardService.buildContinuationPrompt',
    seedVersion: 2,
  }));
  add(definition({
    key: 'storyboard.generation.continuation_narration',
    name: '分镜续写旁白约束',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: '- 每条新增分镜必须含非空字符串 narration（至少一句解说，与首次任务一致；禁止留空）',
      en: '- Every new shot must contain a non-empty narration string with at least one complete sentence.',
    },
    source: 'episodeStoryboardService continuation narration branch',
  }));
  add(definition({
    key: 'storyboard.generation.continuation_universal',
    name: '分镜续写全能模式约束',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: '- 每条新增分镜必须含 creation_mode:"universal" 与非空 universal_segment_text；须写叙事动态时间线和至少两步运镜链，按 duration 秒体现视频动势，禁止静帧式描写。',
      en: '- Every new shot must contain creation_mode:"universal" and a non-empty universal_segment_text with a time-based narrative and at least two camera-motion stages across its duration.',
    },
    source: 'episodeStoryboardService continuation universal branch',
  }));
  add(definition({
    key: 'storyboard.generation.narration',
    name: '分镜旁白附加规则',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: promptI18n.getStoryboardNarrationExtraInstructions(zh),
      en: promptI18n.getStoryboardNarrationExtraInstructions(en),
    },
    risk: 'high',
    source: 'promptI18n.getStoryboardNarrationExtraInstructions',
  }));
  add(definition({
    key: 'storyboard.generation.universal_mode',
    name: '全能模式分镜附加规则',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: promptI18n.getStoryboardUniversalOmniModeSuffix(zh),
      en: promptI18n.getStoryboardUniversalOmniModeSuffix(en),
    },
    risk: 'high',
    source: 'promptI18n.getStoryboardUniversalOmniModeSuffix',
  }));
  add(definition({
    key: 'storyboard.generation.count_constraint',
    name: '分镜数量约束模板',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: `【最高优先级——用户指定分镜数量】
用户要求生成恰好 {{storyboard_count}} 个分镜（允许 ±10% 的偏差，即 {{min_storyboard_count}}～{{max_storyboard_count}} 个）。
此要求优先级高于“一动作一镜头、禁止合并”等默认原则。
- 自然拆分超过目标时，合并相关联的连续小动作
- 自然拆分不足目标时，拆分重要场景或情绪转折
- 严禁生成与 {{storyboard_count}} 相差悬殊的数量`,
      en: `[HIGHEST PRIORITY — USER SPECIFIED COUNT]
Generate exactly {{storyboard_count}} shots (acceptable range: {{min_storyboard_count}}–{{max_storyboard_count}}, ±10%).
This overrides default rules such as one action per shot and no merging.
- Merge related consecutive actions when the natural count is too high.
- Split important scenes or emotional turns when the natural count is too low.
- Never return a count far from {{storyboard_count}}.`,
    },
    variables: ['storyboard_count', 'min_storyboard_count', 'max_storyboard_count'],
    required: ['storyboard_count', 'min_storyboard_count', 'max_storyboard_count'],
    risk: 'high',
    source: 'promptI18n.formatUserPrompt(storyboard_count_constraint)',
    seedVersion: 2,
  }));
  add(definition({
    key: 'storyboard.generation.duration_constraint',
    name: '视频总时长约束模板',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: '**重要约束**：视频总时长必须控制在 {{video_duration}} 秒左右（允许 ±10%）。',
      en: '**Constraint**: Total video duration must be around {{video_duration}} seconds (±10%).',
    },
    variables: ['video_duration'],
    required: ['video_duration'],
    source: 'promptI18n.formatUserPrompt(video_duration_constraint)',
  }));
  add(definition({
    key: 'storyboard.generation.project_clip_duration_constraint',
    name: '项目分段时长优先约束',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: '每个镜头的 duration 优先按项目“每段约 {{video_clip_duration}} 秒”填写（可 ±1 秒微调）。总时长 {{video_duration}} 秒、镜头数 {{storyboard_count}} 为整体规划参考；禁止机械采用总时长÷镜数的 {{implied_duration}} 秒而普遍压短镜头。',
      en: 'Set each shot duration primarily from the project clip-length setting of about {{video_clip_duration}}s (±1s). Total {{video_duration}}s and {{storyboard_count}} shots are planning hints; do not mechanically force every shot to the implied {{implied_duration}}s.',
    },
    variables: ['video_clip_duration', 'video_duration', 'storyboard_count', 'implied_duration'],
    required: ['video_clip_duration', 'video_duration', 'storyboard_count', 'implied_duration'],
    source: 'episodeStoryboardService project clip duration branch',
  }));
  add(definition({
    key: 'storyboard.generation.calculated_shot_duration_constraint',
    name: '计算所得单镜时长约束',
    category: '分镜生成',
    role: 'suffix',
    sceneKey: 'storyboard_extraction',
    contents: {
      zh: '每镜头目标时长约 {{shot_duration}} 秒（总时长 {{video_duration}} 秒 ÷ {{storyboard_count}} 个镜头）。每个镜头的 duration 字段按此值填写，可根据对白或动作长短微调 ±1 秒。',
      en: 'Target about {{shot_duration}}s per shot ({{video_duration}}s total ÷ {{storyboard_count}} shots). Set each duration accordingly, adjusting ±1s for dialogue or action length.',
    },
    variables: ['shot_duration', 'video_duration', 'storyboard_count'],
    required: ['shot_duration', 'video_duration', 'storyboard_count'],
    source: 'episodeStoryboardService calculated shot duration branch',
  }));

  const frameDefs = [
    ['first', '首帧', promptI18n.getFirstFramePrompt],
    ['key', '关键帧', promptI18n.getKeyFramePrompt],
    ['last', '尾帧', promptI18n.getLastFramePrompt],
  ];
  for (const [kind, label, getter] of frameDefs) {
    add(definition({
      key: `frame.${kind}.system`,
      name: `${label}提示词生成规则`,
      category: '分镜帧与布局',
      role: 'system',
      sceneKey: 'frame_prompt',
      contents: bilingual(getter),
      variables: ['style_prompt', 'style_prompt_zh', 'style_prompt_en', 'image_ratio'],
      risk: 'high',
      source: `promptI18n.${getter.name}`,
    }));
    add(definition({
      key: `frame.${kind}.user`,
      name: `${label}上下文输入模板`,
      category: '分镜帧与布局',
      role: 'user_template',
      sceneKey: 'frame_prompt',
      contents: {
        zh: `镜头信息：
{{frame_context}}

请直接生成${label}的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：`,
        en: `Shot information:
{{frame_context}}

Generate the image prompt for the ${kind === 'first' ? 'first frame' : kind === 'key' ? 'key frame' : 'last frame'} directly, without explanation:`,
      },
      variables: ['frame_context'],
      required: ['frame_context'],
      source: 'framePromptService.generateSingleFrame',
      seedVersion: 2,
    }));
  }
  add(definition({
    key: 'frame.output_contract',
    name: '帧提示词 JSON 输出协议',
    category: '分镜帧与布局',
    role: 'format_contract',
    sceneKey: 'frame_prompt',
    contents: universal('返回 JSON 对象，包含 prompt 和 description；不要输出 markdown 或额外解释。'),
    risk: 'high',
    source: 'promptI18n frame output contract',
  }));
  add(definition({
    key: 'frame.context.compose',
    name: '分镜帧上下文拼装模板',
    category: '分镜帧与布局',
    role: 'user_template',
    sceneKey: 'frame_prompt',
    contents: {
      zh: `{{spatial_contract}}
{{style_contract}}
{{character_roster_contract}}
{{character_anchor_contract}}
镜头描述：{{shot_description}}
场景：{{scene_location}}，{{scene_time}}
动作：{{action}}
结果：{{result}}
对白：{{dialogue}}
氛围：{{atmosphere}}
景别：{{shot_type}}
相机角度：{{angle}}
运镜：{{movement}}`,
      en: `{{spatial_contract}}
{{style_contract}}
{{character_roster_contract}}
{{character_anchor_contract}}
Shot description: {{shot_description}}
Scene: {{scene_location}}, {{scene_time}}
Action: {{action}}
Result: {{result}}
Dialogue: {{dialogue}}
Atmosphere: {{atmosphere}}
Shot type: {{shot_type}}
Camera angle: {{angle}}
Movement: {{movement}}`,
    },
    variables: [
      'spatial_contract', 'style_contract', 'character_roster_contract',
      'character_anchor_contract', 'shot_description', 'scene_location', 'scene_time',
      'action', 'result', 'dialogue', 'atmosphere', 'shot_type', 'angle', 'movement',
    ],
    source: 'framePromptService.buildStoryboardContext',
  }));
  add(definition({
    key: 'frame.context.style',
    name: '分镜帧画风约束',
    category: '分镜帧与布局',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: {
      zh: '【画风·最高优先级】{{style_prompt}}',
      en: 'MANDATORY ART STYLE: {{style_prompt}}',
    },
    variables: ['style_prompt'],
    required: ['style_prompt'],
    source: 'framePromptService style context',
  }));
  add(definition({
    key: 'frame.context.character_roster',
    name: '分镜帧允许出场角色约束',
    category: '分镜帧与布局',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: {
      zh: '【本分镜允许出场的角色（仅此名单，严禁出现名单外的任何其他人物）】\n{{allowed_characters}}',
      en: '【ALLOWED CHARACTERS IN THIS SHOT — ONLY these may appear; NO other people】\n{{allowed_characters}}',
    },
    variables: ['allowed_characters'],
    required: ['allowed_characters'],
    source: 'framePromptService character roster',
  }));
  add(definition({
    key: 'frame.context.character_anchors',
    name: '分镜帧角色视觉锚点约束',
    category: '分镜帧与布局',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: {
      zh: '【角色视觉锚点 - 最高优先级铁律，必须严格遵守，禁止脑补未提供的外貌细节】\n{{character_anchors}}',
      en: '【CHARACTER VISUAL ANCHORS — MUST USE EXACTLY; DO NOT HALLUCINATE】\n{{character_anchors}}',
    },
    variables: ['character_anchors'],
    required: ['character_anchors'],
    source: 'framePromptService character anchors',
  }));
  add(definition({
    key: 'frame.context.spatial_contract',
    name: '分镜帧空间布局合同',
    category: '分镜帧与布局',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: {
      zh: `【空间布局合同 — 最高优先级铁律 + 运镜呼吸空间】
{{layout_description}}

【核心锁定】
- 主要角色基本站位、朝向及与主要道具的相对空间关系必须一致。
- 所有主要道具保持符合剧本时代背景的真实物理尺寸、相对比例和透视。
- 主角保持视觉焦点，道具只作为次要环境元素。

【允许且推荐的电影化演化】
- 尾帧须根据 movement 和视频时长产生可见、累计的取景变化，不得只做微小调整。
- 缓推可使尾帧人物占比明显增加；手持/跟拍允许自然漂移；横摇/环绕可产生合理的侧边进出画。
- 不得左右互换角色、改变道具真实尺度或破坏基本空间关系。
- 首尾帧必须属于同一连续物理场景，同时呈现足够视觉进展以支撑视频运动。

违背核心锁定或演化不足导致运镜失效，均视为失败。`,
      en: `【SPATIAL LAYOUT CONTRACT — HIGHEST PRIORITY + CINEMATIC ROOM FOR MOVEMENT】
{{layout_description}}

【HARD LOCK】
- Preserve each main character's basic placement, facing direction and relationship to key props.
- Keep realistic physical scale, relative proportions and perspective for all major props, consistent with the story era.
- Keep the character as the focal point and props as secondary environmental elements.

【ALLOWED AND ENCOURAGED CINEMATIC EVOLUTION】
- The last frame must show visible cumulative framing evolution driven by movement and clip duration, not tiny adjustments.
- A push-in may make the subject noticeably larger; handheld/tracking may drift naturally; pan/orbit may create reasonable side entry or exit.
- Never swap left/right positions, distort prop scale, or break core spatial relationships.
- First and last frames must read as one continuous physical scene while showing enough progression to support motion.

Breaking the hard lock or suppressing the declared movement is a failure.`,
    },
    variables: ['layout_description'],
    required: ['layout_description'],
    risk: 'high',
    source: 'framePromptService layout contract',
  }));
  for (const [kind, label] of [['first', '首帧'], ['key', '关键帧'], ['last', '尾帧']]) {
    add(definition({
      key: `frame.${kind}.fallback`,
      name: `${label}生成失败回退提示词`,
      category: '分镜帧与布局',
      role: 'image_prompt',
      sceneKey: 'frame_prompt',
      contents: {
        zh: `{{scene_context}}，{{style_prompt}}，${kind === 'first' ? '首帧静止画面，动作发生前的初始状态' : kind === 'key' ? '关键帧，动作高潮瞬间' : '尾帧静止画面，动作完成后的最终状态'}`,
        en: `{{scene_context}}, {{style_prompt}}, ${kind === 'first' ? 'first frame, static state before the action' : kind === 'key' ? 'key frame at the action climax' : 'last frame, final state after the action'}`,
      },
      variables: ['scene_context', 'style_prompt'],
      source: 'framePromptService.buildFallbackPrompt',
    }));
  }
  add(definition({
    key: 'storyboard.layout.regenerate.system',
    name: '画面布局重生成规则',
    category: '分镜帧与布局',
    role: 'system',
    sceneKey: 'layout_regenerate',
    contents: bilingual(promptI18n.getRegenerateLayoutDescriptionPrompt),
    risk: 'high',
    source: 'promptI18n.getRegenerateLayoutDescriptionPrompt',
  }));
  add(definition({
    key: 'storyboard.layout.regenerate.user',
    name: '画面布局重生成输入模板',
    category: '分镜帧与布局',
    role: 'user_template',
    sceneKey: 'layout_regenerate',
    contents: {
      zh: `当前分镜 #{{storyboard_number}}
动作：{{action}}
结果：{{result}}
对白：{{dialogue}}
景别：{{shot_type}}
角色：{{characters}}
上一分镜布局：{{previous_layout}}
下一分镜布局：{{next_layout}}

请严格按照系统提示要求，只输出优化后的 layout_description 文本。`,
      en: `CURRENT SHOT #{{storyboard_number}}
Action: {{action}}
Result: {{result}}
Dialogue: {{dialogue}}
Shot type: {{shot_type}}
Characters: {{characters}}
Previous layout: {{previous_layout}}
Next layout: {{next_layout}}

Follow the system instructions and return only the optimized layout_description text.`,
    },
    variables: [
      'storyboard_number', 'action', 'result', 'dialogue', 'shot_type',
      'characters', 'previous_layout', 'next_layout',
    ],
    required: ['storyboard_number'],
    source: 'framePromptService.regenerateLayoutDescription',
    seedVersion: 2,
  }));
  add(definition({
    key: 'storyboard.continuity_snapshot.system',
    name: '连戏状态摘要规则',
    category: '分镜帧与布局',
    role: 'system',
    sceneKey: 'continuity_snapshot',
    contents: universal(promptI18n.getContinuitySnapshotPrompt()),
    risk: 'high',
    source: 'promptI18n.getContinuitySnapshotPrompt',
  }));
  add(definition({
    key: 'storyboard.continuity_snapshot.user',
    name: '连戏状态摘要输入模板',
    category: '分镜帧与布局',
    role: 'user_template',
    sceneKey: 'continuity_snapshot',
    contents: universal('PROMPT: {{image_prompt}}\nASSETS: {{assets}}'),
    variables: ['image_prompt', 'assets'],
    required: ['image_prompt'],
    source: 'imageService/storyboards continuity snapshot',
  }));

  const assetDefs = [
    ['character.image_polish.system', '角色生图提示词润色', '角色/场景/道具生图', 'system', 'role_image_polish', bilingual(promptI18n.getRolePolishPrompt), 'promptI18n.getRolePolishPrompt'],
    ['character.image_layout', '角色四视图布局要求', '角色/场景/道具生图', 'image_prompt', 'role_image_polish', universal(promptI18n.getRoleGenerateImagePrompt()), 'promptI18n.getRoleGenerateImagePrompt'],
    ['scene.image_four_view.system', '场景四视图提示词润色', '角色/场景/道具生图', 'system', 'scene_image_polish', bilingual(promptI18n.getScenePolishPrompt), 'promptI18n.getScenePolishPrompt'],
    ['scene.image_four_view.layout', '场景四视图布局要求', '角色/场景/道具生图', 'image_prompt', 'scene_image_polish', universal(promptI18n.getSceneGenerateImagePrompt()), 'promptI18n.getSceneGenerateImagePrompt'],
    ['scene.image_single.system', '场景单图提示词润色', '角色/场景/道具生图', 'system', 'scene_image_polish', bilingual(promptI18n.getScenePolishPromptSingle), 'promptI18n.getScenePolishPromptSingle'],
    ['scene.image_single.layout', '场景单图布局要求', '角色/场景/道具生图', 'image_prompt', 'scene_image_polish', universal(promptI18n.getSceneGenerateSingleImagePrompt()), 'promptI18n.getSceneGenerateSingleImagePrompt'],
    ['prop.image_polish.system', '道具生图提示词润色', '角色/场景/道具生图', 'system', 'prop_image_polish', bilingual(promptI18n.getPropPolishPrompt), 'promptI18n.getPropPolishPrompt'],
  ];
  for (const [key, name, category, role, sceneKey, contents, source] of assetDefs) {
    add(definition({
      key, name, category, role, sceneKey, contents,
      variables: ['style_prompt', 'style_prompt_zh', 'style_prompt_en', 'image_ratio', 'role_style', 'scene_style', 'prop_style'],
      risk: role === 'system' ? 'high' : 'normal',
      source,
    }));
  }
  add(definition({
    key: 'character.image_compose',
    name: '角色四视图最终生图拼装模板',
    category: '角色/场景/道具生图',
    role: 'image_prompt',
    sceneKey: 'role_image_polish',
    contents: universal(`【画风·最高优先级】四格统一：{{style_zh}}
MANDATORY ART STYLE (all 4 panels): {{style_en}}.

{{layout_instruction}}

---

{{generated_description}}

---

GENDER: {{gender}} only; keep body build and facial presentation consistent.
Reiterate the same art style in every panel: {{style_en}} {{style_zh}}.`),
    variables: ['style_zh', 'style_en', 'layout_instruction', 'generated_description', 'gender'],
    required: ['layout_instruction', 'generated_description'],
    source: 'characterLibraryService.buildFourViewImagePrompt',
  }));
  add(definition({
    key: 'scene.image_four_view.compose',
    name: '场景四视图最终生图拼装模板',
    category: '角色/场景/道具生图',
    role: 'image_prompt',
    sceneKey: 'scene_image_polish',
    contents: universal(`【画风·最高优先级】四格统一：{{style_zh}}
MANDATORY ART STYLE (all 4 panels): {{style_en}}.

{{layout_instruction}}

---

{{generated_description}}

---

Reiterate the same art style in every panel: {{style_en}} {{style_zh}}. No people, no text.`),
    variables: ['style_zh', 'style_en', 'layout_instruction', 'generated_description'],
    required: ['layout_instruction', 'generated_description'],
    source: 'sceneService.buildSceneFourViewImagePrompt',
  }));
  add(definition({
    key: 'scene.image_single.compose',
    name: '场景单图最终生图拼装模板',
    category: '角色/场景/道具生图',
    role: 'image_prompt',
    sceneKey: 'scene_image_polish',
    contents: universal(`【画风·最高优先级】{{style_zh}}
MANDATORY ART STYLE: {{style_en}}.

{{layout_instruction}}

---

{{generated_description}}

---

Reiterate the same art style: {{style_en}} {{style_zh}}. No people, no text.`),
    variables: ['style_zh', 'style_en', 'layout_instruction', 'generated_description'],
    required: ['layout_instruction', 'generated_description'],
    source: 'sceneService.buildSceneSingleImagePrompt',
  }));
  const assetUserDefs = [
    [
      'character.image_polish.user', '角色生图提示词输入模板', 'role_image_polish',
      '角色名称：{{entity_name}}\n\n角色描述：\n{{entity_description}}',
      ['entity_name', 'entity_description'], ['entity_description'],
    ],
    [
      'scene.image_four_view.user', '场景四视图输入模板', 'scene_image_polish',
      '请根据以下场景信息生成四格场景参考图提示词：\n地点：{{entity_name}}\n时段：{{entity_time}}\n描述：{{entity_description}}',
      ['entity_name', 'entity_time', 'entity_description'], ['entity_name'],
    ],
    [
      'scene.image_single.user', '场景单图输入模板', 'scene_image_polish',
      '请根据以下场景信息生成单图场景参考图提示词：\n地点：{{entity_name}}\n时段：{{entity_time}}\n描述：{{entity_description}}',
      ['entity_name', 'entity_time', 'entity_description'], ['entity_name'],
    ],
    [
      'prop.image_polish.user', '道具生图提示词输入模板', 'prop_image_polish',
      '请根据以下道具信息生成单道具资产主图提示词：\n名称：{{entity_name}}\n类型：{{entity_type}}\n描述：{{entity_description}}',
      ['entity_name', 'entity_type', 'entity_description'], ['entity_name'],
    ],
  ];
  for (const [key, name, sceneKey, content, variables, required] of assetUserDefs) {
    add(definition({
      key, name, category: '角色/场景/道具生图', role: 'user_template', sceneKey,
      contents: universal(content),
      variables,
      required,
      source: 'asset prompt service user prompt',
      seedVersion: 2,
    }));
  }
  add(definition({
    key: 'scene.prompt.translate_zh.user',
    name: '场景提示词翻译中文',
    category: '角色/场景/道具生图',
    role: 'user_template',
    sceneKey: 'scene_extraction',
    contents: universal('请将以下场景图像提示词翻译为中文，保留风格词或比例原样，直接返回翻译后的中文提示词，不要解释：\n{{source_prompt}}'),
    variables: ['source_prompt'],
    required: ['source_prompt'],
    source: 'backgroundExtractionService.translatePromptToChinese',
  }));

  add(definition({
    key: 'storyboard.image_polish.system',
    name: '分镜图片提示词润色',
    category: '分镜图片与视频',
    role: 'system',
    sceneKey: 'image_polish',
    contents: bilingual(promptI18n.getImagePolishPrompt),
    variables: ['style_prompt', 'style_prompt_zh', 'style_prompt_en', 'image_ratio'],
    risk: 'high',
    source: 'promptI18n.getImagePolishPrompt',
  }));
  add(definition({
    key: 'storyboard.image_polish.user',
    name: '分镜图片提示词输入模板',
    category: '分镜图片与视频',
    role: 'user_template',
    sceneKey: 'image_polish',
    contents: universal(`【画风·最高优先级】{{style_zh}}
MANDATORY ART STYLE: {{style_en}}.
PROMPT: {{image_prompt}}
ACTION: {{action}}
DIALOGUE: {{dialogue}}
RESULT: {{result}}
ATMOSPHERE: {{atmosphere}}
SHOT_TYPE: {{shot_type}}
STYLE_TOKENS (repeat in output): {{style_tokens}}
ASSETS: {{assets}}
PREV_CONTINUITY_STATE: {{previous_continuity_state}}
CONTEXT_PREV: {{previous_context}}
CONTEXT_NEXT: {{next_context}}
REMINDER: Output one static, continuous, single-frame image prompt only. No camera motion, transitions, split panels, comparison views or grids.`),
    variables: [
      'style_zh', 'style_en', 'image_prompt', 'action', 'dialogue', 'result',
      'atmosphere', 'shot_type', 'style_tokens', 'assets',
      'previous_continuity_state', 'previous_context', 'next_context',
    ],
    required: ['image_prompt'],
    source: 'imageService/storyboards image polish input',
    seedVersion: 2,
  }));
  add(definition({
    key: 'omni.segment.system',
    name: '全能片段生成规则',
    category: '分镜图片与视频',
    role: 'system',
    sceneKey: 'omni_segment_generation',
    contents: universal(promptI18n.getUniversalOmniSegmentPrompt()),
    risk: 'high',
    source: 'promptI18n.getUniversalOmniSegmentPrompt',
  }));
  add(definition({
    key: 'omni.segment.user',
    name: '全能片段输入模板',
    category: '分镜图片与视频',
    role: 'user_template',
    sceneKey: 'omni_segment_generation',
    contents: universal(`TOTAL_CLIP_SECONDS: {{duration_seconds}}
DURATION_SECONDS: {{duration_seconds}}

MULTI_BEAT_OUTPUT（一条成片 API 内的多节拍文案）:
- 总行数 = 3 + M。M 为子分镜条数，必须是 1～8 的整数。
- 第1行：「画面风格和类型:」…
- 第2行：「生成一个由以下M个分镜组成的视频。」M 必须与实际子分镜行数一致。
- 第3行必须逐字等于 LINE3_REQUIRED。
- 第4行起依次为「分镜1： T1秒:」至「分镜M： TM秒:」，每行先写秒数，再写该时段的动态影像与运镜。
- T1+…+TM 必须严格等于 {{duration_seconds}}；每个 Tk > 0；序号连续。
- M=1 时写满整段；M>1 时各行覆盖连续时间轴且不重复已完成动作。
- 禁止额外说明、markdown 或把子分镜误写成多次独立成片 API。

{{shot_pacing}}
{{neighbor_details}}

LINE3_REQUIRED（第3行必须与下面整句完全一致，含标点）:
{{line3_required}}

EPISODE_SCRIPT:
{{episode_script}}
EPISODE_TABLE_TITLE: {{episode_title}}

{{image_slot_map}}
{{scene_reference_layout}}
{{character_image_binding}}

STYLE_HINT:
DRAMA_TITLE: {{drama_title}}
DRAMA_GENRE: {{drama_genre}}
STYLE_ZH: {{style_zh}}
STYLE_EN: {{style_en}}

{{reference_rule}}

ORDERED_CHARACTER_NAMES（仅剧情理解）: {{character_names}}
ORDERED_PROP_NAMES: {{prop_names}}

{{scene_context}}
CONTEXT_PREV_SHORT: {{previous_context}}
CONTEXT_NEXT_SHORT: {{next_context}}

--- STORYBOARD FIELDS ---
{{storyboard_fields}}`),
    variables: [
      'duration_seconds', 'shot_pacing', 'neighbor_details', 'line3_required',
      'episode_script', 'episode_title', 'image_slot_map', 'scene_reference_layout',
      'character_image_binding', 'drama_title', 'drama_genre', 'style_zh', 'style_en',
      'reference_rule', 'character_names', 'prop_names', 'scene_context',
      'previous_context', 'next_context', 'storyboard_fields',
    ],
    required: ['duration_seconds', 'shot_pacing', 'line3_required', 'reference_rule', 'storyboard_fields'],
    source: 'universalSegmentPromptBundle',
    seedVersion: 2,
  }));
  const omniFragmentDefs = [
    {
      key: 'omni.segment.image_slot_map',
      name: '全能片段图片槽位映射规则',
      content: 'IMAGE_SLOT_MAP（全能模式提交视频时的参考图顺序；正文只可使用下列占位符）：\n{{slot_lines}}',
      variables: ['slot_lines'],
      required: ['slot_lines'],
    },
    {
      key: 'omni.segment.image_slot_map_empty',
      name: '全能片段无图槽位规则',
      content: 'IMAGE_SLOT_MAP（无图强制模式）：当前没有已上传参考图。正文可不使用 @图片N；若使用，仅代表未来补图占位，出片前必须核对实际上传顺序，且不得编造与剧本冲突的细节。',
    },
    {
      key: 'omni.segment.line3_scene_reference',
      name: '全能片段场景图第三行合同',
      content: '环境、光影与陈设定性参考 @图片1。若 @图片1 为宫格或多画面拼图，只提取统一空间与光线语义；成片必须是单镜头完整连续画面，禁止复刻分格或并列布局。',
    },
    {
      key: 'omni.segment.line3_primary_reference',
      name: '全能片段首图第三行合同',
      content: '本片段以首张参考图 @图片1 作为画面锚点展开。',
    },
    {
      key: 'omni.segment.line3_no_reference',
      name: '全能片段无图第三行合同',
      content: '当前尚未上传参考图；以剧本与分镜字段书写整段运镜和时间轴；若写 @图片N，仅作为后续补图占位，不得绑定未确定的人脸或编造剧情。',
    },
    {
      key: 'omni.segment.character_binding_scene_first',
      name: '全能片段场景首图角色绑定规则',
      content: 'CHARACTER_IMAGE_BINDING（@图片1 仅为场景；人物从 @图片2 起按下列映射绑定，禁止把人物绑到 @图片1）：\n{{binding_lines}}',
      variables: ['binding_lines'],
      required: ['binding_lines'],
    },
    {
      key: 'omni.segment.character_binding_primary',
      name: '全能片段角色首图绑定规则',
      content: 'CHARACTER_IMAGE_BINDING（以 IMAGE_SLOT_MAP 为准，人物与下列 @图片N 一一对应）：\n{{binding_lines}}',
      variables: ['binding_lines'],
      required: ['binding_lines'],
    },
    {
      key: 'omni.segment.character_binding_empty',
      name: '全能片段无角色参考绑定规则',
      content: 'CHARACTER_IMAGE_BINDING：当前没有角色参考槽位。ORDERED_CHARACTER_NAMES 仅用于剧情理解，不得作为图像占位符；若 @图片1 是场景，不得将人物外貌绑定到 @图片1。',
    },
    {
      key: 'omni.segment.reference_rule',
      name: '全能片段有图引用规则',
      content: `REFERENCE_RULE:
- 只能使用 IMAGE_SLOT_MAP 中列出的 @图片N，禁止用 @场景、@姓名或 @道具名指代参考图。
- 场景首图只负责环境、光影和陈设；人物外貌与动作按 CHARACTER_IMAGE_BINDING 绑定。
- 场景参考若为宫格拼图，成片仍须为单镜头连续画面，禁止模仿拼图布局。
- @图片N 与后续中英文之间保留一个半角空格。
- ORDERED_CHARACTER_NAMES 仅供理解剧情，不得当作图片占位符。
参考槽位数：{{slot_count}}；角色数：{{character_count}}；道具数：{{prop_count}}`,
      variables: ['slot_count', 'character_count', 'prop_count'],
      required: ['slot_count', 'character_count', 'prop_count'],
    },
    {
      key: 'omni.segment.reference_rule_empty',
      name: '全能片段无图引用规则',
      content: `REFERENCE_RULE:
- 当前为无图强制模式；可以不写 @图片N。
- 若写 @图片N，仅作为补图占位，出片前须与实际上传顺序一致。
- 禁止用 @场景、@姓名或 @道具名指代参考图。
- ORDERED_CHARACTER_NAMES 仅供理解剧情，不得当作图片占位符。`,
    },
    {
      key: 'omni.segment.scene_reference_layout',
      name: '全能片段场景拼图处理规则',
      content: `SCENE_REFERENCE_LAYOUT:
- 场景参考图可能是四宫格、九宫格或多视角拼图，只提取家具、装修、色调、空间关系和光影。
- 每个子分镜都必须是单镜头连续画幅，禁止生成分屏、宫格、多画面并列或复刻参考网格。`,
    },
    {
      key: 'omni.segment.boundary_changed',
      name: '全能片段段落切换节奏规则',
      content: 'BOUNDARY_HINT: 当前段落标题相对上一镜已变化，转场或新叙事块概率较高；可提高 M，或先用前几秒建立空间和情绪再进入冲突。',
    },
    {
      key: 'omni.segment.boundary_same',
      name: '全能片段同段延续节奏规则',
      content: 'BOUNDARY_HINT: 当前镜延续同一段落，可保守选择 M；若动作或对白密度较低，允许 M=1，但单行仍须写出完整时间流动。',
    },
  ];
  for (const fragment of omniFragmentDefs) {
    add(definition({
      key: fragment.key,
      name: fragment.name,
      category: '分镜图片与视频',
      role: 'format_contract',
      sceneKey: 'omni_segment_generation',
      contents: universal(fragment.content),
      variables: fragment.variables || [],
      required: fragment.required || [],
      risk: 'high',
      source: 'universalSegmentPromptBundle',
    }));
  }
  add(definition({
    key: 'omni.segment.polish.system',
    name: '全能片段润色规则',
    category: '分镜图片与视频',
    role: 'system',
    sceneKey: 'omni_segment_polish',
    contents: universal(promptI18n.getUniversalOmniPolishPrompt()),
    risk: 'high',
    source: 'promptI18n.getUniversalOmniPolishPrompt',
  }));
  add(definition({
    key: 'omni.segment.polish.user',
    name: '全能片段润色输入模板',
    category: '分镜图片与视频',
    role: 'user_template',
    sceneKey: 'omni_segment_polish',
    contents: universal(`TASK: POLISH_UNIVERSAL_OMNI_SEGMENT
POLISH_PASS_STAMP: {{polish_pass_stamp}}
POLISH_REFRESH: 本轮输出必须在严格遵守多节拍格式、总秒数、图片槽位和剧本事实的前提下明显改写中文表述；除第3行外，不得只改标点或个别虚词。
DIALOGUE_RETENTION: 必须逐条保留当前草稿、分镜字段和基础合同中的对白、旁白、引号句、数字、剧名与奖项名，不得以“人物对话”等概括替代。
Refine the current omni multi-beat prompt for a short-drama video shot.

FULL_EPISODE_SCRIPT（不得引入剧本未写的情节）:
{{episode_script}}

NEIGHBOR_PREV:
{{previous_storyboard}}

NEIGHBOR_NEXT:
{{next_storyboard}}

CURRENT_OMNI_DRAFT（必须在此基础上增强）:
{{current_draft}}

--- BASE_OMNI_CONTRACT ---
{{base_omni_contract}}`),
    variables: [
      'polish_pass_stamp', 'episode_script', 'previous_storyboard',
      'next_storyboard', 'current_draft', 'base_omni_contract',
    ],
    required: ['polish_pass_stamp', 'current_draft', 'base_omni_contract'],
    source: 'storyboards.polishUniversalSegmentStream',
    seedVersion: 2,
  }));
  add(definition({
    key: 'video.classic_polish.system',
    name: '经典分镜视频提示词润色',
    category: '分镜图片与视频',
    role: 'system',
    sceneKey: 'classic_video_prompt_polish',
    contents: universal('你是一位专业的短剧图生视频提示词导演。根据当前分镜、首帧锚点、完整剧本和邻镜上下文，输出一段可直接发送给图生视频模型的中文提示词。必须保留输入中的事实、对白、时长、运镜、画幅、声音和风格信息，不得编造剧情。只输出最终提示词，不要标题、解释或 markdown。'),
    risk: 'high',
    source: 'storyboards.polishClassicVideoPromptStream (missing legacy getter)',
  }));
  add(definition({
    key: 'video.classic_polish.user',
    name: '经典分镜视频提示词输入模板',
    category: '分镜图片与视频',
    role: 'user_template',
    sceneKey: 'classic_video_prompt_polish',
    contents: universal(`TASK: POLISH_CLASSIC_STORYBOARD_STILL_TO_VIDEO_PROMPT
POLISH_PASS_STAMP: {{polish_pass_stamp}}
POLISH_REFRESH: 事实与时长不变，但本轮必须明显换表述，禁止只改标点或个别虚词。
OUTPUT_GOAL: 输出单段可直接发送给图生视频模型的专业提示词；首帧由参考图锁定，文案负责动效、节奏、运镜、声画暗示与画风气质。

PROJECT:
DRAMA_TITLE: {{drama_title}}
EPISODE_TITLE: {{episode_title}}
SHOT_SEQUENCE: {{shot_sequence}}
VIDEO_RATIO: {{video_ratio}}

FULL_EPISODE_SCRIPT（用于人物关系、因果与语气；不得编造）:
{{episode_script}}

NEIGHBOR_PREV:
{{previous_storyboard}}

NEIGHBOR_NEXT:
{{next_storyboard}}

STORYBOARD_FIELDS:
{{storyboard_fields}}

REQUIRED_COVERAGE_DIGEST（成稿必须覆盖全部信息点，不得改对白原意或秒数）:
{{required_coverage}}

FIRST_FRAME_VISUAL_ANCHOR（动效须与参考静帧一致，不得换装、改人脸或改变时代）:
{{first_frame_anchor}}

AUTO_COMPOSED_VIDEO_PROMPT（程序字段拼装的事实底线）:
{{auto_composed_prompt}}

CURRENT_VIDEO_DRAFT（优先在其上润色）:
{{current_draft}}

RETENTION_CLAUSES_FROM_SOURCE（每条全部信息点均须保留）:
{{retention_clauses}}

VISUAL_STYLE:
STYLE_ZH: {{style_zh}}
STYLE_EN: {{style_en}}`),
    variables: [
      'polish_pass_stamp', 'drama_title', 'episode_title', 'shot_sequence',
      'video_ratio', 'episode_script', 'previous_storyboard', 'next_storyboard',
      'storyboard_fields', 'required_coverage', 'first_frame_anchor',
      'auto_composed_prompt', 'current_draft', 'retention_clauses', 'style_zh', 'style_en',
    ],
    required: ['polish_pass_stamp', 'shot_sequence', 'video_ratio', 'auto_composed_prompt'],
    source: 'storyboards.polishClassicVideoPromptStream',
    seedVersion: 2,
  }));
  add(definition({
    key: 'storyboard.image_prompt.compose',
    name: '分镜图片提示词拼装模板',
    category: '分镜图片与视频',
    role: 'image_prompt',
    contents: universal('{{location}}，{{time}}，{{angle}}，{{initial_action}}，{{emotion}}，{{style_prompt}}，首帧静止画面'),
    variables: ['location', 'time', 'angle', 'initial_action', 'emotion', 'style_prompt'],
    source: 'episodeStoryboardService.generateImagePrompt',
    seedVersion: 2,
  }));
  add(definition({
    key: 'storyboard.video_prompt.compose',
    name: '分镜视频提示词拼装模板',
    category: '分镜图片与视频',
    role: 'video_prompt',
    contents: universal(`场景：{{scene}}
镜头标题：{{title}}
动作：{{action}}
对话：{{dialogue}}
解说旁白：{{narration}}
结果：{{result}}
景别：{{shot_type}}
镜头角度：{{angle}}
运镜：{{movement}}
氛围：{{atmosphere}}
情绪：{{emotion}}
情绪强度：{{emotion_intensity}}
配乐：{{bgm_prompt}}
音效：{{sound_effect}}
时长：{{duration_seconds}}秒
风格：{{style_prompt}}
=VideoRatio: {{video_ratio}}`),
    variables: [
      'scene', 'title', 'action', 'dialogue', 'narration', 'result', 'shot_type',
      'angle', 'movement', 'atmosphere', 'emotion', 'emotion_intensity',
      'bgm_prompt', 'sound_effect', 'duration_seconds', 'style_prompt', 'video_ratio',
    ],
    required: ['duration_seconds'],
    source: 'episodeStoryboardService.generateVideoPrompt',
    seedVersion: 2,
  }));

  const technicalDefs = [
    ['image.quad_grid.layout', '四宫格图片布局要求', 'image_prompt', `【画风·最高优先级】四格统一：{{style_zh}}
MANDATORY ART STYLE (all 4 panels): {{style_en}}.
Create exactly four equal panels in a seamless 2×2 grid. No borders, dividing lines, frames, gaps, captions or single-strip layout.
Each panel shows the same scene and characters with consistent identity and style, but uses the specified different camera angle.

TOP ROW:
[Panel 1 — top-left, eye-level, initial state]: {{panel_1}}
[Panel 2 — top-right, low-angle upward, key action]: {{panel_2}}

BOTTOM ROW:
[Panel 3 — bottom-left, high-angle downward, action continuation]: {{panel_3}}
[Panel 4 — bottom-right, side profile, final state]: {{panel_4}}

The output must visibly contain exactly four equal quadrants.`, 'imageService.buildQuadGridPrompt'],
    ['image.nine_grid.layout', '九宫格图片布局要求', 'image_prompt', `【画风·最高优先级】九格统一：{{style_zh}}
MANDATORY ART STYLE (all 9 panels): {{style_en}}.
Create exactly nine equal panels in a seamless 3×3 grid. No borders, dividing lines, frames, gaps, captions or single-strip layout.
Keep character identity, scene and art style consistent while varying the cinematic camera angle as specified.

TOP ROW:
[Panel 1 — eye-level]: {{panel_1}}
[Panel 2 — low-angle upward]: {{panel_2}}
[Panel 3 — high-angle downward]: {{panel_3}}

MIDDLE ROW:
[Panel 4 — left profile]: {{panel_4}}
[Panel 5 — right profile]: {{panel_5}}
[Panel 6 — rear view]: {{panel_6}}

BOTTOM ROW:
[Panel 7 — extreme low angle]: {{panel_7}}
[Panel 8 — aerial top-down]: {{panel_8}}
[Panel 9 — diagonal 45-degree angle]: {{panel_9}}

The output must visibly contain exactly nine equal cells.`, 'imageService.buildNineGridPrompt'],
    ['image.reference_context.system', '参考图上下文说明', 'system', `The following lines map each reference image to its intended subject. Use every image only for identity, appearance, environment or object semantics. Do not copy a reference image's grid, split-screen, border, framing or multi-panel layout into the generated result.
{{reference_context}}`, 'imageService.reference_context_note'],
    ['image.negative.anti_split', '防分屏负向提示词', 'negative_prompt', 'nsfw, nudity, naked, violence, blood, gore, sensitive content, split panels, side-by-side layout, collage, diptych, triptych, grid layout, multiple panels, comparison view, composite image, two images in one frame', 'imageClient.ANTI_SPLIT_NEGATIVE_PROMPT'],
    ['video.aspect_ratio_mismatch_suffix', '视频画幅不匹配补充规则', 'suffix', '保持目标画幅 {{target_ratio}}，主体完整位于安全构图区，禁止拉伸、裁断主体或生成黑白边。', 'videoClient.viduMismatchAspectPromptSuffix'],
  ];
  for (const [key, name, role, content, source] of technicalDefs) {
    const variables = [...String(content).matchAll(/\{\{([a-zA-Z0-9_]+)\}\}/g)].map((m) => m[1]);
    const required = key === 'image.quad_grid.layout' || key === 'image.nine_grid.layout'
      ? variables.filter((name) => name.startsWith('panel_'))
      : variables;
    add(definition({
      key, name, category: '图片/视频技术约束', role,
      contents: universal(content),
      variables,
      required,
      risk: 'high',
      source,
      seedVersion: key === 'image.quad_grid.layout'
        || key === 'image.nine_grid.layout'
        || key === 'image.reference_context.system'
        ? 2
        : 1,
    }));
  }
  add(definition({
    key: 'image.single_frame.anti_split_suffix',
    name: '单帧防分屏正向后缀',
    category: '图片/视频技术约束',
    role: 'suffix',
    contents: universal(', one continuous single-frame scene; avoid: {{negative_terms}}'),
    variables: ['negative_terms'],
    required: ['negative_terms'],
    risk: 'high',
    source: 'imageService single storyboard anti-split',
  }));
  add(definition({
    key: 'image.reference_generation.user',
    name: '非 Gemini 参考图生图拼装模板',
    category: '图片/视频技术约束',
    role: 'image_prompt',
    contents: universal(`REFERENCE IMAGE MAP:
{{reference_labels}}

Use references only for subject identity, appearance, object and environment semantics. Do not copy their layout or framing.

GENERATE ONE CONTINUOUS SINGLE-FRAME SCENE — NO GRID, SPLIT PANELS OR COLLAGE:
{{image_prompt}}`),
    variables: ['reference_labels', 'image_prompt'],
    required: ['reference_labels', 'image_prompt'],
    risk: 'high',
    source: 'imageClient.callImageApi reference injection',
  }));
  add(definition({
    key: 'image.reference.layout_lock_label',
    name: '尾帧首帧参考图标签',
    category: '图片/视频技术约束',
    role: 'suffix',
    contents: universal('Image LAYOUT_LOCK: the first-frame composition and character-position reference. Preserve left/center/right placement, relative distances, facing direction, camera framing and spatial layout exactly; only pose, expression and result-state details may evolve. Never swap positions or recompose the shot.'),
    risk: 'high',
    source: 'imageService first-frame layout reference label',
  }));
  add(definition({
    key: 'image.last_frame.layout_lock_suffix',
    name: '尾帧人物站位锁定后缀',
    category: '图片/视频技术约束',
    role: 'suffix',
    contents: universal('。【人物站位最高铁律】必须与本分镜首帧保持100%一致的构图、人物左右站位、相对距离、朝向、相机取景和空间布局；只允许根据 result 改变姿态、表情、细微动作与环境结果，严禁交换人物位置或重新构图。违反即视为失败。'),
    risk: 'high',
    source: 'imageService last-frame layout lock',
  }));
  add(definition({
    key: 'image.default_cinematic_style',
    name: '缺省电影感生图风格',
    category: '图片/视频技术约束',
    role: 'image_prompt',
    contents: universal('cinematic movie still, anamorphic lens, film grain, dramatic lighting, shallow depth of field, professional cinematography'),
    source: 'imageService style fallback',
  }));
  add(definition({
    key: 'omni.segment.fallback',
    name: '全能片段缺失时回退拼装模板',
    category: '分镜图片与视频',
    role: 'video_prompt',
    sceneKey: 'omni_segment_generation',
    contents: universal(`主体：@人物1{{emotion_clause}}[朝向：依轴线面向戏中对象或画左/画右择一并保持统一] 正在 {{motion_core}}（与上镜衔接：{{continuity_link}}）
叙事动态：{{narrative_motion}}
空间：前景-[{{foreground}}] 中景-[{{midground}}] 背景-[{{background}}]
光影：{{lighting_contract}}
镜头：{{camera_contract}}
台词：{{dialogue_clause}}
音效：{{sound_contract}}
{{style_prompt}} [禁BGM][禁字幕]`),
    variables: [
      'emotion_clause', 'motion_core', 'continuity_link', 'narrative_motion',
      'foreground', 'midground', 'background', 'lighting_contract',
      'camera_contract', 'dialogue_clause', 'sound_contract', 'style_prompt',
    ],
    source: 'episodeStoryboardService.buildFallbackUniversalSeedanceLine',
  }));
  add(definition({
    key: 'frame.character_anchor.structured',
    name: '结构化角色视觉锚点拼装模板',
    category: '分镜帧与布局',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: universal('Character: {{character_name}}; Face: {{face_shape}}; Features: {{facial_features}}; Hair: {{hair_style}}; Skin: {{skin_texture}}; Colors: {{color_anchors}}; Marks: {{unique_marks}}'),
    variables: [
      'character_name', 'face_shape', 'facial_features', 'hair_style',
      'skin_texture', 'color_anchors', 'unique_marks',
    ],
    required: ['character_name'],
    source: 'framePromptService.buildCharacterAnchorText',
  }));
  add(definition({
    key: 'frame.character_anchor.fallback',
    name: '角色外貌文本锚点拼装模板',
    category: '分镜帧与布局',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: universal('{{character_name}}（{{appearance}}）——以上是固定视觉身份锚点；必须严格以此为基础，禁止添加未列出的发型、颜色、脸型或气质细节。'),
    variables: ['character_name', 'appearance'],
    required: ['character_name', 'appearance'],
    source: 'framePromptService.buildCharacterAnchorText fallback',
  }));
  add(definition({
    key: 'image.realistic_scale_contract',
    name: '真实物理尺度约束',
    category: '图片/视频技术约束',
    role: 'suffix',
    sceneKey: 'frame_prompt',
    contents: {
      zh: promptI18n.getRealisticPhysicalScaleContract(false),
      en: promptI18n.getRealisticPhysicalScaleContract(true),
    },
    risk: 'high',
    source: 'promptI18n.getRealisticPhysicalScaleContract',
  }));

  return defs;
}

module.exports = {
  buildCatalog,
  seedCfg,
  placeholders,
};

const SCENES = [
  {
    key: 'story_generation',
    label: '故事创作',
    category: '剧本',
    subcategory: '故事创作',
    detail_category: '',
    order: 101,
    service_type: 'text',
    description: '根据故事梗概生成短剧剧本',
    prompt_keys: ['story.generation.system', 'story.generation.user'],
  },
  {
    key: 'novel_import',
    label: '小说改编',
    category: '剧本',
    subcategory: '小说改编',
    detail_category: '',
    order: 102,
    service_type: 'text',
    description: '将小说章节改写为短剧剧本',
    prompt_keys: ['novel.import.user'],
  },
  {
    key: 'role_extraction',
    label: '人物 · 剧本提取',
    category: '资产',
    subcategory: '人物',
    detail_category: '剧本提取',
    order: 201,
    service_type: 'text',
    description: '从剧本提取角色设定',
    prompt_keys: [
      'character.extraction.system',
      'character.extraction.user',
      'character.extraction.drama_info',
    ],
  },
  {
    key: 'vision_character_extract',
    label: '人物 · 参考图识别',
    category: '资产',
    subcategory: '人物',
    detail_category: '参考图识别',
    order: 202,
    service_type: 'text',
    description: '从参考图提取角色外貌描述',
    prompt_keys: ['vision.character.extract.system', 'vision.character.extract.user'],
  },
  {
    key: 'identity_anchors',
    label: '人物 · 视觉身份锚点',
    category: '资产',
    subcategory: '人物',
    detail_category: '视觉身份锚点',
    order: 203,
    service_type: 'text',
    description: '从角色外貌提炼结构化视觉锚点',
    prompt_keys: ['character.identity_anchors.system', 'character.identity_anchors.user'],
  },
  {
    key: 'role_image_polish',
    label: '人物 · 图片提示词',
    category: '资产',
    subcategory: '人物',
    detail_category: '图片提示词',
    order: 204,
    service_type: 'text',
    description: '生成并润色角色图片提示词',
    prompt_keys: [
      'character.image_polish.system',
      'character.image_polish.user',
      'character.image_compose',
    ],
  },
  {
    key: 'scene_extraction',
    label: '场景 · 剧本提取',
    category: '资产',
    subcategory: '场景',
    detail_category: '剧本提取',
    order: 211,
    service_type: 'text',
    description: '从剧本提取场景背景，并在需要时翻译生图描述',
    prompt_keys: [
      'scene.extraction.system',
      'scene.extraction.user',
      'scene.prompt.translate_zh.user',
    ],
  },
  {
    key: 'vision_scene_extract',
    label: '场景 · 参考图识别',
    category: '资产',
    subcategory: '场景',
    detail_category: '参考图识别',
    order: 212,
    service_type: 'text',
    description: '从参考图提取场景描述',
    prompt_keys: ['vision.scene.extract.system', 'vision.scene.extract.user'],
  },
  {
    key: 'scene_image_polish',
    label: '场景 · 图片提示词',
    category: '资产',
    subcategory: '场景',
    detail_category: '图片提示词',
    order: 213,
    service_type: 'text',
    description: '生成并润色场景单图和四视图提示词',
    prompt_keys: [
      'scene.image_four_view.system',
      'scene.image_single.system',
      'scene.image.user',
      'scene.image_four_view.final',
      'scene.image_single.final',
    ],
  },
  {
    key: 'prop_extraction',
    label: '道具 · 剧本提取',
    category: '资产',
    subcategory: '道具',
    detail_category: '剧本提取',
    order: 221,
    service_type: 'text',
    description: '从剧本提取关键道具',
    prompt_keys: ['prop.extraction.system', 'prop.extraction.user'],
  },
  {
    key: 'vision_prop_extract',
    label: '道具 · 参考图识别',
    category: '资产',
    subcategory: '道具',
    detail_category: '参考图识别',
    order: 222,
    service_type: 'text',
    description: '从参考图提取道具描述',
    prompt_keys: ['vision.prop.extract.system', 'vision.prop.extract.user'],
  },
  {
    key: 'prop_image_polish',
    label: '道具 · 图片提示词',
    category: '资产',
    subcategory: '道具',
    detail_category: '图片提示词',
    order: 223,
    service_type: 'text',
    description: '生成并润色道具图片提示词',
    prompt_keys: ['prop.image_polish.system', 'prop.image_polish.user'],
  },
  {
    key: 'storyboard_extraction',
    label: '分镜 · 方案生成',
    category: '分镜',
    subcategory: '方案生成',
    detail_category: '',
    order: 301,
    service_type: 'text',
    description: '将剧本拆分为结构化分镜并支持中断续写',
    prompt_keys: [
      'storyboard.generation.system',
      'storyboard.generation.narration',
      'storyboard.generation.universal_mode',
      'storyboard.generation.count_constraint',
      'storyboard.generation.user',
      'storyboard.generation.duration_constraint',
      'storyboard.generation.project_clip_duration_constraint',
      'storyboard.generation.calculated_shot_duration_constraint',
      'storyboard.generation.continuation',
      'storyboard.generation.continuation_narration',
      'storyboard.generation.continuation_universal',
    ],
  },
  {
    key: 'layout_regenerate',
    label: '分镜 · 布局重生成',
    category: '分镜',
    subcategory: '布局与连戏',
    detail_category: '',
    order: 302,
    service_type: 'text',
    description: '重新生成画面布局与人物站位',
    prompt_keys: ['storyboard.layout.regenerate.system', 'storyboard.layout.regenerate.user'],
  },
  {
    key: 'continuity_snapshot',
    label: '分镜 · 连戏状态',
    category: '分镜',
    subcategory: '布局与连戏',
    detail_category: '',
    order: 303,
    service_type: 'text',
    description: '从分镜提示词提取连戏状态摘要',
    prompt_keys: [
      'storyboard.continuity_snapshot.system',
      'storyboard.continuity_snapshot.user',
    ],
  },
  {
    key: 'frame_prompt',
    label: '分镜 · 帧提示词',
    category: '分镜',
    subcategory: '首帧/关键帧/尾帧',
    detail_category: '',
    order: 304,
    service_type: 'text',
    description: '生成首帧、关键帧和尾帧提示词',
    prompt_keys: [
      'frame.first.system',
      'frame.first.fallback',
      'frame.first.realistic_scale_contract',
      'frame.key.system',
      'frame.key.fallback',
      'frame.last.system',
      'frame.last.fallback',
      'frame.last.realistic_scale_contract',
      'frame.input.user',
      'frame.context.compose',
      'frame.context.style',
      'frame.context.character_roster',
      'frame.context.character_anchors',
      'frame.context.spatial_contract',
      'frame.character_anchor.structured',
      'frame.character_anchor.fallback',
    ],
  },
  {
    key: 'image_polish',
    label: '分镜 · 图片提示词润色',
    category: '分镜',
    subcategory: '分镜图片',
    detail_category: '',
    order: 305,
    service_type: 'text',
    description: '润色分镜静态图片提示词',
    prompt_keys: ['storyboard.image_polish.system', 'storyboard.image_polish.user'],
  },
  {
    key: 'storyboard_image_generation',
    label: '分镜 · 图片生成',
    category: '分镜',
    subcategory: '分镜图片',
    detail_category: '',
    order: 306,
    service_type: 'storyboard_image',
    description: '拼装分镜图片提示词、参考图说明及图片约束，并选择分镜图片模型',
    prompt_keys: [
      'storyboard.image_prompt.compose',
      'image.quad_grid.layout',
      'image.nine_grid.layout',
      'image.default_cinematic_style',
      'image.reference_context.system',
      'image.negative.anti_split',
      'image.single_frame.anti_split_suffix',
      'image.reference.layout_lock_label',
      'image.last_frame.layout_lock_suffix',
      'image.reference_generation.user',
    ],
  },
  {
    key: 'classic_video_prompt_polish',
    label: '视频 · 经典模式提示词',
    category: '视频',
    subcategory: '经典模式',
    detail_category: '',
    order: 401,
    service_type: 'text',
    description: '润色经典首尾帧图生视频提示词',
    prompt_keys: ['video.classic_polish.system', 'video.classic_polish.user'],
  },
  {
    key: 'omni_segment_generation',
    label: '视频 · 全能模式生成',
    category: '视频',
    subcategory: '全能模式',
    detail_category: '',
    order: 402,
    service_type: 'text',
    description: '生成多参考图全能片段提示词',
    prompt_keys: [
      'omni.segment.system',
      'omni.segment.user',
      'omni.segment.image_slot_map',
      'omni.segment.image_slot_map_empty',
      'omni.segment.line3_scene_reference',
      'omni.segment.line3_primary_reference',
      'omni.segment.line3_no_reference',
      'omni.segment.character_binding_scene_first',
      'omni.segment.character_binding_primary',
      'omni.segment.character_binding_empty',
      'omni.segment.reference_rule',
      'omni.segment.reference_rule_empty',
      'omni.segment.scene_reference_layout',
      'omni.segment.boundary_changed',
      'omni.segment.boundary_same',
      'omni.segment.fallback',
    ],
  },
  {
    key: 'omni_segment_polish',
    label: '视频 · 全能模式润色',
    category: '视频',
    subcategory: '全能模式',
    detail_category: '',
    order: 403,
    service_type: 'text',
    description: '润色多参考图全能片段提示词',
    prompt_keys: ['omni.segment.polish.system', 'omni.segment.polish.user'],
  },
  {
    key: 'video_generation',
    label: '视频 · 模型生成',
    category: '视频',
    subcategory: '通用',
    detail_category: '',
    order: 404,
    service_type: 'video',
    description: '拼装最终视频提示词并选择实际视频生成模型',
    prompt_keys: ['storyboard.video_prompt.compose', 'video.aspect_ratio_mismatch_suffix'],
  },
];

const PROMPT_BINDING_BY_KEY = new Map();
for (const scene of SCENES) {
  for (const [index, promptKey] of scene.prompt_keys.entries()) {
    if (PROMPT_BINDING_BY_KEY.has(promptKey)) {
      throw new Error(`提示词 ${promptKey} 重复绑定业务场景`);
    }
    PROMPT_BINDING_BY_KEY.set(promptKey, {
      scene_key: scene.key,
      scene_order: scene.order,
      component_order: index + 1,
    });
  }
}

const BY_KEY = new Map(SCENES.map((scene) => [
  scene.key,
  Object.freeze({ ...scene, prompt_keys: Object.freeze([...scene.prompt_keys]) }),
]));

function cloneScene(scene) {
  return scene ? { ...scene, prompt_keys: [...scene.prompt_keys] } : null;
}

function listBusinessScenes() {
  return SCENES
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(cloneScene);
}

function getBusinessScene(key) {
  return cloneScene(BY_KEY.get(String(key || '')) || null);
}

function getPromptBusinessSceneBinding(promptKey) {
  const binding = PROMPT_BINDING_BY_KEY.get(String(promptKey || ''));
  return binding ? { ...binding } : null;
}

function isRegisteredBusinessScene(key) {
  return BY_KEY.has(String(key || ''));
}

module.exports = {
  listBusinessScenes,
  getBusinessScene,
  getPromptBusinessSceneBinding,
  isRegisteredBusinessScene,
};

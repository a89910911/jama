const SCENES = [
  { key: 'story_generation', label: '故事生成', service_type: 'text', description: '根据故事梗概生成短剧剧本' },
  { key: 'storyboard_extraction', label: '分镜生成', service_type: 'text', description: '剧本拆分为结构化分镜及续写' },
  { key: 'role_extraction', label: '角色提取', service_type: 'text', description: '从剧本提取角色设定' },
  { key: 'scene_extraction', label: '场景提取', service_type: 'text', description: '从剧本提取场景背景' },
  { key: 'prop_extraction', label: '道具提取', service_type: 'text', description: '从剧本提取关键道具' },
  { key: 'role_image_polish', label: '角色图提示词润色', service_type: 'text', description: '角色生图提示词生成与润色' },
  { key: 'scene_image_polish', label: '场景图提示词润色', service_type: 'text', description: '场景单图和四视图提示词生成与润色' },
  { key: 'prop_image_polish', label: '道具图提示词润色', service_type: 'text', description: '道具生图提示词生成与润色' },
  { key: 'image_polish', label: '分镜图提示词润色', service_type: 'text', description: '仅用于分镜图片提示词润色' },
  { key: 'frame_prompt', label: '帧提示词生成', service_type: 'text', description: '首帧、关键帧和尾帧提示词生成' },
  { key: 'layout_regenerate', label: '分镜布局重生成', service_type: 'text', description: '重生成画面布局与人物站位合同' },
  { key: 'identity_anchors', label: '角色视觉锚点提炼', service_type: 'text', description: '从角色外貌提炼结构化视觉锚点' },
  { key: 'novel_import', label: '小说导入改写', service_type: 'text', description: '将小说章节改写为短剧剧本' },
  { key: 'omni_segment_generation', label: '全能片段生成', service_type: 'text', description: '生成多参考图全能片段提示词' },
  { key: 'omni_segment_polish', label: '全能片段润色', service_type: 'text', description: '润色多参考图全能片段提示词' },
  { key: 'classic_video_prompt_polish', label: '经典视频提示词润色', service_type: 'text', description: '润色经典分镜图生视频提示词' },
  { key: 'continuity_snapshot', label: '连戏状态摘要', service_type: 'text', description: '从分镜提示词提取连戏状态' },
  { key: 'vision_character_extract', label: '参考图角色识别', service_type: 'text', description: '从参考图提取角色外貌描述' },
  { key: 'vision_scene_extract', label: '参考图场景识别', service_type: 'text', description: '从参考图提取场景描述' },
  { key: 'vision_prop_extract', label: '参考图道具识别', service_type: 'text', description: '从参考图提取道具描述' },
];

const BY_KEY = new Map(SCENES.map((scene) => [scene.key, Object.freeze({ ...scene })]));

function listBusinessScenes() {
  return SCENES.map((scene) => ({ ...scene }));
}

function getBusinessScene(key) {
  return BY_KEY.get(String(key || '')) || null;
}

function isRegisteredBusinessScene(key) {
  return BY_KEY.has(String(key || ''));
}

module.exports = {
  listBusinessScenes,
  getBusinessScene,
  isRegisteredBusinessScene,
};

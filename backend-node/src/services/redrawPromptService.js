function parseJson(value, fallback) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (_) {
    return fallback;
  }
}

function assetLines(label, assets) {
  const list = Array.isArray(assets) ? assets.filter(Boolean) : [];
  return list.map((item, index) => {
    const name = item.name || item.title || `${label}${index + 1}`;
    const description = item.description || item.appearance || item.prompt || item.note || '';
    return `${label}${index + 1} 定义 ${name}: ${description || '以绑定参考图中的可见客观细节为准'}`;
  });
}

function buildRedrawPrompt(job, card) {
  const characters = parseJson(card.character_refs, []);
  const props = parseJson(card.prop_refs, []);
  const scene = parseJson(card.scene_ref, null);
  const timeline = parseJson(card.timeline, []);
  const basePrompt = String(card.prompt || '').trim();
  const goal = String(job?.overall_goal || '').trim();
  const aspect = card.aspect_ratio || job?.aspect_ratio || '9:16';

  const lines = [
    `任务: 使用低细节结构参考视频和参考图进行视频转绘，生成 ${aspect} 真人短剧视频。`,
    '优先级1: 低细节结构参考视频只用于镜头骨架，包括构图、人物站位、空间关系、景别、镜头运动、光影方向、动作节奏、表演幅度和口型时机。',
    '优先级2: 参考图用于锁定人物身份、人脸、发型、服装、场景结构、陈设、光线质感和道具外观。必须用参考图替换结构视频里的原演员、原人脸、原服装、原场景和原道具。',
    '严格禁止: 字幕、花字、标题卡、漂浮文字、文字特效、对话气泡、logo、水印、可读屏幕文字、中文字符、英文文字入画。',
  ];

  if (goal) lines.push(`整体目标: ${goal}`);
  if (basePrompt) lines.push(`镜头内容: ${basePrompt}`);
  lines.push(...assetLines('角色参考图', characters));
  if (scene) {
    lines.push(`场景参考图 定义 ${scene.name || scene.location || '场景'}: ${scene.description || scene.prompt || '以绑定参考图中的空间和陈设为准'}`);
  }
  lines.push(...assetLines('道具参考图', props));

  if (Array.isArray(timeline) && timeline.length) {
    lines.push('镜头时间线:');
    for (const beat of timeline) {
      const range = beat.range || beat.time || '';
      const text = beat.text || beat.description || '';
      if (range || text) lines.push(`${range}: ${text}`.trim());
    }
  }

  lines.push('画面效果: 真实电影光线，面部稳定，动作自然，道具接触真实，画质清晰，保持源镜头节奏但彻底替换视觉身份。');
  return lines.filter(Boolean).join('\n');
}

function buildNegativePrompt(card) {
  const user = String(card.negative_prompt || '').trim();
  const defaults = [
    'subtitles',
    'captions',
    'title card',
    'watermark',
    'logo',
    'readable text',
    'speech bubble',
    'duplicated face',
    'ghosting',
    'motion smear',
    'identity drift',
    'original actor face',
    'original costume',
  ];
  return user ? `${user}, ${defaults.join(', ')}` : defaults.join(', ');
}

function collectReferenceUrls(card) {
  const urls = [];
  const push = (value) => {
    const raw = String(value || '').trim();
    if (raw && !urls.includes(raw)) urls.push(raw);
  };
  const characters = parseJson(card.character_refs, []);
  const props = parseJson(card.prop_refs, []);
  const scene = parseJson(card.scene_ref, null);
  for (const item of Array.isArray(characters) ? characters : []) {
    push(item.image_url || item.url || item.local_path || item.ref_image);
  }
  if (scene) push(scene.image_url || scene.url || scene.local_path || scene.ref_image);
  for (const item of Array.isArray(props) ? props : []) {
    push(item.image_url || item.url || item.local_path || item.ref_image);
  }
  return urls.slice(0, 9);
}

module.exports = {
  buildRedrawPrompt,
  buildNegativePrompt,
  collectReferenceUrls,
  parseJson,
};

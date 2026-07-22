const TIER_ORDER = ['recommended', 'fast', 'standard', 'compatible', 'account']

const TIER_LABELS = {
  recommended: '推荐 / 高质量',
  fast: '快速 / 低成本',
  standard: '标准模型',
  compatible: '兼容 / 历史模型',
  account: '当前账号可用',
}

/**
 * 模型元数据只描述项目已核验的提供商。未登记的模型仍会保留并显示在“标准模型”中，
 * 因此用户保存的自定义模型不会因为目录升级而丢失。
 */
export const AI_MODEL_META = {
  text: {
    deepseek: {
      'deepseek-v4-pro': { tier: 'recommended', hint: '质量优先' },
      'deepseek-v4-flash': { tier: 'fast', hint: '快速响应' },
    },
    qwen: {
      'qwen3.7-max': { tier: 'recommended', hint: '最新质量档' },
      'qwen3.7-max-2026-05-20': { tier: 'recommended', hint: '固定版本' },
      'qwen3.6-plus': { tier: 'fast', hint: '均衡档' },
      'qwen3.6-flash': { tier: 'fast', hint: '速度优先' },
      'qwen-plus': { tier: 'compatible', hint: '兼容别名' },
      'qwen-flash': { tier: 'compatible', hint: '兼容别名' },
      'qwen3-max': { tier: 'compatible', hint: '历史模型' },
    },
    volcengine: {
      'doubao-seed-2-0-pro-260215': { tier: 'recommended', hint: '质量优先' },
      'doubao-seed-2-0-lite-260215': { tier: 'fast', hint: '低延迟' },
      'deepseek-v3-2-251201': { tier: 'compatible', hint: '兼容模型' },
      'doubao-1-5-pro-32k-250115': { tier: 'compatible', hint: '历史模型' },
      'kimi-k2-thinking-251104': { tier: 'compatible', hint: '兼容模型' },
    },
    fal: {
      'openai/gpt-5.6-sol': { tier: 'recommended', hint: '旗舰质量' },
      'openai/gpt-5.6-terra': { tier: 'fast', hint: '均衡成本' },
      'openai/gpt-5.6-luna': { tier: 'fast', hint: '高吞吐' },
      'openai/gpt-5.5': { tier: 'compatible', hint: '现有兼容模型' },
    },
    venice: {
      'openai-gpt-55-pro': { tier: 'recommended', hint: '质量优先' },
      'deepseek-v4-pro': { tier: 'recommended', hint: '长上下文' },
      'deepseek-v4-flash': { tier: 'fast', hint: '快速响应' },
      'qwen3-6-27b': { tier: 'fast', hint: '私有推理' },
      'openai-gpt-55': { tier: 'compatible', hint: '现有兼容模型' },
    },
  },
  image: {
    volcengine: {
      'doubao-seedream-5-0-pro-260628': { tier: 'recommended', hint: '最新 Pro' },
      'doubao-seedream-5-0-260128': { tier: 'recommended', hint: '质量优先' },
      'doubao-seedream-5-0-lite-260128': { tier: 'fast', hint: '速度优先' },
      'doubao-seedream-4-5-251128': { tier: 'compatible', hint: '稳定回退' },
      'doubao-seedream-4-0-250828': { tier: 'compatible', hint: '历史模型' },
    },
    dashscope: {
      'wan2.7-image-pro': { tier: 'recommended', hint: '生成与多图编辑' },
      'wan2.7-image': { tier: 'fast', hint: '加速版' },
      'wan2.6-image': { tier: 'compatible', hint: '稳定回退' },
    },
    qwen_image: {
      'qwen-image-2.0-pro': { tier: 'recommended', hint: '生成与编辑融合' },
      'qwen-image-2.0': { tier: 'fast', hint: '均衡质量与速度' },
      'qwen-image-max': { tier: 'compatible', hint: '旧质量档' },
      'qwen-image-plus': { tier: 'compatible', hint: '旧均衡档' },
      'qwen-image': { tier: 'compatible', hint: '历史模型' },
    },
  },
  storyboard_image: {},
  video: {
    fal: {
      'bytedance/seedance-2.0': { tier: 'recommended', hint: '标准版' },
      'bytedance/seedance-2.0/fast': { tier: 'fast', hint: '720p 快速版' },
      'bytedance/seedance-2.0/mini': { tier: 'fast', hint: '低成本版' },
    },
    venice: {
      'seedance-2-0': { tier: 'recommended', hint: '标准版' },
      'seedance-2-0-fast': { tier: 'fast', hint: '720p 快速版' },
    },
    holycrab: {
      'seedance-2-0': { tier: 'recommended', hint: '公开标准版' },
      'seedance-2-0-fast': { tier: 'fast', hint: '账号可用性需验证' },
      'seedance-2-0-mini': { tier: 'fast', hint: '账号可用性需验证' },
    },
    dashscope: {
      'wan2.7-r2v': { tier: 'recommended', hint: '参考图 / 故事板' },
      'wan2.7-i2v': { tier: 'recommended', hint: '首尾帧生视频' },
      'wan2.7-t2v': { tier: 'standard', hint: '文生视频' },
      'wan2.6-r2v-flash': { tier: 'compatible', hint: '稳定回退' },
      'wan2.6-i2v-flash': { tier: 'compatible', hint: '稳定回退' },
      'wan2.6-t2v': { tier: 'compatible', hint: '稳定回退' },
      'wan2.2-kf2v-flash': { tier: 'compatible', hint: '历史首尾帧' },
      'wanx2.1-vace-plus': { tier: 'compatible', hint: '历史参考模型' },
    },
    volces: {
      'doubao-seedance-2-0-260128': { tier: 'recommended', hint: '标准版' },
      'doubao-seedance-2-0-fast-260128': { tier: 'fast', hint: '快速版' },
      'doubao-seedance-1-5-pro-251215': { tier: 'compatible', hint: '稳定回退' },
      'doubao-seedance-1-0-lite-i2v-250428': { tier: 'compatible', hint: '历史模型' },
      'doubao-seedance-1-0-lite-t2v-250428': { tier: 'compatible', hint: '历史模型' },
      'doubao-seedance-1-0-pro-250528': { tier: 'compatible', hint: '历史模型' },
      'doubao-seedance-1-0-pro-fast-251015': { tier: 'compatible', hint: '历史模型' },
    },
  },
  tts: {
    fal: {
      'fal-ai/qwen-3-tts/text-to-speech/1.7b': { tier: 'recommended', hint: '质量优先' },
      'fal-ai/qwen-3-tts/text-to-speech/0.6b': { tier: 'fast', hint: '速度与成本优先' },
      'fal-ai/gemini-3.1-flash-tts': { tier: 'standard', hint: 'Gemini 语音' },
    },
  },
}

// 分镜图与普通图片共用同一组模型能力元数据。
AI_MODEL_META.storyboard_image = AI_MODEL_META.image

export function getModelMeta(serviceType, provider, model) {
  return AI_MODEL_META?.[serviceType]?.[provider]?.[model] || null
}

export function groupModelOptions(models, serviceType, provider, accountModelIds = []) {
  const seen = new Set()
  const accountSet = new Set(accountModelIds || [])
  const buckets = new Map(TIER_ORDER.map((tier) => [tier, []]))

  for (const raw of models || []) {
    const value = String(raw || '').trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    const meta = getModelMeta(serviceType, provider, value)
    const tier = meta?.tier || (accountSet.has(value) ? 'account' : 'standard')
    const hint = meta?.hint || (accountSet.has(value) ? '账号模型' : '')
    buckets.get(tier).push({
      value,
      label: hint ? `${value} · ${hint}` : value,
      hint,
      tier,
    })
  }

  return TIER_ORDER
    .map((tier) => ({ label: TIER_LABELS[tier], tier, options: buckets.get(tier) }))
    .filter((group) => group.options.length > 0)
}


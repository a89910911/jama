export function upsertChatMessage(messages, message) {
  if (!message?.id) return [...(messages || [])]
  const next = [...(messages || [])]
  const index = next.findIndex((item) => item.id === message.id)
  if (index >= 0) next.splice(index, 1, message)
  else next.push(message)
  return next
}

export function parseCodexTaskResult(result) {
  if (!result) return {}
  if (typeof result === 'object') return result
  try {
    return JSON.parse(result)
  } catch (_) {
    return {}
  }
}

export function shouldRefreshDrama(result) {
  const parsed = parseCodexTaskResult(result)
  return !!parsed.refresh_drama || (!!parsed.action && parsed.action !== 'chat')
}

export function codexMessageImages(message) {
  const metadata = message?.metadata || {}
  if (Array.isArray(metadata.images)) {
    return metadata.images.filter((item) => item?.url)
  }
  return metadata.image?.url ? [metadata.image] : []
}

const CODEX_ACTION_LABELS = {
  chat: '创作咨询',
  generate_story: '生成剧本',
  rewrite_current_episode: '改写本集',
  continue_current_episode: '续写本集',
  extract_resources: '提取资源',
  generate_resource_images: '生成资源图片',
  generate_storyboards: '生成全部分镜',
  generate_storyboard_images: '生成分镜图片',
  generate_image: '生成单张素材图',
  optimize_resource_prompt: '优化资源提示词',
  update_storyboard_details: '补充分镜说明',
  optimize_storyboard_prompt: '优化分镜提示词',
}

export function codexActionLabel(intent) {
  return CODEX_ACTION_LABELS[intent] || ''
}

export const CODEX_CONVERSATION_TIPS = [
  '可以直接用自然语言描述目标，不必背固定口令；说明要生成、改写、续写、提取还是配图。',
  '尽量写清范围，例如“当前集全部分镜”“第 3 个分镜”“角色凯尔”“尚未生成图片的场景”。',
  '需要覆盖已有内容时明确说“重新生成并覆盖”；未说明时会保留已有图片，只补缺失项。',
  '资源图和分镜图会逐项生成并绑定入库；普通“生成一张图”只会保存为单张项目素材。',
  '只想改提示词时请说清资源名称或分镜编号，并注明“图生提示词、原始提示词、通用优化提示词、视频提示词”中的哪一种。',
  '“重新生成图片”会调用 Codex 重新出图；“优化提示词”只更新编辑字段，不会自动生成图片。',
  '复杂流程建议按剧本 → 资源说明 → 资源图片 → 分镜 → 分镜图片分步发送，便于检查和失败重试。',
  '提问、分析和讨论不会修改数据库；执行完成后请以对话中的“已写入/已绑定”结果提示为准。',
]

export function codexIntentOptions({ episodeId, episodeNumber } = {}) {
  const hasEpisode = !!episodeId
  const episodeLabel = episodeNumber ? `第 ${episodeNumber} 集` : '当前集'

  return [
    {
      value: 'generate_story',
      label: hasEpisode ? '生成本集剧本' : '生成完整剧本',
      description: hasEpisode
        ? `根据创意生成${episodeLabel}剧本，并写入当前剧集`
        : '根据创意生成完整的多集剧本，并写入当前项目',
      example: hasEpisode
        ? `请根据以下创意生成${episodeLabel}剧本：一个少女在森林里遇见会说话的狐狸，一起寻找失落的宝石。`
        : '请根据以下创意生成完整剧本：一个少女在森林里遇见会说话的狐狸，一起寻找失落的宝石。',
    },
    ...(hasEpisode
      ? [
          {
            value: 'rewrite_current_episode',
            label: '改写本集',
            description: `根据要求改写${episodeLabel}已有剧本，并覆盖当前内容`,
            example: `请改写${episodeLabel}剧本：加强戏剧冲突，优化人物对白，并保持原有故事主线。`,
          },
          {
            value: 'continue_current_episode',
            label: '续写本集',
            description: `承接${episodeLabel}已有内容续写，并保存到当前剧集`,
            example: `请续写${episodeLabel}剧本：承接现有结尾继续发展，并加入一个新的悬念。`,
          },
          {
            value: 'generate_storyboards',
            label: '生成全部分镜',
            description: `将${episodeLabel}剧本完整拆成结构化分镜并写入数据库`,
            example: `请根据${episodeLabel}完整剧本生成所有分镜，补充每条分镜的动作、结果、镜头说明和画面布局，并全部写入数据库。`,
          },
          {
            value: 'update_storyboard_details',
            label: '补充分镜说明',
            description: `补充或优化${episodeLabel}分镜的画面说明、布局、动作和结果并写入数据库`,
            example: `请补充${episodeLabel}所有分镜的画面说明和空间布局说明，保持剧情、角色和道具设定不变，并写入数据库。`,
          },
          {
            value: 'optimize_storyboard_prompt',
            label: '优化分镜提示词',
            description: `优化指定分镜的原始、通用图片或视频提示词并写入编辑区`,
            example: `请优化${episodeLabel}第 2 个分镜的通用优化提示词和视频提示词，并写入对应的提示词编辑字段。`,
          },
          {
            value: 'generate_storyboard_images',
            label: '生成全部分镜图',
            description: `为${episodeLabel}每条分镜分别生成独立首帧图片并绑定入库`,
            example: `请为${episodeLabel}所有分镜分别生成独立的首帧图片，并绑定到对应分镜后写入素材库。`,
          },
        ]
      : []),
    {
      value: 'extract_resources',
      label: '提取资源',
      description: hasEpisode
        ? `从${episodeLabel}剧本提取角色、道具和场景，并写入资源库`
        : '从项目剧本提取角色、道具和场景，并写入资源库',
      example: hasEpisode
        ? `请从${episodeLabel}剧本中提取角色、道具和场景，补充详细说明和图片生成提示词，并写入资源库。`
        : '请从当前项目剧本中提取角色、道具和场景，补充详细说明和图片生成提示词，并写入资源库。',
    },
    {
      value: 'optimize_resource_prompt',
      label: '优化资源提示词',
      description: '只优化角色、道具或场景的图片生成提示词并入库，不生成图片',
      example: '请优化当前项目所有角色的图生提示词，保持每个角色的外貌、服装和身份锚点一致，并写入资源库。',
    },
    {
      value: 'generate_resource_images',
      label: '生成资源图',
      description: hasEpisode
        ? `为${episodeLabel}的角色、道具和场景分别生成图片并绑定资源`
        : '为项目中的角色、道具和场景分别生成图片并绑定资源',
      example: hasEpisode
        ? `请为${episodeLabel}资源库中尚无图片的角色、道具和场景分别生成图片，并绑定到对应资源。`
        : '请为当前项目资源库中尚无图片的角色、道具和场景分别生成图片，并绑定到对应资源。',
    },
    {
      value: 'generate_image',
      label: '生成单图',
      description: '根据文字描述生成一张独立图片，并保存到项目素材库',
      example: '请生成一张图片：月光下的森林空地，一只会说话的狐狸守护着发光的宝石，电影感构图。',
    },
  ]
}

const IMAGE_PROGRESS_HORIZON_MS = 2 * 60 * 1000
const VIDEO_PROGRESS_HORIZON_MS = 10 * 60 * 1000

export const MEDIA_GENERATION_RESOURCE_TYPES = new Set([
  'char_image',
  'prop_image',
  'scene_image',
  'sb_image',
  'sb_first_image',
  'sb_last_image',
  'sb_video',
  'episode_merge',
])

export function clampGenerationProgress(value, max = 100) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.max(0, Math.min(max, Math.round(number)))
}

export function isVideoGenerationKind(kind) {
  const value = String(kind || '').toLowerCase()
  return value.includes('video') || value.includes('merge')
}

export function isMediaGenerationResourceType(resourceType) {
  return MEDIA_GENERATION_RESOURCE_TYPES.has(String(resourceType || ''))
}

/**
 * 优先展示后端/厂商报告的进度；未报告细粒度进度时，根据已耗时给出透明的预计值。
 * 预计值始终停在 95%，任务是否完成只以后端状态为准。
 */
export function resolveGenerationProgress(task, options = {}) {
  const status = String(task?.status || options.status || '').toLowerCase()
  if (status === 'completed' || status === 'done' || status === 'success') {
    return {
      percentage: 100,
      message: task?.message || options.completedMessage || '生成完成',
      estimated: false,
    }
  }

  const reported = clampGenerationProgress(task?.progress ?? options.reportedProgress, 99)
  const previous = clampGenerationProgress(options.previousProgress, 99)
  const startedAt = Number(options.startedAt) || Date.now()
  const elapsedMs = Math.max(0, Date.now() - startedAt)
  const kind = options.kind || task?.type || options.resourceType
  const horizon = isVideoGenerationKind(kind)
    ? VIDEO_PROGRESS_HORIZON_MS
    : IMAGE_PROGRESS_HORIZON_MS
  const estimatedValue = Math.min(95, 3 + 92 * (1 - Math.exp(-elapsedMs / horizon)))
  const percentage = Math.max(1, reported, previous, Math.round(estimatedValue))
  const estimated = percentage > reported

  return {
    percentage,
    message: task?.message
      || options.message
      || (isVideoGenerationKind(kind) ? '正在生成视频…' : '正在生成图片…'),
    estimated,
  }
}

export function applyGenerationProgress(target, task, options = {}) {
  if (!target) return resolveGenerationProgress(task, options)
  const snapshot = resolveGenerationProgress(task, {
    ...options,
    previousProgress: options.previousProgress ?? target.progress,
    startedAt: options.startedAt ?? target.progressStartedAt,
  })
  target.progress = snapshot.percentage
  target.progressMessage = snapshot.message
  target.progressEstimated = snapshot.estimated
  return snapshot
}

export function parseGenerationTaskResult(result) {
  if (!result) return {}
  if (typeof result === 'object') return result
  try {
    const parsed = JSON.parse(result)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

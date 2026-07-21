import { ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { dramaAPI } from '@/api/drama'
import { storyboardsAPI } from '@/api/storyboards'
import { taskAPI } from '@/api/task'
import { parseDramaMetadata } from '@/utils/canvasLayout'
import { getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import { runImageStep, runVideoStep } from '@/composables/useCanvasWorkflowRunner'
import { hasStoryboardImage, hasStoryboardVideo } from '@/utils/storyboardMedia'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'
import { resolveGenerationProgress } from '@/utils/generationProgress'

async function pollTask(taskId, onTick, maxAttempts = 450, interval = 2000) {
  if (!taskId) return { status: 'completed' }
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const t = await taskAPI.get(taskId)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: t.error?.message || t.error || '任务失败' }
      }
      onTick?.()
    } catch (e) {
      if (i === maxAttempts - 1) return { status: 'failed', error: e.message || '轮询失败' }
    }
  }
  return { status: 'timeout', error: '任务超时' }
}

/** 画布模式：当前集 AI 生成分镜 + 批量生图/生视频 */
export function useCanvasEpisodeGenerate(deps) {
  const {
    drama,
    filterEpisodeId,
    imagesBySbId,
    videosBySbId,
    refreshCanvas,
    nodeStatus,
  } = deps

  const episodeGenerating = ref(false)
  const episodeGenProgress = ref('')
  const episodeGenPercentage = ref(null)
  const episodeGenProgressEstimated = ref(false)

  function getEpisode() {
    const epId = filterEpisodeId.value
    if (!epId) return null
    return (drama.value?.episodes || []).find((ep) => ep.id === epId) || null
  }

  function getStoryboardsForEpisode() {
    return getEpisode()?.storyboards || []
  }

  function buildStoryboardApiOptions() {
    const meta = parseDramaMetadata(drama.value?.metadata)
    const gen = getDramaGenerationOptions(drama.value)
    const ep = getEpisode()
    const scriptLen = (ep?.script_content || '').trim().length
    const durationMode = meta.storyboard_duration_mode === 'adaptive'
      ? 'adaptive'
      : meta.storyboard_duration_mode === 'fixed' || meta.video_clip_duration
        ? 'fixed'
        : 'adaptive'
    const videoDuration = durationMode === 'fixed' && scriptLen > 0
      ? Math.max(10, Math.round(10 + (scriptLen / 600) * 60))
      : undefined
    return {
      style: gen.style || undefined,
      aspect_ratio: gen.aspectRatio,
      video_duration: videoDuration,
      storyboard_duration_mode: durationMode,
      video_clip_duration: durationMode === 'fixed' ? Number(meta.video_clip_duration) || 5 : undefined,
      include_narration: !!meta.storyboard_include_narration,
      universal_omni_storyboard: !!meta.storyboard_universal_omni,
    }
  }

  function setSbBusy(sb, step, message, progress = null) {
    const sbNodeId = `sb:${sb.id}`
    const payload = {
      step,
      message,
      progress: progress?.percentage ?? null,
      progressEstimated: !!progress?.estimated,
    }
    nodeStatus?.set(sbNodeId, payload)
    if (step === 'image') nodeStatus?.set(`sbimg:${sb.id}`, payload)
    if (step === 'video') nodeStatus?.set(`sbvid:${sb.id}`, payload)
  }

  function updateBatchTaskProgress(sb, step, task, index, total, startedAt, previousProgress) {
    const progress = resolveGenerationProgress(task, {
      kind: step,
      previousProgress,
      startedAt,
      message: step === 'image' ? CANVAS_NODE_STATUS_LABELS.image : CANVAS_NODE_STATUS_LABELS.video,
    })
    setSbBusy(sb, step, progress.message, progress)
    episodeGenPercentage.value = Math.min(
      99,
      Math.round(((index + progress.percentage / 100) / Math.max(1, total)) * 100)
    )
    episodeGenProgressEstimated.value = progress.estimated
    return progress.percentage
  }

  function clearSbBusy(sb) {
    nodeStatus?.clear(`sb:${sb.id}`)
    nodeStatus?.clear(`sbimg:${sb.id}`)
    nodeStatus?.clear(`sbvid:${sb.id}`)
  }

  function clearEpisodeSbBusy() {
    for (const sb of getStoryboardsForEpisode()) clearSbBusy(sb)
  }

  function getGenOpts() {
    return {
      ...getDramaGenerationOptions(drama.value),
      imagesBySbId: imagesBySbId.value,
    }
  }

  async function aiGenerateStoryboards() {
    const ep = getEpisode()
    if (!ep) {
      ElMessage.warning('请先在顶栏选择某一集（AI 生成针对单集剧本）')
      return
    }
    if (!(ep.script_content || '').trim()) {
      ElMessage.warning('该集暂无剧本，请先在列表模式编写或导入剧本')
      return
    }
    const existing = getStoryboardsForEpisode()
    if (existing.length > 0) {
      try {
        await ElMessageBox.confirm(
          `第 ${ep.episode_number || ''} 集已有 ${existing.length} 个分镜。重新生成可能追加或覆盖内容，是否继续？`,
          'AI 生成分镜',
          { type: 'warning', confirmButtonText: '继续生成' }
        )
      } catch {
        return
      }
    }

    episodeGenerating.value = true
    episodeGenProgress.value = 'AI 正在根据剧本解析分镜…'
    episodeGenPercentage.value = null
    for (const sb of existing) {
      setSbBusy(sb, 'generate_sb', CANVAS_NODE_STATUS_LABELS.generate_sb)
    }
    const refreshTimer = setInterval(() => refreshCanvas(true), 2000)
    try {
      const res = await dramaAPI.generateStoryboard(ep.id, buildStoryboardApiOptions())
      const taskId = res?.task_id ?? (typeof res === 'string' ? res : null)
      if (taskId) {
        const polled = await pollTask(taskId, () => refreshCanvas(true))
        if (polled.status !== 'completed') {
          throw new Error(polled.error || '分镜生成失败')
        }
        if (polled.result?.truncated) {
          ElMessage.warning('AI 输出可能被截断，请检查分镜数量是否完整')
        }
      }
      await refreshCanvas(true)
      await storyboardsAPI.batchInferParams(ep.id, false).catch(() => {})
      const count = getStoryboardsForEpisode().length
      ElMessage.success(`分镜生成完成，共 ${count} 镜`)
    } catch (e) {
      ElMessage.error(e?.message || 'AI 生成分镜失败')
    } finally {
      clearInterval(refreshTimer)
      clearEpisodeSbBusy()
      episodeGenerating.value = false
      episodeGenProgress.value = ''
      episodeGenPercentage.value = null
      episodeGenProgressEstimated.value = false
    }
  }

  async function batchGenerateImages() {
    const ep = getEpisode()
    if (!ep) {
      ElMessage.warning('请先选择集数')
      return
    }
    const boards = getStoryboardsForEpisode()
    const todo = boards.filter(
      (sb) => sb.creation_mode !== 'universal' && !hasStoryboardImage(sb, imagesBySbId.value, drama.value)
    )
    if (!todo.length) {
      ElMessage.info('当前集分镜均已有图片（全能模式分镜请直接生视频）')
      return
    }
    try {
      await ElMessageBox.confirm(
        `将为 ${todo.length} 个分镜依次生图，耗时可能较长，是否继续？`,
        '批量生成分镜图',
        { type: 'info', confirmButtonText: '开始' }
      )
    } catch {
      return
    }

    episodeGenerating.value = true
    episodeGenPercentage.value = 0
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        const sb = todo[i]
        const taskStartedAt = Date.now()
        let taskProgress = 0
        episodeGenProgress.value = `批量生图 ${i + 1}/${todo.length}：分镜 #${sb.storyboard_number ?? sb.id}`
        setSbBusy(sb, 'image', `${CANVAS_NODE_STATUS_LABELS.image} ${i + 1}/${todo.length}`, { percentage: 1, estimated: true })
        try {
          await runImageStep(drama.value, sb, getGenOpts(), {
            onProgress: (task) => {
              taskProgress = updateBatchTaskProgress(
                sb, 'image', task, i, todo.length, taskStartedAt, taskProgress
              )
            },
          })
          ok++
          episodeGenPercentage.value = Math.round(((i + 1) / todo.length) * 100)
          await refreshCanvas(true)
        } catch (e) {
          failed++
          ElMessage.error(`分镜 #${sb.storyboard_number ?? sb.id} 生图失败：${e?.message || e}`)
        } finally {
          clearSbBusy(sb)
        }
      }
      if (failed === 0) ElMessage.success(`批量生图完成，共 ${ok} 镜`)
      else ElMessage.warning(`完成 ${ok} 镜，失败 ${failed} 镜`)
    } finally {
      episodeGenerating.value = false
      episodeGenProgress.value = ''
      episodeGenPercentage.value = null
      episodeGenProgressEstimated.value = false
    }
  }

  async function batchGenerateVideos() {
    const ep = getEpisode()
    if (!ep) {
      ElMessage.warning('请先选择集数')
      return
    }
    const boards = getStoryboardsForEpisode()
    const todo = boards.filter((sb) => !hasStoryboardVideo(sb, videosBySbId.value))
    if (!todo.length) {
      ElMessage.info('当前集分镜均已有视频')
      return
    }
    try {
      await ElMessageBox.confirm(
        `将为 ${todo.length} 个分镜依次生视频，是否继续？`,
        '批量生成分镜视频',
        { type: 'info', confirmButtonText: '开始' }
      )
    } catch {
      return
    }

    episodeGenerating.value = true
    episodeGenPercentage.value = 0
    let ok = 0
    let failed = 0
    try {
      for (let i = 0; i < todo.length; i++) {
        const sb = todo[i]
        const taskStartedAt = Date.now()
        let taskProgress = 0
        episodeGenProgress.value = `批量生视频 ${i + 1}/${todo.length}：分镜 #${sb.storyboard_number ?? sb.id}`
        setSbBusy(sb, 'video', `${CANVAS_NODE_STATUS_LABELS.video} ${i + 1}/${todo.length}`, { percentage: 1, estimated: true })
        try {
          await runVideoStep(drama.value, sb, getGenOpts(), {
            onProgress: (task) => {
              taskProgress = updateBatchTaskProgress(
                sb, 'video', task, i, todo.length, taskStartedAt, taskProgress
              )
            },
          })
          ok++
          episodeGenPercentage.value = Math.round(((i + 1) / todo.length) * 100)
          await refreshCanvas(true)
        } catch (e) {
          failed++
          ElMessage.error(`分镜 #${sb.storyboard_number ?? sb.id} 生视频失败：${e?.message || e}`)
        } finally {
          clearSbBusy(sb)
        }
      }
      if (failed === 0) ElMessage.success(`批量生视频完成，共 ${ok} 镜`)
      else ElMessage.warning(`完成 ${ok} 镜，失败 ${failed} 镜`)
    } finally {
      episodeGenerating.value = false
      episodeGenProgress.value = ''
      episodeGenPercentage.value = null
      episodeGenProgressEstimated.value = false
    }
  }

  return {
    episodeGenerating,
    episodeGenProgress,
    episodeGenPercentage,
    episodeGenProgressEstimated,
    aiGenerateStoryboards,
    batchGenerateImages,
    batchGenerateVideos,
  }
}

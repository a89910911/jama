import { taskAPI } from '@/api/task'
import { imagesAPI } from '@/api/images'
import { videosAPI } from '@/api/videos'
import { storyboardsAPI } from '@/api/storyboards'
import { characterLookAPI } from '@/api/characterLooks'
import request from '@/utils/request'
import { storyboardImageUrl } from '@/utils/mediaUrl'
import {
  DEFAULT_PIPELINE,
  findStoryboardInDrama,
  getDramaGenerationOptions,
  toAbsoluteMediaUrl,
} from '@/utils/canvasWorkflow'
import {
  sbVideoFirstLastUrls,
  storyboardUsesFirstLastFrame,
} from '@/utils/storyboardMedia'

async function pollTaskSimple(taskId, options = {}) {
  if (!taskId) return { status: 'failed', error: '缺少 task_id' }
  const maxAttempts = options.maxAttempts ?? 450
  const interval = options.interval ?? 2000
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, interval))
    try {
      const t = await taskAPI.get(taskId)
      options.onProgress?.(t)
      if (t.status === 'completed') return { status: 'completed', result: t.result }
      if (t.status === 'failed') {
        return { status: 'failed', error: t.error?.message || t.error || '任务失败' }
      }
    } catch (e) {
      if (i === maxAttempts - 1) return { status: 'failed', error: e.message || '轮询失败' }
    }
  }
  return { status: 'timeout', error: '任务超时' }
}

function assertGenerationResultCurrent(polled) {
  if (polled?.result?.superseded) {
    throw new Error('生成期间角色造型或分镜上下文已变化，结果仅保留在历史记录中，请按当前造型重新生成')
  }
}

async function assertEpisodeVisualPreflight(sb) {
  if (!sb?.episode_id) return
  const report = await characterLookAPI.preflight(sb.episode_id, true)
  const errors = report?.errors || (report?.issues || []).filter((item) => item.level === 'error')
  if (errors.length) {
    const summary = errors.slice(0, 3).map((item) => item.message || item.code).join('；')
    throw new Error(`造型连戏预检未通过：${summary}`)
  }
}

export async function runImageStep(drama, sb, genOpts, hooks = {}) {
  await assertEpisodeVisualPreflight(sb)
  const basePrompt = sb.polished_prompt || sb.image_prompt || sb.description || sb.action || ''
  if (!basePrompt.trim()) throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少图片提示词`)
  const useFirstLast = storyboardUsesFirstLastFrame(sb, drama)
  const frameSlots = useFirstLast ? ['first', 'last'] : [null]

  for (const slot of frameSlots) {
    let prompt = basePrompt
    if (slot) {
      const framePromptTask = await storyboardsAPI.generateFramePrompt(sb.id, { frame_type: slot })
      if (!framePromptTask?.task_id) throw new Error(`${slot === 'last' ? '尾帧' : '首帧'}专业提示词任务未创建`)
      const framePromptResult = await pollTaskSimple(framePromptTask.task_id, { onProgress: hooks.onProgress })
      if (framePromptResult.status !== 'completed') {
        throw new Error(framePromptResult.error || `${slot === 'last' ? '尾帧' : '首帧'}专业提示词生成失败`)
      }
      prompt = framePromptResult.result?.response?.single_frame?.prompt || ''
      if (!String(prompt).trim()) {
        const cached = await storyboardsAPI.getFramePrompts(sb.id)
        prompt = (cached?.frame_prompts || []).find((row) => row.frame_type === slot)?.prompt || ''
      }
      if (!String(prompt).trim()) throw new Error(`${slot === 'last' ? '尾帧' : '首帧'}专业提示词为空`)
    }

    const res = await imagesAPI.create({
      storyboard_id: sb.id,
      drama_id: drama.id,
      prompt,
      style: genOpts.style || undefined,
      frame_type: slot ? `storyboard_${slot}` : undefined,
      aspect_ratio: genOpts.aspectRatio,
      use_first_frame_layout_lock: slot === 'last' ? true : undefined,
    })
    if (res?.task_id) {
      const polled = await pollTaskSimple(res.task_id, { onProgress: hooks.onProgress })
      if (polled.status !== 'completed') throw new Error(polled.error || '分镜图生成失败')
      assertGenerationResultCurrent(polled)
    }
  }
}

export async function runVideoStep(drama, sb, genOpts, hooks = {}) {
  await assertEpisodeVisualPreflight(sb)
  const useFirstLast = storyboardUsesFirstLastFrame(sb, drama)
  const imagesBySbId = genOpts?.imagesBySbId || {}
  const { first, last } = sbVideoFirstLastUrls(sb, imagesBySbId, useFirstLast)
  const imgPath = first || storyboardImageUrl(sb)
  if (!imgPath && !sb.video_prompt && !last) {
    throw new Error(`分镜 #${sb.storyboard_number ?? sb.id} 缺少分镜图，无法生成视频`)
  }
  const absoluteFirst = toAbsoluteMediaUrl(imgPath)
  const absoluteLast = last ? toAbsoluteMediaUrl(last) : undefined
  const prompt = sb.video_prompt || sb.polished_prompt || sb.image_prompt || sb.description || ''
  const res = await videosAPI.create({
    drama_id: drama.id,
    storyboard_id: sb.id,
    prompt,
    image_url: absoluteFirst || undefined,
    first_frame_url: absoluteFirst || undefined,
    last_frame_url: absoluteLast,
    style: genOpts.style || undefined,
    aspect_ratio: genOpts.aspectRatio,
    resolution: genOpts.videoResolution || undefined,
    duration: sb.duration || undefined,
  })
  if (res?.task_id) {
    const polled = await pollTaskSimple(res.task_id, { onProgress: hooks.onProgress })
    if (polled.status !== 'completed') throw new Error(polled.error || '视频生成失败')
    assertGenerationResultCurrent(polled)
  }
}

export async function runAudioStep(sb) {
  const text = (sb.dialogue || '').trim()
  if (!text) return { skipped: true, reason: '无对白' }
  await request.post('/audio/extract', {
    storyboard_id: sb.id,
    text,
    tts_kind: 'dialogue',
  })
  return { skipped: false }
}

/**
 * 对单个分镜按 pipeline 顺序执行生成
 * @param {'image'|'video'|'audio'}[] pipeline
 */
export async function runStoryboardPipeline(drama, storyboardId, pipeline, hooks = {}) {
  const found = findStoryboardInDrama(drama, storyboardId)
  if (!found) throw new Error(`找不到分镜 ${storyboardId}`)
  let { storyboard: sb } = found
  const genOpts = {
    ...getDramaGenerationOptions(drama),
    ...(hooks.generationOptions || {}),
  }
  const steps = pipeline?.length ? pipeline : DEFAULT_PIPELINE
  const results = []

  for (const step of steps) {
    hooks.onStepStart?.({ storyboardId, step, sb })
    try {
      if (step === 'image') {
        await runImageStep(drama, sb, genOpts, {
          onProgress: (task) => hooks.onStepProgress?.({ storyboardId, step, sb, task }),
        })
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId)) || sb
        }
      } else if (step === 'video') {
        await runVideoStep(drama, sb, genOpts, {
          onProgress: (task) => hooks.onStepProgress?.({ storyboardId, step, sb, task }),
        })
        if (hooks.reloadStoryboard) {
          sb = (await hooks.reloadStoryboard(storyboardId)) || sb
        }
      } else if (step === 'audio') {
        const audioRes = await runAudioStep(sb)
        results.push({ step, ...audioRes })
      }
      hooks.onStepComplete?.({ storyboardId, step, sb })
    } catch (err) {
      hooks.onStepError?.({ storyboardId, step, error: err })
      throw err
    }
  }
  return results
}

/** 按工作流组顺序执行（组内分镜按 storyboard_ids 顺序） */
export async function runWorkflowGroup(drama, group, hooks = {}) {
  const pipeline = group.pipeline || DEFAULT_PIPELINE
  const ids = group.storyboard_ids || []
  const summary = { groupId: group.id, ok: [], failed: [] }

  for (const sbId of ids) {
    hooks.onStoryboardStart?.({ group, storyboardId: sbId })
    try {
      await runStoryboardPipeline(drama, sbId, pipeline, hooks)
      summary.ok.push(sbId)
      hooks.onStoryboardComplete?.({ group, storyboardId: sbId })
    } catch (err) {
      summary.failed.push({ storyboardId: sbId, error: err.message || String(err) })
      hooks.onStoryboardError?.({ group, storyboardId: sbId, error: err })
      if (hooks.stopOnError) break
    }
  }
  return summary
}

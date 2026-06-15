<template>
  <div class="canvas-node-panel nodrag nopan nowheel" @pointerdown.stop @mousedown.stop>
    <div class="panel-head">
      <span>分镜 #{{ storyboard?.storyboard_number ?? storyboard?.id }}</span>
      <el-button link size="small" type="primary" @click="openListMode">列表模式</el-button>
    </div>

    <el-form label-position="top" size="small" class="panel-form">
      <template v-if="isUniversal">
        <el-form-item label="全能分镜词">
          <el-input v-model="form.universal_segment_text" type="textarea" :rows="6" placeholder="全能模式片段描述" />
        </el-form-item>
        <el-form-item label="视频提示词">
          <el-input v-model="form.video_prompt" type="textarea" :rows="2" placeholder="生视频用提示词（可选）" />
        </el-form-item>
      </template>
      <template v-else>
        <el-form-item label="动作">
          <el-input v-model="form.action" type="textarea" :rows="2" placeholder="画面动作描述" />
        </el-form-item>
        <el-form-item label="对白">
          <el-input v-model="form.dialogue" type="textarea" :rows="2" placeholder="角色对白" />
        </el-form-item>
        <el-form-item label="图片提示词">
          <el-input v-model="form.image_prompt" type="textarea" :rows="3" placeholder="生图用提示词" />
        </el-form-item>
        <el-form-item label="视频提示词">
          <el-input v-model="form.video_prompt" type="textarea" :rows="2" placeholder="生视频用提示词" />
        </el-form-item>
      </template>
    </el-form>

    <div class="panel-actions">
      <el-button size="small" :loading="saving" @click="saveFields">保存</el-button>
      <el-button v-if="!isUniversal" size="small" :loading="busyStep === 'polish'" @click="polishPrompt">润色提示词</el-button>
    </div>
    <div class="panel-actions gen-row">
      <el-button v-if="!isUniversal" size="small" type="primary" :loading="busyStep === 'image'" @click="runStep('image')">生图</el-button>
      <el-button size="small" type="primary" :loading="busyStep === 'video'" @click="runStep('video')">生视频</el-button>
      <el-button size="small" type="warning" :loading="busyStep === 'audio'" @click="runStep('audio')">配音</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { storyboardsAPI } from '@/api/storyboards'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { runImageStep, runVideoStep, runAudioStep } from '@/composables/useCanvasWorkflowRunner'
import { findStoryboardInDrama, getDramaGenerationOptions } from '@/utils/canvasWorkflow'

const props = defineProps({
  storyboard: { type: Object, required: true },
  episodeId: { type: Number, default: null },
})

const router = useRouter()
const ctx = useCanvasContext()
const saving = ref(false)
const busyStep = ref('')
const form = reactive({
  action: '',
  dialogue: '',
  image_prompt: '',
  video_prompt: '',
  universal_segment_text: '',
})

const isUniversal = computed(() => props.storyboard?.creation_mode === 'universal')

function syncForm(sb) {
  form.action = sb?.action || ''
  form.dialogue = sb?.dialogue || ''
  form.image_prompt = sb?.image_prompt || sb?.polished_prompt || ''
  form.video_prompt = sb?.video_prompt || ''
  form.universal_segment_text = sb?.universal_segment_text || ''
}

watch(() => props.storyboard, (sb) => syncForm(sb), { immediate: true, deep: true })

function openListMode() {
  const dramaId = ctx?.drama?.value?.id
  if (!dramaId) return
  router.push({
    path: `/film/${dramaId}`,
    query: props.episodeId ? { episode: String(props.episodeId) } : {},
    hash: props.storyboard?.id ? `#sb-${props.storyboard.id}` : undefined,
  })
}

async function persistForm(silent = false) {
  if (!props.storyboard?.id) return
  const payload = isUniversal.value
    ? {
        universal_segment_text: form.universal_segment_text.trim() || null,
        video_prompt: form.video_prompt.trim() || null,
      }
    : {
        action: form.action.trim() || null,
        dialogue: form.dialogue.trim() || null,
        image_prompt: form.image_prompt.trim() || null,
        video_prompt: form.video_prompt.trim() || null,
      }
  await storyboardsAPI.update(props.storyboard.id, payload)
  if (!silent) ElMessage.success('已保存')
}

async function saveFields() {
  if (!props.storyboard?.id) return
  saving.value = true
  try {
    await persistForm(false)
    await ctx?.refresh?.()
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
  }
}

async function polishPrompt() {
  if (!props.storyboard?.id) return
  busyStep.value = 'polish'
  try {
    const res = await storyboardsAPI.polishPrompt(props.storyboard.id)
    if (res?.polished_prompt) form.image_prompt = res.polished_prompt
    ElMessage.success('提示词已润色')
    await ctx?.refresh?.()
  } catch (e) {
    ElMessage.error(e?.message || '润色失败')
  } finally {
    busyStep.value = ''
  }
}

async function runStep(step) {
  const drama = ctx?.drama?.value
  const sbId = props.storyboard?.id
  if (!drama || !sbId) return

  if (step !== 'audio') {
    try {
      await persistForm(true)
    } catch (e) {
      ElMessage.error(e?.message || '保存失败')
      return
    }
  }

  busyStep.value = step
  try {
    const found = findStoryboardInDrama(drama, sbId)
    const sb = found?.storyboard || props.storyboard
    const genOpts = ctx?.getGenerationOptions?.() || getDramaGenerationOptions(drama)
    if (step === 'image') await runImageStep(drama, sb, genOpts)
    else if (step === 'video') await runVideoStep(drama, sb, genOpts)
    else if (step === 'audio') {
      const res = await runAudioStep(sb)
      if (res?.skipped) {
        ElMessage.info(res.reason || '已跳过')
        return
      }
    }
    ElMessage.success(step === 'image' ? '生图完成' : step === 'video' ? '视频生成完成' : '配音完成')
    await ctx?.refresh?.()
  } catch (e) {
    ElMessage.error(e?.message || '生成失败')
  } finally {
    busyStep.value = ''
  }
}
</script>

<style scoped>
.canvas-node-panel {
  margin-top: 10px;
  width: 280px;
  padding: 10px 12px 12px;
  border-radius: 12px;
  border: 1px solid rgba(129, 140, 248, 0.45);
  background: rgba(15, 15, 18, 0.96);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #c7d2fe;
}
.panel-form :deep(.el-form-item) {
  margin-bottom: 8px;
}
.panel-form :deep(.el-form-item__label) {
  color: #71717a;
  font-size: 11px;
  padding-bottom: 2px;
}
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 4px;
}
.gen-row {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(63, 63, 70, 0.8);
}
</style>

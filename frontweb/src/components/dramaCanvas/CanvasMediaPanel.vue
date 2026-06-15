<template>
  <div class="canvas-node-panel nodrag nopan nowheel" :class="'kind-' + kind" @pointerdown.stop @mousedown.stop>
    <div class="panel-head">{{ kindTitle }}</div>

    <template v-if="kind === 'text'">
      <p class="summary">{{ summary }}</p>
      <el-button size="small" type="primary" plain @click="focusStoryboard">编辑分镜文案</el-button>
    </template>

    <template v-else-if="kind === 'universal'">
      <p class="summary universal-summary">{{ summary || '暂无全能分镜词' }}</p>
      <div class="panel-actions">
        <el-button size="small" plain @click="focusStoryboard">编辑全能词</el-button>
        <el-button size="small" type="primary" :loading="busy" @click="runStep('video')">重新生视频</el-button>
      </div>
    </template>

    <template v-else-if="kind === 'image'">
      <img v-if="url" :src="url" alt="" class="preview-img" />
      <el-button size="small" type="primary" :loading="busy" @click="runStep('image')">重新生图</el-button>
    </template>

    <template v-else-if="kind === 'video'">
      <video v-if="url" :src="url" class="preview-vid" controls playsinline />
      <el-button size="small" type="primary" :loading="busy" @click="runStep('video')">重新生视频</el-button>
    </template>

    <template v-else-if="kind === 'audio'">
      <div class="audio-label">{{ audioType === 'narration' ? '旁白音频' : '对白音频' }}</div>
      <audio v-if="url" :src="url" controls class="preview-aud" />
      <el-button size="small" type="warning" :loading="busy" @click="runStep('audio')">重新配音</el-button>
    </template>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { runImageStep, runVideoStep, runAudioStep } from '@/composables/useCanvasWorkflowRunner'
import { findStoryboardInDrama, getDramaGenerationOptions } from '@/utils/canvasWorkflow'

const props = defineProps({
  kind: { type: String, required: true },
  storyboard: { type: Object, default: null },
  summary: { type: String, default: '' },
  url: { type: String, default: '' },
  audioType: { type: String, default: 'dialogue' },
})

const ctx = useCanvasContext()
const busy = ref(false)

const kindTitle = computed(() => {
  const map = { text: '文本节点', universal: '全能分镜词', image: '分镜图', video: '视频', audio: '音频' }
  return map[props.kind] || '媒体'
})

function focusStoryboard() {
  const sbId = props.storyboard?.id
  if (sbId) ctx?.setFocusedNode?.(`sb:${sbId}`)
}

async function runStep(step) {
  const drama = ctx?.drama?.value
  const sbId = props.storyboard?.id
  if (!drama || !sbId) return
  busy.value = true
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
    ElMessage.success('生成完成')
    await ctx?.refresh?.()
  } catch (e) {
    ElMessage.error(e?.message || '生成失败')
  } finally {
    busy.value = false
  }
}
</script>

<style scoped>
.canvas-node-panel {
  margin-top: 10px;
  width: 220px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid rgba(129, 140, 248, 0.4);
  background: rgba(15, 15, 18, 0.96);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
}
.panel-head {
  font-size: 11px;
  font-weight: 700;
  color: #a5b4fc;
  margin-bottom: 8px;
}
.summary {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 1.45;
  color: #d4d4d8;
  max-height: 88px;
  overflow-y: auto;
}
.preview-img,
.preview-vid {
  width: 100%;
  border-radius: 6px;
  margin-bottom: 8px;
  background: #09090b;
}
.preview-img { height: 100px; object-fit: cover; }
.preview-vid { height: 100px; object-fit: cover; }
.preview-aud {
  width: 100%;
  margin-bottom: 8px;
}
.audio-label {
  font-size: 11px;
  color: #fbbf24;
  margin-bottom: 6px;
}
.kind-video { border-color: rgba(244, 114, 182, 0.45); }
.kind-universal { border-color: rgba(167, 139, 250, 0.45); }
.universal-summary { max-height: 160px; }
.kind-audio { border-color: rgba(251, 191, 36, 0.45); }
</style>

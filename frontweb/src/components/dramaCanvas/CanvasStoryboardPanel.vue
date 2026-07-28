<template>
  <div
    class="canvas-node-panel sb-panel nodrag nopan nowheel"
    @pointerdown.stop
    @mousedown.stop
    @click.stop
    @mouseup.stop
    @wheel.stop
  >
    <div class="panel-head">
      <span>分镜 #{{ storyboard?.storyboard_number ?? storyboard?.id }}</span>
      <div class="head-actions">
        <span v-if="busyLabel" class="busy-tag">{{ busyLabel }}</span>
        <el-button link size="small" type="primary" @click.stop="openListMode">列表详情</el-button>
        <el-button link size="small" @click.stop="closePanel">收起</el-button>
      </div>
    </div>

    <el-form label-position="left" label-width="36px" size="small" class="panel-form compact-form">
      <el-form-item label="标题">
        <el-input v-model="form.title" placeholder="分镜标题" @blur="saveMeta" />
      </el-form-item>

      <div class="relation-row">
        <el-form-item label="角色" class="rel-item">
          <el-select
            v-model="characterIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            filterable
            placeholder="角色"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="onSelectVisibleChange"
            @change="onRelationChange"
          >
            <el-option
              v-for="c in characters"
              :key="c.id"
              :label="c.name || '未命名'"
              :value="normalizeEntityId(c.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="场景" class="rel-item">
          <el-select
            v-model="sceneId"
            clearable
            filterable
            placeholder="场景"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="onSelectVisibleChange"
            @change="onRelationChange"
          >
            <el-option
              v-for="s in scenes"
              :key="s.id"
              :label="s.location || '未命名'"
              :value="normalizeEntityId(s.id)"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="道具" class="rel-item">
          <el-select
            v-model="propIds"
            multiple
            collapse-tags
            collapse-tags-tooltip
            filterable
            placeholder="道具"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="onSelectVisibleChange"
            @change="onRelationChange"
          >
            <el-option
              v-for="p in propsList"
              :key="p.id"
              :label="p.name || '未命名'"
              :value="normalizeEntityId(p.id)"
            />
          </el-select>
        </el-form-item>
      </div>
      <div class="inline-add-row">
        <el-button link type="primary" size="small" @click.stop="createAsset('character')">+角色</el-button>
        <el-button link type="primary" size="small" @click.stop="createAsset('scene')">+场景</el-button>
        <el-button link type="primary" size="small" @click.stop="createAsset('prop')">+道具</el-button>
      </div>

      <div class="meta-row">
        <el-form-item label="景别" class="meta-item">
          <el-input v-model="form.shot_type" placeholder="特写" @blur="saveMeta" />
        </el-form-item>
        <el-form-item label="时长" class="meta-item narrow">
          <el-input-number v-model="form.duration" :min="1" :max="120" controls-position="right" @change="saveMeta" />
        </el-form-item>
      </div>
      <div v-if="selectedCharacters.length" class="look-bindings">
        <div
          v-for="character in selectedCharacters"
          :key="`look-${character.id}`"
          class="look-binding-row"
        >
          <span>{{ character.name || '未命名' }}</span>
          <el-select
            :model-value="effectiveLook(character.id)?.look?.id || null"
            clearable
            placeholder="继承上级造型"
            teleported
            popper-class="canvas-panel-popper"
            @visible-change="(open) => open && loadCharacterLooks(character.id)"
            @change="(lookId) => changeLook(character.id, lookId)"
          >
            <el-option
              v-for="look in looksByCharacter[character.id] || []"
              :key="look.id"
              :label="`${look.name}${look.is_default ? '（默认）' : ''}`"
              :value="look.id"
            />
          </el-select>
          <small>{{ lookSourceLabel(effectiveLook(character.id)?.binding_source) }}</small>
          <el-input
            v-if="effectiveLook(character.id)?.binding_source === 'storyboard'"
            class="look-transition-note"
            :model-value="effectiveLook(character.id)?.binding?.transition_note || ''"
            placeholder="换装说明（同场切换时必填）"
            @change="(note) => changeLookTransitionNote(character.id, note)"
          />
        </div>
      </div>
      <div class="storyboard-mode-row">
        <span>本镜配置优先全局</span>
        <el-checkbox
          v-model="form.use_first_last_frame"
          :disabled="isUniversal"
        >
          首尾帧参考图
        </el-checkbox>
        <el-checkbox
          :model-value="isUniversal"
          @change="onUniversalModeChange"
        >
          全能分镜
        </el-checkbox>
      </div>

      <template v-if="isUniversal">
        <el-form-item label="全能词">
          <el-input
            v-model="form.universal_segment_text"
            type="textarea"
            :rows="2"
            resize="vertical"
            placeholder="全能模式片段描述"
          />
        </el-form-item>
        <el-form-item label="视频词">
          <el-input
            v-model="form.video_prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            placeholder="生视频提示词"
          />
        </el-form-item>
      </template>
      <template v-else>
        <div class="text-row-2">
          <el-form-item label="动作" class="flex-1">
            <el-input
              v-model="form.action"
              type="textarea"
              :rows="2"
              resize="vertical"
              placeholder="画面动作"
            />
          </el-form-item>
          <el-form-item label="对白" class="flex-1">
            <el-input
              v-model="form.dialogue"
              type="textarea"
              :rows="2"
              resize="vertical"
              placeholder="角色对白"
            />
          </el-form-item>
        </div>
        <el-form-item label="生图词">
          <el-input
            v-model="form.image_prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            placeholder="图片提示词"
          />
        </el-form-item>
        <el-form-item label="视频词">
          <el-input
            v-model="form.video_prompt"
            type="textarea"
            :rows="2"
            resize="vertical"
            placeholder="视频提示词"
          />
        </el-form-item>
      </template>
    </el-form>

    <div class="panel-actions">
      <el-button size="small" :loading="saving" @click.stop="saveFields">保存</el-button>
      <el-button v-if="!isUniversal" size="small" :loading="busyStep === 'polish'" @click.stop="polishPrompt">润色</el-button>
      <el-button size="small" type="primary" :loading="busyStep === 'image'" @click.stop="runStep('image')">生图</el-button>
      <el-button size="small" type="primary" :loading="busyStep === 'video'" @click.stop="runStep('video')">生视频</el-button>
      <el-button size="small" type="warning" :loading="busyStep === 'audio'" @click.stop="runStep('audio')">配音</el-button>
      <el-button size="small" type="danger" plain @click.stop="deleteStoryboard">删除</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { storyboardsAPI } from '@/api/storyboards'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { CANVAS_NODE_STATUS_LABELS } from '@/composables/useCanvasNodeStatus'
import {
  normalizeEntityId,
  parseStoryboardCharacterIds,
  parseStoryboardPropIds,
  parseStoryboardSceneId,
} from '@/utils/canvasEntityIds'
import { runImageStep, runVideoStep, runAudioStep } from '@/composables/useCanvasWorkflowRunner'
import { findStoryboardInDrama, getDramaGenerationOptions } from '@/utils/canvasWorkflow'
import { resolveGenerationProgress } from '@/utils/generationProgress'
import { dramaUsesFirstLastFrame } from '@/utils/storyboardMedia'
import { saveStoryboardWorkspace } from '@/utils/storyboardWorkspaceSave'
import { characterLookAPI } from '@/api/characterLooks'

const props = defineProps({
  storyboard: { type: Object, required: true },
  episodeId: { type: Number, default: null },
  nodeId: { type: String, default: '' },
})

const router = useRouter()
const ctx = useCanvasContext()
const saving = ref(false)
const busyStep = ref('')
const characterIds = ref([])
const sceneId = ref(null)
const propIds = ref([])
const visualContext = ref(null)
const looksByCharacter = reactive({})
const form = reactive({
  title: '',
  action: '',
  dialogue: '',
  image_prompt: '',
  video_prompt: '',
  universal_segment_text: '',
  creation_mode: 'classic',
  use_first_last_frame: false,
  shot_type: '',
  duration: 5,
})

const sbNodeId = computed(() => props.nodeId || (props.storyboard?.id ? `sb:${props.storyboard.id}` : ''))

const isUniversal = computed(() => form.creation_mode === 'universal')
const characters = computed(() => ctx?.drama?.value?.characters || [])
const scenes = computed(() => ctx?.drama?.value?.scenes || [])
const propsList = computed(() => ctx?.drama?.value?.props || [])
const selectedCharacters = computed(() => {
  const selected = new Set(characterIds.value.map(Number))
  return characters.value.filter((item) => selected.has(Number(item.id)))
})

const busyLabel = computed(() => {
  const map = ctx?.nodeStatus?.map
  const st = map && sbNodeId.value ? map[sbNodeId.value] : null
  return st?.message || (busyStep.value ? CANVAS_NODE_STATUS_LABELS[busyStep.value] : '')
})

function syncForm(sb) {
  form.title = sb?.title || ''
  form.action = sb?.action || ''
  form.dialogue = sb?.dialogue || ''
  form.image_prompt = sb?.image_prompt || sb?.polished_prompt || ''
  form.video_prompt = sb?.video_prompt || ''
  form.universal_segment_text = sb?.universal_segment_text || ''
  form.creation_mode = sb?.creation_mode === 'universal' ? 'universal' : 'classic'
  form.use_first_last_frame = sb?.use_first_last_frame == null
    ? dramaUsesFirstLastFrame(ctx?.drama?.value)
    : !!sb.use_first_last_frame
  form.shot_type = sb?.shot_type || ''
  form.duration = sb?.duration != null ? Number(sb.duration) : 5
  characterIds.value = parseStoryboardCharacterIds(sb)
  sceneId.value = parseStoryboardSceneId(sb)
  propIds.value = parseStoryboardPropIds(sb)
}

watch(() => props.storyboard, (sb) => {
  syncForm(sb)
  loadVisualContext()
}, { immediate: true, deep: true })

async function loadVisualContext() {
  if (!props.storyboard?.id) return
  try {
    visualContext.value = await characterLookAPI.storyboardContext(props.storyboard.id)
    for (const item of visualContext.value?.characters || []) {
      if (!item.look) continue
      const list = looksByCharacter[item.character_id] || []
      if (!list.some((look) => Number(look.id) === Number(item.look.id))) {
        looksByCharacter[item.character_id] = [...list, item.look]
      }
    }
  } catch (error) {
    console.warn('加载分镜造型上下文失败', error)
  }
}

async function loadCharacterLooks(characterId) {
  if (looksByCharacter[characterId]) return
  const data = await characterLookAPI.list(characterId)
  looksByCharacter[characterId] = data?.items || []
}

function effectiveLook(characterId) {
  return visualContext.value?.characters?.find(
    (item) => Number(item.character_id) === Number(characterId)
  ) || null
}

function lookSourceLabel(source) {
  return {
    storyboard: '本镜覆盖',
    scene_block: '场次继承',
    episode: '本集继承',
    default: '角色默认',
    default_fallback: '默认回退',
  }[source] || '上级继承'
}

async function changeLook(characterId, lookId) {
  try {
    const current = effectiveLook(characterId)
    if (lookId == null || lookId === '') {
      if (current?.binding_source === 'storyboard') {
        await characterLookAPI.unbind('storyboard', props.storyboard.id, characterId)
      }
    } else {
      await characterLookAPI.bind({
        scope_type: 'storyboard',
        scope_id: props.storyboard.id,
        character_id: characterId,
        look_id: lookId,
        source: 'manual',
      })
    }
    await loadVisualContext()
    ElMessage.success('分镜造型已更新')
  } catch (error) {
    ElMessage.error(error?.message || '造型绑定失败')
  }
}

function onSelectVisibleChange(open) {
  if (open) ctx?.suppressPaneClick?.()
  else ctx?.suppressPaneClick?.(400)
}

async function changeLookTransitionNote(characterId, note) {
  const current = effectiveLook(characterId)
  if (current?.binding_source !== 'storyboard' || !current.look?.id) return
  try {
    await characterLookAPI.bind({
      scope_type: 'storyboard',
      scope_id: props.storyboard.id,
      character_id: characterId,
      look_id: current.look.id,
      source: 'manual',
      transition_note: String(note || '').trim() || null,
    })
    await loadVisualContext()
    ElMessage.success('换装说明已保存')
  } catch (error) {
    ElMessage.error(error?.message || '保存换装说明失败')
  }
}

function onUniversalModeChange(enabled) {
  form.creation_mode = enabled ? 'universal' : 'classic'
  if (enabled) form.use_first_last_frame = false
}

function closePanel() {
  ctx?.clearFocusedNode?.()
}

function createAsset(type) {
  ctx?.openCreateDialog?.(type)
}

function openListMode() {
  const dramaId = ctx?.drama?.value?.id
  if (!dramaId) return
  router.push({
    path: `/film/${dramaId}`,
    query: props.episodeId ? { episode: String(props.episodeId) } : {},
    hash: props.storyboard?.id ? `#sb-${props.storyboard.id}` : undefined,
  })
}

async function onRelationChange() {
  if (!props.storyboard?.id) return
  try {
    await storyboardsAPI.update(props.storyboard.id, {
      character_ids: characterIds.value,
      scene_id: sceneId.value,
      prop_ids: propIds.value,
    })
    await ctx?.refreshDrama?.(true)
    await loadVisualContext()
  } catch (e) {
    ElMessage.error(e?.message || '关联保存失败')
  }
}

async function saveMeta() {
  if (!props.storyboard?.id) return
  try {
    await storyboardsAPI.update(props.storyboard.id, {
      title: form.title.trim() || null,
      shot_type: form.shot_type.trim() || null,
      duration: form.duration ?? 5,
    })
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  }
}

async function persistForm(silent = false, options = {}) {
  if (!props.storyboard?.id) return
  const modePayload = {
    creation_mode: isUniversal.value ? 'universal' : 'classic',
    use_first_last_frame: isUniversal.value ? false : !!form.use_first_last_frame,
  }
  const payload = isUniversal.value
    ? {
        ...modePayload,
        title: form.title.trim() || null,
        universal_segment_text: form.universal_segment_text.trim() || null,
        video_prompt: form.video_prompt.trim() || null,
        shot_type: form.shot_type.trim() || null,
        duration: form.duration ?? 5,
      }
    : {
        ...modePayload,
        title: form.title.trim() || null,
        action: form.action.trim() || null,
        dialogue: form.dialogue.trim() || null,
        image_prompt: form.image_prompt.trim() || null,
        video_prompt: form.video_prompt.trim() || null,
        shot_type: form.shot_type.trim() || null,
        duration: form.duration ?? 5,
      }
  let result = { rebuiltVideoPrompt: false, storyboard: null }
  if (options.rebuildClassicVideoPrompt) {
    result = await saveStoryboardWorkspace(storyboardsAPI, props.storyboard.id, payload)
    if (result.storyboard?.video_prompt != null) {
      form.video_prompt = result.storyboard.video_prompt
    }
  } else {
    await storyboardsAPI.update(props.storyboard.id, payload)
  }
  if (!silent) {
    ElMessage.success(result.rebuiltVideoPrompt ? '已保存并更新视频提示词' : '已保存')
  }
  return result.storyboard
}

async function saveFields() {
  if (!props.storyboard?.id) return
  saving.value = true
  ctx?.nodeStatus?.set(sbNodeId.value, { step: 'save', message: CANVAS_NODE_STATUS_LABELS.save })
  try {
    await persistForm(false, { rebuildClassicVideoPrompt: true })
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(e?.message || '保存失败')
  } finally {
    saving.value = false
    if (!busyStep.value) ctx?.nodeStatus?.clear(sbNodeId.value)
  }
}

async function deleteStoryboard() {
  if (!props.storyboard?.id) return
  try {
    await ElMessageBox.confirm('确定删除该分镜？此操作不可恢复。', '删除分镜', {
      type: 'warning',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
    await storyboardsAPI.delete(props.storyboard.id)
    ctx?.clearFocusedNode?.()
    ElMessage.success('分镜已删除')
    await ctx?.refresh?.()
  } catch (e) {
    if (e === 'cancel') return
    ElMessage.error(e?.message || '删除失败')
  }
}

async function polishPrompt() {
  if (!props.storyboard?.id) return
  busyStep.value = 'polish'
  ctx?.nodeStatus?.set(sbNodeId.value, { step: 'polish', message: CANVAS_NODE_STATUS_LABELS.polish })
  try {
    const res = await storyboardsAPI.polishPrompt(props.storyboard.id)
    if (res?.polished_prompt) form.image_prompt = res.polished_prompt
    ElMessage.success('提示词已润色')
    await ctx?.refreshDrama?.(true)
  } catch (e) {
    ElMessage.error(e?.message || '润色失败')
  } finally {
    busyStep.value = ''
    ctx?.nodeStatus?.clear(sbNodeId.value)
  }
}

async function runStep(step) {
  const drama = ctx?.drama?.value
  const sbId = props.storyboard?.id
  if (!drama || !sbId) return

  let savedStoryboard = null
  if (step !== 'audio') {
    try {
      savedStoryboard = await persistForm(true, {
        rebuildClassicVideoPrompt: step === 'video',
      })
    } catch (e) {
      ElMessage.error(e?.message || '保存失败')
      return
    }
  }

  busyStep.value = step
  const statusMsg = CANVAS_NODE_STATUS_LABELS[step] || '处理中…'
  const startedAt = Date.now()
  let previousProgress = 0
  const updateProgress = (task) => {
    const progress = resolveGenerationProgress(task, {
      kind: step,
      previousProgress,
      startedAt,
      message: statusMsg,
    })
    previousProgress = progress.percentage
    const payload = {
      step,
      message: progress.message,
      progress: progress.percentage,
      progressEstimated: progress.estimated,
    }
    ctx?.nodeStatus?.set(sbNodeId.value, payload)
    if (step === 'image') ctx?.nodeStatus?.set(`sbimg:${sbId}`, payload)
    if (step === 'video') ctx?.nodeStatus?.set(`sbvid:${sbId}`, payload)
  }
  updateProgress({ status: 'processing', progress: 0 })
  try {
    const found = findStoryboardInDrama(drama, sbId)
    const sb = savedStoryboard || found?.storyboard || props.storyboard
    const genOpts = ctx?.getGenerationOptions?.() || getDramaGenerationOptions(drama)
    if (step === 'image') await runImageStep(drama, sb, genOpts, { onProgress: updateProgress })
    else if (step === 'video') await runVideoStep(drama, sb, genOpts, { onProgress: updateProgress })
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
    ctx?.nodeStatus?.clear(sbNodeId.value)
    if (step === 'image') ctx?.nodeStatus?.clear(`sbimg:${sbId}`)
    if (step === 'video') ctx?.nodeStatus?.clear(`sbvid:${sbId}`)
  }
}
</script>

<style scoped>
.sb-panel {
  margin-top: 10px;
  width: min(560px, 94vw);
  padding: 10px 14px 12px;
  border-radius: 12px;
  border: 1px solid rgba(90, 107, 184, 0.45);
  background: rgba(15, 15, 18, 0.97);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 700;
  color: #c7cee8;
}
.head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
}
.busy-tag {
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.18);
  color: #93c5fd;
  animation: pulse-tag 1.2s ease-in-out infinite;
}
.compact-form :deep(.el-form-item) {
  margin-bottom: 6px;
}
.compact-form :deep(.el-form-item__label) {
  color: #71717a;
  font-size: 11px;
}
.compact-form :deep(.el-input__wrapper),
.compact-form :deep(.el-select__wrapper) {
  min-height: 28px;
}
.compact-form :deep(.el-textarea__inner) {
  resize: vertical;
  min-height: 52px;
  line-height: 1.45;
}
.relation-row {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.rel-item {
  flex: 1;
  min-width: 0;
  margin-bottom: 4px !important;
}
.inline-add-row {
  display: flex;
  gap: 10px;
  margin: 0 0 8px 36px;
}
.look-bindings {
  display: grid;
  gap: 6px;
  margin: 0 0 10px 36px;
  padding: 7px;
  border: 1px solid rgba(90, 107, 184, 0.22);
  border-radius: 8px;
  background: rgba(90, 107, 184, 0.06);
}
.look-binding-row {
  display: grid;
  grid-template-columns: 72px minmax(150px, 1fr) 58px;
  align-items: center;
  gap: 7px;
  font-size: 11px;
}
.look-binding-row > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.look-binding-row small {
  color: var(--canvas-text-muted, #8b8fa3);
}
.look-transition-note {
  grid-column: 2 / -1;
}
.meta-row {
  display: flex;
  gap: 10px;
}
.storyboard-mode-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0 0 10px 36px;
}
.storyboard-mode-row > span {
  color: var(--canvas-text-muted, #8b8fa3);
  font-size: 11px;
}
.meta-item { flex: 1; min-width: 0; }
.meta-item.narrow { max-width: 140px; flex: 0 0 140px; }
.text-row-2 {
  display: flex;
  gap: 8px;
  align-items: flex-start;
}
.flex-1 { flex: 1; min-width: 0; }
.panel-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(63, 63, 70, 0.8);
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
@keyframes pulse-tag {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.65; }
}
</style>

<style>
.canvas-panel-popper {
  z-index: 4000 !important;
}
.canvas-panel-popper.el-select__popper .el-select-dropdown__wrap {
  max-height: 168px !important;
}
</style>

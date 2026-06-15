<template>
  <div class="canvas-node-panel nodrag nopan nowheel" :class="'kind-' + kind" @pointerdown.stop @mousedown.stop>
    <div class="panel-head">{{ kindLabel }}</div>
    <div class="name">{{ displayName }}</div>
    <p v-if="description" class="desc">{{ description }}</p>
    <div class="panel-actions">
      <el-button v-if="canGenerate" size="small" type="primary" :loading="generating" @click="generateImage">
        生成参考图
      </el-button>
      <el-button size="small" plain @click="highlightRelated">查看关联分镜</el-button>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { ElMessage } from 'element-plus'
import { characterAPI } from '@/api/characters'
import { sceneAPI } from '@/api/scenes'
import { propAPI } from '@/api/props'
import { useCanvasContext } from '@/composables/useCanvasContext'
import { assetImageUrl } from '@/utils/mediaUrl'

const props = defineProps({
  kind: { type: String, required: true },
  entity: { type: Object, required: true },
  nodeId: { type: String, required: true },
})

const ctx = useCanvasContext()
const generating = ref(false)

const kindLabel = computed(() => {
  const map = { character: '角色素材', scene: '场景素材', prop: '道具素材' }
  return map[props.kind] || '素材'
})

const displayName = computed(() => props.entity?.name || props.entity?.location || '未命名')

const description = computed(() => {
  const e = props.entity || {}
  return (e.description || e.appearance || e.prompt || '').toString().trim()
})

const canGenerate = computed(() => !assetImageUrl(props.entity))

async function generateImage() {
  generating.value = true
  try {
    if (props.kind === 'character') {
      await characterAPI.generateImage(props.entity.id)
    } else if (props.kind === 'scene') {
      await sceneAPI.generateImage({ scene_id: props.entity.id, drama_id: ctx?.drama?.value?.id })
    } else if (props.kind === 'prop') {
      await propAPI.generateImage(props.entity.id)
    }
    ElMessage.success('已提交生成任务')
    await ctx?.refresh?.()
  } catch (e) {
    ElMessage.error(e?.message || '生成失败')
  } finally {
    generating.value = false
  }
}

function highlightRelated() {
  ctx?.setHighlightAsset?.(props.nodeId)
}
</script>

<style scoped>
.canvas-node-panel {
  margin-top: 10px;
  width: 200px;
  padding: 10px 12px 12px;
  border-radius: 10px;
  border: 1px solid rgba(52, 211, 153, 0.4);
  background: rgba(15, 15, 18, 0.96);
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.4);
}
.panel-head {
  font-size: 11px;
  font-weight: 700;
  color: #6ee7b7;
  margin-bottom: 4px;
}
.name {
  font-size: 13px;
  font-weight: 600;
  color: #fafafa;
  margin-bottom: 6px;
}
.desc {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 1.4;
  color: #a1a1aa;
  max-height: 60px;
  overflow-y: auto;
}
.panel-actions {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.panel-actions :deep(.el-button) {
  margin: 0;
}
.kind-scene { border-color: rgba(96, 165, 250, 0.45); }
.kind-prop { border-color: rgba(251, 191, 36, 0.45); }
</style>

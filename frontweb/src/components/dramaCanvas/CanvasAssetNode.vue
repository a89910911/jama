<template>
  <div class="canvas-node-stack">
    <div class="canvas-asset-node" :class="['kind-' + data.kind, { highlighted: data.highlighted, dimmed: data.dimmed, focused: showPanel }]">
      <Handle type="source" :position="Position.Right" />
      <div class="cover">
        <img v-if="thumbUrl" :src="thumbUrl" alt="" />
        <div v-else class="cover-placeholder">{{ kindIcon }}</div>
      </div>
      <div class="info">
        <div class="name">{{ displayName }}</div>
        <div class="kind">{{ kindLabel }}</div>
      </div>
    </div>
    <CanvasAssetPanel
      v-if="showPanel"
      :kind="data.kind"
      :entity="data.entity"
      :node-id="id"
    />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { assetImageUrl } from '@/utils/mediaUrl'
import { useCanvasContext } from '@/composables/useCanvasContext'
import CanvasAssetPanel from './CanvasAssetPanel.vue'

const props = defineProps({
  id: { type: String, required: true },
  data: { type: Object, required: true },
})

const ctx = useCanvasContext()
const showPanel = computed(() => ctx?.focusedNodeId?.value === props.id)

const kindLabel = computed(() => {
  const map = { character: '角色', scene: '场景', prop: '道具' }
  return map[props.data.kind] || '素材'
})

const kindIcon = computed(() => {
  const map = { character: '👤', scene: '🏞', prop: '🎭' }
  return map[props.data.kind] || '📦'
})

const displayName = computed(() => {
  const e = props.data.entity || {}
  return e.name || e.location || '未命名'
})

const thumbUrl = computed(() => assetImageUrl(props.data.entity))
</script>

<style scoped>
.canvas-node-stack {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.canvas-asset-node {
  width: 176px;
  border-radius: 12px;
  overflow: hidden;
  border: 1px solid var(--border-muted, #3f3f46);
  background: var(--bg-card, #18181b);
  box-shadow: var(--shadow, 0 4px 16px rgba(0, 0, 0, 0.35));
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.canvas-asset-node.focused {
  border-color: #34d399;
  box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.45), 0 8px 24px rgba(0, 0, 0, 0.35);
}
.cover {
  height: 108px;
  background: #09090b;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.cover-placeholder {
  font-size: 28px;
  opacity: 0.7;
}
.info {
  padding: 8px 10px 10px;
}
.name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-bright, #fafafa);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.kind {
  font-size: 11px;
  color: var(--text-subtle, #71717a);
  margin-top: 2px;
}
.kind-character { border-color: rgba(52, 211, 153, 0.45); }
.kind-scene { border-color: rgba(96, 165, 250, 0.45); }
.kind-prop { border-color: rgba(251, 191, 36, 0.45); }
.highlighted {
  box-shadow: 0 0 0 2px rgba(52, 211, 153, 0.65), 0 8px 24px rgba(52, 211, 153, 0.2);
}
.dimmed {
  opacity: 0.28;
  filter: grayscale(0.35);
}
</style>

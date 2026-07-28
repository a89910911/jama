<template>
  <div class="canvas-episode-node">
    <Handle type="target" :position="Position.Left" />
    <span class="badge">第 {{ data.episode?.episode_number ?? '?' }} 集</span>
    <span class="title">{{ data.episode?.title || '未命名集' }}</span>
    <span class="count">{{ (data.episode?.storyboards || []).length }} 镜</span>
  </div>
</template>

<script setup>
import { Handle, Position } from '@vue-flow/core'

defineProps({
  data: { type: Object, required: true },
})
</script>

<style scoped>
.canvas-episode-node {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  border-radius: 999px;
  border: 1px solid rgba(232, 160, 122, 0.5);
  background: rgba(123, 67, 41, 0.35);
  color: #f8e2d6;
  font-size: 13px;
  white-space: nowrap;
}
.badge {
  font-weight: 700;
}
.title {
  max-width: 200px;
  overflow: hidden;
  text-overflow: ellipsis;
}
.count {
  font-size: 11px;
  opacity: 0.75;
}
</style>

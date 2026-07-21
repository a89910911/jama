<template>
  <div class="generation-dock">
    <button
      class="generation-toggle"
      type="button"
      :class="{ active: mediaTasks.length > 0, expanded }"
      :aria-expanded="expanded"
      aria-controls="global-generation-progress"
      title="显示或隐藏素材生成进度"
      @click="expanded = !expanded"
    >
      <span class="generation-toggle-dot" />
      <span>素材生成进度</span>
      <span class="generation-toggle-count">{{ mediaTasks.length }}</span>
      <span class="generation-toggle-arrow">⌄</span>
    </button>

    <Transition name="generation-panel">
      <aside
        v-if="expanded"
        id="global-generation-progress"
        class="generation-center"
        aria-live="polite"
      >
        <div class="generation-center-head">
          <span>素材生成进度</span>
          <button class="generation-close" type="button" aria-label="隐藏进度面板" @click="expanded = false">×</button>
        </div>
        <div v-if="mediaTasks.length" class="generation-center-list">
          <div v-for="task in mediaTasks" :key="task.key" class="generation-center-item">
            <div class="generation-center-label" :title="task.label || task.message">
              {{ task.label || defaultLabel(task) }}
            </div>
            <GenerationProgressBar
              compact
              :percentage="task.progress"
              :message="task.message"
              :estimated="task.progressEstimated"
            />
          </div>
        </div>
        <div v-else class="generation-center-empty">当前没有正在生成的图片或视频</div>
      </aside>
    </Transition>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useGenerationTaskStore } from '@/stores/generationTaskStore'
import { isMediaGenerationResourceType, isVideoGenerationKind } from '@/utils/generationProgress'
import GenerationProgressBar from '@/components/GenerationProgressBar.vue'

const generationStore = useGenerationTaskStore()
const expanded = ref(false)

const mediaTasks = computed(() => generationStore.runningTasks
  .filter((task) => isMediaGenerationResourceType(task.resourceType))
  .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)))

function defaultLabel(task) {
  return isVideoGenerationKind(task.resourceType) ? '视频素材' : '图片素材'
}

function onKeydown(event) {
  if (event.key === 'Escape') expanded.value = false
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.generation-dock {
  position: fixed;
  top: 0;
  left: 50%;
  z-index: 3500;
  display: flex;
  flex-direction: column;
  align-items: center;
  width: min(360px, calc(100vw - 28px));
  transform: translateX(-50%);
  pointer-events: none;
}
.generation-toggle {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  min-height: 30px;
  padding: 4px 11px 5px;
  border: 1px solid var(--el-border-color-light, rgba(113, 113, 122, 0.3));
  border-top: 0;
  border-radius: 0 0 10px 10px;
  color: var(--el-text-color-regular, #52525b);
  background: color-mix(in srgb, var(--el-bg-color, #fff) 96%, transparent);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.13);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(12px);
  pointer-events: auto;
}
.generation-toggle:hover,
.generation-toggle.expanded {
  color: var(--el-color-primary, #6366f1);
  border-color: color-mix(in srgb, var(--el-color-primary, #6366f1) 55%, transparent);
}
.generation-toggle-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--el-text-color-placeholder, #a1a1aa);
}
.generation-toggle.active .generation-toggle-dot {
  background: var(--el-color-success, #22c55e);
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--el-color-success, #22c55e) 18%, transparent);
  animation: generation-dot-pulse 1.6s ease-in-out infinite;
}
.generation-toggle-count {
  min-width: 19px;
  padding: 1px 6px;
  border-radius: 999px;
  color: #fff;
  background: var(--el-color-primary, #6366f1);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.generation-toggle-arrow {
  display: inline-block;
  margin-top: -3px;
  font-size: 14px;
  transition: transform 0.2s ease;
}
.generation-toggle.expanded .generation-toggle-arrow {
  transform: rotate(180deg) translateY(-2px);
}
.generation-center {
  width: 100%;
  margin-top: 7px;
  overflow: hidden;
  border: 1px solid var(--el-border-color-light, rgba(113, 113, 122, 0.28));
  border-radius: 12px;
  background: color-mix(in srgb, var(--el-bg-color, #fff) 96%, transparent);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(12px);
  pointer-events: auto;
}
.generation-center-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  border-bottom: 1px solid var(--el-border-color-lighter, rgba(113, 113, 122, 0.18));
  color: var(--el-text-color-primary, #18181b);
  font-size: 13px;
  font-weight: 700;
}
.generation-close {
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  color: var(--el-text-color-secondary, #71717a);
  background: transparent;
  font-size: 18px;
  line-height: 1;
  cursor: pointer;
}
.generation-close:hover {
  color: var(--el-text-color-primary, #27272a);
  background: var(--el-fill-color-light, rgba(113, 113, 122, 0.12));
}
.generation-center-list {
  max-height: min(52vh, 440px);
  overflow-y: auto;
}
.generation-center-item {
  padding: 9px 12px 11px;
}
.generation-center-item + .generation-center-item {
  border-top: 1px solid var(--el-border-color-extra-light, rgba(113, 113, 122, 0.12));
}
.generation-center-label {
  margin-bottom: 5px;
  overflow: hidden;
  color: var(--el-text-color-primary, #27272a);
  font-size: 12px;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generation-center-empty {
  padding: 24px 16px;
  color: var(--el-text-color-secondary, #71717a);
  font-size: 12px;
  text-align: center;
}
.generation-panel-enter-active,
.generation-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
  transform-origin: top center;
}
.generation-panel-enter-from,
.generation-panel-leave-to {
  opacity: 0;
  transform: translateY(-8px) scale(0.98);
}
@keyframes generation-dot-pulse {
  50% { opacity: 0.55; }
}
@media (prefers-reduced-motion: reduce) {
  .generation-toggle-dot,
  .generation-toggle-arrow,
  .generation-panel-enter-active,
  .generation-panel-leave-active {
    animation: none;
    transition: none;
  }
}
</style>

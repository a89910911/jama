<template>
  <div
    ref="dockRef"
    class="generation-dock"
    :class="[`dock-${dockSide}`, { dragging: isDragging }]"
    :style="dockStyle"
  >
    <button
      ref="toggleRef"
      class="generation-toggle"
      type="button"
      :class="{ active: mediaTasks.length > 0, expanded }"
      :aria-expanded="expanded"
      aria-controls="global-generation-progress"
      title="拖动调整位置，点击显示或隐藏素材生成进度"
      @click="onKeyboardClick"
      @keydown.enter.prevent="toggleExpanded"
      @keydown.space.prevent="toggleExpanded"
      @pointerdown="onPointerDown"
    >
      <span class="generation-toggle-dot" />
      <span class="generation-toggle-label">素材生成进度</span>
      <span class="generation-toggle-count">{{ mediaTasks.length }}</span>
      <span class="generation-toggle-arrow">{{ dockSide === 'right' ? '‹' : '›' }}</span>
    </button>

    <Transition
      name="generation-panel"
      @after-enter="constrainDockToViewport"
      @after-leave="constrainDockToViewport"
    >
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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useGenerationTaskStore } from '@/stores/generationTaskStore'
import { isMediaGenerationResourceType, isVideoGenerationKind } from '@/utils/generationProgress'
import GenerationProgressBar from '@/components/GenerationProgressBar.vue'

const EDGE_GAP = 12
const DRAG_THRESHOLD = 8
const POSITION_STORAGE_KEY = 'jama:generation-progress-position'

const generationStore = useGenerationTaskStore()
const dockRef = ref(null)
const toggleRef = ref(null)
const expanded = ref(false)
const dockSide = ref('right')
const dockY = ref(null)
const preferredDockY = ref(null)
const isDragging = ref(false)
const dragPoint = ref(null)
let pointerState = null

const mediaTasks = computed(() => generationStore.runningTasks
  .filter((task) => isMediaGenerationResourceType(task.resourceType))
  .sort((a, b) => (a.startedAt || 0) - (b.startedAt || 0)))

const dockStyle = computed(() => {
  const top = `${dockY.value ?? (typeof window !== 'undefined' ? window.innerHeight / 2 : 0)}px`
  if (isDragging.value && dragPoint.value && pointerState) {
    if (dockSide.value === 'left') {
      return {
        top,
        left: `${dragPoint.value.x - pointerState.width / 2}px`,
        right: 'auto',
      }
    }
    return {
      top,
      right: `${window.innerWidth - dragPoint.value.x - pointerState.width / 2}px`,
      left: 'auto',
    }
  }
  return {
    top,
    left: dockSide.value === 'left' ? `${EDGE_GAP}px` : 'auto',
    right: dockSide.value === 'right' ? `${EDGE_GAP}px` : 'auto',
  }
})

function defaultLabel(task) {
  return isVideoGenerationKind(task.resourceType) ? '视频素材' : '图片素材'
}

function clamp(value, min, max) {
  if (min > max) return (min + max) / 2
  return Math.min(Math.max(value, min), max)
}

function getToggleSize() {
  const rect = toggleRef.value?.getBoundingClientRect()
  return {
    width: rect?.width || 42,
    height: rect?.height || 166,
  }
}

function constrainDockToViewport() {
  if (typeof window === 'undefined' || isDragging.value) return
  const dockHeight = dockRef.value?.offsetHeight || getToggleSize().height
  const halfHeight = Math.min(dockHeight / 2, window.innerHeight / 2 - EDGE_GAP)
  const preferred = preferredDockY.value ?? window.innerHeight / 2
  dockY.value = clamp(preferred, halfHeight + EDGE_GAP, window.innerHeight - halfHeight - EDGE_GAP)
}

function persistDockPosition() {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify({
      side: dockSide.value,
      yRatio: preferredDockY.value / window.innerHeight,
    }))
  } catch {
    // Storage can be unavailable in privacy-restricted browser contexts.
  }
}

function restoreDockPosition() {
  let savedPosition = null
  try {
    savedPosition = JSON.parse(localStorage.getItem(POSITION_STORAGE_KEY))
  } catch {
    savedPosition = null
  }
  if (savedPosition?.side === 'left' || savedPosition?.side === 'right') {
    dockSide.value = savedPosition.side
  }
  const savedRatio = Number(savedPosition?.yRatio)
  const yRatio = Number.isFinite(savedRatio) ? clamp(savedRatio, 0, 1) : 0.5
  preferredDockY.value = yRatio * window.innerHeight
  constrainDockToViewport()
}

function toggleExpanded() {
  expanded.value = !expanded.value
}

function onKeyboardClick(event) {
  // Pointer clicks are handled on pointerup so they cannot race with drag handling.
  if (event.detail === 0) toggleExpanded()
}

function onPointerDown(event) {
  if (event.button !== 0 || pointerState) return
  const rect = event.currentTarget.getBoundingClientRect()
  pointerState = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    offsetX: event.clientX - (rect.left + rect.width / 2),
    offsetY: event.clientY - (rect.top + rect.height / 2),
    width: rect.width,
    height: rect.height,
  }
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerCancel)
}

function onPointerMove(event) {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return
  const distance = Math.hypot(
    event.clientX - pointerState.startX,
    event.clientY - pointerState.startY
  )
  if (!isDragging.value && distance < DRAG_THRESHOLD) return
  if (!isDragging.value) {
    isDragging.value = true
    expanded.value = false
  }
  const centerX = event.clientX - pointerState.offsetX
  const centerY = event.clientY - pointerState.offsetY
  dragPoint.value = {
    x: clamp(
      centerX,
      pointerState.width / 2 + EDGE_GAP,
      window.innerWidth - pointerState.width / 2 - EDGE_GAP
    ),
    y: clamp(
      centerY,
      pointerState.height / 2 + EDGE_GAP,
      window.innerHeight - pointerState.height / 2 - EDGE_GAP
    ),
  }
  dockY.value = dragPoint.value.y
}

function onPointerUp(event) {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return
  if (isDragging.value && dragPoint.value) {
    dockSide.value = dragPoint.value.x < window.innerWidth / 2 ? 'left' : 'right'
    preferredDockY.value = dragPoint.value.y
    dockY.value = dragPoint.value.y
    persistDockPosition()
  } else {
    toggleExpanded()
  }
  finishPointerInteraction()
}

function onPointerCancel(event) {
  if (!pointerState || event.pointerId !== pointerState.pointerId) return
  if (isDragging.value && dragPoint.value) {
    dockSide.value = dragPoint.value.x < window.innerWidth / 2 ? 'left' : 'right'
    preferredDockY.value = dragPoint.value.y
    dockY.value = dragPoint.value.y
    persistDockPosition()
  }
  finishPointerInteraction()
}

function finishPointerInteraction() {
  window.removeEventListener('pointermove', onPointerMove)
  window.removeEventListener('pointerup', onPointerUp)
  window.removeEventListener('pointercancel', onPointerCancel)
  pointerState = null
  dragPoint.value = null
  isDragging.value = false
  constrainDockToViewport()
}

function onKeydown(event) {
  if (event.key === 'Escape') expanded.value = false
}

function onResize() {
  const ratio = preferredDockY.value / window.innerHeight
  preferredDockY.value = clamp(ratio, 0, 1) * window.innerHeight
  constrainDockToViewport()
}

watch(expanded, async (isExpanded) => {
  if (!isExpanded) return
  await nextTick()
  constrainDockToViewport()
})

onMounted(() => {
  restoreDockPosition()
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => {
  finishPointerInteraction()
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('resize', onResize)
})
</script>

<style scoped>
.generation-dock {
  --generation-progress-height: min(166px, calc(100vh - 24px));
  position: fixed;
  z-index: 3500;
  display: flex;
  align-items: center;
  transform: translateY(-50%);
  pointer-events: none;
}
.generation-dock.dock-right {
  flex-direction: row-reverse;
}
.generation-dock.dock-left {
  flex-direction: row;
}
.generation-toggle {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  width: 42px;
  height: var(--generation-progress-height);
  min-height: var(--generation-progress-height);
  padding: 8px 6px;
  border: 1px solid var(--el-border-color-light, rgba(113, 113, 122, 0.3));
  border-radius: 14px;
  color: var(--el-text-color-regular, #52525b);
  background: color-mix(in srgb, var(--el-bg-color, #fff) 96%, transparent);
  box-shadow: 0 5px 16px rgba(0, 0, 0, 0.13);
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: grab;
  backdrop-filter: blur(12px);
  touch-action: none;
  user-select: none;
  pointer-events: auto;
}
.generation-dock.dragging .generation-toggle {
  cursor: grabbing;
  box-shadow: 0 10px 28px rgba(0, 0, 0, 0.22);
}
.generation-toggle:hover,
.generation-toggle.expanded {
  color: var(--el-color-primary, #6366f1);
  border-color: color-mix(in srgb, var(--el-color-primary, #6366f1) 55%, transparent);
}
.generation-toggle-dot {
  flex: 0 0 auto;
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
.generation-toggle-label {
  letter-spacing: 2px;
  line-height: 1;
  text-orientation: upright;
  white-space: nowrap;
  writing-mode: vertical-rl;
}
.generation-toggle-count {
  min-width: 22px;
  padding: 2px 4px;
  border-radius: 999px;
  color: #fff;
  background: var(--el-color-primary, #6366f1);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
}
.generation-toggle-arrow {
  display: inline-block;
  height: 16px;
  font-size: 20px;
  line-height: 1;
  transition: transform 0.2s ease;
}
.generation-toggle.expanded .generation-toggle-arrow {
  transform: rotate(180deg);
}
.generation-center {
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  width: min(360px, calc(100vw - 76px));
  height: var(--generation-progress-height);
  overflow: hidden;
  border: 1px solid var(--el-border-color-light, rgba(113, 113, 122, 0.28));
  border-radius: 12px;
  background: color-mix(in srgb, var(--el-bg-color, #fff) 96%, transparent);
  box-shadow: 0 14px 38px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(12px);
  pointer-events: auto;
}
.dock-right .generation-center {
  margin-right: 8px;
}
.dock-left .generation-center {
  margin-left: 8px;
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
  flex: 1;
  min-height: 0;
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
  display: grid;
  flex: 1;
  place-items: center;
  padding: 24px 16px;
  color: var(--el-text-color-secondary, #71717a);
  font-size: 12px;
  text-align: center;
}
.generation-panel-enter-active,
.generation-panel-leave-active {
  transition: opacity 0.18s ease, transform 0.18s ease;
  transform-origin: right center;
}
.dock-left .generation-panel-enter-active,
.dock-left .generation-panel-leave-active {
  transform-origin: left center;
}
.generation-panel-enter-from,
.generation-panel-leave-to {
  opacity: 0;
}
.dock-right .generation-panel-enter-from,
.dock-right .generation-panel-leave-to {
  transform: translateX(8px) scale(0.98);
}
.dock-left .generation-panel-enter-from,
.dock-left .generation-panel-leave-to {
  transform: translateX(-8px) scale(0.98);
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

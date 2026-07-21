<template>
  <div class="generation-progress" :class="{ compact }">
    <div v-if="message || showPercentage" class="generation-progress-head">
      <span v-if="message" class="generation-progress-message">{{ message }}</span>
      <span v-if="showPercentage" class="generation-progress-number">
        {{ estimated && percentage < 100 ? '预计 ' : '' }}{{ safePercentage }}%
      </span>
    </div>
    <div
      class="generation-progress-track"
      role="progressbar"
      :aria-valuenow="safePercentage"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-label="message || '素材生成进度'"
    >
      <div
        class="generation-progress-fill"
        :class="{ estimated: estimated && safePercentage < 100, completed: safePercentage >= 100 }"
        :style="{ width: `${safePercentage}%` }"
      />
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { clampGenerationProgress } from '@/utils/generationProgress'

const props = defineProps({
  percentage: { type: Number, default: 0 },
  message: { type: String, default: '' },
  estimated: { type: Boolean, default: false },
  compact: { type: Boolean, default: false },
  showPercentage: { type: Boolean, default: true },
})

const safePercentage = computed(() => clampGenerationProgress(props.percentage))
</script>

<style scoped>
.generation-progress {
  width: 100%;
  min-width: 120px;
}
.generation-progress-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 6px;
  color: var(--el-text-color-regular, #52525b);
  font-size: 12px;
  line-height: 1.25;
}
.generation-progress-message {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.generation-progress-number {
  flex: none;
  color: var(--el-color-primary, #6366f1);
  font-variant-numeric: tabular-nums;
}
.generation-progress-track {
  width: 100%;
  height: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--el-fill-color-dark, rgba(113, 113, 122, 0.2));
}
.generation-progress-fill {
  min-width: 3px;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #6366f1, #8b5cf6);
  transition: width 0.45s ease;
}
.generation-progress-fill.estimated {
  background-image: repeating-linear-gradient(
    120deg,
    #6366f1 0,
    #6366f1 10px,
    #818cf8 10px,
    #818cf8 20px
  );
  background-size: 40px 100%;
  animation: generation-progress-stripes 1s linear infinite;
}
.generation-progress-fill.completed {
  background: var(--el-color-success, #22c55e);
}
.generation-progress.compact .generation-progress-head {
  margin-bottom: 4px;
  font-size: 10px;
}
.generation-progress.compact .generation-progress-track {
  height: 5px;
}
@keyframes generation-progress-stripes {
  to { background-position: 40px 0; }
}
@media (prefers-reduced-motion: reduce) {
  .generation-progress-fill { transition: none; }
  .generation-progress-fill.estimated { animation: none; }
}
</style>

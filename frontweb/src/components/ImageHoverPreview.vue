<template>
  <Teleport to="body">
    <Transition name="image-hover-preview">
      <div
        v-if="visible"
        data-image-hover-preview-root
        class="image-hover-preview"
        :style="previewStyle"
        aria-hidden="true"
      >
        <img
          :src="previewSrc"
          :alt="previewAlt"
          draggable="false"
          @error="hidePreview"
        />
      </div>
    </Transition>
  </Teleport>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { calculateImagePreviewLayout } from '@/utils/imageHoverPreview'

const HOVER_DELAY = 140

const visible = ref(false)
const previewSrc = ref('')
const previewAlt = ref('')
const previewStyle = ref({})

let activeImage = null
let showTimer = null
let layoutFrame = null

function isPreviewableImage(target) {
  if (!(target instanceof HTMLImageElement)) return false
  if (target.dataset.hoverPreview === 'off') return false
  if (target.closest('[data-image-hover-preview-root]')) return false
  // These images are already displayed in a full-screen viewer.
  if (target.closest('.image-preview-overlay, .el-image-viewer__wrapper')) return false
  return !(target.complete && target.naturalWidth === 0)
}

function updateLayout() {
  layoutFrame = null
  if (!activeImage?.isConnected || !visible.value) {
    hidePreview()
    return
  }

  const rect = activeImage.getBoundingClientRect()
  if (rect.bottom <= 0 || rect.top >= window.innerHeight || rect.right <= 0 || rect.left >= window.innerWidth) {
    hidePreview()
    return
  }

  const layout = calculateImagePreviewLayout({
    sourceWidth: activeImage.naturalWidth,
    sourceHeight: activeImage.naturalHeight,
    targetRect: rect,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  })
  previewStyle.value = {
    left: `${layout.left}px`,
    top: `${layout.top}px`,
    width: `${layout.width}px`,
    height: `${layout.height}px`,
  }
}

function requestLayout() {
  if (layoutFrame !== null) return
  layoutFrame = window.requestAnimationFrame(updateLayout)
}

function showPreview(image) {
  showTimer = null
  if (!image?.isConnected || !isPreviewableImage(image)) return

  const src = image.currentSrc || image.src
  if (!src) return

  activeImage = image
  previewSrc.value = src
  previewAlt.value = image.alt || ''
  visible.value = true
  updateLayout()
}

function hidePreview() {
  if (showTimer !== null) {
    window.clearTimeout(showTimer)
    showTimer = null
  }
  if (layoutFrame !== null) {
    window.cancelAnimationFrame(layoutFrame)
    layoutFrame = null
  }
  activeImage = null
  visible.value = false
  previewSrc.value = ''
}

function onPointerOver(event) {
  if (event.pointerType && event.pointerType !== 'mouse') return
  const image = event.target
  if (!isPreviewableImage(image) || image === activeImage) return

  hidePreview()
  activeImage = image
  showTimer = window.setTimeout(() => showPreview(image), HOVER_DELAY)
}

function onPointerOut(event) {
  if (event.target !== activeImage) return
  hidePreview()
}

function onKeydown(event) {
  if (event.key === 'Escape') hidePreview()
}

onMounted(() => {
  document.addEventListener('pointerover', onPointerOver, true)
  document.addEventListener('pointerout', onPointerOut, true)
  document.addEventListener('pointerdown', hidePreview, true)
  document.addEventListener('keydown', onKeydown)
  window.addEventListener('scroll', requestLayout, true)
  window.addEventListener('resize', requestLayout)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerover', onPointerOver, true)
  document.removeEventListener('pointerout', onPointerOut, true)
  document.removeEventListener('pointerdown', hidePreview, true)
  document.removeEventListener('keydown', onKeydown)
  window.removeEventListener('scroll', requestLayout, true)
  window.removeEventListener('resize', requestLayout)
  hidePreview()
})
</script>

<style scoped>
.image-hover-preview {
  position: fixed;
  z-index: 2147483000;
  overflow: hidden;
  pointer-events: none;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 12px;
  background: #111114;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.42), 0 2px 10px rgba(0, 0, 0, 0.3);
  transform-origin: center;
}

.image-hover-preview img {
  display: block;
  width: 100%;
  height: 100%;
  object-fit: contain;
  background:
    linear-gradient(45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
    linear-gradient(-45deg, rgba(255, 255, 255, 0.035) 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%),
    linear-gradient(-45deg, transparent 75%, rgba(255, 255, 255, 0.035) 75%);
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-size: 16px 16px;
}

.image-hover-preview-enter-active,
.image-hover-preview-leave-active {
  transition: opacity 0.12s ease, transform 0.12s ease;
}

.image-hover-preview-enter-from,
.image-hover-preview-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .image-hover-preview-enter-active,
  .image-hover-preview-leave-active {
    transition: none;
  }
}
</style>


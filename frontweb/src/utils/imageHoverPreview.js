const DEFAULT_MARGIN = 16
const DEFAULT_GAP = 14

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function positiveNumber(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : fallback
}

/**
 * Calculate a fixed-position preview that stays inside the viewport and prefers
 * the side of the source image with the most room.
 */
export function calculateImagePreviewLayout({
  sourceWidth,
  sourceHeight,
  targetRect,
  viewportWidth,
  viewportHeight,
  margin = DEFAULT_MARGIN,
  gap = DEFAULT_GAP,
}) {
  const safeViewportWidth = positiveNumber(viewportWidth, 1024)
  const safeViewportHeight = positiveNumber(viewportHeight, 768)
  const rect = {
    left: Number(targetRect?.left) || 0,
    right: Number(targetRect?.right) || 0,
    top: Number(targetRect?.top) || 0,
    width: positiveNumber(targetRect?.width, 1),
    height: positiveNumber(targetRect?.height, 1),
  }

  const fallbackRatio = rect.width / rect.height
  const ratio = positiveNumber(sourceWidth, rect.width)
    / positiveNumber(sourceHeight, rect.height || rect.width / fallbackRatio)
  const maxWidth = Math.max(80, Math.min(480, safeViewportWidth * 0.42, safeViewportWidth - margin * 2))
  const maxHeight = Math.max(80, Math.min(520, safeViewportHeight * 0.72, safeViewportHeight - margin * 2))

  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }

  const rightSpace = safeViewportWidth - rect.right - margin
  const leftSpace = rect.left - margin
  const placeOnRight = rightSpace >= width || rightSpace >= leftSpace
  const preferredLeft = placeOnRight
    ? rect.right + gap
    : rect.left - gap - width
  const left = clamp(preferredLeft, margin, safeViewportWidth - margin - width)

  const targetCenterY = rect.top + rect.height / 2
  const top = clamp(targetCenterY - height / 2, margin, safeViewportHeight - margin - height)

  return {
    left: Math.round(left),
    top: Math.round(top),
    width: Math.round(width),
    height: Math.round(height),
  }
}


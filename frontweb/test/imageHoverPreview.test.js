import test from 'node:test'
import assert from 'node:assert/strict'
import { calculateImagePreviewLayout } from '../src/utils/imageHoverPreview.js'

test('hover preview prefers the right side when there is enough room', () => {
  const layout = calculateImagePreviewLayout({
    sourceWidth: 1600,
    sourceHeight: 900,
    targetRect: { left: 100, right: 220, top: 200, width: 120, height: 80 },
    viewportWidth: 1440,
    viewportHeight: 900,
  })

  assert.equal(layout.left, 234)
  assert.equal(layout.width, 480)
  assert.equal(layout.height, 270)
})

test('hover preview moves to the left and remains inside a small viewport', () => {
  const layout = calculateImagePreviewLayout({
    sourceWidth: 900,
    sourceHeight: 1600,
    targetRect: { left: 700, right: 780, top: 560, width: 80, height: 100 },
    viewportWidth: 800,
    viewportHeight: 640,
  })

  assert.ok(layout.left >= 16)
  assert.ok(layout.left + layout.width <= 784)
  assert.ok(layout.top >= 16)
  assert.ok(layout.top + layout.height <= 624)
  assert.ok(layout.left < 700)
})


import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isStoryboardLastFrameHistory,
  splitStoryboardFrameHistory,
} from '../src/utils/storyboardFrameHistory.js'

test('separates first-frame and last-frame history by frame type', () => {
  const groups = splitStoryboardFrameHistory([
    { id: 1, frame_type: 'storyboard_first' },
    { id: 2, frame_type: 'storyboard_last' },
    { id: 3, frame_type: null },
    { id: 4, frame_type: 'tail' },
  ])

  assert.deepEqual(groups.first.map((image) => image.id), [1, 3])
  assert.deepEqual(groups.last.map((image) => image.id), [2, 4])
})

test('excludes currently bound first and last frame images from history', () => {
  const groups = splitStoryboardFrameHistory([
    { id: 10, frame_type: 'storyboard_first' },
    { id: 11, frame_type: 'storyboard_first' },
    { id: 12, frame_type: 'storyboard_last' },
    { id: 13, frame_type: 'storyboard_last' },
  ], [10, 13])

  assert.deepEqual(groups.first.map((image) => image.id), [11])
  assert.deepEqual(groups.last.map((image) => image.id), [12])
})

test('recognizes compatible last-frame history type aliases', () => {
  for (const frameType of ['storyboard_last', 'last', 'tail', 'last_frame', 'LAST_FRAME']) {
    assert.equal(isStoryboardLastFrameHistory({ frame_type: frameType }), true)
  }
  assert.equal(isStoryboardLastFrameHistory({ frame_type: 'storyboard_first' }), false)
})

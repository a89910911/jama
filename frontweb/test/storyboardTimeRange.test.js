import test from 'node:test'
import assert from 'node:assert/strict'

import { buildStoryboardTimeRanges } from '../src/utils/storyboardTimeRange.js'

test('builds inclusive cumulative storyboard time ranges', () => {
  const ranges = buildStoryboardTimeRanges([
    { duration: 8 },
    { duration: 9 },
    { duration: 5 },
  ])

  assert.deepEqual(
    ranges.map(({ start, end, label }) => ({ start, end, label })),
    [
      { start: 0, end: 7, label: '0-7秒' },
      { start: 8, end: 16, label: '8-16秒' },
      { start: 17, end: 21, label: '17-21秒' },
    ]
  )
})

test('supports edited durations and falls back when a duration is missing', () => {
  const editedDurations = { 1: 6, 2: null }
  const ranges = buildStoryboardTimeRanges(
    [{ id: 1, duration: 8 }, { id: 2 }],
    (storyboard) => editedDurations[storyboard.id] ?? storyboard.duration,
    5
  )

  assert.deepEqual(ranges.map((range) => range.label), ['0-5秒', '6-10秒'])
})

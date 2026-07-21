import test from 'node:test'
import assert from 'node:assert/strict'
import {
  applyGenerationProgress,
  clampGenerationProgress,
  isMediaGenerationResourceType,
  parseGenerationTaskResult,
  resolveGenerationProgress,
} from '../src/utils/generationProgress.js'

test('generation progress clamps invalid percentages', () => {
  assert.equal(clampGenerationProgress(-5), 0)
  assert.equal(clampGenerationProgress(44.6), 45)
  assert.equal(clampGenerationProgress(120), 100)
  assert.equal(clampGenerationProgress('bad'), 0)
})

test('reported progress wins and completed tasks always reach 100', () => {
  const active = resolveGenerationProgress(
    { status: 'processing', progress: 72, message: '厂商处理中' },
    { kind: 'video', startedAt: Date.now() }
  )
  assert.equal(active.percentage, 72)
  assert.equal(active.estimated, false)
  assert.equal(active.message, '厂商处理中')

  const done = resolveGenerationProgress({ status: 'completed', progress: 72 })
  assert.equal(done.percentage, 100)
  assert.equal(done.estimated, false)
})

test('missing provider progress receives a capped transparent estimate', () => {
  const startedAt = Date.now() - 60 * 60 * 1000
  const progress = resolveGenerationProgress(
    { status: 'processing', progress: 0 },
    { kind: 'image', startedAt }
  )
  assert.equal(progress.percentage, 95)
  assert.equal(progress.estimated, true)
})

test('applyGenerationProgress updates reactive-style targets monotonically', () => {
  const target = { progress: 60, progressStartedAt: Date.now() }
  applyGenerationProgress(target, { status: 'processing', progress: 10 }, { kind: 'image' })
  assert.equal(target.progress, 60)
  assert.equal(target.progressEstimated, true)
})

test('media task filtering and persisted task result parsing are tolerant', () => {
  assert.equal(isMediaGenerationResourceType('sb_video'), true)
  assert.equal(isMediaGenerationResourceType('generate_story'), false)
  assert.deepEqual(parseGenerationTaskResult('{"image_url":"/one.png"}'), { image_url: '/one.png' })
  assert.deepEqual(parseGenerationTaskResult('{broken'), {})
})

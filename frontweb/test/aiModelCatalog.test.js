import test from 'node:test'
import assert from 'node:assert/strict'

import { groupModelOptions } from '../src/config/aiModelCatalog.js'

test('groups verified models by role while preserving exact model ids', () => {
  const groups = groupModelOptions(
    ['qwen-plus', 'qwen3.7-max', 'qwen3.6-flash', 'custom-qwen-model'],
    'text',
    'qwen'
  )

  assert.deepEqual(groups.map((group) => group.tier), [
    'recommended',
    'fast',
    'standard',
    'compatible',
  ])
  assert.equal(groups[0].options[0].value, 'qwen3.7-max')
  assert.equal(groups[1].options[0].value, 'qwen3.6-flash')
  assert.equal(groups[2].options[0].value, 'custom-qwen-model')
  assert.equal(groups[3].options[0].value, 'qwen-plus')
})

test('keeps account-discovered Venice models selectable without duplicating static models', () => {
  const groups = groupModelOptions(
    ['openai-gpt-55', 'account-only-model', 'account-only-model'],
    'text',
    'venice',
    ['account-only-model']
  )

  const account = groups.find((group) => group.tier === 'account')
  assert.deepEqual(account.options.map((option) => option.value), ['account-only-model'])
})

test('shares image capability metadata with storyboard image configs', () => {
  const groups = groupModelOptions(
    ['wan2.7-image-pro', 'wan2.6-image'],
    'storyboard_image',
    'dashscope'
  )

  assert.equal(groups[0].tier, 'recommended')
  assert.equal(groups.at(-1).tier, 'compatible')
})


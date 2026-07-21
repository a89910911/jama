import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CODEX_CONVERSATION_TIPS,
  codexActionLabel,
  codexIntentOptions,
  codexMessageImages,
  parseCodexTaskResult,
  shouldRefreshDrama,
  upsertChatMessage,
} from '../src/utils/codexChatUi.js'

test('Codex chat messages are inserted once and replaced by id', () => {
  const first = upsertChatMessage([], { id: 'm1', status: 'processing' })
  const completed = upsertChatMessage(first, { id: 'm1', status: 'completed', content: '完成' })
  assert.equal(completed.length, 1)
  assert.equal(completed[0].content, '完成')
})

test('Codex task results tolerate malformed persisted JSON', () => {
  assert.deepEqual(parseCodexTaskResult('{"action":"generate_story"}'), { action: 'generate_story' })
  assert.deepEqual(parseCodexTaskResult('{broken'), {})
})

test('only content mutations request a drama refresh', () => {
  assert.equal(shouldRefreshDrama({ action: 'generate_story' }), true)
  assert.equal(shouldRefreshDrama({ action: 'chat' }), false)
  assert.equal(shouldRefreshDrama({ action: 'generate_image' }), true)
})

test('reads both single and batch Codex images from message metadata', () => {
  assert.deepEqual(
    codexMessageImages({ metadata: { image: { url: '/static/one.png' } } }),
    [{ url: '/static/one.png' }]
  )
  assert.deepEqual(
    codexMessageImages({
      metadata: {
        images: [
          { url: '/static/character.png', name: '角色甲' },
          { url: '/static/scene.png', name: '场景乙' },
        ],
      },
    }),
    [
      { url: '/static/character.png', name: '角色甲' },
      { url: '/static/scene.png', name: '场景乙' },
    ]
  )
})

test('Codex intent shortcuts include editable examples and hover descriptions', () => {
  const options = codexIntentOptions({ episodeId: 13, episodeNumber: 9 })
  assert.deepEqual(
    options.map((item) => item.value),
    [
      'generate_story',
      'rewrite_current_episode',
      'continue_current_episode',
      'generate_storyboards',
      'update_storyboard_details',
      'optimize_storyboard_prompt',
      'generate_storyboard_images',
      'extract_resources',
      'optimize_resource_prompt',
      'generate_resource_images',
      'generate_image',
    ]
  )
  assert.ok(options.every((item) => item.example.length > 10))
  assert.ok(options.every((item) => item.description.length > 8))
  assert.match(options[0].example, /第 9 集/)
  assert.match(options[3].example, /所有分镜/)
  assert.match(options[7].example, /角色、道具和场景/)
})

test('project-level Codex shortcuts omit episode-only rewrite actions', () => {
  const options = codexIntentOptions()
  assert.equal(options[0].label, '生成完整剧本')
  assert.equal(options.some((item) => item.value === 'rewrite_current_episode'), false)
  assert.equal(options.some((item) => item.value === 'continue_current_episode'), false)
})

test('Codex assistant exposes recognized action labels and conversation guidance', () => {
  assert.equal(codexActionLabel('generate_storyboard_images'), '生成分镜图片')
  assert.equal(codexActionLabel('optimize_storyboard_prompt'), '优化分镜提示词')
  assert.equal(codexActionLabel('unknown'), '')
  assert.ok(CODEX_CONVERSATION_TIPS.length >= 5)
  assert.ok(CODEX_CONVERSATION_TIPS.some((tip) => tip.includes('重新生成并覆盖')))
  assert.ok(CODEX_CONVERSATION_TIPS.some((tip) => tip.includes('不会修改数据库')))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import {
  effectivePromptContent,
  filterPromptItems,
  promptRowKey,
} from '../src/utils/promptTemplateUi.js'

const rows = [
  {
    prompt_key: 'character.extraction.system',
    locale: 'zh',
    name: '角色提取',
    category: '实体提取',
    scene_key: 'role_extraction',
    message_role: 'system',
    system_content: 'system zh',
    effective_content: 'project zh',
  },
  {
    prompt_key: 'image.negative.anti_split',
    locale: 'universal',
    name: '防分屏负向提示词',
    category: '图片/视频技术约束',
    scene_key: null,
    message_role: 'negative_prompt',
    system_content: 'negative',
    effective_content: 'negative',
  },
]

test('prompt rows use key plus locale as stable identity', () => {
  assert.equal(promptRowKey(rows[0]), 'character.extraction.system::zh')
})

test('project editor uses effective content while system editor uses system content', () => {
  assert.equal(effectivePromptContent(rows[0], true), 'project zh')
  assert.equal(effectivePromptContent(rows[0], false), 'system zh')
})

test('prompt filters combine category, role, locale and keyword', () => {
  assert.deepEqual(
    filterPromptItems(rows, { sceneKey: 'role_extraction', locale: 'zh' }),
    [rows[0]]
  )
  assert.deepEqual(
    filterPromptItems(rows, { role: 'negative_prompt', keyword: 'anti_split' }),
    [rows[1]]
  )
  assert.equal(filterPromptItems(rows, { category: '不存在' }).length, 0)
})

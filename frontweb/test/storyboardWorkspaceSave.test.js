import test from 'node:test'
import assert from 'node:assert/strict'

import { saveStoryboardWorkspace } from '../src/utils/storyboardWorkspaceSave.js'

test('classic storyboard save persists fields before rebuilding video_prompt', async () => {
  const calls = []
  const api = {
    async update(id, payload) {
      calls.push(['update', id, payload.action])
    },
    async rebuildVideoPrompt(id) {
      calls.push(['rebuild', id])
      return { id, video_prompt: '按最新动作生成的视频提示词' }
    },
  }

  const result = await saveStoryboardWorkspace(api, 7, {
    creation_mode: 'classic',
    action: '角色转身离开',
    video_prompt: '旧提示词',
  })

  assert.deepEqual(calls, [
    ['update', 7, '角色转身离开'],
    ['rebuild', 7],
  ])
  assert.equal(result.rebuiltVideoPrompt, true)
  assert.equal(result.storyboard.video_prompt, '按最新动作生成的视频提示词')
})

test('universal storyboard save does not rebuild classic video_prompt', async () => {
  const calls = []
  const api = {
    async update(id, payload) {
      calls.push(['update', id, payload.universal_segment_text])
    },
    async rebuildVideoPrompt(id) {
      calls.push(['rebuild', id])
    },
  }

  const result = await saveStoryboardWorkspace(api, 8, {
    creation_mode: 'universal',
    universal_segment_text: '分镜1：推进镜头',
  })

  assert.deepEqual(calls, [['update', 8, '分镜1：推进镜头']])
  assert.equal(result.rebuiltVideoPrompt, false)
  assert.equal(result.storyboard, null)
})

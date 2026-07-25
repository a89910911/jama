import test from 'node:test'
import assert from 'node:assert/strict'

import {
  storyboardUsesFirstLastFrame,
  sbVideoFirstLastUrls,
} from '../src/utils/storyboardMedia.js'

test('per-storyboard first/last-frame setting overrides the drama default', () => {
  const globalOn = { metadata: { storyboard_use_first_last_frame: true } }
  const globalOff = { metadata: { storyboard_use_first_last_frame: false } }

  assert.equal(storyboardUsesFirstLastFrame({ creation_mode: 'classic' }, globalOn), true)
  assert.equal(storyboardUsesFirstLastFrame({ creation_mode: 'classic' }, globalOff), false)
  assert.equal(
    storyboardUsesFirstLastFrame({ creation_mode: 'classic', use_first_last_frame: false }, globalOn),
    false
  )
  assert.equal(
    storyboardUsesFirstLastFrame({ creation_mode: 'classic', use_first_last_frame: true }, globalOff),
    true
  )
})

test('universal storyboard mode always bypasses the classic first/last-frame workflow', () => {
  assert.equal(
    storyboardUsesFirstLastFrame(
      { creation_mode: 'universal', use_first_last_frame: true },
      { metadata: { storyboard_use_first_last_frame: true } }
    ),
    false
  )
})

test('video frame binding follows the per-storyboard override', () => {
  const images = {
    7: [
      { id: 1, status: 'completed', frame_type: 'storyboard_first', image_url: 'https://cdn.test/first.png' },
      { id: 2, status: 'completed', frame_type: 'storyboard_last', image_url: 'https://cdn.test/last.png' },
    ],
  }
  const sb = {
    id: 7,
    creation_mode: 'classic',
    use_first_last_frame: true,
    first_frame_image_id: 1,
    last_frame_image_id: 2,
  }

  assert.deepEqual(sbVideoFirstLastUrls(sb, images, false), {
    first: 'https://cdn.test/first.png',
    last: 'https://cdn.test/last.png',
  })
})
